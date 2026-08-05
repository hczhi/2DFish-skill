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
import { uiReviewRouter, seedUiReviewDefaults } from './api/uiReview.js';
import { tenderRouter } from './api/tender.js';
import { xhsRouter } from './api/xhs.js';
import { feishuAssistantRouter } from './api/feishuAssistant.js';
import { skillRegistryRouter } from './api/skillRegistry.js';
import { initWorkspace } from './services/workspaceService.js';
import { startLogCleanupScheduler, cleanupOldLogs } from './services/logCleanupService.js';
import {
  startAllConnections,
  startConnectionWatchdog,
  stopAllConnections,
} from './services/feishuAssistant/connection.js';
import { reapZombieCommands } from './services/feishuAssistant/commandLog.js';
import { reapZombieJobs } from './core/jobs.js';
import { verifyEncryptionKey } from './core/secrets.js';
import { failInterruptedReviews } from './services/uiReview/orchestrator.js';
import { renderDynamicPageHtml } from './services/ssgService.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// 反代/CDN 后取真实客户端 IP。不设这项时 req.ip 恒为反代的内网地址，
// 会让 rateLimit 的 `user:${req.ip}` 退化成"所有匿名用户共用一个桶"
// （既误伤正常用户，也让攻击者能干扰他人登录），匿名主体指纹同样会失真。
// 值为 1 = 只信任最近一跳反代写入的 X-Forwarded-For；多层反代需相应调大。
app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS || 1));

// Gzip compression (skip SSE streams)
app.use(compression({
  filter: (req, res) => {
    if (req.headers.accept === 'text/event-stream') return false;
    if (req.headers['x-no-compression']) return false;
    const ct = res.getHeader('Content-Type');
    if (ct && String(ct).includes('text/event-stream')) return false;
    return compression.filter(req, res);
  }
}));

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

// SDK 跨域：第三方域名不在全局 CORS 白名单里，且全局 cors() 会短路 OPTIONS 预检，
// 所以必须在全局 cors() 之前，专门为 SDK token 换取接口开一个按 pk 白名单校验的口子。
// 校验哪个 Origin 允许放在 tenderSdk 里做（换取 token 时按 pk 白名单核对）；
// 这里对预检统一回显 Origin —— 预检不带 pk，真正的准入校验在 POST 时进行，
// 即使预检放行，Origin 不在某个 pk 白名单里的 POST 仍会被 403 拒绝。
app.use('/api/tender/sdk/token', (req, res, next) => {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Max-Age', '600');
  }
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
});

// SDK 数据接口（带 scope 短 token 的只读 GET）同样需要跨域放行。
// 注意：浏览器发的预检 OPTIONS 不带 Authorization 头，所以不能靠 Bearer 判断，
// 只要有 Origin 就回显 CORS 头。真正的准入靠 JWT 签名 + scope 白名单闸门（tenderSdkGuard）：
// 无有效 scope token 的跨域请求，即使 CORS 放行，业务层仍会 401/403 拒绝。
app.use('/api/tender', (req, res, next) => {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Max-Age', '600');
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
  }
  next();
});

app.use(cors({
  origin: corsOrigin,
  credentials: true,
}));
// Security headers
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline' https://pagead2.googlesyndication.com https://www.googletagmanager.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https: blob:; connect-src 'self' https://pagead2.googlesyndication.com; frame-src https://googleads.g.doubleclick.net");
  next();
});

app.use('/api/files', express.json({ limit: '5mb' }));
app.use('/api/discover', express.json({ limit: '2mb' }));
app.use(express.json({ limit: '512kb' }));

// Trailing slash redirect (SEO canonical)
app.use((req, res, next) => {
  if (req.path !== '/' && req.path.endsWith('/') && !req.path.startsWith('/api/')) {
    const clean = req.path.slice(0, -1);
    const query = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    res.redirect(301, clean + query);
    return;
  }
  next();
});

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

// Static uploads (public, before auth)
app.use('/uploads', express.static(path.resolve(process.cwd(), 'data/uploads')));

// Tender SDK bundle (public, CORS-open so any third-party page can <script src> it)
const sdkDistPath = path.resolve(process.cwd(), '../sdk/dist');
if (fs.existsSync(sdkDistPath)) {
  app.use('/sdk', (_req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    next();
  }, express.static(sdkDistPath, { maxAge: '1h' }));
}

// Auth middleware — applied globally, determines public/optional/protected per route
app.use(authMiddleware);

// Module guard — enforces API path whitelist for module tokens
app.use(moduleGuard);

