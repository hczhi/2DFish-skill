import type { Migration } from '../migrator.js';

// 素材库的租户列。100 只给 `ppt_decks` 加了租户键，`ppt_assets` 还是纯 `user_id` ——
// 一把 pk 下的每一张生成图都记在**绑定账号**头上，于是挑图抽屉里 A 公司能翻到 B 公司
// 生成的图（客户的产品图、门店照），而那个抽屉读起来就是一屏正常的素材，没有一处报错。
//
// 租户 = **一家公司** = `(user_id, sdk_pk)`，和稿子同一份判定（`services/ppt/tenant.ts`）。
// `external_uid` 只记「这一张是谁生成的」，**不进 WHERE** —— 进了的话公司 A 的员工各自
// 一个空素材库，同事刚生成的图挑不到，而接口全 200。
//
// **`UNIQUE(user_id, url)` 保持不动**，不改成带 sdk_pk 的三列：SQLite 的唯一索引里
// NULL 互不相等，网页登录那些行 sdk_pk 全是 NULL，同一个 url 就能重复插进去 ——
// 素材库里出现两张一样的卡，删掉一张刷新后还在（另一行），看起来像删除没生效
// （正是 090 那条注释警告的现象）。同一个 url 本来就只可能属于一个租户（url 是生成时
// 那一刻写下来的），所以按 url 去重不会跨租户误判。
//
// 存量行两列都留空（NULL）= 归给平台租户，也就是绑定账号自己在网页上看到的那一批 ——
// 回填成某把 pk 的话，那个账号自己的素材库会当场空掉。
export const migration_101: Migration = {
  id: '101_ppt_asset_tenant',
  up(db) {
    const cols = db.prepare(`PRAGMA table_info(ppt_assets)`).all() as Array<{ name: string }>;
    const has = (n: string) => cols.some((c) => c.name === n);
    if (!has('sdk_pk')) db.exec(`ALTER TABLE ppt_assets ADD COLUMN sdk_pk TEXT`);
    if (!has('external_uid')) db.exec(`ALTER TABLE ppt_assets ADD COLUMN external_uid TEXT`);
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_ppt_assets_tenant
         ON ppt_assets(user_id, sdk_pk, created_at DESC)`
    );
    // 稿子那边的索引也补一条不带 external_uid 的：100 建的那条是
    // (user_id, sdk_pk, external_uid, updated_at)，而列表现在只按前两列筛 ——
    // 少了这条，租户里稿子一多，列表就是全表扫 + 排序（慢，但不报错）。
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_ppt_decks_tenant
         ON ppt_decks(user_id, sdk_pk, updated_at DESC)`
    );
  },
};
