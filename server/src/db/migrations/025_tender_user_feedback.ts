import type { Migration } from '../migrator.js';

export const migration_025: Migration = {
  id: '025_tender_user_feedback',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS tender_user_feedback (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        tender_id TEXT NOT NULL,
        recommendation_id TEXT DEFAULT '',
        feedback TEXT NOT NULL,
        reason TEXT DEFAULT '',
        created_at TEXT DEFAULT (datetime('now')),
        UNIQUE(user_id, tender_id)
      );
      CREATE INDEX IF NOT EXISTS idx_tender_feedback_user ON tender_user_feedback(user_id);
      CREATE INDEX IF NOT EXISTS idx_tender_feedback_tender ON tender_user_feedback(tender_id);
    `);
  },
};
