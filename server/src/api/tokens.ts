import { Router, Request, Response } from 'express';
import { getDatabase } from '../db/index.js';

export const tokensRouter = Router();

// Users can only view their own module tokens (read-only)
tokensRouter.get('/', (req: Request, res: Response) => {
  const db = getDatabase();
  const tokens = db.prepare(`
    SELECT t.id, t.module_id, t.token_prefix, t.enabled, t.expires_at, t.created_at, t.last_used_at,
           mc.name as module_name
    FROM module_tokens t
    LEFT JOIN module_configs mc ON mc.id = t.module_id
    WHERE t.user_id = ?
    ORDER BY t.created_at DESC
  `).all(req.user!.id);

  res.json({ tokens });
});
