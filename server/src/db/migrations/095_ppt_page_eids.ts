import type { Migration } from '../migrator.js';
import { injectEids } from '../../services/ppt/pageEdit.js';

/**
 * 给已经生成过的那几页补上 `data-eid`（就地改文字靠它定位每一段文字）。
 *
 * **光改生成那一步不够**：`data-eid` 是生成时写进 html 的，而库里那些页是花过真钱的
 * —— 不补的话「双击改文字」在老页面上一个字都改不动，而屏幕上那一页读起来完全正常
 * （唯一的出路是每一页重新生成一次 = 十几次真实调用）。
 *
 * `injectEids` 是纯函数（只在开标签里插一个属性，不动文字、不动结构、不联网），
 * 已经带 eid 的原样返回，所以这条迁移跑几遍结果一样。
 */
export const migration_095: Migration = {
  id: '095_ppt_page_eids',
  up(db) {
    const rows = db
      .prepare(`SELECT id, html FROM ppt_deck_pages WHERE html LIKE '%<section%' AND html NOT LIKE '%data-eid%'`)
      .all() as Array<{ id: string; html: string }>;
    const upd = db.prepare(`UPDATE ppt_deck_pages SET html = ? WHERE id = ?`);
    for (const r of rows) {
      const next = injectEids(r.html);
      if (next !== r.html) upd.run(next, r.id);
    }
  },
};
