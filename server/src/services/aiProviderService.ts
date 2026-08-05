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
  /** NULL/空 = 平台级；有值 = 该用户的专属接入点（见 migrations/052）。 */
  owner_user_id: string | null;
  created_at: string;
  updated_at: string;
}

/** 专属渠道必须配齐的文本档位。少一档就报错，不回落平台——见 052 迁移里的说明。 */
export const REQUIRED_LLM_TIERS: LLMTier[] = ['default', 'strong', 'fast'];

/**
 * 该用户是否已开启专属渠道。
 *
 * 匿名主体（requester.ts 派生的 `anon:<hash>`）永远返回 false：那不是 user 表里的行，
 * 查不到也不该拥有专属配置。
 */
export function usesDedicatedChannel(userId: string | undefined): boolean {
  if (!userId || userId.startsWith('anon:')) return false;
  const db = getDatabase();
  const row = db.prepare('SELECT use_dedicated_ai FROM user WHERE id = ?').get(userId) as
    | { use_dedicated_ai: number | null }
    | undefined;
  return !!row?.use_dedicated_ai;
}

/** 专属渠道缺档时抛这个，让上层能区分「没配置」和「调用失败」。 */
export class DedicatedChannelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DedicatedChannelError';
  }
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

/**
 * 列出 provider。
 * - 不传 owner：只列平台级（owner_user_id IS NULL），后台系统配置页用。
 * - 传 owner：只列该用户的专属，后台用户管理里的专属渠道面板用。
 * 两者刻意分开，避免系统配置页混进一堆用户私有配置。
 */
export function listProviders(ownerUserId?: string): AIProvider[] {
  const db = getDatabase();
  const rows = (
    ownerUserId
      ? db
          .prepare('SELECT * FROM ai_providers WHERE owner_user_id = ? ORDER BY kind, tier, created_at')
          .all(ownerUserId)
      : db.prepare('SELECT * FROM ai_providers WHERE owner_user_id IS NULL ORDER BY kind, tier, created_at').all()
  ) as AIProvider[];
  return rows.map(decryptRow);
}

export function getProvider(id: string): AIProvider | undefined {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM ai_providers WHERE id = ?').get(id) as AIProvider | undefined;
  return row && decryptRow(row);
}

/**
 * 取一条可用 provider。owner 为 null 查平台级，有值查该用户专属。
 *
 * SQL 里的 `api_key <> ''` 只能筛掉「没填」；解密失败的行要在这里再筛一次，
 * 否则会拿着空 key 去调 OpenAI，报出来的是 401 而不是真正的原因。
 */
function pickProvider(kind: ProviderKind, tier: string | null, owner: string | null): AIProvider | undefined {
  const db = getDatabase();
  const ownerSql = owner ? 'owner_user_id = ?' : 'owner_user_id IS NULL';
  const tierSql = tier ? 'AND tier = ?' : '';
  const params = [kind, ...(tier ? [tier] : []), ...(owner ? [owner] : [])];
  const row = db
    .prepare(
      `SELECT * FROM ai_providers
       WHERE kind = ? ${tierSql} AND ${ownerSql} AND enabled = 1 AND api_key <> ''
       ORDER BY updated_at DESC LIMIT 1`
    )
    .get(...params) as AIProvider | undefined;
  const d = row && decryptRow(row);
  return d && d.api_key ? d : undefined;
}

/**
 * 解析某档文本模型。
 *
 * 两条互不相通的路径：
 *   - 用户开了专属渠道 → 只查他自己的 provider，缺档直接抛 DedicatedChannelError，
 *     绝不回落到平台。这是「所有模型都用专属配置」的字面执行。
 *   - 否则 → 原有平台链：该 tier 的启用项 → default 档 → null（由调用方回落旧 system_config）。
 *
 * 不传 userId 时行为与升级前完全一致。
 */
export function resolveLLMProvider(tier: LLMTier = 'default', userId?: string): AIProvider | null {
  if (usesDedicatedChannel(userId)) {
    const own = pickProvider('llm', tier, userId!);
    if (own) return own;
    throw new DedicatedChannelError(
      `专属 AI 渠道缺少 ${tier} 档文本模型配置。请在后台「用户管理 → 专属 AI 渠道」补齐 ${REQUIRED_LLM_TIERS.join(' / ')} 三档，或关闭该用户的专属渠道开关。`
    );
  }
  return pickProvider('llm', tier, null) || (tier !== 'default' ? pickProvider('llm', 'default', null) : undefined) || null;
}

/**
 * 解析生图 provider（同一 kind 只取最近更新的启用项，未来可加 tier/优先级）。
 * 专属渠道语义与文本一致：开了就只用自己的，没配就报错。
 */
export function resolveImageProvider(userId?: string): AIProvider | null {
  if (usesDedicatedChannel(userId)) {
    const own = pickProvider('image', null, userId!);
    if (own) return own;
    throw new DedicatedChannelError(
      '专属 AI 渠道未配置生图模型。请在后台「用户管理 → 专属 AI 渠道」新增一条 kind=image 的记录，或关闭该用户的专属渠道开关。'
    );
  }
  return pickProvider('image', null, null) || null;
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
    // 空串归一成 null：平台级必须是 NULL 才能被 `owner_user_id IS NULL` 查到
    owner_user_id: (data.owner_user_id ?? existing?.owner_user_id) || null,
    created_at: existing?.created_at ?? now,
    updated_at: now,
  };
  db.prepare(
    `INSERT OR REPLACE INTO ai_providers (id, kind, tier, label, base_url, api_key, model, extra_json, enabled, owner_user_id, created_at, updated_at)
     VALUES (@id, @kind, @tier, @label, @base_url, @api_key, @model, @extra_json, @enabled, @owner_user_id, @created_at, @updated_at)`
    // merged.api_key 此刻是明文（existing 来自已解密的 getProvider），落库前加密
  ).run({ ...merged, api_key: encryptSecret(merged.api_key) });
  // 返回明文那份：调用方（admin API）拿去 maskProvider 脱敏回显
  return merged;
}

export function deleteProvider(id: string): void {
  const db = getDatabase();
  db.prepare('DELETE FROM ai_providers WHERE id = ?').run(id);
}

/**
 * 某用户专属渠道的完备性。后台面板用它提示还缺什么，
 * 让「缺档」在配置时就暴露，而不是等用户点功能时才报错。
 */
export function dedicatedChannelStatus(userId: string): {
  enabled: boolean;
  missingTiers: LLMTier[];
  hasImage: boolean;
  ready: boolean;
} {
  const own = listProviders(userId);
  const usable = own.filter((p) => p.enabled && p.api_key);
  const missingTiers = REQUIRED_LLM_TIERS.filter(
    (t) => !usable.some((p) => p.kind === 'llm' && p.tier === t)
  );
  return {
    enabled: usesDedicatedChannel(userId),
    missingTiers,
    hasImage: usable.some((p) => p.kind === 'image'),
    // 生图不计入 ready：生图适配器还没实现（core/image/imageGateway.ts），
    // 缺它不影响任何现有功能，不该拦住开关。
    ready: missingTiers.length === 0,
  };
}

/** 脱敏：api_key 只留头尾，给后台回显用。 */
export function maskProvider(p: AIProvider): Omit<AIProvider, 'api_key'> & { api_key: string } {
  return { ...p, api_key: maskSecret(p.api_key) };
}
