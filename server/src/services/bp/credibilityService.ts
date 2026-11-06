import { bpJson } from './llm.js';
import { bpMethod, CREDIBILITY_SLOT, CREDIBILITY_METHOD } from './prompts.js';
import { splitPages, locateAt } from './quotes.js';
import type { ReportSoFar } from './context.js';
import type { Team } from './teamService.js';

// 5.7 BP 可信度核验。最危险的失败是**一条没有证据的「已核实」**：评级徽章上写着「可信度 · 高」，投资人和创业者都会当真。
// 所以（硬规则 3）：
//   ① 证据清单由代码从前面几章**核验过的**结果里拼（一致性、信用档案查到的、团队已印证的、行业有出处的数字），
//      模型只能引用清单编号，不能自己举证；
//   ② 「已核实 / 部分核实 / 存矛盾」必须引到至少一条合法证据，否则降成「未核到」（计数报出来）；
//   ③ 声明原文必须在 BP 里找得到（页码由代码算），找不到整条丢掉；
//   ④ 整体评级（高 / 中 / 低）由代码按各条结论的占比算，不收模型的。

export type ClaimStatus = '已核实' | '部分核实' | '存矛盾' | '未核到';
const STATUSES = new Set<ClaimStatus>(['已核实', '部分核实', '存矛盾', '未核到']);

export interface Evidence { id: string; kind: string; text: string }

export interface Claim {
  claim: string; page: number | null; doc: string | null; category: string;
  status: ClaimStatus; finding: string; evidence: string[];
  /** 模型标了核实结论但没引到合法证据，系统降成了「未核到」。 */
  downgraded: boolean;
}

export interface Credibility {
  rating: '高' | '中' | '低';
  ratingBasis: string;
  note: string;
  claims: Claim[];
  contradictions: string[];
  evidence: Evidence[];
  droppedClaims: number;
  promptSource: 'skill' | 'default';
}

const str = (v: any) => String(v ?? '').trim();

/** 证据清单：只收前面几章核验过的东西。 */
export function evidenceOf(r: ReportSoFar & { team?: Team }): Evidence[] {
  const ev: Evidence[] = [];
  const push = (kind: string, text: string) => ev.push({ id: `E${ev.length + 1}`, kind, text });
  for (const i of r.consistency?.items || []) {
    if (i.status === 'single') continue;
    push('BP 内部一致性', `${i.metric}：${i.status === 'conflict' ? '口径冲突' : '多页一致'}（${i.values.map((v) => `「${v.quote}」`).join(' vs ')}）${i.impact ? `；${i.impact}` : ''}`);
  }
  for (const i of r.credit?.items || []) if (i.found) push('工商 / 公开信息', `${i.label}：${i.value}${i.bpCheck ? `（与 BP 对照：${i.bpCheck}）` : ''}`);
  for (const m of r.team?.members || []) for (const s of m.signals) push('团队外部印证', `${m.name}：${s.text}`);
  for (const k of r.industry?.kpis || []) if (!k.unsourced) push('行业数据', `${k.label}：${k.value}${k.unit} ${k.delta}`.trim());
  for (const c of (r.competitors as any)?.competitors || []) push('竞品', `${c.name}：${c.positioning}（${c.stage}）`);
  return ev.slice(0, 80);
}

export function ratingOf(claims: Claim[]): { rating: Credibility['rating']; basis: string } {
  const n = claims.length;
  const c = (s: ClaimStatus) => claims.filter((x) => x.status === s).length;
  const V = c('已核实'), P = c('部分核实'), C = c('存矛盾'), U = c('未核到');
  const basis = `${n} 条声明：已核实 ${V}、部分核实 ${P}、存矛盾 ${C}、未核到 ${U}`;
  if (!n) return { rating: '低', basis: '没有可核验的声明' };
  if (C >= 2 || C / n >= 0.3) return { rating: '低', basis: `${basis}（存矛盾 ≥ 2 条或占三成以上即判低）` };
  const score = (V + 0.5 * P) / n;
  return { rating: score >= 0.6 ? '高' : score >= 0.3 ? '中' : '低', basis: `${basis}（按 已核实 + 0.5 × 部分核实 的占比判档）` };
}

/** 纯函数：模型输出 + BP 原文 + 证据清单 → 核验过的可信度。 */
export function buildCredibility(parsed: any, bpText: string, evidence: Evidence[]) {
  const pages = splitPages(bpText);
  const ids = new Set(evidence.map((e) => e.id));
  let droppedClaims = 0;
  const claims: Claim[] = [];
  for (const x of Array.isArray(parsed?.claims) ? parsed.claims : []) {
    const claim = str(x?.claim).replace(/^[「“"]|[」”"]$/g, '');
    const at = claim ? locateAt(claim, pages) : undefined;
    if (!at) { droppedClaims++; continue; }
    const ev = [...new Set((Array.isArray(x?.evidence) ? x.evidence : []).map(str).filter((e: string) => ids.has(e)))] as string[];
    let status: ClaimStatus = STATUSES.has(x?.status) ? x.status : '未核到';
    let downgraded = false;
    if (status !== '未核到' && !ev.length) { status = '未核到'; downgraded = true; }
    claims.push({ claim, page: at.page, doc: at.doc, category: str(x?.category) || '其他', status, finding: str(x?.finding), evidence: ev, downgraded });
  }
  const order: ClaimStatus[] = ['存矛盾', '部分核实', '未核到', '已核实'];
  claims.sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status));
  const { rating, basis } = ratingOf(claims);
  return {
    rating, ratingBasis: basis, note: str(parsed?.note), claims, droppedClaims,
    contradictions: (Array.isArray(parsed?.contradictions) ? parsed.contradictions : []).map(str).filter(Boolean).slice(0, 6),
  };
}

export async function runCredibility(input: { report: ReportSoFar & { team?: Team }; bpText: string; filename: string; userId: string }): Promise<Credibility> {
  const evidence = evidenceOf(input.report);
  const method = bpMethod(CREDIBILITY_SLOT, CREDIBILITY_METHOD);
  const parsed = await bpJson({
    system: `${method.text}

---
## 输出（系统规定，必须遵守）
- claim：BP 原文里的那句声明，**逐字照抄**（10-80 字）—— 系统会去 BP 里核，核不上的整条丢掉。
- status 只能是 已核实 / 部分核实 / 存矛盾 / 未核到；evidence 写证据清单里的编号（如 ["E3","E7"]）。除「未核到」外必须至少引一条，否则系统会改成「未核到」。
- category：团队 / 经营数据 / 合作与客户 / 荣誉资质 / 财务预测 之一。
- finding：核验发现（一两句，说清对上了什么、差在哪）。
- contradictions：最关键的矛盾，一条一句（没有就空数组）；note：一段总评（不写评级，评级由系统算）。

只输出 JSON：
{"claims":[{"claim":"","category":"","status":"","finding":"","evidence":["E1"]}],"contradictions":[""],"note":""}`,
    user: `## 证据清单（只能引用这些编号）\n${evidence.length ? evidence.map((e) => `${e.id} 〔${e.kind}〕${e.text}`).join('\n') : '（前面几章没有可用的核验发现 —— 所有声明都只能是「未核到」）'}\n\n## BP 全文及附件（只用来抄声明原文）\n${input.bpText}`,
    userId: input.userId, operation: 'credibility', label: 'BP 可信度核验', filename: input.filename, maxTokens: 10_000,
  });
  return { ...buildCredibility(parsed, input.bpText, evidence), evidence, promptSource: method.origin };
}
