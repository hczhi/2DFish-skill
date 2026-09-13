import type { Request, Response } from 'express';
import crypto from 'crypto';

// ============================================================================
// 前端 SDK 的 publishable key（pk）公共逻辑 —— tender（034）和 consult（084）两条
// SDK 共用这一份。
//
// 各写一份的后果是 Origin 归一化会漂：一边去掉尾斜杠 / 转小写、另一边没有，于是
// 后台两处显示的白名单一模一样，而同一个 Origin 在一个模块里放行、在另一个模块里
// 403 —— 接入方拿到的是「域名配了但不生效」，谁都看不出是两份实现的差别。
// ============================================================================

export function generatePk(prefix: string): string {
  return `${prefix}${crypto.randomBytes(24).toString('hex')}`;
}

export function normalizeOrigin(origin: string): string {
  return origin.trim().replace(/\/$/, '').toLowerCase();
}

/** 从请求里推断来源 Origin：优先 Origin 头，退回 Referer 的 origin 部分。 */
export function requestOrigin(req: Request): string | null {
  const origin = req.headers.origin;
  if (origin) return normalizeOrigin(origin);
  const referer = req.headers.referer;
  if (referer) {
    try {
      const u = new URL(referer);
      return normalizeOrigin(`${u.protocol}//${u.host}`);
    } catch {
      return null;
    }
  }
  return null;
}

export function safeParseArray(s: string): string[] {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.map((x) => String(x)) : [];
  } catch {
    return [];
  }
}

/** 收的是库里那一列的原文（JSON 数组字符串）。解析失败一律不放行。 */
export function originAllowed(allowedOriginsJson: string, origin: string | null): boolean {
  if (!origin) return false;
  return safeParseArray(allowedOriginsJson).map(normalizeOrigin).includes(origin);
}

/** 接受数组或换行/逗号/分号/空白分隔字符串，归一化为去重、去尾斜杠、小写的 origin 数组。
 *
 *  **空白也算分隔符**：origin 里不可能有空格，而管理员手拼时用空格分隔很自然。只按
 *  换行和逗号切的话，「三个域名」会变成一条谁都匹配不上的长字符串 —— 接口回 success、
 *  后台那一行看着是配了内容的，而这把 key 的每个域名都换不到 token。 */
export function normalizeOriginsInput(input: unknown): string[] {
  let arr: string[];
  if (Array.isArray(input)) {
    arr = input.map((x) => String(x));
  } else if (typeof input === 'string') {
    arr = input.split(/[\s,;]+/);
  } else {
    arr = [];
  }
  return Array.from(new Set(arr.map(normalizeOrigin).filter(Boolean)));
}

/** 挑出**永远匹配不上**的条目。Origin 头一定是 `scheme://host[:port]`，所以少了 scheme
 *  （`partner.com`）、带了路径（`https://partner.com/app`）的那几条存进去只会稳定 403，
 *  而后台那一行和配对了的一模一样 —— 接入方拿到的是「域名明明配了却不生效」。 */
export function invalidOrigins(origins: string[]): string[] {
  return origins.filter((o) => {
    try {
      const u = new URL(o);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return true;
      return !u.host || u.pathname !== '/' || !!u.search || !!u.hash;
    } catch {
      return true;
    }
  });
}

/** 存得进去但永远匹配不上的白名单条目要**拒**，不能存（见 {@link invalidOrigins}）。
 *  话术里带上那几条原文：不带的话「哪一条不对」得靠猜（最常见的是漏了 https://）。
 *  **一份**：consult 和 ppt 各写一遍的话，同一个错误在两个后台页上说法不一样，
 *  而管理员会以为是两个模块的规则不同。 */
export function originFormatError(bad: string[]): string {
  return (
    `这几条不是合法的域名，存进去只会稳定 403（要 https://example.com 这种形式：带 http/https、不带路径）：${bad.join('、')}。` +
    '一行一个，或者用逗号/空格分隔。'
  );
}

/**
 * 上限字段的取值（每日 AI 次数 / 项目数 / 稿子数）。**0 是合法值**（等于把这把 key 冻住），
 * 所以不能写 `Number(x) || 缺省` —— 那样管理员填 0 会被悄悄改回缺省值，他以为已经冻住了
 * 而第三方那边照样在调。不是 >= 0 的整数就返回 null（由调用方回 400），别兜成缺省值。
 */
export function limitOr(raw: unknown, fallback: number): number | null {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) return null;
  return n;
}

// ---- 每分钟换取 token 的限流（内存计数，按 pk）----
const exchangeCounts = new Map<string, { count: number; windowStart: number }>();

export function checkExchangeRateLimit(pk: string, limit: number, nowMs: number): boolean {
  const entry = exchangeCounts.get(pk);
  if (!entry || nowMs - entry.windowStart >= 60_000) {
    exchangeCounts.set(pk, { count: 1, windowStart: nowMs });
    return true;
  }
  if (entry.count >= limit) return false;
  entry.count++;
  return true;
}

/**
 * 按 pk 白名单校验过的 Origin 回写 CORS 头。
 *
 * 注意：浏览器发的**预检 OPTIONS 不带 Authorization 头**，所以不能靠 Bearer 判断
 * 是否放行 CORS，只要有 Origin 就回显。CORS 放行 ≠ 授权 —— 真正的准入在
 * pk 白名单（换 token 时）和 scope 闸门（带 token 调接口时）。
 */
export function applySdkCors(res: Response, origin: string, methods: string): void {
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', methods);
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Max-Age', '600');
}
