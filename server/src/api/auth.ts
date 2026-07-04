import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../db/index.js';
import { getJwtSecret } from '../auth/middleware.js';

export const authRouter = Router();

authRouter.post('/login', (req: Request, res: Response) => {
  const { username, password } = req.body;
  if (!username || !password) {
    res.status(400).json({ error: 'username and password are required' });
    return;
  }

  const db = getDatabase();
  const user = db.prepare('SELECT id, username, password_hash, role, token_version FROM user WHERE username = ?').get(username) as {
    id: string; username: string; password_hash: string; role: string; token_version: number;
  } | undefined;

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  const payload = { id: user.id, username: user.username, role: user.role || 'user', tv: user.token_version || 1 };
  const token = jwt.sign(payload, getJwtSecret(), { expiresIn: '30d' });

  res.json({ token, user: payload });
});

authRouter.post('/register', (req: Request, res: Response) => {
  const { username, password } = req.body;
  if (!username || !password) {
    res.status(400).json({ error: 'username and password are required' });
    return;
  }
  if (!username || username.length < 2 || username.length > 30 || !/^[a-zA-Z0-9_一-鿿]+$/.test(username)) {
    res.status(400).json({ error: 'Username must be 2-30 characters (letters, numbers, underscores, or Chinese characters)' });
    return;
  }
  if (!password || password.length < 6) {
    res.status(400).json({ error: 'Password must be at least 6 characters' });
    return;
  }

  const db = getDatabase();
  const existing = db.prepare('SELECT id FROM user WHERE username = ?').get(username);
  if (existing) {
    res.status(409).json({ error: 'Username already taken' });
    return;
  }

  const id = uuidv4();
  const passwordHash = bcrypt.hashSync(password, 10);
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO user (id, username, password_hash, role, created_at, updated_at)
     VALUES (?, ?, ?, 'user', ?, ?)`
  ).run(id, username, passwordHash, now, now);

  const payload = { id, username, role: 'user', tv: 1 };
  const token = jwt.sign(payload, getJwtSecret(), { expiresIn: '30d' });

  res.status(201).json({ token, user: payload });
});

authRouter.get('/me', (req: Request, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  const db = getDatabase();
  const user = db.prepare('SELECT id, username, role, model, api_base_url FROM user WHERE id = ?').get(req.user.id) as {
    id: string; username: string; role: string; model: string | null; api_base_url: string | null;
  } | undefined;

  if (!user) {
    res.status(401).json({ error: 'User not found' });
    return;
  }

  res.json({
    id: user.id,
    username: user.username,
    role: user.role || 'user',
    model: user.model,
    apiBaseUrl: user.api_base_url,
  });
});

authRouter.post('/change-password', (req: Request, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Not authenticated' }); return; }

  const { oldPassword, newPassword } = req.body;
  if (!oldPassword || !newPassword) {
    res.status(400).json({ error: 'oldPassword and newPassword are required' });
    return;
  }

  const db = getDatabase();
  const user = db.prepare('SELECT password_hash FROM user WHERE id = ?').get(req.user.id) as { password_hash: string } | undefined;
  if (!user) { res.status(404).json({ error: 'User not found' }); return; }

  if (!bcrypt.compareSync(oldPassword, user.password_hash)) {
    res.status(401).json({ error: 'Current password is incorrect' });
    return;
  }

  const hash = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE user SET password_hash = ?, token_version = COALESCE(token_version, 1) + 1, updated_at = ? WHERE id = ?')
    .run(hash, new Date().toISOString(), req.user.id);

  res.json({ success: true });
});
