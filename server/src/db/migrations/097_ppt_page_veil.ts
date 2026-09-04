import type { Migration } from '../migrator.js';

/**
 * 每页的黑色蒙版透明度（`ppt_deck_pages.veil_opacity`，0 = 没有蒙版）。
 *
 * 存在页上而不是 deck 的 `design_json` 里：调它的原因永远是「**这一页**的背景图太亮，
 * 字看不清」，整份统一压暗会把没有背景图的那几页压成灰底。
 *
 * 缺省 0：老稿子重新读出来时必须和存进去那天长得一模一样。给个非 0 的缺省的话，
 * 所有历史稿子会在下一次打开时集体变暗，而没有一处会说 —— 看起来只是「配色好像沉了」。
 */
export const migration_097: Migration = {
  id: '097_ppt_page_veil',
  up(db) {
    const cols = db.prepare(`PRAGMA table_info(ppt_deck_pages)`).all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === 'veil_opacity')) {
      db.exec(`ALTER TABLE ppt_deck_pages ADD COLUMN veil_opacity REAL NOT NULL DEFAULT 0`);
    }
  },
};
