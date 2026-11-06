import { BpError, type FactCard } from './factCardService.js';
import { gatherSources, numbersBacked, srcList, corroboration, bestTier, DOCS_RULES, type Source, type Query, type ExtraSource, type Tier } from './sources.js';
import { segmentOf, type Keywords } from './keywordsService.js';
import { bpJson } from './llm.js';
import { bpMethod, INDUSTRY_SLOT, INDUSTRY_METHOD } from './prompts.js';

// 06 宏观分析（行业）。这一章最危险的失败是**一个带出处、但出处里根本没有的数字**：
// 「2025 年市场规模 3126 亿元 [3]」读起来是查过的，而 [3] 那篇讲的是另一个口径或者压根没提。
// 所以三件事在代码里定（硬规则 3）：
//   ① 检索词由代码按事实卡里的「所属行业」拼（`buildQueries`），年份由代码算；
//   ② 模型只引**编号**，URL 由代码按编号填 —— 模型一个链接都不写，编不出不存在的来源；
//   ③ 每个数字（关键数字、柱图、环形图、趋势证据）都要在它引的那几条资料原文里找得到
//      （`numbersBacked`），找不到标 `unsourced`，界面上显示「出处里没有这个数」。
// 画像里「数据支撑」也要过同一道：引的资料里没有那几个数就改标「推断」。
// 检索失败一律出声：一条都没搜到时整章报错带原文；部分失败的检索词列在 `failedQueries`。

const MAX_TOKENS = 20_000;

export type IndustrySource = Source;

export interface Kpi {
  label: string; value: string; unit: string; delta: string; note: string;
  src: number[];
  /** 数字在它引的资料里找不到，或者没引任何资料。 */
  unsourced: boolean;
  /** 交叉验证：这个数出现在几个不同域名的资料里（本章全部资料，不只是被引的）。 */
  xsrc: number;
  /** 被引资料里最可信的那一档。 */
  tier: Tier | null;
}

export interface Trend {
  title: string; strength: string; judge: string; evidence: string; meaning: string;
  src: number[];
  unsourced: boolean;
  xsrc: number;
}

export interface MarketChart {
  title: string; unit: string;
  bars: { label: string; value: number; src: number[]; unsourced: boolean; xsrc: number }[];
  footnote: string;
}

export interface Concentration { title: string; pct: number; label: string; note: string; src: number[]; unsourced: boolean; xsrc: number }

export interface Persona {
  name: string; profile: string; pains: string[]; decision: string; fit: string;
  /** 代码判的：被引资料里找得到画像里的数才是 data，否则一律 inference。 */
  evidenceKind: 'data' | 'inference';
  evidence: string; src: number[];
}

export interface Scenario { name: string; freq: string; heat: 1 | 2 | 3; desc: string; product: string }

export interface Industry {
  topic: string;
  queries: string[];
  failedQueries: { q: string; error: string }[];
  sources: IndustrySource[];
  kpis: Kpi[];
  marketChart: MarketChart | null;
  concentration: Concentration | null;
  personas: Persona[];
  scenarios: Scenario[];
  trends: Trend[];
  /** 超出资料预算被裁掉的检索结果条数。 */
  trimmed: number;
  /** 这一章用的检索词来源：AI 提炼的细分赛道词，还是退回了「所属行业」（附原因）。 */
  keywordNote: string | null;
  /** 用户补的资料 / 排除的链接各几条（界面上说「这一版用了你补的 N 份资料」）。 */
  userMaterials: number;
  excluded: number;
  promptSource: 'skill' | 'default';
}

const STRENGTHS = new Set(['已发生', '进行中', '拐点将至', '加速中', '结构性风险']);
const str = (v: any) => String(v ?? '').trim();

