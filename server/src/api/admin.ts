import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { requireAdmin } from '../auth/guards.js';
import { getDatabase } from '../db/index.js';

export const adminRouter = Router();
adminRouter.use(requireAdmin);

// --- User Management ---

adminRouter.get('/users', (_req: Request, res: Response) => {
  const db = getDatabase();
  const users = db.prepare(`
    SELECT u.id, u.username, u.role, u.created_at, u.updated_at,
      (SELECT COUNT(*) FROM ai_logs WHERE user_id = u.id) as total_ai_calls,
      q.daily_limit, q.used_today, q.last_reset_date
    FROM user u
    LEFT JOIN ai_quota q ON q.user_id = u.id
    ORDER BY u.created_at ASC
  `).all();
  res.json({ users });
});

adminRouter.post('/users', (req: Request, res: Response) => {
  const { username, password, role = 'user' } = req.body;
  if (!username || !password) {
    res.status(400).json({ error: 'username and password are required' });
    return;
  }

  const db = getDatabase();
  const existing = db.prepare('SELECT id FROM user WHERE username = ?').get(username);
  if (existing) {
    res.status(409).json({ error: 'Username already exists' });
    return;
  }

  const id = uuidv4();
  const passwordHash = bcrypt.hashSync(password, 10);
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO user (id, username, password_hash, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, username, passwordHash, role, now, now);

  res.status(201).json({ id, username, role, created_at: now });
});

adminRouter.patch('/users/:id/role', (req: Request, res: Response) => {
  const { role } = req.body;
  if (!role || !['admin', 'user'].includes(role)) {
    res.status(400).json({ error: 'role must be "admin" or "user"' });
    return;
  }

  const db = getDatabase();
  const user = db.prepare('SELECT id FROM user WHERE id = ?').get(req.params.id);
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  db.prepare('UPDATE user SET role = ?, updated_at = ? WHERE id = ?')
    .run(role, new Date().toISOString(), req.params.id);

  res.json({ success: true });
});

adminRouter.post('/users/:id/reset-password', (req: Request, res: Response) => {
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 6) {
    res.status(400).json({ error: 'newPassword must be at least 6 characters' });
    return;
  }

  const db = getDatabase();
  const user = db.prepare('SELECT id FROM user WHERE id = ?').get(req.params.id);
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  const hash = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE user SET password_hash = ?, updated_at = ? WHERE id = ?')
    .run(hash, new Date().toISOString(), req.params.id);

  res.json({ success: true });
});

// --- Quota Management ---

adminRouter.get('/quotas', (_req: Request, res: Response) => {
  const db = getDatabase();
  const quotas = db.prepare(`
    SELECT q.*, u.username
    FROM ai_quota q JOIN user u ON q.user_id = u.id
    ORDER BY u.username ASC
  `).all();
  res.json({ quotas });
});

adminRouter.patch('/quotas/:userId', (req: Request, res: Response) => {
  const { daily_limit } = req.body;
  if (typeof daily_limit !== 'number' || daily_limit < 0) {
    res.status(400).json({ error: 'daily_limit must be a non-negative number' });
    return;
  }

  const db = getDatabase();
  const today = new Date().toISOString().split('T')[0];

  const existing = db.prepare('SELECT user_id FROM ai_quota WHERE user_id = ?').get(req.params.userId);
  if (existing) {
    db.prepare('UPDATE ai_quota SET daily_limit = ? WHERE user_id = ?')
      .run(daily_limit, req.params.userId);
  } else {
    db.prepare('INSERT INTO ai_quota (user_id, daily_limit, used_today, last_reset_date) VALUES (?, ?, 0, ?)')
      .run(req.params.userId, daily_limit, today);
  }

  res.json({ success: true });
});

// --- AI Usage Dashboard ---

adminRouter.get('/ai-usage', (req: Request, res: Response) => {
  const { days = '7' } = req.query;
  const db = getDatabase();

  const since = new Date();
  since.setDate(since.getDate() - Number(days));
  const sinceStr = since.toISOString();

  const byUser = db.prepare(`
    SELECT u.username, COUNT(*) as calls, SUM(al.total_tokens) as tokens
    FROM ai_logs al JOIN user u ON al.user_id = u.id
    WHERE al.created_at >= ?
    GROUP BY al.user_id
    ORDER BY calls DESC
  `).all(sinceStr);

  const bySource = db.prepare(`
    SELECT source, COUNT(*) as calls, SUM(total_tokens) as tokens
    FROM ai_logs WHERE created_at >= ?
    GROUP BY source
  `).all(sinceStr);

  const byDay = db.prepare(`
    SELECT DATE(created_at) as day, COUNT(*) as calls, SUM(total_tokens) as tokens
    FROM ai_logs WHERE created_at >= ?
    GROUP BY DATE(created_at)
    ORDER BY day
  `).all(sinceStr);

  const total = db.prepare(`
    SELECT COUNT(*) as calls, SUM(total_tokens) as tokens,
      SUM(input_tokens) as input_tokens, SUM(output_tokens) as output_tokens
    FROM ai_logs WHERE created_at >= ?
  `).get(sinceStr);

  res.json({ byUser, bySource, byDay, total, days: Number(days) });
});

// --- System Config ---

const ALLOWED_CONFIG_KEYS = ['platform_api_key', 'platform_api_base_url', 'platform_model'];

adminRouter.get('/config', (_req: Request, res: Response) => {
  const db = getDatabase();
  const configs = db.prepare('SELECT key, value, updated_at FROM system_config').all() as { key: string; value: string; updated_at: string }[];

  const result: Record<string, { value: string; updated_at: string }> = {};
  for (const c of configs) {
    const masked = c.key.includes('key') ? c.value.slice(0, 7) + '...' + c.value.slice(-4) : c.value;
    result[c.key] = { value: masked, updated_at: c.updated_at };
  }

  res.json({ config: result, allowed_keys: ALLOWED_CONFIG_KEYS });
});

adminRouter.post('/config', (req: Request, res: Response) => {
  const { key, value } = req.body;
  if (!key || value === undefined) {
    res.status(400).json({ error: 'key and value are required' });
    return;
  }
  if (!ALLOWED_CONFIG_KEYS.includes(key)) {
    res.status(400).json({ error: `Invalid config key. Allowed: ${ALLOWED_CONFIG_KEYS.join(', ')}` });
    return;
  }

  const db = getDatabase();
  const now = new Date().toISOString();
  db.prepare('INSERT OR REPLACE INTO system_config (key, value, updated_at) VALUES (?, ?, ?)')
    .run(key, value, now);

  res.json({ success: true });
});

adminRouter.delete('/config/:key', (req: Request, res: Response) => {
  const db = getDatabase();
  db.prepare('DELETE FROM system_config WHERE key = ?').run(req.params.key);
  res.json({ success: true });
});
