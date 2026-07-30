import type { Migration } from '../migrator.js';

// 把标讯推荐注册成可分配 module token 的模块，后台"Token 管理"的下拉才会出现它。
// 用途：飞书 agent / 服务端脚本用长期 token 读自己账号的标讯推荐。
//
// 必须带 "GET " 前缀（moduleGuard 支持 "METHOD /path" 形式）：
// 只写路径的话，moduleGuard 会额外放行 pattern + '/' 开头的子路径，
// PATCH /recommendations/:id/read（标记已读，写操作）就会被放进来。
// 同理绝不能用 /api/tender/* —— 会连 POST /feedback、PUT /preferences 一起放行。
const READ_ONLY_PATHS = [
  'GET /api/tender/recommendations',
  'GET /api/tender/list',
  'GET /api/tender/detail',
];

export const migration_044: Migration = {
  id: '044_tender_module_config',
  up(db) {
    const existing = db.prepare('SELECT id FROM module_configs WHERE id = ?').get('tender');
    if (existing) {
      db.prepare('UPDATE module_configs SET allowed_paths = ? WHERE id = ?')
        .run(JSON.stringify(READ_ONLY_PATHS), 'tender');
      return;
    }
    db.prepare(`
      INSERT INTO module_configs (id, name, description, allowed_paths, enabled, created_at)
      VALUES (?, ?, ?, ?, 1, ?)
    `).run(
      'tender',
      '标讯智能推荐',
      '只读：我的推荐、标讯列表、标讯详情。供飞书 agent / 服务端调用。',
      JSON.stringify(READ_ONLY_PATHS),
      new Date().toISOString()
    );
  },
};
