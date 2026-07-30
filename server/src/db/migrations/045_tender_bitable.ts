import type { Migration } from '../migrator.js';

function addColumnIfNotExists(db: any, table: string, column: string, definition: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as any[];
  if (!cols.some((c: any) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

// 飞书多维表格同步配置（per-user，一个平台账号 = 一家公司 = 一张表）。
//
// app_id/app_secret 放在 per-user 而不是平台级 system_config：
// 企业自建应用只能在创建它的飞书租户内使用，所以每家客户都得在自己的飞书里建应用，
// 我们没法用一套平台凭据去写不同租户的表（那需要 ISV 商店应用资质）。
//
// bitable_app_token / table_id / url 由服务端建表接口返回后写入，用户不用手填。
export const migration_045: Migration = {
  id: '045_tender_bitable',
  up(db) {
    addColumnIfNotExists(db, 'tender_user_preferences', 'feishu_app_id', "TEXT DEFAULT ''");
    addColumnIfNotExists(db, 'tender_user_preferences', 'feishu_app_secret', "TEXT DEFAULT ''");
    addColumnIfNotExists(db, 'tender_user_preferences', 'bitable_app_token', "TEXT DEFAULT ''");
    addColumnIfNotExists(db, 'tender_user_preferences', 'bitable_table_id', "TEXT DEFAULT ''");
    addColumnIfNotExists(db, 'tender_user_preferences', 'bitable_url', "TEXT DEFAULT ''");
    addColumnIfNotExists(db, 'tender_user_preferences', 'bitable_enabled', 'INTEGER DEFAULT 0');

    // 同步状态位：NULL = 未推送。驱动"失败下轮自动重试 + 历史推荐可回填"。
    addColumnIfNotExists(db, 'tender_recommendations', 'bitable_synced_at', 'TEXT');

    // 同步查询是 user_id + bitable_synced_at IS NULL + tier + total_score，
    // 推荐表会随时间线性增长，加个联合索引避免每次全表扫。
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_tender_rec_bitable_sync
      ON tender_recommendations (user_id, bitable_synced_at)
    `);
  },
};
