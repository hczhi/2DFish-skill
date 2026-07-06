import { Router, Request, Response } from 'express';
import { getDatabase } from '../db/index.js';

export const analyticsRouter = Router();

// PUBLIC: Record a page view
analyticsRouter.post('/pageview', (req: Request, res: Response) => {
  const { path, referrer, session_id } = req.body;
  if (!path) { res.status(400).json({ error: 'path required' }); return; }

  // Input validation: path must look like a URL path, max 500 chars
  if (typeof path !== 'string' || path.length > 500 || !/^\/[a-zA-Z0-9\-_\/%.]*$/.test(path)) {
    res.json({ ok: true });
    return;
  }
  const sanitizedReferrer = typeof referrer === 'string' ? referrer.slice(0, 1000).replace(/[<>"']/g, '') : '';
  const sanitizedSessionId = typeof session_id === 'string' ? session_id.slice(0, 100).replace(/[^a-zA-Z0-9\-_]/g, '') : '';

  const db = getDatabase();
  const ua = req.headers['user-agent'] || '';
  const ip = req.headers['x-forwarded-for'] as string || req.socket.remoteAddress || '';
  const userId = req.user?.id || '';

  // Skip bots
  if (/bot|crawl|spider|slurp|wget|curl/i.test(ua)) {
    res.json({ ok: true });
    return;
  }

  // Deduplicate: same session_id + path within 30 seconds
  if (sanitizedSessionId) {
    const recent = db.prepare(`
      SELECT id FROM page_views
      WHERE session_id = ? AND path = ? AND created_at > datetime('now', '-30 seconds')
    `).get(sanitizedSessionId, path);
    if (recent) {
      res.json({ ok: true });
      return;
    }
  }

  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO page_views (path, referrer, user_agent, ip, session_id, user_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(path, sanitizedReferrer, ua, ip, sanitizedSessionId, userId, now);

  // Update daily aggregate
  const today = now.split('T')[0];
  const existing = db.prepare(
    'SELECT id, pv FROM page_views_daily WHERE path = ? AND date = ?'
  ).get(path, today) as { id: number; pv: number } | undefined;

  if (existing) {
    // Check if this session is new for today
    const isNewSession = sanitizedSessionId ? !db.prepare(`
      SELECT id FROM page_views
      WHERE session_id = ? AND path = ? AND date(created_at) = ? AND id != last_insert_rowid()
    `).get(sanitizedSessionId, path, today) : true;

    db.prepare('UPDATE page_views_daily SET pv = pv + 1' + (isNewSession ? ', uv = uv + 1' : '') + ' WHERE id = ?')
      .run(existing.id);
  } else {
    db.prepare('INSERT INTO page_views_daily (path, date, pv, uv) VALUES (?, ?, 1, 1)')
      .run(path, today);
  }

  res.json({ ok: true });
});

// ADMIN: Get overview stats
analyticsRouter.get('/stats/overview', (req: Request, res: Response) => {
  if (req.user?.role !== 'admin') { res.status(403).json({ error: 'admin required' }); return; }

  const days = Math.min(Math.max(parseInt(req.query.days as string) || 7, 1), 365);
  const db = getDatabase();

  const totals = db.prepare(`
    SELECT
      COALESCE(SUM(pv), 0) as total_pv,
      COALESCE(SUM(uv), 0) as total_uv
    FROM page_views_daily
    WHERE date >= date('now', '-' || ? || ' days')
  `).get(days) as { total_pv: number; total_uv: number };

  const dailyTrend = db.prepare(`
    SELECT date, SUM(pv) as pv, SUM(uv) as uv
    FROM page_views_daily
    WHERE date >= date('now', '-' || ? || ' days')
    GROUP BY date
    ORDER BY date ASC
  `).all(days) as Array<{ date: string; pv: number; uv: number }>;

  const topPages = db.prepare(`
    SELECT path, SUM(pv) as pv, SUM(uv) as uv
    FROM page_views_daily
    WHERE date >= date('now', '-' || ? || ' days')
    GROUP BY path
    ORDER BY pv DESC
    LIMIT 20
  `).all(days) as Array<{ path: string; pv: number; uv: number }>;

  const todayStats = db.prepare(`
    SELECT COALESCE(SUM(pv), 0) as pv, COALESCE(SUM(uv), 0) as uv
    FROM page_views_daily
    WHERE date = date('now')
  `).get() as { pv: number; uv: number };

  res.json({
    days,
    total_pv: totals.total_pv,
    total_uv: totals.total_uv,
    today_pv: todayStats.pv,
    today_uv: todayStats.uv,
    daily_trend: dailyTrend,
    top_pages: topPages,
  });
});

// ADMIN: Get stats for a specific path
analyticsRouter.get('/stats/page', (req: Request, res: Response) => {
  if (req.user?.role !== 'admin') { res.status(403).json({ error: 'admin required' }); return; }

  const pagePath = req.query.path as string;
  if (!pagePath) { res.status(400).json({ error: 'path query required' }); return; }

  const days = Math.min(Math.max(parseInt(req.query.days as string) || 30, 1), 365);
  const db = getDatabase();

  const daily = db.prepare(`
    SELECT date, pv, uv
    FROM page_views_daily
    WHERE path = ? AND date >= date('now', '-' || ? || ' days')
    ORDER BY date ASC
  `).all(pagePath, days) as Array<{ date: string; pv: number; uv: number }>;

  const totals = db.prepare(`
    SELECT COALESCE(SUM(pv), 0) as total_pv, COALESCE(SUM(uv), 0) as total_uv
    FROM page_views_daily
    WHERE path = ? AND date >= date('now', '-' || ? || ' days')
  `).get(pagePath, days) as { total_pv: number; total_uv: number };

  const referrers = db.prepare(`
    SELECT referrer, COUNT(*) as count
    FROM page_views
    WHERE path = ? AND referrer != '' AND created_at >= datetime('now', '-' || ? || ' days')
    GROUP BY referrer
    ORDER BY count DESC
    LIMIT 10
  `).all(pagePath, days) as Array<{ referrer: string; count: number }>;

  res.json({
    path: pagePath,
    days,
    total_pv: totals.total_pv,
    total_uv: totals.total_uv,
    daily,
    referrers,
  });
});

// ADMIN: Real-time recent views
analyticsRouter.get('/stats/recent', (req: Request, res: Response) => {
  if (req.user?.role !== 'admin') { res.status(403).json({ error: 'admin required' }); return; }

  const page = Math.max(parseInt(req.query.page as string) || 1, 1);
  const pageSize = Math.min(Math.max(parseInt(req.query.page_size as string) || 20, 1), 100);
  const offset = (page - 1) * pageSize;
  const db = getDatabase();

  const { total } = db.prepare('SELECT COUNT(*) as total FROM page_views').get() as { total: number };
  const recent = db.prepare(`
    SELECT path, referrer, user_agent, ip, created_at
    FROM page_views
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `).all(pageSize, offset) as Array<{ path: string; referrer: string; user_agent: string; ip: string; created_at: string }>;

  res.json({ items: recent, total, page, page_size: pageSize });
});
