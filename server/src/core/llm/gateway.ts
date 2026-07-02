import OpenAI from 'openai';
import { getDatabase } from '../../db/index.js';
import { logAIUsage } from './client.js';

export interface GatewayOptions {
  userId: string;
  source: string;
  operation: string;
  requestSummary?: string;
}

export class QuotaExceededError extends Error {
  remaining = 0;
  dailyLimit: number;
  constructor(dailyLimit: number) {
    super('quota_exceeded');
    this.dailyLimit = dailyLimit;
  }
}

export function resolveLLMConfig(userId: string): { client: OpenAI; model: string; bypassQuota: boolean } {
  const db = getDatabase();

  const user = db.prepare('SELECT api_key, api_base_url, model FROM user WHERE id = ?').get(userId) as {
    api_key: string | null; api_base_url: string | null; model: string | null;
  } | undefined;

  if (user?.api_key) {
    const client = new OpenAI({
      apiKey: user.api_key,
      baseURL: user.api_base_url || 'https://api.openai.com/v1',
    });
    return { client, model: user.model || 'gpt-4o', bypassQuota: true };
  }

  const sysKey = db.prepare("SELECT value FROM system_config WHERE key = 'platform_api_key'").get() as { value: string } | undefined;
  const sysBase = db.prepare("SELECT value FROM system_config WHERE key = 'platform_api_base_url'").get() as { value: string } | undefined;
  const sysModel = db.prepare("SELECT value FROM system_config WHERE key = 'platform_model'").get() as { value: string } | undefined;

  if (!sysKey?.value) {
    throw new Error('AI not configured. No user key or platform key available. Please set API Key in Settings or contact admin.');
  }

  const client = new OpenAI({
    apiKey: sysKey.value,
    baseURL: sysBase?.value || 'https://api.openai.com/v1',
  });
  return { client, model: sysModel?.value || 'gpt-4o', bypassQuota: false };
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
  const { client, model, bypassQuota } = resolveLLMConfig(options.userId);

  if (!bypassQuota) {
    checkAndDeductQuota(options.userId);
  }

  const startTime = Date.now();
  const response = await client.chat.completions.create({ ...params, model });
  const duration = Date.now() - startTime;

  const inputTokens = response.usage?.prompt_tokens || 0;
  const outputTokens = response.usage?.completion_tokens || 0;

  logAIUsage(options.source, options.operation, model, inputTokens, outputTokens, duration, options.requestSummary, options.userId);

  return {
    response,
    usage: { input_tokens: inputTokens, output_tokens: outputTokens, total_tokens: inputTokens + outputTokens },
    duration_ms: duration,
  };
}

export interface StreamGatewayResult {
  stream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>;
  model: string;
  onComplete: (inputTokens: number, outputTokens: number, durationMs: number) => void;
}

export async function aiGatewayStream(
  params: Omit<OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming, 'model' | 'stream'>,
  options: GatewayOptions
): Promise<StreamGatewayResult> {
  const { client, model, bypassQuota } = resolveLLMConfig(options.userId);

  if (!bypassQuota) {
    checkAndDeductQuota(options.userId);
  }

  const stream = await client.chat.completions.create({ ...params, model, stream: true });

  const onComplete = (inputTokens: number, outputTokens: number, durationMs: number) => {
    logAIUsage(options.source, options.operation, model, inputTokens, outputTokens, durationMs, options.requestSummary, options.userId);
  };

  return { stream, model, onComplete };
}
