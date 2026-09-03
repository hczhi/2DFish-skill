import type { Migration } from '../migrator.js';

/**
 * 「先备图、再生成页面」用的一列：这一页备好的图（JSON 数组，按规划里 `imageSpecs`
 * 的顺序对齐，`index` 从 1 起）。
 *
 * 为什么要单独一列、而不是复用 `images_json`：`images_json` 是**配图那一步跑完之后**的
 * 结果（哪一格贴上去了、哪一格还是占位图），`savePageHtml` 会把它清掉 —— 重新生成一次
 * HTML 就该忘掉旧的配图结果。备好的图正相反：它在 HTML **之前**就存在，而且是花过真钱的，
 * 「重新生成这一页」绝不能把它扔掉（扔了的话界面上只是「这一页又要重新配图」，
 * 而那几张的钱已经花了，没有一处会说）。
 *
 * 允许出现 `html = ''` 的行（还没生成 HTML 就先备了图）。`built_count` 数的是
 * `html <> ''`，所以这种行不会被算成「已生成」；`POST /decks/:id/images` 和
 * `savePageImages` 也都要求 `html <> ''`，不会把它当成一页可以配图的内容。
 *
 * 重新规划仍然会连这一列一起删（新规划的第 3 页和旧的第 3 页压根不是一页内容），
 * 但**扔掉了几张备好的图必须报出来**（见 deckStore.savePlan）：那些图还在素材库里，
 * 不说的话他以为凭空少了几次额度。
 */
export const migration_091: Migration = {
  id: '091_ppt_pending_images',
  up(db) {
    const cols = db.prepare(`PRAGMA table_info(ppt_deck_pages)`).all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === 'pending_images_json')) {
      db.exec(`ALTER TABLE ppt_deck_pages ADD COLUMN pending_images_json TEXT NOT NULL DEFAULT ''`);
    }
  },
};
