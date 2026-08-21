import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../../db/index.js';
import { STAGES, stageByKey, unlockState, downstreamOf, type StageLane, type StageGroup } from './stages.js';

// 咨询项目的读写。所有查询都带 user_id —— 项目里是客户的经营数据，
// 只按 id 取的话换个账号带上别人的项目 id 就能读到整份诊断。

export interface ConsultProject {
  id: string;
  user_id: string;
  brand_name: string;
  brief: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface ConsultEntry {
  id: string;
  project_id: string;
  stage_key: string;
  /** 一句话总结（会跟着每一条定稿进下游 prompt） */
  conclusion: string;
  /** 正文 markdown：本步该有的那几张表都在这里。见 migration 078 */
  body: string;
  rationale: string;
  evidence: string;
  confidence: string;
  /**
   * 本步的 AI 赋能机会，**JSON 数组字符串**（见 migration 081）。
   * 单独一列而不是留在 body 的某一节里 —— 报告最后那一章「AI 转型机会清单」
   * 要按列取数，埋在正文里的话那一章会漏掉大半个模块而读起来完整。
   */
  ai_opportunities: string;
  source_level: string;
  stale: number;
  version: number;
  created_at: string;
  updated_at: string;
}

/** `ai_opportunities` 那一列 → 数组。存坏了当空数组，不抛错（一条定稿不该因为它读不出来而整条打不开）。 */
export function parseEntryAiOpportunities(raw: string): string[] {
  try {
    const v = JSON.parse(raw || '[]');
    return Array.isArray(v) ? v.map((x) => String(x ?? '').trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

/** 阶段栏的一行：代码里的阶段定义 + 这个项目在它上面的进度 */
export interface StageRailItem {
  key: string;
  label: string;
  group: StageGroup;
  lane: StageLane;
  question: string;
  /** 这一步该怎么想 —— 和进 prompt 的是同一份（stages.ts:StageDef.method） */
  method: string[];
  /** 本步应产出的东西 —— 界面上当勾选表用，见 stages.ts:StageDef.deliverables */
  deliverables: string[];
  status: 'pending' | 'exploring' | 'decided';
  round: number;
  unlocked: boolean;
  /** 还缺哪几个前置阶段（label，直接显示） */
  missing: string[];
  hasEntry: boolean;
  stale: boolean;
}

/** 资料上限。它会进四看每一次调用的 prompt，超了就截断的话用户看不出来。 */
export const MAX_BRIEF_CHARS = 20000;
export const MAX_BRAND_NAME_CHARS = 60;
/** 定稿字段上限。每条定稿都会进下游每一次调用的 prompt，同样只拒不截。 */
export const MAX_ENTRY_FIELD_CHARS = 4000;
/**
 * 正文上限。比其余字段松得多（正文里是好几张表），因为它只在**直接下游**的
 * prompt 里出现一次；但还是只拒不截 —— 截掉的是最后那张数据置信度表，
 * 而缺了那张表的正文读起来和完整的一模一样。
 */
export const MAX_ENTRY_BODY_CHARS = 20000;

export function listProjects(userId: string) {
  const db = getDatabase();
  const rows = db
    .prepare(
      `SELECT p.id, p.brand_name, p.status, p.created_at, p.updated_at,
              LENGTH(p.brief) AS brief_chars,
              (SELECT COUNT(*) FROM consult_entries e WHERE e.project_id = p.id) AS decided_count,
              (SELECT COUNT(*) FROM consult_entries e WHERE e.project_id = p.id AND e.stale = 1) AS stale_count
         FROM consult_projects p
        WHERE p.user_id = ?
        ORDER BY p.updated_at DESC`
    )
    .all(userId) as Array<{
    id: string;
    brand_name: string;
    status: string;
    created_at: string;
    updated_at: string;
    brief_chars: number;
    decided_count: number;
    stale_count: number;
  }>;
  // total_stages 一并返回：前端不该自己写死 12，改了阶段清单之后
  // 「3/12」会变成一个永远对不上的分母。
  return rows.map((r) => ({ ...r, total_stages: STAGES.length }));
}

export function createProject(userId: string, brandName: string, brief: string): ConsultProject {
  const db = getDatabase();
  const now = new Date().toISOString();
  const id = uuidv4();
  db.prepare(
    `INSERT INTO consult_projects (id, user_id, brand_name, brief, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'active', ?, ?)`
  ).run(id, userId, brandName, brief, now, now);
  return getProject(id, userId)!;
}

export function getProject(id: string, userId: string): ConsultProject | null {
  const db = getDatabase();
  return (
    (db
      .prepare('SELECT * FROM consult_projects WHERE id = ? AND user_id = ?')
      .get(id, userId) as ConsultProject | undefined) || null
  );
}

export function updateBrief(id: string, userId: string, brief: string): boolean {
  const db = getDatabase();
  const now = new Date().toISOString();
  const r = db
    .prepare('UPDATE consult_projects SET brief = ?, updated_at = ? WHERE id = ? AND user_id = ?')
    .run(brief, now, id, userId);
  return r.changes > 0;
}

export function renameProject(id: string, userId: string, brandName: string): boolean {
  const db = getDatabase();
  const now = new Date().toISOString();
  const r = db
    .prepare('UPDATE consult_projects SET brand_name = ?, updated_at = ? WHERE id = ? AND user_id = ?')
    .run(brandName, now, id, userId);
  return r.changes > 0;
}

/**
 * 删项目。子表要自己清 —— db/index.ts 没开 PRAGMA foreign_keys，
 * REFERENCES 只是注释，级联不会发生，留下的孤儿行不报错但会一直被计数查询算进去。
 */
export function deleteProject(id: string, userId: string): boolean {
  const db = getDatabase();
  const owned = getProject(id, userId);
  if (!owned) return false;
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM consult_intake WHERE project_id = ?').run(id);
    db.prepare('DELETE FROM consult_sources WHERE project_id = ?').run(id);
    db.prepare('DELETE FROM consult_messages WHERE project_id = ?').run(id);
    db.prepare('DELETE FROM consult_entries WHERE project_id = ?').run(id);
    db.prepare('DELETE FROM consult_stages WHERE project_id = ?').run(id);
    db.prepare('DELETE FROM consult_projects WHERE id = ?').run(id);
  });
  tx();
  return true;
}

export function listEntries(projectId: string): ConsultEntry[] {
  const db = getDatabase();
  return db
    .prepare('SELECT * FROM consult_entries WHERE project_id = ?')
    .all(projectId) as ConsultEntry[];
}

// ── 阶段内对话 ─────────────────────────────────────────────

export interface ConsultMessage {
  id: string;
  project_id: string;
  stage_key: string;
  role: 'user' | 'assistant';
  kind: 'text' | 'directions' | 'draft';
  content: string;
  /** kind != 'text' 时的结构化原文（JSON 字符串，前端照它渲染卡片） */
  payload: string;
  created_at: string;
}

/** 一句话的上限。它整段进 prompt，超了直接拒 —— 截断的话 AI 是照着半句话答的。 */
export const MAX_CHAT_CHARS = 3000;

/**
 * 往某个阶段的对话里追加一条。方向卡 / 草稿也走这里（kind='directions' / 'draft'），
 * 见 migrations/077 的注释：不存的话「第 2 个方向再往深挖」这句话没有指代对象，
 * AI 会一本正经地答别的东西。
 */
export function appendMessage(
  projectId: string,
  stageKey: string,
  msg: { role: ConsultMessage['role']; kind?: ConsultMessage['kind']; content: string; payload?: unknown }
): ConsultMessage {
  const db = getDatabase();
  const now = new Date().toISOString();
  const id = uuidv4();
  db.prepare(
    `INSERT INTO consult_messages (id, project_id, stage_key, role, kind, content, payload, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    projectId,
    stageKey,
    msg.role,
    msg.kind || 'text',
    msg.content,
    msg.payload === undefined ? '' : JSON.stringify(msg.payload),
    now
  );
  return db.prepare('SELECT * FROM consult_messages WHERE id = ?').get(id) as ConsultMessage;
}

/** 某个阶段的对话，按时间正序。**按 (project_id, stage_key) 取**，不按项目整段取。 */
export function listMessages(projectId: string, stageKey: string): ConsultMessage[] {
  const db = getDatabase();
  return db
    .prepare(
      'SELECT * FROM consult_messages WHERE project_id = ? AND stage_key = ? ORDER BY created_at ASC, rowid ASC'
    )
    .all(projectId, stageKey) as ConsultMessage[];
}

export interface SaveEntryInput {
  conclusion: string;
  body?: string;
  rationale?: string;
  evidence?: string;
  confidence?: string;
  /** 1-2 条 AI 赋能机会（原样存成 JSON 数组）。 */
  aiOpportunities?: string[];
  sourceLevel?: string;
}

/**
 * 记一次「这个阶段干到哪了」。round 只在真的又出了一轮草稿/方向时 +1，
 * 界面靠它显示「聊了几轮」—— 不记的话重复出草稿在界面上完全没有痕迹。
 */
export function touchStage(
  projectId: string,
  stageKey: string,
  status: 'pending' | 'exploring' | 'decided',
  opts: { incRound?: boolean } = {}
): void {
  const db = getDatabase();
  const now = new Date().toISOString();
  const existing = db
    .prepare('SELECT id, round FROM consult_stages WHERE project_id = ? AND stage_key = ?')
    .get(projectId, stageKey) as { id: string; round: number } | undefined;
  if (existing) {
    db.prepare('UPDATE consult_stages SET status = ?, round = ?, updated_at = ? WHERE id = ?').run(
      status,
      existing.round + (opts.incRound ? 1 : 0),
      now,
      existing.id
    );
  } else {
    db.prepare(
      `INSERT INTO consult_stages (id, project_id, stage_key, status, round, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(uuidv4(), projectId, stageKey, status, opts.incRound ? 1 : 0, now, now);
  }
}

/**
 * 定稿：把这一步的结论写进企业知识库，并把**全部下游**标成 stale。
 *
 * 标 stale 是这个函数存在的主要理由。四问是相互咬合的：改了品牌定位，价值主张/信任/
 * 关系全部要回头看一遍。不标的话下游那几条留着旧口径，最后的报告里两节互相矛盾，
 * 而中间没有任何一处报错 —— 用户拿到的是一份读起来很完整的自相矛盾的方案。
 *
 * 同时清掉自己的 stale（这一次就是在重跑）并把 version +1：版本号是他判断
 * 「知识库里这条是我改过的那版吗」的唯一线索。
 */
export function saveEntry(
  projectId: string,
  stageKey: string,
  input: SaveEntryInput
): { entry: ConsultEntry; staled: string[] } {
  const db = getDatabase();
  const now = new Date().toISOString();
  const down = downstreamOf(stageKey);

  const tx = db.transaction(() => {
    const existing = db
      .prepare('SELECT id, version FROM consult_entries WHERE project_id = ? AND stage_key = ?')
      .get(projectId, stageKey) as { id: string; version: number } | undefined;

    const aiOpps = JSON.stringify(input.aiOpportunities || []);
    if (existing) {
      db.prepare(
        `UPDATE consult_entries
            SET conclusion = ?, body = ?, rationale = ?, evidence = ?, confidence = ?,
                ai_opportunities = ?, source_level = ?,
                stale = 0, version = ?, updated_at = ?
          WHERE id = ?`
      ).run(
        input.conclusion,
        input.body || '',
        input.rationale || '',
        input.evidence || '',
        input.confidence || 'mid',
        aiOpps,
        input.sourceLevel || 'L1',
        existing.version + 1,
        now,
        existing.id
      );
    } else {
      db.prepare(
        `INSERT INTO consult_entries
           (id, project_id, stage_key, conclusion, body, rationale, evidence, confidence,
            ai_opportunities, source_level,
            stale, version, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?, ?)`
      ).run(
        uuidv4(),
        projectId,
        stageKey,
        input.conclusion,
        input.body || '',
        input.rationale || '',
        input.evidence || '',
        input.confidence || 'mid',
        aiOpps,
        input.sourceLevel || 'L1',
        now,
        now
      );
    }

    touchStage(projectId, stageKey, 'decided');

    let staled: string[] = [];
    if (down.length) {
      const placeholders = down.map(() => '?').join(',');
      db.prepare(
        `UPDATE consult_entries SET stale = 1, updated_at = ?
          WHERE project_id = ? AND stale = 0 AND stage_key IN (${placeholders})`
      ).run(now, projectId, ...down);
      // 回报的是「这次真被标上的」，不是全部下游 —— 报多了用户会去重跑没变的那些
      staled = (
        db
          .prepare(
            `SELECT stage_key FROM consult_entries
              WHERE project_id = ? AND stale = 1 AND stage_key IN (${placeholders})`
          )
          .all(projectId, ...down) as Array<{ stage_key: string }>
      ).map((r) => r.stage_key);
    }

    db.prepare('UPDATE consult_projects SET updated_at = ? WHERE id = ?').run(now, projectId);

    const entry = db
      .prepare('SELECT * FROM consult_entries WHERE project_id = ? AND stage_key = ?')
      .get(projectId, stageKey) as ConsultEntry;
    return { entry, staled };
  });

  return tx();
}

/**
 * 阶段栏。**以代码里的 STAGES 为准**去左连 consult_stages，
 * 不是按表里有哪些行渲染 —— 反过来的话以后新增的阶段对老项目永远不可见，
 * 报告照样能出，只是缺那一节，没有任何一处报错。
 */
export function buildStageRail(projectId: string): StageRailItem[] {
  const db = getDatabase();
  const rows = db
    .prepare('SELECT stage_key, status, round FROM consult_stages WHERE project_id = ?')
    .all(projectId) as Array<{ stage_key: string; status: string; round: number }>;
  const byKey = new Map(rows.map((r) => [r.stage_key, r]));
  const entries = new Map(listEntries(projectId).map((e) => [e.stage_key, e]));
  const decided = new Set(entries.keys());

  return STAGES.map((s) => {
    const row = byKey.get(s.key);
    const entry = entries.get(s.key);
    const { unlocked, missing } = unlockState(s, decided);
    return {
      key: s.key,
      label: s.label,
      group: s.group,
      lane: s.lane,
      question: s.question,
      method: s.method,
      deliverables: s.deliverables,
      // 有定稿就是 decided，不看 stages.status —— 两处状态不一致时以知识库为准，
      // 因为下游 prompt 读的是知识库。反过来会出现「显示已定稿但下游读不到」。
      status: entry ? 'decided' : ((row?.status as StageRailItem['status']) || 'pending'),
      round: row?.round ?? 0,
      unlocked,
      missing: missing.map((k) => stageByKey(k)?.label || k),
      hasEntry: !!entry,
      stale: !!entry?.stale,
    };
  });
}
