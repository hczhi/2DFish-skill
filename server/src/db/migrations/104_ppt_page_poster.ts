import type { Migration } from '../migrator.js';

/**
 * 单图模式（poster）变形之前那一页的原样（`ppt_deck_pages.poster_from_html` +
 * `poster_from_images`）。
 *
 * 为什么要存起来：变成单图之后，这一页的 html 里只剩一张图 —— 原来那些文字块、版式、
 * `data-eid` 全不在了。不存的话「改回原版」只有一条路：重新生成这一页（一次真实调用，
 * 而且版式和文案会重排成另一副样子），而按钮上写的是「改回原版」。
 *
 * **为什么不塞在 html 里当一段注释**：`findImageSlots` 是正则扫 `data-img-prompt` 的，
 * 注释里那几个图槽照样被数进来 —— 这一页于是变成 2~3 格，下一次生成的图贴进注释里那一格，
 * 画面上的单图再也换不掉，而接口 200、面板上写着「配图 1/1 张」。
 *
 * **两列一起存**（html + 配图记录）：单图那一页的 `images_json` 要清空（画面上是占位图，
 * 留着旧记录的话面板上挂着上一版的缩略图而画面里是占位图）。只存 html 的话改回原版之后
 * 面板写着「还没配过图」而图就在页面里 —— 他会再点一次配图（那一步看到不是占位图会跳过，
 * 但「换一批图」就真的重花一遍）。
 *
 * 缺省空串 = 「这一页不是单图模式」，所以老稿子读出来和存进去那天一模一样。
 */
export const migration_104: Migration = {
  id: '104_ppt_page_poster',
  up(db) {
    const cols = db.prepare(`PRAGMA table_info(ppt_deck_pages)`).all() as Array<{ name: string }>;
    const has = (name: string) => cols.some((c) => c.name === name);
    if (!has('poster_from_html')) {
      db.exec(`ALTER TABLE ppt_deck_pages ADD COLUMN poster_from_html TEXT NOT NULL DEFAULT ''`);
    }
    if (!has('poster_from_images')) {
      db.exec(`ALTER TABLE ppt_deck_pages ADD COLUMN poster_from_images TEXT NOT NULL DEFAULT ''`);
    }
  },
};
