import OpenAI from 'openai';
import { getDatabase } from '../../db/index.js';
import { logAIUsage } from './client.js';
import { resolveLLMProvider, getProvider, usesDedicatedChannel, type LLMTier } from '../../services/aiProviderService.js';
import { decryptSecret } from '../secrets.js';
import { appName } from './apps.js';
import { normalizeBaseUrl } from './baseUrl.js';

export interface GatewayOptions {
  userId: string;
  /**
   * 哪个应用发起的调用。**同时是**「按应用配 token / 配额」的 scope key
   * （见 migrations/062、core/llm/apps.ts）—— 取值必须在 AI_APPS 白名单里，
   * 否则那个应用永远匹配不到自己的配置。有测试扫这件事。
   */
  source: string;
  operation: string;
  requestSummary?: string;
  /** 任务档位：'strong' 用于吐 JSON/结构化的硬任务，'fast' 用于走量成文，缺省走 default。 */
  tier?: LLMTier;
  /**
   * 单次请求的超时（毫秒）。缺省 {@link DEFAULT_TIMEOUT_MS}。
   *
   * 调用方有理由缩短它的场景是「等待本身有外部时限」：飞书助理必须在有限时间内
   * 回一句话，而不是让指令日志永远停在 `running`；相反，长文生成这类任务
   * 应该留够时间，短超时会把一次本来会成功的生成变成失败。
   */
  timeoutMs?: number;
  /**
   * 绑死用哪条接入点，跳过「按档位解析」（对外中转接口用，见 migration 082）。
   *
   * 存在的理由是「接入点关了就必须调不通」：按档位解析在同一档有第二条配置时会挑
   * 「最近更新的那条」，于是管理员停用第一条之后下游照样通，只是换了模型、换了付钱
   * 的那把 key，返回读起来完全正常。给了这个值就只认这一行，不可用直接抛
   * {@link PinnedProviderError}，绝不回落平台。
   */
  providerId?: string;
}

/**
 * 默认超时与重试次数。
 *
 * OpenAI SDK 自己的默认值是 **10 分钟且超时会重试**，也就是最坏情况一次
 * `create()` 能挂将近半小时。这对任何「有人在等」的调用路径都不成立：
 * 上游服务偶发挂死时，await 它的那个 promise 就永远不结束 ——
 * 飞书助理的表现是指令日志停在 `running`、群里一句回帖都没有
 * （`execute` 是个游离 promise，没有任何东西会来叫醒它）。
 *
 * 这里把两个值都收紧并写在一处：重试次数必须一起管，
 * 只设 timeout 的话最坏耗时仍然是它的 (maxRetries + 1) 倍。
 */
export const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_RETRIES = 1;

/**
 * 采样预设：把"温度/惩罚重复"按任务性质集中成几档，避免各路由各写一套、参数漂移。
 * 用法：把预设 spread 进 aiGateway/aiGatewayStream 的 params（`{ ...SAMPLING.creative, messages, max_tokens }`）。
 *
 * 原理：LLM 天生挑最高概率、最顺的词（低困惑度）——这正是 AI 味的物理来源。
 * 要"写得更像人、更有文采"，就得让它在创作型任务上敢挑不那么顺的词：
 * - 高 temperature 放宽采样，presence/frequency_penalty 压制"又滑回高频套话"的倾向。
 * 而评分/解析这类任务要的是稳定，必须低温、无惩罚。
 */
export const SAMPLING = {
  /** 炼句/发散：要最大意外度。一次生成一堆候选再筛，靠数量博灵感。 */
  brainstorm: { temperature: 1.05, presence_penalty: 0.6, frequency_penalty: 0.5 },
  /** 生成/共写正文：要有文采但不能散。 */
  creative: { temperature: 0.9, presence_penalty: 0.4, frequency_penalty: 0.3 },
  /** 改写/去味/打磨：在原文基础上提意外度，温度中高、轻惩罚。 */
  rewrite: { temperature: 0.8, presence_penalty: 0.3, frequency_penalty: 0.2 },
  /** 评分/检测/解析 JSON：要稳定可复现，低温、无惩罚。 */
  analytic: { temperature: 0.2 },
} as const;

