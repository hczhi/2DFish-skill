import type { Request, Response, NextFunction } from 'express';
import { getDatabase } from '../../db/index.js';

// 每把 consult pk 自己的天花板（084/086）。挂在 consultRouter 上，只对**带 pk 的短 token**
// 生效，网页登录的用户完全不经过这里。
//
// 三件事：① key 被停用/删掉之后那把已经签出去的短 token 立刻失效；② 花钱的端点按 pk 计日额度；
// ③ 项目总数上限。三条都必须把**真实数字**写在回复里 —— 合成一句「操作失败」的话接入方会一路
// 重试（每次重试都可能是一次真实的模型调用），而他那边看到的和「你们系统坏了」没有区别。

/** 花钱的端点。**新增会调 AI（或联网检索）的 consult 端点必须加进来。**
 *
 * 漏加一条 = 那条路对第三方是**不限量**的：绑定账号走平台渠道时还有 10 次/天兜着，但开了
 * 专属渠道的账号绕过 ai_quota，那就是拿他自己那把 key 无上限地烧真钱，而每次返回的都是一份
 * 正常的草稿，后台看不出异常。`consultSdkLimits.test.ts` 逐条守着这张表。
 *
 * `/draft/discard`、`/intake/answers`、`/intake/apply` 都**不花钱**（纯落库），不在表里。
 */
const AI_SPEND_ROUTES: Array<{ methods: string[]; path: RegExp }> = [
  { methods: ['POST'], path: /^\/projects\/[^/]+\/stages\/[^/]+\/draft$/ },
  { methods: ['POST'], path: /^\/projects\/[^/]+\/stages\/[^/]+\/directions$/ },
  { methods: ['POST'], path: /^\/projects\/[^/]+\/stages\/[^/]+\/decisions$/ },
  { methods: ['POST'], path: /^\/projects\/[^/]+\/stages\/[^/]+\/chat$/ },
  { methods: ['POST'], path: /^\/projects\/[^/]+\/stages\/[^/]+\/search$/ },
  { methods: ['POST'], path: /^\/projects\/[^/]+\/intake$/ },
  // 上传资料的 AI 整理（`consult:embed` 放行了它，见 `auth/scopeGuard.ts`）。
  // 它不在 projects 子树下 —— 新建页还没有项目 id。`/extract-file` 不在这张表里是
  // 因为它纯程序解析、不调 AI。
  { methods: ['POST'], path: /^\/tidy-text$/ },
];

export function isAiSpendRoute(method: string, path: string): boolean {
  const m = method.toUpperCase();
  return AI_SPEND_ROUTES.some((r) => r.methods.includes(m) && r.path.test(path));
}

interface KeyRow {
  pk: string;
  name: string;
  enabled: number;
  daily_ai_limit: number;
  max_projects: number;
  ai_used_today: number;
  ai_used_date: string | null;
}

/** 今天已经用掉多少（读时按日期归零，和 ai_quota 一个写法：服务器半夜没在跑也不会漏掉重置）。 */
function usedToday(row: KeyRow, today: string): number {
  return row.ai_used_date === today ? row.ai_used_today : 0;
}

export function consultSdkLimits(req: Request, res: Response, next: NextFunction): void {
  const pk = req.sdkPk;
  if (!pk) return next(); // 网页登录的用户不受这里管

  const db = getDatabase();
  const row = db
    .prepare(
      `SELECT pk, name, enabled, daily_ai_limit, max_projects, ai_used_today, ai_used_date
         FROM consult_sdk_keys WHERE pk = ?`
    )
    .get(pk) as KeyRow | undefined;

  // 短 token 活 15 分钟，所以「停用/删掉 key」必须在这里也判一次 —— 只在换 token 那一步判的话，
  // 管理员点了停用之后那个第三方页面还能正常用一刻钟（他会以为已经关掉了）。
  if (!row || !row.enabled) {
    res.status(403).json({ error: '接口已关闭，请联系管理员', code: 'sdk_key_disabled' });
    return;
  }

  const today = new Date().toISOString().split('T')[0];

  // 项目总数上限：pk 是公开字符串，不封顶的话白名单域名内一个循环就能建出几万个项目
  // （每个项目都是一次正常的 200）。
  if (req.method === 'POST' && req.path === '/projects') {
    const { c } = db
      .prepare('SELECT COUNT(*) AS c FROM consult_projects WHERE sdk_pk = ?')
      .get(pk) as { c: number };
    if (c >= row.max_projects) {
      res.status(429).json({
        error:
          `这个接入方（${row.name || pk}）的项目数已经到上限：${c}/${row.max_projects}。` +
          `删掉不用的项目，或者联系管理员调高这把 key 的上限。`,
        code: 'sdk_project_cap',
        used: c,
        limit: row.max_projects,
      });
      return;
    }
  }

  if (!isAiSpendRoute(req.method, req.path)) return next();

  const used = usedToday(row, today);
  if (used >= row.daily_ai_limit) {
    res.status(429).json({
      error:
        `这个接入方（${row.name || pk}）今天的 AI 调用已经用完：${used}/${row.daily_ai_limit} 次，` +
        `服务器时间 0 点重置。要现在继续，请联系管理员调高这把 key 的每日上限。`,
      code: 'sdk_ai_quota',
      used,
      limit: row.daily_ai_limit,
    });
    return;
  }

  // 先扣再放行：等 AI 返回了再扣的话，同时打进来的一批请求全部读到同一个 used，
  // 上限形同不存在（而每一条都返回正常结果）。代价是模型失败也算一次 —— 和平台
  // ai_quota 的口径一致（那次调用的钱是真花了的）。
  db.prepare('UPDATE consult_sdk_keys SET ai_used_today = ?, ai_used_date = ? WHERE pk = ?').run(
    used + 1,
    today,
    pk
  );
  next();
}

