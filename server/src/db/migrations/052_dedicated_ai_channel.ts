import type { Migration } from '../migrator.js';

// 用户专属 AI 渠道：让管理员能为单个用户配一整套独立的模型接入点，
// 该用户所有 AI 调用（含生图）全部走自己的 key，不再碰平台的。
//
// 设计取的是「全有或全无」，不做平台/专属混用：
//   - ai_providers.owner_user_id：NULL = 平台级（现有行全部如此，行为不变）；
//     有值 = 属于该用户的专属接入点。
//   - user.use_dedicated_ai：开关。开着才走专属，关着完全走原来的平台链。
//     开关独立于「有没有配 provider」，这样管理员可以先配好不启用、
//     出问题一键关回平台而不必删配置。
//
// 为什么开关开了就不回落平台：回落会造成「用户以为自己在花自己的钱、
// 实际烧的是平台 key」这种隐形成本，且故障表现是"某个功能偶尔变慢/结果不同"，
// 根本查不到原因。缺档就明确报错，是刻意选择。
//
// ai_logs 两列用于成本归属审计：
//   - provider_id：这次调用用的哪条 provider。
//   - provider_owner：'platform' | 'dedicated'。冗余存而不是 join ai_providers
//     反查——provider 被删之后历史日志还得能分清是谁的钱，这是审计的底线。
export const migration_052: Migration = {
  id: '052_dedicated_ai_channel',
  up(db) {
    const cols = (table: string) =>
      (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name);

    const providerCols = cols('ai_providers');
    if (!providerCols.includes('owner_user_id')) {
      db.exec(`ALTER TABLE ai_providers ADD COLUMN owner_user_id TEXT`);
    }

    const userCols = cols('user');
    if (!userCols.includes('use_dedicated_ai')) {
      db.exec(`ALTER TABLE user ADD COLUMN use_dedicated_ai INTEGER NOT NULL DEFAULT 0`);
    }

    const logCols = cols('ai_logs');
    if (!logCols.includes('provider_id')) {
      db.exec(`ALTER TABLE ai_logs ADD COLUMN provider_id TEXT`);
    }
    if (!logCols.includes('provider_owner')) {
      db.exec(`ALTER TABLE ai_logs ADD COLUMN provider_owner TEXT`);
    }

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_ai_providers_owner
        ON ai_providers (owner_user_id, kind, tier, enabled);
      CREATE INDEX IF NOT EXISTS idx_ai_logs_provider_owner
        ON ai_logs (provider_owner, created_at);
    `);
  },
};
