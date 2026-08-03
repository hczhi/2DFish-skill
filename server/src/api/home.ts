import { Router, Request, Response } from 'express';
import { getDatabase } from '../db/index.js';
import { v4 as uuidv4 } from 'uuid';
import { requireAdmin } from '../auth/guards.js';
import { parsePagination, patchRow } from '../core/http.js';

export const homeRouter = Router();

// /admin/* 统一鉴权闸门：必须挂在任何 /admin 路由注册之前。
// 以前每个 handler 首行手写 `if (req.user?.role !== 'admin')`，漏写一行就是越权
// 漏洞、且没有任何测试会发现；收成一道中间件后新增路由自动受保护。
homeRouter.use('/admin', requireAdmin);

// ===== PUBLIC: 前端获取首页数据 =====

homeRouter.get('/modules', (_req: Request, res: Response) => {
  const db = getDatabase();
  const modules = db.prepare(
    'SELECT * FROM home_modules WHERE visible = 1 ORDER BY sort_order ASC, created_at ASC'
  ).all();
  res.json(modules);
});

homeRouter.get('/feeds', (_req: Request, res: Response) => {
  const db = getDatabase();
  const feeds = db.prepare(
    'SELECT * FROM home_feeds WHERE visible = 1 ORDER BY sort_order ASC, created_at DESC'
  ).all();
  res.json(feeds);
});

// ===== ADMIN: 管理首页内容 =====

// --- Modules CRUD ---

homeRouter.get('/admin/modules', (req: Request, res: Response) => {
  const { page, pageSize, offset } = parsePagination(req);
  const db = getDatabase();

  const { total } = db.prepare('SELECT COUNT(*) as total FROM home_modules').get() as { total: number };
  const modules = db.prepare('SELECT * FROM home_modules ORDER BY sort_order ASC, created_at ASC LIMIT ? OFFSET ?').all(pageSize, offset);
  res.json({ items: modules, total, page, page_size: pageSize });
});

homeRouter.post('/admin/modules', (req: Request, res: Response) => {

  const { title, description, icon, path, category, featured, require_auth, image_url, bg_color, sort_order, visible, grid_span } = req.body;
  if (!title) { res.status(400).json({ error: 'title is required' }); return; }

  const db = getDatabase();
  const now = new Date().toISOString();
  const id = uuidv4();

  db.prepare(`
    INSERT INTO home_modules (id, title, description, icon, path, category, featured, require_auth, image_url, bg_color, sort_order, visible, grid_span, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    title,
    description || '',
    icon || '',
    path || '',
    category || '',
    featured ? 1 : 0,
    require_auth ? 1 : 0,
    image_url || '',
    bg_color || '',
    sort_order ?? 0,
    visible !== false ? 1 : 0,
    grid_span || '1x1',
    now,
    now
  );

  const module = db.prepare('SELECT * FROM home_modules WHERE id = ?').get(id);
  res.status(201).json(module);
});

homeRouter.patch('/admin/modules/:id', (req: Request, res: Response) => {

  const db = getDatabase();
  const existing = db.prepare('SELECT * FROM home_modules WHERE id = ?').get(req.params.id);
  if (!existing) { res.status(404).json({ error: 'not found' }); return; }

  const changed = patchRow(db, 'home_modules', {
    columns: ['title', 'description', 'icon', 'path', 'category', 'featured', 'require_auth', 'image_url', 'bg_color', 'sort_order', 'visible', 'grid_span'],
    booleans: ['featured', 'require_auth', 'visible'],
  }, req.body, { id: req.params.id });

  if (changed === 0) { res.status(400).json({ error: 'no fields to update' }); return; }

  const updated = db.prepare('SELECT * FROM home_modules WHERE id = ?').get(req.params.id);
  res.json(updated);
});

homeRouter.delete('/admin/modules/:id', (req: Request, res: Response) => {
  const db = getDatabase();
  const result = db.prepare('DELETE FROM home_modules WHERE id = ?').run(req.params.id);
  if (result.changes === 0) { res.status(404).json({ error: 'not found' }); return; }
  res.json({ success: true });
});

// Batch sort order update
homeRouter.put('/admin/modules/sort', (req: Request, res: Response) => {
  const { items } = req.body as { items: Array<{ id: string; sort_order: number }> };
  if (!Array.isArray(items)) { res.status(400).json({ error: 'items array required' }); return; }

  const db = getDatabase();
  const stmt = db.prepare('UPDATE home_modules SET sort_order = ?, updated_at = ? WHERE id = ?');
  const now = new Date().toISOString();
  const batchUpdate = db.transaction(() => {
    for (const item of items) {
      stmt.run(item.sort_order, now, item.id);
    }
  });
  batchUpdate();
  res.json({ success: true });
});

// --- Feeds CRUD ---

homeRouter.get('/admin/feeds', (req: Request, res: Response) => {
  const { page, pageSize, offset } = parsePagination(req);
  const db = getDatabase();

  const { total } = db.prepare('SELECT COUNT(*) as total FROM home_feeds').get() as { total: number };
  const feeds = db.prepare('SELECT * FROM home_feeds ORDER BY sort_order ASC, created_at DESC LIMIT ? OFFSET ?').all(pageSize, offset);
  res.json({ items: feeds, total, page, page_size: pageSize });
});

homeRouter.post('/admin/feeds', (req: Request, res: Response) => {

  const { title, author, icon, bg_color, avatar_color, link, likes, image_height, sort_order, visible } = req.body;
  if (!title) { res.status(400).json({ error: 'title is required' }); return; }

  const db = getDatabase();
  const now = new Date().toISOString();
  const id = uuidv4();

  db.prepare(`
    INSERT INTO home_feeds (id, title, author, icon, bg_color, avatar_color, link, likes, image_height, sort_order, visible, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    title,
    author || '',
    icon || '',
    bg_color || '#f0f5ff',
    avatar_color || '#0077ff',
    link || '',
    likes ?? 0,
    image_height ?? 200,
    sort_order ?? 0,
    visible !== false ? 1 : 0,
    now,
    now
  );

  const feed = db.prepare('SELECT * FROM home_feeds WHERE id = ?').get(id);
  res.status(201).json(feed);
});

homeRouter.patch('/admin/feeds/:id', (req: Request, res: Response) => {

  const db = getDatabase();
  const existing = db.prepare('SELECT * FROM home_feeds WHERE id = ?').get(req.params.id);
  if (!existing) { res.status(404).json({ error: 'not found' }); return; }

  const changed = patchRow(db, 'home_feeds', {
    columns: ['title', 'author', 'icon', 'bg_color', 'avatar_color', 'link', 'likes', 'image_height', 'sort_order', 'visible'],
    booleans: ['visible'],
  }, req.body, { id: req.params.id });

  if (changed === 0) { res.status(400).json({ error: 'no fields to update' }); return; }

  const updated = db.prepare('SELECT * FROM home_feeds WHERE id = ?').get(req.params.id);
  res.json(updated);
});

homeRouter.delete('/admin/feeds/:id', (req: Request, res: Response) => {
  const db = getDatabase();
  const result = db.prepare('DELETE FROM home_feeds WHERE id = ?').run(req.params.id);
  if (result.changes === 0) { res.status(404).json({ error: 'not found' }); return; }
  res.json({ success: true });
});
