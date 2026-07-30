import type { Migration } from '../migrator.js';

function addColumnIfNotExists(db: any, table: string, column: string, definition: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as any[];
  if (!cols.some((c: any) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

// 第二张表「全部标讯」：把库里所有标讯（不只是达到推荐阈值的）也同步到同一个多维表格。
//
// 状态位为什么是独立关联表，而不是 tenders 上加一列 bitable_synced_at：
// 标讯数据是全平台共享的，但多维表格是 per-user 配置的（每家公司在自己飞书里建应用）。
// 若状态位是 tenders 上的单列，第一个用户同步完就把全局状态位写满了，
// 第二家公司的「全部标讯」表会永久收不到任何数据 —— 而且不报错，静默为空。
// 因此状态位必须按 (user_id, tender_id) 记录。
//
// 推荐表那边沿用 tender_recommendations.bitable_synced_at 不动：
// 那张表的行本身就是 per-user 的，列上挂状态位没有这个问题。
export const migration_046: Migration = {
  id: '046_tender_bitable_all',
  up(db) {
    // 「全部标讯」数据表 id。与 bitable_table_id（推荐表）同属一个 bitable_app_token。
    addColumnIfNotExists(db, 'tender_user_preferences', 'bitable_all_table_id', "TEXT DEFAULT ''");

    // 存在一行 = 该标讯已同步进该用户的「全部标讯」表。
    db.exec(`
      CREATE TABLE IF NOT EXISTS tender_bitable_sync (
        user_id   TEXT NOT NULL,
        tender_id TEXT NOT NULL,
        synced_at TEXT NOT NULL,
        PRIMARY KEY (user_id, tender_id)
      )
    `);

    // 取待同步是 tenders LEFT JOIN 本表 WHERE s.tender_id IS NULL，按 user_id 过滤。
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_tender_bitable_sync_user
      ON tender_bitable_sync (user_id, tender_id)
    `);
  },
};
