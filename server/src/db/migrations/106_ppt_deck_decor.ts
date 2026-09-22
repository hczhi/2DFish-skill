import type { Migration } from '../migrator.js';

/**
 * 整份稿子共用的那一层**装饰背景**（`ppt_decks.decor_url` / `decor_alpha` / `decor_prompt`）。
 *
 * 和 `ppt_deck_pages` 上那一层（每页自己加的 `.page-decor`）**不是一回事**，也不替换它：
 * 页上那一层是写进 html 的一个**图位**（要单独生一张图、占这一页 6 格里的一格），
 * 而这一层只存一个地址，拼页的时候（`deckShell.previewSection`）现注进去 ——
 * **一张图全份复用、一格图位都不占**。
 *
 * 三条边界：
 * ① 存在 deck 上而不是塞进 `design_json`：那一列是**发给模型**的设计规范（配色/字体/疏密，
 *    `parseDesignSpec` 会校验每一个档位 id）。把一个 `/uploads/xxx.png` 塞进去之后，
 *    要么被校验当成脏数据丢掉（界面上「保存成功」而那层图第二次打开就没了），
 *    要么跟着设计规范一起进提示词 —— 模型看到一个地址，它会照着编一句画风。
 * ② 缺省空串 = 没有这一层。给任何非空缺省的话，所有历史稿子下一次打开时集体多一层底纹，
 *    而没有一处会说（读起来只是「这个模板好像换了」）。
 * ③ `decor_alpha` 缺省 0.18（= `imageModes.DECOR_ALPHA`）：0 的话他配好图之后画面上
 *    一点变化都没有，而接口 200、后台记着地址 —— 看起来像这个功能没生效。
 */
export const migration_106: Migration = {
  id: '106_ppt_deck_decor',
  up(db) {
    const cols = db.prepare(`PRAGMA table_info(ppt_decks)`).all() as Array<{ name: string }>;
    const has = (name: string) => cols.some((c) => c.name === name);
    if (!has('decor_url')) {
      db.exec(`ALTER TABLE ppt_decks ADD COLUMN decor_url TEXT NOT NULL DEFAULT ''`);
    }
    if (!has('decor_alpha')) {
      db.exec(`ALTER TABLE ppt_decks ADD COLUMN decor_alpha REAL NOT NULL DEFAULT 0.18`);
    }
    if (!has('decor_prompt')) {
      db.exec(`ALTER TABLE ppt_decks ADD COLUMN decor_prompt TEXT NOT NULL DEFAULT ''`);
    }
  },
};
