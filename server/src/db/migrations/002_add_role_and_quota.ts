import type { Migration } from '../migrator.js';

export const migration_002: Migration = {
  id: '002_add_role_and_quota',
  up(db) {
    // Add role to user table
    const userCols = db.prepare('PRAGMA table_info(user)').all() as { name: string }[];
    if (!userCols.some(c => c.name === 'role')) {
      db.exec(`ALTER TABLE user ADD COLUMN role TEXT NOT NULL DEFAULT 'user'`);
      const firstUser = db.prepare('SELECT id FROM user ORDER BY created_at ASC LIMIT 1').get() as { id: string } | undefined;
      if (firstUser) {
        db.prepare('UPDATE user SET role = ? WHERE id = ?').run('admin', firstUser.id);
      }
    }

    // Create ai_quota table
    db.exec(`
      CREATE TABLE IF NOT EXISTS ai_quota (
        user_id TEXT PRIMARY KEY,
        daily_limit INTEGER NOT NULL DEFAULT 10,
        used_today INTEGER NOT NULL DEFAULT 0,
        last_reset_date TEXT NOT NULL
      );
    `);

    // Create system_config table
    db.exec(`
      CREATE TABLE IF NOT EXISTS system_config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  },
};
