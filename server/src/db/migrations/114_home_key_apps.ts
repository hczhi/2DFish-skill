import type { Migration } from '../migrator.js';

// 首页只留卖 key 的两个应用（展示稿、品牌咨询）。其余卡片只是隐藏（visible=0），不删 ——
// 后台「首页管理」里随时能再打开；删掉的话配过的图/文案/排序就没了。
// 标讯不对外（客户只关心数据推没推到他们系统），同样隐藏。
export const migration_114: Migration = {
  id: '114_home_key_apps',
  up(db) {
    const now = new Date().toISOString();
    db.prepare(`UPDATE home_modules SET visible = 0, updated_at = ? WHERE path NOT IN ('/ppt', '/consult')`).run(now);
    db.prepare(`UPDATE home_modules SET visible = 1, require_auth = 0, updated_at = ? WHERE path IN ('/ppt', '/consult')`).run(now);
    const hasPpt = db.prepare(`SELECT 1 FROM home_modules WHERE path = '/ppt'`).get();
    if (!hasPpt) {
      db.prepare(
        `INSERT INTO home_modules (id, title, description, icon, path, category, featured, require_auth, sort_order, visible, grid_span, created_at, updated_at)
         VALUES ('ppt-module-001', 'HTML 展示稿', '输入提纲，AI 排版出一整份可在线演示的展示稿', '🖼️', '/ppt', 'AI 应用', 0, 0, -1, 1, '1x1', ?, ?)`
      ).run(now, now);
    }
  },
};
