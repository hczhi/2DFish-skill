import { Router, Request, Response } from 'express';
import { getDatabase } from '../db/index.js';
import { v4 as uuidv4 } from 'uuid';
import { generateArticlePage } from '../services/ssgService.js';

export const discoverRouter = Router();

interface ArticleRow {
  id: string;
  slug: string;
  cover_image: string;
  author: string;
  icon: string;
  bg_color: string;
  avatar_color: string;
  sort_order: number;
  visible_locales: string;
  status: string;
  static_generated_at: string | null;
  created_at: string;
  updated_at: string;
}

interface ArticleContentRow {
  id: string;
  article_id: string;
  locale: string;
  title: string;
  summary: string;
  content: string;
  seo_title: string;
  seo_description: string;
  seo_keywords: string;
}

interface RecommendationRow {
  id: string;
  article_id: string;
  recommended_article_id: string;
  locale: string;
  sort_order: number;
}

// ===== PUBLIC: Get published articles for display =====

discoverRouter.get('/articles', (req: Request, res: Response) => {
  const locale = (req.query.locale as string) || 'zh';
  const db = getDatabase();

  const articles = db.prepare(`
    SELECT a.*, c.title, c.summary
    FROM discover_articles a
    LEFT JOIN discover_article_contents c ON c.article_id = a.id AND c.locale = ?
    WHERE a.status = 'published'
      AND a.visible_locales LIKE '%"' || ? || '"%'
    ORDER BY a.sort_order ASC, a.created_at DESC
  `).all(locale, locale) as Array<ArticleRow & { title: string; summary: string }>;

  res.json(articles);
});

discoverRouter.get('/articles/:slug', (req: Request, res: Response) => {
  const locale = (req.query.locale as string) || 'zh';
  const db = getDatabase();

  const article = db.prepare(`
    SELECT a.*, c.title, c.summary, c.content, c.seo_title, c.seo_description, c.seo_keywords
    FROM discover_articles a
    LEFT JOIN discover_article_contents c ON c.article_id = a.id AND c.locale = ?
    WHERE a.slug = ? AND a.status = 'published'
  `).get(locale, req.params.slug) as (ArticleRow & ArticleContentRow) | undefined;

  if (!article) {
    res.status(404).json({ error: 'not found' });
    return;
  }

  const recommendations = db.prepare(`
    SELECT ra.slug, ra.icon, ra.bg_color, ra.avatar_color, ra.author, rc.title, rc.summary
    FROM discover_article_recommendations r
    JOIN discover_articles ra ON ra.id = r.recommended_article_id AND ra.status = 'published'
    LEFT JOIN discover_article_contents rc ON rc.article_id = ra.id AND rc.locale = ?
    WHERE r.article_id = ? AND r.locale = ?
    ORDER BY r.sort_order ASC
    LIMIT 5
  `).all(locale, article.id, locale) as Array<{ slug: string; icon: string; bg_color: string; avatar_color: string; author: string; title: string; summary: string }>;

  res.json({ ...article, recommendations });
});

// ===== ADMIN: Manage discover articles =====

discoverRouter.get('/admin/articles', (req: Request, res: Response) => {
  if (req.user?.role !== 'admin') { res.status(403).json({ error: 'admin required' }); return; }
  const db = getDatabase();

  const articles = db.prepare(
    'SELECT * FROM discover_articles ORDER BY sort_order ASC, created_at DESC'
  ).all() as ArticleRow[];

  const contents = db.prepare(
    'SELECT * FROM discover_article_contents'
  ).all() as ArticleContentRow[];

  const contentMap: Record<string, ArticleContentRow[]> = {};
  for (const c of contents) {
    if (!contentMap[c.article_id]) contentMap[c.article_id] = [];
    contentMap[c.article_id].push(c);
  }

  const result = articles.map(a => ({
    ...a,
    visible_locales: JSON.parse(a.visible_locales || '[]'),
    contents: contentMap[a.id] || [],
  }));

  res.json(result);
});

