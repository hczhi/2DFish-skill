import { Router, Request, Response } from 'express';
import { getDatabase } from '../db/index.js';
import { v4 as uuidv4 } from 'uuid';

export const adSlotsRouter = Router();

// PUBLIC: Get ad slots for a page
adSlotsRouter.get('/', (req: Request, res: Response) => {
  const page = (req.query.page as string) || '/';
  const db = getDatabase();

  const slots = db.prepare(`
    SELECT id, page_pattern, position, slot_code, label, height
    FROM ad_slots
    WHERE enabled = 1
    ORDER BY sort_order ASC
  `).all() as Array<{ id: string; page_pattern: string; position: string; slot_code: string; label: string; height: number | null }>;

  const normalizedPage = page.replace(/^\/en\//, '/').replace(/^\/en$/, '/');

  const matched = slots.filter(s => {
    if (s.page_pattern === '*') return true;
    if (s.page_pattern.endsWith('*')) {
      const prefix = s.page_pattern.slice(0, -1);
      return page.startsWith(prefix) || normalizedPage.startsWith(prefix);
    }
    return page === s.page_pattern || normalizedPage === s.page_pattern;
  });

  res.json(matched);
});

// ADMIN: List all ad slots
adSlotsRouter.get('/admin/list', (req: Request, res: Response) => {
  if (req.user?.role !== 'admin') { res.status(403).json({ error: 'admin required' }); return; }
  const page = Math.max(parseInt(req.query.page as string) || 1, 1);
  const pageSize = Math.min(Math.max(parseInt(req.query.page_size as string) || 20, 1), 100);
  const offset = (page - 1) * pageSize;
  const db = getDatabase();

  const { total } = db.prepare('SELECT COUNT(*) as total FROM ad_slots').get() as { total: number };
  const slots = db.prepare('SELECT * FROM ad_slots ORDER BY page_pattern ASC, sort_order ASC LIMIT ? OFFSET ?').all(pageSize, offset);
  res.json({ items: slots, total, page, page_size: pageSize });
});

// ADMIN: Create ad slot
adSlotsRouter.post('/admin', (req: Request, res: Response) => {
  if (req.user?.role !== 'admin') { res.status(403).json({ error: 'admin required' }); return; }

  const { page_pattern, position, slot_code, enabled, label, sort_order, height } = req.body;
  if (!page_pattern || !position) {
    res.status(400).json({ error: 'page_pattern and position are required' });
    return;
  }

  const db = getDatabase();
  const now = new Date().toISOString();
  const id = uuidv4();

  db.prepare(`
    INSERT INTO ad_slots (id, page_pattern, position, slot_code, enabled, label, sort_order, height, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, page_pattern, position, slot_code || '', enabled ?? 1, label || '', sort_order ?? 0, height ?? 90, now, now);

  const slot = db.prepare('SELECT * FROM ad_slots WHERE id = ?').get(id);
  res.status(201).json(slot);
});

// ADMIN: Update ad slot
adSlotsRouter.patch('/admin/:id', (req: Request, res: Response) => {
  if (req.user?.role !== 'admin') { res.status(403).json({ error: 'admin required' }); return; }

  const db = getDatabase();
  const existing = db.prepare('SELECT id FROM ad_slots WHERE id = ?').get(req.params.id);
  if (!existing) { res.status(404).json({ error: 'not found' }); return; }

  const fields: string[] = [];
  const values: any[] = [];
  const allowed = ['page_pattern', 'position', 'slot_code', 'enabled', 'label', 'sort_order', 'height'];

  for (const field of allowed) {
    if (req.body[field] !== undefined) {
      fields.push(`${field} = ?`);
      values.push(req.body[field]);
    }
  }

  if (fields.length === 0) { res.status(400).json({ error: 'no fields to update' }); return; }

  fields.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(req.params.id);

  db.prepare(`UPDATE ad_slots SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  const slot = db.prepare('SELECT * FROM ad_slots WHERE id = ?').get(req.params.id);
  res.json(slot);
});

// ADMIN: Delete ad slot
adSlotsRouter.delete('/admin/:id', (req: Request, res: Response) => {
  if (req.user?.role !== 'admin') { res.status(403).json({ error: 'admin required' }); return; }
  const db = getDatabase();
  const result = db.prepare('DELETE FROM ad_slots WHERE id = ?').run(req.params.id);
  if (result.changes === 0) { res.status(404).json({ error: 'not found' }); return; }
  res.json({ success: true });
});
