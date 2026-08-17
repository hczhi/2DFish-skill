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
 * 从**可能被截断**的数组文本里，逐个抠出已经闭合的顶层对象（拿不到就空数组）。
 *
 * parseFirstJsonArray 要求整个数组配平：模型被 max_tokens 断在半个对象上时它返回
 * null，于是前面已经完整写好的那几条也一起丢掉 —— 表现成「提取到 0 条」+ ✅ 已完成。
 * 这个函数只在那一种情况下当兜底（救回 N-1 条，剩下的由调用方拆开重试），
 * **不要**拿它替换 parseFirstJsonArray：正常路径下静默接受半截数组，等于把
 * 「模型胡说」也当成结果。
 */
export function parseJsonArrayItems<T = any>(text: string): T[] {
  if (!text) return [];
  const src = stripFence(text);
  const start = src.indexOf('[');
  if (start === -1) return [];
  const out: T[] = [];
  let i = start + 1;
  while (i < src.length) {
    const objAt = src.indexOf('{', i);
    if (objAt === -1) break;
    const end = findBalanced(src, objAt, '{', '}');
    if (end === -1) break; // 最后一个对象没写完 —— 到此为止
    try {
      out.push(JSON.parse(src.slice(objAt, end + 1)) as T);
    } catch {
      break;
    }
    i = end + 1;
  }
  return out;
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
  /**
   * 这次调用花在思维链上的 token（`usage.completion_tokens_details.reasoning_tokens`）。
   * 带思维链的模型把它算进 completion_tokens、也算进 max_tokens，但**不放在
   * message.content 里** —— 所以「max_tokens=4000 却断在第一条」看起来毫无道理，
   * 用户只会一路调高 max_tokens。截断的报错必须带上这个数，它才指向真正的解法
   * （换模型 / 关思维链）。
   */
  reasoningTokens?: number;
  /** 最后一次尝试的 token 用量（前端「记」面板这类地方要显示）。 */
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
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
  let lastReasoning: number | undefined;
  let lastUsage: JsonGatewayResult<T>['usage'];

  for (let i = 0; i < attempts; i++) {
    const { response } = await aiGateway(buildBody(), ctx);
    lastRaw = response.choices[0]?.message?.content || '';
    lastFinish = response.choices[0]?.finish_reason;
    lastReasoning = (response.usage as any)?.completion_tokens_details?.reasoning_tokens;
    lastUsage = response.usage
      ? {
          prompt_tokens: response.usage.prompt_tokens,
          completion_tokens: response.usage.completion_tokens,
          total_tokens: response.usage.total_tokens,
        }
      : undefined;

    if (lastRaw.trim()) {
      const parsed = pick(lastRaw) as T | null;
      if (parsed) return { parsed, raw: lastRaw, finish: lastFinish, reasoningTokens: lastReasoning, usage: lastUsage };
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

    // 截断不重试：同样的请求、同样的 max_tokens，第二次会断在同一个地方，
    // 重发只是把 token 和配额花两遍（标讯提取一批 3 条曾因此单批耗时 85 秒；
    // 智慧看板的匿名访客一天只有 3 次，白花一次就是三分之一天）。
    // 要么调用方把这批拆小，要么拿这段半截的 raw 去救已经写完的那几条 ——
    // 两件事都得先拿到 finish=length 才能做。content 为空时同理：
    // 那正是思维链吃光了额度，重发只会再吃一次。
    if (lastFinish === 'length') break;
  }

  return { parsed: null, raw: lastRaw, finish: lastFinish, reasoningTokens: lastReasoning, usage: lastUsage };
}
