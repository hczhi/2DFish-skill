import type { Migration } from '../migrator.js';

/**
 * `bp_pitch_sessions`：基于一份 BP 报告的模拟路演（AI 扮演投资人连续追问、逐轮点评）。
 * 归属键同 bp_reports（user_id + sdk_pk + external_uid）；turns_json 一轮一条 {q, why, a, fb}。
 * 落库而不是只放前端：一场十几轮、每轮一次真实调用，刷新一下全没了的话他只能重开一场（key 用户再扣一次点）。
 * charged：key 用户每场固定点数，开场成功生成第一个问题时结算一次。
 */
export const migration_132: Migration = {
  id: '132_bp_pitch_sessions',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS bp_pitch_sessions (
        id TEXT PRIMARY KEY,
        report_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        sdk_pk TEXT,
        external_uid TEXT,
        persona TEXT NOT NULL,
        status TEXT NOT NULL,
        turns_json TEXT NOT NULL DEFAULT '[]',
        summary_json TEXT,
        charged INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        finished_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_bp_pitch_report ON bp_pitch_sessions (report_id, created_at);
    `);
  },
};
