import type { Migration } from '../migrator.js';

// 首页露出口播动效卡（/broll 介绍页）。已有这一行（后台手动加过）就只把它打开，不覆盖配过的文案/图。
export const migration_118: Migration = {
  id: '118_home_broll',
  up(db) {
    const now = new Date().toISOString();
    const has = db.prepare(`SELECT 1 FROM home_modules WHERE path = '/broll'`).get();
    if (has) {
      db.prepare(`UPDATE home_modules SET visible = 1, require_auth = 0, updated_at = ? WHERE path = '/broll'`).run(now);
      return;
    }
    db.prepare(
      `INSERT INTO home_modules (id, title, description, icon, path, category, featured, require_auth, sort_order, visible, grid_span, created_at, updated_at)
       VALUES ('broll-module-001', '口播动效卡', '按字幕给口播视频配数字、清单、图表动效卡，导出透明叠加层', '🎬', '/broll', 'AI 应用', 0, 0, 0, 1, '1x1', ?, ?)`
    ).run(now, now);
  },
};
