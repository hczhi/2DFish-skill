import { BpError, type FactCard } from './factCardService.js';
import { gatherSources, nameBacked, srcList, DOCS_RULES, type Source, type Query, type ExtraSource } from './sources.js';
import { segmentOf, type Keywords } from './keywordsService.js';
import { bpJson } from './llm.js';
import { bpMethod, INVESTORS_SLOT, INVESTORS_METHOD } from './prompts.js';
import { contextText, type ReportSoFar } from './context.js';
import type { Competitors } from './competitorService.js';

// 09 目标融资对象。这一章最危险的失败是**一个编出来的合伙人名字**：「XX 资本 · 对口合伙人 张三」
// 读起来是做过功课的，创业者会拿着这个名字去托人、去写冷邮件，而那个人可能根本不在那家机构。
// 所以（硬规则 3）：
//   ① 机构名必须在它引的资料里出现，否则整家丢掉；
//   ② 合伙人名字也必须在被引资料里出现，否则清空、标「待核实」并把模型给的那个名字说出来
//      （`partnerRejected`）—— 不说的话「资料里没有」和「模型没给」都是一个「待核实」；
//   ③ confidence 由代码按①②定，不收模型的；
//   ④ 「已投同类」那一圈的候选来自 07 章核验过的竞品投资方，不让模型自己想。

const MAX_CANDIDATE_LOOKUPS = 5;

export type Confidence = '已公开' | '部分公开';

export interface TargetInvestor {
  name: string; type: string; circle: '已投同类' | '国家队 / 产业资本' | '其他';
  deal: string; partner: string; partnerRejected: string; role: string;
  fit: string; why: string; approach: string;
  confidence: Confidence;
  src: number[];
}

export interface Investors {
  queries: string[];
  failedQueries: { q: string; error: string }[];
  sources: Source[];
  investors: TargetInvestor[];
  approachNote: string;
  dropped: string[];
  trimmed: number;
  userMaterials: number;
  excluded: number;
  promptSource: 'skill' | 'default';
}

const str = (v: any) => String(v ?? '').trim();
const CIRCLES = new Set(['已投同类', '国家队 / 产业资本']);

/** 07 章核验过的竞品投资方（按出现次数排，投了多家竞品的排前面）。 */
export function candidatesFrom(comp?: Pick<Competitors, 'competitors'>): string[] {
  const count = new Map<string, number>();
  for (const c of comp?.competitors || []) for (const r of c.rounds) for (const i of r.investors) count.set(i, (count.get(i) || 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n);
}

/** 纯函数：模型输出 → 核验过的机构清单。 */
export function buildInvestors(parsed: any, contents: Map<number, string>) {
  const dropped: string[] = [];
  const investors: TargetInvestor[] = [];
  for (const r of Array.isArray(parsed?.investors) ? parsed.investors : []) {
    const name = str(r?.name);
    if (!name) continue;
    const src = srcList(r?.src, contents);
    if (!nameBacked(name, src, contents)) { dropped.push(name); continue; }
    const rawPartner = str(r?.partner).replace(/^(待核实|未知|暂无|无)$/, '');
    const partnerOk = !!rawPartner && nameBacked(rawPartner, src, contents);
    investors.push({
      name, type: str(r?.type), circle: CIRCLES.has(str(r?.circle)) ? (str(r?.circle) as TargetInvestor['circle']) : '其他',
      deal: str(r?.deal), partner: partnerOk ? rawPartner : '', partnerRejected: rawPartner && !partnerOk ? rawPartner : '',
      role: partnerOk ? str(r?.role) : '', fit: str(r?.fit), why: str(r?.why), approach: str(r?.approach),
      confidence: partnerOk ? '已公开' : '部分公开', src,
    });
  }
  const order = { 已投同类: 0, '国家队 / 产业资本': 1, 其他: 2 };
  investors.sort((a, b) => order[a.circle] - order[b.circle]);
  return { investors, dropped, approachNote: str(parsed?.approach_note) };
}

export async function runInvestors(input: {
  report: ReportSoFar; card: FactCard; keywords?: Keywords; materials?: { exclude: Set<string>; extra: ExtraSource[] };
  filename: string; userId: string;
}): Promise<Investors> {
  const topic = segmentOf(input.card, input.keywords);
  const y = new Date().getFullYear();
  const candidates = candidatesFrom(input.report.competitors as Competitors | undefined);
  // 赛道级的出资动态带 recent：两年前投过、现在已经转向的机构，排在名单上是一句合理的假话。
  // 逐家机构那几条不带：要的是它在这个赛道的完整出资记录和对口人。
  const queries: Query[] = [
    { q: `${topic} 投资机构 领投 ${y}`, recent: true },
    { q: `${topic} 融资 投资方`, recent: true },
    `${topic} 产业基金 国资 投资`,
    ...candidates.slice(0, MAX_CANDIDATE_LOOKUPS).map((c) => `${c} 投资 ${topic} 合伙人`),
  ];
  const g = await gatherSources(queries, {
    chapter: '目标融资对象', focus: [topic, ...candidates, '领投', '合伙人', '投资'],
    exclude: input.materials?.exclude, extra: input.materials?.extra,
  });
  const method = bpMethod(INVESTORS_SLOT, INVESTORS_METHOD);

  const parsed = await bpJson({
    system: `${method.text}

---
## 输出（系统规定，必须遵守）
- src 写依据的检索资料**编号**，不写链接。机构名和合伙人姓名都必须是被引资料里出现的写法 —— 系统会去原文里找，机构找不到整家丢掉，合伙人找不到会被清空并标「待核实」。
- circle 只能是：已投同类 / 国家队 / 产业资本。
- partner 资料里没有就留空字符串，不要写「待核实」「某合伙人」。
- 6-10 家，资料不够就少写。

只输出 JSON：
{"investors":[{"name":"","type":"","circle":"","deal":"","partner":"","role":"","fit":"","why":"","approach":"","src":[1]}],"approach_note":""}`,
    user: `${contextText(input.report, 'competitors')}\n\n## 投过竞品的机构（来自 07 章，已核验）\n${candidates.length ? candidates.map((c) => `- ${c}`).join('\n') : '- 07 章没查到竞品的投资方'}\n\n${DOCS_RULES}\n\n## 检索资料（编号即 src）\n${g.docs}`,
    userId: input.userId, operation: 'investors', label: '目标融资对象', filename: input.filename,
  });
  const built = buildInvestors(parsed, g.contents);
  if (!built.investors.length) {
    throw new BpError(
      `目标融资对象：模型给的机构${built.dropped.length ? `（${built.dropped.join('、')}）在检索资料里一家都找不到` : '一家都没有'}，这一章没出（这次的 AI 额度已经扣了）。`,
      502
    );
  }
  return {
    queries: g.queries, failedQueries: g.failedQueries, sources: g.sources, ...built,
    trimmed: g.trimmed, userMaterials: input.materials?.extra.length || 0, excluded: input.materials?.exclude.size || 0,
    promptSource: method.origin,
  };
}
