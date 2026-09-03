import type { Migration } from '../migrator.js';

/**
 * 把已经存下来的「第 N 个图位是 3:4 portrait，备的那张是 16:9 landscape」那几条从
 * `ppt_deck_pages.problems_json` 里删掉。
 *
 * 这条提示已经从 `imageService.applyPreparedImages` 里去掉了（改成那一格的标签上安静写
 * 一句「会裁掉一块」）—— 但**光改代码不够**：`problems_json` 是生成那一刻存下来的，换图
 * 那条路（`pastePrepared`）还刻意沿用原来那几条，所以老页面会一直挂着这几行。而它们占着
 * 「这一页有 N 处注意」那个数字和右侧把手上的红标，真正要看的那条（版式塌了 / 还是占位图）
 * 于是被挤下去或者干脆被当成噪音无视 —— 那个把手是这一页唯一的报警。
 *
 * 只删这一种句式，别的 problems 一律留着。
 */
export const migration_094: Migration = {
  id: '094_ppt_drop_ratio_problems',
  up(db) {
    const rows = db
      .prepare(`SELECT id, problems_json FROM ppt_deck_pages WHERE problems_json LIKE '%备的那张是%'`)
      .all() as Array<{ id: string; problems_json: string }>;
    const upd = db.prepare(`UPDATE ppt_deck_pages SET problems_json = ? WHERE id = ?`);
    for (const r of rows) {
      let list: unknown;
      try {
        list = JSON.parse(r.problems_json);
      } catch {
        continue; // 存坏了的那一行别在迁移里炸掉整个启动
      }
      if (!Array.isArray(list)) continue;
      const kept = list.filter((p) => !(typeof p === 'string' && /个图位是.*备的那张是/.test(p)));
      if (kept.length !== list.length) upd.run(JSON.stringify(kept), r.id);
    }
  },
};
