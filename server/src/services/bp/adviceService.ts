import { BpError } from './factCardService.js';
import { bpJson } from './llm.js';
import { bpMethod, ADVICE_SLOT, ADVICE_METHOD, PLAN_SLOT, PLAN_METHOD } from './prompts.js';
import { contextText, type ReportSoFar } from './context.js';
import { splitPages, locateAt } from './quotes.js';

// 03 BP 优化 + 04 追问预演 + 10 行动清单。
//
// 03 最危险的失败是**给一句 BP 里根本没有的「原句」写改写建议**：创业者翻遍 BP 找不到那句，
// 或者更糟，以为是自己记错了照着改。所以原句必须在 BP 里核得上，核不上整条丢掉（计数报出来）；
// 页码由代码算。04 / 10 不引原文，没有可核的东西 —— 它们的输入是前面几章核验过的结果（context.ts），
// 不再让模型重新读 BP 全文自己「发现」问题。
// 10 的三段排期键由代码定（d30/d60/d90），模型给别的段名会被丢掉而不是新开一段。

export interface BpFix {
  level: '致命' | '重要' | '可选';
  quote: string; page: number | null;
  /** 原句出自附件时是「附件K《名》」—— 改写建议对附件也成立，但他要改的是那份材料不是 BP。 */
  doc: string | null;
  problem: string; investorView: string; rewrite: string;
}

export interface Qa { q: string; why: string; answer: string; evidence: string }

export interface Advice {
  fixes: BpFix[];
  /** 原句在 BP 里核不上被丢掉的条数。 */
  droppedFixes: number;
  qa: Qa[];
  promptSource: 'skill' | 'default';
}

export interface PlanItem { task: string; deliverable: string; ref: string }

export interface Plan {
  /** priority 由模型给、代码校验成 高 / 中 / 低；给的不是这三个就是 null（不补成「中」—— 补出来的优先级是我们编的），按它排序。 */
  tradeoffs: { priority: '高' | '中' | '低' | null; take: string; drop: string; why: string; effect: string; risk: string }[];
  quickWins: string[];
  phases: { key: 'd30' | 'd60' | 'd90'; label: string; items: PlanItem[] }[];
  reviewPoint: string;
  dataRequests: { item: string; spec: string }[];
  ddChecklist: string[];
  promptSource: 'skill' | 'default';
}

const str = (v: any) => String(v ?? '').trim();
const arr = (v: any): any[] => (Array.isArray(v) ? v : []);

/** 纯函数：模型输出 + BP 原文 → 核验过的改写清单。 */
export function buildFixes(parsed: any, bpText: string): { fixes: BpFix[]; droppedFixes: number } {
  const pages = splitPages(bpText);
  let droppedFixes = 0;
  const fixes: BpFix[] = [];
  for (const f of arr(parsed?.fixes)) {
    const quote = str(f?.quote).replace(/^[「“"]|[」”"]$/g, '');
    const at = locateAt(quote, pages);
    if (!quote || at === undefined) { droppedFixes++; continue; }
    fixes.push({
      level: ['致命', '重要', '可选'].includes(f?.level) ? f.level : '重要',
      quote, page: at.page, doc: at.doc, problem: str(f?.problem), investorView: str(f?.investor_view), rewrite: str(f?.rewrite),
    });
  }
  const rank = { 致命: 0, 重要: 1, 可选: 2 };
  fixes.sort((a, b) => rank[a.level] - rank[b.level]);
  return { fixes, droppedFixes };
}

