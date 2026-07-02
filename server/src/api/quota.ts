import { Router, Request, Response } from 'express';
import { getQuotaStatus } from '../core/llm/gateway.js';

export const quotaRouter = Router();

quotaRouter.get('/', (req: Request, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  const status = getQuotaStatus(req.user.id);
  res.json(status);
});
