import type { Migration } from '../migrator.js';

export const migration_022: Migration = {
  id: '022_tender_keyword_pool',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS tender_keyword_pool (
        id TEXT PRIMARY KEY,
        keyword TEXT NOT NULL UNIQUE,
        category TEXT DEFAULT '',
        enabled INTEGER NOT NULL DEFAULT 1,
        sort_order INTEGER DEFAULT 0,
        created_at TEXT NOT NULL
      )
    `);

    db.exec(`CREATE INDEX IF NOT EXISTS idx_keyword_pool_enabled ON tender_keyword_pool(enabled, sort_order)`);

    // Seed with default keywords
    const now = new Date().toISOString();
    const defaults = ['整合营销', '品牌全案', '视频制作', '媒介投放', '活动策划'];
    const stmt = db.prepare('INSERT OR IGNORE INTO tender_keyword_pool (id, keyword, category, enabled, sort_order, created_at) VALUES (?, ?, ?, 1, ?, ?)');
    defaults.forEach((kw, i) => {
      stmt.run(`kp_${i + 1}`, kw, '默认', i, now);
    });
  },
};
