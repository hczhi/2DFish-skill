import type { Migration } from '../migrator.js';

export const migration_029: Migration = {
  id: '029_xhs_weights',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS xhs_weights (
        dimension TEXT PRIMARY KEY,
        weight REAL NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);

    // 初始权重（与 scoringService 里的默认常量一致）
    const now = new Date().toISOString();
    const defaults: Array<[string, number]> = [
      ['titleHook', 1.4],
      ['opening', 1.2],
      ['resonance', 1.3],
      ['emotion', 1.1],
      ['value', 0.9],
      ['interaction', 0.8],
    ];
    const stmt = db.prepare(
      'INSERT OR IGNORE INTO xhs_weights (dimension, weight, updated_at) VALUES (?, ?, ?)'
    );
    for (const [dim, w] of defaults) stmt.run(dim, w, now);
  },
};
