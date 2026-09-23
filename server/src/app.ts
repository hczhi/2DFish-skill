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
import { scopeGuard } from './auth/scopeGuard.js';
import { rateLimit } from './auth/rateLimit.js';
import { authRouter } from './api/auth.js';
import { aiRouter } from './api/ai.js';
import { logsRouter } from './api/logs.js';
import { chatRouter } from './api/chat.js';
import { filesRouter } from './api/files.js';
import { skillsRouter } from './api/skills.js';
import { consultantRouter } from './api/consultant.js';
import { consultRouter } from './api/consult.js';
import { consultFrameAncestors } from './services/consult/sdkLimits.js';
import { pptFrameAncestors } from './services/ppt/sdkLimits.js';
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
import { uploadRouter, uploadsRoot } from './api/upload.js';
import { uiReviewRouter, seedUiReviewDefaults } from './api/uiReview.js';
import { tenderRouter } from './api/tender.js';
import { xhsRouter } from './api/xhs.js';
import { pptRouter } from './api/ppt.js';
import { feishuAssistantRouter } from './api/feishuAssistant.js';
import { agentSkillsRouter } from './api/agentSkills.js';
import { skillRegistryRouter } from './api/skillRegistry.js';
import { relayRouter } from './api/relay.js';
import { initWorkspace } from './services/workspaceService.js';
import { startLogCleanupScheduler, cleanupOldLogs } from './services/logCleanupService.js';
import { expireOverdueTenders, startTenderExpiryScheduler } from './services/tender/retention.js';
import {
  startAllConnections,
  startConnectionWatchdog,
  stopAllConnections,
} from './services/feishuAssistant/connection.js';
import { reapZombieCommands } from './services/feishuAssistant/commandLog.js';
import { reapZombieJobs } from './core/jobs.js';
import { verifyEncryptionKey } from './core/secrets.js';
import { failInterruptedReviews } from './services/uiReview/orchestrator.js';
import { reapInterruptedConsultRuns } from './services/consult/runStore.js';
import { reapInterruptedConsultBatches } from './services/consult/batchStore.js';
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
// 所以必须在全局 cors() 之前，专门为 SDK token 换取接口开一个口子。
// 真正的准入（这个 Origin 在不在这把 pk 的白名单里）在各模块的 POST 里做 ——
// 预检不带 pk，所以这里对预检统一回显 Origin；预检放行不等于换得到 token。
//
// **三个模块共用这一个中间件**：各写一遍的话，新模块最容易漏的就是这一段（业务代码里
// `applySdkCors` 全都写了，看起来是通的），而漏掉的后果是浏览器在**预检**那一步就
// 拦掉请求 —— 接入方页面上一块白、我们这边一条日志都没有（预检压根没进到路由），
// 换 token 的 POST 从来没发出去过。
//
// 只有换 token 这一下是跨域的 —— 之后工作台跑在我们自己的 iframe 里，它发的请求是同源的。
// 反过来说这一下**必须**由第三方页面自己发：让 iframe 里的页面去换的话，Origin 是我们
// 自己的域名，那道白名单对每个 pk 都成立。
const sdkTokenCors: express.RequestHandler = (req, res, next) => {
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
};
app.use('/api/tender/sdk/token', sdkTokenCors);   // 034
app.use('/api/consult/sdk/token', sdkTokenCors);  // 084
app.use('/api/ppt/sdk/token', sdkTokenCors);      // 100

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
const BASE_CSP = "default-src 'self'; script-src 'self' 'unsafe-inline' https://pagead2.googlesyndication.com https://www.googletagmanager.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https: blob:; connect-src 'self' https://pagead2.googlesyndication.com; frame-src 'self' https://googleads.g.doubleclick.net";
// frame-src 里的 `'self'` 是给 iframe 接入的示例页用的（`/sdk/consult-demo.html` 把
// `/consult/embed` 套在自己里面）。**`frame-src` 一旦显式写出来就不再回落到 default-src**，
// 少了 `'self'` 的后果是那个 iframe 被我们**自己的** CSP 拦掉：页面上一块白 + 控制台一行
// 警告，而 pk、白名单、frame-ancestors 全都是配对的，只会让人以为嵌入功能没做好。

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');

  // 品牌咨询的 iframe 嵌入（084）：只有 /consult* 这几条路径放行，而且只放行**启用中的
  // pk 配的那些域名**。两条都要说清楚：
  //
  // ① 这里必须**不发** `X-Frame-Options` —— 它只有 DENY / SAMEORIGIN 两个值可用
  //    （`ALLOW-FROM` 早就废弃，Chrome 从来没实现），留着 DENY 的话浏览器直接拦掉
  //    整个 frame，第三方页面上是一块白，而我们这边每个接口都返回 200。多域名只有
  //    CSP 的 frame-ancestors 做得到。
  // ② 名单为空（没有任何启用的 key）时**照旧 DENY**：这不是「顺便开着」的能力。
  //
  // 展示稿（100）走同一套，但**两份名单各算各的**（不取并集）：只接了咨询的伙伴不该顺带能把
  // 展示稿工作台套进自己页面，而合并之后两边后台看起来都只是各自配的那几个域名。
  const consultEmbeddable = req.path === '/consult' || req.path.startsWith('/consult/');
  const pptEmbeddable = req.path === '/ppt' || req.path.startsWith('/ppt/');
  const ancestors = consultEmbeddable
    ? consultFrameAncestors()
    : pptEmbeddable
      ? pptFrameAncestors()
      : [];
  // /ppt 版式案例库把版式 demo 套在**同源** iframe 里（每张卡一个缩略图 + 抽屉里一张大图）。
  // 上面那句 DENY 连同源 iframe 一起拦，而现象是卡片位置一块白 + 控制台一行 CSP/XFO 警告，
  // 接口自己是 200 —— 读起来像 demo 没生成出来。所以这一条路径单独放行。
  // 嵌入模式下这张卡是**套两层**的（伙伴页面 → 我们的 /ppt → demo.html），而 frame-ancestors
  // 要求**每一层祖先**都在名单里，所以这里得把伙伴域名也带上 —— 只写 'self' 的话第三方页面里
  // 版式那一格是一块白，而我们自己打开一切正常。
  const selfFrame = req.path === '/api/ppt/demo-deck.html';
  if (ancestors.length) {
    res.setHeader('Content-Security-Policy', `${BASE_CSP}; frame-ancestors ${ancestors.join(' ')}`);
  } else if (selfFrame) {
    const hosts = ["'self'", ...pptFrameAncestors()];
    // 有伙伴域名时不能再发 X-Frame-Options（它只有 DENY/SAMEORIGIN，会把跨域那层拦死）。
    if (hosts.length === 1) res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Content-Security-Policy', `${BASE_CSP}; frame-ancestors ${hosts.join(' ')}`);
  } else {
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', BASE_CSP);
  }
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
// 路径只有 uploadsRoot() 一份 —— 生图落盘那边读的是同一个函数（见 core/image/imageGateway.ts）。
app.use('/uploads', express.static(uploadsRoot()));

