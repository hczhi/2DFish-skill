import { jsonGateway, jsonFailMessage } from '../../core/llm/parseJson.js';
import { SAMPLING } from '../../core/llm/gateway.js';
import { BpError } from './factCardService.js';
import { splitPages, locateAt, norm, whereText } from './quotes.js';
import { bpMethod, REVENUE_SLOT, REVENUE_METHOD } from './prompts.js';
import { SECTORS, SECTOR_INPUTS, sectorMetrics, type Sector } from './standards.js';

// 5.12 收入质量体检。最危险的失败是**一个有公式、读起来很专业的错数字**：「年化 160 万、
// 现金跑道 9 个月（风险）」—— 而 160 万是模型把合同额当收入、或者 1.2 亿换算成 1200 万算出来的。
// 所以分工是死的（硬规则 3）：
//   ① 模型只摘**原始数字**：原文写法 `raw`（「200万元」）+ 一段原文 `quote`；
//   ② 代码核 quote 在 BP 里、`raw` 在 quote 里，单位换算由代码按 `raw` 自己做（`parseAmount`）；
//      核不上的那个数当没有，不参与任何计算；
//   ③ 引文里带「预计 / 目标 / 规划」的是预测数，同样当没有（拿预测数算出来的跑道是一句合理的假话）；
//   ④ 每个比率、阈值、状态、缺口清单都在 `buildRevenue` 里按公式算，没有公式的数字不出现。

const MAX_TOKENS = 12_000;
const AI_TIMEOUT_MS = 180_000;

/** 模型要找的原始数字。key 是代码里的名字，label/unit 进 prompt。 */
export const INPUTS = [
  { key: 'annualRevenue', label: '最近一个完整年度的收入（实际数）', unit: 'amount' },
  { key: 'revenueYear', label: '上面那个收入是哪一年', unit: 'text' },
  { key: 'cumulativeRevenue', label: '成立以来 / 截至某时的累计收入', unit: 'amount' },
  { key: 'cumulativeMonths', label: '累计收入覆盖了多少个月（BP 写了起止时间才填，raw 写原文里的时间段）', unit: 'months' },
  { key: 'customers', label: '付费客户数', unit: 'count' },
  { key: 'grossMargin', label: '毛利率', unit: 'percent' },
  { key: 'directCost', label: '与上面年度收入同口径的直接成本 / 营业成本', unit: 'amount' },
  { key: 'renewalRate', label: '续约率 / 复购率 / NDR', unit: 'percent' },
  { key: 'top1Share', label: '第一大客户收入占比', unit: 'percent' },
  { key: 'top1Revenue', label: '第一大客户收入金额', unit: 'amount' },
  { key: 'top3Share', label: '前三大客户收入合计占比', unit: 'percent' },
  { key: 'recurringShare', label: '经常性收入（订阅 / 年费 / 续费）占比', unit: 'percent' },
  { key: 'fundingAmount', label: '本轮拟融资金额', unit: 'amount' },
  { key: 'monthlyBurn', label: '月均净烧钱（月均净亏损 / 月均支出）', unit: 'amount' },
  { key: 'netNewArr', label: '最近一年净新增 ARR', unit: 'amount' },
] as const;

type InputKey = (typeof INPUTS)[number]['key'];

export interface RevenueInput {
  /** 通用指标是 InputKey；行业专属指标的键在 standards.SECTOR_INPUTS 里。 */
  key: string;
  label: string;
  /** 换算后的值：金额一律万元、百分比 0-100、月数、个数。 */
  value: number | null;
  raw: string;
  quote: string;
  page: number | null;
  doc: string | null;
  /** 有值但没被采用的原因（原文对不上 / 是预测数）。 */
  rejected: string | null;
}

export type MetricStatus = 'good' | 'watch' | 'risk';

export interface RevenueMetric {
  name: string;
  /** 「约 160 万元」/「未披露」/「不可计算」 */
  value: string;
  /** 公式 + 用到的数 + 假设；未披露时写缺什么。 */
  basis: string;
  status: MetricStatus | null;
  flag: string;
  /** 'sector' = 行业专属指标（standards.sectorMetrics）；缺省是通用指标。 */
  group?: 'sector';
}

