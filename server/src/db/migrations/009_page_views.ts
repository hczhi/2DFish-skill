import type { Migration } from '../migrator.js';

export const migration_009: Migration = {
  id: '009_page_views',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS page_views (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT NOT NULL,
        referrer TEXT DEFAULT '',
        user_agent TEXT DEFAULT '',
        ip TEXT DEFAULT '',
        session_id TEXT DEFAULT '',
        user_id TEXT DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_page_views_path ON page_views(path);
      CREATE INDEX IF NOT EXISTS idx_page_views_created_at ON page_views(created_at);
      CREATE INDEX IF NOT EXISTS idx_page_views_session_id ON page_views(session_id);
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS page_views_daily (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT NOT NULL,
        date TEXT NOT NULL,
        pv INTEGER DEFAULT 0,
        uv INTEGER DEFAULT 0,
        UNIQUE(path, date)
      );

      CREATE INDEX IF NOT EXISTS idx_page_views_daily_date ON page_views_daily(date);
      CREATE INDEX IF NOT EXISTS idx_page_views_daily_path ON page_views_daily(path);
    `);
  },
};
