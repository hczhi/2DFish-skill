// AI provider 表的读写 + 解析。gateway 和 admin API 共用这里，避免读表逻辑漂移。
//
// api_key 在库里是加密的（见 migrations/050 与 core/secrets.ts）。
// 加解密全部收在本模块内：出口一律明文、入口一律加密，
// 这样 gateway 和 admin API 都不用知道存储层加了密。
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../db/index.js';
import { encryptSecret, tryDecryptSecret, maskSecret } from '../core/secrets.js';
import { normalizeBaseUrl } from '../core/llm/baseUrl.js';

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
  /**
   * '' = 该 owner 的通用配置；有值 = 只在这个应用（GatewayOptions.source）里生效。
   * 见 migrations/062 与 core/llm/apps.ts。
   */
  scope_app: string;
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
 * 出库归一化：解密 api_key + 修正 base_url。
 *
 * api_key 解不开时置空而不是抛错：换了 CONFIG_ENCRYPTION_KEY 的场景下，
 * 一条坏行不该让整个后台列表页 500。空 key 会被 resolveLLMProvider
 * 当作不可用而跳过，管理员在列表里看到的是 '(无法解密)'。
 *
 * base_url 在**读**的时候也归一化（不只在写的时候）：库里已经存着一批
 * 带 /chat/completions 后缀的行（迁移 065 修历史数据，但直接改库、
 * 或从别处导入的行还会再出现），而那个后缀的表现是 404 «Invalid URL»，
 * 看不出跟地址有关。放在这里 = 所有取 provider 的路径（gateway 调用、
 * 连通性测试、后台列表）都自动拿到可用地址。
 */
function decryptRow<T extends { api_key: string; base_url?: string }>(row: T): T {
  return {
    ...row,
    api_key: tryDecryptSecret(row.api_key) ?? '',
    ...(row.base_url !== undefined ? { base_url: normalizeBaseUrl(row.base_url) } : {}),
  };
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
          .prepare('SELECT * FROM ai_providers WHERE owner_user_id = ? ORDER BY scope_app, kind, tier, created_at')
          .all(ownerUserId)
      : db.prepare('SELECT * FROM ai_providers WHERE owner_user_id IS NULL ORDER BY scope_app, kind, tier, created_at').all()
  ) as AIProvider[];
  // scope_app 排在最前：通用配置（''）永远置顶，下面才是按应用覆盖的，
  // 和后台面板「通用 + 各应用覆盖」的分组顺序一致。
  return rows.map(decryptRow);
}

export function getProvider(id: string): AIProvider | undefined {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM ai_providers WHERE id = ?').get(id) as AIProvider | undefined;
  return row && decryptRow(row);
}

/**
 * 取一条可用 provider。owner 为 null 查平台级，有值查该用户专属。
 * app 为 '' 查该 owner 的通用配置，有值查只属于该应用的配置（migrations/062）。
 *
 * SQL 里的 `api_key <> ''` 只能筛掉「没填」；解密失败的行要在这里再筛一次，
 * 否则会拿着空 key 去调 OpenAI，报出来的是 401 而不是真正的原因。
 */
function pickProvider(
  kind: ProviderKind,
  tier: string | null,
  owner: string | null,
  app: string = ''
): AIProvider | undefined {
  const db = getDatabase();
  const ownerSql = owner ? 'owner_user_id = ?' : 'owner_user_id IS NULL';
  const tierSql = tier ? 'AND tier = ?' : '';
  // scope_app 必须**精确**匹配，不能省略这个条件：
  // 少了它，给 xhs 单独配的 key 会被 tender 的调用捡走。
  // COALESCE 兜 052 之前手工插入过 NULL 的行（062 的 DEFAULT '' 只管新行）。
  const params = [kind, ...(tier ? [tier] : []), ...(owner ? [owner] : []), app];
  const row = db
    .prepare(
      `SELECT * FROM ai_providers
       WHERE kind = ? ${tierSql} AND ${ownerSql}
         AND COALESCE(scope_app, '') = ?
         AND enabled = 1 AND api_key <> ''
       ORDER BY updated_at DESC LIMIT 1`
    )
    .get(...params) as AIProvider | undefined;
  const d = row && decryptRow(row);
  return d && d.api_key ? d : undefined;
}

/**
 * 在一个 owner 范围内按「应用优先、通用兜底」解析文本模型。
 *
 * 顺序：app+tier → app+default → 通用+tier → 通用+default。
 *
 * 为什么 app 内部允许回落到通用配置（而 052 禁止跨 owner 回落）：
 * 这四条候选属于**同一个 owner**，付钱的人不变，变的只是用哪把自己的 key。
 * 052 禁止的是「用户以为花自己的钱、实际烧平台 key」这种付款方掉包。
 * 不过回落这件事仍然必须在**配置时**说出来 —— 见 appChannelStatus()，
 * 后台会逐个应用列出「未配 → 将回落到通用哪一档」。
 */
function pickLLMForApp(
  tier: LLMTier,
  owner: string | null,
  app: string
): AIProvider | undefined {
  if (app) {
    const hit = pickProvider('llm', tier, owner, app) || (tier !== 'default' ? pickProvider('llm', 'default', owner, app) : undefined);
    if (hit) return hit;
  }
  return pickProvider('llm', tier, owner, '') || (tier !== 'default' ? pickProvider('llm', 'default', owner, '') : undefined);
}

/**
 * 解析某档文本模型。
 *
 * 两条互不相通的路径：
 *   - 用户开了专属渠道 → 只查他自己的 provider，缺档直接抛 DedicatedChannelError，
 *     绝不回落到平台。这是「所有模型都用专属配置」的字面执行。
 *   - 否则 → 原有平台链：该 tier 的启用项 → default 档 → null（由调用方回落旧 system_config）。
 *
 * `app`（= GatewayOptions.source）在**两条路径上都**先试「该应用专用」再回落通用，
 * 所以平台侧也能做「xhs 走便宜模型、tender 走贵模型」，不必开专属渠道。
 *
 * 不传 userId / app 时行为与升级前完全一致。
 */
