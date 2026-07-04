import type { Migration } from '../migrator.js';

export const migration_013: Migration = {
  id: '013_token_version',
  up(db) {
    db.exec(`
      ALTER TABLE user ADD COLUMN token_version INTEGER DEFAULT 1;
    `);
  },
};