/**
 * 一个请求实际打了不止一次模型时，把差额补扣上（`/tidy-text` 分段整理）。
 *
 * 中间件是**每个请求扣 1** 的 —— 它跑在解析 body 之前，不可能知道这次要分几段。
 * 不补的话那条路对第三方相当于打了 N 折，而后台显示的用量是一个完全正常的数字。
 * 只加不减，也不在这里拦（这几次钱已经花掉了，拦下来只是让他看不到结果）。
 */
export function chargeExtraSdkAiCalls(pk: string, extra: number): void {
  if (!(extra > 0)) return;
  const today = new Date().toISOString().split('T')[0];
  const db = getDatabase();
  // 当天第一次就分段的情况：ai_used_date 可能还是昨天，所以按日期归零后再加。
  db.prepare(
    `UPDATE consult_sdk_keys
        SET ai_used_today = CASE WHEN ai_used_date = ? THEN ai_used_today + ? ELSE ? END,
            ai_used_date = ?
      WHERE pk = ?`
  ).run(today, extra, extra, today, pk);
}

// ==================== iframe 宿主名单 ====================

let ancestorsCache: { at: number; list: string[] } | null = null;
const ANCESTORS_TTL_MS = 30_000;

/**
 * 允许把 /consult 嵌进 iframe 的宿主域名 = **所有启用中的 pk 的域名白名单之和**。
 *
 * 为什么不按 pk 逐次算：只有 iframe 那第一个文档请求带得上 pk，之后工作台在 SPA 里跳
 * （`/consult/projects/xxx`）不再有新的文档请求；用户手动刷新那一下也不带 pk。按 pk 算的话
 * 刷新之后浏览器直接拦掉整个 frame —— 屏幕上是一块白，控制台里才有一行 CSP 警告，
 * 而接入方只会说「你们的东西时好时坏」。
 *
 * 空名单（没有任何启用的 key）时**不放行**：那时候还挂着 `X-Frame-Options: DENY`。
 * 缓存 30 秒 —— 停用一把 key 之后最多半分钟内还能嵌，但那把 key 换不到 token 了
 * （`consultSdkLimits` 立刻拒），所以嵌进去也是一句「接口已关闭」，不是数据泄露。
 */
export function consultFrameAncestors(): string[] {
  const now = Date.now();
  if (ancestorsCache && now - ancestorsCache.at < ANCESTORS_TTL_MS) return ancestorsCache.list;
  let list: string[] = [];
  try {
    const rows = getDatabase()
      .prepare('SELECT allowed_origins FROM consult_sdk_keys WHERE enabled = 1')
      .all() as Array<{ allowed_origins: string }>;
    const set = new Set<string>();
    for (const r of rows) {
      try {
        const arr = JSON.parse(r.allowed_origins || '[]');
        if (Array.isArray(arr)) {
          for (const o of arr) {
            const s = String(o || '').trim();
            // CSP 里的源不能带空格/分号，否则整条指令被浏览器丢掉（连带 frame-ancestors
            // 失效 = 又变成白屏），所以宁可跳过可疑的那一条。
            if (s && !/[\s;,'"]/.test(s)) set.add(s);
          }
        }
      } catch {
        /* 存坏的那一行跳过 */
      }
    }
    list = [...set];
  } catch {
    list = []; // 库还没起来：按不放行处理
  }
  ancestorsCache = { at: now, list };
  return list;
}

/** 发/停用/删 key 之后立刻生效（不然要等 30 秒缓存过期，读起来像「配了没用」）。 */
export function invalidateFrameAncestors(): void {
  ancestorsCache = null;
}

/** 后台列表用：这把 key 今天用了多少、名下有多少项目。 */
export function sdkKeyUsage(pk: string): { ai_used_today: number; projects: number } {
  const db = getDatabase();
  const row = db
    .prepare('SELECT ai_used_today, ai_used_date FROM consult_sdk_keys WHERE pk = ?')
    .get(pk) as { ai_used_today: number; ai_used_date: string | null } | undefined;
  const today = new Date().toISOString().split('T')[0];
  const { c } = db
    .prepare('SELECT COUNT(*) AS c FROM consult_projects WHERE sdk_pk = ?')
    .get(pk) as { c: number };
  return {
    ai_used_today: row && row.ai_used_date === today ? row.ai_used_today : 0,
    projects: c,
  };
}
