import { Router, Request, Response } from 'express';
import { getDatabase } from '../db/index.js';

export const settingsRouter = Router();

settingsRouter.get('/', (req: Request, res: Response) => {
  const db = getDatabase();
  const user = db.prepare('SELECT model FROM user WHERE id = ?').get(req.user!.id) as {
    model: string | null;
  } | undefined;

  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  res.json({ model: user.model || '' });
});