discoverRouter.get('/admin/articles/:id', (req: Request, res: Response) => {
  if (req.user?.role !== 'admin') { res.status(403).json({ error: 'admin required' }); return; }
  const db = getDatabase();

  const article = db.prepare('SELECT * FROM discover_articles WHERE id = ?').get(req.params.id) as ArticleRow | undefined;
  if (!article) { res.status(404).json({ error: 'not found' }); return; }

  const contents = db.prepare(
    'SELECT * FROM discover_article_contents WHERE article_id = ?'
  ).all(req.params.id) as ArticleContentRow[];

  const recommendations = db.prepare(
    'SELECT * FROM discover_article_recommendations WHERE article_id = ? ORDER BY locale, sort_order'
  ).all(req.params.id) as RecommendationRow[];

  res.json({
    ...article,
    visible_locales: JSON.parse(article.visible_locales || '[]'),
    contents,
    recommendations,
  });
});

discoverRouter.post('/admin/articles', (req: Request, res: Response) => {
  if (req.user?.role !== 'admin') { res.status(403).json({ error: 'admin required' }); return; }

  const { slug, cover_image, author, icon, bg_color, avatar_color, sort_order, visible_locales, status, contents, recommendations } = req.body;
  if (!slug) { res.status(400).json({ error: 'slug is required' }); return; }

  const db = getDatabase();
  const existing = db.prepare('SELECT id FROM discover_articles WHERE slug = ?').get(slug);
  if (existing) { res.status(409).json({ error: 'slug already exists' }); return; }

  const now = new Date().toISOString();
  const id = uuidv4();

  db.prepare(`
    INSERT INTO discover_articles (id, slug, cover_image, author, icon, bg_color, avatar_color, sort_order, visible_locales, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, slug,
    cover_image || '', author || '', icon || '',
    bg_color || '#f0f5ff', avatar_color || '#0077ff',
    sort_order ?? 0,
    JSON.stringify(visible_locales || []),
    status || 'draft',
    now, now
  );

  if (Array.isArray(contents)) {
    const stmt = db.prepare(`
      INSERT INTO discover_article_contents (id, article_id, locale, title, summary, content, seo_title, seo_description, seo_keywords)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const c of contents) {
      if (!c.locale) continue;
      stmt.run(uuidv4(), id, c.locale, c.title || '', c.summary || '', c.content || '', c.seo_title || '', c.seo_description || '', c.seo_keywords || '');
    }
  }

  if (Array.isArray(recommendations)) {
    const stmt = db.prepare(`
      INSERT INTO discover_article_recommendations (id, article_id, recommended_article_id, locale, sort_order)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const r of recommendations) {
      if (!r.recommended_article_id || !r.locale) continue;
      stmt.run(uuidv4(), id, r.recommended_article_id, r.locale, r.sort_order ?? 0);
    }
  }

  const article = db.prepare('SELECT * FROM discover_articles WHERE id = ?').get(id) as ArticleRow;
  const articleContents = db.prepare('SELECT * FROM discover_article_contents WHERE article_id = ?').all(id);
  const articleRecs = db.prepare('SELECT * FROM discover_article_recommendations WHERE article_id = ? ORDER BY locale, sort_order').all(id);
  res.status(201).json({ ...article, visible_locales: JSON.parse(article.visible_locales || '[]'), contents: articleContents, recommendations: articleRecs });
});

discoverRouter.patch('/admin/articles/:id', (req: Request, res: Response) => {
  if (req.user?.role !== 'admin') { res.status(403).json({ error: 'admin required' }); return; }

  const db = getDatabase();
  const existing = db.prepare('SELECT * FROM discover_articles WHERE id = ?').get(req.params.id) as ArticleRow | undefined;
  if (!existing) { res.status(404).json({ error: 'not found' }); return; }

  const fields: string[] = [];
  const values: any[] = [];
  const allowed = ['slug', 'cover_image', 'author', 'icon', 'bg_color', 'avatar_color', 'sort_order', 'status'];

  for (const field of allowed) {
    if (req.body[field] !== undefined) {
      fields.push(`${field} = ?`);
      values.push(req.body[field]);
    }
  }

  if (req.body.visible_locales !== undefined) {
    fields.push('visible_locales = ?');
    values.push(JSON.stringify(req.body.visible_locales));
  }

  if (fields.length > 0) {
    fields.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(req.params.id);
    db.prepare(`UPDATE discover_articles SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  }

  if (Array.isArray(req.body.contents)) {
    for (const c of req.body.contents) {
      if (!c.locale) continue;
      const existingContent = db.prepare(
        'SELECT id FROM discover_article_contents WHERE article_id = ? AND locale = ?'
      ).get(req.params.id, c.locale) as { id: string } | undefined;

      if (existingContent) {
        db.prepare(`
          UPDATE discover_article_contents
          SET title = ?, summary = ?, content = ?, seo_title = ?, seo_description = ?, seo_keywords = ?
          WHERE id = ?
        `).run(c.title || '', c.summary || '', c.content || '', c.seo_title || '', c.seo_description || '', c.seo_keywords || '', existingContent.id);
      } else {
        db.prepare(`
          INSERT INTO discover_article_contents (id, article_id, locale, title, summary, content, seo_title, seo_description, seo_keywords)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(uuidv4(), req.params.id, c.locale, c.title || '', c.summary || '', c.content || '', c.seo_title || '', c.seo_description || '', c.seo_keywords || '');
      }
    }
  }

  if (req.body.recommendations !== undefined) {
    db.prepare('DELETE FROM discover_article_recommendations WHERE article_id = ?').run(req.params.id);
    if (Array.isArray(req.body.recommendations)) {
      const stmt = db.prepare(`
        INSERT INTO discover_article_recommendations (id, article_id, recommended_article_id, locale, sort_order)
        VALUES (?, ?, ?, ?, ?)
      `);
      for (const r of req.body.recommendations) {
        if (!r.recommended_article_id || !r.locale) continue;
        stmt.run(uuidv4(), req.params.id, r.recommended_article_id, r.locale, r.sort_order ?? 0);
      }
    }
  }

  const article = db.prepare('SELECT * FROM discover_articles WHERE id = ?').get(req.params.id) as ArticleRow;
  const articleContents = db.prepare('SELECT * FROM discover_article_contents WHERE article_id = ?').all(req.params.id);
  const articleRecs = db.prepare('SELECT * FROM discover_article_recommendations WHERE article_id = ? ORDER BY locale, sort_order').all(req.params.id);
  res.json({ ...article, visible_locales: JSON.parse(article.visible_locales || '[]'), contents: articleContents, recommendations: articleRecs });
});

discoverRouter.delete('/admin/articles/:id', (req: Request, res: Response) => {
  if (req.user?.role !== 'admin') { res.status(403).json({ error: 'admin required' }); return; }
  const db = getDatabase();
  db.prepare('DELETE FROM discover_article_contents WHERE article_id = ?').run(req.params.id);
  const result = db.prepare('DELETE FROM discover_articles WHERE id = ?').run(req.params.id);
  if (result.changes === 0) { res.status(404).json({ error: 'not found' }); return; }
  res.json({ success: true });
});

// Batch sort order
discoverRouter.put('/admin/articles/sort', (req: Request, res: Response) => {
  if (req.user?.role !== 'admin') { res.status(403).json({ error: 'admin required' }); return; }
  const { items } = req.body as { items: Array<{ id: string; sort_order: number }> };
  if (!Array.isArray(items)) { res.status(400).json({ error: 'items array required' }); return; }

  const db = getDatabase();
  const stmt = db.prepare('UPDATE discover_articles SET sort_order = ?, updated_at = ? WHERE id = ?');
  const now = new Date().toISOString();
  const batchUpdate = db.transaction(() => {
    for (const item of items) {
      stmt.run(item.sort_order, now, item.id);
    }
  });
  batchUpdate();
  res.json({ success: true });
});

// Generate static page for a single article
discoverRouter.post('/admin/articles/:id/generate', (req: Request, res: Response) => {
  if (req.user?.role !== 'admin') { res.status(403).json({ error: 'admin required' }); return; }

  const db = getDatabase();
  const article = db.prepare('SELECT * FROM discover_articles WHERE id = ?').get(req.params.id) as ArticleRow | undefined;
  if (!article) { res.status(404).json({ error: 'not found' }); return; }

  const contents = db.prepare(
    'SELECT * FROM discover_article_contents WHERE article_id = ?'
  ).all(req.params.id) as ArticleContentRow[];

  const locales: string[] = JSON.parse(article.visible_locales || '[]');
  if (locales.length === 0) {
    res.status(400).json({ error: 'No visible locales configured for this article' });
    return;
  }

  const result = generateArticlePage(article, contents, locales);

  if (result.success) {
    db.prepare('UPDATE discover_articles SET static_generated_at = ? WHERE id = ?')
      .run(new Date().toISOString(), req.params.id);
  }

  res.json(result);
});
