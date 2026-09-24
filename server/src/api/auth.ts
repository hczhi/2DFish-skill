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
  const token = jwt.sign(payload, getJwtSecret(), { expiresIn: '7d' });

  res.json({ token, user: payload });
});

authRouter.post('/register', (_req: Request, res: Response) => {
  // 平台对外改成「买 key 用应用」（112），不再开放注册：前端早就没有注册入口了，但接口开着的话
  // 任何人 curl 一下就能得到一个普通账号，拿去调 /api/xhs、/api/chat（每个都 200，花的是平台的钱）。
  // 账号只由管理员在后台建。
  res.status(403).json({ error: '已关闭注册：请购买对应应用的 key 使用', code: 'register_closed' });
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
