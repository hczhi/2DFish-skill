import type { Request, Response, NextFunction } from 'express';
import { getDatabase } from '../../db/index.js';

// 每把 ppt pk 自己的天花板（migration 100）。对照 `services/consult/sdkLimits.ts`（同一套口径：
// 停用即失效 / 按 pk 计日额度 / 总数上限），差别只有一处 —— **这里一个请求可能打好几次模型**
// （一页几张图就是几次生图，而生图是真金），所以中间件那 1 次之外还要按张补扣。
//
// 挂在 pptRouter 上，只对**带 pk 的短 token**生效；网页登录的用户完全不经过这里。

/** 花钱的端点（路径是 pptRouter 内部的相对路径，挂载点 /api/ppt 不算）。
 *
 *  **新增会调 AI / 生图的 ppt 端点必须加进来。** 漏一条 = 那条路对第三方**不限量**：绑定账号
 *  走平台渠道时还有 10 次/天兜着，但开了专属渠道的账号绕过 ai_quota，那就是拿他自己那把 key
 *  无上限地烧真钱（生图尤其贵），而每次返回的都是一页正常的幻灯片，后台看不出异常。
 *
 *  纯代码的那些**不在**表里（改文字/改样式/删节点/画布/蒙版/拼整份/导出/插页删页）——
 *  把它们算进来的话接入方点几下排版就把当天的额度耗光，而他一次模型都没调。
 */
const AI_SPEND_ROUTES: Array<{ methods: string[]; path: RegExp }> = [
  // 「生成提纲」的对话：不带 deck id（发生在建稿之前），但**每一轮都是一次真实调用** ——
  // 漏在这张表外面的话它是这几条路里最容易被连着点的一条（聊天）。
  { methods: ['POST'], path: /^\/outline-chat$/ },
  // 「生成提纲」页的上传资料。`/extract-file` **也算一条**（和 consult 那张表不同）：
  // 传图片时它是一次真实的视觉调用，不列的话第三方能无上限地拿他自己那把 key 刷 OCR，
  // 而每次返回的都是一份正常的提取结果。代价是传 txt/pptx（纯程序解析、不调 AI）也记 1 次 ——
  // 故意的：中间件跑在解析 body 之前，那时候压根不知道这次传的是图还是文档。
  // `/tidy-text` 长文件会分几段，差额由 `chargeExtraPptSdkAiCalls` 补。
  { methods: ['POST'], path: /^\/extract-file$/ },
  { methods: ['POST'], path: /^\/tidy-text$/ },
  { methods: ['POST'], path: /^\/decks\/[^/]+\/clean-outline$/ },
  { methods: ['POST'], path: /^\/decks\/[^/]+\/plan$/ },
  { methods: ['POST'], path: /^\/decks\/[^/]+\/pages$/ },
  { methods: ['POST'], path: /^\/decks\/[^/]+\/replan-images$/ },
  { methods: ['POST'], path: /^\/decks\/[^/]+\/prepare-images$/ },
  { methods: ['POST'], path: /^\/decks\/[^/]+\/ai-edit$/ },
  { methods: ['POST'], path: /^\/decks\/[^/]+\/ai-remake$/ },
  // 一次可能生好几张图 —— 基数 1 在这里扣，差额由 `chargeExtraPptSdkAiCalls` 补。
  { methods: ['POST'], path: /^\/decks\/[^/]+\/images$/ },
];

export function isPptAiSpendRoute(method: string, path: string): boolean {
  const m = method.toUpperCase();
  return AI_SPEND_ROUTES.some((r) => r.methods.includes(m) && r.path.test(path));
}

interface KeyRow {
  pk: string;
  name: string;
  enabled: number;
  daily_ai_limit: number;
  max_decks: number;
  ai_used_today: number;
  ai_used_date: string | null;
}

function usedToday(row: KeyRow, today: string): number {
  return row.ai_used_date === today ? row.ai_used_today : 0;
}

