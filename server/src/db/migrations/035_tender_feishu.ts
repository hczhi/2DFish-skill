import type { Migration } from '../migrator.js';

function addColumnIfNotExists(db: any, table: string, column: string, definition: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as any[];
  if (!cols.some((c: any) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

// 飞书群机器人推送配置（per-user，由管理员在后台配置）。
// 评分完成后，把该用户本轮新产生的、达到 feishu_min_score 的推荐汇总推送到其群 webhook。
export const migration_035: Migration = {
  id: '035_tender_feishu',
  up(db) {
    addColumnIfNotExists(db, 'tender_user_preferences', 'feishu_webhook', "TEXT DEFAULT ''");
    addColumnIfNotExists(db, 'tender_user_preferences', 'feishu_secret', "TEXT DEFAULT ''");
    addColumnIfNotExists(db, 'tender_user_preferences', 'feishu_enabled', 'INTEGER DEFAULT 0');
    addColumnIfNotExists(db, 'tender_user_preferences', 'feishu_min_score', 'INTEGER DEFAULT 55');
  },
};
