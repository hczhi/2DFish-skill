// HTML 展示稿（/ppt）。这一层薄：校验 → service → 响应。
import { Router, Request, Response } from 'express';
import { layouts, layoutById, library } from '../services/ppt/layoutLibrary.js';
import { demoDeck, demoIds, DemoNotFoundError } from '../services/ppt/demoDeck.js';
import { planDeck, PlanError } from '../services/ppt/planService.js';
import { generatePage, buildDeck, PageError } from '../services/ppt/pageService.js';
import { fillPageImages, PptImageError } from '../services/ppt/imageService.js';
import { exportDeck, ExportError } from '../services/ppt/exportService.js';
import { styles, defaultStyleId, deckColors } from '../services/ppt/styleLibrary.js';

export const pptRouter = Router();

/**
 * 版式效果 demo。整份 deck，`?only=L7` 只出那一页（版式库的卡片缩略图和抽屉都 iframe 它）。
 *
 * 三件事是承重的，少一件页面上就是一块白而接口全是 200：
 * ① 它在 `auth/middleware.ts` 里登记成 **public** —— `<iframe src>` 带不了 Authorization 头，
 *    而 `/api/` 下默认是 protected，于是 iframe 里显示的是一句 `Authentication required`。
 * ② `app.ts` 对这条路径单独发 `X-Frame-Options: SAMEORIGIN` —— 全局那句 DENY 连同源
 *    iframe 一起拦。
 * ③ `no-store`：改完 demo 片段重启服务后要立刻看到，缓存住的话「我改了怎么没变」查不出成因。
 */
pptRouter.get('/demo-deck.html', (req: Request, res: Response) => {
  const only = typeof req.query.only === 'string' ? req.query.only : undefined;
  try {
    const html = demoDeck(only);
    res.setHeader('Cache-Control', 'no-store');
    res.type('html').send(html);
  } catch (e: any) {
    // 错误也要能在 iframe 里读出来（那是唯一看得见的地方），所以回纯文本原文，
    // 不回 JSON —— `{"error":…}` 在 iframe 里就是一行花括号。
    const code = e instanceof DemoNotFoundError ? 404 : 500;
    res.status(code).type('text/plain; charset=utf-8').send(
      `版式 demo 出不来：${e?.message || e}\n\n现有片段：${demoSafeIds()}`
    );
  }
});

function demoSafeIds(): string {
  try {
    return demoIds().join(' / ') || '(空)';
  } catch {
    return '(读不到 demo-slides.html)';
  }
}

/**
 * 版式案例库列表。**不带 buildText**（12 份详情 md 加起来近 2000 行，
 * 列表页一个也用不上），要看完整骨架走 `GET /layouts/:id`。
 */
pptRouter.get('/layouts', (_req: Request, res: Response) => {
  const list = layouts().map(({ buildText, ...rest }) => ({ ...rest, buildLines: buildText.split('\n').length }));
  res.json({ layouts: list, total: list.length });
});

pptRouter.get('/layouts/:id', (req: Request, res: Response) => {
  const layout = layoutById(req.params.id);
  if (!layout) {
    res.status(404).json({ error: `没有版式 ${req.params.id}` });
    return;
  }
  res.json({ layout });
});

/**
 * 配图画风库（S-A ~ S-F）。前端那个下拉照它渲染 —— 写死一份清单的话，md 里改了/加了
 * 一套画风之后界面上完全看不见，而选中的那几套照旧能用（读起来像「就这几种」）。
 */
pptRouter.get('/styles', (_req: Request, res: Response) => {
  res.json({
    styles: styles().map(({ templates, ...rest }) => rest),
    defaultStyleId: defaultStyleId(),
    /** 图的配色跟着 deck 的 :root 走，界面上要能看到是哪几个色值 */
    colors: deckColors(),
  });
});

/**
 * 排版规划：一份提纲 → 每页挑一个版式（不生成 HTML）。
 *
 * 失败一律往外抛成 4xx/5xx 带原文，不回 `{pages:[]}`：空规划在界面上和
 * 「这份提纲拆不出页」分不开，而真实成因（额度打满 / 截断 / 模型没按 JSON 回）
 * 三种解法完全不同。
 */
pptRouter.post('/plan', async (req: Request, res: Response) => {
  const userId = (req as any).user?.id as string | undefined;
  if (!userId) {
    res.status(401).json({ error: '请先登录' });
    return;
  }
  const outline = typeof req.body?.outline === 'string' ? req.body.outline : '';
  try {
    const result = await planDeck(outline, userId);
    res.json(result);
  } catch (e: any) {
    const code = e instanceof PlanError ? 400 : 500;
    res.status(code).json({ error: e?.message || '排版规划失败' });
  }
});

/**
 * 生成一页 HTML。入参就是规划结果里的那一行（前端原样回传）。
 *
 * 返回带 `previewHtml`（套好 deck 外壳的单页）：预览和最终 deck 共用 `deckShell` 那一份
 * 拼装，前端自己拼一遍的话「预览里好看、真 deck 里换了骨架」两边都不报错。
 */
pptRouter.post('/pages', async (req: Request, res: Response) => {
  const userId = (req as any).user?.id as string | undefined;
  if (!userId) {
    res.status(401).json({ error: '请先登录' });
    return;
  }
  const b = req.body || {};
  try {
    const result = await generatePage(
      {
        page: Number(b.page) || 1,
        total: Number(b.total) || 1,
        section: String(b.section || ''),
        title: String(b.title || ''),
        points: Array.isArray(b.points) ? b.points.map((p: any) => String(p)) : [],
        layoutId: String(b.layoutId || ''),
        images: Number(b.images) || 0,
        brandCn: b.brandCn ? String(b.brandCn) : undefined,
        brandEn: b.brandEn ? String(b.brandEn) : undefined,
        topic: b.topic ? String(b.topic) : undefined,
      },
      userId
    );
    res.json(result);
  } catch (e: any) {
    const code = e instanceof PageError ? 400 : 500;
    res.status(code).json({ error: e?.message || '这一页生成失败' });
  }
});

