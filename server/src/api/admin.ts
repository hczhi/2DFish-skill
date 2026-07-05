import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { requireAdmin } from '../auth/guards.js';
import { getDatabase } from '../db/index.js';
import { generateApiToken, hashApiToken } from '../auth/middleware.js';

export const adminRouter = Router();
adminRouter.use(requireAdmin);

// --- User Management ---

adminRouter.get('/users', (req: Request, res: Response) => {
  const page = Math.max(parseInt(req.query.page as string) || 1, 1);
  const pageSize = Math.min(Math.max(parseInt(req.query.page_size as string) || 20, 1), 100);
  const offset = (page - 1) * pageSize;
  const db = getDatabase();

  const { total } = db.prepare('SELECT COUNT(*) as total FROM user').get() as { total: number };
  const users = db.prepare(`
    SELECT u.id, u.username, u.role, u.created_at, u.updated_at,
      (SELECT COUNT(*) FROM ai_logs WHERE user_id = u.id) as total_ai_calls,
      q.daily_limit, q.used_today, q.last_reset_date
    FROM user u
    LEFT JOIN ai_quota q ON q.user_id = u.id
    ORDER BY u.created_at ASC
    LIMIT ? OFFSET ?
  `).all(pageSize, offset);
  res.json({ users, total, page, page_size: pageSize });
});