// Tender SDK bundle (public, CORS-open so any third-party page can <script src> it)
const sdkDistPath = path.resolve(process.cwd(), '../sdk/dist');
if (fs.existsSync(sdkDistPath)) {
  app.use('/sdk', (_req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    next();
  }, express.static(sdkDistPath, {
    maxAge: '1h',
    // UMD 产物的后缀是 `.cjs`，express.static 认不出来、回 application/octet-stream，
    // 而我们全局发着 `X-Content-Type-Options: nosniff` —— 浏览器于是**拒绝执行**它
    // （控制台一句 «not executable, and strict MIME type checking is enabled»，
    // 紧接着是 `ConsultSDK is not defined`）。这两条 `<script src>` 是所有接入方的第一步，
    // 而请求本身是 200，看起来像 SDK 没发出去。
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.cjs')) {
        res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
      }
    },
  }));
}

// Auth middleware — applied globally, determines public/optional/protected per route
app.use(authMiddleware);

// Module guard — enforces API path whitelist for module tokens
app.use(moduleGuard);

// Scope guard — 前端 SDK 短 token 的端点白名单，默认拒绝（见 auth/scopeGuard.ts：
// 这道闸门原来只挂在 tenderRouter 里，于是那把 token 在 /api/tender 之外畅通无阻）。
app.use(scopeGuard);

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

