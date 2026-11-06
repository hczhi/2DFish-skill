import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../../db/index.js';
import { settlePoints, releasePoints, type PointHold } from '../appKeyService.js';

/**
 * 报告的归属键：三列 `(user_id, sdk_pk, external_uid)`（同 consult 085）。嵌入版所有终端用户共用绑定账号的
 * user_id，只按 user_id 查的话 A 客户的 BP 出现在 B 客户的列表里。SQL 一律 `IS ?`：`= NULL` 在 SQLite
 * 里永远不成立，网页登录 / key 用户（两列都是 NULL）会看到一个空列表而接口 200。
 * 必填参数而不是可选：漏改的调用点编译不过 —— 漏一处的后果是那一处读的是别人的报告。
 */
export interface BpOwner { userId: string; sdkPk: string | null; externalUid: string | null }
const OWNER_SQL = 'user_id = ? AND sdk_pk IS ? AND external_uid IS ?';
const ownerArgs = (o: BpOwner) => [o.userId, o.sdkPk, o.externalUid];
const owns = (r: BpReportRow, o: BpOwner) => r.user_id === o.userId && (r.sdk_pk ?? null) === o.sdkPk && (r.external_uid ?? null) === o.externalUid;

// BP 分析报告落库（migration 120）。一章跑完写一章，见那份注释。

export type BpReportStatus = 'running' | 'done' | 'failed' | 'interrupted';

export interface BpReportRow {
  id: string;
  user_id: string;
  filename: string;
  bp_text: string;
  empty_pages: number;
  status: BpReportStatus;
  step: string | null;
  error: string | null;
  result_json: string;
  notes_json: string;
  attachments_json: string;
  sdk_pk: string | null;
  external_uid: string | null;
  points_key_id: string | null;
  points_held: number;
  charged: number;
  created_at: string;
  finished_at: string | null;
}

export interface BpReport {
  id: string;
  filename: string;
  chars: number;
  status: BpReportStatus;
  step: string | null;
  error: string | null;
  result: Record<string, unknown>;
  notes: string[];
  attachments: { name: string; kind: string; chars: number; notes: string[] }[];
  /** 列表用：事实卡里的公司名、01 章的总分 / 梯队（还没跑到就是 null）。 */
  company: string | null;
  score: number | null;
  band: string | null;
  /** key 用户：这份报告冻结中的点数 / 是否已经扣过（扣过之后续跑、重跑不再扣）。 */
  pointsHeld: number;
  charged: boolean;
  created_at: string;
  finished_at: string | null;
}

function toReport(r: BpReportRow): BpReport {
  const result = JSON.parse(r.result_json || '{}');
  const name = result.factCard?.sections?.find((s: any) => s.key === 'company')?.items?.find((i: any) => i.field === '公司名称' && i.label !== 'missing')?.value;
  return {
    id: r.id,
    filename: r.filename,
    chars: r.bp_text.length,
    status: r.status,
    step: r.step,
    error: r.error,
    result,
    notes: JSON.parse(r.notes_json || '[]'),
    attachments: JSON.parse(r.attachments_json || '[]'),
    company: name || null,
    score: typeof result.diagnosis?.totalP === 'number' ? result.diagnosis.totalP : null,
    band: result.diagnosis?.band || null,
    pointsHeld: r.points_held || 0,
    charged: !!r.charged,
    created_at: r.created_at,
    finished_at: r.finished_at,
  };
}

export function createReport(input: {
  owner: BpOwner;
  /** key 用户开跑前冻结的那笔点数（整份报告一次），跑完结算、失败解冻。 */
  hold?: PointHold | null;
  filename: string;
  text: string;
  emptyPages: number;
  notes: string[];
  attachments?: { name: string; kind: string; chars: number; notes: string[] }[];
}): string {
  const id = uuidv4();
  getDatabase()
    .prepare(
      `INSERT INTO bp_reports (id, user_id, sdk_pk, external_uid, filename, bp_text, empty_pages, status, step, notes_json, attachments_json,
                               points_key_id, points_held, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'running', NULL, ?, ?, ?, ?, ?)`
    )
    .run(id, input.owner.userId, input.owner.sdkPk, input.owner.externalUid, input.filename, input.text, input.emptyPages,
      JSON.stringify(input.notes), JSON.stringify(input.attachments || []),
      input.hold?.keyId ?? null, input.hold?.price ?? 0, new Date().toISOString());
  return id;
}