export interface Revenue {
  verdict: string;
  metrics: RevenueMetric[];
  gaps: { item: string; why: string; ask: string }[];
  inputs: RevenueInput[];
  /** 这次用的行业模板（事实卡 + 检索词判出来的；认不出是 general，只有通用指标）。 */
  sector?: Sector;
  sectorLabel?: string;
  promptSource: 'skill' | 'default';
}

type InputDef = { key: string; label: string; unit: string };

const FORECAST_RE = /预计|预测|目标|规划|计划|将达|有望|\d{4}E/;

/** 「1.2亿元」→ 12000（万元）；「200万」→ 200；「3,500,000元」→ 350。认不出单位返回 null。 */
export function parseAmount(raw: string): number | null {
  const s = raw.replace(/[,，\s]/g, '');
  const m = s.match(/(-?\d+(?:\.\d+)?)(千万|百万|亿|万|千|元)?/);
  if (!m) return null;
  const n = Number(m[1]);
  switch (m[2]) {
    case '亿': return n * 10000;
    case '千万': return n * 1000;
    case '百万': return n * 100;
    case '万': return n;
    case '千': return n / 10;
    case '元': return n / 10000;
    default: return null; // 没写单位的金额不猜（200 是元还是万元差一万倍）
  }
}

function parseNumber(raw: string, unit: string): number | null {
  if (unit === 'amount') return parseAmount(raw);
  const s = raw.replace(/[,，\s]/g, '');
  if (unit === 'percent') {
    const m = s.match(/(\d+(?:\.\d+)?)[%％]/);
    return m ? Number(m[1]) : null;
  }
  if (unit === 'months') {
    const mo = s.match(/(\d+(?:\.\d+)?)个月/);
    return mo ? Number(mo[1]) : null;
  }
  const m = s.match(/(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : null;
}

/** 「2023年3月至2024年6月」→ 15（两个年月之差）。不足两个年月返回 null。 */
export function monthsBetween(quote: string): number | null {
  const ds = [...quote.replace(/\s/g, '').matchAll(/(\d{4})年(\d{1,2})月/g)].map((m) => Number(m[1]) * 12 + Number(m[2]));
  if (ds.length < 2) return null;
  const span = ds[ds.length - 1] - ds[0];
  return span > 0 ? span : null;
}

/** 核验并换算模型摘出来的原始数字。 */
export function verifyInputs(parsed: any, text: string, defs: readonly InputDef[] = INPUTS): RevenueInput[] {
  const pages = splitPages(text);
  return defs.map((def) => {
    const r = parsed?.inputs?.[def.key] || {};
    const raw = String(r?.raw ?? '').trim();
    const quote = String(r?.quote ?? '').trim().replace(/^[「“"]|[」”"]$/g, '');
    const base = { key: def.key, label: def.label, raw, quote, page: null, doc: null, value: null, rejected: null } as RevenueInput;
    if (!raw) return base;
    const at = locateAt(quote, pages);
    if (at === undefined) return { ...base, rejected: '模型给的原文在 BP 里找不到' };
    base.page = at.page;
    base.doc = at.doc;
    // 月数：原文直接写了「N 个月」就用它；否则由代码从引文里的两个「YYYY年M月」算间隔，
    // 不用模型算的（它会把「2023年」读成 2023×12，或者把起止月份差一个月）。
    if (def.unit === 'months') {
      const direct = norm(quote).includes(norm(raw)) ? parseNumber(raw, 'months') : null;
      const span = direct ?? monthsBetween(quote);
      if (span === null) return { ...base, rejected: '原文里没有写明「N 个月」或起止年月，算不出覆盖了几个月' };
      return { ...base, value: span, raw: direct !== null ? raw : `${span}个月（${raw}）` };
    }
    if (!norm(quote).includes(norm(raw))) {
      return { ...base, rejected: `数字「${raw}」不在它引的那段原文里` };
    }
    if (FORECAST_RE.test(quote) && def.key !== 'fundingAmount') {
      return { ...base, rejected: '这段原文是预测数，不是实际发生的' };
    }
    if (def.unit === 'text') return { ...base, value: 0 };
    const value = parseNumber(raw, def.unit);
    if (value === null) return { ...base, rejected: `认不出「${raw}」的单位` };
    return { ...base, value };
  });
}

const fmtWan = (n: number) => (n >= 10000 ? `${+(n / 10000).toFixed(2)} 亿元` : `${+n.toFixed(1)} 万元`);
const fmtPct = (n: number) => `${+n.toFixed(1)}%`;

/** 结论句由代码按状态计数生成（通用 + 行业专属一起数）。 */
export function verdictOf(metrics: RevenueMetric[], gaps: { item: string }[]): string {
  const n = (s: MetricStatus) => metrics.filter((m) => m.status === s).length;
  return `算出 ${metrics.length - gaps.length} 项指标：${n('risk')} 项风险、${n('watch')} 项需观察；`
    + `${gaps.length} 项 BP 没给数据、算不出来${gaps.length >= 4 ? ' —— 缺口比数字更说明问题，投资人会先追问这几项' : ''}。`;
}

/** 通用部分算出来、行业指标要复用的三个数：年度 / 年化收入、客户数、毛利率。规则同 buildRevenue。 */
export function basicsOf(inputs: RevenueInput[]): { annual: number | null; customers: number | null; grossMargin: number | null } {
  const v = (k: string) => inputs.find((i) => i.key === k)?.value ?? null;
  const annual = v('annualRevenue') ?? (v('cumulativeRevenue') !== null && v('cumulativeMonths') ? (v('cumulativeRevenue')! / v('cumulativeMonths')!) * 12 : null);
  const gm = v('grossMargin') ?? (v('annualRevenue') !== null && v('directCost') !== null ? ((v('annualRevenue')! - v('directCost')!) / v('annualRevenue')!) * 100 : null);
  return { annual, customers: v('customers'), grossMargin: gm };
}

/** 纯函数：核验过的输入 → 指标 + 缺口。阈值写死在这里，模型不参与判档。 */
export function buildRevenue(inputs: RevenueInput[]): Omit<Revenue, 'promptSource'> {
  const v = (k: string) => inputs.find((i) => i.key === k)?.value ?? null;
  const src = (k: string) => {
    const i = inputs.find((x) => x.key === k)!;
    const w = whereText(i);
    return `「${i.raw}」${w ? `（${w}）` : ''}`;
  };
  const metrics: RevenueMetric[] = [];
  const gaps: Revenue['gaps'] = [];
  const missing = (name: string, basis: string, why: string, ask: string, value = '未披露') => {
    metrics.push({ name, value, basis, status: null, flag: '' });
    gaps.push({ item: name, why, ask });
  };

  // 1. 年化收入
  let annual: number | null = null;
  const yearText = inputs.find((i) => i.key === 'revenueYear' && i.value !== null)?.raw;
  if (v('annualRevenue') !== null) {
    annual = v('annualRevenue')!;
    metrics.push({
      name: '年度收入', value: fmtWan(annual),
      basis: `BP 披露${yearText ? ` ${yearText}` : ''}收入 ${src('annualRevenue')}`, status: null, flag: '',
    });
  } else if (v('cumulativeRevenue') !== null && v('cumulativeMonths')) {
    annual = (v('cumulativeRevenue')! / v('cumulativeMonths')!) * 12;
    metrics.push({
      name: '年化收入（推算）', value: `约 ${fmtWan(annual)}`,
      basis: `累计 ${src('cumulativeRevenue')} ÷ ${v('cumulativeMonths')} 个月 × 12（假设收入在这段时间里均匀发生）`,
      status: 'watch', flag: 'BP 只给了累计数，若收入集中在后几个月，真实年化会更高；若集中在前期则在下滑',
    });
  } else if (v('cumulativeRevenue') !== null) {
    missing('年化收入', `只有累计收入 ${src('cumulativeRevenue')}，没有覆盖月数，无法年化`,
      '累计数不能直接当年收入用，估值倍数会差几倍', '分月或分年度的收入明细', '不可计算');
  } else {
    missing('年度收入', 'BP 里没有找到实际收入数', '没有收入就没有估值倍数、单客价值、集中度的分母', '近两年分年度收入（审计或开票口径）');
  }

  // 2. 单客户收入
  if (annual !== null && v('customers')) {
    metrics.push({
      name: '单客户年收入', value: `约 ${fmtWan(annual / v('customers')!)}`,
      basis: `${fmtWan(annual)} ÷ 付费客户 ${src('customers')}`, status: null,
      flag: '和 BP 里案例的合同单价对照：差太多说明客户数或收入口径有一个不对',
    });
  } else {
    missing('单客户年收入', v('customers') ? '没有可用的年度收入' : 'BP 没写付费客户数',
      '判断是少数大单撑起来的还是可复制的标准化销售', '付费客户数（与收入同口径）及客户名单');
  }

  // 3. 毛利率
  let gm: number | null = null, gmBasis = '';
  if (v('grossMargin') !== null) { gm = v('grossMargin')!; gmBasis = `BP 披露 ${src('grossMargin')}`; }
  else if (annual !== null && v('directCost') !== null && v('annualRevenue') !== null) {
    gm = ((annual - v('directCost')!) / annual) * 100;
    gmBasis = `（收入 ${fmtWan(annual)} − 直接成本 ${src('directCost')}）÷ 收入`;
  }
  if (gm !== null) {
    metrics.push({
      name: '毛利率', value: fmtPct(gm), basis: gmBasis,
      status: gm < 30 ? 'watch' : null, flag: gm < 30 ? '低于 30%，项目制 / 人力驻场的典型水平，需解释怎么提升' : '',
    });
  } else {
    missing('毛利率', 'BP 没有成本口径', '分不清是产品公司还是人力外包', '近一年收入成本明细（直接人工、外采、交付成本）');
  }

  // 4. 续约 / NDR
  if (v('renewalRate') !== null) {
    const r = v('renewalRate')!;
    metrics.push({
      name: '续约 / 复购率', value: fmtPct(r), basis: `BP 披露 ${src('renewalRate')}`,
      status: r >= 100 ? 'good' : 'watch', flag: r >= 100 ? '老客户在加购' : '低于 100%：老客户收入在缩，增长全靠新客',
    });
  } else {
    missing('续约 / 复购率', 'BP 没有二期合同、续费记录', '判断收入能不能留住、是不是一次性项目', '老客户续约 / 二期合同清单');
  }

  // 5. 客户集中度
  let top1 = v('top1Share');
  let top1Basis = top1 !== null ? `BP 披露 ${src('top1Share')}` : '';
  if (top1 === null && v('top1Revenue') !== null && annual !== null && v('annualRevenue') !== null) {
    top1 = (v('top1Revenue')! / annual) * 100;
    top1Basis = `第一大客户 ${src('top1Revenue')} ÷ 年度收入 ${fmtWan(annual)}`;
  }
  if (top1 !== null) {
    metrics.push({
      name: '第一大客户占比', value: fmtPct(top1), basis: top1Basis,
      status: top1 >= 50 ? 'risk' : 'good', flag: top1 >= 50 ? '≥50%：丢一个客户收入腰斩' : '',
    });
  }
  if (v('top3Share') !== null) {
    const t3 = v('top3Share')!;
    metrics.push({
      name: '前三大客户占比', value: fmtPct(t3), basis: `BP 披露 ${src('top3Share')}`,
      status: t3 >= 80 ? 'risk' : 'good', flag: t3 >= 80 ? '≥80%：收入高度依赖少数客户' : '',
    });
  }
  if (top1 === null && v('top3Share') === null) {
    missing('客户集中度', 'BP 没列前几大客户的金额或占比', '集中度高的收入随时可能断', '前五大客户收入及占比');
  }

  // 6. 经常性收入
  if (v('recurringShare') !== null) {
    const r = v('recurringShare')!;
    metrics.push({
      name: '经常性收入占比', value: fmtPct(r), basis: `BP 披露 ${src('recurringShare')}`,
      status: r >= 70 ? 'good' : r < 40 ? 'risk' : 'watch',
      flag: r >= 70 ? '' : r < 40 ? '<40%：大部分收入每年要重新卖一遍' : '40-70%：一半靠复购、一半靠新单',
    });
  } else {
    missing('经常性收入占比', 'BP 没有拆分订阅 / 项目收入', '一次性项目收入和订阅收入的估值倍数差很多', '按收入类型拆分的收入结构');
  }

  // 7. 现金跑道
  if (v('fundingAmount') !== null && v('monthlyBurn')) {
    const m = v('fundingAmount')! / v('monthlyBurn')!;
    metrics.push({
      name: '现金跑道', value: `约 ${+m.toFixed(1)} 个月`,
      basis: `本轮融资 ${src('fundingAmount')} ÷ 月均净烧 ${src('monthlyBurn')}（未计账上现有现金）`,
      status: m < 12 ? 'risk' : m < 18 ? 'watch' : 'good',
      flag: m < 12 ? '<12 个月：这轮钱花完前大概率要再融' : m < 18 ? '12-18 个月：留给下一轮的时间偏紧' : '',
    });
  } else {
    missing('现金跑道', v('fundingAmount') === null ? 'BP 没写本轮融资额' : 'BP 没写月度支出 / 亏损',
      '判断这轮钱能撑多久、下一轮什么时候要融', '近 6 个月月度现金流 + 账上现金');
  }

  // 8. burn multiple
  if (v('monthlyBurn') && v('netNewArr')) {
    const bm = (v('monthlyBurn')! * 12) / v('netNewArr')!;
    metrics.push({
      name: 'burn multiple', value: `${+bm.toFixed(2)}`,
      basis: `年净烧 ${src('monthlyBurn')} × 12 ÷ 净新增 ARR ${src('netNewArr')}`,
      status: bm > 2 ? 'risk' : bm <= 1 ? 'good' : 'watch',
      flag: bm > 2 ? '>2：每新增 1 块 ARR 要烧 2 块以上' : '',
    });
  } else {
    missing('burn multiple', v('netNewArr') ? 'BP 没写月度支出' : 'BP 没有 ARR 口径',
      '衡量烧钱换增长的效率', '月度 ARR 变化表 + 月度净亏损', '不可计算');
  }

  return { verdict: verdictOf(metrics, gaps), metrics, gaps, inputs };
}

function buildMessages(method: string, text: string, defs: readonly InputDef[]) {
  const spec = defs.map((i) => `- ${i.key}：${i.label}`).join('\n');
  const system = `${method}

---
## 输出（系统规定，必须遵守）
要找的数字（找不到的整项省略）：
${spec}

每项给：
- raw：数字在原文里的**原样写法，带单位**（如「200万元」「1.2亿」「35%」「15个月」），不换算、不改写。
- quote：包含这个数字的一段**逐字照抄**的原文（10-60 字，不改写、不拼接）。

只输出 JSON：
{"inputs":{"annualRevenue":{"raw":"","quote":""}}}`;
  return [
    { role: 'system', content: system },
    { role: 'user', content: `以下是 BP 全文（「--- 第 N 页 ---」是分页标记）。如果后面有「===== 附件K《…》 =====」，那是用户和 BP 一起提供的补充材料（「--- 附件K 第 N 页 ---」是附件的分页），不是 BP 本身；标「图片识别」的附件是模型从图片转写的文字。引用原文时附件里的句子同样要逐字照抄：\n\n${text}` },
  ];
}

export async function runRevenue(input: { text: string; filename: string; userId: string; sector?: Sector }): Promise<Revenue> {
  const method = bpMethod(REVENUE_SLOT, REVENUE_METHOD);
  const sector: Sector = input.sector || 'general';
  // 行业专属的原始数字和通用的一起摘（一次调用）；键名不会撞（SECTOR_INPUTS 里的 cac 两个行业各用一份）。
  const defs: InputDef[] = [...INPUTS, ...SECTOR_INPUTS[sector]];
  const { parsed, raw, finish, reasoningTokens, noThinkingRequested } = await jsonGateway<any>(
    () => ({
      messages: buildMessages(method.text, input.text, defs),
      ...SAMPLING.analytic,
      max_tokens: MAX_TOKENS,
      response_format: { type: 'json_object' },
    }),
    {
      userId: input.userId,
      source: 'bp',
      operation: 'revenue',
      tier: 'strong',
      timeoutMs: AI_TIMEOUT_MS,
      maxRetries: 0,
      retryOnBusy: true,
      noThinking: true,
      requestSummary: `${input.filename} · 收入质量`,
    },
    { attempts: 1 }
  );
  if (!parsed) {
    throw new BpError(
      jsonFailMessage('收入质量体检', { raw, finish, reasoningTokens, budget: MAX_TOKENS, noThinkingRequested }),
      502
    );
  }
  const inputs = verifyInputs(parsed, input.text, defs);
  const general = buildRevenue(inputs.filter((i) => (INPUTS as readonly InputDef[]).some((d) => d.key === i.key)));
  const b = basicsOf(inputs);
  const sec = sectorMetrics(sector, inputs, b.annual, b.customers, b.grossMargin);
  const metrics = [...general.metrics, ...sec.metrics];
  const gaps = [...general.gaps, ...sec.gaps];
  return {
    verdict: verdictOf(metrics, gaps), metrics, gaps, inputs,
    sector, sectorLabel: SECTORS[sector], promptSource: method.origin,
  };
}
