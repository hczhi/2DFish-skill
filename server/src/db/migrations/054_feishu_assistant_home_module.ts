import type { Migration } from '../migrator.js';

// 首页导航卡片是库里的数据（home_modules），不是 Home.vue 里的硬编码，
// 所以新模块的入口要靠迁移种进去 —— 和 020/028 两个模块同样的做法。

export const migration_054: Migration = {
  id: '054_feishu_assistant_home_module',
  up(db) {
    const existing = db.prepare("SELECT id FROM home_modules WHERE path = '/feishu'").get();
    if (existing) return;

    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO home_modules (id, title, description, icon, path, category, featured, require_auth, image_url, bg_color, sort_order, visible, grid_span, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'feishu-module-001',
      '飞书助理',
      '在飞书里 @ 一下机器人，用一句话建任务、约日程、发消息',
      '🛎️',
      '/feishu',
      'Tool',
      1,
      1,
      '',
      '#f0f7ff',
      2,
      1,
      '1x1',
      now,
      now
    );
  },
};