export class QuotaExceededError extends Error {
  remaining = 0;
  dailyLimit: number;
  /** 有值 = 撞的是这个应用的单独额度，不是用户总额（migrations/062）。 */
  app?: string;
  constructor(dailyLimit: number, app?: string) {
    // 撞哪个限制必须写在文案里：两条限制的解法不同（提总额 vs 提应用额度），
    // 只说「额度用完」会让用户去改错的那个数，改完发现还是不行。
    super(
      app
        ? `「${appName(app)}」今日 AI 额度已用完（${dailyLimit}次/天）。这是该功能的单独额度，与账号总额度分开计算，请联系管理员调整。\nDaily quota for app "${app}" exceeded (${dailyLimit}/day).`
        : `今日 AI 额度已用完（${dailyLimit}次/天），请联系管理员提升额度。\nDaily AI quota exceeded (${dailyLimit}/day). Please contact admin to increase your limit.`
    );
    this.name = 'QuotaExceededError';
    this.dailyLimit = dailyLimit;
    this.app = app;
  }
}

/** 解析结果。providerId/providerOwner 用于 ai_logs 的成本归属（见 migrations/052）。 */
export interface ResolvedLLM {
  client: OpenAI;
  model: string;
  providerId: string | null;
  providerOwner: 'platform' | 'dedicated';
}

/**
 * 解析文本模型连接信息。
 *
 * 传了 userId 且该用户开了专属渠道时，resolveLLMProvider 只会给出他自己的 provider，
 * 缺档则抛 DedicatedChannelError——不会走到下面的平台回落分支。
 *
 * 平台路径（默认）不变：
 *   1. ai_providers 里该 tier 的启用 provider（取不到回落 default 档）；
 *   2. 都没有再回落旧 system_config 的 platform_* 裸 key（保证老配置照常跑）。
 *
 * `app`（= GatewayOptions.source）先试「该应用专用」再回落 owner 通用，见 migrations/062。
 */
export function resolveLLMConfig(tier: LLMTier = 'default', userId?: string, app: string = ''): ResolvedLLM {
  const provider = resolveLLMProvider(tier, userId, app);
  if (provider) {
    const client = new OpenAI({
      apiKey: provider.api_key,
      baseURL: provider.base_url || 'https://api.openai.com/v1',
    });
    return {
      client,
      model: provider.model || 'gpt-4o',
      providerId: provider.id,
      providerOwner: provider.owner_user_id ? 'dedicated' : 'platform',
    };
  }

  // 回落：旧 system_config（迁移前的裸 key，或表里一条都没启用时）
  const db = getDatabase();
  const sysKey = db.prepare("SELECT value FROM system_config WHERE key = 'platform_api_key'").get() as { value: string } | undefined;
  const sysBase = db.prepare("SELECT value FROM system_config WHERE key = 'platform_api_base_url'").get() as { value: string } | undefined;
  const sysModel = db.prepare("SELECT value FROM system_config WHERE key = 'platform_model'").get() as { value: string } | undefined;

  if (!sysKey?.value) {
    throw new Error('AI not configured. Contact admin to set the platform API key.');
  }

  const client = new OpenAI({
    // 库里是密文（migrations/050）；decryptSecret 对没有前缀的旧明文原样返回
    apiKey: decryptSecret(sysKey.value),
    // 归一化同 ai_providers：这一格也是管理员手填的，同样会粘进完整的
    // .../chat/completions（SDK 会再拼一次 → 404 «Invalid URL»）。
    baseURL: normalizeBaseUrl(sysBase?.value) || 'https://api.openai.com/v1',
  });
  return { client, model: sysModel?.value || 'gpt-4o', providerId: null, providerOwner: 'platform' };
}

/** 绑定的接入点不可用（不存在 / 已停用 / 没有可用 key / 不是文本模型）。 */
export class PinnedProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PinnedProviderError';
  }
}

/**
 * 按 id 取一条接入点当连接信息用。任何一项不满足都抛错，**不回落**任何其它配置 ——
 * 回落的后果是「接口应该已经关了，实际却在花平台（或另一条接入点）的钱」，
 * 而调用方那边一切正常。
 */
export function resolveLLMConfigForProvider(providerId: string): ResolvedLLM {
  const p = getProvider(providerId);
  if (!p || p.kind !== 'llm' || !p.enabled || !p.api_key) {
    throw new PinnedProviderError(`接入点 ${providerId} 不可用（不存在 / 已停用 / 无可用 key / 不是文本模型）`);
  }
  return {
    client: new OpenAI({ apiKey: p.api_key, baseURL: p.base_url || 'https://api.openai.com/v1' }),
    model: p.model || 'gpt-4o',
    providerId: p.id,
    providerOwner: p.owner_user_id ? 'dedicated' : 'platform',
  };
}

