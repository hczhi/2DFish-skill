import type { Migration } from '../migrator.js';

// 用户勾选的信息源平台：只有勾选的平台才参与评分和飞书推送。
// 存 JSON 数组，如 ["gdgpo","meicloud"]。空数组表示"不限平台"（全部参与），
// 这样既不影响已有用户，也避免用户误清空后静默收不到任何推荐。
export const migration_043: Migration = {
  id: '043_tender_user_platforms',
  up(db) {
    const cols = db.prepare(`PRAGMA table_info(tender_user_preferences)`).all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === 'platforms')) {
      db.exec(`ALTER TABLE tender_user_preferences ADD COLUMN platforms TEXT DEFAULT '[]'`);
    }
  },
};
