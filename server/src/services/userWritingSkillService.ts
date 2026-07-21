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

/** 用 skill 生成整篇小红书笔记的 system prompt。 */
export function buildGeneratePrompt(assembledSkill: string): string {
  const base = `你是一个资深小红书内容创作者，正在按用户提供的写作风格规范创作一篇完整的小红书笔记。
产出要求：
- 直接输出成品笔记（标题 + 正文），不要解释、不要加"以下是"之类的话。
- 标题单独一行放最前面。
- 严格遵守下面这份写作风格规范。`;
  return assembledSkill ? `${base}\n\n## 写作风格规范\n${assembledSkill}` : base;
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
