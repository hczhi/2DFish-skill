import type { FactCard } from './factCardService.js';
import { gatherSources, nameBacked, srcList, DOCS_RULES, type Source, type ExtraSource } from './sources.js';
import { bpJson } from './llm.js';
import { bpMethod, TEAM_SLOT, TEAM_METHOD } from './prompts.js';
import { norm } from './quotes.js';
import type { Keywords } from './keywordsService.js';

// 5.10 团队竞争力评估。最危险的失败是**把同名的人的履历安到创始人头上**：「张伟，前阿里 P9」读起来是核实过的，
// 投资人会拿它当事实。所以（硬规则 3）：
//   ① 成员名单由代码从事实卡「团队」里取，模型不许加人；名字必须在 BP 原文里出现；
//   ② 每条外部印证都要引资料编号，且被引资料里必须出现这个人的名字（`nameBacked`），否则丢掉；
//   ③ 成员的核实状态由代码按留下来的印证条数定（已核实 / 部分核实 / 待外部核实），不收模型的；
//   ④ 「外部验证」这一维的等级也由代码按已核实的成员占比定。
// 这一章不打断流水线：团队页没写人名时整章 skipped 并说原因。

const MAX_MEMBERS = 5;

export type Level = '强' | '中' | '弱' | '待核实';
const LEVELS = new Set<Level>(['强', '中', '弱', '待核实']);

export interface TeamMember {
  name: string; role: string; bio: string;
  signals: { text: string; src: number[] }[];
  gaps: string; verifyPath: string;
  status: '已核实' | '部分核实' | '待外部核实';
}

export interface TeamDim { key: 'fmf' | 'complement' | 'external'; name: string; level: Level; evidence: string; gap: string }

export interface Team {
  skipped: string | null;
  overall: { level: Level; note: string };
  dims: TeamDim[];
  members: TeamMember[];
  advice: string[];
  /** 模型给的、但资料里没有这个人名字的印证条数（已丢掉）。 */
  droppedSignals: number;
  queries: string[];
  failedQueries: { q: string; error: string }[];
  sources: Source[];
  promptSource: 'skill' | 'default';
}

const str = (v: any) => String(v ?? '').trim();

