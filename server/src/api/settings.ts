import { Router, Request, Response } from 'express';
import { getDatabase } from '../db/index.js';

export const settingsRouter = Router();

settingsRouter.get('/', (req: Request, res: Response) => {
  const db = getDatabase();
  const user = db.prepare('SELECT api_key, api_base_url, model FROM user WHERE id = ?').get(req.user!.id) as {
    api_key: string | null; api_base_url: string | null; model: string | null;
  } | undefined;

  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  const settings: Record<string, string> = {};
  if (user.api_key) {
    settings.apiKey = user.api_key.slice(0, 7) + '...' + user.api_key.slice(-4);
  }
  if (user.api_base_url) settings.baseURL = user.api_base_url;
  if (user.model) settings.model = user.model;

  res.json(settings);
});

settingsRouter.post('/', (req: Request, res: Response) => {
  const { apiKey, baseURL, model } = req.body;

  const db = getDatabase();
  const sets: string[] = ['updated_at = ?'];
  const values: unknown[] = [new Date().toISOString()];

  if (apiKey && !apiKey.includes('...')) {
    sets.push('api_key = ?');
    values.push(apiKey);
  }
  if (baseURL !== undefined) {
    sets.push('api_base_url = ?');
    values.push(baseURL || null);
  }
  if (model !== undefined) {
    sets.push('model = ?');
    values.push(model || null);
  }

  values.push(req.user!.id);
  db.prepare(`UPDATE user SET ${sets.join(', ')} WHERE id = ?`).run(...values);

  res.json({ success: true });
});