export async function runAdvice(input: { report: ReportSoFar; bpText: string; filename: string; userId: string }): Promise<Advice> {
  const method = bpMethod(ADVICE_SLOT, ADVICE_METHOD);
  const parsed = await bpJson({
    system: `${method.text}

---
## 输出（系统规定，必须遵守）
- fixes：quote 是 BP 原句，**逐字照抄**一段连续文字（10-80 字，不改写、不拼接、不加省略号）—— 系统会去 BP 里核，核不上的整条丢掉。level 只能是 致命 / 重要 / 可选。8-15 条。
- qa：6-10 个问题。

只输出 JSON：
{"fixes":[{"level":"","quote":"","problem":"","investor_view":"","rewrite":""}],
 "qa":[{"q":"","why":"","answer":"","evidence":""}]}`,
    user: `${contextText(input.report, 'all')}\n\n## BP 全文及附件（只用来抄原句。「--- 第 N 页 ---」是 BP 分页；「===== 附件K《…》 =====」之后是用户另外提供的补充材料，不是 BP 本身）\n${input.bpText}`,
    userId: input.userId, operation: 'advice', label: 'BP 优化与追问预演', filename: input.filename,
  });
  const { fixes, droppedFixes } = buildFixes(parsed, input.bpText);
  const qa = arr(parsed?.qa)
    .map((x) => ({ q: str(x?.q), why: str(x?.why), answer: str(x?.answer), evidence: str(x?.evidence) }))
    .filter((x) => x.q);
  if (!fixes.length && !qa.length) {
    throw new BpError(
      `BP 优化：模型${droppedFixes ? `给的 ${droppedFixes} 条改写建议原句在 BP 里都核不上，` : '一条改写建议、一个追问都没给，'}这一章没出（这次的 AI 额度已经扣了）。`,
      502
    );
  }
  return { fixes, droppedFixes, qa, promptSource: method.origin };
}

const PHASES = [
  { key: 'd30', label: '第 1-30 天' },
  { key: 'd60', label: '第 31-60 天' },
  { key: 'd90', label: '第 61-90 天' },
] as const;

export function buildPlan(parsed: any): Omit<Plan, 'promptSource'> {
  return {
    tradeoffs: arr(parsed?.tradeoffs)
      .map((t) => ({
        priority: (['高', '中', '低'].includes(str(t?.priority)) ? str(t?.priority) : null) as '高' | '中' | '低' | null,
        take: str(t?.take), drop: str(t?.drop), why: str(t?.why), effect: str(t?.effect), risk: str(t?.risk),
      }))
      .filter((t) => t.take)
      .sort((a, b) => (a.priority ? '高中低'.indexOf(a.priority) : 3) - (b.priority ? '高中低'.indexOf(b.priority) : 3)),
    quickWins: arr(parsed?.quick_wins).map(str).filter(Boolean),
    phases: PHASES.map((p) => ({
      ...p,
      items: arr(parsed?.phases?.[p.key])
        .map((i) => ({ task: str(i?.task), deliverable: str(i?.deliverable), ref: str(i?.ref) }))
        .filter((i) => i.task),
    })),
    reviewPoint: str(parsed?.review_point),
    dataRequests: arr(parsed?.data_requests).map((d) => ({ item: str(d?.item), spec: str(d?.spec) })).filter((d) => d.item),
    ddChecklist: arr(parsed?.dd_checklist).map(str).filter(Boolean),
  };
}

export async function runPlan(input: { report: ReportSoFar; filename: string; userId: string }): Promise<Plan> {
  const method = bpMethod(PLAN_SLOT, PLAN_METHOD);
  const parsed = await bpJson({
    system: `${method.text}

---
## 输出（系统规定，必须遵守）
- tradeoffs 每条给 priority：高 / 中 / 低（高 = 本周不做这一轮基本可以放弃）。
- phases 只有三个键：d30（第 1-30 天）、d60（第 31-60 天）、d90（第 61-90 天）。每项的 ref 写它对应报告里的哪个问题。

只输出 JSON：
{"tradeoffs":[{"priority":"","take":"","drop":"","why":"","effect":"","risk":""}],
 "quick_wins":[""],
 "phases":{"d30":[{"task":"","deliverable":"","ref":""}],"d60":[],"d90":[]},
 "review_point":"",
 "data_requests":[{"item":"","spec":""}],
 "dd_checklist":[""]}`,
    user: contextText(input.report, 'all'),
    userId: input.userId, operation: 'plan', label: '90 天行动清单', filename: input.filename, maxTokens: 12_000,
  });
  const plan = buildPlan(parsed);
  if (!plan.phases.some((p) => p.items.length) && !plan.tradeoffs.length) {
    throw new BpError('90 天行动清单：模型返回了 JSON，但排期和战略取舍都是空的（这次的 AI 额度已经扣了）。再试一次或换个模型。', 502);
  }
  return { ...plan, promptSource: method.origin };
}