export function pptSdkLimits(req: Request, res: Response, next: NextFunction): void {
  const pk = req.sdkPk;
  if (!pk) return next(); // 网页登录的用户不受这里管

  const db = getDatabase();
  const row = db
    .prepare(
      `SELECT pk, name, enabled, daily_ai_limit, max_decks, ai_used_today, ai_used_date
         FROM ppt_sdk_keys WHERE pk = ?`
    )
    .get(pk) as KeyRow | undefined;

  // 短 token 活 15 分钟，所以「停用/删掉 key」必须在这里也判一次 —— 只在换 token 那一步判的话，
  // 管理员点了停用之后那个第三方页面还能正常用一刻钟（他会以为已经关掉了）。
  if (!row || !row.enabled) {
    res.status(403).json({ error: '接口已关闭，请联系管理员', code: 'sdk_key_disabled' });
    return;
  }

  const today = new Date().toISOString().split('T')[0];

  // 稿子总数上限：pk 是公开字符串，不封顶的话白名单域名内一个循环就能建出几万份稿子
  // （每份都是一次正常的 200）。
  if (req.method === 'POST' && req.path === '/decks') {
    const { c } = db
      .prepare('SELECT COUNT(*) AS c FROM ppt_decks WHERE sdk_pk = ?')
      .get(pk) as { c: number };
    if (c >= row.max_decks) {
      res.status(429).json({
        error:
          `这个接入方（${row.name || pk}）的演示稿数量已经到上限：${c}/${row.max_decks}。` +
          '删掉不用的稿子，或者联系管理员调高这把 key 的上限。',
        code: 'sdk_deck_cap',
        used: c,
        limit: row.max_decks,
      });
      return;
    }
  }

  if (!isPptAiSpendRoute(req.method, req.path)) return next();

  const used = usedToday(row, today);
  if (used >= row.daily_ai_limit) {
    res.status(429).json({
      error:
        `这个接入方（${row.name || pk}）今天的 AI 调用已经用完：${used}/${row.daily_ai_limit} 次，` +
        '服务器时间 0 点重置。要现在继续，请联系管理员调高这把 key 的每日上限。',
      code: 'sdk_ai_quota',
      used,
      limit: row.daily_ai_limit,
    });
    return;
  }

  // 先扣再放行：等模型返回了再扣的话，同时打进来的一批请求全部读到同一个 used，上限形同不存在
  // （而每一条都返回正常结果）。代价是失败的那次也算 —— 那次的钱确实花了。
  db.prepare('UPDATE ppt_sdk_keys SET ai_used_today = ?, ai_used_date = ? WHERE pk = ?').run(
    used + 1,
    today,
    pk
  );
  next();
}

/**
 * 一个请求实际生了不止一张图时，把差额补扣上（「补齐这一页的图」一次最多 4 张）。
 *
 * 中间件是**每个请求扣 1** 的 —— 它跑在知道这一页有几个图槽之前。不补的话生图那条路对第三方
 * 相当于打了 N 折，而后台显示的用量是一个完全正常的数字（生图是按张付的真钱，不是文本调用）。
 * 只加不减，也不在这里拦（这几张已经花掉了，拦下来只是让他看不到结果）。
 */
export function chargeExtraPptSdkAiCalls(pk: string, extra: number): void {
  if (!(extra > 0)) return;
  const today = new Date().toISOString().split('T')[0];
  const db = getDatabase();
  // 当天第一次就多张的情况：ai_used_date 可能还是昨天，所以按日期归零后再加。
  db.prepare(
    `UPDATE ppt_sdk_keys
        SET ai_used_today = CASE WHEN ai_used_date = ? THEN ai_used_today + ? ELSE ? END,
            ai_used_date = ?
      WHERE pk = ?`
  ).run(today, extra, extra, today, pk);
}

// ==================== iframe 宿主名单 ====================

let ancestorsCache: { at: number; list: string[] } | null = null;
const ANCESTORS_TTL_MS = 30_000;

/**
 * 允许把 /ppt 嵌进 iframe 的宿主域名 = **所有启用中的 ppt pk 的域名白名单之和**。
 *
 * 为什么不按 pk 逐次算、为什么空名单不放行、为什么缓存 30 秒：和 consult 那份逐字同理
 * （见 `services/consult/sdkLimits.ts:consultFrameAncestors`）—— 只有 iframe 那第一个文档
 * 请求带得上 pk，用户手动刷新那一下不带，按 pk 算的话刷新之后浏览器直接拦掉整个 frame，
 * 屏幕上是一块白、控制台里才有一行 CSP 警告。
 *
 * 和 consult 那份**各自一份名单**（不合并）：合并的话只接了咨询的伙伴顺带能把展示稿工作台
 * 套进自己页面，而两边后台看起来都是各自配的那几个域名。
 */
export function pptFrameAncestors(): string[] {
  const now = Date.now();
  if (ancestorsCache && now - ancestorsCache.at < ANCESTORS_TTL_MS) return ancestorsCache.list;
  let list: string[] = [];
  try {
    const rows = getDatabase()
      .prepare('SELECT allowed_origins FROM ppt_sdk_keys WHERE enabled = 1')
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
export function invalidatePptFrameAncestors(): void {
  ancestorsCache = null;
}

/** 后台列表用：这把 key 今天用了多少、名下有多少份稿子。
 *
 *  用量按日期归零（和 ai_quota 一个写法）：直接读 `ai_used_today` 的话，昨天打满的那把 key
 *  今天在后台显示的还是 120/120，管理员会去调高一个压根没满的上限。 */
export function pptSdkKeyUsage(pk: string): { ai_used_today: number; decks: number } {
  const db = getDatabase();
  const row = db
    .prepare('SELECT ai_used_today, ai_used_date FROM ppt_sdk_keys WHERE pk = ?')
    .get(pk) as { ai_used_today: number; ai_used_date: string | null } | undefined;
  const today = new Date().toISOString().split('T')[0];
  const { c } = db
    .prepare('SELECT COUNT(*) AS c FROM ppt_decks WHERE sdk_pk = ?')
    .get(pk) as { c: number };
  return {
    ai_used_today: row && row.ai_used_date === today ? row.ai_used_today : 0,
    decks: c,
  };
}
