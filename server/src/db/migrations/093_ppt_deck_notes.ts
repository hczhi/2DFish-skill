import type { Migration } from '../migrator.js';

/**
 * 整份稿子统一的那段要求（`ppt_decks.notes`，字体/排版/语气）。每一页生成时都带上，
 * 和页级的 `setup_notes`（092）**两段一起发**，不是二选一。
 *
 * 为什么不是「页级有就顶掉整份那段」：那样他在某一页补一句「这里的表格用等宽字体」，
 * 整份定的「语气克制、不要感叹号」就在这一页悄悄失效了 —— 生成出来照样是一页完整的
 * 幻灯片，只有那一页语气不一样，没有一处会说。
 *
 * 上限和页级同一个数（`MAX_PAGE_NOTES_CHARS`）：两处两个数的话，整份里写得下的那段
 * 复制到某一页会被拒，而他看不出是哪一边的限制。
 */
export const migration_093: Migration = {
  id: '093_ppt_deck_notes',
  up(db) {
    const cols = db.prepare(`PRAGMA table_info(ppt_decks)`).all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === 'notes')) {
      db.exec(`ALTER TABLE ppt_decks ADD COLUMN notes TEXT NOT NULL DEFAULT ''`);
    }
  },
};
