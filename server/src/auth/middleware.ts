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

  // PROTECTED — everything under these prefixes requires auth
  // (default is already protected, these are just explicit for clarity)
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

function authenticateByApiToken(token: string): AuthUser | null {
  const db = getDatabase();
  const tokenHash = hashApiToken(token);

  const row = db.prepare(`
    SELECT t.id as token_id, t.expires_at, t.revoked_at, t.user_id, u.id, u.username, u.role
    FROM api_tokens t JOIN user u ON t.user_id = u.id
    WHERE t.token_hash = ?
  `).get(tokenHash) as {
    token_id: string;
    expires_at: string | null;
    revoked_at: string | null;
    user_id: string;
    id: string;
    username: string;
    role: string;
  } | undefined;

  if (!row) return null;
  if (row.revoked_at) return null;
  if (row.expires_at && new Date(row.expires_at) < new Date()) return null;

  db.prepare('UPDATE api_tokens SET last_used_at = ? WHERE id = ?')
    .run(new Date().toISOString(), row.token_id);

  return { id: row.id, username: row.username, role: (row.role || 'user') as 'admin' | 'user' };
}

function tryParseAuth(req: Request, token: string): boolean {
  if (token.startsWith('mmPla_')) {
    const user = authenticateByApiToken(token);
    if (user) {
      req.user = user;
      req.authMethod = 'api_token';
      return true;
    }
    return false;
  }

  try {
    const payload = jwt.verify(token, getJwtSecret()) as AuthUser;
    req.user = payload;
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
