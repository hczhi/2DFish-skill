import type { Migration } from '../migrator.js';

export const migration_011: Migration = {
  id: '011_module_tokens',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS module_configs (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        allowed_paths TEXT NOT NULL DEFAULT '[]',
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL
      )
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS module_tokens (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        module_id TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        token_prefix TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        expires_at TEXT,
        created_at TEXT NOT NULL,
        last_used_at TEXT,
        UNIQUE(user_id, module_id)
      )
    `);

    db.exec(`CREATE INDEX IF NOT EXISTS idx_module_tokens_hash ON module_tokens(token_hash)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_module_tokens_user ON module_tokens(user_id)`);

    db.exec(`
      CREATE TABLE IF NOT EXISTS token_access_logs (
        id TEXT PRIMARY KEY,
        token_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        module_id TEXT NOT NULL,
        method TEXT NOT NULL,
        path TEXT NOT NULL,
        status_code INTEGER NOT NULL DEFAULT 0,
        ip TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      )
    `);

    db.exec(`CREATE INDEX IF NOT EXISTS idx_token_logs_user ON token_access_logs(user_id, created_at)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_token_logs_token ON token_access_logs(token_id, created_at)`);

    // Seed default module configs
    const now = new Date().toISOString();
    const modules = [
      { id: 'fish', name: '摸鱼缸', description: 'AI 桌面养鱼游戏', allowed_paths: JSON.stringify(['/api/ai/fish']) },
      { id: 'board', name: '智慧看板', description: '东方智慧翻页卡', allowed_paths: JSON.stringify(['/api/ai/board']) },
      { id: 'chat', name: '对话', description: 'AI 对话系统', allowed_paths: JSON.stringify(['/api/chat']) },
      { id: 'consultant', name: 'AI顾问', description: 'AI 顾问咨询', allowed_paths: JSON.stringify(['/api/consultant']) },
      { id: 'files', name: '文件管理', description: '文件上传和管理', allowed_paths: JSON.stringify(['/api/files']) },
    ];

    const stmt = db.prepare(`
      INSERT INTO module_configs (id, name, description, allowed_paths, enabled, created_at)
      VALUES (?, ?, ?, ?, 1, ?)
    `);
    for (const m of modules) {
      stmt.run(m.id, m.name, m.description, m.allowed_paths, now);
    }
  },
};
