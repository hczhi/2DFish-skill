import type { Migration } from '../migrator.js';

/**
 * PPT 素材库：每一张真的生成出来的配图存一行（按人）。
 *
 * 为什么必须落库：一张图是一次真实的生图调用（几十秒 + 一次额度），而在这之前它只
 * 存在于**那一页的 html 里**。同一张图想在另一份稿子、另一页里再用一次，唯一的办法是
 * 去翻旧 deck 的 HTML 找 url —— 而界面上没有任何地方能看出「这张我以前生成过」，
 * 于是他会再花一次钱生成一张几乎一样的图，没有一处会提示。
 *
 * `prompt` 存的是**槽位那句 `data-img-prompt`**（人能读、能改的那句），不是渲染完的
 * 整段画风提示词：整段里 90% 是画风模板（同一套画风每张都一样），存它的话素材库上
 * 每张卡片的文字都长得一模一样，挑图时分不出哪张是哪张。
 *
 * `ratio` / `mode` / `style_id` 三列是「重用时会不会看出破绽」的唯一依据：3:4 的图塞进
 * 16:9 的槽位是 `object-fit: cover` 裁掉两边（人物脸被裁掉），另一套画风的图混进这份 deck
 * 是笔触不统一 —— 两种都不报错，每张单看都不错。
 *
 * `storage` 要存：COS 没配好时图落在本机 `/uploads`，换机器/多实例之后素材库里那几张
 * 是破图，而它在生成那一刻一切正常（列表上要能标出来，不然他会以为是自己删过）。
 *
 * `UNIQUE(user_id, url)`：同一个 url 只留一行。重复插的话素材库里出现两张一样的卡，
 * 他删掉一张以为清掉了，列表刷新后那张图还在（另一行），看起来像删除没生效。
 *
 * 删素材**只删这一行**，不动 COS 上的文件、也不动已经用了它的那几页 html ——
 * 所以界面上必须写清楚这一点（见 `assetStore.deleteAsset` 的注释）。
 */
export const migration_090: Migration = {
  id: '090_ppt_assets',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS ppt_assets (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        -- 转存后的永久地址（COS）或者 /uploads 下的本机地址
        url TEXT NOT NULL,
        -- 槽位那句 data-img-prompt（重用时按它认图、也可以照它改）
        prompt TEXT NOT NULL DEFAULT '',
        -- concept / case / data：哪一路画法（填错的话数据页会拿到一张概念插画）
        mode TEXT NOT NULL DEFAULT '',
        -- 生成时用的画风（S-A ~ S-F）。混用是「笔触不统一」，每张单看都好
        style_id TEXT NOT NULL DEFAULT '',
        -- 16:9 / 1:1 / 3:4：塞进比例不对的槽位会被 cover 裁掉，不报错
        ratio TEXT NOT NULL DEFAULT '',
        model TEXT NOT NULL DEFAULT '',
        -- 'cos' | 'local'：local 的那几张换机器之后是 404
        storage TEXT NOT NULL DEFAULT '',
        -- 出处（哪份稿子的第几页生成的）。删了那份稿子也不删素材：图还在 COS 上，
        -- 而它是花过钱的
        deck_id TEXT NOT NULL DEFAULT '',
        page INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        UNIQUE(user_id, url)
      );
    `);
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_ppt_assets_user
         ON ppt_assets(user_id, created_at DESC)`
    );
  },
};
