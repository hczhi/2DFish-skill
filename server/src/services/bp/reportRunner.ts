import { extractFactCard } from './factCardService.js';
import { runConsistency } from './consistencyService.js';
import { runRevenue } from './revenueService.js';
import { runCredit } from './creditService.js';
import { runKeywords } from './keywordsService.js';
import { runTeam } from './teamService.js';
import { runCredibility } from './credibilityService.js';
import { runFinancing } from './financingService.js';
import { materialsFor } from './materialStore.js';
import { aiCallContext } from '../../core/llm/callContext.js';
import { sdkCallCounter } from './billing.js';
import { runIndustry } from './industryService.js';
import { runCompetitors } from './competitorService.js';
import { runInvestors } from './investorService.js';
import { runDiagnosis } from './diagnosisService.js';
import { runAdvice, runPlan } from './adviceService.js';
import type { ReportSoFar } from './context.js';
import { getReportRow, setStep, saveSection, finishReport, failReport } from './reportStore.js';

// 一份报告的后台流水线：按章节顺序串着跑，一章跑完写一章（`saveSection`）。
// 串行是因为后面每一章都拿前面**核验过的**结论当输入（context.ts）：评分要看到竞品，
// 改写建议要看到评分。并行的话后面几章读到的是一份还不存在的上游结论，而正文照样通顺。
//
// 执行顺序 ≠ 报告里的章节顺序（报告 01-04 是评分和建议，但它们要等 05-09 的素材）。
// 每个 step 键也是前端进度条上的那一行字，所以新加一章要同时加进 `STEPS`。

export const STEPS: { key: string; label: string }[] = [
  { key: 'factCard', label: '抽取企业基本面（事实卡）' },
  { key: 'keywords', label: '提炼检索词' },
  { key: 'consistency', label: 'BP 内部一致性审计' },
  { key: 'revenue', label: '收入质量体检' },
  { key: 'credit', label: '企业信用档案（联网）' },
  { key: 'team', label: '团队竞争力评估（联网核验）' },
  { key: 'industry', label: '联网检索 + 行业分析' },
  { key: 'competitors', label: '竞品检索 + 融资穿透 + 对标企业' },
  { key: 'credibility', label: 'BP 可信度核验' },
  { key: 'investors', label: '目标融资对象' },
  { key: 'financing', label: '融资方案（融资额 · 估值 · 里程碑 · 股权）' },
  { key: 'diagnosis', label: '五维双轨评分' },
  { key: 'advice', label: 'BP 优化 + 追问预演' },
  { key: 'plan', label: '90 天行动清单' },
];

/**
 * 重跑 `from` 这一章时要一起清掉的章节：它和它后面的所有章（后面每一章都拿前面的结果当输入）。
 * 事实卡不许重跑：它的提醒已经并进报告级的 notes 里，重跑会重复一份；要换事实卡就重新上传。
 */
export function rerunKeys(from: string): string[] | null {
  const i = STEPS.findIndex((s) => s.key === from);
  if (i <= 0) return null;
  return STEPS.slice(i).map((s) => s.key);
}

/** 这份报告还缺哪几章（按 STEPS 顺序）。 */
export function missingSteps(result: Record<string, unknown>): string[] {
  const searchDone = ['credit', 'team', 'industry', 'competitors', 'investors'].every((k) => k in result);
  // 「提炼检索词」只是给联网章节用的：老报告那几章都跑完了的话，补跑它什么都不会变，
  // 却会让界面一直说「缺 1 步」、点一次花一次额度。
  return STEPS.map((s) => s.key).filter((k) => !(k in result) && !(k === 'keywords' && searchDone));
}

/**
 * 跑一份报告。已经在 result_json 里的章节**跳过**，直接拿存下来的结果当后面几章的输入 ——
 * 所以同一个函数既是首跑也是断点续跑（失败 / 中断 / 老报告补新章节）。
 * 跳过而不是重跑：重跑前面几章是白花额度，而且结果会变（模型这次挑的竞品不一样），
 * 后面已经跑完的评分就和前面对不上了。
 */
