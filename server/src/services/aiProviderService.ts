// AI provider 表的读写 + 解析。gateway 和 admin API 共用这里，避免读表逻辑漂移。
//
// api_key 在库里是加密的（见 migrations/050 与 core/secrets.ts）。
// 加解密全部收在本模块内：出口一律明文、入口一律加密，
// 这样 gateway 和 admin API 都不用知道存储层加了密。
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../db/index.js';
import { encryptSecret, tryDecryptSecret, maskSecret } from '../core/secrets.js';

export type ProviderKind = 'llm' | 'image';
export type LLMTier = 'default' | 'strong' | 'fast';

export interface AIProvider {
  id: string;
  kind: ProviderKind;
  tier: string;
  label: string;
  base_url: string;
  api_key: string;
  model: string;
  extra_json: string;
  enabled: number;
  created_at: string;
  updated_at: string;
}

/**
 * 解密取出的 api_key。
 *
 * 解不开时置空而不是抛错：换了 CONFIG_ENCRYPTION_KEY 的场景下，
 * 一条坏行不该让整个后台列表页 500。空 key 会被 resolveLLMProvider
 * 当作不可用而跳过，管理员在列表里看到的是 '(无法解密)'。
 */
function decryptRow<T extends { api_key: string }>(row: T): T {
  return { ...row, api_key: tryDecryptSecret(row.api_key) ?? '' };
}

export function listProviders(): AIProvider[] {
  const db = getDatabase();
  const rows = db.prepare('SELECT * FROM ai_providers ORDER BY kind, tier, created_at').all() as AIProvider[];
  return rows.map(decryptRow);
}

export function getProvider(id: string): AIProvider | undefined {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM ai_providers WHERE id = ?').get(id) as AIProvider | undefined;
  return row && decryptRow(row);
}

/**
 * 解析某档文本模型：先取该 tier 的启用 provider，取不到回落到 default tier。
 * 都取不到返回 null，由调用方决定再回落到旧 system_config。
 */
export function resolveLLMProvider(tier: LLMTier = 'default'): AIProvider | null {
  const db = getDatabase();
  const pick = (t: string) => {
    const row = db
      .prepare("SELECT * FROM ai_providers WHERE kind = 'llm' AND tier = ? AND enabled = 1 AND api_key <> '' ORDER BY updated_at DESC LIMIT 1")
      .get(t) as AIProvider | undefined;
    // SQL 里的 api_key <> '' 只能筛掉「没填」；解密失败的行要在这里再筛一次，
    // 否则会拿着空 key 去调 OpenAI，报出来的是 401 而不是真正的原因。
    const d = row && decryptRow(row);
    return d && d.api_key ? d : undefined;
  };
  return pick(tier) || (tier !== 'default' ? pick('default') : undefined) || null;
}

/** 解析生图 provider（当前只按启用状态取第一条，未来可加 tier/优先级）。 */
export function resolveImageProvider(): AIProvider | null {
  const db = getDatabase();
  const row = db
    .prepare("SELECT * FROM ai_providers WHERE kind = 'image' AND enabled = 1 AND api_key <> '' ORDER BY updated_at DESC LIMIT 1")
    .get() as AIProvider | undefined;
  const d = row && decryptRow(row);
  return d && d.api_key ? d : null;
}

export function upsertProvider(data: Partial<AIProvider> & { id?: string }): AIProvider {
  const db = getDatabase();
  const now = new Date().toISOString();
  const existing = data.id ? getProvider(data.id) : undefined;
  const id = data.id || uuidv4();
  const merged: AIProvider = {
    id,
    kind: (data.kind as ProviderKind) ?? existing?.kind ?? 'llm',
    tier: data.tier ?? existing?.tier ?? 'default',
    label: data.label ?? existing?.label ?? '',
    base_url: data.base_url ?? existing?.base_url ?? '',
    // 空字符串 api_key 表示「不改动」（前端脱敏回显，不该把脱敏串写回去）
    api_key: data.api_key !== undefined && data.api_key !== '' ? data.api_key : existing?.api_key ?? '',
    model: data.model ?? existing?.model ?? '',
    extra_json: data.extra_json ?? existing?.extra_json ?? '{}',
    enabled: data.enabled !== undefined ? (data.enabled ? 1 : 0) : existing?.enabled ?? 1,
    created_at: existing?.created_at ?? now,
    updated_at: now,
  };
  db.prepare(
    `INSERT OR REPLACE INTO ai_providers (id, kind, tier, label, base_url, api_key, model, extra_json, enabled, created_at, updated_at)
     VALUES (@id, @kind, @tier, @label, @base_url, @api_key, @model, @extra_json, @enabled, @created_at, @updated_at)`
    // merged.api_key 此刻是明文（existing 来自已解密的 getProvider），落库前加密
  ).run({ ...merged, api_key: encryptSecret(merged.api_key) });
  // 返回明文那份：调用方（admin API）拿去 maskProvider 脱敏回显
  return merged;
}

export function deleteProvider(id: string): void {
  const db = getDatabase();
  db.prepare('DELETE FROM ai_providers WHERE id = ?').run(id);
}

/** 脱敏：api_key 只留头尾，给后台回显用。 */
export function maskProvider(p: AIProvider): Omit<AIProvider, 'api_key'> & { api_key: string } {
  return { ...p, api_key: maskSecret(p.api_key) };
}
