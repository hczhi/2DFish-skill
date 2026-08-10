// 飞书 Skill（aily 智能体技能）的增删改查 / 导入 / 冻结版本 / 校验 / 导出。
//
// 这个模块负责的是「一棵能被 aily 运行时正确执行的目录树」，
// 和 skillRegistryService（我们自己拼 prompt 用的文本 skill）是两套东西，
// 见 migrations/063 顶部的说明。
//
// 关于「发布」：飞书没有技能写入 API，所以发布 = 冻结版本 + 校验 + 注入变量
// + 导出目录树 + 人工上传 + 回来确认。exportSkill() 只做到「导出」那一步，
// 上线状态必须由人来确认（confirmDeployment）。
import { v4 as uuidv4 } from 'uuid';
import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import { getDatabase } from '../db/index.js';
import { encryptSecret, tryDecryptSecret, maskSecret } from '../core/secrets.js';

/**
 * 带 HTTP 状态码的业务错误。
 *
 * 状态码在**抛出的地方**定的，不是在 API 层猜的：之前 API 层靠中文关键词
 * 反猜状态码（「不存在」→404、「不能」→400），结果「目录不存在」这种
 * 参数错被判成 404，而「变量名只能是大写字母…」谁也没匹配上就成了 500。
 * 一条新错误消息落在哪个状态码上取决于它的措辞 —— 这种规则一定会错，
 * 而且错了没人看得出来。
 */
export class SkillError extends Error {
  status: number;
  issues?: ValidationIssue[];
  constructor(message: string, status = 400, issues?: ValidationIssue[]) {
    super(message);
    this.name = 'SkillError';
    this.status = status;
    if (issues) this.issues = issues;
  }
}

export interface AgentBot {
  id: string;
  name: string;
  agent_id: string;
  note: string;
  enabled: number;
  created_at: string;
  updated_at: string;
}

export interface AgentSkill {
  id: string;
  name: string;
  label: string;
  description: string;
  source: string;
  source_path: string;
  origin_skill_id: string | null;
  origin_version: number | null;
  enabled: number;
  created_at: string;
  updated_at: string;
}

export interface AgentSkillFile {
  id: string;
  skill_id: string;
  path: string;
  body: string;
  executable: number;
  created_at: string;
  updated_at: string;
}

export interface AgentSkillVersion {
  id: string;
  skill_id: string;
  version: number;
  manifest_json: string;
  note: string;
  created_by: string;
  created_at: string;
}

export interface AgentDeployment {
  id: string;
  skill_id: string;
  bot_id: string;
  version: number;
  status: 'exported' | 'live' | 'stale';
  note: string;
  exported_at: string | null;
  confirmed_at: string | null;
  created_at: string;
  updated_at: string;
}

/** 技能名 = aily 目录名，所以限制成目录名安全的字符。 */
export const SKILL_NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** 单个文件大小上限。技能包整体要走飞书上传，太大传不上去。 */
const MAX_FILE_BYTES = 512 * 1024;
const MAX_FILES = 200;

const now = () => new Date().toISOString();

// ---------------------------------------------------------------- 路径校验

/**
 * 校验并归一文件路径。
 *
 * 这里挡的是 `../` 和绝对路径：导出时我们要把这些 path 拼到一个目录下写盘，
 * 一个 `../../.ssh/authorized_keys` 就能写到目录外面去。后台是 admin 才能进，
 * 但「只有管理员能触发」不等于「可以不校验」—— 导入的目录是外部内容。
 */
export function normalizeSkillPath(raw: string): string {
  const input = String(raw || '').trim().replace(/\\/g, '/');
  if (!input) throw new SkillError('文件路径不能为空', 400);
  if (input.startsWith('/')) throw new SkillError(`文件路径不能是绝对路径: ${input}`, 400);
  const parts: string[] = [];
  for (const seg of input.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') throw new SkillError(`文件路径不能包含 ..: ${input}`, 400);
    parts.push(seg);
  }
  if (!parts.length) throw new SkillError(`文件路径无效: ${input}`, 400);
  const joined = parts.join('/');
  if (joined.length > 300) throw new SkillError(`文件路径过长: ${joined}`, 400);
  return joined;
}

// ---------------------------------------------------------------- bots

export function listBots(): AgentBot[] {
  return getDatabase()
    .prepare('SELECT * FROM agent_bots ORDER BY created_at')
    .all() as AgentBot[];
}

export function getBot(id: string): AgentBot | undefined {
  return getDatabase().prepare('SELECT * FROM agent_bots WHERE id = ?').get(id) as
    | AgentBot
    | undefined;
}

