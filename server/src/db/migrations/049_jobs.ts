import type { Migration } from '../migrator.js';

// 长任务状态落库。
//
// 原来爬取/提取/评分的进度全在 api/tender.ts 的模块级变量 `crawlTaskStatus` 里，
// uiReview 的进度事件在 orchestrator.ts 的 `progressEvents` Map 里。三个后果：
//   1. 进程重启（部署、崩溃、nodemon 存盘）状态凭空消失，前端轮询到 idle，
//      管理员以为任务没跑；而 tenders/ui_reviews 表里的行还停在 draft/crawling，
//      成了永远不会有人来收的僵尸行。
//   2. 「已有任务在运行中」的 409 互斥只在单进程内成立，多实例部署时形同虚设。
//   3. 任务历史完全不可查——失败原因随重启一起蒸发，事后没法复盘。
//
// jobs 表把状态挪到唯一的事实来源上；日志单独一张 append-only 表，
// 避免每来一条进度就重写一个 300 条的 JSON 数组。
export const migration_049: Migration = {
  id: '049_jobs',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        -- 任务作用的对象（uiReview 的 review_id 等），无对象时为 NULL
        ref_id TEXT,
        status TEXT NOT NULL,
        step TEXT NOT NULL DEFAULT '',
        message TEXT NOT NULL DEFAULT '',
        current INTEGER NOT NULL DEFAULT 0,
        total INTEGER NOT NULL DEFAULT 0,
        -- 任务特有的结果字段（爬取的 newAdded、评分的 processed 等）存 JSON，
        -- 免得每加一种任务就 ALTER TABLE 加一列
        result TEXT,
        error TEXT,
        created_by TEXT,
        started_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT
      );

      CREATE TABLE IF NOT EXISTS job_logs (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id TEXT NOT NULL,
        time TEXT NOT NULL,
        message TEXT NOT NULL,
        detail TEXT
      );
    `);

    // 取「某类任务的最新一条」是热路径（前端每 2s 轮一次 crawl-status）
    db.exec(`CREATE INDEX IF NOT EXISTS idx_jobs_kind_started ON jobs (kind, started_at DESC)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_jobs_ref ON jobs (ref_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_job_logs_job ON job_logs (job_id, seq)`);
  },
};
