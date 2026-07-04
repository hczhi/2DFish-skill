import type { Migration } from '../migrator.js';

export const migration_015: Migration = {
  id: '015_ad_slot_height',
  up(db) {
    db.exec(`ALTER TABLE ad_slots ADD COLUMN height INTEGER DEFAULT 90`);
  },
};
