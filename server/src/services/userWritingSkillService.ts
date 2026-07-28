import { getDatabase } from '../db/index.js';
import { v4 as uuidv4 } from 'uuid';

// 用户私有写作 skill 的数据层。所有操作都要传 userId 做归属隔离。
// 结构与管理员 skill 系统一致（主文件 + 引用文件 + {{ref}} 展开），但表和归属完全独立。

export interface UserWritingSkill {
  id: string;
  user_id: string;
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
}

export type SkillFileKind = 'main' | 'reference';

export interface UserSkillFile {
  id: string;
  skill_id: string;
  kind: SkillFileKind;
  filename: string;
  body: string;
  sort_order: number;
}

// ---------- Skill CRUD（带 user_id 归属校验）----------

export function listSkills(userId: string): UserWritingSkill[] {
  const db = getDatabase();
  return db
    .prepare('SELECT * FROM user_writing_skills WHERE user_id = ? ORDER BY updated_at DESC')
    .all(userId) as UserWritingSkill[];
}

export function getSkill(id: string, userId: string): UserWritingSkill | null {
  const db = getDatabase();
  const row = db
    .prepare('SELECT * FROM user_writing_skills WHERE id = ? AND user_id = ?')
    .get(id, userId) as UserWritingSkill | undefined;
  return row || null;
}

