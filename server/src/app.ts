import express from 'express';
import compression from 'compression';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { initDatabase, getDatabase } from './db/index.js';
import { authMiddleware } from './auth/middleware.js';
import { moduleGuard } from './auth/moduleGuard.js';
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
import { discoverRouter } from './api/discover.js';
import { topicsRouter } from './api/topics.js';
import { analyticsRouter } from './api/analytics.js';
import { adSlotsRouter } from './api/adSlots.js';
import { uploadRouter } from './api/upload.js';
import { initWorkspace } from './services/workspaceService.js';
import { startLogCleanupScheduler, cleanupOldLogs } from './services/logCleanupService.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Gzip compression
app.use(compression());

// CORS configuration
const corsOrigin = (() => {
  if (process.env.CORS_ORIGIN) {
    const origins = process.env.CORS_ORIGIN.split(',').map(o => o.trim());
    return origins.length === 1 ? origins[0] : origins;
  }
  if (process.env.NODE_ENV === 'production') {
    return false as const;
  }
  return ['http://localhost:5173', 'http://localhost:3001'];
})();

app.use(cors({
  origin: corsOrigin,
  credentials: true,
}));
// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

app.use('/api/files', express.json({ limit: '5mb' }));
app.use('/api/discover', express.json({ limit: '2mb' }));
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

// Module guard — enforces API path whitelist for module tokens
app.use(moduleGuard);

// Rate limiting for API endpoints
app.use('/api/auth', rateLimit(60, 60_000));
app.use('/api/ai', rateLimit(30, 60_000));
app.use('/api/chat', rateLimit(20, 60_000));
app.use('/api/consultant', rateLimit(20, 60_000));
app.use('/api/analytics', rateLimit(60, 60_000));

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

// Discover articles (public reads + admin writes)
app.use('/api/discover', discoverRouter);

// Topics (public reads + admin writes)
app.use('/api/discover/topics', topicsRouter);

// Analytics (public pageview + admin stats)
app.use('/api/analytics', analyticsRouter);

// Ad slots (public reads + admin management)
app.use('/api/ad-slots', adSlotsRouter);

// File upload (admin only)
app.use('/api/upload', uploadRouter);

// Static uploads
app.use('/uploads', express.static(path.resolve(process.cwd(), 'data/uploads')));

// Production: serve compiled frontend (SSG writes directly into client/dist/)
const clientDistPath = path.resolve(process.cwd(), '../client/dist');
if (fs.existsSync(clientDistPath)) {
  // Hashed assets — long cache
  app.use('/assets', express.static(path.join(clientDistPath, 'assets'), { maxAge: '30d', immutable: true }));
  // Other static files — short cache
  app.use(express.static(clientDistPath, { maxAge: '1h', index: false }));

  // SPA fallback: serve index.html for all non-API/non-static routes
  // After SSG generation, index.html already contains SEO + homepage content.
  // Sub-pages like /fish have their own /fish/index.html served by express.static above.
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/uploads/')) return next();

    // Check if sub-page has its own index.html (generated by SSG)
    const pagePath = req.path.replace(/^\//, '').replace(/\/$/, '');
    if (pagePath) {
      const subPageFile = path.join(clientDistPath, pagePath, 'index.html');
      if (fs.existsSync(subPageFile)) {
        res.setHeader('Content-Type', 'text/html');
        res.send(fs.readFileSync(subPageFile, 'utf-8'));
        return;
      }
    }

    // Fallback to root index.html
    const htmlPath = path.join(clientDistPath, 'index.html');
    res.setHeader('Content-Type', 'text/html');
    res.send(fs.readFileSync(htmlPath, 'utf-8'));
  });
}

// Global error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[mmPla] Unhandled error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// Initialize — JWT secret validation
if (process.env.NODE_ENV === 'production') {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'mmPla-dev-secret-change-in-production') {
    console.error('[mmPla] FATAL: JWT_SECRET is not set or uses the insecure default. Set a strong random value in .env for production.');
    process.exit(1);
  }
} else {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'mmPla-dev-secret-change-in-production') {
    console.warn('[mmPla] ⚠️⚠️⚠️  WARNING: JWT_SECRET is not configured or uses the insecure default. This is acceptable in development but MUST be changed for production. ⚠️⚠️⚠️');
  }
}

initDatabase();
initWorkspace();
ensureAdminUser();
startLogCleanupScheduler();
cleanupOldLogs();

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
