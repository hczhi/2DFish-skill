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
  /**
   * 单次请求的重试次数。缺省 {@link DEFAULT_MAX_RETRIES}。
   *
   * **给 0 的场景是「慢但确定」**：一次要写几千 token 正文、模型还带思维链的调用
   * （consult 出草稿 / 出方向），超时不是抖动，第二次会在同一个地方再超一次 ——
   * 重试只是把等待时间翻倍（120s 的超时变成 240s 才报错），而这段时间里前端那个
   * 「AI 正在分析」的圈一直在转，用户看不出它其实已经废了一次。
   * 同 `finish_reason=length` 不重试的道理：把 timeout 调大一次跑完，比跑两遍半截的好。
   */
  maxRetries?: number;
  /**
   * 上游回「忙」（HTTP 429 / 5xx，实测那条接入点是
   * `503 system cpu overloaded (current: 97.5%, threshold: 90%)`）时**隔几秒重发一次**。
   *
   * 存在的理由是 {@link maxRetries} 给 0 的那几条路：给 0 是为了**不重试超时**
   * （同一个 body 第二次还是在同一处超时，只把等待翻倍），可这一刀连「上游那台机器
   * CPU 满了」也一起关掉了 —— 那种失败重发一次基本就过，而不重发的表现是
   * 「AI 整理没成功」，用户会去改文件、调 `max_tokens`、或者一分钟点五次
   * （每次都真扣一次额度），而问题压根不在他这边。
   *
   * **重发在扣额度之后、在同一次 `aiGateway` 里，所以额度只扣一次**（配额是在发请求
   * 之前扣的）；调用方自己 catch 之后重来一遍的话，那一遍是新的一次调用，会再扣一次。
   * 只认「上游明确回了状态码」那一种，连接超时（`APIConnectionTimeoutError`，status
   * 是 undefined）不在内。
   */
  retryOnBusy?: boolean;
  /**
   * 关掉思维链（reasoning / thinking）。**缺省不关。**
   *
   * 实测同一条专属接入点（deepseek-v4-pro）、同一个问题：不关 36.6 秒，输出的 1592
   * token 里 1495 是思维链；关掉之后 3.5 秒，而正文还长了一点（200 字 → 301 字）。
   * 也就是说这类调用的耗时几乎全部花在**没人看得到的那一段思考**上，
   * 而「上下文太长」不是原因 —— 固定输出长度时把输入从 1439 拉到 22568 token（16 倍），
   * 耗时只从 11.3 秒变到 13.2 秒。所以想让某条路径快起来，动的是这个开关，不是砍 prompt。
   *
   * 连带一件事：`max_tokens` 那笔额度这时候才真的全给正文（见硬规则 2）。
   * consult 出草稿原来老是 `finish_reason=length`，真凶就是思维链吃掉了 24000 里的两万多。
   *
   * 判据不是「这个任务要不要动脑」，而是**思维链在这条路上换回了什么**：
   * 有人在屏幕前等（consult 对话/草稿、tender 的 AI 提炼），或者输出是一份定死形状的
   * JSON 而 `max_tokens` 给得不宽（tender 的抽取/评分 —— 那边关掉它治的其实是截断，
   * 不是慢），这两类一律开。标讯整个模块都是开的。
   * 剩下真正靠长链推理、又没人等的批量任务才留着不开。
   */
  noThinking?: boolean;
}

/**
 * 关思维链的请求参数。**四个键一起发**，因为各家网关认的不是同一个
 * （实测这条接入点四个一起发和单发效果一样：3.5s / reasoning 为空，不互相顶）。
 */
const NO_THINKING_BODY: Record<string, unknown> = {
  enable_thinking: false, // DeepSeek / vLLM / SGLang 这一系
  thinking: { type: 'disabled' }, // Claude / 通义那套
  chat_template_kwargs: { enable_thinking: false }, // 自己套 chat template 的网关
  reasoning_effort: 'minimal', // OpenAI 官方唯一认的那个（也是唯一的标准字段）
};
const NO_THINKING_KEYS = Object.keys(NO_THINKING_BODY);

/**
 * 带上关思维链的参数发一次；**上游因为这几个键回 400 就摘掉重发，并且喊一句。**
 *
 * 四个键里三个不是 OpenAI 官方字段：宽松的网关直接忽略（实测这条接入点连乱造的键
 * 都照样正常返回），严格的（OpenAI 官方就是）会回 400 «Unrecognized request argument»。
 * 不摘掉重发的话，换一条接入点之后 consult 每次分析都是一句 400 —— 这个开关是为了
 * 「快」加的，不该让它变成「压根用不了」。而摘掉之后跑的就是慢那一版，所以必须喊出来：
 * 不喊的话现象只是「怎么又变回四分钟了」，日志里一切正常。
 */
