import type { Migration } from '../migrator.js';

export const migration_028: Migration = {
  id: '028_xhs_home_module',
  up(db) {
    const existing = db.prepare("SELECT id FROM home_modules WHERE path = '/xhs'").get();
    if (existing) return;

    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO home_modules (id, title, description, icon, path, category, featured, require_auth, image_url, bg_color, sort_order, visible, grid_span, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'xhs-module-001',
      '爆款诊断',
      '写小红书笔记，AI 全程用爆款视角陪写 + 实时打分',
      '🔥',
      '/xhs',
      'Tool',
      1,
      1,
      '',
      '#fff5f6',
      1,
      1,
      '1x1',
      now,
      now
    );
  },
};
