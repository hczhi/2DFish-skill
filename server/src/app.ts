import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { initDatabase, getDatabase } from './db/index.js';
import { authMiddleware } from './auth/middleware.js';
import { rateLimit } from './auth/rateLimit.js';
import { authRouter } from './api/auth.js';
import { aiRouter } from './api/ai.js';
import { logsRouter } from './api/logs.js';
import { chatRouter } from './api/chat.js';
import { filesRouter } from './api/files.js';
import { skillsRouter } from './api/skills.js';
import { consultantRouter } from './api/consultant.js';
import { settingsRouter } from './api/settings.js';
import { tokensRouter } from './api/tokens.js';
import { quotaRouter } from './api/quota.js';
import { adminRouter } from './api/admin.js';
import { homeRouter } from './api/home.js';
import { seoRouter } from './api/seo.js';
import { initWorkspace } from './services/workspaceService.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({
  origin: process.env.CORS_ORIGIN || true,
  credentials: true,
}));
app.use('/api/files', express.json({ limit: '5mb' }));
app.use(express.json({ limit: '512kb' }));

// Request logger
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    if (req.path.startsWith('/api/') && duration > 100) {
      console.log(`[req] ${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
    }
  });
  next();
});

// Auth middleware — applied globally, determines public/optional/protected per route
app.use(authMiddleware);

// Rate limiting for API endpoints
app.use('/api/ai', rateLimit(30, 60_000));
app.use('/api/chat', rateLimit(20, 60_000));
app.use('/api/consultant', rateLimit(20, 60_000));

// Public routes
app.use('/api/auth', authRouter);
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', version: '0.3.0' });
});

// Protected routes
app.use('/api/ai', aiRouter);
app.use('/api/ai/logs', logsRouter);
app.use('/api/chat', chatRouter);
app.use('/api/files', filesRouter);
app.use('/api/skills', skillsRouter);
app.use('/api/consultant', consultantRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/tokens', tokensRouter);
app.use('/api/quota', quotaRouter);

// Admin routes
app.use('/api/admin', adminRouter);

// Home content (public reads + admin writes)
app.use('/api/home', homeRouter);

// SEO management
app.use('/api/seo', seoRouter);

// Static uploads
app.use('/uploads', express.static(path.resolve(process.cwd(), 'data/uploads')));

// Production: serve compiled frontend with SEO injection
const clientDistPath = path.resolve(process.cwd(), '../client/dist');
if (fs.existsSync(clientDistPath)) {
  // robots.txt and sitemap.xml served dynamically
  app.get('/robots.txt', (req, res, next) => {
    // Delegate to SEO router
    req.url = '/api/seo/robots.txt';
    next('route');
  });
  app.get('/sitemap.xml', (req, res, next) => {
    req.url = '/api/seo/sitemap.xml';
    next('route');
  });

  app.use(express.static(clientDistPath, { maxAge: '30d', immutable: true, index: false }));

  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/uploads/')) return next();

    const htmlPath = path.join(clientDistPath, 'index.html');
    let html = fs.readFileSync(htmlPath, 'utf-8');

    // Inject SEO meta tags
    try {
      const db = getDatabase();
      const page = db.prepare('SELECT * FROM seo_pages WHERE path = ?').get(req.path) as any;
      const globalRows = db.prepare('SELECT key, value FROM seo_global').all() as Array<{ key: string; value: string }>;
      const globals: Record<string, string> = {};
      for (const r of globalRows) globals[r.key] = r.value;

      const siteUrl = globals.site_url || '';
      const siteName = globals.site_name || 'QiaoNan';
      const title = page?.title || `${siteName} - AI 效率工具平台`;
      const description = page?.description || globals.site_description || '';
      const ogImage = page?.og_image || globals.default_og_image || '';
      const canonical = page?.canonical || (siteUrl ? `${siteUrl}${req.path}` : '');

      let metaTags = `<title>${escapeHtml(title)}</title>\n`;
      metaTags += `    <meta name="description" content="${escapeHtml(description)}" />\n`;
      if (page?.keywords) metaTags += `    <meta name="keywords" content="${escapeHtml(page.keywords)}" />\n`;
      if (canonical) metaTags += `    <link rel="canonical" href="${escapeHtml(canonical)}" />\n`;
      if (page?.no_index) metaTags += `    <meta name="robots" content="noindex,nofollow" />\n`;

      // Open Graph
      metaTags += `    <meta property="og:title" content="${escapeHtml(page?.og_title || title)}" />\n`;
      metaTags += `    <meta property="og:description" content="${escapeHtml(page?.og_description || description)}" />\n`;
      metaTags += `    <meta property="og:type" content="website" />\n`;
      if (siteUrl) metaTags += `    <meta property="og:url" content="${escapeHtml(siteUrl + req.path)}" />\n`;
      if (ogImage) metaTags += `    <meta property="og:image" content="${escapeHtml(ogImage)}" />\n`;
      metaTags += `    <meta property="og:site_name" content="${escapeHtml(siteName)}" />\n`;

      // Twitter Card
      metaTags += `    <meta name="twitter:card" content="summary_large_image" />\n`;
      metaTags += `    <meta name="twitter:title" content="${escapeHtml(page?.og_title || title)}" />\n`;
      metaTags += `    <meta name="twitter:description" content="${escapeHtml(page?.og_description || description)}" />\n`;
      if (ogImage) metaTags += `    <meta name="twitter:image" content="${escapeHtml(ogImage)}" />\n`;

      // Verification
      if (globals.google_verification) metaTags += `    <meta name="google-site-verification" content="${escapeHtml(globals.google_verification)}" />\n`;
      if (globals.bing_verification) metaTags += `    <meta name="msvalidate.01" content="${escapeHtml(globals.bing_verification)}" />\n`;

      // JSON-LD
      if (page?.json_ld) metaTags += `    <script type="application/ld+json">${page.json_ld}</script>\n`;

      // Replace the <title> in HTML
      html = html.replace(/<title>.*?<\/title>/, metaTags);
    } catch { /* serve unmodified HTML on error */ }

    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  });
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Global error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[mmPla] Unhandled error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// Initialize
if (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'change-this-to-a-random-string') {
  console.warn('[mmPla] ⚠️  WARNING: JWT_SECRET is not configured. Set a strong random value in .env for production.');
}

initDatabase();
initWorkspace();
ensureAdminUser();

const server = app.listen(Number(PORT), '0.0.0.0', () => {
  console.log(`[mmPla] Server running on http://localhost:${PORT}`);
});

// Graceful shutdown
function shutdown() {
  console.log('[mmPla] Shutting down gracefully...');
  server.close(() => {
    const { getDatabase } = require('./db/index.js');
    try { getDatabase().close(); } catch { /* already closed */ }
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

function ensureAdminUser(): void {
  const db = getDatabase();
  const existing = db.prepare('SELECT id FROM user LIMIT 1').get();
  if (existing) return;

  const now = new Date().toISOString();
  const id = uuidv4();
  const passwordHash = bcrypt.hashSync('123456', 10);

  db.prepare(
    `INSERT INTO user (id, username, password_hash, role, api_key, api_base_url, model, created_at, updated_at)
     VALUES (?, ?, ?, 'admin', ?, ?, ?, ?, ?)`
  ).run(id, 'admin', passwordHash, null, null, null, now, now);

  console.log('[mmPla] Default admin user created (admin/123456). Please change password after login.');
}