async function withNoThinking<T>(
  noThinking: boolean | undefined,
  operation: string,
  run: (extra: Record<string, unknown>) => Promise<T>
): Promise<T> {
  if (!noThinking) return run({});
  try {
    return await run(NO_THINKING_BODY);
  } catch (err) {
    const msg = err instanceof OpenAI.APIError ? String(err.message || '') : '';
    if (err instanceof OpenAI.APIError && err.status === 400 && NO_THINKING_KEYS.some((k) => msg.includes(k))) {
      console.warn(
        `[llm] ${operation}: 这条接入点不认「关思维链」的参数（${msg.slice(0, 140)}），已摘掉重发一次 —— ` +
          `这一次会慢很多（思维链照旧算进 max_tokens，可能因此截断）。要治本得换一个不带思维链的模型。`
      );
      return run({});
    }
    throw err;
  }
}

/** 上游「忙」之后等多久重发（见 {@link GatewayOptions.retryOnBusy}）。 */
const BUSY_RETRY_DELAY_MS = 2_500;

/**
 * 上游明确回了「忙」（HTTP 429 / 5xx）。
 *
 * **只认带状态码的那一种。** 连接超时（`APIConnectionTimeoutError`）的 status 是
 * undefined，重发它只是把等待时间翻倍（见 {@link GatewayOptions.maxRetries}）。
 */
function isUpstreamBusy(err: unknown): boolean {
  if (!(err instanceof OpenAI.APIError)) return false;
  const s = err.status;
  return s === 429 || s === 500 || s === 502 || s === 503 || s === 504;
}

/**
 * 上游回「忙」时重发一次（`retryOnBusy` 打开时才生效），并且**喊一句**：
 * 不喊的话这条路只是偶尔慢 2.5 秒，没人知道上游正在过载 —— 而那是「今天怎么老失败」
 * 唯一的线索。重发发生在扣额度之后，所以额度只扣一次。
 */
