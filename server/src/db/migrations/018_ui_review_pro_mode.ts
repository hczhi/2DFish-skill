import type { Migration } from '../migrator.js';

export const migration_018: Migration = {
  id: '018_ui_review_pro_mode',
  up(db) {
    db.exec(`ALTER TABLE ui_reviews ADD COLUMN mode TEXT NOT NULL DEFAULT 'standard'`);
    db.exec(`ALTER TABLE ui_reviews ADD COLUMN pro_analysis TEXT DEFAULT ''`);
  },
};
