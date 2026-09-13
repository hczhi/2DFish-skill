import type { Migration } from '../migrator.js';

// HTML 展示稿（/ppt）对外接入的 publishable key —— 让第三方**纯前端**页面用 iframe 嵌入
// /ppt 工作台（对照 084 的 consult 那张表，同一个 pk 模型、同一份 core/sdkKeys.ts）。
//
// 和 consult 那条最要紧的差别：**ppt 一次操作花的钱不是一次调用**。规划一份 12 页的稿子
// 是 1 次文本调用，生成那 12 页是 12 次，配图是每张一次**生图**调用（imageGateway，真钱，
// 比文本贵一个量级）。所以这里的 `daily_ai_limit` 缺省值不能照抄 consult 的 50 ——
// 那个数在这条路上是「三份稿子」而不是「五十次操作」，而额度打满之后接入方看到的只是
// 「生成失败」。缺省 120（≈ 三四份完整稿子）+ `max_decks` 50。
//
// 两个上限**都有非空缺省值**，新发的 key 一出生就有天花板：pk 是写在第三方页面 JS 里的
// 公开字符串，白名单域名内（同一个 iframe 宿主、或者那个站上的 XSS）就能一直调
// `/decks/:id/pages`。绑定账号走平台渠道时还有 10 次/天兜着，但**开了专属渠道的账号绕过
// ai_quota** —— 那一档没有任何上限，烧的是他自己那把 key 的真钱，而每一次调用都返回一页
// 正常的幻灯片，后台只看到用量在涨。
//
// 用量记在 key 这一行上（读时按日期归零，和 ai_quota 一个写法），不另开表：管理员必须在
// 后台看得见「这个接入方今天烧了多少」—— 看不见的话额度打满之后他只会收到接入方一句
// 「你们系统坏了」，而两边都不知道是限额。
//
// `ppt_decks` 的两列租户键（对照 085）：少了它们，一把 pk 下所有终端用户共用同一个 owner，
// `listDecks` 会把 A 客户的稿子（提纲、品牌名、客户资料）列给 B 客户看 —— 那个列表读起来
// 就是一列正常的稿子，页数、时间全都对，没有任何一处报错。归属判定一律用 NULL 安全比较
// `IS ?`（`= ?` 对 NULL 永远为假 —— 用它的话老稿子一条都读不出来，界面上是「我的稿子都
// 不见了」）。也因此绑定账号自己在网页上的稿子和它名下的第三方租户互相看不见：sdk_pk 一个
// 是 NULL 一个是那把 pk。
//
// external_uid（第三方那边的终端用户 id）**不存在 key 表里**，它在换 token 时签进 JWT。
// 纯前端下它是第三方页面传的、不可信 —— 只能做展示隔离，不是安全边界。
export const migration_100: Migration = {
  id: '100_ppt_sdk_keys',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS ppt_sdk_keys (
        pk TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL DEFAULT '',
        allowed_origins TEXT NOT NULL DEFAULT '[]',
        enabled INTEGER NOT NULL DEFAULT 1,
        rate_limit INTEGER NOT NULL DEFAULT 60,
        daily_ai_limit INTEGER NOT NULL DEFAULT 120,
        max_decks INTEGER NOT NULL DEFAULT 50,
        ai_used_today INTEGER NOT NULL DEFAULT 0,
        ai_used_date TEXT,
        created_at TEXT NOT NULL,
        last_used_at TEXT
      )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_ppt_sdk_keys_user ON ppt_sdk_keys(user_id)`);

    const cols = db.prepare(`PRAGMA table_info(ppt_decks)`).all() as Array<{ name: string }>;
    const has = (n: string) => cols.some((c) => c.name === n);
    if (!has('sdk_pk')) db.exec(`ALTER TABLE ppt_decks ADD COLUMN sdk_pk TEXT`);
    if (!has('external_uid')) db.exec(`ALTER TABLE ppt_decks ADD COLUMN external_uid TEXT`);
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_ppt_decks_owner
         ON ppt_decks(user_id, sdk_pk, external_uid, updated_at DESC)`
    );
  },
};
