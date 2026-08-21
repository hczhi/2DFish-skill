import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../../db/index.js';
import type { IntakeQuestion } from './intakeService.js';

// 补料问卷的读写（见 migrations/080）。一轮问卷一行。

export interface IntakeRound {
  id: string;
  gaps: string[];
  questions: IntakeQuestion[];
  answers: Record<string, string>;
  truncated: boolean;
  applied_at: string | null;
  applied_count: number;
  created_at: string;
}

function parse(row: any): IntakeRound {
  return {
    id: row.id,
    gaps: safeJson(row.gaps, []),
    questions: safeJson(row.questions, []),
    answers: safeJson(row.answers, {}),
    truncated: !!row.truncated,
    applied_at: row.applied_at || null,
    applied_count: row.applied_count || 0,
    created_at: row.created_at,
  };
}

function safeJson<T>(s: string, fallback: T): T {
  try {
    const v = JSON.parse(s || '');
    return v == null ? fallback : (v as T);
  } catch {
    return fallback;
  }
}

/**
 * 存一轮新问卷。**同时删掉这个项目里还没提交的旧轮次** —— 只显示最新那一轮的话，
 * 旧的那些行永远取不回来，留着只是让「已补过几轮」和实际对不上。
 * （前端在重出问卷之前要确认一次：没提交的答案就是这时候丢掉的。）
 */
export function saveRound(
  projectId: string,
  sheet: { gaps: string[]; questions: IntakeQuestion[]; truncated: boolean }
): IntakeRound {
  const db = getDatabase();
  const now = new Date().toISOString();
  const id = uuidv4();
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM consult_intake WHERE project_id = ? AND applied_at IS NULL').run(projectId);
    db.prepare(
      `INSERT INTO consult_intake (id, project_id, gaps, questions, answers, truncated, created_at, updated_at)
       VALUES (?, ?, ?, ?, '{}', ?, ?, ?)`
    ).run(id, projectId, JSON.stringify(sheet.gaps), JSON.stringify(sheet.questions), sheet.truncated ? 1 : 0, now, now);
  });
  tx();
  return parse(db.prepare('SELECT * FROM consult_intake WHERE id = ?').get(id));
}

/** 还没补进资料的那一轮（刷新页面靠它恢复）。没有就是 null。 */
export function openRound(projectId: string): IntakeRound | null {
  const db = getDatabase();
  const row = db
    .prepare(
      `SELECT * FROM consult_intake WHERE project_id = ? AND applied_at IS NULL
        ORDER BY created_at DESC, rowid DESC LIMIT 1`
    )
    .get(projectId);
  return row ? parse(row) : null;
}

/** 暂存填了一半的答案（前端逐题失焦时调）。已提交的那一轮不再接受改动。 */
export function saveDraftAnswers(
  projectId: string,
  roundId: string,
  answers: Record<string, string>
): boolean {
  const db = getDatabase();
  const r = db
    .prepare(
      `UPDATE consult_intake SET answers = ?, updated_at = ?
        WHERE id = ? AND project_id = ? AND applied_at IS NULL`
    )
    .run(JSON.stringify(answers), new Date().toISOString(), roundId, projectId);
  return r.changes > 0;
}

/**
 * 标记这一轮已经补进客户资料。**已经标过的返回 false** —— 调用方必须据此拒掉：
 * 同一轮补两遍（双击 / 用旧页面再点一次）会让同一批答案在资料里出现两份，
 * 而两次都回「已补充」；AI 读到重复的一段会当成两处独立印证。
 */
export function markApplied(
  projectId: string,
  roundId: string,
  answers: Record<string, string>,
  appliedCount: number
): boolean {
  const db = getDatabase();
  const now = new Date().toISOString();
  const r = db
    .prepare(
      `UPDATE consult_intake SET answers = ?, applied_at = ?, applied_count = ?, updated_at = ?
        WHERE id = ? AND project_id = ? AND applied_at IS NULL`
    )
    .run(JSON.stringify(answers), now, appliedCount, now, roundId, projectId);
  return r.changes > 0;
}

/** 已经补过几轮（界面上显示「已补过 N 轮」）。 */
export function countAppliedRounds(projectId: string): number {
  const db = getDatabase();
  const r = db
    .prepare('SELECT COUNT(*) AS n FROM consult_intake WHERE project_id = ? AND applied_at IS NOT NULL')
    .get(projectId) as { n: number };
  return r.n;
}

/**
 * 已经问过**并且客户答了**的题面。下一轮出题要把它们剔掉。
 *
 * 只算答了的：留空的题说明客户当时答不出来，再问一次是合理的；而答过的题再问一遍
 * 会让用户以为 AI 没读他刚补进去的东西 —— 他真的填第二遍之后，资料里同一个事实就有
 * 两份，AI 会拿它当两处独立印证，而界面上只是多了一段问答。
 */
export function answeredQuestions(projectId: string): string[] {
  const db = getDatabase();
  const rows = db
    .prepare(
      `SELECT questions, answers FROM consult_intake
        WHERE project_id = ? AND applied_at IS NOT NULL ORDER BY created_at ASC`
    )
    .all(projectId) as Array<{ questions: string; answers: string }>;
  const out: string[] = [];
  for (const row of rows) {
    const qs = safeJson<IntakeQuestion[]>(row.questions, []);
    const as = safeJson<Record<string, string>>(row.answers, {});
    for (const q of qs) {
      if (String(as[q.id] || '').trim() && q.question) out.push(q.question);
    }
  }
  return out;
}
