import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../db/index.js';
import { generateApiToken, hashApiToken } from '../auth/middleware.js';

export const tokensRouter = Router();

const VALID_SCOPES = ['fish:read', 'board:chat', 'chat:stream', 'consultant:stream', 'files:read', 'files:write'] as const;

tokensRouter.get('/', (req: Request, res: Response) => {
  const db = getDatabase();
  const tokens = db.prepare(`
    SELECT id, name, token_prefix, scopes, last_used_at, expires_at, revoked_at, created_at
    FROM api_tokens WHERE user_id = ? AND revoked_at IS NULL
    ORDER BY created_at DESC
  `).all(req.user!.id);

  res.json({ tokens });
});

tokensRouter.post('/', (req: Request, res: Response) => {
  const { name, expires_in_days, scopes } = req.body;
  if (!name) {
    res.status(400).json({ error: 'name is required' });
    return;
  }

  if (scopes) {
    if (!Array.isArray(scopes)) {
      res.status(400).json({ error: 'scopes must be an array' });
      return;
    }
    for (const s of scopes) {
      if (!VALID_SCOPES.includes(s)) {
        res.status(400).json({ error: `Invalid scope: ${s}. Valid scopes: ${VALID_SCOPES.join(', ')}` });
        return;
      }
    }
  }

  const token = generateApiToken();
  const tokenHash = hashApiToken(token);
  const tokenPrefix = token.slice(0, 12) + '...';
  const now = new Date().toISOString();

  let expiresAt: string | null = null;
  if (expires_in_days) {
    const d = new Date();
    d.setDate(d.getDate() + parseInt(expires_in_days, 10));
    expiresAt = d.toISOString();
  }

  const id = uuidv4();
  const db = getDatabase();
  db.prepare(`
    INSERT INTO api_tokens (id, user_id, name, token_hash, token_prefix, scopes, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, req.user!.id, name, tokenHash, tokenPrefix, scopes ? JSON.stringify(scopes) : null, expiresAt, now);

  res.json({
    id, name, token, token_prefix: tokenPrefix,
    scopes: scopes || null,
    expires_at: expiresAt, created_at: now,
    warning: 'Save this token now. It will not be shown again.',
  });
});

tokensRouter.delete('/:tokenId', (req: Request, res: Response) => {
  const db = getDatabase();
  const existing = db.prepare('SELECT id FROM api_tokens WHERE id = ? AND user_id = ?').get(req.params.tokenId, req.user!.id);

  if (!existing) {
    res.status(404).json({ error: 'Token not found' });
    return;
  }

  db.prepare('UPDATE api_tokens SET revoked_at = ? WHERE id = ?')
    .run(new Date().toISOString(), req.params.tokenId);

  res.json({ success: true });
});
