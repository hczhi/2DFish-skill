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
      authMethod?: 'jwt' | 'api_token';
      moduleId?: string;
      tokenId?: string;
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

  // OPTIONAL — anonymous users use admin quota for AI features
  { path: '/api/ai/board/chat', method: 'POST', level: 'optional' },
  { path: /^\/api\/ui-review\/(?!admin)/, level: 'optional' },
];

function getAuthLevel(req: Request): AuthLevel {
  for (const config of ROUTE_AUTH_CONFIG) {
    if (config.method && config.method.toUpperCase() !== req.method) continue;
    if (typeof config.path === 'string' && req.path === config.path) return config.level;
    if (config.path instanceof RegExp && config.path.test(req.path)) return config.level;
  }
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
    const payload = jwt.verify(token, getJwtSecret()) as AuthUser & { tv?: number };
    // Verify token version if present in JWT
    if (payload.tv !== undefined) {
      const db = getDatabase();
      const user = db.prepare('SELECT token_version FROM user WHERE id = ?').get(payload.id) as { token_version: number } | undefined;
      if (user && user.token_version !== payload.tv) {
        return false;
      }
    }
    req.user = { id: payload.id, username: payload.username, role: payload.role };
    req.authMethod = 'jwt';
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