// Rate limiting for API endpoints
app.use('/api/auth/login', rateLimit(5, 60_000));
app.use('/api/auth/register', rateLimit(3, 60_000));
app.use('/api/auth', rateLimit(30, 60_000));
app.use('/api/ai', rateLimit(30, 60_000));
app.use('/api/chat', rateLimit(20, 60_000));
app.use('/api/consultant', rateLimit(20, 60_000));
app.use('/api/analytics', rateLimit(30, 60_000));

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
app.use('/api/admin/skill-registry', skillRegistryRouter);

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

// UI Review
app.use('/api/ui-review', rateLimit(60, 60_000));
app.use('/api/ui-review', uiReviewRouter);

// Tender (bid recommendation)
app.use('/api/tender', rateLimit(60, 60_000));
app.use('/api/tender', tenderRouter);

// XHS (小红书爆款诊断 + AI 陪写)
app.use('/api/xhs', rateLimit(60, 60_000));
app.use('/api/xhs', xhsRouter);

// 飞书助理（在飞书里 @ 机器人下达自然语言指令）。
// 只有管理接口，事件走长连接进来，没有对外的回调端点。
app.use('/api/feishu-assistant', rateLimit(60, 60_000));
app.use('/api/feishu-assistant', feishuAssistantRouter);

// File upload (admin only)
app.use('/api/upload', uploadRouter);

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

    // Dynamic SSR for article/topic pages without pre-generated SSG files
    const dynamicHtml = renderDynamicPageHtml(req.path);
    if (dynamicHtml) {
      res.setHeader('Content-Type', 'text/html');
      res.send(dynamicHtml);
      return;
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

  // 专属 AI 渠道配置不全（缺档/缺生图）。这条必须把原文透出去：
  // 兜成 'Internal server error' 的话，管理员看到的只是"某功能报错"，
  // 而真正的原因（某个 tier 没配）藏在服务端日志里——正是这类配置错误最难查的地方。
  if (err.name === 'DedicatedChannelError') {
    res.status(503).json({ error: err.message, code: 'dedicated_channel_incomplete' });
    return;
  }

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

// 测试模式下只组装 app（供 supertest 直接调用），不占端口、不起定时任务、
// 不做工作区/种子数据初始化——否则每个测试文件都会互相抢端口和 cron。
const IS_TEST = process.env.NODE_ENV === 'test';

initDatabase();

if (!IS_TEST) {
  initWorkspace();
  ensureAdminUser();
  seedUiReviewDefaults();

  // 上一次运行遗留的 running 任务在本进程里已经不存在了（长任务全靠内存中的
  // async 函数驱动，进程一没就必然死了）。不收尸的话它们会永远占着
  // 「已有任务在运行中」的互斥判断，把爬取/评分入口永久锁在 409。
  reapZombieJobs();
  failInterruptedReviews();
  // 飞书指令同理：它们靠内存里那个游离的 execute() promise 驱动，进程一没就死了。
  // 不收尸的话日志里会永远留着一行 `running`，看起来像还在办 ——
  // 而排障表里最难受的一格就是"状态一直 running"。
  reapZombieCommands();

  // 加密密钥换了的话，库里的第三方密钥全都解不开。放在启动时说清楚，
  // 否则线上只会表现成 AI/上传/飞书同步三处互不相干的失败。
  verifyEncryptionKey(getDatabase());

  // 飞书助理的两张表（去重表、指令日志）也由这个 cron 清，见 logCleanupService。
  // 以前去重表只在启动时清一次，而这个服务正常能连着跑几个月 ——
  // 「启动时清理」实际等于「永不清理」。
  startLogCleanupScheduler();
  cleanupOldLogs();

  // 飞书助理的长连接。是我们主动连出去的，所以不占端口、不需要公网回调地址。
  // 失败只记日志：某个应用凭证过期不该拖住整个服务启动。
  startAllConnections().catch((e) => {
    console.error('[feishu] 建立长连接时出错:', e instanceof Error ? e.message : e);
  });

  // 定期巡检长连接。SDK 的自动重连是**有次数上限**的，网断久一点就彻底躺平，
  // 而进程还活着 —— 现象是所有人 @ 机器人都没反应且指令日志里空空如也，
  // 只能靠有人想到去后台点「重连」或重启服务。见 connection.ts 的 sweepConnections。
  startConnectionWatchdog();

  const server = app.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`[mmPla] Server running on http://localhost:${PORT}`);
  });

  // Graceful shutdown
  const shutdown = () => {
    console.log('[mmPla] Shutting down gracefully...');
    // 先断飞书长连接：不断的话飞书那边要等超时才认定我们下线，
    // 这段时间内推来的事件会丢（长连接是竞争消费，没有别的实例接手）。
    void stopAllConnections();
    server.close(() => {
      try { getDatabase().close(); } catch { /* already closed */ }
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 5000);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

// supertest 用：import { app } from '../app.js'
export { app };

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
