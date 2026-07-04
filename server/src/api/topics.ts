import { Router, Request, Response } from 'express';
import { getDatabase } from '../db/index.js';
import { v4 as uuidv4 } from 'uuid';
import { generateTopicPage, deleteTopicStaticPages } from '../services/ssgService.js';

export const topicsRouter = Router();

interface TopicRow {
  id: string;
  slug: string;
  cover_image: string;
  icon: string;
  bg_color: string;
  template: string;
  sort_order: number;
  visible_locales: string;
  status: string;
  static_generated_at: string | null;
  created_at: string;
  updated_at: string;
}

interface TopicContentRow {
  id: string;
  topic_id: string;
  locale: string;
  title: string;
  description: string;
  seo_title: string;
  seo_description: string;
  seo_keywords: string;
}

// ===== PUBLIC: Get published topics =====

topicsRouter.get('/', (req: Request, res: Response) => {
  const locale = (req.query.locale as string) || 'zh';
  const db = getDatabase();

  const topics = db.prepare(`
    SELECT t.*, c.title, c.description,
      (SELECT COUNT(*) FROM discover_articles a WHERE a.topic_id = t.id AND a.status = 'published'
        AND a.visible_locales LIKE '%"' || ? || '"%') as article_count
    FROM discover_topics t
    LEFT JOIN discover_topic_contents c ON c.topic_id = t.id AND c.locale = ?
    WHERE t.status = 'published'
      AND t.visible_locales LIKE '%"' || ? || '"%'
    ORDER BY t.sort_order ASC, t.created_at DESC
  `).all(locale, locale, locale);

  res.json(topics);
});

topicsRouter.get('/:slug', (req: Request, res: Response) => {
  const locale = (req.query.locale as string) || 'zh';
  const db = getDatabase();

  const topic = db.prepare(`
    SELECT t.*, c.title, c.description, c.seo_title, c.seo_description, c.seo_keywords
    FROM discover_topics t
    LEFT JOIN discover_topic_contents c ON c.topic_id = t.id AND c.locale = ?
    WHERE t.slug = ? AND t.status = 'published'
  `).get(locale, req.params.slug) as (TopicRow & TopicContentRow) | undefined;

  if (!topic) {
    res.status(404).json({ error: 'not found' });
    return;
  }

  const articles = db.prepare(`
    SELECT a.slug, a.icon, a.cover_image, a.bg_color, a.avatar_color, a.author, ac.title, ac.summary
    FROM discover_articles a
    LEFT JOIN discover_article_contents ac ON ac.article_id = a.id AND ac.locale = ?
    WHERE a.topic_id = ? AND a.status = 'published'
      AND a.visible_locales LIKE '%"' || ? || '"%'
    ORDER BY a.sort_order ASC, a.created_at DESC
  `).all(locale, topic.id, locale);

  res.json({ ...topic, articles });
});

// ===== ADMIN: Manage topics =====

topicsRouter.get('/admin/list', (req: Request, res: Response) => {
  if (req.user?.role !== 'admin') { res.status(403).json({ error: 'admin required' }); return; }
  const db = getDatabase();

  const topics = db.prepare('SELECT * FROM discover_topics ORDER BY sort_order ASC, created_at DESC').all() as TopicRow[];
  const contents = db.prepare('SELECT * FROM discover_topic_contents').all() as TopicContentRow[];

  const contentMap: Record<string, TopicContentRow[]> = {};
  for (const c of contents) {
    if (!contentMap[c.topic_id]) contentMap[c.topic_id] = [];
    contentMap[c.topic_id].push(c);
  }

  const result = topics.map(t => ({
    ...t,
    visible_locales: JSON.parse(t.visible_locales || '[]'),
    contents: contentMap[t.id] || [],
  }));

  res.json(result);
});

topicsRouter.get('/admin/:id', (req: Request, res: Response) => {
  if (req.user?.role !== 'admin') { res.status(403).json({ error: 'admin required' }); return; }
  const db = getDatabase();

  const topic = db.prepare('SELECT * FROM discover_topics WHERE id = ?').get(req.params.id) as TopicRow | undefined;
  if (!topic) { res.status(404).json({ error: 'not found' }); return; }

  const contents = db.prepare('SELECT * FROM discover_topic_contents WHERE topic_id = ?').all(req.params.id) as TopicContentRow[];

  const articles = db.prepare(`
    SELECT id, slug, icon, sort_order FROM discover_articles WHERE topic_id = ? ORDER BY sort_order ASC
  `).all(req.params.id);

  res.json({
    ...topic,
    visible_locales: JSON.parse(topic.visible_locales || '[]'),
    contents,
    articles,
  });
});

topicsRouter.post('/admin', (req: Request, res: Response) => {
  if (req.user?.role !== 'admin') { res.status(403).json({ error: 'admin required' }); return; }

  const { slug, cover_image, icon, bg_color, template, sort_order, visible_locales, status, contents } = req.body;
  if (!slug) { res.status(400).json({ error: 'slug is required' }); return; }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
    res.status(400).json({ error: 'slug must contain only lowercase letters, numbers, and hyphens' });
    return;
  }

  const db = getDatabase();
  const existing = db.prepare('SELECT id FROM discover_topics WHERE slug = ?').get(slug);
  if (existing) { res.status(409).json({ error: 'slug already exists' }); return; }

  const now = new Date().toISOString();
  const id = uuidv4();

  db.prepare(`
    INSERT INTO discover_topics (id, slug, cover_image, icon, bg_color, template, sort_order, visible_locales, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, slug,
    cover_image || '', icon || '', bg_color || '#f0f5ff',
    template || 'default', sort_order ?? 0,
    JSON.stringify(visible_locales || []),
    status || 'draft',
    now, now
  );

  if (Array.isArray(contents)) {
    const stmt = db.prepare(`
      INSERT INTO discover_topic_contents (id, topic_id, locale, title, description, seo_title, seo_description, seo_keywords)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const c of contents) {
      if (!c.locale) continue;
      stmt.run(uuidv4(), id, c.locale, c.title || '', c.description || '', c.seo_title || '', c.seo_description || '', c.seo_keywords || '');
    }
  }

  const topic = db.prepare('SELECT * FROM discover_topics WHERE id = ?').get(id) as TopicRow;
  const topicContents = db.prepare('SELECT * FROM discover_topic_contents WHERE topic_id = ?').all(id);
  res.status(201).json({ ...topic, contents: topicContents });
});

