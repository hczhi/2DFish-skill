import OpenAI from 'openai';
import { getDatabase } from '../../db/index.js';
import { v4 as uuidv4 } from 'uuid';

export interface LLMConfig {
  apiKey: string;
  baseURL: string;
  model: string;
}

let cachedClient: OpenAI | null = null;
let cachedHash = '';

export function getLLMConfig(): LLMConfig {
  const db = getDatabase();
  const user = db.prepare('SELECT api_key, api_base_url, model FROM user LIMIT 1').get() as {
    api_key: string | null;
    api_base_url: string | null;
    model: string | null;
  } | undefined;

  if (!user || !user.api_key) {
    throw new Error('AI not configured. Please set API Key in settings.');
  }

  return {
    apiKey: user.api_key,
    baseURL: user.api_base_url || 'https://api.openai.com/v1',
    model: user.model || 'gpt-4o',
  };
}

export function getLLMClient(): OpenAI {
  const config = getLLMConfig();
  const hash = `${config.apiKey}:${config.baseURL}`;

  if (cachedClient && cachedHash === hash) return cachedClient;

  cachedClient = new OpenAI({ apiKey: config.apiKey, baseURL: config.baseURL });
  cachedHash = hash;
  return cachedClient;
}

export function getModel(): string {
  return getLLMConfig().model;
}

export function logAIUsage(
  source: string,
  operation: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
  durationMs?: number,
  requestSummary?: string,
  userId?: string
): void {
  try {
    const db = getDatabase();
    db.prepare(
      `INSERT INTO ai_logs (id, source, operation, model, input_tokens, output_tokens, total_tokens, duration_ms, request_summary, user_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      uuidv4(), source, operation, model,
      inputTokens, outputTokens, inputTokens + outputTokens,
      durationMs || null, requestSummary || null,
      userId || null,
      new Date().toISOString()
    );
  } catch { /* non-critical */ }
}
