import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { getDatabase } from '../db/index.js';

export interface AuthUser {
  id: string;
  username: string;
  role: 'admin' | 'user';
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      authMethod?: 'jwt' | 'api_token' | 'sdk';
      moduleId?: string;
      tokenId?: string;
      tokenScope?: string;
      /** scope 短 token 是拿哪把 pk 换来的（consult SDK 用它做归属键）。 */
      sdkPk?: string;
      /** 第三方那边的终端用户 id。**由第三方页面传入、签进 token**，只做展示隔离。 */
      externalUid?: string;
    }
  }
}

export type AuthLevel = 'public' | 'optional' | 'protected';

interface RouteAuthConfig {
  path: string | RegExp;
  method?: string;
  level: AuthLevel;
}

const ROUTE_AUTH_CONFIG: RouteAuthConfig[] = [
  // PUBLIC — no auth needed at all
  { path: '/api/auth/login', level: 'public' },
  { path: '/api/auth/register', level: 'public' },
  { path: '/api/health', level: 'public' },
  { path: '/api/home/modules', method: 'GET', level: 'public' },
  { path: '/api/home/feeds', method: 'GET', level: 'public' },
  { path: /^\/api\/seo\/(page|sitemap|robots\.txt|sitemap\.xml)/, level: 'public' },
  { path: /^\/api\/discover\/articles/, method: 'GET', level: 'public' },
  { path: /^\/api\/discover\/topics(?!\/admin)/, method: 'GET', level: 'public' },
  { path: '/api/analytics/pageview', method: 'POST', level: 'public' },
  { path: /^\/api\/ad-slots(?!\/admin)/, method: 'GET', level: 'public' },
  // SDK token exchange — pk + Origin whitelist validated inside the handler
  { path: '/api/tender/sdk/token', method: 'POST', level: 'public' },
  { path: '/api/tender/sdk/token', method: 'OPTIONS', level: 'public' },
  // 品牌咨询 iframe 嵌入（084）：同上，pk + Origin 白名单在 consultSdk 的 handler 里校验。
  { path: '/api/consult/sdk/token', method: 'POST', level: 'public' },
  { path: '/api/consult/sdk/token', method: 'OPTIONS', level: 'public' },
  // 对外中转接口（migration 082）：带的是 sk-mmpla- 那把 key，不是平台 JWT。
  // 走 protected 的话 authMiddleware 会先回一句 401 «Invalid or expired token»，
  // 下游只会以为自己那把 key 废了，而真正的校验（relayService）压根没跑到。
  { path: /^\/api\/v1\//, level: 'public' },

  // OPTIONAL — 匿名可访问。匿名主体由 auth/requester.ts 按 IP+UA 指纹派生独立 id
  // 并单独限额（不再借用 admin 身份和额度）。
  { path: '/api/ai/board/chat', method: 'POST', level: 'optional' },
  { path: /^\/api\/ui-review\/(?!admin)/, level: 'optional' },
];

function getAuthLevel(req: Request): AuthLevel {
  for (const config of ROUTE_AUTH_CONFIG) {
    if (config.method && config.method.toUpperCase() !== req.method) continue;
    if (typeof config.path === 'string' && req.path === config.path) return config.level;
    if (config.path instanceof RegExp && config.path.test(req.path)) return config.level;
  }
  // 不是 /api/ 的路径就是前端本身（client/dist 里的静态文件 + SPA fallback，见 app.ts 末尾）。
  // 这些**必须**匿名可取：浏览器的文档请求从不带 Authorization 头，判成 protected 的话
  // 整站在 Express 上是一句 `{"error":"Authentication required"}`（RELEASE.md 的方案 A
  // 就是全部转发给 Node），而 iframe 嵌入死得更隐蔽 —— 第一个文档请求就 401，第三方页面上
  // 是一块白，而 pk / 域名白名单 / frame-ancestors 全都是配好的、每个接口都 200。
  // 页面级的权限本来就在前端路由守卫（`meta.requiresAuth`）+ 各 API 端点上，不在这里。
  if (!req.path.startsWith('/api/')) return 'optional';
  return 'protected';
}

export function getJwtSecret(): string {
  return process.env.JWT_SECRET || 'mmPla-dev-secret-change-in-production';
}

export function hashApiToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function generateApiToken(): string {
  return `mmPla_${crypto.randomBytes(32).toString('hex')}`;
}

function authenticateByModuleToken(token: string, req: Request): AuthUser | null {
  const db = getDatabase();
  const tokenHash = hashApiToken(token);

  const row = db.prepare(`
    SELECT t.id as token_id, t.module_id, t.enabled, t.expires_at, t.user_id,
           u.id, u.username, u.role
    FROM module_tokens t JOIN user u ON t.user_id = u.id
    WHERE t.token_hash = ?
  `).get(tokenHash) as {
    token_id: string;
    module_id: string;
    enabled: number;
    expires_at: string | null;
    user_id: string;
    id: string;
    username: string;
    role: string;
  } | undefined;

  if (!row) return null;
  if (!row.enabled) return null;
  if (row.expires_at && new Date(row.expires_at) < new Date()) return null;

  db.prepare('UPDATE module_tokens SET last_used_at = ? WHERE id = ?')
    .run(new Date().toISOString(), row.token_id);

  req.moduleId = row.module_id;
  req.tokenId = row.token_id;

  return { id: row.id, username: row.username, role: (row.role || 'user') as 'admin' | 'user' };
}

function tryParseAuth(req: Request, token: string): boolean {
  if (token.startsWith('mmPla_')) {
    const user = authenticateByModuleToken(token, req);
    if (user) {
      req.user = user;
      req.authMethod = 'api_token';
      return true;
    }
    return false;
  }

  try {
    const payload = jwt.verify(token, getJwtSecret()) as AuthUser & {
      tv?: number; scope?: string; pk?: string; euid?: string;
    };
    // Verify token version if present in JWT
    if (payload.tv !== undefined) {
      const db = getDatabase();
      const user = db.prepare('SELECT token_version FROM user WHERE id = ?').get(payload.id) as { token_version: number } | undefined;
      if (user && user.token_version !== payload.tv) {
        return false;
      }
    }
    req.user = { id: payload.id, username: payload.username, role: payload.role };
    // Scoped SDK tokens (e.g. tender:read) — never treated as full login sessions.
    // Force role to 'user' so a scoped token can never reach admin-gated handlers.
    if (payload.scope) {
      req.user.role = 'user';
      req.tokenScope = payload.scope;
      req.authMethod = 'sdk';
      // 归属键只从**签过名的** token 里取，不从请求参数取：收请求参数的话第三方页面
      // 改一个 query 就能读到同一把 key 下别人的项目，而返回的是一列正常的项目。
      req.sdkPk = payload.pk;
      req.externalUid = payload.euid;
    } else {
      req.authMethod = 'jwt';
    }
    return true;
  } catch {
    return false;
  }
}

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const level = getAuthLevel(req);

  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (level === 'public') {
    if (token) tryParseAuth(req, token);
    next();
    return;
  }

  if (!token) {
    if (level === 'optional') {
      next();
      return;
    }
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const success = tryParseAuth(req, token);

  if (!success && level === 'protected') {
    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }

  next();
}