export function upsertBot(data: Partial<AgentBot> & { id?: string }): AgentBot {
  const db = getDatabase();
  const ts = now();
  const existing = data.id ? getBot(data.id) : undefined;
  const row: AgentBot = {
    id: data.id || uuidv4(),
    name: (data.name ?? existing?.name ?? '').trim(),
    agent_id: (data.agent_id ?? existing?.agent_id ?? '').trim(),
    note: data.note ?? existing?.note ?? '',
    enabled: data.enabled !== undefined ? (data.enabled ? 1 : 0) : existing?.enabled ?? 1,
    created_at: existing?.created_at ?? ts,
    updated_at: ts,
  };
  if (!row.name) throw new SkillError('账号名称不能为空', 400);
  db.prepare(
    `INSERT OR REPLACE INTO agent_bots (id, name, agent_id, note, enabled, created_at, updated_at)
     VALUES (@id, @name, @agent_id, @note, @enabled, @created_at, @updated_at)`
  ).run(row);
  return row;
}

export function deleteBot(id: string): void {
  getDatabase().prepare('DELETE FROM agent_bots WHERE id = ?').run(id);
}

// ---------------------------------------------------------------- 变量

export interface BotVariable {
  id: string;
  bot_id: string;
  key: string;
  value: string;
  is_secret: number;
  created_at: string;
  updated_at: string;
}

/** 列出变量。secret 的 value 会被脱敏 —— 后台列表页不该回显完整密钥。 */
export function listBotVariables(botId: string, reveal = false): BotVariable[] {
  const rows = getDatabase()
    .prepare('SELECT * FROM agent_bot_variables WHERE bot_id = ? ORDER BY key')
    .all(botId) as BotVariable[];
  return rows.map((r) => {
    const plain = r.is_secret ? tryDecryptSecret(r.value) ?? '' : r.value;
    return { ...r, value: reveal ? plain : r.is_secret ? maskSecret(plain) : plain };
  });
}

export function upsertBotVariable(data: {
  bot_id: string;
  key: string;
  value?: string;
  is_secret?: boolean;
}): BotVariable {
  const db = getDatabase();
  const ts = now();
  const key = String(data.key || '').trim();
  if (!/^[A-Z][A-Z0-9_]{0,63}$/.test(key)) {
    throw new SkillError('变量名只能是大写字母、数字和下划线，且以字母开头', 400);
  }
  const existing = db
    .prepare('SELECT * FROM agent_bot_variables WHERE bot_id = ? AND key = ?')
    .get(data.bot_id, key) as BotVariable | undefined;
  const isSecret = data.is_secret !== undefined ? (data.is_secret ? 1 : 0) : existing?.is_secret ?? 0;
  // 空 value 表示「不改动」：前端回显的是脱敏串，原样提交回来不该覆盖真值。
  const plain =
    data.value !== undefined && data.value !== ''
      ? data.value
      : existing
        ? existing.is_secret
          ? tryDecryptSecret(existing.value) ?? ''
          : existing.value
        : '';
  const row: BotVariable = {
    id: existing?.id || uuidv4(),
    bot_id: data.bot_id,
    key,
    value: isSecret ? encryptSecret(plain) : plain,
    is_secret: isSecret,
    created_at: existing?.created_at ?? ts,
    updated_at: ts,
  };
  db.prepare(
    `INSERT OR REPLACE INTO agent_bot_variables (id, bot_id, key, value, is_secret, created_at, updated_at)
     VALUES (@id, @bot_id, @key, @value, @is_secret, @created_at, @updated_at)`
  ).run(row);
  return { ...row, value: isSecret ? maskSecret(plain) : plain };
}

export function deleteBotVariable(id: string): void {
  getDatabase().prepare('DELETE FROM agent_bot_variables WHERE id = ?').run(id);
}

/** 取某账号的变量明文映射，只在导出时用。 */
function resolveVariables(botId: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const v of listBotVariables(botId, true)) out[v.key] = v.value;
  return out;
}

// ---------------------------------------------------------------- skills

export function listSkills(): (AgentSkill & { file_count: number; latest_version: number })[] {
  return getDatabase()
    .prepare(
      `SELECT s.*,
              (SELECT COUNT(*) FROM agent_skill_files f WHERE f.skill_id = s.id) AS file_count,
              COALESCE((SELECT MAX(version) FROM agent_skill_versions v WHERE v.skill_id = s.id), 0) AS latest_version
       FROM agent_skills s ORDER BY s.created_at`
    )
    .all() as any[];
}

export function getSkill(id: string): AgentSkill | undefined {
  return getDatabase().prepare('SELECT * FROM agent_skills WHERE id = ?').get(id) as
    | AgentSkill
    | undefined;
}

export function getSkillByName(name: string): AgentSkill | undefined {
  return getDatabase().prepare('SELECT * FROM agent_skills WHERE name = ?').get(name) as
    | AgentSkill
    | undefined;
}