async function withBusyRetry<T>(
  enabled: boolean | undefined,
  operation: string,
  attempt: () => Promise<T>
): Promise<T> {
  try {
    return await attempt();
  } catch (err) {
    if (!enabled || !isUpstreamBusy(err)) throw err;
    const e = err as { status?: number; message?: string };
    console.warn(
      `[llm] ${operation}: 上游回了 HTTP ${e.status}（${String(e.message || '').slice(0, 140)}），` +
        `${BUSY_RETRY_DELAY_MS / 1000} 秒后重发一次（额度不会因此多扣：配额在发请求之前就扣了）。`
    );
    await new Promise((r) => setTimeout(r, BUSY_RETRY_DELAY_MS));
    return attempt();
  }
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
export const DEFAULT_MAX_RETRIES = 1;

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
  /**
   * 这条接入点在后台勾了「不使用深度思考」（`ai_providers.no_thinking`，migration 087）。
   * 和调用方传的 {@link GatewayOptions.noThinking} 取**或** —— 只能强制关，不能强制开。
   */
  noThinking: boolean;
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
      noThinking: !!provider.no_thinking,
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
  // 旧 system_config 那条回落没有这个开关（表里压根没有这一列）。要用它就去
  // 「AI 接入点」里建一条 —— 这里凭空给 true 的话，那些没配接入点的部署会在升级之后
  // 悄悄全站不思考了。
  return { client, model: sysModel?.value || 'gpt-4o', providerId: null, providerOwner: 'platform', noThinking: false };
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
    noThinking: !!p.no_thinking,
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
): Promise<{
  response: OpenAI.Chat.Completions.ChatCompletion;
  usage: { input_tokens: number; output_tokens: number; total_tokens: number };
  duration_ms: number;
  /**
   * 这次请求**带上了**关思维链那四个键（调用方传的值和接入点那个开关取或之后的结果）。
   * 回给调用方是为了让报错话术分得出「没关」和「关了但上游没照办」—— 后者用户在后台
   * 看到的是「已关闭」，再劝他去关一次就是把他往一条走不通的路上指（见 jsonFailMessage）。
   */
  noThinking: boolean;
}> {
  // 传了 providerId 就只认那一条，不走档位解析（见 GatewayOptions.providerId）。
  // 两个入口都要认它：只在其中一个认的话，另一个入口会静默用回按档位解析出来的
  // 那条接入点 —— 花的是另一把 key，而返回完全正常。
  const { client, model, providerId, providerOwner, noThinking: providerNoThinking } = options.providerId
    ? resolveLLMConfigForProvider(options.providerId)
    : resolveLLMConfig(options.tier, options.userId, options.source);

  // 后台那个开关和调用方传的值取**或**：接入点勾了就一律不思考，但它反过来**开不回来**。
  // 能强制开的话，标讯抽取/评分、consult 出草稿那几条写死 `noThinking: true` 的路径
  // 会被一个勾选框悄悄换回慢的那一版 —— 那几处关它治的是「截断」和「等四分钟」，
  // 退回去之后现象只是「怎么又解析失败了」，而后台那一行看起来配得好好的。
  const noThinking = options.noThinking || providerNoThinking;

  // 应用级额度先扣：它对专属渠道也生效，且要在总额之前判，
  // 否则应用额度撞墙时总额已经白扣了一次。见 checkAndDeductAppQuota 的注释。
  checkAndDeductAppQuota(options.userId, options.source);
  // 专属渠道烧的是用户自己的 key，平台没有理由限流。
  if (providerOwner !== 'dedicated') checkAndDeductQuota(options.userId);

  const startTime = Date.now();
  const response = await withNoThinking<OpenAI.Chat.Completions.ChatCompletion>(
    noThinking,
    options.operation,
    (extra) =>
      // 「上游忙」的重发套在最里面：外面那层管的是「上游不认关思维链那几个键」（400），
      // 两件事的解法不同，混在一层的话 400 那次会被当成忙、白等 2.5 秒再原样失败一次。
      withBusyRetry(options.retryOnBusy, options.operation, () =>
        client.chat.completions.create(
          { ...params, ...extra, model } as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
          // 超时必须显式给：SDK 默认 10 分钟且会重试，见 DEFAULT_TIMEOUT_MS 的注释。
          {
            timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
            maxRetries: options.maxRetries ?? DEFAULT_MAX_RETRIES,
          }
        )
      )
  );
  const duration = Date.now() - startTime;

  const inputTokens = response.usage?.prompt_tokens || 0;
  const outputTokens = response.usage?.completion_tokens || 0;

  // 参数发出去了不等于生效：宽松的网关对不认识的键**既不报错也不照办**
  // （实测这条接入点连乱造的键都回 200）。那种情况下唯一的现象是「还是很慢」，
  // 日志里一切正常 —— 所以这里对着 usage 核一眼，没关掉就喊出来。
  const reasoningTokens = (response.usage as any)?.completion_tokens_details?.reasoning_tokens || 0;
  if (noThinking && reasoningTokens > 0) {
    console.warn(
      `[llm] ${options.operation}: 要求关思维链，但 ${model} 这次还是想了 ${reasoningTokens} token（共 ${outputTokens} 输出 / ${(duration / 1000).toFixed(1)} 秒）——` +
        `这条接入点或这个模型不支持关，得换模型才快得起来。`
    );
  }

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
    noThinking,
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
  const { client, model, providerId, providerOwner, noThinking: providerNoThinking } = options.providerId
    ? resolveLLMConfigForProvider(options.providerId)
    : resolveLLMConfig(options.tier, options.userId, options.source);
  // 取或，同 aiGateway。这里漏掉后台那个开关的话，勾了它之后流式路径照旧带思维链跑，
  // 而流式的现象只是「首字来得慢」—— 看起来像网络，日志里一切正常。
  const noThinking = options.noThinking || providerNoThinking;

  // 顺序同 aiGateway：应用级额度先扣（对专属渠道也生效），再扣平台总额。
  checkAndDeductAppQuota(options.userId, options.source);
  // 专属渠道烧的是用户自己的 key，平台没有理由限流。
  if (providerOwner !== 'dedicated') checkAndDeductQuota(options.userId);

  // 流式这里的超时只约束**首字节**：SDK 的计时器在 fetch 的 promise
  // （也就是响应头到达）时就清掉了，之后读 body 不受它限制。这正是想要的 ——
  // 长文生成本身可以很久，卡死的形态是"连响应头都不来"。
  // noThinking 两个入口都要认（同 providerId 那条）：只在 aiGateway 认的话，
  // 流式那条路径会静默照旧带思维链跑 —— 而流式的现象恰好是「首字来得很慢」，
  // 看起来像网络慢，没有任何一处说得出真实成因。
  const stream = await withNoThinking<
    Awaited<ReturnType<typeof client.chat.completions.create>> & AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>
  >(noThinking, options.operation, (extra) =>
    client.chat.completions.create(
      { ...params, ...extra, model, stream: true } as OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming,
      { timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS, maxRetries: DEFAULT_MAX_RETRIES }
    ) as any
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
