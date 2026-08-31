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

/** 接受数组或换行/逗号分隔字符串，归一化为去重、去尾斜杠、小写的 origin 数组。 */
export function normalizeOriginsInput(input: unknown): string[] {
  let arr: string[];
  if (Array.isArray(input)) {
    arr = input.map((x) => String(x));
  } else if (typeof input === 'string') {
    arr = input.split(/[\n,]/);
  } else {
    arr = [];
  }
  return Array.from(new Set(arr.map(normalizeOrigin).filter(Boolean)));
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