export function createSkill(data: {
  name: string;
  label?: string;
  description?: string;
  source?: string;
  source_path?: string;
  origin_skill_id?: string | null;
  origin_version?: number | null;
  enabled?: boolean;
}): AgentSkill {
  const name = String(data.name || '').trim();
  if (!SKILL_NAME_RE.test(name)) {
    throw new SkillError('技能名只能是小写字母、数字和连字符，且以字母或数字开头', 400);
  }
  // 重名在这里就挡掉，而不是等 UNIQUE 约束报 SQLITE_CONSTRAINT ——
  // 那句英文原文会被原样送到界面上。
  if (getSkillByName(name)) {
    throw new SkillError(`技能「${name}」已存在`, 409);
  }
  const ts = now();
  const row: AgentSkill = {
    id: uuidv4(),
    name,
    label: data.label ?? '',
    description: data.description ?? '',
    source: data.source ?? 'manual',
    source_path: data.source_path ?? '',
    origin_skill_id: data.origin_skill_id ?? null,
    origin_version: data.origin_version ?? null,
    enabled: data.enabled === false ? 0 : 1,
    created_at: ts,
    updated_at: ts,
  };
  getDatabase()
    .prepare(
      `INSERT INTO agent_skills (id, name, label, description, source, source_path, origin_skill_id, origin_version, enabled, created_at, updated_at)
       VALUES (@id, @name, @label, @description, @source, @source_path, @origin_skill_id, @origin_version, @enabled, @created_at, @updated_at)`
    )
    .run(row);
  return row;
}

export function updateSkill(id: string, data: Partial<AgentSkill>): AgentSkill {
  const existing = getSkill(id);
  if (!existing) throw new SkillError('技能不存在', 404);
  if (data.name !== undefined && data.name !== existing.name) {
    if (!SKILL_NAME_RE.test(String(data.name).trim())) {
      throw new SkillError('技能名只能是小写字母、数字和连字符，且以字母或数字开头', 400);
    }
  }
  const row: AgentSkill = {
    ...existing,
    name: (data.name ?? existing.name).trim(),
    label: data.label ?? existing.label,
    description: data.description ?? existing.description,
    enabled: data.enabled !== undefined ? (data.enabled ? 1 : 0) : existing.enabled,
    updated_at: now(),
  };
  getDatabase()
    .prepare(
      `UPDATE agent_skills SET name=@name, label=@label, description=@description,
              enabled=@enabled, updated_at=@updated_at WHERE id=@id`
    )
    .run(row);
  // 改名之后，已上线的部署跑的还是老名字的技能目录。
  // 不标 stale 的话，界面上显示「已上线」，而线上那份和这里已经不是一回事了。
  if (row.name !== existing.name) markDeploymentsStale(id);
  return row;
}

export function deleteSkill(id: string): void {
  getDatabase().prepare('DELETE FROM agent_skills WHERE id = ?').run(id);
}

// ---------------------------------------------------------------- files

export function listSkillFiles(skillId: string): AgentSkillFile[] {
  return getDatabase()
    .prepare('SELECT * FROM agent_skill_files WHERE skill_id = ? ORDER BY path')
    .all(skillId) as AgentSkillFile[];
}

export function putSkillFile(data: {
  skill_id: string;
  path: string;
  body: string;
  executable?: boolean;
}): AgentSkillFile {
  const db = getDatabase();
  const p = normalizeSkillPath(data.path);
  const body = String(data.body ?? '');
  if (Buffer.byteLength(body, 'utf8') > MAX_FILE_BYTES) {
    throw new SkillError(`文件 ${p} 超过 ${MAX_FILE_BYTES / 1024}KB 上限`, 400);
  }
  const existing = db
    .prepare('SELECT * FROM agent_skill_files WHERE skill_id = ? AND path = ?')
    .get(data.skill_id, p) as AgentSkillFile | undefined;
  if (!existing) {
    const count = db
      .prepare('SELECT COUNT(*) AS n FROM agent_skill_files WHERE skill_id = ?')
      .get(data.skill_id) as { n: number };
    if (count.n >= MAX_FILES) throw new SkillError(`单个技能最多 ${MAX_FILES} 个文件`, 400);
  }
  const ts = now();
  const row: AgentSkillFile = {
    id: existing?.id || uuidv4(),
    skill_id: data.skill_id,
    path: p,
    body,
    executable:
      data.executable !== undefined
        ? data.executable
          ? 1
          : 0
        : existing?.executable ?? (p.endsWith('.py') || p.endsWith('.sh') ? 1 : 0),
    created_at: existing?.created_at ?? ts,
    updated_at: ts,
  };
  db.prepare(
    `INSERT OR REPLACE INTO agent_skill_files (id, skill_id, path, body, executable, created_at, updated_at)
     VALUES (@id, @skill_id, @path, @body, @executable, @created_at, @updated_at)`
  ).run(row);
  touchSkill(data.skill_id);
  if (p === 'SKILL.md') syncSkillMeta(data.skill_id, body);
  return row;
}

export function deleteSkillFile(skillId: string, fileId: string): void {
  getDatabase()
    .prepare('DELETE FROM agent_skill_files WHERE id = ? AND skill_id = ?')
    .run(fileId, skillId);
  touchSkill(skillId);
}