/** 事实卡里的「所属行业」。拿不到就不查 —— 用公司名去搜的话搜回来的是它自己的新闻稿，不是行业。 */
export function topicFrom(card: Pick<FactCard, 'sections'>): string {
  const company = card.sections.find((s) => s.key === 'company');
  const it = company?.items.find((i) => i.field === '所属行业' && i.label !== 'missing' && i.value.trim());
  if (!it) {
    throw new BpError('事实卡里没抽出「所属行业」，不知道该查哪个行业，这一章没跑。BP 里写清所属赛道后重传一次。');
  }
  // 「企业服务 / AI 质检」这类写法只取第一段做检索主词，整串塞进去搜回来的几乎全是无关结果。
  return it.value.split(/[，,、/；;（(]/)[0].trim().slice(0, 30);
}

/**
 * 政策 / 技术 / 趋势三类带 `recent`（只要近一年）：这几类最怕旧闻 —— 两年前的政策目标、三年前的「趋势」
 * 读起来和今年的一样。市场规模 / 画像不带：一份去年发布的研报正是要找的东西。
 */
export function buildQueries(topic: string, now = new Date(), english = ''): Query[] {
  const y = now.getFullYear();
  const qs: Query[] = [
    `${topic} 市场规模 亿元 增速 ${y - 1}`,
    `${topic} 市场空间 渗透率 预测 ${y + 4}`,
    { q: `${topic} 政策 规划 标准 ${y}`, recent: true },
    { q: `${topic} 技术趋势 ${y}`, recent: true },
    `${topic} 用户画像 人群 白皮书`,
    `${topic} 消费场景 需求 痛点`,
    { q: `${topic} 行业趋势 拐点 融资 ${y}`, recent: true },
  ];
  if (english) qs.push(`${english} market size ${y - 1}`);
  return qs;
}

/** 纯函数：模型输出 + 资料原文 → 核验过的这一章。 */
export function buildIndustry(
  parsed: any, contents: Map<number, string>, sources: Source[] = []
): Pick<Industry, 'kpis' | 'marketChart' | 'concentration' | 'personas' | 'scenarios' | 'trends'> {
  const max = contents;
  const xs = (t: string) => corroboration(t, contents, sources);
  const kpis: Kpi[] = (Array.isArray(parsed?.kpis) ? parsed.kpis : [])
    .map((k: any) => {
      const src = srcList(k?.src, max);
      const value = str(k?.value);
      return {
        label: str(k?.label), value, unit: str(k?.unit), delta: str(k?.delta), note: str(k?.note), src,
        unsourced: !numbersBacked(`${value} ${str(k?.delta)}`, src, contents),
        xsrc: xs(value), tier: bestTier(src, sources),
      };
    })
    .filter((k: Kpi) => k.label && k.value);

  const trends: Trend[] = (Array.isArray(parsed?.trends) ? parsed.trends : [])
    .map((t: any) => {
      const src = srcList(t?.src, max);
      const evidence = str(t?.evidence);
      return {
        title: str(t?.title), strength: STRENGTHS.has(t?.strength) ? t.strength : '进行中',
        judge: str(t?.judge), evidence, meaning: str(t?.meaning), src,
        unsourced: !numbersBacked(evidence, src, contents),
        xsrc: xs(evidence),
      };
    })
    .filter((t: Trend) => t.title && t.judge);

  let marketChart: MarketChart | null = null;
  const mc = parsed?.market_chart;
  const bars = (Array.isArray(mc?.bars) ? mc.bars : [])
    .map((b: any) => {
      const value = Number(String(b?.value ?? '').replace(/,/g, ''));
      const src = srcList(b?.src, max);
      return { label: str(b?.label), value, src, unsourced: !numbersBacked(String(b?.value ?? ''), src, contents), xsrc: xs(String(b?.value ?? '')) };
    })
    .filter((b: { label: string; value: number }) => b.label && Number.isFinite(b.value) && b.value > 0)
    .slice(0, 6);
  // 少于 2 根不画：一根柱子没有比较对象，画出来只是一块色块。
  if (bars.length >= 2) marketChart = { title: str(mc?.title), unit: str(mc?.unit), bars, footnote: str(mc?.footnote) };

  let concentration: Concentration | null = null;
  const cc = parsed?.concentration;
  const pct = Number(cc?.pct);
  if (cc && Number.isFinite(pct) && pct > 0 && pct <= 100) {
    const src = srcList(cc?.src, max);
    concentration = {
      title: str(cc?.title) || '行业集中度', pct, label: str(cc?.label), note: str(cc?.note), src,
      unsourced: !numbersBacked(String(cc?.pct), src, contents),
      xsrc: xs(String(cc?.pct)),
    };
  }

  const personas: Persona[] = (Array.isArray(parsed?.personas) ? parsed.personas : [])
    .map((p: any) => {
      const src = srcList(p?.src, max);
      const evidence = str(p?.evidence);
      // 模型说「数据支撑」不算数：引的资料里得真有画像里的那几个数，而且至少有一个数。
      const backed = src.length > 0 && /\d/.test(`${str(p?.profile)}${evidence}`)
        && numbersBacked(`${str(p?.profile)} ${evidence}`, src, contents);
      return {
        name: str(p?.name), profile: str(p?.profile),
        pains: (Array.isArray(p?.pains) ? p.pains : []).map(str).filter(Boolean).slice(0, 4),
        decision: str(p?.decision), fit: str(p?.fit),
        evidenceKind: backed ? 'data' : 'inference', evidence, src,
      } as Persona;
    })
    .filter((p: Persona) => p.name)
    .slice(0, 4);

  const scenarios: Scenario[] = (Array.isArray(parsed?.scenarios) ? parsed.scenarios : [])
    .map((s: any) => ({
      name: str(s?.name), freq: str(s?.freq),
      heat: (Math.min(3, Math.max(1, Math.round(Number(s?.heat) || 1))) as 1 | 2 | 3),
      desc: str(s?.desc), product: str(s?.product),
    }))
    .filter((s: Scenario) => s.name)
    .slice(0, 6);

  return { kpis, marketChart, concentration, personas, scenarios, trends };
}

function briefOf(card: FactCard) {
  return card.sections
    .filter((s) => s.key === 'company' || s.key === 'product')
    .flatMap((s) => s.items.filter((i) => i.label !== 'missing').map((i) => `- ${i.field}：${i.value}`))
    .join('\n');
}

export async function runIndustry(input: {
  card: FactCard; keywords?: Keywords; materials?: { exclude: Set<string>; extra: ExtraSource[] };
  filename: string; userId: string;
}): Promise<Industry> {
  const topic = segmentOf(input.card, input.keywords);
  const kw = input.keywords;
  const g = await gatherSources(buildQueries(topic, new Date(), kw?.english || ''), {
    chapter: '行业分析', focus: [topic, ...(kw?.products || [])],
    exclude: input.materials?.exclude, extra: input.materials?.extra,
  });
  const method = bpMethod(INDUSTRY_SLOT, INDUSTRY_METHOD);

  const system = `${method.text}

---
## 输出（系统规定，必须遵守）
- 每条带 src 的内容写它依据的检索资料**编号**（如 [2,5]），不要写链接、不要写来源名。
- 所有数字（kpi 的 value/delta、柱图的 value、集中度的 pct、趋势 evidence、画像里的数）都必须在被引资料原文里出现过 —— 系统会逐个核对，核不上的会标成「出处里没有这个数」；系统还会数这个数在几个不同来源里出现过。
- market_chart：同一口径、能比较的 2-5 根柱子（如不同年份的市场规模），value 只写数字。资料里凑不出同口径的一组就给 null。footnote 写口径和冲突。
- concentration：CR3/CR5/渗透率/占比任选一个最能说明格局的百分比，pct 只写数字（0-100）。没有就给 null。
- personas（3-4 个）：evidence 写支撑这个画像的数据；资料里没有就照实写「推断：…」，不要写成事实。
- scenarios（4-6 个）：heat 是痛点强度 1-3。
- 资料不够的部分就少写或给空，不要凑。

只输出 JSON：
{"kpis":[{"label":"","value":"","unit":"","delta":"","note":"","src":[1]}],
 "market_chart":{"title":"","unit":"","bars":[{"label":"","value":0,"src":[1]}],"footnote":""},
 "concentration":{"title":"","pct":0,"label":"","note":"","src":[1]},
 "personas":[{"name":"","profile":"","pains":[""],"decision":"","fit":"","evidence":"","src":[1]}],
 "scenarios":[{"name":"","freq":"","heat":1,"desc":"","product":""}],
 "trends":[{"title":"","strength":"","judge":"","evidence":"","meaning":"","src":[1]}]}`;

  const parsed = await bpJson({
    system,
    user: `## 这家公司（来自 BP 事实卡）\n细分赛道：${topic}\n${briefOf(input.card)}\n\n${DOCS_RULES}\n\n## 检索资料（编号即 src）\n${g.docs}`,
    userId: input.userId, operation: 'industry', label: '行业分析', filename: input.filename, maxTokens: MAX_TOKENS,
  });
  const built = buildIndustry(parsed, g.contents, g.sources);
  if (!built.kpis.length && !built.trends.length) {
    throw new BpError('行业分析：模型返回了 JSON，但一条数字、一条趋势都没给（这次的 AI 额度已经扣了）。再试一次或换个模型。', 502);
  }
  return {
    topic, queries: g.queries, failedQueries: g.failedQueries, sources: g.sources, ...built,
    trimmed: g.trimmed,
    keywordNote: kw?.fallback ? `检索词退回用了事实卡的「所属行业」：${kw.fallback}。这一版搜的是更粗的行业词，数字可能偏大、偏泛。` : null,
    userMaterials: input.materials?.extra.length || 0, excluded: input.materials?.exclude.size || 0,
    promptSource: method.origin,
  };
}