export async function runReport(id: string): Promise<void> {
  const row = getReportRow(id);
  if (!row) return;
  // 整份报告在计费上下文里跑（core/llm/callContext）：key 用户已经按整份冻结 / 扣过点，里面的调用不再按次扣；
  // 嵌入版每发一次调用计一次这把 pk 的当日用量。
  await aiCallContext.run({ coversPoints: true, onAiCall: sdkCallCounter(row.sdk_pk) }, () => runInContext(id, row));
}

async function runInContext(id: string, row: NonNullable<ReturnType<typeof getReportRow>>): Promise<void> {
  const base = { filename: row.filename, userId: row.user_id };
  const saved = JSON.parse(row.result_json || '{}');
  // 老报告的检索词是在「行业模板」之前提炼的（没有 sector）：不重提的话重跑 5.12 静默按通用指标算，
  // 而他以为新功能对这份报告也生效了。重提只是一次很小的调用，已经跑完的章节照旧跳过。
  if (saved.keywords && !('sector' in saved.keywords)) delete saved.keywords;
  const report: ReportSoFar = { ...saved };
  const step = async <K extends keyof ReportSoFar>(key: K, fn: () => Promise<NonNullable<ReportSoFar[K]>>, notes?: (v: any) => string[]) => {
    if (key in saved) return saved[key];
    setStep(id, key);
    const v = await fn();
    report[key] = v as ReportSoFar[K];
    if (notes) {
      const { notes: _n, ...rest } = v as any;
      saveSection(id, key, rest, notes(v));
    } else {
      saveSection(id, key, v);
    }
    return v;
  };
  try {
    const card = await step('factCard', () => extractFactCard({ text: row.bp_text, emptyPages: row.empty_pages, ...base }), (v) => v.notes);
    // 存下来的那份不带 notes（notes 进了报告级的 notes_json），后面几章只读 sections。
    const fullCard = { notes: [], ...(card as object) } as unknown as Awaited<ReturnType<typeof extractFactCard>>;
    // 检索词放在事实卡后面、所有联网章之前：它失败也不打断（内部退回「所属行业」并记下原因）。
    const keywords = await step('keywords', () => runKeywords({ card: fullCard, ...base }));
    // 补充资料每章现读：用户在报告页补完 / 勾掉之后点「重跑」，这一章就用新的那一组。
    const m = (ch: Parameters<typeof materialsFor>[1]) => materialsFor(id, ch);
    await step('consistency', () => runConsistency({ text: row.bp_text, ...base }));
    await step('revenue', () => runRevenue({ text: row.bp_text, sector: keywords.sector, ...base }));
    await step('credit', () => runCredit({ card: fullCard, keywords, materials: m('credit'), ...base }));
    await step('team', () => runTeam({ card: fullCard, bpText: row.bp_text, keywords, materials: m('team'), ...base }));
    await step('industry', () => runIndustry({ card: fullCard, keywords, materials: m('industry'), ...base }));
    await step('competitors', () => runCompetitors({ report, card: fullCard, keywords, materials: m('competitors'), ...base }));
    await step('credibility', () => runCredibility({ report, bpText: row.bp_text, ...base }));
    await step('investors', () => runInvestors({ report, card: fullCard, keywords, materials: m('investors'), ...base }));
    await step('financing', () => runFinancing({ report, card: fullCard, ...base }));
    await step('diagnosis', () => runDiagnosis({ report, card: fullCard, bpText: row.bp_text, ...base }));
    await step('advice', () => runAdvice({ report, bpText: row.bp_text, ...base }));
    await step('plan', () => runPlan({ report, ...base }));
    finishReport(id);
  } catch (e: any) {
    // 原文整段落库，前端照原样显示（上游的「余额不足 / 模型名不对」只有这里有）。
    // 已经跑完的章节照样在 result_json 里，报告页照常显示；点「接着跑」从这一章开始。
    failReport(id, e?.message || String(e));
  }
}
