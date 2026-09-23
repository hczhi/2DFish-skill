import type { Migration } from '../migrator.js';

/**
 * `consult_batches`：「一键跑完整份报告」这一批（14 步串着跑）落库。
 *
 * `consult_runs`（109）只记得住「**这一步**正在跑」。整份报告是一条链（每一步都拿上一步的定稿
 * 当依据），所以任何时候只有一步在 `running`，而「后面还排着 11 步」这件事在 `consult_runs` 里
 * 压根不存在 —— 少了这张表的后果全是静默的：
 * ① 刷新/息屏之后界面上只剩一步在转圈，他以为跑的是单步，于是又去点别的步骤（撞上链条中间）；
 * ② 中间某一步挂了（额度用完 429、上游忙、思维链吃光 max_tokens），驱动器停在那里 ——
 *    而界面上是「6 步已定稿 + 1 条失败」，剩下 7 步和「他压根没点过这个按钮」一模一样；
 * ③ 进程一重启，驱动那条链的 async 函数必然死了（同 `reapZombieJobs`），而那 7 步永远不会跑，
 *    没有任何一处报错。
 *
 * 三条边界：
 * ① `project_id` 上一条**只对 running 生效的唯一索引** —— 一个项目同时只许一条链在跑。
 *    不拦的话连点两次就是两条驱动器跑同一条链：两边各自扣二十多次额度、各自往同一步写草稿，
 *    后写的盖掉先写的，而界面上只是「进度跳得有点怪」。
 * ② `user_id` 必须存下来：驱动器是脱离请求跑的（几分钟到十几分钟），额度要记在**他**账上。
 *    不存的话重启之后接着跑那一段找不到人，只能记到平台头上（后台账目对不上，而调用全是 200）。
 * ③ `stage_keys` 存整份清单、`cursor` 存跑到第几个：只存 cursor 的话，事后看不出这一批当初
 *    打算跑哪几步（他中途手动定稿过某一步的话，两份清单就不一样了），而那正是「剩下几步没跑」
 *    这句话的依据。
 *
 * 启动收尸（`reapInterruptedConsultBatches`）把遗留的 running 标成 interrupted 并写明
 * 「跑到第几步停了、剩下几步没跑」。**不自动接着跑**：重启之后凭空花掉二十多次额度这件事
 * 谁都没要求过，而它一次能把当天的配额全用完。接着跑是他点的（那颗按钮就是重新 POST 一次，
 * 待跑清单是按「哪几步还没定稿」现算的，所以天然从断点继续）。
 */
export const migration_111: Migration = {
  id: '111_consult_batches',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS consult_batches (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        -- 谁的额度（见上面②）
        user_id TEXT NOT NULL,
        -- JSON 数组：这一批按顺序要跑的 stage_key
        stage_keys TEXT NOT NULL,
        -- 下一个要跑的下标（= 已经跑完几步）
        cursor INTEGER NOT NULL DEFAULT 0,
        -- running / done / failed / interrupted
        status TEXT NOT NULL,
        -- 失败原文整段（上游那句话），不合成「跑失败了」
        error TEXT,
        -- 这一批开跑前那次自动联网的结论（跟着每一步的定稿记录一起用）
        search_note TEXT,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        acked_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_consult_batches_project
        ON consult_batches (project_id, started_at);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_consult_batches_one_running
        ON consult_batches (project_id) WHERE status = 'running';
    `);
  },
};
