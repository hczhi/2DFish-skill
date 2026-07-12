import type { Migration } from '../migrator.js';

export const migration_020: Migration = {
  id: '020_tender_home_module',
  up(db) {
    const existing = db.prepare("SELECT id FROM home_modules WHERE path = '/tender'").get();
    if (existing) return;

    const id = 'tender-module-001';
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO home_modules (id, title, description, icon, path, category, featured, require_auth, image_url, bg_color, sort_order, visible, grid_span, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      '标讯推荐',
      'AI 智能匹配招标项目，多维度评分推荐',
      '📋',
      '/tender',
      'Tool',
      0,
      1,
      '',
      '#f0fdf4',
      2,
      1,
      '1x1',
      now,
      now
    );
  },
};
