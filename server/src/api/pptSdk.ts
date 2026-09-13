import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { getDatabase } from '../db/index.js';
import { getJwtSecret } from '../auth/middleware.js';
import {
  generatePk,
  normalizeOriginsInput,
  invalidOrigins,
  safeParseArray,
  originFormatError,
  limitOr,
  requestOrigin,
  originAllowed,
  checkExchangeRateLimit,
  applySdkCors,
} from '../core/sdkKeys.js';
import { pptSdkKeyUsage, invalidatePptFrameAncestors } from '../services/ppt/sdkLimits.js';

// ============================================================================
// HTML 展示稿对外接入（migration 100）—— 第三方**纯前端**页面用 iframe 嵌入 /ppt 工作台。
// 和 consult 那条（084）同一个 pk 模型、同一份 `core/sdkKeys.ts`：
//
//   pk（公开，写在第三方页面 JS 里）
//     ├─ 绑定 user_id          稿子归属 + AI/生图的钱记在这个平台账号上，前端改不了
//     └─ 绑定 allowed_origins  换 token 时校验 Origin（也是 iframe 的 frame-ancestors 名单）
//
//   POST /api/ppt/sdk/token   → scope=ppt:embed 的 15 分钟短 token
//     └─ 全局闸门（auth/scopeGuard.ts）只放行 /api/ppt 下工作台真要用的那几条
//
// **换 token 必须由第三方页面自己发**，不能由 iframe 里的页面发：iframe 里发出的请求
// Origin/Referer 是**我们自己的**域名，那道白名单于是对每个 pk 都成立，等于没配。
//
// **租户 = 一家公司 = 这把 pk**（101）。`external_uid` 签进 JWT 只为了记「这份稿子谁建的」，
// **不参与任何筛选** —— 同一把 pk 下的员工共用稿子列表和素材库（这是接入方明确要的）。
// 因此它压根不是安全边界，也别把它当展示隔离用：拿它当隔离的话接入方会以为换个 id 就换了
// 一个工作台，而两边看到的是同一列稿子。要把两家客户分开就发**两把 pk**。这句必须同时出现
// 在接入文档和后台那一页上。
// ============================================================================

export const PPT_SDK_SCOPE = 'ppt:embed';
export const PPT_PK_PREFIX = 'pk_ppt_';
const TOKEN_TTL_SECONDS = 15 * 60;

const MAX_EXTERNAL_UID_CHARS = 64;
const EXTERNAL_UID_RE = /^[A-Za-z0-9_.:@-]+$/;

/** 新 key 的缺省上限（100）。**不照抄 consult 的 50** —— 一份 12 页的稿子是 1 次规划 +
 *  12 次生成 + 每张图一次生图，50 在这条路上是「一份半稿子」，而接入方看到的只是
 *  「生成到第 8 页就一直失败」。 */
export const DEFAULT_PPT_DAILY_AI_LIMIT = 120;
export const DEFAULT_MAX_DECKS = 50;

interface PptSdkKeyRow {
  pk: string;
  user_id: string;
  name: string;
  allowed_origins: string;
  enabled: number;
  rate_limit: number;
}

/** 短 token 里那两个自定义 claim。业务侧只认这里的值，不认请求参数。 */
export interface PptSdkClaims {
  scope: string;
  pk: string;
  euid: string;
}

/** pk 换短 token。这条是 PUBLIC 的（校验全在 handler 里），所以必须登记在
 *  `auth/middleware.ts` 的 public 表里 —— 判成 protected 的话第三方页面收到的是一句
 *  «Authentication required»，而他手里那把 pk 和白名单都是对的。 */