export function checkAndDeductQuota(userId: string): void {
  const db = getDatabase();
  const today = new Date().toISOString().split('T')[0];

  let quota = db.prepare('SELECT * FROM ai_quota WHERE user_id = ?').get(userId) as {
    user_id: string; daily_limit: number; used_today: number; last_reset_date: string;
  } | undefined;

  if (!quota) {
    db.prepare('INSERT INTO ai_quota (user_id, daily_limit, used_today, last_reset_date) VALUES (?, 10, 0, ?)')
      .run(userId, today);
    quota = { user_id: userId, daily_limit: 10, used_today: 0, last_reset_date: today };
  }

  if (quota.last_reset_date !== today) {
    db.prepare('UPDATE ai_quota SET used_today = 0, last_reset_date = ? WHERE user_id = ?')
      .run(today, userId);
    quota.used_today = 0;
  }

  if (quota.used_today >= quota.daily_limit) {
    throw new QuotaExceededError(quota.daily_limit);
  }

  db.prepare('UPDATE ai_quota SET used_today = used_today + 1 WHERE user_id = ?').run(userId);
}

/**
 * 应用级额度（migrations/062）。**额外的天花板，不替代用户总额。**
 *
 * 没有配置行 = 该应用不限（纯 opt-in，老用户零影响）。
 *
 * 三条刻意的选择：
 *
 * 1. **专属渠道用户同样受限。** 专属渠道绕过 ai_quota 是因为那是「平台默认限流」，
 *    用户烧自己的 key，平台没理由限他。但应用级额度是管理员为这个用户的
 *    这个应用**特意填的一个数**；绕过它等于该功能对「有自己 token 的用户」
 *    完全失效 —— 而那恰好是提这个需求的场景。
 *
 * 2. **先扣应用额度，再扣总额。** 反过来的话，应用额度撞墙时总额已经被扣掉一次，
 *    用户白掉一次总额度却什么都没得到。
 *
 * 3. **anon: 主体也走这里。** 它在 ai_quota 里有独立行（requester.ts），
 *    在这张表里同样按 user_id 记，不需要特殊分支。
 */
export function checkAndDeductAppQuota(userId: string, app: string): void {
  if (!app) return;
  const db = getDatabase();
  const today = new Date().toISOString().split('T')[0];

  const row = db.prepare('SELECT * FROM ai_app_quota WHERE user_id = ? AND app = ?').get(userId, app) as
    | { daily_limit: number; used_today: number; last_reset_date: string }
    | undefined;
  if (!row) return; // 没配 = 不限

  const used = row.last_reset_date === today ? row.used_today : 0;
  if (used >= row.daily_limit) {
    throw new QuotaExceededError(row.daily_limit, app);
  }

  // 日期变了就顺手归零。和 ai_quota 一样用「读时重置」而不是定时任务，
  // 服务器半夜没在跑也不会漏掉重置。
  db.prepare(
    'UPDATE ai_app_quota SET used_today = ?, last_reset_date = ? WHERE user_id = ? AND app = ?'
  ).run(used + 1, today, userId, app);
}

/** 某用户各应用的额度使用情况。null limit = 未配置 = 不限。 */
export function getAppQuotaStatus(userId: string): Array<{ app: string; used: number; limit: number; remaining: number }> {
  const db = getDatabase();
  const today = new Date().toISOString().split('T')[0];
  const rows = db.prepare('SELECT * FROM ai_app_quota WHERE user_id = ? ORDER BY app').all(userId) as Array<{
    app: string; daily_limit: number; used_today: number; last_reset_date: string;
  }>;
  return rows.map((r) => {
    const used = r.last_reset_date === today ? r.used_today : 0;
    return { app: r.app, used, limit: r.daily_limit, remaining: Math.max(0, r.daily_limit - used) };
  });
}

export function getQuotaStatus(userId: string): { used: number; limit: number; remaining: number } {
  const db = getDatabase();
  const today = new Date().toISOString().split('T')[0];

  const quota = db.prepare('SELECT * FROM ai_quota WHERE user_id = ?').get(userId) as {
    daily_limit: number; used_today: number; last_reset_date: string;
  } | undefined;

  if (!quota) return { used: 0, limit: 10, remaining: 10 };

  const used = quota.last_reset_date === today ? quota.used_today : 0;
  return { used, limit: quota.daily_limit, remaining: Math.max(0, quota.daily_limit - used) };
}