function touchSkill(skillId: string): void {
  getDatabase().prepare('UPDATE agent_skills SET updated_at = ? WHERE id = ?').run(now(), skillId);
  // 内容改了 → 已上线的部署变成「线上跑的是旧版」。
  markDeploymentsStale(skillId);
}

/** 把 SKILL.md frontmatter 里的 label/description 同步到技能行，方便列表页显示。 */
function syncSkillMeta(skillId: string, body: string): void {
  let data: Record<string, any> = {};
  try {
    data = (matter(body).data || {}) as Record<string, any>;
  } catch {
    return; // frontmatter 坏了不该让保存失败，校验那步会报出来
  }
  const label = typeof data.label === 'string' ? data.label : undefined;
  const description = typeof data.description === 'string' ? data.description : undefined;
  if (label === undefined && description === undefined) return;
  const existing = getSkill(skillId);
  if (!existing) return;
  getDatabase()
    .prepare('UPDATE agent_skills SET label = ?, description = ? WHERE id = ?')
    .run(label ?? existing.label, description ?? existing.description, skillId);
}

// ---------------------------------------------------------------- 校验

export interface ValidationIssue {
  level: 'error' | 'warning';
  message: string;
}

/**
 * 导出前校验。error 会阻止导出，warning 只提示。
 *
 * 这里每一条都对应一个**静默失效**的坑：技能能上传成功、能被触发，
 * 但跑起来行为不对，而后台显示「已发布」。
 */
