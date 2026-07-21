import { getDatabase } from '../db/index.js';
import { v4 as uuidv4 } from 'uuid';

// 通用 skill 系统的数据访问层。
// skill = 可复用的提示词知识（存 DB，后台可编辑）
// slot  = 前台 AI 功能点的命名锚点，代码里写死；用哪个 skill 由 binding 决定
// binding = slot -> skill 的映射

export interface Skill {
  id: string;
  key: string;
  name: string;
  description: string;
  body: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface SkillBinding {
  slot: string;
  skill_id: string | null;
  updated_at: string;
}

export type SkillFileKind = 'main' | 'reference';

export interface SkillFile {
  id: string;
  skill_id: string;
  kind: SkillFileKind;
  filename: string;
  body: string;
  sort_order: number;
}

interface SkillFileRow {
  id: string;
  skill_id: string;
  kind: SkillFileKind;
  filename: string;
  body: string;
  sort_order: number;
}

interface SkillRow {
  id: string;
  key: string;
  name: string;
  description: string;
  body: string;
  enabled: number;
  created_at: string;
  updated_at: string;
}

function rowToSkill(r: SkillRow): Skill {
  return { ...r, enabled: r.enabled === 1 };
}

// 已知的 slot 清单（后台下拉展示用）。新增前台功能点时在这里登记。
export const KNOWN_SLOTS: Array<{ slot: string; label: string }> = [
  { slot: 'xhs-ask', label: '小红书 · AI 陪写（问 AI）' },
  { slot: 'xhs-score', label: '小红书 · 爆款评分诊断' },
  { slot: 'seo-score', label: '文章 · SEO 评分' },
  { slot: 'ai-detection', label: '文章 · AI 味检测' },
];

// 主文件里引用引用文件的占位符：{{ref:filename}}（filename 可带或不带 .md）
const REF_PLACEHOLDER = /\{\{\s*ref:\s*([^}]+?)\s*\}\}/g;

function normalizeFilename(name: string): string {
  return name.trim().replace(/\.md$/i, '').toLowerCase();
}

/**
 * 组装一个 skill 的最终提示词文本：取主文件，把其中的 {{ref:xxx}} 占位符
 * 展开为对应引用文件的内容。找不到的引用原样保留占位符文字（便于后台发现拼错）。
 * 主文件里没显式引用的引用文件，会按 sort_order 追加到末尾（保证内容不丢）。
 */
export function assembleSkillBody(skillId: string): string {
  const files = listSkillFiles(skillId);
  const main = files.find((f) => f.kind === 'main');
  const refs = files.filter((f) => f.kind === 'reference');
  const refByName = new Map(refs.map((r) => [normalizeFilename(r.filename), r]));

  const usedRefs = new Set<string>();
  const mainBody = main?.body ?? '';
  const expanded = mainBody.replace(REF_PLACEHOLDER, (whole, rawName: string) => {
    const key = normalizeFilename(rawName);
    const ref = refByName.get(key);
    if (!ref) return whole; // 拼错的引用原样留下，方便排查
    usedRefs.add(ref.id);
    return `\n\n--- 参考资料：${ref.filename} ---\n${ref.body}\n--- 参考资料结束 ---\n`;
  });

  // 没被主文件显式引用的引用文件，追加到末尾，避免内容被“遗忘”。
  const leftover = refs
    .filter((r) => !usedRefs.has(r.id))
    .map((r) => `\n\n--- 参考资料：${r.filename} ---\n${r.body}\n--- 参考资料结束 ---\n`)
    .join('');

  return (expanded + leftover).trim();
}

/**
 * 取某个 slot 当前绑定的、启用状态的 skill 的完整组装文本。
 * 没绑定 / 绑定的 skill 不存在或被禁用 → 返回 null（调用方自行降级）。
 */
export function getSkillForSlot(slot: string): string | null {
  const db = getDatabase();
  const binding = db
    .prepare('SELECT skill_id FROM prompt_skill_bindings WHERE slot = ?')
    .get(slot) as { skill_id: string | null } | undefined;
  if (!binding || !binding.skill_id) return null;

  const row = db
    .prepare('SELECT id FROM prompt_skills WHERE id = ? AND enabled = 1')
    .get(binding.skill_id) as { id: string } | undefined;
  if (!row) return null;

  const assembled = assembleSkillBody(row.id);
  return assembled || null;
}

// ---------- Skill CRUD ----------

export function listSkills(): Skill[] {
  const db = getDatabase();
  const rows = db
    .prepare('SELECT * FROM prompt_skills ORDER BY updated_at DESC')
    .all() as SkillRow[];
  return rows.map(rowToSkill);
}

export function getSkill(id: string): Skill | null {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM prompt_skills WHERE id = ?').get(id) as SkillRow | undefined;
  return row ? rowToSkill(row) : null;
}