export function getReportRow(id: string): BpReportRow | undefined {
  return getDatabase().prepare(`SELECT * FROM bp_reports WHERE id = ?`).get(id) as BpReportRow | undefined;
}

export function getReport(id: string, owner: BpOwner): BpReport | null {
  const r = getReportRow(id);
  return r && owns(r, owner) ? toReport(r) : null;
}

export function listReports(owner: BpOwner): Omit<BpReport, 'result' | 'notes'>[] {
  const rows = getDatabase()
    .prepare(`SELECT * FROM bp_reports WHERE ${OWNER_SQL} ORDER BY created_at DESC LIMIT 100`)
    .all(...ownerArgs(owner)) as BpReportRow[];
  return rows.map((r) => {
    const { result: _r, notes: _n, ...rest } = toReport(r);
    return rest;
  });
}

export function setStep(id: string, step: string): void {
  getDatabase().prepare(`UPDATE bp_reports SET step = ? WHERE id = ?`).run(step, id);
}

/** 一章跑完就写进 result_json 的那个键，后面的章挂了这一章照样在。 */
export function saveSection(id: string, key: string, value: unknown, notes: string[] = []): void {
  const db = getDatabase();
  db.transaction(() => {
    const r = getReportRow(id);
    if (!r) return;
    const result = JSON.parse(r.result_json || '{}');
    result[key] = value;
    const allNotes = [...JSON.parse(r.notes_json || '[]'), ...notes];
    db.prepare(`UPDATE bp_reports SET result_json = ?, notes_json = ? WHERE id = ?`)
      .run(JSON.stringify(result), JSON.stringify(allNotes), id);
  })();
}

const holdOf = (r: BpReportRow | undefined): PointHold | null =>
  r && r.points_held > 0 && r.points_key_id ? { keyId: r.points_key_id, price: r.points_held } : null;

/** 跑完：状态 + 结算冻结的点数（记一笔 charge 流水）在同一个事务里，只结算一次（charged 置 1）。 */
export function finishReport(id: string): void {
  const db = getDatabase();
  db.transaction(() => {
    const r = getReportRow(id);
    const c = db.prepare(`UPDATE bp_reports SET status = 'done', step = NULL, finished_at = ? WHERE id = ? AND status = 'running'`)
      .run(new Date().toISOString(), id).changes;
    const hold = holdOf(r);
    if (c && hold) {
      settlePoints(hold, 'bp-report');
      db.prepare(`UPDATE bp_reports SET points_held = 0, points_key_id = NULL, charged = 1 WHERE id = ?`).run(id);
    }
  })();
}

/**
 * 失败：`error` 存原文整段（空返回 / 截断 / 上游忙解法完全不同，合成一句「分析失败」等于指错方向），
 * 冻结的点数解冻、不留流水 —— 没出报告就不该出现在他的账单上；续跑成功时再冻结、再结算。
 */
export function failReport(id: string, error: string): void {
  const db = getDatabase();
  db.transaction(() => {
    const r = getReportRow(id);
    const c = db.prepare(`UPDATE bp_reports SET status = 'failed', error = ?, finished_at = ? WHERE id = ? AND status = 'running'`)
      .run(error, new Date().toISOString(), id).changes;
    const hold = holdOf(r);
    if (c && hold) {
      releasePoints(hold);
      db.prepare(`UPDATE bp_reports SET points_held = 0, points_key_id = NULL WHERE id = ?`).run(id);
    }
  })();
}

