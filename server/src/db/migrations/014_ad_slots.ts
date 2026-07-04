import type { Migration } from '../migrator.js';

export const migration_014: Migration = {
  id: '014_ad_slots',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS ad_slots (
        id TEXT PRIMARY KEY,
        page_pattern TEXT NOT NULL,
        position TEXT NOT NULL,
        slot_code TEXT DEFAULT '',
        enabled INTEGER DEFAULT 1,
        label TEXT DEFAULT '',
        sort_order INTEGER DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_ad_slots_page ON ad_slots(page_pattern);
    `);
  },
};