// 对外中转接口（OpenAI 兼容，非流式）。自带 key 校验，不走平台 JWT ——
// 见 api/relay.ts 与 auth/middleware.ts 里那条 public 规则。
app.use('/api/v1', relayRouter);

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
app.use('/api/admin/agent-skills', agentSkillsRouter);

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

// 品牌咨询工作台（四看/四问/四大成，一步一步聊出结论）
app.use('/api/consult', rateLimit(60, 60_000));
app.use('/api/consult', consultRouter);

// HTML 展示稿（版式案例库 + 整页生成）
// 限额给到 300：案例库那一页光缩略图就是 22 个 iframe（每个 iframe 一次
// `demo-deck.html?only=…`），60 的话翻两三次页就被 429 挡住 —— 而 iframe 里的 429 是一块
// 白，卡片上照样挂着「有效果 demo」，读起来像 demo 坏了。这条路径不花 AI 额度、只回仓库文件。
app.use('/api/ppt', rateLimit(300, 60_000));
app.use('/api/ppt', pptRouter);

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

  // 接入点配的模型关不掉思维链（见 core/llm/gateway.ts 的 NoThinkingUnsupportedError）。
  // 同样必须透原文：兜成 'Internal server error' 的话，管理员看到的是「某功能坏了」，
  // 而真正的出路（换一个能关思维链的模型）只在服务端日志里 —— 而这种失败每次都真扣一次额度。
  if (err.name === 'NoThinkingUnsupportedError') {
    res.status(502).json({ error: err.message, code: 'no_thinking_unsupported' });
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
  // 咨询那边的长任务（出草稿 / 出方向）同理。不收尸的话那一步永远显示「正在分析」，
  // 而 109 那条唯一索引还把它锁在「已经有一次在跑」—— 于是这一步彻底点不动，
  // 界面上一个错都不报。
  reapInterruptedConsultRuns();
  // 「一键生成整份报告」那条链（111）：驱动它的是内存里一个游离的 async 函数，进程一没
  // 它必然死了。不收尸的话那条唯一索引把项目永久锁在「已经有一批在跑」（这颗按钮从此一律
  // 409），而界面上写着「正在跑第 7 步」—— 剩下那几步永远不会跑，没有任何一处报错。
  // **不自动接着跑**：重启之后凭空花掉二十多次额度谁都没要求过（见那个函数的注释）。
  reapInterruptedConsultBatches();

  // 加密密钥换了的话，库里的第三方密钥全都解不开。放在启动时说清楚，
  // 否则线上只会表现成 AI/上传/飞书同步三处互不相干的失败。
  verifyEncryptionKey(getDatabase());

  // 飞书助理的两张表（去重表、指令日志）也由这个 cron 清，见 logCleanupService。
  // 以前去重表只在启动时清一次，而这个服务正常能连着跑几个月 ——
  // 「启动时清理」实际等于「永不清理」。
  startLogCleanupScheduler();
  cleanupOldLogs();

  // 标讯的时效闸门是读侧的，所以这一趟不影响任何人看到什么；它只是把「入库满
  // TENDER_VISIBLE_DAYS 天」这件事写进 status。启动时先补一趟：改窗口天数
  // （14 → 7）之后新落进窗口外的那一批，不补的话要等到明天 02:10 才从草稿库消失，
  // 而这期间它们照样可以被勾选去做 AI 提取 —— 提完就被闸门挡住，白花额度。
  startTenderExpiryScheduler();
  {
    const n = expireOverdueTenders();
    if (n > 0) console.log(`[tender] 启动巡检：自动作废 ${n} 条已过时效的标讯`);
  }

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
