import type { Migration } from '../migrator.js';

/**
 * 补料问卷落库（每一轮一行）。
 *
 * 不落库的时候，问卷和填了一半的答案活在页面内存里 —— 一份问卷有十几题，用户是要去
 * 找客户逐条问的，刷新/切页/点错一下就全没了，而界面上不会报任何错，只是空了。
 *
 * `answers` 存的是**已经补进客户资料的那一份**（apply 的时候写），配合 `applied_at`
 * 起两个作用：一是同一轮不能补第二遍（同一批答案在资料里出现两份，AI 会把它当成
 * 两处独立印证）；二是下一轮出题时要把「已经问过并且答过的」剔掉 —— 重复问客户会让
 * 用户以为 AI 没读他刚补的东西，而他真的填第二遍之后资料里同一个事实就有两份了。
 */
export const migration_080: Migration = {
  id: '080_consult_intake',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS consult_intake (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        gaps TEXT NOT NULL DEFAULT '[]',
        questions TEXT NOT NULL DEFAULT '[]',
        answers TEXT NOT NULL DEFAULT '{}',
        truncated INTEGER NOT NULL DEFAULT 0,
        applied_at TEXT,
        applied_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_consult_intake_project
        ON consult_intake (project_id, created_at);
    `);
  },
};
