import type { Migration } from '../migrator.js';

// SDK publishable keys — 供第三方纯前端项目嵌入标讯智能推荐使用。
// pk 是公开的（会出现在第三方页面的 JS 里），安全边界靠：
//   1. pk 绑定固定 user_id（推荐归属，后端写死，前端不可改）
//   2. allowed_origins 域名白名单（换取短 token 时校验 Origin/Referer）
//   3. 换出的短 token scope=tender:read，仅能访问只读推荐接口
export const migration_034: Migration = {
  id: '034_sdk_keys',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS sdk_keys (
        pk TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL DEFAULT '',
        allowed_origins TEXT NOT NULL DEFAULT '[]',
        enabled INTEGER NOT NULL DEFAULT 1,
        rate_limit INTEGER NOT NULL DEFAULT 60,
        created_at TEXT NOT NULL,
        last_used_at TEXT
      )
    `);

    db.exec(`CREATE INDEX IF NOT EXISTS idx_sdk_keys_user ON sdk_keys(user_id)`);
  },
};