export function registerPptSdkRoutes(router: Router): void {
  router.options('/sdk/token', (req, res) => {
    if (req.headers.origin) applySdkCors(res, req.headers.origin, 'POST, OPTIONS');
    res.status(204).end();
  });

  router.post('/sdk/token', (req: Request, res: Response) => {
    const pk = String(req.body?.pk || req.query.pk || '');
    if (!pk.startsWith(PPT_PK_PREFIX)) {
      return res.status(400).json({ error: 'Missing or invalid pk' });
    }

    // externalUid 必填，**不给缺省值**：兜一个空串的话每份稿子的「创建人」都是空，出了问题
    // 查不到是谁做的，而列表读起来完全正常。注意它**不是隔离键**（租户是这把 pk），所以
    // 这句报错里不能承诺隔离 —— 承诺了的话接入方会靠换 id 来分客户，而两边是同一个工作台。
    const externalUid = String(req.body?.externalUid || '').trim();
    if (!externalUid) {
      return res.status(400).json({
        error:
          'externalUid is required — it records which of your end users created a deck. Note it is NOT an isolation key: everyone under one pk shares the same deck list and asset library (that is the point). Use two pks to separate two customers.',
      });
    }
    if (externalUid.length > MAX_EXTERNAL_UID_CHARS || !EXTERNAL_UID_RE.test(externalUid)) {
      return res.status(400).json({
        error: `externalUid must be <= ${MAX_EXTERNAL_UID_CHARS} chars of [A-Za-z0-9_.:@-]`,
      });
    }

    const db = getDatabase();
    const row = db.prepare('SELECT * FROM ppt_sdk_keys WHERE pk = ?').get(pk) as
      | PptSdkKeyRow
      | undefined;
    if (!row || !row.enabled) {
      return res.status(401).json({ error: 'Invalid or disabled key' });
    }

    const origin = requestOrigin(req);
    if (!originAllowed(row.allowed_origins, origin)) {
      // 把收到的 Origin 回出去：最常见的错是配了 https 用了 http、或者配了带路径的整条 URL。
      // 只回一句「Origin not allowed」的话他核对的是自己配的那一行，而问题在浏览器实际发出来的这一行。
      return res.status(403).json({
        error: `Origin not allowed for this key (received: ${origin || 'none'})`,
      });
    }

    const nowMs = Date.now();
    if (!checkExchangeRateLimit(pk, row.rate_limit || 60, nowMs)) {
      return res.status(429).json({ error: 'Too many token requests, slow down' });
    }

    const user = db.prepare('SELECT id, username FROM user WHERE id = ?').get(row.user_id) as
      | { id: string; username: string }
      | undefined;
    if (!user) {
      return res.status(500).json({ error: 'Key is bound to a missing user' });
    }

    const claims: PptSdkClaims & { id: string; username: string; role: 'user' } = {
      id: user.id,
      username: user.username,
      role: 'user',
      scope: PPT_SDK_SCOPE,
      pk,
      euid: externalUid,
    };
    const token = jwt.sign(claims, getJwtSecret(), { expiresIn: TOKEN_TTL_SECONDS });

    db.prepare('UPDATE ppt_sdk_keys SET last_used_at = ? WHERE pk = ?')
      .run(new Date(nowMs).toISOString(), pk);

    if (req.headers.origin) applySdkCors(res, req.headers.origin, 'POST, OPTIONS');

    res.json({
      token,
      token_type: 'Bearer',
      expires_in: TOKEN_TTL_SECONDS,
      // 回显 externalUid：传错大小写 / 传了个字符串 "undefined" 时，稿子会静默落到另一个
      // 租户下，而界面上只是「我的稿子列表空了」。
      external_uid: externalUid,
    });
  });
}

/** 挂在 `/admin/*` 下，由 ppt.ts 里的 `pptRouter.use('/admin', requireAdmin)` 统一鉴权
 *  —— 调用本函数必须在挂上那道闸门之后。 */
