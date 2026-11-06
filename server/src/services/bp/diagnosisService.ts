import { BpError } from './factCardService.js';
import { bpJson } from './llm.js';
import { bpMethod, DIAGNOSIS_SLOT, DIAGNOSIS_METHOD, STAGE_SLOTS, STAGE_RUBRICS } from './prompts.js';
import { stageOf, STAGES, type Stage } from './standards.js';
import type { FactCard } from './factCardService.js';
import { contextText, type ReportSoFar } from './context.js';
import { splitPages, locateAt } from './quotes.js';

// 01 体检结论 + 02 五维评分。这一章最危险的失败是**分数自己对不上账**：标题写 61.8、正文写 309，
// 或者分数是第三梯队、标签写着第二梯队（skill 里 2026-10-30 定的「口径事故」）。读起来都很正常。
// 所以模型只给每维的 fact / proof（0-100 整数）和文字，其余全在 `scoreDims` 里算（硬规则 3）：
//   - 总分 = Σ fact（500 分制），展示一律 ÷5 保留一位小数（100 分制）；
//   - 可回收分 = Σ max(fact − proof, 0)；
//   - 梯队按 100 分制现算：≥85 第一 / ≥75 第二 / ≥60 第三 / <60 第四，总分和单维共用一套；
//   - 四象限按 事实 / 举证 是否 ≥60 现算。
// 模型写在结论里的分数一律不信：prompt 不许写，写了就在 `scoreInText` 里报出来（界面提示以系统算的为准）。
// 五维缺一维直接报错：少一维的总分会被当成满分 400 的卷子算，梯队整个错位。

export const DIMS = [
  { key: 'market', name: '市场' },
  { key: 'tech', name: '技术' },
  { key: 'commercial', name: '商业化' },
  { key: 'team', name: '团队' },
  { key: 'capital', name: '资本化' },
] as const;

export type Cause = '叙事' | '证据' | '事实' | '阶段';
const CAUSES = new Set<Cause>(['叙事', '证据', '事实', '阶段']);
export type Band = '第一梯队' | '第二梯队' | '第三梯队' | '第四梯队';
export type Quadrant = '改材料就能加分' | '可以见投资人' | '先别急着融资' | '一问就穿';

export interface Deduction { text: string; cause: Cause; severity: '致命' | '重要' | '可选'; quote: string; page: number | null; doc: string | null; quoteFound: boolean | null }

export interface Dim {
  key: string; name: string;
  fact: number; proof: number;
  /** 单维本来就是百分制，不 ÷5。 */
  factP: number; proofP: number; recoverableP: number;
  band: Band; quadrant: Quadrant;
  note: string;
  deductions: Deduction[];
}

export interface Diagnosis {
  dims: Dim[];
  /** 500 分制原始值。 */
  total: number; proofTotal: number; recoverable: number;
  /** 100 分制展示值。 */
  totalP: number; proofP: number; recoverableP: number;
  band: Band; quadrant: Quadrant;
  verdict: string;
  top3: { title: string; why: string; fix: string }[];
  benchmark: string;
  /** 这次按哪个轮次的标尺打分、凭什么认出这一轮（代码从事实卡认，不问模型）。 */
  stage?: Stage;
  stageLabel?: string;
  stageBasis?: string;
  stagePromptSource?: 'skill' | 'default';
  /** 模型在文字里写了分数（可能是 500 分制），界面上提示以系统算的为准。 */
  scoreInText: boolean;
  /** 模型这次没给出的部分（'verdict' / 'top3'）。界面上要明说并引导重跑 —— 留一个空标题读起来像「没什么要改的」。 */
  missingParts: ('verdict' | 'top3')[];
  promptSource: 'skill' | 'default';
}

export const p100 = (n: number) => Math.round((n / 5) * 10) / 10;
export const bandOf = (score100: number): Band =>
  score100 >= 85 ? '第一梯队' : score100 >= 75 ? '第二梯队' : score100 >= 60 ? '第三梯队' : '第四梯队';
export const quadrantOf = (fact100: number, proof100: number): Quadrant =>
  fact100 >= 60 ? (proof100 >= 60 ? '可以见投资人' : '改材料就能加分') : proof100 >= 60 ? '一问就穿' : '先别急着融资';

const str = (v: any) => String(v ?? '').trim();
const score = (v: any): number | null => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
};

