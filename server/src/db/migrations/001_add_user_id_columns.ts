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
      // 表不存在时 PRAGMA 返回空数组而不报错，会一路走到 ALTER TABLE 才崩。
      // content_projects 已由 051 删除且不再建表，全新库上跑到这里就是这种情况：
      // 空库要按顺序重放整条迁移链，而链条前段还引用着后来删掉的表。
      if (cols.length === 0) continue;
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
