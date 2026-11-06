import type { FactCard } from './factCardService.js';
import { bpJson } from './llm.js';
import { bpMethod, FINANCING_SLOT, FINANCING_METHOD } from './prompts.js';
import { parseAmount, basicsOf, type Revenue } from './revenueService.js';
import { stageOf, STAGES, SECTORS, type Sector, type Stage } from './standards.js';
import { benchmarkFor, type Threshold } from './benchmarks.js';
import { contextText, type ReportSoFar } from './context.js';
import type { Credit } from './creditService.js';

// 09 融资方案。这一章最危险的失败是**一个看起来很专业的错数字**：「建议投前估值 1.2 亿、出让 15%」——
// 模型现编一个估值，创业者会拿着它去谈，而那个数既没有可比交易也没有算法。所以（硬规则 3）：
//   ① 融资额区间、跑道、隐含估值、门槛差距、股权集中度**全部由 `computeFinancing` 按公式算**，用的是 5.12 核过原文的数字；
//   ② 估值参考区间、出让比例、下一轮门槛来自「平台参考口径」表（benchmarks.ts，后台可校准），报告上标明；
//      BP 没写轮次时不给参考区间（不知道在融哪一轮就没有可比的区间）；
//   ③ 模型只写建议文字，其中出现的数字必须是系统算出来的那些，否则 `numbersOutside` 列出来、界面上提示。

export const RUNWAY_MONTHS: [number, number] = [18, 24];

export interface Milestone {
  label: string; target: string; current: string;
  status: 'met' | 'gap' | 'unknown';
  gap: string;
}

export interface Financing {
  stage: Stage; stageLabel: string; stageBasis: string; sector: Sector; sectorLabel: string;
  ask: { value: number | null; basis: string };
  burn: { value: number | null; basis: string };
  runwayMonths: number | null;
  suggestedAsk: [number, number] | null;
  askVerdict: 'low' | 'ok' | 'high' | 'unknown';
  askNote: string;
  reference: { valuation: [number, number]; dilution: [number, number]; nextRound: string; edited: boolean } | null;
  impliedPre: [number, number] | null;
  disclosedValuation: { value: number | null; raw: string };
  valuationVerdict: 'below' | 'within' | 'above' | 'unknown';
  valuationNote: string;
  milestones: Milestone[];
  equity: {
    found: boolean; holders: { name: string; pct: number }[]; topPct: number | null;
    hasPlatform: boolean; flags: { level: 'risk' | 'watch' | 'ok'; text: string }[];
  };
  terms: { name: string; what: string; bottom: string }[];
  advice: { summary: string; ask: string; valuation: string; milestones: string; equity: string; sequencing: string };
  numbersOutside: string[];
  promptSource: 'skill' | 'default';
}

const fmtWan = (n: number) => (n >= 10000 ? `${+(n / 10000).toFixed(2)} 亿元` : `${+n.toFixed(0)} 万元`);
const str = (v: any) => String(v ?? '').trim();

/** 条款预警：按阶段挑最相关的几条（常见口径，写死在这里；不同阶段关注点不同）。 */
const TERMS: Record<string, { name: string; what: string; bottom: string; stages: Stage[] }> = {
  liquidation: { name: '优先清算权', what: '公司被出售 / 清算时投资人先拿回钱。', bottom: '早期常见口径是 1 倍、不参与分配（non-participating）；2 倍以上或「参与分配」要谈。', stages: ['angel', 'preA', 'A', 'B', 'general'] },
  antiDilution: { name: '反稀释', what: '下一轮估值比这轮低时，给这轮投资人补股份。', bottom: '常见是「广义加权平均」；「完全棘轮」对创始人非常不利，尽量拒绝。', stages: ['preA', 'A', 'B', 'general'] },
  buyback: { name: '回购 / 对赌', what: '没达成约定的业绩或上市时间，创始人或公司要按约定价格回购股份。', bottom: '尽量不让创始人个人承担无限连带责任；业绩指标要和这轮钱能换来的里程碑一致，留出缓冲期。', stages: ['preA', 'A', 'B', 'general'] },
  veto: { name: '一票否决', what: '重大事项（融资、出售、预算）需要投资人同意。', bottom: '范围限定在真正的重大事项；日常经营不应纳入。', stages: ['A', 'B', 'general'] },
  vesting: { name: '创始人股份成熟（Vesting）', what: '创始人的股份按年限逐步「成熟」，提前离开会被回购一部分。', bottom: '常见 4 年成熟、1 年悬崖；已经干了多年的可以要求按已服务年限部分预先成熟。', stages: ['angel', 'preA', 'general'] },
  esop: { name: '期权池', what: '投资人通常要求在本轮前预留员工期权池（会稀释的是你，不是他们）。', bottom: '常见 10–15%；要算清楚是「投前」还是「投后」预留，差别是你的股份。', stages: ['angel', 'preA', 'A', 'general'] },
};