adminRouter.post('/users', (req: Request, res: Response) => {
  const { username, password, role = 'user' } = req.body;
  if (!username || !password) {
    res.status(400).json({ error: 'username and password are required' });
    return;
  }
  if (role && !['admin', 'user'].includes(role)) {
    res.status(400).json({ error: 'role must be "admin" or "user"' });
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
  db.prepare('UPDATE user SET password_hash = ?, token_version = COALESCE(token_version, 1) + 1, updated_at = ? WHERE id = ?')
    .run(hash, new Date().toISOString(), req.params.id);

  res.json({ success: true });
});

// --- Quota Management ---

adminRouter.get('/quotas', (req: Request, res: Response) => {
  const page = Math.max(parseInt(req.query.page as string) || 1, 1);
  const pageSize = Math.min(Math.max(parseInt(req.query.page_size as string) || 20, 1), 100);
  const offset = (page - 1) * pageSize;
  const db = getDatabase();
  const today = new Date().toISOString().split('T')[0];

  const { total } = db.prepare('SELECT COUNT(*) as total FROM user').get() as { total: number };
  const quotas = db.prepare(`
    SELECT u.id as user_id, u.username,
      COALESCE(q.daily_limit, 10) as daily_limit,
      COALESCE(q.used_today, 0) as used_today,
      COALESCE(q.last_reset_date, ?) as last_reset_date
    FROM user u
    LEFT JOIN ai_quota q ON q.user_id = u.id
    ORDER BY u.username ASC
    LIMIT ? OFFSET ?
  `).all(today, pageSize, offset);
  res.json({ quotas, total, page, page_size: pageSize });
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
  const safeDays = Math.min(Math.max(Number(days) || 7, 1), 365);
  const db = getDatabase();

  const since = new Date();
  since.setDate(since.getDate() - safeDays);
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

  res.json({ byUser, bySource, byDay, total, days: safeDays });
});

// --- System Config ---

const ALLOWED_CONFIG_KEYS = ['platform_api_key', 'platform_api_base_url', 'platform_model', 'cos_secret_id', 'cos_secret_key', 'cos_bucket', 'cos_region'];

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

// --- Module Configs ---

adminRouter.get('/modules', (req: Request, res: Response) => {
  const page = Math.max(parseInt(req.query.page as string) || 1, 1);
  const pageSize = Math.min(Math.max(parseInt(req.query.page_size as string) || 20, 1), 100);
  const offset = (page - 1) * pageSize;
  const db = getDatabase();

  const { total } = db.prepare('SELECT COUNT(*) as total FROM module_configs').get() as { total: number };
  const modules = db.prepare('SELECT * FROM module_configs ORDER BY created_at ASC LIMIT ? OFFSET ?').all(pageSize, offset);
  res.json({ modules, total, page, page_size: pageSize });
});

adminRouter.patch('/modules/:id', (req: Request, res: Response) => {
  const db = getDatabase();
  const existing = db.prepare('SELECT id FROM module_configs WHERE id = ?').get(req.params.id);
  if (!existing) { res.status(404).json({ error: 'Module not found' }); return; }

  const fields: string[] = [];
  const values: any[] = [];
  const allowed = ['name', 'description', 'enabled'];

  for (const field of allowed) {
    if (req.body[field] !== undefined) {
      fields.push(`${field} = ?`);
      values.push(req.body[field]);
    }
  }

  if (req.body.allowed_paths !== undefined) {
    fields.push('allowed_paths = ?');
    values.push(JSON.stringify(req.body.allowed_paths));
  }

  if (fields.length === 0) { res.status(400).json({ error: 'no fields' }); return; }
  values.push(req.params.id);
  db.prepare(`UPDATE module_configs SET ${fields.join(', ')} WHERE id = ?`).run(...values);

  const updated = db.prepare('SELECT * FROM module_configs WHERE id = ?').get(req.params.id);
  res.json(updated);
});

adminRouter.post('/modules', (req: Request, res: Response) => {
  const { id, name, description, allowed_paths } = req.body;
  if (!id || !name) { res.status(400).json({ error: 'id and name required' }); return; }

  const db = getDatabase();
  const existing = db.prepare('SELECT id FROM module_configs WHERE id = ?').get(id);
  if (existing) { res.status(409).json({ error: 'Module id already exists' }); return; }

  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO module_configs (id, name, description, allowed_paths, enabled, created_at)
    VALUES (?, ?, ?, ?, 1, ?)
  `).run(id, name, description || '', JSON.stringify(allowed_paths || []), now);

  const created = db.prepare('SELECT * FROM module_configs WHERE id = ?').get(id);
  res.status(201).json(created);
});

// --- Module Tokens ---

adminRouter.get('/users/:id/tokens', (req: Request, res: Response) => {
  const db = getDatabase();
  const tokens = db.prepare(`
    SELECT t.*, mc.name as module_name
    FROM module_tokens t
    LEFT JOIN module_configs mc ON mc.id = t.module_id
    WHERE t.user_id = ?
    ORDER BY t.created_at DESC
  `).all(req.params.id);
  res.json({ tokens });
});

adminRouter.post('/users/:id/tokens', (req: Request, res: Response) => {
  const { module_id, expires_in_days } = req.body;
  if (!module_id) { res.status(400).json({ error: 'module_id is required' }); return; }

  const db = getDatabase();

  const user = db.prepare('SELECT id FROM user WHERE id = ?').get(req.params.id);
  if (!user) { res.status(404).json({ error: 'User not found' }); return; }

  const moduleConfig = db.prepare('SELECT id FROM module_configs WHERE id = ?').get(module_id);
  if (!moduleConfig) { res.status(400).json({ error: 'Invalid module_id' }); return; }

  const existing = db.prepare('SELECT id FROM module_tokens WHERE user_id = ? AND module_id = ?')
    .get(req.params.id, module_id);
  if (existing) { res.status(409).json({ error: 'User already has a token for this module. Revoke it first.' }); return; }

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
  db.prepare(`
    INSERT INTO module_tokens (id, user_id, module_id, token_hash, token_prefix, enabled, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?)
  `).run(id, req.params.id, module_id, tokenHash, tokenPrefix, expiresAt, now);

  res.status(201).json({
    id, module_id, token, token_prefix: tokenPrefix,
    expires_at: expiresAt, created_at: now,
    warning: 'Save this token now. It will not be shown again.',
  });
});

adminRouter.patch('/tokens/:id', (req: Request, res: Response) => {
  const db = getDatabase();
  const existing = db.prepare('SELECT id FROM module_tokens WHERE id = ?').get(req.params.id);
  if (!existing) { res.status(404).json({ error: 'Token not found' }); return; }

  const { enabled } = req.body;
  if (enabled === undefined) { res.status(400).json({ error: 'enabled field required' }); return; }

  db.prepare('UPDATE module_tokens SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, req.params.id);
  res.json({ success: true });
});

adminRouter.delete('/tokens/:id', (req: Request, res: Response) => {
  const db = getDatabase();
  const result = db.prepare('DELETE FROM module_tokens WHERE id = ?').run(req.params.id);
  if (result.changes === 0) { res.status(404).json({ error: 'Token not found' }); return; }
  res.json({ success: true });
});

// --- Token Access Logs ---

adminRouter.get('/users/:id/token-logs', (req: Request, res: Response) => {
  const { module_id, days = '7' } = req.query;
  const page = Math.max(parseInt(req.query.page as string) || 1, 1);
  const pageSize = Math.min(Math.max(parseInt(req.query.page_size as string) || 20, 1), 100);
  const offset = (page - 1) * pageSize;
  const safeDays = Math.min(Math.max(Number(days) || 7, 1), 365);
  const db = getDatabase();

  const since = new Date();
  since.setDate(since.getDate() - safeDays);
  const sinceStr = since.toISOString();

  let whereClause = 'WHERE l.user_id = ? AND l.created_at >= ?';
  const params: any[] = [req.params.id, sinceStr];

  if (module_id) {
    whereClause += ' AND l.module_id = ?';
    params.push(module_id);
  }

  const { total } = db.prepare(`
    SELECT COUNT(*) as total FROM token_access_logs l ${whereClause}
  `).get(...params) as { total: number };

  const logs = db.prepare(`
    SELECT l.*, mc.name as module_name
    FROM token_access_logs l
    LEFT JOIN module_configs mc ON mc.id = l.module_id
    ${whereClause}
    ORDER BY l.created_at DESC LIMIT ? OFFSET ?
  `).all(...params, pageSize, offset);

  res.json({ logs, total, page, page_size: pageSize });
});
