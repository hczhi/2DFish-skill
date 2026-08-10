import type { Migration } from '../migrator.js';

function addColumnIfNotExists(db: any, table: string, column: string, definition: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as any[];
  if (!cols.some((c: any) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

// 标讯推送从「群自定义机器人 webhook」换成「飞书应用推送到群」。
//
// ── 为什么不复用 feishu_apps 表（飞书助理那套） ──
// 明确的产品要求：每个子项目数据独立，后期可能整个拆出去单独部署。
// 复用 feishu_apps 会让标讯模块依赖飞书助理模块的表，拆分时得先解耦。
// 而标讯模块**本来就有自己的一份** app_id/app_secret
// （migration 045，多维表格同步在用，050 已把 secret 加密），
// 所以这里只差一个「推到哪个群」——加一列即可，不新建表、不跨模块引用。
//
// 复用同一份凭据还有个实际好处：推送卡片底部要放多维表格链接，
// 而那张表就是这个 app 建的。两者用同一个 app 才能保证
// 「推送成功」和「点进去能看到表」是一致的。
//
// ── chat_id 为什么让用户直接填 ──
// 早先 oc_xxx 在飞书客户端里看不到（这是 migration 058 给助理模块做会话注册表的
// 原因），现在飞书已经可以直接看到群 id 了，用户能自己复制。所以这里不做注册表,
// 就一个文本框。一个应用可以被拉进多个群，推送时只发到这里配的那个群。
//
// ── 为什么保留 feishu_webhook 那几列 ──
// 用户明确说不再需要 webhook，推送路径**只走应用**。但列不删：
//   1. 删列要重建表（SQLite 的 DROP COLUMN 在老版本上不可用），
//      而这几列里存着用户填过的东西，删了不可逆；
//   2. 万一应用推送在某个租户上跑不通，还能看到他原来配的是什么。
// 代码侧不再读 feishu_webhook —— 判断「推送是否开启」改看 app_id + chat_id。
export const migration_061: Migration = {
  id: '061_tender_feishu_app_push',
  up(db) {
    // 推送目标群。空 = 未配置 = 不推送。
    addColumnIfNotExists(db, 'tender_user_preferences', 'feishu_chat_id', "TEXT DEFAULT ''");

    // 「该用户未评分的标讯」靠 NOT EXISTS 反查推荐表，需要
    // (user_id, tender_id) 上的索引。**不用建** —— 建表时的
    // UNIQUE(user_id, tender_id) 已经生成了 sqlite_autoindex_tender_recommendations_2，
    // EXPLAIN QUERY PLAN 实测走的就是它（COVERING INDEX）。
    // 再建一个同列同序的索引只会多维护一棵 B 树，查询计划一行都不变。
    // 之前这里确实建过 idx_tender_rec_user_tender，所以顺手删掉。
    db.exec(`DROP INDEX IF EXISTS idx_tender_rec_user_tender`);
  },
};
