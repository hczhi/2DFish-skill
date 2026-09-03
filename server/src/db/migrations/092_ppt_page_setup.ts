import type { Migration } from '../migrator.js';

/**
 * 「生成前改一下」用的两列：这一页他自己挑的版式（`setup_layout_id`）和手写的额外要求
 * （`setup_notes`，字体/排版/语气那一段）。
 *
 * **和 `layout_id` 是两回事，绝不能合并**：`layout_id` 记的是「现在这份 html 是用哪条版式
 * 排出来的」，`setup_layout_id` 是「他要的那条」。合成一列的话，换了版式而生成失败之后
 * 界面上那个标签写着新版式，画面里还是旧版式排的那一版 —— 两版都是一页正常的幻灯片，
 * 读起来完全看不出来（他会以为新版式就长这样，然后去骂案例库）。
 *
 * 存在库里而不是只放在前端那个对话框里：不存的话「逐页生成」和下一次「重新生成」都会
 * 退回规划里那条版式、丢掉那段要求，而生成出来照样是一页完整的幻灯片，只是他刚写的
 * 「语气克制一点、别用感叹号」一处都没生效，也没有一处会说。
 *
 * 重新规划照旧连这两列一起删（新规划的第 3 页和旧的第 3 页压根不是一页内容），
 * 但**扔掉了几页的要求要报出来**（`savePlan` 的 `clearedNotes`）—— 不说的话他以后每次
 * 生成拿到的都是没带要求的那一版。
 */
export const migration_092: Migration = {
  id: '092_ppt_page_setup',
  up(db) {
    const cols = db.prepare(`PRAGMA table_info(ppt_deck_pages)`).all() as Array<{ name: string }>;
    const has = (name: string) => cols.some((c) => c.name === name);
    if (!has('setup_layout_id')) {
      db.exec(`ALTER TABLE ppt_deck_pages ADD COLUMN setup_layout_id TEXT NOT NULL DEFAULT ''`);
    }
    if (!has('setup_notes')) {
      db.exec(`ALTER TABLE ppt_deck_pages ADD COLUMN setup_notes TEXT NOT NULL DEFAULT ''`);
    }
  },
};