export function createSkill(input: {
  key: string;
  name: string;
  description?: string;
  body: string;
  enabled?: boolean;
}): Skill {
  const db = getDatabase();
  const now = new Date().toISOString();
  const id = uuidv4();
  // 注：prompt_skills.body 现在是主文件内容的镜像备份，真相源是 prompt_skill_files 里 kind='main' 的记录。
  db.prepare(
    `INSERT INTO prompt_skills (id, key, name, description, body, enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.key,
    input.name,
    input.description || '',
    input.body,
    input.enabled === false ? 0 : 1,
    now,
    now
  );
  // 同步创建主文件记录
  db.prepare(
    `INSERT INTO prompt_skill_files (id, skill_id, kind, filename, body, sort_order, created_at, updated_at)
     VALUES (?, ?, 'main', 'SKILL.md', ?, 0, ?, ?)`
  ).run(`${id}-main`, id, input.body, now, now);
  return getSkill(id)!;
}

export function updateSkill(
  id: string,
  patch: { name?: string; description?: string; body?: string; enabled?: boolean }
): Skill | null {
  const db = getDatabase();
  const existing = getSkill(id);
  if (!existing) return null;

  const next = {
    name: patch.name ?? existing.name,
    description: patch.description ?? existing.description,
    body: patch.body ?? existing.body,
    enabled: patch.enabled ?? existing.enabled,
  };
  db.prepare(
    `UPDATE prompt_skills SET name = ?, description = ?, body = ?, enabled = ?, updated_at = ? WHERE id = ?`
  ).run(next.name, next.description, next.body, next.enabled ? 1 : 0, new Date().toISOString(), id);
  return getSkill(id);
}

export function deleteSkill(id: string): boolean {
  const db = getDatabase();
  // 解绑所有指向它的 slot，避免留下悬空绑定
  db.prepare('UPDATE prompt_skill_bindings SET skill_id = NULL, updated_at = ? WHERE skill_id = ?').run(
    new Date().toISOString(),
    id
  );
  db.prepare('DELETE FROM prompt_skill_files WHERE skill_id = ?').run(id);
  const info = db.prepare('DELETE FROM prompt_skills WHERE id = ?').run(id);
  return info.changes > 0;
}

// ---------- Skill Files（一个 skill 的多个组成文件）----------

export function listSkillFiles(skillId: string): SkillFile[] {
  const db = getDatabase();
  return db
    .prepare(
      `SELECT id, skill_id, kind, filename, body, sort_order FROM prompt_skill_files
       WHERE skill_id = ? ORDER BY (kind = 'main') DESC, sort_order ASC, filename ASC`
    )
    .all(skillId) as SkillFileRow[];
}

/** 新增一个引用文件（reference）。主文件由 createSkill 自动创建，不走这里。 */
export function addSkillFile(input: { skillId: string; filename: string; body?: string }): SkillFile | null {
  const db = getDatabase();
  if (!getSkill(input.skillId)) return null;
  const now = new Date().toISOString();
  const id = uuidv4();
  const maxOrder = db
    .prepare("SELECT COALESCE(MAX(sort_order), 0) AS m FROM prompt_skill_files WHERE skill_id = ?")
    .get(input.skillId) as { m: number };
  db.prepare(
    `INSERT INTO prompt_skill_files (id, skill_id, kind, filename, body, sort_order, created_at, updated_at)
     VALUES (?, ?, 'reference', ?, ?, ?, ?, ?)`
  ).run(id, input.skillId, input.filename, input.body || '', maxOrder.m + 1, now, now);
  return db.prepare('SELECT id, skill_id, kind, filename, body, sort_order FROM prompt_skill_files WHERE id = ?').get(id) as SkillFileRow;
}

export function updateSkillFile(
  fileId: string,
  patch: { filename?: string; body?: string }
): SkillFile | null {
  const db = getDatabase();
  const existing = db
    .prepare('SELECT id, skill_id, kind, filename, body, sort_order FROM prompt_skill_files WHERE id = ?')
    .get(fileId) as SkillFileRow | undefined;
  if (!existing) return null;

  const filename = existing.kind === 'main' ? existing.filename : patch.filename ?? existing.filename;
  const body = patch.body ?? existing.body;
  const now = new Date().toISOString();
  db.prepare('UPDATE prompt_skill_files SET filename = ?, body = ?, updated_at = ? WHERE id = ?').run(
    filename,
    body,
    now,
    fileId
  );
  // 主文件内容变化时，同步镜像到 prompt_skills.body（保持向后兼容）
  if (existing.kind === 'main') {
    db.prepare('UPDATE prompt_skills SET body = ?, updated_at = ? WHERE id = ?').run(body, now, existing.skill_id);
  }
  return db.prepare('SELECT id, skill_id, kind, filename, body, sort_order FROM prompt_skill_files WHERE id = ?').get(fileId) as SkillFileRow;
}

/** 删除引用文件。主文件不允许删除。 */
export function deleteSkillFile(fileId: string): { ok: boolean; reason?: string } {
  const db = getDatabase();
  const existing = db
    .prepare("SELECT kind FROM prompt_skill_files WHERE id = ?")
    .get(fileId) as { kind: SkillFileKind } | undefined;
  if (!existing) return { ok: false, reason: 'not found' };
  if (existing.kind === 'main') return { ok: false, reason: '主文件不可删除' };
  db.prepare('DELETE FROM prompt_skill_files WHERE id = ?').run(fileId);
  return { ok: true };
}

// ---------- Binding ----------

/**
 * 返回所有已知 slot 及其当前绑定（未登记过绑定的 slot 也会返回，skill_id=null）。
 */
export function listBindings(): Array<{ slot: string; label: string; skill_id: string | null }> {
  const db = getDatabase();
  const rows = db.prepare('SELECT slot, skill_id FROM prompt_skill_bindings').all() as Array<{
    slot: string;
    skill_id: string | null;
  }>;
  const map = new Map(rows.map((r) => [r.slot, r.skill_id]));
  return KNOWN_SLOTS.map((s) => ({
    slot: s.slot,
    label: s.label,
    skill_id: map.get(s.slot) ?? null,
  }));
}

/**
 * 设置 slot 绑定的 skill（skillId 传 null 表示解绑）。
 */
export function setBinding(slot: string, skillId: string | null): void {
  const db = getDatabase();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO prompt_skill_bindings (slot, skill_id, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(slot) DO UPDATE SET skill_id = excluded.skill_id, updated_at = excluded.updated_at`
  ).run(slot, skillId, now);
}