export function createSkill(userId: string, input: { name: string; description?: string }): UserWritingSkill {
  const db = getDatabase();
  const now = new Date().toISOString();
  const id = uuidv4();
  db.prepare(
    `INSERT INTO user_writing_skills (id, user_id, name, description, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, userId, input.name, input.description || '', now, now);
  // 自动创建主文件
  db.prepare(
    `INSERT INTO user_writing_skill_files (id, skill_id, kind, filename, body, sort_order, created_at, updated_at)
     VALUES (?, ?, 'main', 'SKILL.md', '', 0, ?, ?)`
  ).run(`${id}-main`, id, now, now);
  return getSkill(id, userId)!;
}

export function updateSkill(
  id: string,
  userId: string,
  patch: { name?: string; description?: string }
): UserWritingSkill | null {
  const db = getDatabase();
  const existing = getSkill(id, userId);
  if (!existing) return null;
  db.prepare('UPDATE user_writing_skills SET name = ?, description = ?, updated_at = ? WHERE id = ?').run(
    patch.name ?? existing.name,
    patch.description ?? existing.description,
    new Date().toISOString(),
    id
  );
  return getSkill(id, userId);
}

export function deleteSkill(id: string, userId: string): boolean {
  const db = getDatabase();
  if (!getSkill(id, userId)) return false;
  db.prepare('DELETE FROM user_writing_skill_files WHERE skill_id = ?').run(id);
  const info = db.prepare('DELETE FROM user_writing_skills WHERE id = ?').run(id);
  return info.changes > 0;
}

// ---------- 文件 ----------

export function listFiles(skillId: string, userId: string): UserSkillFile[] {
  const db = getDatabase();
  if (!getSkill(skillId, userId)) return [];
  return db
    .prepare(
      `SELECT id, skill_id, kind, filename, body, sort_order FROM user_writing_skill_files
       WHERE skill_id = ? ORDER BY (kind = 'main') DESC, sort_order ASC, filename ASC`
    )
    .all(skillId) as UserSkillFile[];
}

export function addFile(skillId: string, userId: string, input: { filename: string; body?: string }): UserSkillFile | null {
  const db = getDatabase();
  if (!getSkill(skillId, userId)) return null;
  const now = new Date().toISOString();
  const id = uuidv4();
  const maxOrder = db
    .prepare('SELECT COALESCE(MAX(sort_order),0) AS m FROM user_writing_skill_files WHERE skill_id = ?')
    .get(skillId) as { m: number };
  db.prepare(
    `INSERT INTO user_writing_skill_files (id, skill_id, kind, filename, body, sort_order, created_at, updated_at)
     VALUES (?, ?, 'reference', ?, ?, ?, ?, ?)`
  ).run(id, skillId, input.filename, input.body || '', maxOrder.m + 1, now, now);
  return db
    .prepare('SELECT id, skill_id, kind, filename, body, sort_order FROM user_writing_skill_files WHERE id = ?')
    .get(id) as UserSkillFile;
}

function getFileWithOwner(fileId: string, userId: string): UserSkillFile | null {
  const db = getDatabase();
  const row = db
    .prepare(
      `SELECT f.id, f.skill_id, f.kind, f.filename, f.body, f.sort_order
       FROM user_writing_skill_files f
       JOIN user_writing_skills s ON s.id = f.skill_id
       WHERE f.id = ? AND s.user_id = ?`
    )
    .get(fileId, userId) as UserSkillFile | undefined;
  return row || null;
}

export function updateFile(fileId: string, userId: string, patch: { filename?: string; body?: string }): UserSkillFile | null {
  const db = getDatabase();
  const existing = getFileWithOwner(fileId, userId);
  if (!existing) return null;
  const filename = existing.kind === 'main' ? existing.filename : patch.filename ?? existing.filename;
  const body = patch.body ?? existing.body;
  const now = new Date().toISOString();
  db.prepare('UPDATE user_writing_skill_files SET filename = ?, body = ?, updated_at = ? WHERE id = ?').run(
    filename,
    body,
    now,
    fileId
  );
  db.prepare('UPDATE user_writing_skills SET updated_at = ? WHERE id = ?').run(now, existing.skill_id);
  return getFileWithOwner(fileId, userId);
}

export function deleteFile(fileId: string, userId: string): { ok: boolean; reason?: string } {
  const existing = getFileWithOwner(fileId, userId);
  if (!existing) return { ok: false, reason: 'not found' };
  if (existing.kind === 'main') return { ok: false, reason: '主文件不可删除' };
  getDatabase().prepare('DELETE FROM user_writing_skill_files WHERE id = ?').run(fileId);
  return { ok: true };
}

// 设置主文件正文（refine 采纳时用）
export function setMainBody(skillId: string, userId: string, body: string): boolean {
  const db = getDatabase();
  if (!getSkill(skillId, userId)) return false;
  const now = new Date().toISOString();
  const info = db
    .prepare("UPDATE user_writing_skill_files SET body = ?, updated_at = ? WHERE skill_id = ? AND kind = 'main'")
    .run(body, now, skillId);
  db.prepare('UPDATE user_writing_skills SET updated_at = ? WHERE id = ?').run(now, skillId);
  return info.changes > 0;
}

// ---------- 组装 {{ref}} ----------

const REF_PLACEHOLDER = /\{\{\s*ref:\s*([^}]+?)\s*\}\}/g;
function normalizeFilename(name: string): string {
  return name.trim().replace(/\.md$/i, '').toLowerCase();
}

/** 组装 skill 的完整正文（主文件展开 {{ref}}）。返回主文件文本与展开后的完整文本。 */
export function assembleSkillBody(skillId: string, userId: string): { mainBody: string; assembled: string } {
  const files = listFiles(skillId, userId);
  const main = files.find((f) => f.kind === 'main');
  const refs = files.filter((f) => f.kind === 'reference');
  const refByName = new Map(refs.map((r) => [normalizeFilename(r.filename), r]));
  const used = new Set<string>();
  const mainBody = main?.body ?? '';
  const expanded = mainBody.replace(REF_PLACEHOLDER, (whole, rawName: string) => {
    const ref = refByName.get(normalizeFilename(rawName));
    if (!ref) return whole;
    used.add(ref.id);
    return `\n\n--- 参考资料：${ref.filename} ---\n${ref.body}\n--- 参考资料结束 ---\n`;
  });
  const leftover = refs
    .filter((r) => !used.has(r.id))
    .map((r) => `\n\n--- 参考资料：${r.filename} ---\n${r.body}\n--- 参考资料结束 ---\n`)
    .join('');
  return { mainBody, assembled: (expanded + leftover).trim() };
}

// ---------- 生成 / 调试的 prompt 构建 ----------

/** 文体：决定用哪套写作手艺。auto/缺省 = 让模型按主题素材自判。 */
export type WritingGenre = 'story' | 'lyric' | 'punchline' | 'auto';

/**
 * 把文体转成注入写作 prompt 的一段硬要求。story/auto 返回空串
 * （story 是默认手艺，写作规范正文已覆盖；auto 交给规范里的"文体自检"自判）。
 */
function buildGenreBlock(genre?: WritingGenre): string {
  if (genre === 'lyric') {
    return `## 本篇文体：抒情/随笔体（务必按此写，别套干货帖的骨架）
- 就写情感/关系/自我领悟，**不要给方法、不要列干货、不要结尾提问求互动**——强行加这些会毁掉它。
- 力量来自：只有作者知道的私人细节（具体的人、名字、一句原话、一个动作、一个时间点）+ 一个锋利、不落安全区的态度/价值观（有人会反对的那种）。
- 短句、断行、留白、克制，**不要填满、不要解释、不要总结**。力量在没说透。`;
  }
  if (genre === 'punchline') {
    return `## 本篇文体：金句/文案体（务必按此写，别写成故事帖）
- 先定**一个能反复变奏的母题**（通常是双关或一组对立概念），全篇是它的 N 个切面，不是 N 个不同意思。
- 写成 **N 个极短、并列、可独立被抄走的段落**（可配 emoji 分隔），不需要起承转合、不需要故事、不需要"我"的感悟。
- 这里**金句密集、对仗、排比是特征不是毛病**；真正要拼的是每段双关/机锋够不够意外、别落陈词滥调。`;
  }
  return '';
}

/** 生成时可选注入的上下文：真实素材、核心判断（根）、固定人设。 */
export interface GenerateContext {
  /** 逼问素材阶段收集到的问答，或用户直接补充的真实经历/数字/细节 */
  materials?: string;
  /** 立根阶段选定的核心判断（非共识、可生成全文） */
  root?: string;
  /** 固定作者人设（越用越像同一个真人） */
  persona?: string;
  /** 赛道/人群（注入后更贴合目标读者） */
  niche?: string;
  /** 文体：抒情/金句体走各自专属手艺；story/auto 用默认规范。 */
  genre?: WritingGenre;
  /**
   * 平台底座：人类化写作通则（WRITING_STYLE_SKILL，走 xhs-ask slot 由后台可配）。
   * 它是所有人都该守的人类化规范，拼在用户 skill 之前；用户 skill 只管个性（标题公式、语气、赛道套路）。
   * 两者叠加而非二选一，所以不冲突。
   */
  platformStyle?: string;
}

/**
 * 用 skill 生成整篇小红书笔记的 system prompt。
 * 除写作风格规范外，按需注入真实素材 / 核心判断 / 固定人设——
 * 这三样是把"无中生有的泛写"变成"有内核的真人写作"的关键，直接决定 AI 味轻重。
 */
export function buildGeneratePrompt(assembledSkill: string, ctx: GenerateContext = {}): string {
  const parts: string[] = [
    `你是一个真实的小红书创作者（不是 AI 助手），正在按下面的规范和素材创作一篇完整的小红书笔记。
产出要求：
- 直接输出成品笔记（标题 + 正文），不要解释、不要加"以下是"之类的话。
- 标题单独一行放最前面。
- 全文必须围绕【核心判断】层层展开：故事演示它、方法落地它。删掉任何一段，笔记的核心意思都应该塌掉。
- 优先使用【真实素材】里的具体细节（数字、场景、翻车、对话），不要用通用表达填空、不要编造素材。
- 严格遵守【写作风格规范】。`,
  ];
  const genreBlock = buildGenreBlock(ctx.genre);
  if (genreBlock) parts.push(genreBlock);
  if (ctx.persona) parts.push(`## 作者人设（全程用这个人的口吻和立场）\n${ctx.persona}`);
  if (ctx.niche) parts.push(`## 赛道/目标人群（内容要贴合这群人）\n${ctx.niche}`);
  if (ctx.root) parts.push(`## 核心判断（全文的生成引擎，每段都要能从它推导出来）\n${ctx.root}`);
  if (ctx.materials) parts.push(`## 真实素材（只用这里的具体细节，不足就宁可不写，不要编）\n${ctx.materials}`);
  // 底座在前、个性在后：平台通则打底，用户 skill 覆盖个性。两者叠加，冲突时以下面的用户 skill 为准。
  if (ctx.platformStyle) parts.push(`## 人类化写作通则（平台底座，必守）\n${ctx.platformStyle}`);
  if (assembledSkill) parts.push(`## 本 Skill 的个性化写作规范（在通则之上，冲突时以本节为准）\n${assembledSkill}`);
  return parts.join('\n\n');
}

/**
 * 炼句台：给一个母题/主题，先大量发散生成候选金句，再自筛出最"意外、不落俗套"的几条。
 * 原理——真人的神来之笔（"班味克星""云不存数据但能删心事"）也不是一次写对，是从一堆里挑出来的。
 * LLM 天生挑最顺的词，单条很难出彩；但"高温批量生成 + 按新颖度筛选"能把它逼近人类的创作过程。
 * 一次调用内完成两步：先内部发散 15-20 条，再淘汰陈词滥调、只留 5 条最意外的给用户挑。
 */
export function buildPunchlinePrompt(ctx: { theme: string; niche?: string; angle?: string }): string {
  return `你是一个文字功底极强的小红书文案手，最擅长把一个母题玩出各种意想不到的双关和机锋（像"班味克星""云不能存数据但能删心事"这种级别）。

## 母题/主题
${ctx.theme}${ctx.niche ? `\n## 赛道/人群（金句要戳中这群人）\n${ctx.niche}` : ''}${ctx.angle ? `\n## 侧重方向\n${ctx.angle}` : ''}

## 你的工作方式（务必照做，这是能不能出彩的关键）
1. 先在心里**发散生成 15-20 条**候选：双关、对立概念反转、旧词新解、把抽象情绪具象成一个画面。放开写，先要数量、要意外，别怕离谱。
2. 然后**残酷筛选**：把"一眼能猜到""人人都会这么写""形容词堆砌"的陈词滥调全部淘汰。只留下让人"想一下才懂、懂了会心一笑"的。
3. 最终**只交出 5 条最意外、最精准的**。

## 每条的标准
- 短、能独立成立、可直接抄进朋友圈/正文。
- 有一个"没想到"的点（双关、反转、错位），而不是把意思平铺直叙。
- 扣住主题和人群，不要为炫技而离题。

## 输出格式
只返回合法 JSON，不要 markdown 代码块：
{
  "lines": [
    {"text": "<一条金句>", "twist": "<一句话点出它意外/巧妙在哪>"}
  ]
}
给恰好 5 条，从最惊艳到次之排列。`;
}

/**
 * 打磨：定点狙击全文最平庸的几句。真人改稿不是整篇重来，而是揪出最弱的句子精修。
 * 让 AI 先选出"最像 AI、最可替换、最平庸"的 3 句，各给一个更意外/更具体的替换，
 * 程序再逐字定点替换（沿用 detect-rewrite 的 original→suggestion 契约）。
 * 与去味的区别：去味治"AI 指纹"，打磨治"平庸"——就算不像 AI，写得平也要提上去。
 */
export function buildPolishPrompt(
  title: string,
  body: string,
  voice: { persona?: string; niche?: string; genre?: WritingGenre } = {}
): string {
  const voiceBlock = buildVoiceBlock(voice);
  return `你是一个文字功底极强的资深写作者，正在帮作者打磨一篇小红书笔记。你的眼光极毒，一眼能看出哪句"写平了"。
${voiceBlock}
## 待打磨笔记
标题：${title || '(未填)'}
正文：
${body || '(未填)'}

## 你的任务
从正文里挑出**最平庸、最可替换、最缺记忆点的 3 句**（就是那种"意思对但谁都能这么写""形容词堆砌""太顺太可预测"的句子），每句给一个**更意外、更具体、更有质感**的改写。
- 改写要提高"用词意外度"：换成更具体的画面/数字/细节，或一个巧妙的说法，别只是换个近义词。
- 保住原意和作者口吻，只提升表达质感，不编造新事实。
- 挑真正平庸的，不为凑数动好句子；不足 3 句就少给几句。

## 输出格式
只返回合法 JSON，不要 markdown 代码块。\`original\` 必须与正文逐字一致（含标点），程序要用它定位替换：
{
  "polishes": [
    {"original": "<正文里最平庸的一句，逐字摘录>", "suggestion": "<更有质感的改写，可直接替换>", "why": "<一句话说明原句平在哪>"}
  ]
}`;
}

/**
 * 逼问素材：用户给个主题后，AI 先反问 3-5 个只有本人才知道答案的问题，
 * 逼出真实经历/数字/场景。这是去 AI 味最高杠杆的一步——泛写像 AI 就是因为没有独家素材。
 * 参考 gpt-engineer 的 clarify preprompt：动笔前先问，别急着生成。
 */
export function buildInterviewPrompt(topic: string, niche?: string): string {
  return `你是一个资深小红书创作者，正在帮朋友把一个主题写成有血有肉的爆款笔记。
但你还不能动笔——因为好内容的关键是**只有作者本人才知道的真实细节**，泛泛而谈一定像 AI 写的。

## 主题
${topic}${niche ? `\n\n## 赛道/人群\n${niche}` : ''}

## 你的任务
针对这个主题，向作者提出 3-5 个**只有 TA 亲身经历过才答得上来**的问题，逼出真实素材。好问题的方向：
- 具体场景与时间线（"你第一次用是什么时候？当时发生了什么？"）
- 具体数字（"花了多少钱？用了多久？效果具体怎么变的？"）
- 翻车/意外/改主意的瞬间（"有没有踩过坑？哪一刻让你改变了看法？"）
- 个人真实立场（"你最想吐槽它哪一点？会推荐给谁、不推荐给谁？"）

不要问宽泛的、查资料就能答的问题（如"这个产品有什么优点"）。每个问题都要能钓出一个具体细节。

## 输出格式
只返回合法 JSON，不要 markdown 代码块：
{
  "questions": [
    {"q": "<问题>", "why": "<一句话说明这个问题能钓出什么样的素材>"},
    ...
  ]
}`;
}

/**
 * 立根：基于主题 + 真实素材，产出 2-3 个"非共识核心判断"候选让用户选。
 * 核心判断是全文的生成引擎（删掉任何其他段落文章会塌，但每段都能从它推导出来）。
 * 参考 content-workshop 的 root-insight 五步法：非共识、带反面、能生成。
 */
export function buildRootPrompt(topic: string, materials: string, niche?: string): string {
  return `你是一个擅长找角度的资深内容创作者。你要为下面这个主题，提炼几个**核心判断（根）**候选。

核心判断的标准（严格遵守）：
1. **非共识**：反对它的人能说出"不对，我觉得……"。像"早睡很重要""要理性消费"这种共识不是判断，是常识，写出来必然像 AI。
2. **能生成全文**：用它能自然长出故事、方法、金句——不是一句孤立的结论。
3. **带反面**：每个判断都要想清楚"如果有人反对我，他会说什么"。
4. **扎根于真实素材**：判断要从下面的素材里长出来，不是凭空拔高。

## 主题
${topic}${niche ? `\n\n## 赛道/人群\n${niche}` : ''}

## 作者提供的真实素材
${materials || '(暂无，请基于主题给出，但提示作者补素材会更准)'}

## 输出格式
只返回合法 JSON，不要 markdown 代码块：
{
  "roots": [
    {
      "insight": "<一句话的核心判断，非共识、可生成全文>",
      "counter": "<反对者会怎么说>",
      "angle": "<用什么故事/切入点最能演示这个判断>"
    },
    ...
  ]
}
给 2-3 个候选，从不同角度切，别都是一个意思的换皮。`;
}

/**
 * 去味重写：拿 AI_DETECTION_SKILL 对全文打分 + 输出定点重写清单（original→suggestion）。
 * 程序据此做逐句替换，实现"生成→自检→定点重写"的自动闭环（self-refine 三角色的合并版）。
 */
export function buildDetectRewritePrompt(
  detectionSkill: string,
  title: string,
  body: string,
  voice: { persona?: string; niche?: string; genre?: WritingGenre } = {}
): string {
  const base = detectionSkill || '（未绑定检测 skill，按你对 AI 指纹的专业判断执行）';
  const voiceBlock = buildVoiceBlock(voice);
  return `${base}
${voiceBlock}
## 待检测笔记
标题：${title || '(未填)'}
正文：
${body || '(未填)'}

现在按上面的规则检测这篇笔记，输出 JSON。特别注意：\`rewrites\` 数组里每条的 \`original\` 必须与正文逐字一致（含标点），程序要用它定位替换；给 \`suggestion\` 时保持作者原有的口吻和立场。`;
}

/** 去味/改写时保持同一个真人口吻的公共上下文块（人设、赛道、文体）。 */
function buildVoiceBlock(voice: { persona?: string; niche?: string; genre?: WritingGenre }): string {
  const lines: string[] = [];
  if (voice.persona) lines.push(`作者人设（改写时保持这个人的口吻和立场）：${voice.persona}`);
  if (voice.niche) lines.push(`赛道/人群：${voice.niche}`);
  const voiceBlock = lines.length ? `\n## 作者口吻（务必贯穿改写）\n${lines.join('\n')}\n` : '';
  // 文体保护：去味时别用 story 的结构规则误伤金句/抒情体本色
  let genreBlock = '';
  if (voice.genre === 'punchline') {
    genreBlock = `\n## 本篇是金句/文案体（改写时保护文体本色）\n这是"一个母题多段变奏、可直接抄的短文案"。**金句密集、对仗、排比是它的正常特征，不要当作 AI 味删掉**；不要强行加故事、加起承转合。只需把落入陈词滥调、双关太老套的句子换得更意外、更具体。\n`;
  } else if (voice.genre === 'lyric') {
    genreBlock = `\n## 本篇是抒情/随笔体（改写时保护文体本色）\n这是写情感/关系/自我的随笔。**不要强行加方法、加干货、加结尾互动提问**；短句、断行、留白是本色不是缺陷。只需把空泛安全的抒情换成更私人、更锋利、更具体的表达。\n`;
  }
  return voiceBlock + genreBlock;
}

/**
 * 整篇去味重构：逐句替换搞不定"三拍循环 / 金句密度 / 段落均匀"这类**结构级**指纹——
 * 它们不在某一句里，而在段落编排上。这里让模型拿到检测规则后**整篇重写**，直接换骨架：
 * 打散三拍节奏、删掉大部分金句、把段落长度写得参差、留毛刺。返回可整篇替换的新正文。
 */
export function buildDeflavorRewritePrompt(
  detectionSkill: string,
  title: string,
  body: string,
  voice: { persona?: string; niche?: string; genre?: WritingGenre } = {}
): string {
  const base = detectionSkill || '（未绑定检测 skill，按你对 AI 指纹的专业判断执行）';
  const voiceBlock = buildVoiceBlock(voice);
  return `${base}
${voiceBlock}
---

上面是 AI 指纹的检测规则。下面这篇笔记被检测器判为高度疑似 AI。

**根本原因（务必理解）：检测器测的是困惑度——你的用词太可预测，每个词都挑了最顺、最常见的那个。** 结构上的三拍循环、段段金句、段落均匀，都是"用词太顺"的伴生。所以整篇重写的第一目标是**提高困惑度**：主动用不那么顺、更具体、更低频、更私人化的表达，避开最优雅的措辞。（实证：一句"用文学化/更具体的语言重写"就能大幅降检出率，机制就是拉高了困惑度。）

## 待去味笔记
标题：${title || '(未填)'}
正文：
${body || '(未填)'}

## 重写硬性要求（逐条做到，这是能不能过检测的关键）
1. **提高用词意外度（最重要）**：把通用词换成具体到"只有作者会这么说"的表达——具体场景、数字、品牌/地名、对话原话、私人化的比喻。把"效果很好"这类可替换的顺词，全部换成一个具体画面。宁可别扭精确，不要优雅通用。
2. **打破三拍循环**：绝不能连续 3 段都是"叙述→我的感悟→金句"。至少留 1 段纯叙述或纯对话，没有"我"的拔高、没有金句。
3. **砍金句**：全文能独立转发的警句 ≤2 句，且别都放段尾。其余用大白话平收、用没说完的细节收、用疑问收。
4. **段落长短参差**：至少 1 处单句成段，至少 1 段 5 行以上铺陈细节。不要每段都 2-4 行。
5. **加毛刺**：留 1-2 处真人痕迹——自我纠正（"不对，这么说不准确"）、跑题再拉回（"说远了"）、口语碎碎念。毛刺本身就在提困惑度。
6. **禁用**"不是X是Y"及其变体、FAQ 问答、对仗排比、AI 式转场钩子。
7. **保住内容内核 + 作者口吻**：观点、真实细节、数字、故事都要留住，只改表达和结构，不写空、不编新素材；若上面给了作者人设，全程用同一个人的口吻和立场，别改成另一个人在说话。
8. 口语、松弛、允许不完美，像一个人随手发的，不像交作业。

## 诚实告知（写进 notes）
你也是 AI，重写产物仍是模型的高概率用词，困惑度有原理性下限——本次能显著降低 AI 味，但不保证一定过检测。若你判断仅靠重写还不够，请在 notes 里明确提示："建议作者手动改动几处、塞进只有本人知道的真实细节（数字/对话/翻车瞬间），这是最有效的提困惑度手段"。

## 输出格式
只返回合法 JSON，不要 markdown 代码块：
{
  "title": "<重写后的标题，若原标题没问题可原样返回>",
  "body": "<整篇重写后的正文，可直接整篇替换>",
  "notes": ["<一句话说明你动了哪些结构问题>", "..."]
}`;
}

/**
 * 联网补料 · 第一步：把主题+素材+核心判断转成 2-3 条精准搜索 query。
 * 目的是查回"用户自己不掌握的外部事实"（最新数据、行业现状、别人的说法、可对照的案例），
 * 而不是查用户已经提供的东西。query 要具体、可搜，别太宽泛。
 */
export function buildSearchQueryPrompt(topic: string, materials: string, root?: string, niche?: string): string {
  return `你在帮一个小红书创作者查资料。基于下面的主题和已有素材，生成 2-3 条**能用搜索引擎查到有用外部信息**的查询词。

## 主题
${topic}${niche ? `\n## 赛道/人群\n${niche}` : ''}${root ? `\n## 核心判断\n${root}` : ''}

## 作者已有的真实素材（不要重复查这些，要查作者没有的外部信息）
${materials || '(暂无)'}

## 要求
- 每条 query 针对一个"作者补不上、但能让内容更硬"的方向：最新数据/价格、行业现状、权威说法、可对照的第三方案例、常见误区。
- query 要像人在搜索框里打的词，具体、有信息量，别是宽泛的一句话。
- 别查作者已经知道的、或纯主观的东西。

## 输出格式
只返回合法 JSON，不要 markdown 代码块：
{ "queries": ["<查询词1>", "<查询词2>", "<查询词3>"] }`;
}

/**
 * 联网补料 · 第二步：把搜索结果（带来源）汇总成"可用的外部补充点"。
 * 每条必须标出处（来源序号），且如实说明"这是外部信息、需作者核实"，
 * 不编造数字、不把搜索结果当成作者的亲身经历。
 */
export function buildEnrichSummaryPrompt(
  topic: string,
  root: string | undefined,
  searchBlock: string
): string {
  return `你在帮小红书创作者整理联网查到的外部资料。下面是针对主题的搜索结果（每条带序号和来源链接）。

## 主题
${topic}${root ? `\n## 核心判断\n${root}` : ''}

## 联网搜索结果
${searchBlock}

## 你的任务
从上面结果里挑出**对这篇笔记真正有用**的补充点（能增强说服力的数据、事实、对照、误区），整理成若干条。纪律：
1. 每条都要能对应到来源（给出 sourceIndex，就是上面结果的序号）。
2. **不要编造**数字或事实；结果里没有的，不要写。
3. 明确这是"外部信息、供参考"，不是作者的亲身经历——作者要自己核实后再用。
4. 挑 3-6 条最有用的，宁缺毋滥。没有有价值的就返回空数组。

## 输出格式
只返回合法 JSON，不要 markdown 代码块：
{
  "facts": [
    {"point": "<一句话补充点，客观陈述>", "sourceIndex": <对应上面结果的序号，整数>, "caution": "<可选：用这条时要注意什么/需核实什么>"}
  ]
}`;
}

/** 共写：段落大纲里的一段 */
export interface CoWriteSection {
  heading: string; // 这段的小标题/要点
  goal: string; // 这段要达成什么（承担全文哪一步）
}

/**
 * "一起完成"模式 · 大纲：基于素材/根/补料，产出一个**分段写作大纲**（不是文章正文）。
 * 每段一句话说"要讲什么、承担全文哪一步"，供用户增删改后再逐段共写。
 */
export function buildOutlinePrompt(ctx: {
  topic: string;
  materials?: string;
  root?: string;
  persona?: string;
  enrichment?: string;
  niche?: string;
  genre?: WritingGenre;
  platformStyle?: string;
}): string {
  const genreBlock = buildGenreBlock(ctx.genre);
  const flow =
    ctx.genre === 'punchline'
      ? `把全文拆成若干**并列的短段落**，每段一句话说清"这段用母题的哪个切面/双关"。不需要起承转合，各段可独立成立。`
      : ctx.genre === 'lyric'
        ? `把全文拆成若干段落，每段一句话说清"这段写哪一层情感/关系/领悟"。不要安排"方法段""互动段"，顺着情绪走即可。`
        : `把全文拆成 4-7 个段落，每段用一句话说清"这段要讲什么、它在为核心判断承担哪一步"。大纲要能让读者一路被带着走：开头钩子 → 展开/演示 → 落地 → 收尾互动。每段都要能从核心判断推导出来。`;
  const parts: string[] = [
    `你是一个资深小红书创作者，正在和作者一起规划一篇笔记的结构。现在**只出大纲，不要写正文**。
${flow}`,
  ];
  if (genreBlock) parts.push(genreBlock);
  if (ctx.persona) parts.push(`## 作者人设\n${ctx.persona}`);
  parts.push(`## 主题\n${ctx.topic}${ctx.niche ? `\n## 赛道/人群\n${ctx.niche}` : ''}`);
  if (ctx.root) parts.push(`## 核心判断（全文引擎，每段都要为它服务）\n${ctx.root}`);
  if (ctx.materials) parts.push(`## 真实素材（优先安排进段落，别浪费）\n${ctx.materials}`);
  if (ctx.enrichment) parts.push(`## 联网补充的外部信息（可作为佐证，作者已核实）\n${ctx.enrichment}`);
  if (ctx.platformStyle) parts.push(`## 人类化写作通则（打底）\n${ctx.platformStyle}`);
  parts.push(`## 输出格式
只返回合法 JSON，不要 markdown 代码块：
{
  "sections": [
    {"heading": "<这段的要点/小标题>", "goal": "<这段要讲什么、承担全文哪一步>"}
  ]
}`);
  return parts.join('\n\n');
}

/**
 * 大纲共创 · 讨论调整：作者对当前大纲提意见（拆段/调序/补案例/换角度…），
 * AI **直接返回调整后的整份新大纲**（不是零散建议），作者拿到后继续增删改。
 */
export function buildDiscussOutlinePrompt(ctx: {
  topic: string;
  root?: string;
  materials?: string;
  enrichment?: string;
  niche?: string;
  currentOutline: CoWriteSection[];
  feedback: string;
  platformStyle?: string;
}): string {
  const outlineText = ctx.currentOutline.map((s, i) => `${i + 1}. ${s.heading} —— ${s.goal}`).join('\n');
  const parts: string[] = [
    `你是一个资深小红书创作者，正在和作者一起打磨一篇笔记的**大纲**。作者对当前大纲提了意见。
请按意见调整，**直接输出调整后的整份新大纲**（保留没问题的段、改动该改的段、可增删段、可调序），不要只给零散建议。仍然只出大纲、不写正文。每段都要能为核心判断服务。`,
  ];
  parts.push(`## 主题\n${ctx.topic}${ctx.niche ? `\n## 赛道/人群\n${ctx.niche}` : ''}`);
  if (ctx.root) parts.push(`## 核心判断（每段都要为它服务）\n${ctx.root}`);
  if (ctx.materials) parts.push(`## 真实素材\n${ctx.materials}`);
  if (ctx.enrichment) parts.push(`## 联网补充的外部信息\n${ctx.enrichment}`);
  parts.push(`## 当前大纲\n${outlineText}`);
  parts.push(`## 作者的意见\n${ctx.feedback}`);
  if (ctx.platformStyle) parts.push(`## 人类化写作通则（打底）\n${ctx.platformStyle}`);
  parts.push(`## 输出格式
只返回合法 JSON，不要 markdown 代码块：
{
  "sections": [
    {"heading": "<这段的要点/小标题>", "goal": "<这段要讲什么、承担全文哪一步>"}
  ],
  "note": "<一句话说明你按意见做了哪些调整>"
}`);
  return parts.join('\n\n');
}

/**
 * 用定稿大纲一次性生成整篇的 system prompt。
 * 大纲已由作者确认，是全文的结构骨架——按段落顺序写全，注入素材/根/人设/外部佐证。
 */
export function buildGenerateFromOutlinePrompt(ctx: {
  topic: string;
  outline: CoWriteSection[];
  materials?: string;
  root?: string;
  persona?: string;
  enrichment?: string;
  niche?: string;
  genre?: WritingGenre;
  platformStyle?: string;
}): string {
  const outlineText = ctx.outline.map((s, i) => `${i + 1}. ${s.heading} —— ${s.goal}`).join('\n');
  const genreBlock = buildGenreBlock(ctx.genre);
  const coreLine =
    ctx.genre === 'lyric' || ctx.genre === 'punchline'
      ? '' // 抒情/金句体不套"每段为核心判断服务"这条 story 专属要求
      : '\n- 全文必须围绕【核心判断】，删掉任何一段核心意思都应塌掉。';
  const parts: string[] = [
    `你是一个真实的小红书创作者（不是 AI 助手），正在按作者已确认的大纲写一篇完整的小红书笔记。
产出要求：
- 直接输出成品笔记（标题 + 正文），不要解释、不要加"以下是"之类的话。标题单独一行放最前面。
- **严格按下面的大纲逐段展开**，每段落实它对应的要点和目标，顺序不要乱。${coreLine}
- 优先使用【真实素材】里的具体细节（数字、场景、翻车、对话），不要用通用表达填空、不要编造素材。`,
  ];
  if (genreBlock) parts.push(genreBlock);
  parts.push(`## 主题\n${ctx.topic}${ctx.niche ? `\n## 赛道/人群\n${ctx.niche}` : ''}`);
  if (ctx.persona) parts.push(`## 作者人设（全程用这个人的口吻和立场）\n${ctx.persona}`);
  if (ctx.root) parts.push(`## 核心判断（全文引擎）\n${ctx.root}`);
  parts.push(`## 已确认的大纲（按此逐段写）\n${outlineText}`);
  if (ctx.materials) parts.push(`## 真实素材（只用这里的具体细节，不足宁可不写，不要编）\n${ctx.materials}`);
  if (ctx.enrichment) parts.push(`## 联网补充的外部信息（可作佐证，作者已核实）\n${ctx.enrichment}`);
  if (ctx.platformStyle) parts.push(`## 人类化写作通则（必守）\n${ctx.platformStyle}`);
  return parts.join('\n\n');
}

/**
 * 冷启动：让 AI 帮用户搭第一版 skill。
 * 有范文时逆向提炼其共同套路；没范文时按描述给通用但结构化的初稿。
 * 关键：产出的是"写作规范"，不是某篇文章；有范文时要提炼规律而非照抄范文内容。
 */
export function buildScaffoldPrompt(description: string, samples: string[]): string {
  const hasSamples = samples.length > 0;
  const samplesBlock = hasSamples
    ? `\n\n## 用户提供的范文（${samples.length} 篇，请逆向分析它们的共同套路）\n${samples
        .map((s, i) => `### 范文 ${i + 1}\n${s}`)
        .join('\n\n')}`
    : '';

  return `你是一个资深的"写作风格提炼专家"。用户想要一份可复用的"写作风格 skill"（一份写作规范，之后用它生成同类文章）。

## 用户的需求描述
${description || '(未填写，请按范文推断)'}${samplesBlock}

## 你的任务
${hasSamples
  ? `逆向分析用户提供的范文，提炼出它们共同的、可复用的写作套路，写成一份写作风格规范。重点提炼：标题公式、开头钩子方式、正文结构、语气人称、情绪与共鸣手法、emoji/话题标签习惯、结尾互动方式。`
  : `根据用户描述，生成一份结构化、可执行的写作风格规范。`}

## 最重要的纪律
1. 产出的是"写作规范/方法论"，不是某一篇具体文章。
2. ${hasSamples ? '提炼范文里的"规律"，不要照抄范文的具体主题、句子、产品名。' : '规则要具体可执行，避免"要吸引人""要有干货"这类空话，给出可操作的标准。'}
3. 规则要能指导"未来所有同类文章"，而不是只适用一次。
4. 用 Markdown 组织，分点清晰，方便用户后续增删。

## 输出格式
只返回合法 JSON，不要 markdown 代码块：
{
  "suggestedName": "<给这个 skill 起个简短名字>",
  "description": "<一句话说明这个 skill 是干什么的>",
  "mainBody": "<完整的写作风格规范正文，Markdown 格式，可直接作为 skill 主文件>"
}`;
}

/**
 * 调试闭环的核心 prompt：让 AI 把用户对某次产出的具体意见，**抽象成对未来所有产出都成立的
 * 通用规则**，并给出改进后的完整主文件，同时说明改了哪几条、为什么。
 * 关键防陷阱：明确禁止把这次产出的一次性内容写死进 skill。
 */
export function buildRefinePrompt(currentMainBody: string, generatedOutput: string, userFeedback: string): string {
  return `你是一个"提示词工程师"，专门帮用户打磨"写作风格 skill"。

用户有一份写作 skill（下面的"当前 skill 主文件"），用它生成了一篇产出，现在对产出提了修改意见。
你的任务不是改这篇产出，而是**改进这份 skill**，让它以后生成的内容都能满足用户的意见。

## 最重要的纪律（务必遵守）
1. 把用户这一次的具体意见，**抽象成对未来所有产出都成立的通用规则**，再写进 skill。
   - 反例（禁止）：用户说"这篇标题改成《月薪5千存下10万》"，你就把这句标题写进 skill。
   - 正例（要这样）：提炼成规则"标题应包含具体数字制造反差，避免平铺直叙"。
2. 不要把这次产出里的一次性内容（具体主题、具体句子）塞进 skill。
3. 只在原 skill 基础上做**最小必要的增补/修改**，不要推翻重写、不要丢掉原有规则。
4. 保持 skill 是一份"写作规范"，而不是"某篇文章"。

## 当前 skill 主文件
${currentMainBody || '(空)'}

## 用这份 skill 生成的产出
${generatedOutput}

## 用户对产出的修改意见
${userFeedback}

## 输出格式
只返回合法 JSON，不要 markdown 代码块：
{
  "changes": ["用一句话描述你新增/修改的每一条规则，以及它对应用户的哪条意见", "..."],
  "newMainBody": "<改进后的完整 skill 主文件全文，可直接替换原文件>"
}`;
}
