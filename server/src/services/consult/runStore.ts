import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../../db/index.js';

// 「这一步正在跑一次 AI 分析」落库（migration 109）。
//
// 存在的理由只有一条：那次调用要几十秒到几分钟，而**产出在 `res.json` 之前就已经写进对话记录**。
// 状态只放在浏览器里的话，刷新 / 息屏 / 关标签页之后界面退回「这一步还没有草稿 + 生成按钮」——
// 额度扣了、正文在库里，而唯一看得见的动作是再点一次。见 109 那份注释。

export type ConsultRunKind = 'draft' | 'decisions' | 'directions';
export type ConsultRunStatus = 'running' | 'done' | 'failed' | 'interrupted';

export interface ConsultRun {
  id: string;
  project_id: string;
  stage_key: string;
  kind: ConsultRunKind;
  status: ConsultRunStatus;
  error: string | null;
  message_id: string | null;
  started_at: string;
  finished_at: string | null;
  acked_at: string | null;
}

/**
 * 登记一次开跑。**同一步已经在跑就返回 null**（调用方回 409），靠的是 109 里那条
 * 只对 running 生效的唯一索引 —— 判「先 SELECT 再 INSERT」的话两次几乎同时的点击
 * （两个标签页、或者刷新后再点一次）都能挤进去，而两次都正常返回一份草稿，
 * 后一份盖掉前一份，账单扣两次而界面上什么都看不出来。
 */
export function startRun(
  projectId: string,
  stageKey: string,
  kind: ConsultRunKind
): ConsultRun | null {
  const db = getDatabase();
  const run: ConsultRun = {
    id: uuidv4(),
    project_id: projectId,
    stage_key: stageKey,
    kind,
    status: 'running',
    error: null,
    message_id: null,
    started_at: new Date().toISOString(),
    finished_at: null,
    acked_at: null,
  };
  try {
    db.prepare(
      `INSERT INTO consult_runs (id, project_id, stage_key, kind, status, started_at)
       VALUES (?, ?, ?, ?, 'running', ?)`
    ).run(run.id, projectId, stageKey, kind, run.started_at);
  } catch (err) {
    // 撞唯一索引 = 这一步已经有一次在跑。别的错照抛（表没建出来这种事必须响）。
    if (String((err as Error).message).includes('UNIQUE')) return null;
    throw err;
  }
  return run;
}

/** 这一步正在跑的那一次（没有就 null）。 */
export function runningRun(projectId: string, stageKey: string): ConsultRun | null {
  const db = getDatabase();
  return (
    (db
      .prepare(
        `SELECT * FROM consult_runs WHERE project_id = ? AND stage_key = ? AND status = 'running'`
      )
      .get(projectId, stageKey) as ConsultRun | undefined) || null
  );
}

/**
 * 跑成了。`messageId` 必须传：前端据它判「这一版是不是轮询已经收下了」，
 * 不记的话那次返回和轮询捞回来的会在对话里各贴一张一样的卡片。
 */
export function finishRun(id: string, messageId: string | null): void {
  getDatabase()
    .prepare(
      `UPDATE consult_runs SET status = 'done', message_id = ?, finished_at = ?
        WHERE id = ? AND status = 'running'`
    )
    .run(messageId, new Date().toISOString(), id);
}

/**
 * 跑挂了。**存上游原文整段**，不合成一句「分析失败」：空返回 / 截断 / 上游忙 / 额度用完
 * 四种解法完全不同（硬规则 1），合成一句之后用户只会一路重试，而每次重试都真扣一次额度。
 */
export function failRun(id: string, message: string): void {
  getDatabase()
    .prepare(
      `UPDATE consult_runs SET status = 'failed', error = ?, finished_at = ?
        WHERE id = ? AND status = 'running'`
    )
    .run(String(message || '').slice(0, 2000), new Date().toISOString(), id);
}

/**
 * 这个项目现在正在跑的那些 + 还没跟用户说过的那些失败/中断。
 *
 * 两样一起回是因为前端要的是同一件事的两面：转圈圈接着转（running），
 * 以及「你上次没等到的那一版其实是挂了，成因是这个」（failed/interrupted）。
 * 只回 running 的话，中断那一次在界面上就是「这一步还没生成过」—— 和从没跑过一模一样。
 */
export function activeRuns(projectId: string): ConsultRun[] {
  const db = getDatabase();
  return db
    .prepare(
      `SELECT * FROM consult_runs
        WHERE project_id = ?
          AND (status = 'running' OR (status IN ('failed','interrupted') AND acked_at IS NULL))
        ORDER BY started_at`
    )
    .all(projectId) as ConsultRun[];
}

/** 用户已经看到那条失败提示了，别再弹。只对已经结束的那些生效。 */
export function ackRun(projectId: string, id: string): boolean {
  return (
    getDatabase()
      .prepare(
        `UPDATE consult_runs SET acked_at = ? WHERE id = ? AND project_id = ? AND status != 'running'`
      )
      .run(new Date().toISOString(), id, projectId).changes > 0
  );
}

/**
 * 启动时收尸：上一次进程留下的 running 全部标成 interrupted。
 *
 * 长任务是内存里那个游离的 async 函数驱动的，进程一没就必然死了（同 `reapZombieJobs`）。
 * 不收尸的后果有两层，都不报错：① 那一步永远显示「正在分析」，而没有任何人在跑它；
 * ② 109 里那条唯一索引会把它永久锁在「已经有一次在跑」，于是重新点分析一律 409 ——
 * 界面上就是这一步彻底点不动了。
 */
export function reapInterruptedConsultRuns(): number {
  const db = getDatabase();
  const n = db
    .prepare(
      `UPDATE consult_runs
          SET status = 'interrupted', finished_at = ?,
              error = '服务重启了，这一版没写完（AI 额度已经扣掉了）。重新点一次分析。'
        WHERE status = 'running'`
    )
    .run(new Date().toISOString()).changes;
  if (n > 0) console.log(`[consult] 启动收尸：${n} 次分析在上次进程里没跑完，已标为中断`);
  return n;
}
