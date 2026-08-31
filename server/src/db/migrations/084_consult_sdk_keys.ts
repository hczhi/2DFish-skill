import type { Migration } from '../migrator.js';

// 品牌咨询对外接入的 publishable key —— 让第三方**纯前端**页面用 iframe 嵌入 /consult
// 工作台（对照 034 的 sdk_keys，那是 tender 的只读 SDK）。
//
// 和 tender 那条最要紧的差别：consult 的每个端点都是**写**，而且 /draft、/directions、
// /intake 每次都烧一次 strong 调用。pk 是公开的（会出现在第三方页面的 JS 里），所以这张
// 表存的不是「密钥」，只是一条绑定关系：
//   1. user_id —— 项目归属和 AI 额度记在哪个平台账号（后端写死，前端改不了）
//   2. allowed_origins —— 换短 token 时校验 Origin/Referer；也是 iframe 的
//      frame-ancestors 放行名单（见后续切片）
//   3. 换出的短 token scope=consult:embed，全局闸门只放行 /api/consult/{stages,projects}
//
// external_uid（第三方那边的终端用户 id）**不存在这张表里**，它在换 token 时签进 JWT。
// 纯前端下它是第三方页面传的、不可信 —— 只能做展示隔离，不是安全边界。
export const migration_084: Migration = {
  id: '084_consult_sdk_keys',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS consult_sdk_keys (
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

    db.exec(`CREATE INDEX IF NOT EXISTS idx_consult_sdk_keys_user ON consult_sdk_keys(user_id)`);
  },
};
