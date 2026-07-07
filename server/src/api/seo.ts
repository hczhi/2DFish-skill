import { Router, Request, Response } from 'express';
import { getDatabase } from '../db/index.js';
import { v4 as uuidv4 } from 'uuid';
import { generateStaticPages } from '../services/ssgService.js';

export const seoRouter = Router();

// ===== PUBLIC: 前端获取 SEO 数据 =====

// Get SEO for a specific path
seoRouter.get('/page', (req: Request, res: Response) => {
  const { path, locale } = req.query;
  if (!path || typeof path !== 'string') { res.status(400).json({ error: 'path query required' }); return; }

  const reqLocale = (locale as string) || 'zh';
  const db = getDatabase();

  let page = db.prepare('SELECT * FROM seo_pages WHERE path = ? AND locale = ?').get(path, reqLocale);
  if (!page && reqLocale !== 'zh') {
    page = db.prepare('SELECT * FROM seo_pages WHERE path = ? AND locale = ?').get(path, 'zh');
  }
  const globals = getGlobals(db);

  if (!page) {
    res.json({ page: null, globals });
    return;
  }
  res.json({ page, globals });
});

// Get all SEO pages (for sitemap generation)
seoRouter.get('/sitemap', (_req: Request, res: Response) => {
  const db = getDatabase();
  const pages = db.prepare('SELECT path, priority, changefreq, updated_at FROM seo_pages WHERE no_index = 0 ORDER BY priority DESC').all();
  const globals = getGlobals(db);
  res.json({ pages, siteUrl: globals.site_url || '' });
});

// Dynamic robots.txt
seoRouter.get('/robots.txt', (_req: Request, res: Response) => {
  const db = getDatabase();
  const globals = getGlobals(db);
  const siteUrl = globals.site_url || 'https://qiaonx.com';

  res.setHeader('Content-Type', 'text/plain');
  res.send(`User-agent: *
Allow: /
Allow: /api/discover/
Allow: /api/seo/
Allow: /api/home/
Allow: /api/analytics/pageview
Disallow: /api/
Disallow: /admin/
Disallow: /settings/
Disallow: /synap/

Sitemap: ${siteUrl}/sitemap.xml
`);
});

// Dynamic sitemap.xml
seoRouter.get('/sitemap.xml', (_req: Request, res: Response) => {
  const db = getDatabase();
  const globals = getGlobals(db);
  const siteUrl = globals.site_url || 'https://qiaonx.com';

  const urls: string[] = [];

  // 1. Static pages from seo_pages table
  const pages = db.prepare('SELECT path, locale, priority, changefreq, updated_at FROM seo_pages WHERE no_index = 0 ORDER BY priority DESC').all() as Array<{
    path: string; locale: string; priority: number; changefreq: string; updated_at: string;
  }>;
  for (const p of pages) {
    const fullPath = (p.locale && p.locale !== 'zh') ? `/en${p.path}` : p.path;
    urls.push(`  <url>
    <loc>${siteUrl}${fullPath}</loc>${p.updated_at ? `\n    <lastmod>${p.updated_at.split('T')[0]}</lastmod>` : ''}
    <changefreq>${p.changefreq || 'weekly'}</changefreq>
    <priority>${p.priority || 0.5}</priority>
  </url>`);
  }

  // 2. Published articles (auto-included, both zh and en)
  const articles = db.prepare(`
    SELECT a.slug, a.visible_locales, a.updated_at
    FROM discover_articles a
    WHERE a.status = 'published'
    ORDER BY a.created_at DESC
  `).all() as Array<{ slug: string; visible_locales: string; updated_at: string }>;

  const existingPaths = new Set(pages.map(p => {
    return (p.locale && p.locale !== 'zh') ? `/en${p.path}` : p.path;
  }));

  for (const a of articles) {
    const locales: string[] = JSON.parse(a.visible_locales || '["zh"]');
    const lastmod = a.updated_at ? a.updated_at.split('T')[0] : '';
    if (locales.includes('zh')) {
      const path = `/discover/${a.slug}`;
      if (!existingPaths.has(path)) {
        urls.push(`  <url>
    <loc>${siteUrl}${path}</loc>${lastmod ? `\n    <lastmod>${lastmod}</lastmod>` : ''}
    <changefreq>weekly</changefreq>
    <priority>0.7</priority>
  </url>`);
      }
    }
    if (locales.includes('en')) {
      const path = `/en/discover/${a.slug}`;
      if (!existingPaths.has(path)) {
        urls.push(`  <url>
    <loc>${siteUrl}${path}</loc>${lastmod ? `\n    <lastmod>${lastmod}</lastmod>` : ''}
    <changefreq>weekly</changefreq>
    <priority>0.7</priority>
  </url>`);
      }
    }
  }

  // 3. Published topics
  const topics = db.prepare(`
    SELECT slug, visible_locales, updated_at
    FROM discover_topics
    WHERE status = 'published'
    ORDER BY sort_order ASC
  `).all() as Array<{ slug: string; visible_locales: string; updated_at: string }>;

  for (const t of topics) {
    const locales: string[] = JSON.parse(t.visible_locales || '["zh"]');
    const lastmod = t.updated_at ? t.updated_at.split('T')[0] : '';
    if (locales.includes('zh')) {
      const path = `/discover/topic/${t.slug}`;
      if (!existingPaths.has(path)) {
        urls.push(`  <url>
    <loc>${siteUrl}${path}</loc>${lastmod ? `\n    <lastmod>${lastmod}</lastmod>` : ''}
    <changefreq>weekly</changefreq>
    <priority>0.6</priority>
  </url>`);
      }
    }
    if (locales.includes('en')) {
      const path = `/en/discover/topic/${t.slug}`;
      if (!existingPaths.has(path)) {
        urls.push(`  <url>
    <loc>${siteUrl}${path}</loc>${lastmod ? `\n    <lastmod>${lastmod}</lastmod>` : ''}
    <changefreq>weekly</changefreq>
    <priority>0.6</priority>
  </url>`);
      }
    }
  }

  res.setHeader('Content-Type', 'application/xml');
  res.send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('\n')}
</urlset>`);
});

// ===== ADMIN: 管理 SEO =====

seoRouter.get('/admin/pages', (req: Request, res: Response) => {
  if (req.user?.role !== 'admin') { res.status(403).json({ error: 'admin required' }); return; }
  const page = Math.max(parseInt(req.query.page as string) || 1, 1);
  const pageSize = Math.min(Math.max(parseInt(req.query.page_size as string) || 20, 1), 100);
  const offset = (page - 1) * pageSize;
  const db = getDatabase();

  const { total } = db.prepare('SELECT COUNT(*) as total FROM seo_pages').get() as { total: number };
  const pages = db.prepare('SELECT * FROM seo_pages ORDER BY path ASC, locale ASC LIMIT ? OFFSET ?').all(pageSize, offset);
  res.json({ items: pages, total, page, page_size: pageSize });
});

seoRouter.post('/admin/pages', (req: Request, res: Response) => {
  if (req.user?.role !== 'admin') { res.status(403).json({ error: 'admin required' }); return; }

  const { path, locale, title, description, keywords, og_title, og_description, og_image, canonical, no_index, json_ld, priority, changefreq } = req.body;
  if (!path || !title) { res.status(400).json({ error: 'path and title required' }); return; }

  const pageLocale = locale || 'zh';
  const db = getDatabase();
  const existing = db.prepare('SELECT id FROM seo_pages WHERE path = ? AND locale = ?').get(path, pageLocale);
  if (existing) { res.status(409).json({ error: 'path+locale already exists' }); return; }

  const now = new Date().toISOString();
  const id = uuidv4();

  db.prepare(`
    INSERT INTO seo_pages (id, path, locale, title, description, keywords, og_title, og_description, og_image, canonical, no_index, json_ld, priority, changefreq, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, path, pageLocale, title, description || '', keywords || '', og_title || '', og_description || '', og_image || '', canonical || '', no_index ? 1 : 0, json_ld || '', priority ?? 0.5, changefreq || 'weekly', now, now);

  const page = db.prepare('SELECT * FROM seo_pages WHERE id = ?').get(id);
  res.status(201).json(page);
});

