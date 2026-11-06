import type { FactCard } from './factCardService.js';
import type { Consistency } from './consistencyService.js';
import type { Revenue } from './revenueService.js';
import type { Industry } from './industryService.js';
import type { Credit } from './creditService.js';
import type { Keywords } from './keywordsService.js';
import type { Team } from './teamService.js';
import type { Credibility } from './credibilityService.js';
import type { Financing } from './financingService.js';

// 后面几章（竞品 / 评分 / 建议 / 行动）拿前面几章的**核验过的结果**当输入，不再让模型自己从 BP 全文里重新读一遍：
// 重新读的话它会把 5.11 已经丢掉的那条编出来的冲突再「发现」一次，写进扣分和改写建议里。
// 所以这里只拼核验过的东西：事实卡里非 missing / unverified 的条目、留下来的冲突、算出来的指标。

export interface ReportSoFar {
  factCard?: FactCard | Omit<FactCard, 'notes'>;
  consistency?: Consistency;
  revenue?: Revenue;
  keywords?: Keywords;
  credit?: Credit;
  team?: Team;
  credibility?: Credibility;
  financing?: Financing;
  industry?: Industry;
  competitors?: { competitors: { name: string; positioning: string; stage: string; diff: string }[]; positionMap: { conclusion: string } | null };
  investors?: unknown;
  diagnosis?: { dims: { name: string; factP: number; proofP: number; deductions: { text: string; cause: string }[] }[]; verdict: string; top3: { title: string; fix: string }[] };
  advice?: unknown;
  plan?: unknown;
}

export function factsText(card?: ReportSoFar['factCard']): string {
  if (!card) return '';
  return card.sections
    .map((s) => {
      const lines = s.items
        .filter((i) => i.label !== 'missing' && i.label !== 'unverified')
        .map((i) => `- ${i.field}：${i.value}${i.label === 'inferred' ? '（推断）' : ''}`);
      const miss = s.items.filter((i) => i.label === 'missing').map((i) => i.field);
      return `### ${s.title}\n${lines.join('\n')}${miss.length ? `\n- BP 未披露：${miss.join('、')}` : ''}`;
    })
    .join('\n');
}

export function contextText(r: ReportSoFar, upTo: 'industry' | 'competitors' | 'diagnosis' | 'all'): string {
  const parts: string[] = [`## BP 事实卡（已核验）\n${factsText(r.factCard)}`];
  if (r.consistency) {
    const c = r.consistency.items.filter((i) => i.status !== 'consistent');
    parts.push(
      `## BP 内部一致性（已核验原文）\n${c.length ? c.map((i) => `- [${i.status === 'conflict' ? `冲突·${i.severity}` : '单点无对照'}] ${i.metric}：${i.values.map((v) => `「${v.quote}」`).join(' vs ')}；影响：${i.impact}`).join('\n') : '- 没有发现冲突'}`
    );
  }
  if (r.revenue) {
    parts.push(
      `## 收入质量（代码按公式算）\n${r.revenue.metrics.map((m) => `- ${m.name}：${m.value}${m.status ? `（${m.status}）` : ''}`).join('\n')}\n- 缺口：${r.revenue.gaps.map((g) => g.item).join('、') || '无'}`
    );
  }
  if (r.credit) {
    parts.push(
      r.credit.skipped
        ? `## 企业信用档案\n- 没查：${r.credit.skipped}`
        : `## 企业信用档案（公开网页，查不到 ≠ 没有）\n${r.credit.items.map((i) => `- ${i.label}：${i.value}${i.bpCheck ? `（与 BP 对照：${i.bpCheck}）` : ''}`).join('\n')}`
    );
  }
  if (r.team && !r.team.skipped) {
    parts.push(`## 团队（外部核验）\n- 总评：${r.team.overall.level}；${r.team.overall.note}\n${r.team.dims.map((d) => `- ${d.name}：${d.level}`).join('\n')}\n${r.team.members.map((m) => `- ${m.name}（${m.role}）：${m.status}`).join('\n')}`);
  }
  if (r.credibility && upTo !== 'industry') {
    parts.push(`## BP 可信度（系统评级：${r.credibility.rating}；${r.credibility.ratingBasis}）\n${r.credibility.claims.filter((c) => c.status !== '已核实').map((c) => `- [${c.status}] 「${c.claim}」：${c.finding}`).join('\n')}`);
  }
  if (r.financing && (upTo === 'diagnosis' || upTo === 'all')) {
    const f = r.financing;
    parts.push(`## 融资方案（系统计算）\n- ${f.askNote}\n- ${f.valuationNote}\n${f.milestones.map((m) => `- 下一轮门槛 ${m.label}：目标 ${m.target}，现在 ${m.current}（${m.gap}）`).join('\n')}\n${f.equity.flags.map((x) => `- 股权：${x.text}`).join('\n')}`);
  }
  if (r.industry && upTo !== 'industry') {
    parts.push(
      `## 行业（${r.industry.topic}）\n${r.industry.kpis.filter((k) => !k.unsourced).map((k) => `- ${k.label}：${k.value}${k.unit} ${k.delta}`).join('\n')}\n${r.industry.trends.map((t) => `- 趋势「${t.title}」（${t.strength}）：${t.judge}`).join('\n')}`
    );
  }
  if (r.competitors && (upTo === 'diagnosis' || upTo === 'all')) {
    parts.push(
      `## 竞品\n${r.competitors.competitors.map((c) => `- ${c.name}（${c.stage}）：${c.positioning}；差异：${c.diff}`).join('\n')}${r.competitors.positionMap ? `\n- 生态位：${r.competitors.positionMap.conclusion}` : ''}`
    );
  }
  if (r.diagnosis && upTo === 'all') {
    parts.push(
      `## 五维评分（系统算分，100 分制）\n${r.diagnosis.dims.map((d) => `- ${d.name}：事实 ${d.factP} / 举证 ${d.proofP}；扣分：${d.deductions.map((x) => `${x.text}（${x.cause}）`).join('；')}`).join('\n')}\n- 结论：${r.diagnosis.verdict}\n- 最该先改的三件事：${r.diagnosis.top3.map((t) => t.title).join('；')}`
    );
  }
  return parts.join('\n\n');
}
