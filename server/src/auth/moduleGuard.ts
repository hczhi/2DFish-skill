import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../db/index.js';

export function moduleGuard(req: Request, res: Response, next: NextFunction): void {
  if (req.authMethod !== 'api_token' || !req.moduleId) {
    next();
    return;
  }

  const db = getDatabase();
  const moduleConfig = db.prepare('SELECT allowed_paths, enabled FROM module_configs WHERE id = ?')
    .get(req.moduleId) as { allowed_paths: string; enabled: number } | undefined;

  if (!moduleConfig || !moduleConfig.enabled) {
    res.status(403).json({ error: 'Module is disabled', module: req.moduleId });
    return;
  }

  const allowedPaths: string[] = JSON.parse(moduleConfig.allowed_paths || '[]');
  const requestPath = req.path;

  const isAllowed = allowedPaths.some(entry => {
    // 可选的 method 前缀："GET /api/x" 只放行 GET；不写 method 则沿用原来的任意 method 行为。
    let pattern = entry;
    const sep = entry.indexOf(' ');
    if (sep > 0) {
      const method = entry.slice(0, sep).toUpperCase();
      if (method !== req.method.toUpperCase()) return false;
      pattern = entry.slice(sep + 1).trim();
    }
    if (pattern.endsWith('*')) {
      return requestPath.startsWith(pattern.slice(0, -1));
    }
    return requestPath === pattern || requestPath.startsWith(pattern + '/');
  });

  if (!isAllowed) {
    logAccess(req, 403);
    res.status(403).json({
      error: 'This API path is not enabled for this module',
      module: req.moduleId,
      path: requestPath,
    });
    return;
  }

  // Log access and continue
  res.on('finish', () => {
    logAccess(req, res.statusCode);
  });

  next();
}

function logAccess(req: Request, statusCode: number): void {
  if (!req.tokenId || !req.user) return;

  const db = getDatabase();
  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
    || req.socket.remoteAddress || '';

  db.prepare(`
    INSERT INTO token_access_logs (id, token_id, user_id, module_id, method, path, status_code, ip, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    uuidv4(),
    req.tokenId,
    req.user.id,
    req.moduleId || '',
    req.method,
    req.path,
    statusCode,
    ip,
    new Date().toISOString()
  );
}