export function resolveLLMProvider(tier: LLMTier = 'default', userId?: string, app: string = ''): AIProvider | null {
  if (usesDedicatedChannel(userId)) {
    const own = pickLLMForApp(tier, userId!, app);
    if (own) return own;
    throw new DedicatedChannelError(
      `专属 AI 渠道缺少 ${tier} 档文本模型配置。请在后台「用户管理 → 专属 AI 渠道」补齐 ${REQUIRED_LLM_TIERS.join(' / ')} 三档，或关闭该用户的专属渠道开关。`
    );
  }
  return pickLLMForApp(tier, null, app) || null;
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
    // 入库就截掉粘贴进来的 /chat/completions 后缀和前后空格：留着它上游会回
    // 404 «Invalid URL»，而那个报错读起来像 key 或模型名的问题。见 core/llm/baseUrl.ts。
    base_url: normalizeBaseUrl(data.base_url ?? existing?.base_url ?? ''),
    // 空字符串 api_key 表示「不改动」（前端脱敏回显，不该把脱敏串写回去）
    api_key: data.api_key !== undefined && data.api_key !== '' ? data.api_key : existing?.api_key ?? '',
    model: data.model ?? existing?.model ?? '',
    extra_json: data.extra_json ?? existing?.extra_json ?? '{}',
    enabled: data.enabled !== undefined ? (data.enabled ? 1 : 0) : existing?.enabled ?? 1,
    // 空串归一成 null：平台级必须是 NULL 才能被 `owner_user_id IS NULL` 查到。
    // `??` 的连带后果：已有 owner 的配置**改不回平台级**（传 null 会落回 existing）。
    // 保持这个方向 —— 把某用户的 key 降成平台配置 = 全站所有人开始烧他那把 key，
    // 正是 052 要禁的「付钱的人被掉包」。要转归属请删掉重建。scope_app 没有这个顾虑
    // （付钱的人不变），所以下面那行传 '' 是能真的改回通用的。
    owner_user_id: (data.owner_user_id ?? existing?.owner_user_id) || null,
    // scope_app 反过来：归一成 ''，不能是 null —— 解析里用 `= ?` 精确匹配 ''，
    // NULL 会让这一行既匹配不上通用也匹配不上任何应用，等于凭空消失。
    scope_app: (data.scope_app ?? existing?.scope_app) || '',
    created_at: existing?.created_at ?? now,
    updated_at: now,
  };
  db.prepare(
    `INSERT OR REPLACE INTO ai_providers (id, kind, tier, label, base_url, api_key, model, extra_json, enabled, owner_user_id, scope_app, created_at, updated_at)
     VALUES (@id, @kind, @tier, @label, @base_url, @api_key, @model, @extra_json, @enabled, @owner_user_id, @scope_app, @created_at, @updated_at)`
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
  // 完备性只看**通用**配置（scope_app = ''）：那是所有应用的兜底，
  // 缺一档就有应用会撞上 DedicatedChannelError。
  // 按应用的覆盖行不算数 —— 只给 xhs 配了 strong，不代表 tender 的 strong 有着落。
  const usable = own.filter((p) => p.enabled && p.api_key && !p.scope_app);
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

/** 某个应用在某 owner 下每档实际会用到哪条配置。 */
export interface AppTierResolution {
  tier: LLMTier;
  /** 命中的 provider（可能是应用专用，也可能是通用兜底）；null = 两处都没配。 */
  providerId: string | null;
  label: string;
  model: string;
  /** true = 这一档没有应用专用配置，实际走的是该 owner 的通用配置。 */
  fallbackToShared: boolean;
}

/**
 * 逐档算出某应用实际会用哪条 provider。
 *
 * 存在的唯一理由：**把回落说出来。**
 * 「给 xhs 配了 fast，忘了配 strong，于是 strong 静默走通用（可能是很贵的模型）」
 * 是这个功能最容易踩的坑，而运行时完全看不出来 —— 请求成功、结果正常，
 * 只有月底账单不对。后台面板逐档显示「应用专用 / 回落通用」就能在配置时看见。
 *
 * 注意这里不能直接调 resolveLLMProvider：它在专属渠道缺档时会抛，
 * 而这个函数的职责就是**报告**缺档，不能自己先炸。
 */
export function appChannelStatus(ownerUserId: string | null, app: string): AppTierResolution[] {
  return REQUIRED_LLM_TIERS.map((tier) => {
    // 这里的「应用侧命中」必须和 pickLLMForApp 的前两步逐字一致
    // （app+tier，然后 app+default），否则报告出来的路径和实际跑的路径会分叉，
    // 那比不报告更糟 —— 界面写着「应用专用」，实际烧的是通用那把 key。
    const appHit = app
      ? pickProvider('llm', tier, ownerUserId, app) ||
        (tier !== 'default' ? pickProvider('llm', 'default', ownerUserId, app) : undefined)
      : undefined;
    const hit = appHit || pickLLMForApp(tier, ownerUserId, app);
    return {
      tier,
      providerId: hit?.id ?? null,
      label: hit?.label ?? '',
      model: hit?.model ?? '',
      fallbackToShared: !appHit && !!hit,
    };
  });
}

/** 脱敏：api_key 只留头尾，给后台回显用。 */
export function maskProvider(p: AIProvider): Omit<AIProvider, 'api_key'> & { api_key: string } {
  return { ...p, api_key: maskSecret(p.api_key) };
}