export async function aiGateway(
  params: Omit<OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming, 'model'>,
  options: GatewayOptions
): Promise<{ response: OpenAI.Chat.Completions.ChatCompletion; usage: { input_tokens: number; output_tokens: number; total_tokens: number }; duration_ms: number }> {
  // 传了 providerId 就只认那一条，不走档位解析（见 GatewayOptions.providerId）。
  // 两个入口都要认它：只在其中一个认的话，另一个入口会静默用回按档位解析出来的
  // 那条接入点 —— 花的是另一把 key，而返回完全正常。
  const { client, model, providerId, providerOwner } = options.providerId
    ? resolveLLMConfigForProvider(options.providerId)
    : resolveLLMConfig(options.tier, options.userId, options.source);

  // 应用级额度先扣：它对专属渠道也生效，且要在总额之前判，
  // 否则应用额度撞墙时总额已经白扣了一次。见 checkAndDeductAppQuota 的注释。
  checkAndDeductAppQuota(options.userId, options.source);
  // 专属渠道烧的是用户自己的 key，平台没有理由限流。
  if (providerOwner !== 'dedicated') checkAndDeductQuota(options.userId);

  const startTime = Date.now();
  const response = await client.chat.completions.create(
    { ...params, model },
    // 超时必须显式给：SDK 默认 10 分钟且会重试，见 DEFAULT_TIMEOUT_MS 的注释。
    { timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS, maxRetries: DEFAULT_MAX_RETRIES }
  );
  const duration = Date.now() - startTime;

  const inputTokens = response.usage?.prompt_tokens || 0;
  const outputTokens = response.usage?.completion_tokens || 0;

  logAIUsage(
    options.source, options.operation, model, inputTokens, outputTokens, duration,
    options.requestSummary, options.userId,
    safeStringify(params.messages),
    response.choices?.[0]?.message?.content || '',
    providerId, providerOwner
  );

  return {
    response,
    usage: { input_tokens: inputTokens, output_tokens: outputTokens, total_tokens: inputTokens + outputTokens },
    duration_ms: duration,
  };
}

export interface StreamGatewayResult {
  stream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>;
  model: string;
  /**
   * 已解析好的客户端。带工具调用的路径（chat / consultant）要自己跑多轮循环，
   * 必须用**这一个**，不要再调 resolveLLMConfig() 重新解析一次 ——
   * 无参调用拿到的是平台配置，会造成「model 是专属/应用专用的、
   * key 却是平台的」这种错配：请求可能直接 401，也可能悄悄花错人的钱。
   */
  client: OpenAI;
  /** 流式收尾：传入 token 数、耗时，以及累计拼接后的完整输出正文（供后台日志记全文）。 */
  onComplete: (inputTokens: number, outputTokens: number, durationMs: number, outputText?: string) => void;
}

export async function aiGatewayStream(
  params: Omit<OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming, 'model' | 'stream'>,
  options: GatewayOptions
): Promise<StreamGatewayResult> {
  // 传了 providerId 就只认那一条，不走档位解析（见 GatewayOptions.providerId）。
  // 两个入口都要认它：只在其中一个认的话，另一个入口会静默用回按档位解析出来的
  // 那条接入点 —— 花的是另一把 key，而返回完全正常。
  const { client, model, providerId, providerOwner } = options.providerId
    ? resolveLLMConfigForProvider(options.providerId)
    : resolveLLMConfig(options.tier, options.userId, options.source);

  // 顺序同 aiGateway：应用级额度先扣（对专属渠道也生效），再扣平台总额。
  checkAndDeductAppQuota(options.userId, options.source);
  // 专属渠道烧的是用户自己的 key，平台没有理由限流。
  if (providerOwner !== 'dedicated') checkAndDeductQuota(options.userId);

  // 流式这里的超时只约束**首字节**：SDK 的计时器在 fetch 的 promise
  // （也就是响应头到达）时就清掉了，之后读 body 不受它限制。这正是想要的 ——
  // 长文生成本身可以很久，卡死的形态是"连响应头都不来"。
  const stream = await client.chat.completions.create(
    { ...params, model, stream: true },
    { timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS, maxRetries: DEFAULT_MAX_RETRIES }
  );

  const onComplete = (inputTokens: number, outputTokens: number, durationMs: number, outputText?: string) => {
    logAIUsage(
      options.source, options.operation, model, inputTokens, outputTokens, durationMs,
      options.requestSummary, options.userId,
      safeStringify(params.messages),
      outputText || '',
      providerId, providerOwner
    );
  };

  return { stream, model, client, onComplete };
}

/** 序列化 messages 存日志；超大体量截断，避免个别超长 prompt 撑爆单行。 */
function safeStringify(v: unknown): string {
  try {
    const s = JSON.stringify(v);
    const MAX = 200_000; // ~200KB/条，够存完整上下文，又不至于失控
    return s.length > MAX ? s.slice(0, MAX) + '…[truncated]' : s;
  } catch {
    return '';
  }
}
