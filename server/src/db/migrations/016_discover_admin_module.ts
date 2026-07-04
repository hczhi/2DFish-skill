import type { Migration } from '../migrator.js';

export const migration_016: Migration = {
  id: '016_discover_admin_module',
  up(db) {
    const now = new Date().toISOString();
    const existing = db.prepare('SELECT id FROM module_configs WHERE id = ?').get('discover-admin');
    if (!existing) {
      db.prepare(`
        INSERT INTO module_configs (id, name, description, allowed_paths, enabled, created_at)
        VALUES (?, ?, ?, ?, 1, ?)
      `).run(
        'discover-admin',
        '文章管理',
        '文章/专题发布、编辑、生成静态页、SEO生成',
        JSON.stringify(['/api/discover/admin/*', '/api/discover/topics/admin/*', '/api/seo/admin/generate']),
        now
      );
    }
  },
};