seoRouter.patch('/admin/pages/:id', (req: Request, res: Response) => {
  if (req.user?.role !== 'admin') { res.status(403).json({ error: 'admin required' }); return; }

  const db = getDatabase();
  const existing = db.prepare('SELECT * FROM seo_pages WHERE id = ?').get(req.params.id);
  if (!existing) { res.status(404).json({ error: 'not found' }); return; }

  const fields: string[] = [];
  const values: any[] = [];
  const allowed = ['path', 'locale', 'title', 'description', 'keywords', 'og_title', 'og_description', 'og_image', 'canonical', 'no_index', 'json_ld', 'priority', 'changefreq'];

  for (const field of allowed) {
    if (req.body[field] !== undefined) {
      const val = field === 'no_index' ? (req.body[field] ? 1 : 0) : req.body[field];
      fields.push(`${field} = ?`);
      values.push(val);
    }
  }

  if (fields.length === 0) { res.status(400).json({ error: 'no fields' }); return; }

  fields.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(req.params.id);

  db.prepare(`UPDATE seo_pages SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  const updated = db.prepare('SELECT * FROM seo_pages WHERE id = ?').get(req.params.id);
  res.json(updated);
});

seoRouter.delete('/admin/pages/:id', (req: Request, res: Response) => {
  if (req.user?.role !== 'admin') { res.status(403).json({ error: 'admin required' }); return; }
  const db = getDatabase();
  const result = db.prepare('DELETE FROM seo_pages WHERE id = ?').run(req.params.id);
  if (result.changes === 0) { res.status(404).json({ error: 'not found' }); return; }
  res.json({ success: true });
});

// Global settings
seoRouter.get('/admin/globals', (req: Request, res: Response) => {
  if (req.user?.role !== 'admin') { res.status(403).json({ error: 'admin required' }); return; }
  const db = getDatabase();
  res.json(getGlobals(db));
});

seoRouter.patch('/admin/globals', (req: Request, res: Response) => {
  if (req.user?.role !== 'admin') { res.status(403).json({ error: 'admin required' }); return; }

  const db = getDatabase();
  const now = new Date().toISOString();
  const allowed = ['site_name', 'site_description', 'site_url', 'default_og_image', 'google_verification', 'bing_verification'];

  const stmt = db.prepare('INSERT OR REPLACE INTO seo_global (key, value, updated_at) VALUES (?, ?, ?)');
  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      stmt.run(key, req.body[key], now);
    }
  }

  res.json(getGlobals(db));
});

// SSG: Generate static pages
seoRouter.post('/admin/generate', (req: Request, res: Response) => {
  if (req.user?.role !== 'admin') { res.status(403).json({ error: 'admin required' }); return; }

  const result = generateStaticPages();
  res.json(result);
});

function getGlobals(db: any): Record<string, string> {
  const rows = db.prepare('SELECT key, value FROM seo_global').all() as Array<{ key: string; value: string }>;
  const result: Record<string, string> = {};
  for (const row of rows) { result[row.key] = row.value; }
  return result;
}
