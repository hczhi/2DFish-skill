import crypto from 'crypto';
import type { Request } from 'express';
import { getDatabase } from '../db/index.js';
import { getJwtSecret } from './middleware.js';

// ============================================================================
// 请求主体解析（登录用户 or 匿名访客）。
//
// 为什么需要它：`optional` 级端点（ui-review、board/chat）允许匿名调用，
// 但 AI 调用必须归属到某个 user_id 上（配额、日志、数据归属都靠它）。
// 旧实现是把匿名请求一律挂到"第一个 admin"的 id 上，造成两个真问题：
//   1. 越权读：所有匿名记录 user_id 相同，`row.user_id !== userId` 形同虚设，
//      匿名 A 能读匿名 B 的评测结果（URL、截图、AI 分析）。
//   2. 配额共享 + 免费 DoS：匿名调用扣 admin 的额度，一人刷满全站失效，
//      且烧的是平台自己的 API key。
//
// 现在按访客指纹派生稳定的 `anon:<hash>`：
//   - 同一访客多次请求落到同一 id → 他只能读到自己的记录
//   - 不同访客互相隔离 → 修掉越权
//   - 每个 anon id 独立配额（额度更低）→ 修掉共享 DoS
//
// 指纹取 IP + UA 的 HMAC（用 JWT_SECRET 加盐，避免存明文 IP）。
// 这不是强身份：换 IP 就是新访客。它的目标是"隔离 + 限流"，不是防刷到底。
// 真要防刷需要验证码/设备指纹，属于后续运营需求。
// ============================================================================

/** 匿名用户每日 AI 额度。远低于登录用户(10)，让"注册"有实际收益。 */
export const ANON_DAILY_LIMIT = 3;

export const ANON_PREFIX = 'anon:';

export function isAnonymousId(userId: string): boolean {
  return userId.startsWith(ANON_PREFIX);
}

/** 取客户端真实 IP。依赖 app.set('trust proxy')，否则反代后全是同一个内网 IP。 */
function clientIp(req: Request): string {
  return req.ip || req.socket.remoteAddress || 'unknown';
}

/**
 * 为匿名访客派生稳定 id。同 IP + 同 UA → 同 id。
 * 用 HMAC 而非明文拼接：DB 里不留可直接读出的 IP。
 */
export function anonymousId(req: Request): string {
  const ua = String(req.headers['user-agent'] || '');
  const fingerprint = `${clientIp(req)}|${ua}`;
  const hash = crypto.createHmac('sha256', getJwtSecret()).update(fingerprint).digest('hex').slice(0, 24);
  return `${ANON_PREFIX}${hash}`;
}

/**
 * 解析这次请求该归属到哪个 user_id：登录用户用真实 id，匿名用派生 id。
 * 所有 optional 级端点都必须用它，不要再回落到 admin。
 */
export function resolveRequesterId(req: Request): string {
  if (req.user?.id) return req.user.id;
  return anonymousId(req);
}

/**
 * 确保匿名主体在 ai_quota 里有一行且额度是 ANON_DAILY_LIMIT。
 * gateway 的 checkAndDeductQuota 遇到没有记录的 user 会按默认 10 建行，
 * 匿名不该拿到和登录用户一样的额度，所以在调 AI 之前先把行建好。
 */
export function ensureAnonymousQuota(userId: string): void {
  if (!isAnonymousId(userId)) return;
  const db = getDatabase();
  const today = new Date().toISOString().split('T')[0];
  db.prepare(
    `INSERT INTO ai_quota (user_id, daily_limit, used_today, last_reset_date)
     VALUES (?, ?, 0, ?)
     ON CONFLICT(user_id) DO NOTHING`
  ).run(userId, ANON_DAILY_LIMIT, today);
}

/**
 * 匿名主体的配额行会随访客增长而无限累积，需要定期清理。
 * 只删「今天没用过」的匿名行——留着今天的行，否则删完立刻重建等于绕过限额。
 */
export function cleanupAnonymousQuota(): number {
  const db = getDatabase();
  const today = new Date().toISOString().split('T')[0];
  const r = db.prepare(
    `DELETE FROM ai_quota WHERE user_id LIKE ? AND last_reset_date < ?`
  ).run(`${ANON_PREFIX}%`, today);
  return r.changes;
}
