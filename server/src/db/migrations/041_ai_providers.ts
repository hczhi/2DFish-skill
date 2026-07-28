import type { Migration } from '../migrator.js';

// AI 模型 provider 表：把原来散在 system_config 里的裸 key（platform_api_key/base_url/model）
// 升级成一张可扩展的 provider 表，支持：
//  - 按任务档位配多个文本模型（tier: default/strong/fast）——强模型吐 JSON/结构化，快模型走量成文。
//  - 以后接生图等其它能力（kind: image）——新增一条记录即可，不动现有文本链路。
//
// 回落安全：不删旧的 system_config key。gateway 查不到 provider 时回落到旧 key，老配置照常跑。
// 种子：把现有 system_config 的 platform_* 读出来，种一条 id=default-llm 的 llm/default provider。
export const migration_041: Migration = {
  id: '041_ai_providers',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS ai_providers (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL DEFAULT 'llm',        -- 'llm' | 'image'
        tier TEXT NOT NULL DEFAULT 'default',    -- 'default' | 'strong' | 'fast'（仅 llm 用）
        label TEXT NOT NULL DEFAULT '',
        base_url TEXT NOT NULL DEFAULT '',
        api_key TEXT NOT NULL DEFAULT '',
        model TEXT NOT NULL DEFAULT '',
        extra_json TEXT NOT NULL DEFAULT '{}',   -- 各家特有参数（生图 size/协议/异步开关等）
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_ai_providers_kind_tier ON ai_providers (kind, tier, enabled);
    `);

    // 从旧 system_config 迁移当前默认文本模型。缺任一字段也照种（空串），后台可补。
    const get = (k: string) =>
      (db.prepare('SELECT value FROM system_config WHERE key = ?').get(k) as { value: string } | undefined)?.value || '';
    const apiKey = get('platform_api_key');
    const baseUrl = get('platform_api_base_url');
    const model = get('platform_model');
    const now = new Date().toISOString();

    db.prepare(
      `INSERT OR IGNORE INTO ai_providers (id, kind, tier, label, base_url, api_key, model, extra_json, enabled, created_at, updated_at)
       VALUES (?, 'llm', 'default', ?, ?, ?, ?, '{}', 1, ?, ?)`
    ).run('default-llm', '默认文本模型', baseUrl, apiKey, model, now, now);
  },
};
