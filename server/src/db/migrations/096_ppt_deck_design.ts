import type { Migration } from '../migrator.js';

/**
 * 整份稿子的设计规范（`ppt_decks.design_json`：配色 / 字体 / 疏密，见 `services/ppt/designSpec.ts`）。
 *
 * 存 JSON 而不是三列：这份规范后面还要长（页眉样式、字号阶梯），每加一项加一列的话
 * 老 deck 那几列的缺省值和「他没选过」分不开。
 *
 * 空串 = 默认那一套（老 deck 全是这个）。**不给它填一份具体的 id**：填了的话哪天默认那套
 * 换了色，老 deck 全部钉在旧配色上，而它们看起来只是「这几份稿子的颜色不一样」。
 */
export const migration_096: Migration = {
  id: '096_ppt_deck_design',
  up(db) {
    const cols = db.prepare(`PRAGMA table_info(ppt_decks)`).all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === 'design_json')) {
      db.exec(`ALTER TABLE ppt_decks ADD COLUMN design_json TEXT NOT NULL DEFAULT ''`);
    }
  },
};