export function registerPptSdkAdminRoutes(router: Router): void {
  router.get('/admin/sdk-keys', (_req, res) => {
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT k.pk, k.user_id, k.name, k.allowed_origins, k.enabled, k.rate_limit,
             k.daily_ai_limit, k.max_decks, k.created_at, k.last_used_at, u.username
      FROM ppt_sdk_keys k LEFT JOIN user u ON k.user_id = u.id
      ORDER BY k.created_at DESC
    `).all() as any[];
    res.json(rows.map((r) => ({
      ...r,
      allowed_origins: safeParseArray(r.allowed_origins),
      enabled: !!r.enabled,
      // 用量和上限一起回：只回上限的话，接入方被限额挡住时后台这一行看起来完全正常。
      ...pptSdkKeyUsage(r.pk),
    })));
  });

  router.post('/admin/sdk-keys', (req, res) => {
    const { userId, name, allowedOrigins, rateLimit, dailyAiLimit, maxDecks } = req.body || {};
    if (!userId) return res.status(400).json({ error: 'userId is required' });

    const db = getDatabase();
    if (!db.prepare('SELECT id FROM user WHERE id = ?').get(userId)) {
      return res.status(400).json({ error: 'user not found' });
    }

    // 白名单为空直接拒：空清单在 originAllowed 里是「谁都不放行」，接入方拿到的是一把
    // 怎么试都 403 的 key，而后台那一行看起来是建好了的。
    const origins = normalizeOriginsInput(allowedOrigins);
    if (!origins.length) {
      return res.status(400).json({
        error: '至少配一个 allowedOrigins（第三方页面的域名，如 https://example.com）—— 空白名单的 key 换不到 token，而后台看起来是建好的',
      });
    }
    const bad = invalidOrigins(origins);
    if (bad.length) return res.status(400).json({ error: originFormatError(bad) });

    const aiLimit = limitOr(dailyAiLimit, DEFAULT_PPT_DAILY_AI_LIMIT);
    const deckCap = limitOr(maxDecks, DEFAULT_MAX_DECKS);
    if (aiLimit === null || deckCap === null) {
      return res.status(400).json({ error: 'dailyAiLimit / maxDecks 必须是 >= 0 的整数' });
    }

    const pk = generatePk(PPT_PK_PREFIX);
    db.prepare(`
      INSERT INTO ppt_sdk_keys
        (pk, user_id, name, allowed_origins, enabled, rate_limit, daily_ai_limit, max_decks, created_at)
      VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)
    `).run(
      pk, userId, name || '', JSON.stringify(origins), Number(rateLimit) || 60,
      aiLimit, deckCap, new Date().toISOString()
    );

    // 新 key 的域名要立刻能嵌（frame-ancestors 有 30 秒缓存）—— 不刷的话接入方照着后台
    // 刚给的 pk 试出来是一块白屏，而每个接口都是 200。
    invalidatePptFrameAncestors();

    res.json({
      pk, user_id: userId, name: name || '', allowed_origins: origins, enabled: true,
      daily_ai_limit: aiLimit, max_decks: deckCap,
    });
  });

  router.patch('/admin/sdk-keys/:pk', (req, res) => {
    const db = getDatabase();
    if (!db.prepare('SELECT pk FROM ppt_sdk_keys WHERE pk = ?').get(req.params.pk)) {
      return res.status(404).json({ error: 'Not found' });
    }

    const { name, allowedOrigins, enabled, rateLimit, dailyAiLimit, maxDecks } = req.body || {};
    for (const [field, raw] of [['dailyAiLimit', dailyAiLimit], ['maxDecks', maxDecks]] as const) {
      if (raw === undefined) continue;
      const v = limitOr(raw, -1);
      if (v === null) return res.status(400).json({ error: `${field} 必须是 >= 0 的整数` });
      const col = field === 'dailyAiLimit' ? 'daily_ai_limit' : 'max_decks';
      db.prepare(`UPDATE ppt_sdk_keys SET ${col} = ? WHERE pk = ?`).run(v, req.params.pk);
    }
    if (name !== undefined) {
      db.prepare('UPDATE ppt_sdk_keys SET name = ? WHERE pk = ?').run(String(name), req.params.pk);
    }
    if (allowedOrigins !== undefined) {
      const origins = normalizeOriginsInput(allowedOrigins);
      if (!origins.length) {
        return res.status(400).json({ error: '白名单不能清空 —— 空清单的 key 换不到 token，要停用就用 enabled=false' });
      }
      const bad = invalidOrigins(origins);
      if (bad.length) return res.status(400).json({ error: originFormatError(bad) });
      db.prepare('UPDATE ppt_sdk_keys SET allowed_origins = ? WHERE pk = ?')
        .run(JSON.stringify(origins), req.params.pk);
    }
    if (enabled !== undefined) {
      db.prepare('UPDATE ppt_sdk_keys SET enabled = ? WHERE pk = ?').run(enabled ? 1 : 0, req.params.pk);
    }
    if (rateLimit !== undefined) {
      db.prepare('UPDATE ppt_sdk_keys SET rate_limit = ? WHERE pk = ?').run(Number(rateLimit) || 60, req.params.pk);
    }

    // 改了白名单/停用之后立刻生效（同上）。
    invalidatePptFrameAncestors();

    res.json({ success: true });
  });

  // 删 key **不删它名下的稿子**：那些稿子是接入方真花钱做出来的，跟着 key 一起 DELETE 的话
  // 管理员点一下「删除」就静默销毁了几十份稿子，而界面上只回一句「已删除」。没有入口能打开
  // 它们（归属键里的 pk 再也换不到 token），要清理得另外来。后台的确认框里要写这句。
  router.delete('/admin/sdk-keys/:pk', (req, res) => {
    const db = getDatabase();
    db.prepare('DELETE FROM ppt_sdk_keys WHERE pk = ?').run(req.params.pk);
    invalidatePptFrameAncestors();
    res.json({ success: true });
  });
}