/** 事实卡「团队」→ 成员（名字取 value 的第一段，必须是像人名的一段、且在 BP 原文里出现）。 */
export function membersOf(card: Pick<FactCard, 'sections'>, bpText: string): { name: string; role: string; bio: string }[] {
  const items = card.sections.find((s) => s.key === 'team')?.items.filter((i) => i.label !== 'missing' && i.value.trim()) || [];
  const nbp = norm(bpText);
  const out: { name: string; role: string; bio: string }[] = [];
  for (const it of items) {
    const name = it.value.split(/[，,：:（(、；;\s/|]/)[0].trim();
    const looksLikeName = /^[一-龥·]{2,5}$/.test(name) || /^[A-Za-z][A-Za-z.\- ]{1,30}$/.test(name);
    if (!looksLikeName || !nbp.includes(norm(name)) || out.some((m) => m.name === name)) continue;
    out.push({ name, role: it.field, bio: it.value });
    if (out.length >= MAX_MEMBERS) break;
  }
  return out;
}

/** 纯函数：模型输出 + 资料 → 核验过的团队评估。 */
export function buildTeam(parsed: any, roster: { name: string; role: string; bio: string }[], contents: Map<number, string>) {
  let droppedSignals = 0;
  const byName = new Map((Array.isArray(parsed?.members) ? parsed.members : []).map((m: any) => [str(m?.name), m]));
  const members: TeamMember[] = roster.map((r) => {
    const m: any = byName.get(r.name) || {};
    const signals: TeamMember['signals'] = [];
    for (const s of Array.isArray(m?.signals) ? m.signals : []) {
      const src = srcList(s?.src, contents);
      const text = str(s?.text);
      if (!text) continue;
      // 被引资料里必须出现这个人的名字：否则是同名的人、或者干脆是模型补的。
      if (!src.length || !nameBacked(r.name, src, contents)) { droppedSignals++; continue; }
      signals.push({ text, src });
    }
    return {
      name: r.name, role: r.role, bio: r.bio, signals,
      gaps: str(m?.gaps), verifyPath: str(m?.verify_path) || '前雇主公开报道 / 领英 / 专利库 / 工商任职记录',
      status: signals.length >= 2 ? '已核实' : signals.length === 1 ? '部分核实' : '待外部核实',
    };
  });
  const verified = members.filter((m) => m.status !== '待外部核实').length;
  const extLevel: Level = !members.length ? '待核实' : verified / members.length >= 0.6 ? '强' : verified > 0 ? '中' : '待核实';
  const dimRaw = (k: string) => parsed?.dims?.[k] || {};
  const lv = (v: any): Level => (LEVELS.has(v) ? v : '待核实');
  const dims: TeamDim[] = [
    { key: 'fmf', name: '创始人与赛道匹配度', level: lv(dimRaw('fmf').level), evidence: str(dimRaw('fmf').evidence), gap: str(dimRaw('fmf').gap) },
    { key: 'complement', name: '团队互补性', level: lv(dimRaw('complement').level), evidence: str(dimRaw('complement').evidence), gap: str(dimRaw('complement').gap) },
    {
      key: 'external', name: '外部验证', level: extLevel,
      evidence: `${members.length} 位核心成员中 ${verified} 位在公开资料里找到了印证（等级由系统按这个比例定）。${str(dimRaw('external').evidence)}`,
      gap: str(dimRaw('external').gap),
    },
  ];
  return {
    overall: { level: lv(parsed?.overall?.level), note: str(parsed?.overall?.note) },
    dims, members, advice: (Array.isArray(parsed?.advice) ? parsed.advice : []).map(str).filter(Boolean).slice(0, 6), droppedSignals,
  };
}

const skipped = (reason: string): Team => ({
  skipped: reason, overall: { level: '待核实', note: '' }, dims: [], members: [], advice: [], droppedSignals: 0,
  queries: [], failedQueries: [], sources: [], promptSource: 'default',
});

export async function runTeam(input: {
  card: FactCard; bpText: string; keywords?: Keywords; materials?: { exclude: Set<string>; extra: ExtraSource[] };
  filename: string; userId: string;
}): Promise<Team> {
  const roster = membersOf(input.card, input.bpText);
  if (!roster.length) return skipped('BP 的团队页里没有能认出来的人名（或事实卡没抽到团队），没法做外部核验。团队页写清每位核心成员的姓名和履历后重传。');
  const company = input.card.sections.find((s) => s.key === 'company')?.items.find((i) => i.field === '公司名称' && i.label !== 'missing')?.value || '';
  const alias = input.keywords?.aliases?.[0] || company.replace(/（.*?）|\(.*?\)|有限公司|股份|科技|集团/g, '').slice(0, 8);
  const queries = roster.flatMap((m) => [`"${m.name}" ${alias}`, `"${m.name}" ${m.role} 履历`]);
  let g;
  try {
    g = await gatherSources(queries, {
      chapter: '团队竞争力评估', focus: [...roster.map((m) => m.name), alias, '履历', '曾任', '毕业'],
      exclude: input.materials?.exclude, extra: input.materials?.extra, perQuery: 4,
    });
  } catch (e: any) {
    return { ...skipped(String(e?.message || e)), members: roster.map((r) => ({ ...r, signals: [], gaps: '', verifyPath: '', status: '待外部核实' as const })) };
  }
  const method = bpMethod(TEAM_SLOT, TEAM_METHOD);
  const parsed = await bpJson({
    system: `${method.text}

---
## 输出（系统规定，必须遵守）
- members 只能是下面名单里的人（name 一字不差），不要加人。
- 每条 signals 是一条外部印证（这个人做过什么、在哪任职、有什么公开成果），src 写资料编号；被引资料里必须出现这个人的名字，否则会被系统丢掉。
- dims 三个键：fmf（创始人与赛道匹配度）、complement（团队互补性）、external（外部验证）；level 只能是 强 / 中 / 弱 / 待核实。external 的等级由系统按核实比例重算。
- overall.level 同样四选一；advice 是 3-5 条可执行的核实 / 补强建议。

只输出 JSON：
{"overall":{"level":"","note":""},"dims":{"fmf":{"level":"","evidence":"","gap":""},"complement":{},"external":{}},
 "members":[{"name":"","signals":[{"text":"","src":[1]}],"gaps":"","verify_path":""}],"advice":[""]}`,
    user: `## 团队名单（来自 BP 事实卡）\n${roster.map((m) => `- ${m.name}（${m.role}）：${m.bio}`).join('\n')}\n\n## 公司\n${company}\n\n${DOCS_RULES}\n\n## 检索资料（编号即 src）\n${g.docs}`,
    userId: input.userId, operation: 'team', label: '团队竞争力评估', filename: input.filename, maxTokens: 10_000,
  });
  return {
    skipped: null, ...buildTeam(parsed, roster, g.contents),
    queries: g.queries, failedQueries: g.failedQueries, sources: g.sources, promptSource: method.origin,
  };
}
