// AI provider 表的读写 + 解析。gateway 和 admin API 共用这里，避免读表逻辑漂移。
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../db/index.js';

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

export function listProviders(): AIProvider[] {
  const db = getDatabase();
  return db.prepare('SELECT * FROM ai_providers ORDER BY kind, tier, created_at').all() as AIProvider[];
}

export function getProvider(id: string): AIProvider | undefined {
  const db = getDatabase();
  return db.prepare('SELECT * FROM ai_providers WHERE id = ?').get(id) as AIProvider | undefined;
}

/**
 * 解析某档文本模型：先取该 tier 的启用 provider，取不到回落到 default tier。
 * 都取不到返回 null，由调用方决定再回落到旧 system_config。
 */
export function resolveLLMProvider(tier: LLMTier = 'default'): AIProvider | null {
  const db = getDatabase();
  const pick = (t: string) =>
    db
      .prepare("SELECT * FROM ai_providers WHERE kind = 'llm' AND tier = ? AND enabled = 1 AND api_key <> '' ORDER BY updated_at DESC LIMIT 1")
      .get(t) as AIProvider | undefined;
  return pick(tier) || (tier !== 'default' ? pick('default') : undefined) || null;
}

/** 解析生图 provider（当前只按启用状态取第一条，未来可加 tier/优先级）。 */
export function resolveImageProvider(): AIProvider | null {
  const db = getDatabase();
  return (
    (db
      .prepare("SELECT * FROM ai_providers WHERE kind = 'image' AND enabled = 1 AND api_key <> '' ORDER BY updated_at DESC LIMIT 1")
      .get() as AIProvider | undefined) || null
  );
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
  ).run(merged);
  return merged;
}

export function deleteProvider(id: string): void {
  const db = getDatabase();
  db.prepare('DELETE FROM ai_providers WHERE id = ?').run(id);
}

/** 脱敏：api_key 只留头尾，给后台回显用。 */
export function maskProvider(p: AIProvider): Omit<AIProvider, 'api_key'> & { api_key: string } {
  const k = p.api_key;
  const masked = k ? (k.length > 11 ? `${k.slice(0, 7)}...${k.slice(-4)}` : '****') : '';
  return { ...p, api_key: masked };
}
