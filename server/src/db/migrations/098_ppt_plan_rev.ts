import type { Migration } from '../migrator.js';

/**
 * 页序版本号（`ppt_decks.plan_rev`）：页数/页序**每变一次 +1**。
 *
 * 为什么必须有：一份 deck 的每一页在库里只按页码对齐（`UNIQUE(deck_id, page)`），而生成一页
 * 要三十秒以上、提纲是服务端**按页码**从 `plan_json` 取的。删掉第 3 页之后原来的第 5 页变成
 * 第 4 页 —— 这时上一刻发出去的「生成第 5 页」回来了，那份 html 会 upsert 到**现在的**第 5 页
 * 上：出来是一页完整的幻灯片，只是照着别的一页的提纲排的，两边都不报错，而这是一次真实花费。
 * 所以按页码写库的那几条路（生成 / 备图 / 配图 / 重排图位）都要带上他打开时那个 rev，
 * 不一致就 409 拒掉。
 *
 * 只靠前端「生成中不许删页」不行：那个判断在前端，哪天被改掉之后没有任何现象 ——
 * 错位的那一页在界面上是一页正常的幻灯片。
 *
 * 缺省 0：老稿子第一次带上来的也是 0，对得上（给个随机初值的话所有历史稿子的第一次
 * 生成都会 409，而他刚打开页面什么都没改）。
 */
export const migration_098: Migration = {
  id: '098_ppt_plan_rev',
  up(db) {
    const cols = db.prepare(`PRAGMA table_info(ppt_decks)`).all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === 'plan_rev')) {
      db.exec(`ALTER TABLE ppt_decks ADD COLUMN plan_rev INTEGER NOT NULL DEFAULT 0`);
    }
  },
};
