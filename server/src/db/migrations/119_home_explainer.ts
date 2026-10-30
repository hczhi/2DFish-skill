import type { Migration } from '../migrator.js';

// 首页露出代码动画视频（/explainer 介绍页）。已有这一行（后台手动加过）就只把它打开，不覆盖配过的文案/图。
export const migration_119: Migration = {
  id: '119_home_explainer',
  up(db) {
    const now = new Date().toISOString();
    const has = db.prepare(`SELECT 1 FROM home_modules WHERE path = '/explainer'`).get();
    if (has) {
      db.prepare(`UPDATE home_modules SET visible = 1, require_auth = 0, updated_at = ? WHERE path = '/explainer'`).run(now);
      return;
    }
    db.prepare(
      `INSERT INTO home_modules (id, title, description, icon, path, category, featured, require_auth, sort_order, visible, grid_span, created_at, updated_at)
       VALUES ('explainer-module-001', '代码动画视频', '写一段内容，AI 出剧本，白板讲解 / 蓝图风格一笔一笔画成视频', '✏️', '/explainer', 'AI 应用', 0, 0, 0, 1, '1x1', ?, ?)`
    ).run(now, now);
  },
};
