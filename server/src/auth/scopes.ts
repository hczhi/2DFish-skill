import { Request, Response, NextFunction } from 'express';
import { getDatabase } from '../db/index.js';
import { hashApiToken } from './middleware.js';

export function requireScope(scope: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.authMethod !== 'api_token') {
      next();
      return;
    }

    const token = req.headers.authorization?.slice(7);
    if (!token) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const db = getDatabase();
    const tokenHash = hashApiToken(token);
    const row = db.prepare('SELECT scopes FROM api_tokens WHERE token_hash = ?').get(tokenHash) as { scopes: string | null } | undefined;

    if (!row) {
      res.status(401).json({ error: 'Invalid token' });
      return;
    }

    if (!row.scopes) {
      next();
      return;
    }

    const scopes: string[] = JSON.parse(row.scopes);
    if (scopes.length > 0 && !scopes.includes(scope)) {
      res.status(403).json({ error: 'Token lacks required scope', required: scope, available: scopes });
      return;
    }

    next();
  };
}
