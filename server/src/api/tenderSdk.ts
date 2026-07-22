import { Router, Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { getDatabase } from '../db/index.js';
import { getJwtSecret } from '../auth/middleware.js';

// ============================================================================
// Tender SDK — 让第三方纯前端项目嵌入"标讯智能推荐"。
//
// 安全模型（纯前端下能达到的合理上限）：
//   pk (publishable key)  公开，写在第三方页面 JS 里，不怕被看到
//     └─ 绑定固定 user_id（推荐归属，后端写死，前端改不了）
//     └─ 绑定 allowed_origins 域名白名单
//   POST /sdk/token        校验 pk + Origin 白名单 → 签发 15 分钟短 token
//     └─ 短 token scope=tender:read，只能读推荐，碰不到写/别的用户/admin
//
// 防线是"pk 绑定 userId + Origin 白名单 + scope 收窄"，不是藏 pk。
// 别人抄走 pk，在自己的域名下也换不到 token（Origin 对不上）。
// ============================================================================

const SDK_SCOPE = 'tender:read';
const TOKEN_TTL_SECONDS = 15 * 60; // 15 分钟

// scope=tender:read 短 token 允许访问的只读端点（相对 /api/tender）。
// 用正则匹配 req.path（Express 里是去掉挂载前缀后的路径）。
const SDK_ALLOWED_PATHS: RegExp[] = [
  /^\/recommendations$/,
  /^\/detail\/[^/]+$/,
  /^\/list$/,
];

export const PK_PREFIX = 'pk_live_';

export function generatePk(): string {
  return `${PK_PREFIX}${crypto.randomBytes(24).toString('hex')}`;
}

interface SdkKeyRow {
  pk: string;
  user_id: string;
  name: string;
  allowed_origins: string;
  enabled: number;
  rate_limit: number;
}

function normalizeOrigin(origin: string): string {
  return origin.trim().replace(/\/$/, '').toLowerCase();
}

// 从请求里推断来源 Origin：优先 Origin 头，退回 Referer 的 origin 部分。
function requestOrigin(req: Request): string | null {
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

function originAllowed(row: SdkKeyRow, origin: string | null): boolean {
  if (!origin) return false;
  let list: string[];
  try {
    list = JSON.parse(row.allowed_origins);
  } catch {
    return false;
  }
  if (!Array.isArray(list)) return false;
  return list.map(normalizeOrigin).includes(origin);
}

// ---- 每分钟换取 token 的限流（内存计数，按 pk）----
const exchangeCounts = new Map<string, { count: number; windowStart: number }>();

function checkExchangeRateLimit(pk: string, limit: number, nowMs: number): boolean {
  const entry = exchangeCounts.get(pk);
  if (!entry || nowMs - entry.windowStart >= 60_000) {
    exchangeCounts.set(pk, { count: 1, windowStart: nowMs });
    return true;
  }
  if (entry.count >= limit) return false;
  entry.count++;
  return true;
}

// ---- CORS：仅对 SDK 相关请求，且 Origin 命中白名单时才放行 ----
// 全局 cors() 白名单不含第三方域名，所以这里按 pk 白名单动态回 CORS 头。
function applySdkCors(req: Request, res: Response, allowedOrigin: string): void {
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Max-Age', '600');
}

/**
 * 挂在 tenderRouter 最前面：
 *  1. 对带 scope=tender:read 的短 token 做端点白名单闸门（越权直接 403）。
 *  2. 为 SDK 请求回写按 pk 白名单校验过的 CORS 头。
 */
export function tenderSdkGuard(req: Request, res: Response, next: NextFunction): void {
  // /sdk/token 自身在 handler 里处理 CORS，这里跳过。
  if (req.path === '/sdk/token') return next();

  // 仅约束 scope 短 token；正常登录用户 / admin 不受影响。
  if (req.tokenScope !== SDK_SCOPE) return next();

  // scope 短 token 只能读白名单端点。
  const allowed = SDK_ALLOWED_PATHS.some((re) => re.test(req.path));
  if (!allowed) {
    res.status(403).json({ error: 'This token is limited to read-only tender recommendations' });
    return;
  }

  // 回写 CORS：短 token 携带的用户来自某个 pk，但 token 本身不带 pk，
  // 只能凭请求 Origin 判断——若 Origin 存在就回显（token 已通过签名校验，
  // 且 scope 受限只读，回显 Origin 不会扩大攻击面）。
  const origin = req.headers.origin;
  if (origin) applySdkCors(req, res, origin);

  next();
}

export function registerSdkRoutes(router: Router): void {
  // 预检
  router.options('/sdk/token', (req, res) => {
    const origin = req.headers.origin;
    if (origin) {
      applySdkCors(req, res, origin);
    }
    res.status(204).end();
  });

  // 换取短 token
  router.post('/sdk/token', (req, res) => {
    const pk = (req.body?.pk as string) || (req.query.pk as string) || '';
    if (!pk || !pk.startsWith(PK_PREFIX)) {
      return res.status(400).json({ error: 'Missing or invalid pk' });
    }

    const db = getDatabase();
    const row = db.prepare('SELECT * FROM sdk_keys WHERE pk = ?').get(pk) as SdkKeyRow | undefined;

    if (!row || !row.enabled) {
      return res.status(401).json({ error: 'Invalid or disabled key' });
    }

    const origin = requestOrigin(req);
    if (!originAllowed(row, origin)) {
      return res.status(403).json({ error: 'Origin not allowed for this key' });
    }

    // 限流（按 pk，每分钟 rate_limit 次）
    const nowMs = Date.now();
    if (!checkExchangeRateLimit(pk, row.rate_limit || 60, nowMs)) {
      return res.status(429).json({ error: 'Too many token requests, slow down' });
    }

    // 查绑定用户的 username（签进 token，便于日志/复用现有 req.user 结构）
    const user = db.prepare('SELECT id, username FROM user WHERE id = ?').get(row.user_id) as
      | { id: string; username: string }
      | undefined;
    if (!user) {
      return res.status(500).json({ error: 'Key is bound to a missing user' });
    }

    const token = jwt.sign(
      { id: user.id, username: user.username, role: 'user', scope: SDK_SCOPE },
      getJwtSecret(),
      { expiresIn: TOKEN_TTL_SECONDS }
    );

    db.prepare('UPDATE sdk_keys SET last_used_at = ? WHERE pk = ?')
      .run(new Date(nowMs).toISOString(), pk);

    // 回写 CORS（origin 此处已通过白名单校验）
    if (req.headers.origin) applySdkCors(req, res, req.headers.origin);

    res.json({ token, token_type: 'Bearer', expires_in: TOKEN_TTL_SECONDS });
  });
}

// ==================== Admin: SDK key 管理 ====================

export function registerSdkAdminRoutes(router: Router): void {
  router.get('/admin/sdk-keys', (req, res) => {
    if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT k.pk, k.user_id, k.name, k.allowed_origins, k.enabled, k.rate_limit,
             k.created_at, k.last_used_at, u.username
      FROM sdk_keys k LEFT JOIN user u ON k.user_id = u.id
      ORDER BY k.created_at DESC
    `).all() as any[];
    res.json(rows.map((r) => ({
      ...r,
      allowed_origins: safeParseArray(r.allowed_origins),
      enabled: !!r.enabled,
    })));
  });

  router.post('/admin/sdk-keys', (req, res) => {
    if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
    const { userId, name, allowedOrigins, rateLimit } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId is required' });

    const db = getDatabase();
    const user = db.prepare('SELECT id FROM user WHERE id = ?').get(userId);
    if (!user) return res.status(400).json({ error: 'user not found' });

    const origins = normalizeOriginsInput(allowedOrigins);
    const pk = generatePk();
    db.prepare(`
      INSERT INTO sdk_keys (pk, user_id, name, allowed_origins, enabled, rate_limit, created_at)
      VALUES (?, ?, ?, ?, 1, ?, ?)
    `).run(pk, userId, name || '', JSON.stringify(origins), Number(rateLimit) || 60, new Date().toISOString());

    res.json({ pk, user_id: userId, name: name || '', allowed_origins: origins, enabled: true });
  });

  router.patch('/admin/sdk-keys/:pk', (req, res) => {
    if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
    const db = getDatabase();
    const existing = db.prepare('SELECT pk FROM sdk_keys WHERE pk = ?').get(req.params.pk);
    if (!existing) return res.status(404).json({ error: 'Not found' });

    const { name, allowedOrigins, enabled, rateLimit } = req.body;
    if (name !== undefined) db.prepare('UPDATE sdk_keys SET name = ? WHERE pk = ?').run(name, req.params.pk);
    if (allowedOrigins !== undefined) {
      db.prepare('UPDATE sdk_keys SET allowed_origins = ? WHERE pk = ?')
        .run(JSON.stringify(normalizeOriginsInput(allowedOrigins)), req.params.pk);
    }
    if (enabled !== undefined) db.prepare('UPDATE sdk_keys SET enabled = ? WHERE pk = ?').run(enabled ? 1 : 0, req.params.pk);
    if (rateLimit !== undefined) db.prepare('UPDATE sdk_keys SET rate_limit = ? WHERE pk = ?').run(Number(rateLimit) || 60, req.params.pk);

    res.json({ success: true });
  });

  router.delete('/admin/sdk-keys/:pk', (req, res) => {
    if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
    const db = getDatabase();
    db.prepare('DELETE FROM sdk_keys WHERE pk = ?').run(req.params.pk);
    res.json({ success: true });
  });
}

function safeParseArray(s: string): string[] {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

// 接受数组或换行/逗号分隔字符串，归一化为去重、去尾斜杠、小写的 origin 数组。
function normalizeOriginsInput(input: unknown): string[] {
  let arr: string[];
  if (Array.isArray(input)) {
    arr = input.map((x) => String(x));
  } else if (typeof input === 'string') {
    arr = input.split(/[\n,]/);
  } else {
    arr = [];
  }
  const out = arr.map(normalizeOrigin).filter(Boolean);
  return Array.from(new Set(out));
}