export function validateSkill(skillId: string): ValidationIssue[] {
  const skill = getSkill(skillId);
  if (!skill) return [{ level: 'error', message: '技能不存在' }];
  const files = listSkillFiles(skillId);
  const issues: ValidationIssue[] = [];

  const main = files.find((f) => f.path === 'SKILL.md');
  if (!main) {
    issues.push({ level: 'error', message: '缺少 SKILL.md —— aily 靠它识别技能，没有这个文件技能不会被加载' });
    return issues;
  }

  let fm: Record<string, any> = {};
  let content = '';
  try {
    const parsed = matter(main.body);
    fm = (parsed.data || {}) as Record<string, any>;
    content = parsed.content || '';
  } catch (e: any) {
    issues.push({ level: 'error', message: `SKILL.md 的 frontmatter 解析失败：${e?.message || e}` });
    return issues;
  }

  if (!fm.name) {
    issues.push({ level: 'error', message: 'SKILL.md frontmatter 缺少 name' });
  } else if (String(fm.name).trim() !== skill.name) {
    // 三处名字必须一致，这是最容易踩且最难查的坑：技能能被触发，
    // 但 cd 进的是一个不存在的目录，用户看到的是「机器人说找不到脚本」。
    issues.push({
      level: 'error',
      message: `SKILL.md 里的 name「${fm.name}」和技能名「${skill.name}」不一致 —— 目录名、frontmatter、正文里的 cd 路径三处必须完全相同`,
    });
  }
  if (!fm.description) {
    issues.push({ level: 'error', message: 'SKILL.md frontmatter 缺少 description —— 智能体靠它判断什么时候用这个技能' });
  }

  // 正文里的 cd 路径
  const cdPaths = new Set<string>();
  for (const m of main.body.matchAll(/cd\s+~\/\.aily\/workspace\/skills\/([A-Za-z0-9._-]+)/g)) {
    cdPaths.add(m[1]);
  }
  for (const p of cdPaths) {
    if (p !== skill.name) {
      issues.push({
        level: 'error',
        message: `正文里的 cd 路径指向「${p}」，但技能名是「${skill.name}」—— 脚本会找不到`,
      });
    }
  }
  if (cdPaths.size === 0 && files.some((f) => f.path.endsWith('.py'))) {
    issues.push({
      level: 'warning',
      message: '技能里有 .py 脚本，但 SKILL.md 正文没写 cd ~/.aily/workspace/skills/<name> —— 智能体可能在错误的目录下执行',
    });
  }

  // 正文提到的脚本文件是否真的存在
  const paths = new Set(files.map((f) => f.path));
  for (const m of content.matchAll(/python3?\s+([A-Za-z0-9._\/-]+\.py)/g)) {
    const ref = m[1].replace(/^\.\//, '');
    if (!paths.has(ref)) {
      issues.push({
        level: 'error',
        message: `正文里调用了 ${ref}，但技能包里没有这个文件`,
      });
    }
  }
  // 引用的 references/*.md 同理
  for (const m of content.matchAll(/`(references\/[A-Za-z0-9._-]+\.md)`/g)) {
    if (!paths.has(m[1])) {
      issues.push({ level: 'warning', message: `正文引用了 ${m[1]}，但技能包里没有这个文件` });
    }
  }

  // 未注入的占位符 —— 导出时不带变量的话会原样进到线上
  const placeholders = new Set<string>();
  for (const f of files) {
    for (const m of f.body.matchAll(/\{\{([A-Z][A-Z0-9_]*)\}\}/g)) placeholders.add(m[1]);
  }
  if (placeholders.size) {
    issues.push({
      level: 'warning',
      message: `技能里有占位符 ${[...placeholders].join('、')} —— 导出时需要在账号变量里配好，否则会原样留在文件里`,
    });
  }

  // 明文密钥残留。这一条是 error：把它带进导出包，等于把我们平台的
  // 模块密钥交给对方企业的智能体后台，而且复制技能时会一起复制过去。
  for (const f of files) {
    if (/mmPla_[A-Za-z0-9]{8,}/.test(f.body)) {
      issues.push({
        level: 'error',
        message: `${f.path} 里出现了平台密钥明文（mmPla_...）—— 请改成 {{SERVER_API_TOKEN}} 这样的占位符，真值在导出时按账号注入`,
      });
    }
    if (/(app_secret|client_secret)\s*[:=]\s*["'][A-Za-z0-9]{10,}/.test(f.body)) {
      issues.push({
        level: 'error',
        message: `${f.path} 里像是写了 app_secret 明文 —— 改用占位符`,
      });
    }
  }

  return issues;
}

// ---------------------------------------------------------------- 版本

export function listVersions(skillId: string): Omit<AgentSkillVersion, 'manifest_json'>[] {
  return getDatabase()
    .prepare(
      `SELECT id, skill_id, version, note, created_by, created_at
       FROM agent_skill_versions WHERE skill_id = ? ORDER BY version DESC`
    )
    .all(skillId) as any[];
}

export function getVersion(skillId: string, version: number): AgentSkillVersion | undefined {
  return getDatabase()
    .prepare('SELECT * FROM agent_skill_versions WHERE skill_id = ? AND version = ?')
    .get(skillId, version) as AgentSkillVersion | undefined;
}

export interface Manifest {
  name: string;
  label: string;
  description: string;
  files: { path: string; body: string; executable: number }[];
  frozen_at: string;
}

/**
 * 冻结一个版本（全量快照）。
 *
 * 有 error 级校验问题时拒绝冻结：一个明知有问题的版本被冻结出来，
 * 之后就会有人拿它去导出、上传、然后困惑为什么不工作。
 */
export function freezeVersion(
  skillId: string,
  opts: { note?: string; createdBy?: string } = {}
): { version: number; issues: ValidationIssue[] } {
  const skill = getSkill(skillId);
  if (!skill) throw new SkillError('技能不存在', 404);
  const issues = validateSkill(skillId);
  const errors = issues.filter((i) => i.level === 'error');
  if (errors.length) {
    // issues 一起带上：前端要把每一条列出来，只说「校验未通过」用户不知道改哪。
    throw new SkillError(
      `技能校验未通过，无法冻结版本：\n- ${errors.map((e) => e.message).join('\n- ')}`,
      400,
      issues
    );
  }
  const db = getDatabase();
  const files = listSkillFiles(skillId);
  const manifest: Manifest = {
    name: skill.name,
    label: skill.label,
    description: skill.description,
    files: files.map((f) => ({ path: f.path, body: f.body, executable: f.executable })),
    frozen_at: now(),
  };
  const row = db
    .prepare('SELECT COALESCE(MAX(version), 0) AS v FROM agent_skill_versions WHERE skill_id = ?')
    .get(skillId) as { v: number };
  const version = row.v + 1;
  db.prepare(
    `INSERT INTO agent_skill_versions (id, skill_id, version, manifest_json, note, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(uuidv4(), skillId, version, JSON.stringify(manifest), opts.note ?? '', opts.createdBy ?? '', now());
  return { version, issues };
}

// ---------------------------------------------------------------- 导出

export interface ExportResult {
  skill_name: string;
  version: number;
  bot_id: string | null;
  files: { path: string; body: string; executable: number }[];
  injected: string[];
  /** 注入后仍然没被替换掉的占位符。必须显示出来，否则用户以为都配好了。 */
  unresolved: string[];
}

/**
 * 导出某版本的目录树，可选按账号注入变量。
 *
 * 不写盘、不打包 —— 返回文件内容，由 API 层决定是给 zip 还是给逐文件预览。
 * 这样「导出」这件事在测试里是纯函数，不依赖文件系统。
 */
export function exportVersion(
  skillId: string,
  version: number,
  botId?: string | null
): ExportResult {
  const snap = getVersion(skillId, version);
  if (!snap) throw new SkillError(`版本 v${version} 不存在`, 404);
  const manifest = JSON.parse(snap.manifest_json) as Manifest;
  const vars = botId ? resolveVariables(botId) : {};
  const injected = new Set<string>();
  const unresolved = new Set<string>();

  const files = manifest.files.map((f) => {
    const body = f.body.replace(/\{\{([A-Z][A-Z0-9_]*)\}\}/g, (whole, key: string) => {
      const val = vars[key];
      if (val === undefined || val === '') {
        // 留原样而不是替成空串：空串会让脚本拿着一个空 token 去调用，
        // 报出来的是 401，查半天才发现是变量没配。原样留着至少一眼能看出来。
        unresolved.add(key);
        return whole;
      }
      injected.add(key);
      return val;
    });
    return { path: f.path, body, executable: f.executable };
  });

  return {
    skill_name: manifest.name,
    version,
    bot_id: botId ?? null,
    files,
    injected: [...injected],
    unresolved: [...unresolved],
  };
}

// ---------------------------------------------------------------- 部署

export function listDeployments(skillId?: string): (AgentDeployment & { bot_name: string })[] {
  const db = getDatabase();
  const sql = `SELECT d.*, COALESCE(b.name, '(已删除)') AS bot_name
               FROM agent_skill_deployments d LEFT JOIN agent_bots b ON b.id = d.bot_id
               ${skillId ? 'WHERE d.skill_id = ?' : ''}
               ORDER BY d.updated_at DESC`;
  return (skillId ? db.prepare(sql).all(skillId) : db.prepare(sql).all()) as any[];
}

/** 记一次导出。status 是 exported —— 我们只知道文件给出去了，不知道用户传没传。 */
export function recordExport(skillId: string, botId: string, version: number): AgentDeployment {
  const db = getDatabase();
  const ts = now();
  const existing = db
    .prepare(
      'SELECT * FROM agent_skill_deployments WHERE skill_id = ? AND bot_id = ? AND version = ?'
    )
    .get(skillId, botId, version) as AgentDeployment | undefined;
  const row: AgentDeployment = {
    id: existing?.id || uuidv4(),
    skill_id: skillId,
    bot_id: botId,
    version,
    // 重新导出一个**已确认上线**的版本时不要把状态退回 exported：
    // 线上确实还在跑这个版本，退回去会让界面显示成「没上线」。
    status: existing?.status === 'live' ? 'live' : 'exported',
    note: existing?.note ?? '',
    exported_at: ts,
    confirmed_at: existing?.confirmed_at ?? null,
    created_at: existing?.created_at ?? ts,
    updated_at: ts,
  };
  db.prepare(
    `INSERT OR REPLACE INTO agent_skill_deployments
       (id, skill_id, bot_id, version, status, note, exported_at, confirmed_at, created_at, updated_at)
     VALUES (@id, @skill_id, @bot_id, @version, @status, @note, @exported_at, @confirmed_at, @created_at, @updated_at)`
  ).run(row);
  return row;
}

/**
 * 人工确认「我已经在智能体后台上传好了」。
 *
 * 同一个技能在同一个账号里只可能跑一个版本，所以确认新版本时
 * 把该账号下这个技能的其他 live 记录降级 —— 否则历史上每次确认都留着
 * 一条 live，界面上会同时显示三个版本都在线上。
 */
export function confirmDeployment(id: string, note?: string): AgentDeployment {
  const db = getDatabase();
  const dep = db.prepare('SELECT * FROM agent_skill_deployments WHERE id = ?').get(id) as
    | AgentDeployment
    | undefined;
  if (!dep) throw new SkillError('部署记录不存在', 404);
  const ts = now();
  db.prepare(
    `UPDATE agent_skill_deployments SET status = 'stale', updated_at = ?
     WHERE skill_id = ? AND bot_id = ? AND id <> ? AND status = 'live'`
  ).run(ts, dep.skill_id, dep.bot_id, id);
  db.prepare(
    `UPDATE agent_skill_deployments SET status = 'live', confirmed_at = ?, note = ?, updated_at = ?
     WHERE id = ?`
  ).run(ts, note ?? dep.note, ts, id);
  return db.prepare('SELECT * FROM agent_skill_deployments WHERE id = ?').get(id) as AgentDeployment;
}

/** 技能内容变更后，把已上线的部署标成「线上是旧版」。 */
function markDeploymentsStale(skillId: string): void {
  getDatabase()
    .prepare(
      `UPDATE agent_skill_deployments SET status = 'stale', updated_at = ?
       WHERE skill_id = ? AND status = 'live'`
    )
    .run(now(), skillId);
}

// ---------------------------------------------------------------- 导入

export interface ImportResult {
  skill: AgentSkill;
  files: string[];
  skipped: { path: string; reason: string }[];
}

/**
 * 校验并解析一个必须存在的目录路径。
 *
 * 三个入口（inspect / 单个导入 / 套件导入）都要先过这里，
 * 否则用户填错路径拿到的是 `ENOENT: no such file or directory, scandir ...`
 * 这种原文，看不出「填的是服务器上的路径」才是重点。
 */
function requireDirectory(dir: string): string {
  const root = path.resolve(String(dir || ''));
  let stat: fs.Stats;
  try {
    stat = fs.statSync(root);
  } catch {
    throw new SkillError(`目录不存在或无法访问：${root}（注意这里填的是服务器上的路径）`, 400);
  }
  if (!stat.isDirectory()) throw new SkillError(`不是目录：${root}`, 400);
  return root;
}

/**
 * 找出一个目录里所有的技能目录（自己 + 各级子目录里带 SKILL.md 的）。
 *
 * 现实里下发的常常是一个**套件**：根目录一个 SKILL.md 作总入口，
 * 下面每个子目录又是一个独立技能（director-diary-skills 就是 1 + 4）。
 * 不认这个结构的话，整棵树会被当成一个技能导进来 ——
 * 4 个子技能的 SKILL.md 变成普通文件，既不会被 aily 加载，
 * 也不会有任何报错，界面上还显示「导入成功，17 个文件」。
 *
 * 嵌套的技能目录不再往下走：它归它自己那条记录。
 */
export function detectSkillDirs(dir: string): { abs: string; rel: string }[] {
  const root = requireDirectory(dir);
  const found: { abs: string; rel: string }[] = [];
  const visit = (abs: string, rel: string) => {
    if (fs.existsSync(path.join(abs, 'SKILL.md'))) {
      found.push({ abs, rel });
      // 命中即止：这一层以下的内容属于这个技能自己（或它的子技能，
      // 由 importSkillTree 从顶层再扫一遍决定）。
    }
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      if (!entry.isDirectory() || SKIP_DIRS.has(entry.name)) continue;
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      visit(path.join(abs, entry.name), childRel);
    }
  };
  visit(root, '');
  return found;
}

/** 导入时跳过的东西：跳过什么必须报出来，静默少一个文件的技能跑起来是坏的。 */
const SKIP_DIRS = new Set(['__pycache__', '.git', '.venv', 'node_modules', '.DS_Store']);
const TEXT_EXT = new Set([
  '.md', '.py', '.json', '.txt', '.yaml', '.yml', '.sh', '.csv', '.toml', '.ini', '.cfg',
]);

/**
 * 从服务器本地目录导入一个技能。
 *
 * 只导文本文件：技能包里的内容本来就是 Markdown + Python，
 * 而二进制存进 TEXT 列会在导出时坏掉 —— 与其存一份坏的，不如跳过并说出来。
 */
export function importFromDirectory(
  dir: string,
  opts: { name?: string; source?: string; stopAtNestedSkills?: boolean } = {}
): ImportResult {
  const root = requireDirectory(dir);
  const mainPath = path.join(root, 'SKILL.md');
  if (!fs.existsSync(mainPath)) {
    throw new SkillError(`${root} 下没有 SKILL.md，不像是一个 aily 技能目录`, 400);
  }

  // 技能名优先用 frontmatter 里的 name，其次用目录名。
  // 用 frontmatter 优先是因为它才是 aily 实际认的那个名字。
  let fmName = '';
  let fmLabel = '';
  let fmDesc = '';
  try {
    const parsed = matter(fs.readFileSync(mainPath, 'utf8'));
    const data = (parsed.data || {}) as Record<string, any>;
    fmName = typeof data.name === 'string' ? data.name.trim() : '';
    fmLabel = typeof data.label === 'string' ? data.label : '';
    fmDesc = typeof data.description === 'string' ? data.description : '';
  } catch {
    // frontmatter 坏了也允许导入 —— 导进来才能在后台里修。
    // validateSkill 会把它报成 error，冻结版本时挡住。
  }
  const name = (opts.name || fmName || path.basename(root)).trim();
  if (!SKILL_NAME_RE.test(name)) {
    throw new SkillError(`技能名「${name}」不合法（只能是小写字母、数字、连字符）`, 400);
  }
  if (getSkillByName(name)) {
    throw new SkillError(`技能「${name}」已存在。请先删除或改名后再导入。`, 409);
  }

  const files: { path: string; body: string; executable: boolean }[] = [];
  const skipped: { path: string; reason: string }[] = [];

  const walk = (abs: string, rel: string) => {
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      const childAbs = path.join(abs, entry.name);
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) {
          skipped.push({ path: childRel, reason: '忽略目录' });
          continue;
        }
        if (opts.stopAtNestedSkills && fs.existsSync(path.join(childAbs, 'SKILL.md'))) {
          // 子目录自己就是一个技能，归它自己那条记录，不要塞进父技能里。
          skipped.push({ path: childRel, reason: '这是一个独立的子技能，单独导入' });
          continue;
        }
        walk(childAbs, childRel);
        continue;
      }
      if (entry.isSymbolicLink()) {
        // 软链接不跟：跟过去可能读到技能目录外面的文件，导进来的内容就不是用户以为的那份。
        skipped.push({ path: childRel, reason: '软链接，未跟随' });
        continue;
      }
      if (!entry.isFile()) {
        skipped.push({ path: childRel, reason: '不是普通文件' });
        continue;
      }
      const ext = path.extname(entry.name).toLowerCase();
      if (!TEXT_EXT.has(ext)) {
        skipped.push({ path: childRel, reason: `不支持的文件类型 ${ext || '(无扩展名)'}` });
        continue;
      }
      const size = fs.statSync(childAbs).size;
      if (size > MAX_FILE_BYTES) {
        skipped.push({ path: childRel, reason: `超过 ${MAX_FILE_BYTES / 1024}KB` });
        continue;
      }
      if (files.length >= MAX_FILES) {
        skipped.push({ path: childRel, reason: `超过 ${MAX_FILES} 个文件上限` });
        continue;
      }
      let body: string;
      try {
        body = fs.readFileSync(childAbs, 'utf8');
      } catch (e: any) {
        skipped.push({ path: childRel, reason: `读取失败：${e?.message || e}` });
        continue;
      }
      if (body.includes('\u0000')) {
        skipped.push({ path: childRel, reason: '看起来是二进制文件' });
        continue;
      }
      files.push({ path: childRel, body, executable: ext === '.py' || ext === '.sh' });
    }
  };
  walk(root, '');

  const db = getDatabase();
  const created = db.transaction(() => {
    const skill = createSkill({
      name,
      label: fmLabel,
      description: fmDesc,
      source: opts.source ?? 'import',
      source_path: root,
    });
    for (const f of files) {
      putSkillFile({ skill_id: skill.id, path: f.path, body: f.body, executable: f.executable });
    }
    return skill;
  })();

  return { skill: created, files: files.map((f) => f.path), skipped };
}

export interface TreeImportResult {
  imported: ImportResult[];
  /** 没导进来的技能目录，连原因一起。**必须显示** —— 见下面注释。 */
  failed: { rel: string; name: string; reason: string }[];
}

/**
 * 导入一棵技能树（一个目录里有多个 SKILL.md 的情况）。
 *
 * 逐个导入，**不放在一个事务里**：套件里常有几个子技能已经导过了，
 * 因为一个重名把另外三个也回滚掉，用户得先去删掉旧的才能重来。
 * 代价是会出现「部分成功」，所以 failed 必须原样返回并显示 ——
 * 只说「导入了 3 个技能」而不说另外 2 个为什么没进来，
 * 用户会以为整个套件都在库里了，直到某个功能死活触发不了。
 */
export function importSkillTree(
  dir: string,
  opts: { source?: string } = {}
): TreeImportResult {
  const root = requireDirectory(dir);
  const dirs = detectSkillDirs(root);
  if (!dirs.length) {
    throw new SkillError(`${root} 及其子目录里都没有 SKILL.md，不像是 aily 技能目录`, 400);
  }

  const imported: ImportResult[] = [];
  const failed: { rel: string; name: string; reason: string }[] = [];
  for (const d of dirs) {
    try {
      imported.push(
        importFromDirectory(d.abs, { source: opts.source ?? 'import', stopAtNestedSkills: true })
      );
    } catch (e: any) {
      failed.push({
        rel: d.rel || '(根目录)',
        name: readSkillDirName(d.abs),
        reason: String(e?.message || e),
      });
    }
  }
  return { imported, failed };
}

/** 只读 SKILL.md 的 name，用于报错/预览时指名道姓。读不到就空着，不猜。 */
export function readSkillDirName(abs: string): string {
  try {
    const data = (matter(fs.readFileSync(path.join(abs, 'SKILL.md'), 'utf8')).data || {}) as Record<
      string,
      any
    >;
    return typeof data.name === 'string' ? data.name.trim() : '';
  } catch {
    return '';
  }
}

/** 复制一个技能（带血缘，为以后 A→B 的差异合并留线索）。 */
export function copySkill(skillId: string, newName: string): AgentSkill {
  const src = getSkill(skillId);
  if (!src) throw new SkillError('技能不存在', 404);
  const name = String(newName || '').trim();
  if (!SKILL_NAME_RE.test(name)) throw new SkillError('技能名不合法', 400);
  if (getSkillByName(name)) throw new SkillError(`技能「${name}」已存在`, 409);
  const latest = getDatabase()
    .prepare('SELECT COALESCE(MAX(version), 0) AS v FROM agent_skill_versions WHERE skill_id = ?')
    .get(skillId) as { v: number };
  const files = listSkillFiles(skillId);
  return getDatabase().transaction(() => {
    const skill = createSkill({
      name,
      label: src.label,
      description: src.description,
      source: 'copy',
      origin_skill_id: src.id,
      origin_version: latest.v || null,
    });
    for (const f of files) {
      // SKILL.md 里的 name 和 cd 路径要跟着改名，否则复制出来的技能
      // 一冻结就报「三处名字不一致」，而用户不知道该改哪。
      const body =
        f.path === 'SKILL.md'
          ? f.body
              .replace(/^(name:\s*).*$/m, `$1${name}`)
              .replace(
                new RegExp(`(cd\\s+~/\\.aily/workspace/skills/)${src.name}\\b`, 'g'),
                `$1${name}`
              )
          : f.body.replace(
              new RegExp(`(~/\\.aily/workspace/skills/)${src.name}\\b`, 'g'),
              `$1${name}`
            );
      putSkillFile({ skill_id: skill.id, path: f.path, body, executable: !!f.executable });
    }
    return skill;
  })();
}