/**
 * 给一页真的配图：按每个图元素的 `data-img-prompt` 逐张生图，把占位图换成转存后的地址。
 *
 * 返回换好图的 `html` + `previewHtml`（同一份 `deckShell`），前端必须用它**覆盖**那一页
 * 存着的 html —— 不覆盖的话拼整份时用的还是占位图那一版，而预览里刚刚明明看到图了。
 * 部分成功是常态（一张失败别的照样贴上去），所以逐张回 `images`，失败的那几格保留占位图。
 */
pptRouter.post('/images', async (req: Request, res: Response) => {
  const userId = (req as any).user?.id as string | undefined;
  if (!userId) {
    res.status(401).json({ error: '请先登录' });
    return;
  }
  const b = req.body || {};
  const html = typeof b.html === 'string' ? b.html : '';
  if (!html.includes('<section')) {
    res.status(400).json({ error: '没有收到这一页的 HTML（先生成这一页，再生成它的图）。' });
    return;
  }
  try {
    const result = await fillPageImages(html, {
      userId,
      title: String(b.title || ''),
      section: b.section ? String(b.section) : undefined,
      topic: b.topic ? String(b.topic) : undefined,
      force: !!b.force,
      styleId: b.styleId ? String(b.styleId) : undefined,
      meta: {
        brandCn: b.brandCn ? String(b.brandCn) : '示例企业',
        brandEn: b.brandEn ? String(b.brandEn) : 'SAMPLE',
        topic: b.topic ? String(b.topic) : String(b.title || ''),
      },
    });
    res.json(result);
  } catch (e: any) {
    // 专属渠道缺 kind=image 那一档是 503（配置问题），不是 500 —— 合成 500 的话
    // 用户只会以为服务坏了，而真实解法是去后台补一条接入点。
    const code = e instanceof PptImageError ? 400 : e?.name === 'DedicatedChannelError' ? 503 : 500;
    res.status(code).json({ error: e?.message || '生图失败' });
  }
});

/**
 * 把已生成的那几页拼成整份 deck（不调 AI）。前端把每页的 `html` 原样传回来。
 *
 * 拼装只在服务端做（`deckShell` 那一份）：前端自己拼一遍的话「整份预览里好看、
 * 真 deck 里换了骨架」两边都不报错。缺页时 400 并点名 —— 见 `buildDeck`。
 */
pptRouter.post('/deck', (req: Request, res: Response) => {
  const b = req.body || {};
  const rows = Array.isArray(b.pages) ? b.pages : [];
  try {
    const html = buildDeck(
      rows.map((p: any) => ({ page: Number(p?.page) || 0, html: String(p?.html || '') })),
      Number(b.total) || 0,
      {
        brandCn: b.brandCn ? String(b.brandCn) : '示例企业',
        brandEn: b.brandEn ? String(b.brandEn) : 'SAMPLE',
        topic: b.topic ? String(b.topic) : '',
      }
    );
    res.json({ html, pages: Number(b.total) || 0 });
  } catch (e: any) {
    const code = e instanceof PageError ? 400 : 500;
    res.status(code).json({ error: e?.message || '整份 deck 拼不出来' });
  }
});

/**
 * 导出整份 deck 成一个 .html 文件（不调 AI）。回 JSON 而不是直接下载：这份文件依赖
 * 什么（占位图没换 / 图在本机磁盘 / 字体走 CDN）必须能显示在界面上 —— 直接回 attachment
 * 的话那几句话没地方说，而用户拿到的是一份「打开一片正常、图全是破的」文件。
 *
 * `baseUrl` 由前端传 `location.origin`（图的相对地址要按它改成绝对地址）：服务端按
 * `req.protocol` 算的话，反代后面拿到的是 http 而用户访问的是 https —— 混合内容会被
 * 浏览器拦掉，而那几格看起来就是「没配图」。
 */
pptRouter.post('/export', (req: Request, res: Response) => {
  const b = req.body || {};
  const rows = Array.isArray(b.pages) ? b.pages : [];
  const baseUrl = String(b.baseUrl || '').trim() || `${req.protocol}://${req.get('host')}`;
  try {
    const result = exportDeck(
      rows.map((p: any) => ({ page: Number(p?.page) || 0, html: String(p?.html || '') })),
      Number(b.total) || 0,
      {
        brandCn: b.brandCn ? String(b.brandCn) : '示例企业',
        brandEn: b.brandEn ? String(b.brandEn) : 'SAMPLE',
        topic: b.topic ? String(b.topic) : '',
      },
      baseUrl
    );
    res.json(result);
  } catch (e: any) {
    const code = e instanceof ExportError || e instanceof PageError ? 400 : 500;
    res.status(code).json({ error: e?.message || '导出失败' });
  }
});

/** deck 级共享资料（:root 变量 + 通用组件 CSS、配色 token、配图风格）。 */
pptRouter.get('/library/assets', (_req: Request, res: Response) => {
  const lib = library();
  res.json({
    template: lib.template,
    design_tokens: lib.designTokens,
    illustration_style: lib.illustrationStyle,
  });
});