/** 从信用档案「主要股东 / 实控人」那一栏解析股东与比例（文本，形如「张三 92.59%；XX 合伙企业 7.41%」）。 */
export function parseHolders(text: string): { name: string; pct: number }[] {
  const out: { name: string; pct: number }[] = [];
  for (const m of text.matchAll(/([^\s；;，,：:、（）()]{2,40}?)\s*[（(]?\s*(?:持股|占比)?\s*(\d{1,3}(?:\.\d+)?)\s*[%％]/g)) {
    const pct = Number(m[2]);
    if (pct > 0 && pct <= 100) out.push({ name: m[1], pct });
  }
  return out;
}

const currentOf = (t: Threshold, rev: Revenue | undefined, annual: number | null): number | null => {
  if (t.metric === 'annual') return annual;
  return rev?.inputs.find((i) => i.key === t.metric)?.value ?? null;
};
const fmtVal = (n: number, unit: Threshold['unit']) => unit === 'amount' ? fmtWan(n) : unit === 'percent' ? `${+n.toFixed(1)}%` : unit === 'months' ? `${n} 个月` : `${n}`;

/** 纯函数：前面几章核过的结果 → 融资方案里所有的数字。测试直接调它。 */
export function computeFinancing(r: ReportSoFar, card: Pick<FactCard, 'sections'>): Omit<Financing, 'advice' | 'numbersOutside' | 'promptSource'> {
  const st = stageOf(card);
  const rev = r.revenue;
  const sector: Sector = (rev?.sector as Sector) || 'general';
  const inp = (k: string) => rev?.inputs.find((i) => i.key === k);
  const fin = (f: string) => card.sections.find((s) => s.key === 'financing')?.items.find((i) => i.field === f && i.label === 'disclosed');

  // 融资额：优先 5.12 核过原文的「本轮拟融资」，其次事实卡「本轮金额」（材料披露的那条）。
  let ask = { value: inp('fundingAmount')?.value ?? null, basis: inp('fundingAmount')?.value != null ? `BP「${inp('fundingAmount')!.raw}」` : '' };
  if (ask.value === null && fin('本轮金额')) {
    const v = parseAmount(fin('本轮金额')!.value);
    if (v !== null) ask = { value: v, basis: `BP「${fin('本轮金额')!.value}」` };
  }
  if (ask.value === null) ask.basis = 'BP 没写本轮融资额（或没写单位）';
  const burnV = inp('monthlyBurn')?.value ?? null;
  const burn = { value: burnV, basis: burnV !== null ? `BP「${inp('monthlyBurn')!.raw}」` : 'BP 没写月度支出 / 亏损' };
  const runwayMonths = ask.value !== null && burn.value ? +(ask.value / burn.value).toFixed(1) : null;
  const suggestedAsk: [number, number] | null = burn.value ? [burn.value * RUNWAY_MONTHS[0], burn.value * RUNWAY_MONTHS[1]] : null;
  let askVerdict: Financing['askVerdict'] = 'unknown';
  let askNote = !burn.value ? '没有月度支出，算不出这轮钱能撑多久，也就判断不了融多融少。' : ask.value === null ? '没有本轮融资额，无从对照。' : '';
  if (suggestedAsk && ask.value !== null) {
    if (ask.value < suggestedAsk[0]) { askVerdict = 'low'; askNote = `按月均净烧 ${fmtWan(burn.value!)} 算，这轮钱只够约 ${runwayMonths} 个月，不到 ${RUNWAY_MONTHS[0]} 个月 —— 下一轮还没准备好钱就花完了。`; }
    else if (ask.value > suggestedAsk[1] * 1.5) { askVerdict = 'high'; askNote = `够撑约 ${runwayMonths} 个月，远超 ${RUNWAY_MONTHS[1]} 个月 —— 要么有更大的投入计划要讲清楚，要么金额偏高会压低估值谈判空间。`; }
    else { askVerdict = 'ok'; askNote = `够撑约 ${runwayMonths} 个月，在 ${RUNWAY_MONTHS[0]}–${RUNWAY_MONTHS[1]} 个月的常见区间附近。`; }
  }

  // 估值：参考区间 + 按出让比例反推的隐含投前估值 + BP 自己写的估值。
  const bm = benchmarkFor(sector, st.stage);
  const reference = bm ? { valuation: bm.data.valuation, dilution: bm.data.dilution, nextRound: bm.data.nextRound, edited: bm.edited } : null;
  const impliedPre: [number, number] | null = reference && ask.value !== null
    ? [ask.value / (reference.dilution[1] / 100) - ask.value, ask.value / (reference.dilution[0] / 100) - ask.value]
    : null;
  const valRaw = fin('估值')?.value || '';
  const disclosedValuation = { value: valRaw ? parseAmount(valRaw) : null, raw: valRaw };
  let valuationVerdict: Financing['valuationVerdict'] = 'unknown';
  let valuationNote = '';
  const probe = disclosedValuation.value ?? (impliedPre ? (impliedPre[0] + impliedPre[1]) / 2 : null);
  if (!reference) valuationNote = 'BP 没写清本轮轮次，没有可比的参考区间。先在 BP 里写明融哪一轮。';
  else if (probe === null) valuationNote = '没有融资额也没有估值，无从判断。';
  else {
    const [lo, hi] = reference.valuation;
    valuationVerdict = probe < lo ? 'below' : probe > hi ? 'above' : 'within';
    const what = disclosedValuation.value !== null ? `BP 写的估值 ${fmtWan(probe)}` : `按常见出让比例反推的投前估值约 ${fmtWan(probe)}`;
    valuationNote = `${what}，${valuationVerdict === 'within' ? '落在' : valuationVerdict === 'above' ? '高于' : '低于'}${STAGES[st.stage]}的参考区间 ${fmtWan(lo)}–${fmtWan(hi)}。`;
  }

  // 下一轮门槛对照。
  const annual = rev ? basicsOf(rev.inputs).annual : null;
  const milestones: Milestone[] = (bm?.data.thresholds || []).map((t) => {
    if (t.unit === 'text') return { label: t.label, target: t.label, current: '见 5.12 / BP 原文', status: 'unknown', gap: '需人工对照' };
    const cur = currentOf(t, rev, annual);
    const target = `${t.op === '>=' ? '≥' : '≤'} ${fmtVal(t.value, t.unit)}`;
    if (cur === null) return { label: t.label, target, current: '未披露', status: 'unknown', gap: 'BP 里没有这个数，投资人会先问' };
    const met = t.op === '>=' ? cur >= t.value : cur <= t.value;
    const diff = Math.abs(t.value - cur);
    return { label: t.label, target, current: fmtVal(cur, t.unit), status: met ? 'met' : 'gap', gap: met ? '已达到' : `还差 ${fmtVal(diff, t.unit)}` };
  });

  // 股权结构（来自 5.9 信用档案的工商股东）。
  const credit = r.credit as Credit | undefined;
  const sh = credit?.items?.find((i) => i.key === 'shareholders' && i.found);
  const holders = sh ? parseHolders(sh.value) : [];
  const topPct = holders.length ? Math.max(...holders.map((h) => h.pct)) : null;
  const hasPlatform = holders.some((h) => /合伙企业|持股平台|有限合伙/.test(h.name)) || /合伙企业|持股平台/.test(sh?.value || '');
  const flags: Financing['equity']['flags'] = [];
  if (!sh) flags.push({ level: 'watch', text: '公开渠道没查到工商股东结构（5.9）。投资人尽调第一步就会看，先准备好股权结构图和期权池安排。' });
  else {
    if (topPct !== null && topPct >= 90 && !hasPlatform) flags.push({ level: 'watch', text: `第一大股东持股 ${topPct}%，没看到员工持股平台 —— 投资人通常会要求在本轮前预留期权池，这部分稀释的是你。` });
    if (topPct !== null && topPct < 50 && (st.stage === 'angel' || st.stage === 'preA')) flags.push({ level: 'risk', text: `早期阶段第一大股东只有 ${topPct}% —— 经过两三轮稀释后创始人可能失去控制权，投资人会担心团队动力和决策效率。` });
    if (hasPlatform) flags.push({ level: 'ok', text: '已有持股平台（合伙企业），期权池有承载主体。' });
    if (!holders.length) flags.push({ level: 'watch', text: '查到了股东信息但没解析出持股比例，请对照 5.9 原文核对。' });
  }

  const terms = Object.values(TERMS).filter((t) => t.stages.includes(st.stage)).map(({ name, what, bottom }) => ({ name, what, bottom }));
  return {
    stage: st.stage, stageLabel: STAGES[st.stage], stageBasis: st.basis, sector, sectorLabel: SECTORS[sector],
    ask, burn, runwayMonths, suggestedAsk, askVerdict, askNote,
    reference, impliedPre, disclosedValuation, valuationVerdict, valuationNote,
    milestones, equity: { found: !!sh, holders, topPct, hasPlatform, flags }, terms,
  };
}

/** 建议文字里出现了、但系统算出来的数里没有的数字（年份、序号、个位数不算）。 */
export function numbersOutside(text: string, computed: unknown): string[] {
  const allowed = JSON.stringify(computed).replace(/(\d),(\d)/g, '$1$2');
  const nums = [...text.replace(/(\d),(\d)/g, '$1$2').matchAll(/\d+(?:\.\d+)?/g)].map((m) => m[0])
    .filter((x) => (x.length >= 2 || x.includes('.')) && !/^(19|20)\d{2}$/.test(x));
  // 「1.2 亿」在 computed 里是 12000（万元）：亿 / 万两种写法都认。
  const ok = (x: string) => allowed.includes(x) || allowed.includes(String(+(Number(x) * 10000).toFixed(2))) || allowed.includes(String(+(Number(x) / 10000).toFixed(4)));
  return [...new Set(nums.filter((x) => !ok(x)))];
}

export async function runFinancing(input: { report: ReportSoFar; card: FactCard; filename: string; userId: string }): Promise<Financing> {
  const computed = computeFinancing(input.report, input.card);
  const method = bpMethod(FINANCING_SLOT, FINANCING_METHOD);
  const facts = {
    轮次: `${computed.stageLabel}（${computed.stageBasis}）`, 行业模板: computed.sectorLabel,
    本轮融资额: computed.ask.value !== null ? fmtWan(computed.ask.value) : '未披露', 月均净烧: computed.burn.value !== null ? fmtWan(computed.burn.value) : '未披露',
    跑道月数: computed.runwayMonths, 建议融资额区间: computed.suggestedAsk?.map(fmtWan).join(' – ') || '算不出', 融资额判断: computed.askNote,
    参考估值区间: computed.reference ? `${computed.reference.valuation.map(fmtWan).join(' – ')}（平台参考口径）` : '无', 参考出让比例: computed.reference ? `${computed.reference.dilution.join('–')}%` : '无',
    隐含投前估值: computed.impliedPre?.map(fmtWan).join(' – ') || '算不出', 估值判断: computed.valuationNote,
    下一轮: computed.reference?.nextRound || '未知', 门槛对照: computed.milestones.map((m) => `${m.label}：目标 ${m.target}，现在 ${m.current}，${m.gap}`),
    股权: computed.equity.flags.map((f) => f.text), 条款: computed.terms.map((t) => t.name),
  };
  const parsed = await bpJson({
    system: `${method.text}

---
## 输出（系统规定，必须遵守）
每段 2-5 句，不写系统没给的数字。只输出 JSON：
{"summary":"一段总结论","ask":"融资额建议","valuation":"估值与出让建议","milestones":"这轮钱换哪些里程碑（按优先级）","equity":"股权与条款建议","sequencing":"融资推进顺序建议（先见谁后见谁、节奏）"}`,
    user: `## 系统算好的数字（只能用这些）\n${JSON.stringify(facts, null, 2)}\n\n${contextText(input.report, 'diagnosis')}`,
    userId: input.userId, operation: 'financing', label: '融资方案', filename: input.filename, maxTokens: 8_000,
  });
  const advice = {
    summary: str(parsed?.summary), ask: str(parsed?.ask), valuation: str(parsed?.valuation),
    milestones: str(parsed?.milestones), equity: str(parsed?.equity), sequencing: str(parsed?.sequencing),
  };
  return { ...computed, advice, numbersOutside: numbersOutside(Object.values(advice).join('\n'), { computed, facts }), promptSource: method.origin };
}