/** 纯函数：模型输出 + BP 原文 → 评分。测试直接调它。 */
export function scoreDims(parsed: any, bpText: string): Omit<Diagnosis, 'promptSource' | 'benchmark'> {
  const pages = splitPages(bpText);
  const missing: string[] = [];
  const dims: Dim[] = DIMS.map((d) => {
    const r = parsed?.dims?.[d.key];
    const fact = score(r?.fact), proof = score(r?.proof);
    if (fact === null || proof === null) { missing.push(d.name); return null as any; }
    const deductions: Deduction[] = (Array.isArray(r?.deductions) ? r.deductions : [])
      .map((x: any) => {
        const quote = str(x?.quote).replace(/^[「“"]|[」”"]$/g, '');
        const at = quote ? locateAt(quote, pages) : undefined;
        return {
          text: str(x?.text), cause: CAUSES.has(x?.cause) ? x.cause : '叙事',
          severity: ['致命', '重要', '可选'].includes(x?.severity) ? x.severity : '重要',
          quote, page: at?.page ?? null, doc: at?.doc ?? null, quoteFound: quote ? at !== undefined : null,
        } as Deduction;
      })
      .filter((x: Deduction) => x.text);
    return {
      key: d.key, name: d.name, fact, proof, factP: fact, proofP: proof,
      recoverableP: Math.max(fact - proof, 0), band: bandOf(fact), quadrant: quadrantOf(fact, proof),
      note: str(r?.note), deductions,
    };
  });
  if (missing.length) {
    throw new BpError(`五维评分：模型没给出「${missing.join('、')}」的事实分 / 举证分（或不在 0-100），总分没法算，这一章没出（这次的 AI 额度已经扣了）。`, 502);
  }
  const total = dims.reduce((s, d) => s + d.fact, 0);
  const proofTotal = dims.reduce((s, d) => s + d.proof, 0);
  const recoverable = dims.reduce((s, d) => s + Math.max(d.fact - d.proof, 0), 0);
  // 模型偶尔把 verdict / top3 塞进 dims 对象里（实测 deepseek-v4-flash：`"dims":{…,"top3":[…]}`）。
  // 只在顶层找的话这两块静默为空，页面上「最该改的三件事」只剩一个标题。
  const verdict = str(parsed?.verdict ?? parsed?.dims?.verdict);
  const top3Raw = Array.isArray(parsed?.top3) ? parsed.top3 : Array.isArray(parsed?.dims?.top3) ? parsed.dims.top3 : [];
  const top3 = top3Raw
    .map((t: any) => ({ title: str(t?.title), why: str(t?.why), fix: str(t?.fix) }))
    .filter((t: { title: string }) => t.title)
    .slice(0, 3);
  const texts = [verdict, ...dims.map((d) => d.note), ...top3.map((t: { why: string; fix: string }) => `${t.why}${t.fix}`)].join('\n');
  return {
    dims, total, proofTotal, recoverable,
    totalP: p100(total), proofP: p100(proofTotal), recoverableP: p100(recoverable),
    band: bandOf(p100(total)), quadrant: quadrantOf(p100(total), p100(proofTotal)),
    verdict, top3, scoreInText: /\d+(\.\d+)?\s*分/.test(texts),
    missingParts: [...(verdict ? [] : ['verdict' as const]), ...(top3.length ? [] : ['top3' as const])],
  };
}

export async function runDiagnosis(input: { report: ReportSoFar; card: Pick<FactCard, 'sections'>; bpText: string; filename: string; userId: string }): Promise<Diagnosis> {
  const method = bpMethod(DIAGNOSIS_SLOT, DIAGNOSIS_METHOD);
  // 分阶段标尺：轮次由代码认，标尺文字后台可改（每个轮次一个 slot）。同一套「阶段正常不扣分」规则，
  // 天使轮和 B 轮的「正常」完全不同 —— 不给标尺的话模型对每家都按一个模糊的中间标准打分。
  const st = stageOf(input.card);
  const rubric = bpMethod(STAGE_SLOTS[st.stage], STAGE_RUBRICS[st.stage]);
  const dimKeys = DIMS.map((d) => `${d.key}（${d.name}）`).join('、');
  const parsed = await bpJson({
    system: `${method.text}

## 本次适用的阶段标尺（${STAGES[st.stage]}，${st.basis}）
${rubric.text}

---
## 输出（系统规定，必须遵守）
- dims 必须五个键都有：${dimKeys}。fact、proof 是 0-100 的整数。
- 每条 deduction：text 写扣分点和处方；cause 只能是 叙事 / 证据 / 事实 / 阶段；severity 只能是 致命 / 重要 / 可选；quote 是能支撑这条扣分的 BP 原文（逐字照抄 10-60 字，没有就空）—— 系统会去 BP 里核这段原文。
- verdict（一段话）和 top3 写在 JSON **顶层**，和 dims 并列，不要放进 dims 里面。
- verdict、note、top3 里**不写任何分数和梯队**。
- top3：最该先改的三件事，每件写 why（为什么是它）和 fix（怎么改）。

只输出 JSON：
{"dims":{"market":{"fact":0,"proof":0,"note":"","deductions":[{"text":"","cause":"","severity":"","quote":""}]},"tech":{},"commercial":{},"team":{},"capital":{}},
 "verdict":"","top3":[{"title":"","why":"","fix":""}]}`,
    user: contextText(input.report, 'diagnosis'),
    userId: input.userId, operation: 'diagnosis', label: '五维评分', filename: input.filename,
  });
  return {
    ...scoreDims(parsed, input.bpText),
    // 没有同批 BP 做基线：写明，不让模型编一个「同批均分 62」。
    benchmark: '无同批基线（分位需要同一批次的多份 BP，这份报告是单份评估）',
    stage: st.stage, stageLabel: STAGES[st.stage], stageBasis: st.basis, stagePromptSource: rubric.origin,
    promptSource: method.origin,
  };
}
