import type { Migration } from '../migrator.js';

export const migration_001: Migration = {
  id: '001_add_user_id_columns',
  up(db) {
    const firstUser = db.prepare('SELECT id FROM user LIMIT 1').get() as { id: string } | undefined;
    const userId = firstUser?.id || 'system';

    const tables = [
      'api_tokens',
      'chat_messages',
      'chat_summaries',
      'consultant_messages',
      'consultant_summaries',
      'content_projects',
      'ai_logs',
    ];

    for (const table of tables) {
      const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
      if (cols.some(c => c.name === 'user_id')) continue;

      db.exec(`ALTER TABLE ${table} ADD COLUMN user_id TEXT`);
      db.prepare(`UPDATE ${table} SET user_id = ?`).run(userId);
    }

    db.exec(`CREATE INDEX IF NOT EXISTS idx_chat_messages_user ON chat_messages(user_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_consultant_messages_user ON consultant_messages(user_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_api_tokens_user ON api_tokens(user_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_ai_logs_user ON ai_logs(user_id, created_at)`);
  },
};
