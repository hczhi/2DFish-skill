import { aiGateway } from './gateway.js';
import type { LLMTier } from '../../services/aiProviderService.js';

// ============================================================================
// 从 LLM 返回文本里抠出 JSON。全平台唯一实现，所有模块都必须用这里的函数。
//
// 为什么不能用 /\{[\s\S]*\}/ 这种贪婪正则（曾在 5 处这么写）：
//   它会从第一个 { 一路吞到最后一个 }。模型只要多吐一句解释、一个示例、
//   或者把 JSON 包在 markdown 里再补一段说明，匹配出来的片段就不是合法 JSON，
//   JSON.parse 必然抛错。而这些调用点大多把失败静默兜底成 null / { raw: text }，
//   于是表现成"评分不准 / 结果为空"，而不是报错——极难排查。
//
// 正确做法：先剥 ``` 围栏，再做括号配平（且跳过字符串内部的括号，
// 否则 {"note":"这里有个 } 符号"} 会在错误位置截断）。
// ============================================================================

/** 括号配平扫描：从 open 位置找到与之匹配的 close，返回闭合下标；找不到返回 -1。 */
function findBalanced(src: string, start: number, open: string, close: string): number {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** 剥掉 ```json ... ``` / ``` ... ``` 围栏，只留内容。 */
function stripFence(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return fenced ? fenced[1] : text;
}

/**
 * 解析 AI 返回里的第一个完整 JSON **对象**，失败返回 null。
 */
export function parseFirstJson<T = any>(text: string): T | null {
  if (!text) return null;
  const src = stripFence(text);
  const start = src.indexOf('{');
  if (start === -1) return null;
  const end = findBalanced(src, start, '{', '}');
  if (end === -1) return null;
  try {
    return JSON.parse(src.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}

/**
 * 解析 AI 返回里的第一个完整 JSON **数组**，失败返回 null。
 * （批量抽取类任务让模型直接吐数组，用这个；aiExtractService 原来用的
 * /\[[\s\S]*\]/ 有和对象版一样的贪婪问题。）
 */
export function parseFirstJsonArray<T = any>(text: string): T[] | null {
  if (!text) return null;
  const src = stripFence(text);
  const start = src.indexOf('[');
  if (start === -1) return null;
  const end = findBalanced(src, start, '[', ']');
  if (end === -1) return null;
  try {
    const v = JSON.parse(src.slice(start, end + 1));
    return Array.isArray(v) ? (v as T[]) : null;
  } catch {
    return null;
  }
}

/**
 * 对象或数组都接受：取先出现的那个。适合"不确定模型会吐哪种"的场景。
 */
export function parseFirstJsonAny<T = any>(text: string): T | null {
  if (!text) return null;
  const src = stripFence(text);
  const objAt = src.indexOf('{');
  const arrAt = src.indexOf('[');
  if (objAt === -1 && arrAt === -1) return null;
  const objFirst = arrAt === -1 || (objAt !== -1 && objAt < arrAt);
  return objFirst
    ? (parseFirstJson<T>(text) ?? (parseFirstJsonArray<any>(text) as T | null))
    : ((parseFirstJsonArray<any>(text) as T | null) ?? parseFirstJson<T>(text));
}

export interface JsonGatewayCtx {
  userId: string;
  source: string;
  operation: string;
  tier?: LLMTier;
  requestSummary?: string;
}

export interface JsonGatewayResult<T> {
  parsed: T | null;
  raw: string;
  finish?: string;
}

/**
 * 调 aiGateway 拿 JSON，解析失败自动重试（默认 2 次）。
 * 即便是强模型也会偶发崩：空返回、长 JSON 里未转义引号。重试几乎零成本，
 * 能把"用户直接看到报错"的概率再压一个量级。
 *
 * parsed 为 null 表示所有尝试都没拿到合法 JSON——调用方必须处理这个分支，
 * 不要静默当成空结果。
 *
 * @param mode 'object' | 'array' | 'any' —— 期望模型吐哪种结构
 */
export async function jsonGateway<T = any>(
  buildBody: () => any,
  ctx: JsonGatewayCtx,
  opts: { attempts?: number; mode?: 'object' | 'array' | 'any' } = {}
): Promise<JsonGatewayResult<T>> {
  const { attempts = 2, mode = 'object' } = opts;
  const pick = mode === 'array' ? parseFirstJsonArray : mode === 'any' ? parseFirstJsonAny : parseFirstJson;

  let lastRaw = '';
  let lastFinish: string | undefined;

  for (let i = 0; i < attempts; i++) {
    const { response } = await aiGateway(buildBody(), ctx);
    lastRaw = response.choices[0]?.message?.content || '';
    lastFinish = response.choices[0]?.finish_reason;

    if (lastRaw.trim()) {
      const parsed = pick(lastRaw) as T | null;
      if (parsed) return { parsed, raw: lastRaw, finish: lastFinish };
      console.error(
        `[${ctx.source}] ${ctx.operation} JSON parse fail (try ${i + 1}/${attempts}). raw=`,
        lastRaw.slice(0, 300)
      );
    } else {
      console.error(
        `[${ctx.source}] ${ctx.operation} empty content (try ${i + 1}/${attempts}). finish=${lastFinish} usage=`,
        response.usage
      );
    }
  }

  return { parsed: null, raw: lastRaw, finish: lastFinish };
}
