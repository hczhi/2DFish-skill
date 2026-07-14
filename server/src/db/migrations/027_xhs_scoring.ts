import type { Migration } from '../migrator.js';

export const migration_027: Migration = {
  id: '027_xhs_scoring',
  up(db) {
    db.exec(`
      -- 笔记草稿：用户在写作台里写的内容
      CREATE TABLE IF NOT EXISTS xhs_notes (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        title TEXT DEFAULT '',
        body TEXT DEFAULT '',
        niche TEXT DEFAULT '',
        last_score REAL DEFAULT NULL,
        last_dimensions TEXT DEFAULT '{}',
        published INTEGER NOT NULL DEFAULT 0,
        -- 真实数据（发布后手动回填，用于回归校准权重）
        real_likes INTEGER DEFAULT NULL,
        real_collects INTEGER DEFAULT NULL,
        real_views INTEGER DEFAULT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_xhs_notes_user ON xhs_notes(user_id, updated_at DESC);

      -- 反馈事件：记录用户对 AI 建议/评分的真实反应（"越用越懂你"的燃料）
      CREATE TABLE IF NOT EXISTS xhs_feedback (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        note_id TEXT DEFAULT '',
        -- 'accept_suggestion' | 'reject_suggestion' | 'score_wrong' | 'pick_title' ...
        type TEXT NOT NULL,
        dimension TEXT DEFAULT '',
        payload TEXT DEFAULT '{}',
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_xhs_feedback_user ON xhs_feedback(user_id, created_at DESC);
    `);
  },
};
