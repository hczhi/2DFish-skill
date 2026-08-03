import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../db/index.js';
import { getJwtSecret } from '../auth/middleware.js';

export interface TestUser {
  id: string;
  username: string;
  role: 'admin' | 'user';
  token: string;
  auth: { Authorization: string };
}

/** 建一个用户并签一个可用的登录 token（与 api/auth.ts 的签发格式保持一致）。 */
export function createUser(role: 'admin' | 'user' = 'user', username?: string): TestUser {
  const db = getDatabase();
  const id = uuidv4();
  const name = username || `${role}-${id.slice(0, 8)}`;
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO user (id, username, password_hash, role, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, name, bcrypt.hashSync('pw123456', 4), role, now, now);

  const tv = (db.prepare('SELECT token_version FROM user WHERE id = ?').get(id) as any)?.token_version ?? 1;
  const token = jwt.sign({ id, username: name, role, tv }, getJwtSecret(), { expiresIn: '1h' });

  return { id, username: name, role, token, auth: { Authorization: `Bearer ${token}` } };
}

/** 签一个 scope 受限的 SDK token（scope 存在时 middleware 会强制降级为 role=user）。 */
export function signScopedToken(userId: string, scope = 'tender:read'): string {
  return jwt.sign({ id: userId, username: 'sdk', role: 'admin', scope }, getJwtSecret(), { expiresIn: '15m' });
}
