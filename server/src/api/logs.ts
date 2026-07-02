import { Router, Request, Response } from 'express';
import { getDatabase } from '../db/index.js';

export const logsRouter = Router();

logsRouter.get('/', (req: Request, res: Response) => {
  const { source, limit = '50', offset = '0', date_from, date_to } = req.query;

  const db = getDatabase();
  let sql = 'SELECT * FROM ai_logs WHERE 1=1';
  const params: unknown[] = [];

  // Non-admin users can only see their own logs
  if (req.user!.role !== 'admin') {
    sql += ' AND user_id = ?';
    params.push(req.user!.id);
  }

  if (source) {
    sql += ' AND source = ?';
    params.push(source);
  }
  if (date_from) {
    sql += ' AND created_at >= ?';
    params.push(date_from);
  }
  if (date_to) {
    sql += ' AND created_at <= ?';
    params.push(date_to);
  }

  const countSql = sql.replace('SELECT *', 'SELECT COUNT(*) as count');
  const total = db.prepare(countSql).get(...params) as { count: number };

  sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(Number(limit), Number(offset));

  const logs = db.prepare(sql).all(...params);

  res.json({ logs, total: total.count });
});

logsRouter.get('/stats', (req: Request, res: Response) => {
  const { days = '7' } = req.query;
  const db = getDatabase();

  const since = new Date();
  since.setDate(since.getDate() - Number(days));
  const sinceStr = since.toISOString();

  const userFilter = req.user!.role !== 'admin' ? ' AND user_id = ?' : '';
  const userParam = req.user!.role !== 'admin' ? [req.user!.id] : [];

  const bySource = db.prepare(`
    SELECT source, COUNT(*) as count, SUM(total_tokens) as tokens
    FROM ai_logs WHERE created_at >= ?${userFilter}
    GROUP BY source
  `).all(sinceStr, ...userParam);

  const byDay = db.prepare(`
    SELECT DATE(created_at) as day, COUNT(*) as count, SUM(total_tokens) as tokens
    FROM ai_logs WHERE created_at >= ?${userFilter}
    GROUP BY DATE(created_at)
    ORDER BY day
  `).all(sinceStr, ...userParam);

  const total = db.prepare(`
    SELECT COUNT(*) as count, SUM(total_tokens) as tokens, SUM(input_tokens) as input_tokens, SUM(output_tokens) as output_tokens
    FROM ai_logs WHERE created_at >= ?${userFilter}
  `).get(sinceStr, ...userParam);

  res.json({ bySource, byDay, total, days: Number(days) });
});
