import type { Migration } from '../migrator.js';

/**
 * `consult_runs`：咨询某一步「正在跑一次 AI 分析」这件事落库。
 *
 * 之前这件事**只存在浏览器内存里**（`ConsultProject.vue` 的 `runningStage`）：一次出草稿要
 * 几十秒到几分钟，而服务端那份产出是在 `res.json` **之前**就 `appendMessage` 进对话记录的。
 * 于是刷新一次 / 息屏 / 切走那个标签页之后，界面上是「这一步还没有草稿」加一个「生成」按钮
 * —— 额度已经扣了、正文已经在库里了，而唯一看得见的动作是再点一次（再扣一次）。
 * 反过来也一样：那次调用真的挂了（上游 502、思维链吃光 max_tokens），进程里的 promise 一 reject
 * 就什么都不剩，下次进来只有一个「还没生成」的空白界面，**真实成因一个字都没有** ——
 * 而这两种情况在屏幕上长得一模一样（硬规则 1）。
 *
 * 四条边界：
 * ① `(project_id, stage_key)` 上一条**只对 running 生效的唯一索引** —— 同一步不许同时跑两次。
 *    靠前端 `stageBusy` 挡的话，两个标签页、或者刷新之后再点一次都绕得过去，而两次都正常返回
 *    两份草稿（后一份盖掉前一份），账单扣两次而界面上什么都看不出来。
 * ② 失败原文存 `error` 整段，不合成一句「分析失败」：空返回 / 截断 / 上游忙三种解法完全不同，
 *    合成一句之后用户只会一路重试，每次真扣一次额度。
 * ③ `message_id` 记这次的产出落在哪条对话记录上 —— 前端据它判「这一版是不是已经收下了」，
 *    没有它的话轮询捞回来的那一份会和那次返回的重复贴两遍（对话里两张一样的卡片）。
 * ④ `acked_at`：失败/中断那条要在界面上说一次，说过了才不再说。不记这一列的话，那句
 *    「上一次分析中断了」每次进项目都要弹一遍，弹到第三次就没人看了 —— 于是真的中断那次也被划过去。
 *
 * 进程重启时内存里那些 promise 必然死了（长任务全靠它们驱动），所以启动时要把遗留的 running
 * 标成 interrupted（`reapInterruptedConsultRuns`，和 `reapZombieJobs` 同一个理由）：不收尸的话
 * 那一步永远显示「正在分析」，而它早就没人在跑了 —— 界面上「还在跑」和「早就断了」是同一个样子。
 */
export const migration_109: Migration = {
  id: '109_consult_runs',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS consult_runs (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        stage_key TEXT NOT NULL,
        -- 'draft' 出草稿 / 'decisions' 出岔路口 / 'directions' 出候选方向。
        -- 分开记是为了那句「正在写这一步的正文」和「正在出候选方向」不会串台。
        kind TEXT NOT NULL,
        -- running / done / failed / interrupted
        status TEXT NOT NULL,
        error TEXT,
        message_id TEXT,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        acked_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_consult_runs_project
        ON consult_runs (project_id, started_at);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_consult_runs_one_running
        ON consult_runs (project_id, stage_key) WHERE status = 'running';
    `);
  },
};