topicsRouter.patch('/admin/:id', (req: Request, res: Response) => {
  if (req.user?.role !== 'admin') { res.status(403).json({ error: 'admin required' }); return; }

  const db = getDatabase();
  const existing = db.prepare('SELECT * FROM discover_topics WHERE id = ?').get(req.params.id) as TopicRow | undefined;
  if (!existing) { res.status(404).json({ error: 'not found' }); return; }

  if (req.body.slug && !/^[a-z0-9][a-z0-9-]*$/.test(req.body.slug)) {
    res.status(400).json({ error: 'slug must contain only lowercase letters, numbers, and hyphens' });
    return;
  }

  const fields: string[] = [];
  const values: any[] = [];
  const allowed = ['slug', 'cover_image', 'icon', 'bg_color', 'template', 'sort_order', 'status'];

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
    db.prepare(`UPDATE discover_topics SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  }

  if (Array.isArray(req.body.contents)) {
    for (const c of req.body.contents) {
      if (!c.locale) continue;
      const existingContent = db.prepare(
        'SELECT id FROM discover_topic_contents WHERE topic_id = ? AND locale = ?'
      ).get(req.params.id, c.locale) as { id: string } | undefined;

      if (existingContent) {
        db.prepare(`
          UPDATE discover_topic_contents
          SET title = ?, description = ?, seo_title = ?, seo_description = ?, seo_keywords = ?
          WHERE id = ?
        `).run(c.title || '', c.description || '', c.seo_title || '', c.seo_description || '', c.seo_keywords || '', existingContent.id);
      } else {
        db.prepare(`
          INSERT INTO discover_topic_contents (id, topic_id, locale, title, description, seo_title, seo_description, seo_keywords)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(uuidv4(), req.params.id, c.locale, c.title || '', c.description || '', c.seo_title || '', c.seo_description || '', c.seo_keywords || '');
      }
    }
  }

  const topic = db.prepare('SELECT * FROM discover_topics WHERE id = ?').get(req.params.id) as TopicRow;
  const topicContents = db.prepare('SELECT * FROM discover_topic_contents WHERE topic_id = ?').all(req.params.id);
  res.json({ ...topic, visible_locales: JSON.parse(topic.visible_locales || '[]'), contents: topicContents });
});

topicsRouter.delete('/admin/:id', (req: Request, res: Response) => {
  if (req.user?.role !== 'admin') { res.status(403).json({ error: 'admin required' }); return; }
  const db = getDatabase();

  db.prepare('UPDATE discover_articles SET topic_id = NULL WHERE topic_id = ?').run(req.params.id);
  db.prepare('DELETE FROM discover_topic_contents WHERE topic_id = ?').run(req.params.id);
  const result = db.prepare('DELETE FROM discover_topics WHERE id = ?').run(req.params.id);
  if (result.changes === 0) { res.status(404).json({ error: 'not found' }); return; }
  res.json({ success: true });
});

topicsRouter.post('/admin/:id/offline', (req: Request, res: Response) => {
  if (req.user?.role !== 'admin') { res.status(403).json({ error: 'admin required' }); return; }

  const db = getDatabase();
  const topic = db.prepare('SELECT * FROM discover_topics WHERE id = ?').get(req.params.id) as TopicRow | undefined;
  if (!topic) { res.status(404).json({ error: 'not found' }); return; }

  db.prepare('UPDATE discover_topics SET status = ?, updated_at = ? WHERE id = ?')
    .run('offline', new Date().toISOString(), req.params.id);

  const locales: string[] = JSON.parse(topic.visible_locales || '[]');
  const result = deleteTopicStaticPages(topic.slug, locales.length > 0 ? locales : ['zh', 'en']);

  res.json({ success: true, status: 'offline', ...result });
});

topicsRouter.post('/admin/:id/generate', (req: Request, res: Response) => {
  if (req.user?.role !== 'admin') { res.status(403).json({ error: 'admin required' }); return; }

  const db = getDatabase();
  const topic = db.prepare('SELECT * FROM discover_topics WHERE id = ?').get(req.params.id) as TopicRow | undefined;
  if (!topic) { res.status(404).json({ error: 'not found' }); return; }

  const contents = db.prepare(
    'SELECT * FROM discover_topic_contents WHERE topic_id = ?'
  ).all(req.params.id) as TopicContentRow[];

  const locales: string[] = JSON.parse(topic.visible_locales || '[]');
  if (locales.length === 0) {
    res.status(400).json({ error: 'No visible locales configured' });
    return;
  }

  const result = generateTopicPage(topic, contents, locales);

  if (result.success) {
    db.prepare('UPDATE discover_topics SET static_generated_at = ? WHERE id = ?')
      .run(new Date().toISOString(), req.params.id);
  }

  res.json(result);
});
