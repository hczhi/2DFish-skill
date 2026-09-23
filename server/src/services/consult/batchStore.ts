import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../../db/index.js';

// 「一键跑完整份报告」这一批（migration 111）。见那份注释 —— 这张表存在的理由是
// `consult_runs` 只记得住「这一步正在跑」，而「后面还排着 11 步」在那张表里压根不存在。

export type ConsultBatchStatus = 'running' | 'done' | 'failed' | 'interrupted';

export interface ConsultBatch {
  id: string;
  project_id: string;
  user_id: string;
  /** JSON 字符串。读的时候用 `batchKeys()`，别各处自己 `JSON.parse`。 */
  stage_keys: string;
  cursor: number;
  status: ConsultBatchStatus;
  error: string | null;
  search_note: string | null;
  started_at: string;
  finished_at: string | null;
  acked_at: string | null;
}

/**
 * 这一批当初打算跑哪几步。**坏掉的 JSON 返回空数组而不是抛**：这张表只用来显示进度，
 * 为它把整个项目页弄成 500 的话，他连已经跑出来的那几步都看不到了。
 */
export function batchKeys(batch: ConsultBatch): string[] {
  try {
    const v = JSON.parse(batch.stage_keys || '[]');
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

/**
 * 开一批。**同一个项目已经有一批在跑就返回 null**（调用方回 409），靠的是 111 里那条
 * 只对 running 生效的唯一索引 —— 判「先 SELECT 再 INSERT」的话连点两次（或者两个标签页）
 * 都能挤进去，于是两条驱动器跑同一条链：各自扣二十多次额度、各自往同一步写草稿，
 * 后写的盖掉先写的，而界面上只是「进度跳得有点怪」。
 */
export function startBatch(
  projectId: string,
  userId: string,
  stageKeys: string[],
  searchNote: string
): ConsultBatch | null {
  const db = getDatabase();
  const batch: ConsultBatch = {
    id: uuidv4(),
    project_id: projectId,
    user_id: userId,
    stage_keys: JSON.stringify(stageKeys),
    cursor: 0,
    status: 'running',
    error: null,
    search_note: searchNote || null,
    started_at: new Date().toISOString(),
    finished_at: null,
    acked_at: null,
  };
  try {
    db.prepare(
      `INSERT INTO consult_batches (id, project_id, user_id, stage_keys, cursor, status, search_note, started_at)
       VALUES (?, ?, ?, ?, 0, 'running', ?, ?)`
    ).run(batch.id, projectId, userId, batch.stage_keys, batch.search_note, batch.started_at);
  } catch (err) {
    if (String((err as Error).message).includes('UNIQUE')) return null;
    throw err;
  }
  return batch;
}

/**
 * 跑完一步，游标往前一格。
 *
 * **每跑完一步就写一次**（不是跑完整批写一次）：他刷新页面 / 息屏之后，「这一批跑到第几步了」
 * 全靠这个数 —— 整批结束才写的话，跑了四十分钟的那条链在界面上一直显示 0/14，
 * 而它每一步都真出了正文。
 */
export function advanceBatch(id: string, cursor: number): void {
  getDatabase()
    .prepare(`UPDATE consult_batches SET cursor = ? WHERE id = ? AND status = 'running'`)
    .run(cursor, id);
}

export function finishBatch(id: string, cursor: number): void {
  getDatabase()
    .prepare(
      `UPDATE consult_batches SET status = 'done', cursor = ?, finished_at = ?
        WHERE id = ? AND status = 'running'`
    )
    .run(cursor, new Date().toISOString(), id);
}

/**
 * 这一批停在半路。**原文整段存**，而且调用方必须在话里说出「剩下几步没跑」——
 * 只写那一步的失败原因的话，界面上是「6 步已定稿 + 1 条失败」，剩下 7 步和
 * 「他压根没点过这个按钮」一模一样（硬规则 1）。
 */
export function failBatch(id: string, message: string): void {
  getDatabase()
    .prepare(
      `UPDATE consult_batches SET status = 'failed', error = ?, finished_at = ?
        WHERE id = ? AND status = 'running'`
    )
    .run(String(message || '').slice(0, 2000), new Date().toISOString(), id);
}

/** 这个项目正在跑的那一批（没有就 null）。 */
export function runningBatch(projectId: string): ConsultBatch | null {
  return (
    (getDatabase()
      .prepare(`SELECT * FROM consult_batches WHERE project_id = ? AND status = 'running'`)
      .get(projectId) as ConsultBatch | undefined) || null
  );
}

/**
 * 界面上现在要显示的那一批：正在跑的，或者还没跟他说过的那次失败/中断。
 *
 * 和 `activeRuns` 同一个理由：只回 running 的话，「跑到第 6 步挂了」在界面上等于
 * 「这个项目没在跑批量」—— 而那时候剩下 8 步是真的没跑，他要的就是那句成因。
 */
export function activeBatch(projectId: string): ConsultBatch | null {
  // **只看最新那一行**，不是「最新的一条未 ack 失败/中断」：后者会跳过中间那批跑成功的，
  // 于是他重跑一次、十四步全绿了，顶上照旧红着一句「跑到第 5/14 步就停了，剩下 9 步没有跑」
  // —— 那句话现在是假的，而它指的动作（再点一次接着跑）只会回一句 409「都已经定稿了」。
  const b =
    (getDatabase()
      .prepare(
        `SELECT * FROM consult_batches WHERE project_id = ? ORDER BY started_at DESC LIMIT 1`
      )
      .get(projectId) as ConsultBatch | undefined) || null;
  if (!b) return null;
  if (b.status === 'running') return b;
  if (b.status === 'done' || b.acked_at) return null;
  return b;
}

/** 那句成因他已经看到了，别再弹。只对已经结束的那些生效。 */
export function ackBatch(projectId: string, id: string): boolean {
  return (
    getDatabase()
      .prepare(
        `UPDATE consult_batches SET acked_at = ? WHERE id = ? AND project_id = ? AND status != 'running'`
      )
      .run(new Date().toISOString(), id, projectId).changes > 0
  );
}

/**
 * 启动收尸：上一次进程留下的 running 全部标成 interrupted，并写明**跑到第几步、剩下几步没跑**。
 *
 * 驱动那条链的是内存里一个游离的 async 函数，进程一没它必然死了（同 `reapInterruptedConsultRuns`）。
 * 不收尸有两层后果，都不报错：① 那条唯一索引把这个项目永久锁在「已经有一批在跑」，于是
 * 「一键跑完整份报告」从此一律 409；② 界面上写着「正在跑第 7 步」，而没有任何人在跑它。
 *
 * **不自动接着跑**：重启之后凭空花掉二十多次额度谁都没要求过（一次能把当天配额全用完），
 * 而且真正让进程挂掉的原因很可能就在那一步上 —— 自动重来就是开机崩、崩了再开机。
 * 接着跑是他点的，而「待跑清单」是按「哪几步还没定稿」现算的，所以那一下天然从断点继续。
 */
export function reapInterruptedConsultBatches(): number {
  const db = getDatabase();
  const rows = db
    .prepare(`SELECT * FROM consult_batches WHERE status = 'running'`)
    .all() as ConsultBatch[];
  const now = new Date().toISOString();
  const upd = db.prepare(
    `UPDATE consult_batches SET status = 'interrupted', finished_at = ?, error = ? WHERE id = ?`
  );
  for (const b of rows) {
    const total = batchKeys(b).length;
    const left = Math.max(0, total - b.cursor);
    upd.run(
      now,
      `服务重启了，这份报告跑到第 ${b.cursor}/${total} 步就停了，剩下 ${left} 步**没有跑**` +
        `（已经跑完的那几步都已定稿，额度也已经扣了）。再点一次「一键跑完整份报告」会从没定稿的那一步接着跑。`,
      b.id
    );
  }
  if (rows.length) {
    console.log(`[consult] 启动收尸：${rows.length} 批整份报告在上次进程里没跑完，已标为中断`);
  }
  return rows.length;
}