/**
 * 断点续跑：把 failed / interrupted / done（缺章的老报告）改回 running。条件写在 UPDATE 里 ——
 * 先读再写的话双击 / 两个标签页各自看见「失败」，两条流水线同时跑同一份报告，每章扣两次额度、后写的盖掉先写的。
 * 返回 false = 它已经在跑了（或不是自己的）。
 */
export function reopenReport(id: string, owner: BpOwner, hold: PointHold | null = null): boolean {
  return getDatabase()
    .prepare(
      `UPDATE bp_reports SET status = 'running', error = NULL, finished_at = NULL, points_key_id = ?, points_held = ?
        WHERE id = ? AND ${OWNER_SQL} AND status IN ('failed', 'interrupted', 'done')`
    )
    .run(hold?.keyId ?? null, hold?.price ?? 0, id, ...ownerArgs(owner)).changes === 1;
}

/**
 * 重跑某一章：清掉这几章的结果并改回 running，同一个事务、条件写在 UPDATE 里（同 `reopenReport`）。
 * `keys` 由调用方算（这一章 + 它后面所有章）—— 只清这一章的话后面几章还是拿旧结果算的，
 * 评分里写着上一批竞品，而两边各自读起来都正常。
 */
export function reopenForRerun(id: string, owner: BpOwner, keys: string[], hold: PointHold | null = null): boolean {
  const db = getDatabase();
  return db.transaction(() => {
    const r = getReportRow(id);
    if (!r || !owns(r, owner) || r.status === 'running') return false;
    const result = JSON.parse(r.result_json || '{}');
    for (const k of keys) delete result[k];
    return db
      .prepare(
        `UPDATE bp_reports SET status = 'running', error = NULL, finished_at = NULL, result_json = ?, points_key_id = ?, points_held = ?
          WHERE id = ? AND status != 'running'`
      )
      .run(JSON.stringify(result), hold?.keyId ?? null, hold?.price ?? 0, id).changes === 1;
  })();
}

/** 删除。跑着的不删：流水线下一章 saveSection 时那一行已经没了，额度照扣、结果无处可写。 */
export function deleteReport(id: string, owner: BpOwner): 'ok' | 'running' | 'missing' {
  const r = getReportRow(id);
  if (!r || !owns(r, owner)) return 'missing';
  const db = getDatabase();
  const n = db.transaction(() => {
    const c = db.prepare(`DELETE FROM bp_reports WHERE id = ? AND status != 'running'`).run(id).changes;
    // 补充资料跟着删：留着的话是一堆 BP 相关的正文挂在一份已经不存在的报告上，后台看不见、也删不掉。
    if (c) db.prepare(`DELETE FROM bp_report_materials WHERE report_id = ?`).run(id);
    if (c) db.prepare(`DELETE FROM bp_pitch_sessions WHERE report_id = ?`).run(id);
    return c;
  })();
  return n ? 'ok' : 'running';
}

/** 启动收尸：上一次进程里没跑完的标成中断，否则那份报告永远显示「分析中」。 */
export function reapInterruptedBpReports(): number {
  const db = getDatabase();
  // 冻结的点数先解冻：驱动它的进程没了，不解的话那几百点永远冻在 app_keys.frozen 里（余额够、可用点数却少一截）。
  const held = db.prepare(`SELECT * FROM bp_reports WHERE status = 'running' AND points_held > 0`).all() as BpReportRow[];
  for (const r of held) {
    releasePoints(holdOf(r));
    db.prepare(`UPDATE bp_reports SET points_held = 0, points_key_id = NULL WHERE id = ?`).run(r.id);
  }
  const n = db
    .prepare(
      `UPDATE bp_reports
          SET status = 'interrupted', finished_at = ?,
              error = '服务重启了，这份报告跑到一半断了（已经跑完的章节照常显示，冻结的点数已退回）。点「接着跑」继续。'
        WHERE status = 'running'`
    )
    .run(new Date().toISOString()).changes;
  if (n > 0) console.log(`[bp] 启动收尸：${n} 份报告在上次进程里没跑完，已标为中断`);
  return n;
}
