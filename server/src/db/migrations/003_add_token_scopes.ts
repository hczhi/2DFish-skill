import type { Migration } from '../migrator.js';

export const migration_003: Migration = {
  id: '003_add_token_scopes',
  up(db) {
    const cols = db.prepare('PRAGMA table_info(api_tokens)').all() as { name: string }[];
    if (!cols.some(c => c.name === 'scopes')) {
      db.exec(`ALTER TABLE api_tokens ADD COLUMN scopes TEXT`);
    }
  },
};
