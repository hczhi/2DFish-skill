import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../db/index.js';

// 长任务的唯一事实来源。见 migrations/049_jobs.ts 里为什么不能继续放内存。
//
// 用法：
//   const job = startJob('tender-crawl', { total: 3, createdBy: userId });
//   job.log('开始爬取');  job.progress({ current: 1, message: '...' });
//   job.done({ newAdded: 12 });   // 或 job.fail(err)
//
// 每次调用都是一条 UPDATE：这些任务的进度回调是秒级的（爬一页、评一条），
// 不是毫秒级热循环，所以直接写库比维护一层内存缓存 + 定时 flush 更不容易错。

/** 任务类型。新增长任务时在这里加一项，crawl-status 之类的互斥判断才能认得它。 */
export type JobKind =
  | 'tender-crawl'
  | 'tender-extract'
  | 'tender-recommend'
  | 'ui-review';

export type JobStatus = 'running' | 'completed' | 'failed';

export interface JobRow {
  id: string;
  kind: JobKind;
  ref_id: string | null;
  status: JobStatus;
  step: string;
  message: string;
  current: number;
  total: number;
  result: string | null;
  error: string | null;
  created_by: string | null;
  started_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface JobLogEntry {
  time: string;
  message: string;
  detail?: string;
}

/** job_logs 每个任务保留的条数上限。原来内存版是 300，保持一致。 */
const MAX_LOGS_PER_JOB = 300;

export interface StartJobOptions {
  refId?: string;
  total?: number;
  step?: string;
  message?: string;
  createdBy?: string;
}

export interface JobProgress {
  step?: string;
  message?: string;
  current?: number;
  total?: number;
}

/** 一个运行中任务的句柄。方法都是幂等写库，不持有任何进度状态。 */
export class JobHandle {
  constructor(public readonly id: string, public readonly kind: JobKind) {}

  log(message: string, detail?: string): void {
    const db = getDatabase();
    const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    db.prepare('INSERT INTO job_logs (job_id, time, message, detail) VALUES (?, ?, ?, ?)')
      .run(this.id, time, message, detail ?? null);

    // 超出上限就丢最旧的。DELETE ... NOT IN (最新 N 条) 一条 SQL 搞定，
    // 不用先 COUNT 再判断。
    db.prepare(`
      DELETE FROM job_logs WHERE job_id = ? AND seq NOT IN (
        SELECT seq FROM job_logs WHERE job_id = ? ORDER BY seq DESC LIMIT ?
      )
    `).run(this.id, this.id, MAX_LOGS_PER_JOB);

    console.log(`[job:${this.kind}] ${message}`);
  }

  progress(p: JobProgress): void {
    const sets: string[] = [];
    const params: unknown[] = [];
    if (p.step !== undefined) { sets.push('step = ?'); params.push(p.step); }
    if (p.message !== undefined) { sets.push('message = ?'); params.push(p.message); }
    if (p.current !== undefined) { sets.push('current = ?'); params.push(p.current); }
    if (p.total !== undefined) { sets.push('total = ?'); params.push(p.total); }
    if (sets.length === 0) return;

    sets.push('updated_at = ?');
    params.push(new Date().toISOString(), this.id);
    getDatabase().prepare(`UPDATE jobs SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  }

  // done/fail 都带 `AND status = 'running'`：终态先到先得。
  // 手动终止走 fail()，而被终止的任务体随后会抛「任务已终止」再进自己的 catch
  // 又调一次 fail()——没有这道守卫，管理员看到的失败原因会被覆盖成内部异常文本。
  done(result?: Record<string, unknown>, message?: string): void {
    const now = new Date().toISOString();
    getDatabase().prepare(
      `UPDATE jobs SET status = 'completed', result = ?, message = COALESCE(?, message),
       completed_at = ?, updated_at = ? WHERE id = ? AND status = 'running'`
    ).run(result ? JSON.stringify(result) : null, message ?? null, now, now, this.id);
  }

  fail(error: unknown, message?: string): void {
    const msg = error instanceof Error ? error.message : String(error);
    const now = new Date().toISOString();
    getDatabase().prepare(
      `UPDATE jobs SET status = 'failed', error = ?, message = ?,
       completed_at = ?, updated_at = ? WHERE id = ? AND status = 'running'`
    ).run(msg, message ?? `失败：${msg}`, now, now, this.id);
  }
}

export function startJob(kind: JobKind, opts: StartJobOptions = {}): JobHandle {
  const id = uuidv4();
  const now = new Date().toISOString();
  getDatabase().prepare(`
    INSERT INTO jobs (id, kind, ref_id, status, step, message, current, total, created_by, started_at, updated_at)
    VALUES (?, ?, ?, 'running', ?, ?, 0, ?, ?, ?, ?)
  `).run(id, kind, opts.refId ?? null, opts.step ?? '', opts.message ?? '', opts.total ?? 0,
    opts.createdBy ?? null, now, now);
  return new JobHandle(id, kind);
}

export function getJob(id: string): JobRow | undefined {
  return getDatabase().prepare('SELECT * FROM jobs WHERE id = ?').get(id) as JobRow | undefined;
}

/** 某几类任务里最新的一条（不论状态）。前端轮询"当前任务状态"用这个。 */
export function getLatestJob(kinds: JobKind[]): JobRow | undefined {
  if (kinds.length === 0) return undefined;
  const placeholders = kinds.map(() => '?').join(',');
  return getDatabase().prepare(
    `SELECT * FROM jobs WHERE kind IN (${placeholders}) ORDER BY started_at DESC, rowid DESC LIMIT 1`
  ).get(...kinds) as JobRow | undefined;
}

/** 这几类任务里是否有正在跑的。互斥判断（409）用这个，取代原来的内存变量比较。 */
export function findRunningJob(kinds: JobKind[]): JobRow | undefined {
  if (kinds.length === 0) return undefined;
  const placeholders = kinds.map(() => '?').join(',');
  return getDatabase().prepare(
    `SELECT * FROM jobs WHERE status = 'running' AND kind IN (${placeholders}) ORDER BY started_at DESC LIMIT 1`
  ).get(...kinds) as JobRow | undefined;
}

export function getJobLogs(jobId: string): JobLogEntry[] {
  const rows = getDatabase().prepare(
    'SELECT time, message, detail FROM job_logs WHERE job_id = ? ORDER BY seq ASC'
  ).all(jobId) as { time: string; message: string; detail: string | null }[];
  return rows.map(r => (r.detail ? { time: r.time, message: r.message, detail: r.detail } : { time: r.time, message: r.message }));
}

/**
 * 进程启动时把上一次运行遗留的 running 任务标成 failed。
 *
 * 没有这一步，一次崩溃/部署就会留下一条永远 running 的行，之后所有互斥判断
 * 都会命中它并返回 409「已有任务在运行中」——功能被一条僵尸行永久锁死。
 * 用 node 进程重启作为判据是安全的：这些任务全靠内存里的 async 函数驱动，
 * 进程一没，任务必然已经死了。（前提是单实例部署；多实例需换成心跳超时。）
 */
export function reapZombieJobs(): number {
  const now = new Date().toISOString();
  const result = getDatabase().prepare(
    `UPDATE jobs SET status = 'failed', error = '服务重启，任务中断',
     message = '失败：服务重启，任务中断', completed_at = ?, updated_at = ?
     WHERE status = 'running'`
  ).run(now, now);
  if (result.changes > 0) {
    console.log(`[job] 已将 ${result.changes} 条重启前遗留的 running 任务标为 failed`);
  }
  return result.changes;
}
