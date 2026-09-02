import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { getDatabase } from '../db/index.js';
import { getJwtSecret } from '../auth/middleware.js';
import {
  generatePk,
  requestOrigin,
  originAllowed,
  normalizeOriginsInput,
  invalidOrigins,
  safeParseArray,
  checkExchangeRateLimit,
  applySdkCors,
} from '../core/sdkKeys.js';
import { sdkKeyUsage, invalidateFrameAncestors } from '../services/consult/sdkLimits.js';

// ============================================================================
// 品牌咨询对外接入（084）—— 第三方**纯前端**页面用 iframe 嵌入 /consult 工作台。
//
// 和 tender 那条 SDK（034）同一个 pk 模型，但 consult 的每个端点都是写、每次出草稿
// 都烧一次 strong 调用，所以边界必须说清楚：
//
//   pk（公开，写在第三方页面 JS 里）
//     ├─ 绑定 user_id        项目归属 + AI 额度记在这个平台账号上，前端改不了
//     └─ 绑定 allowed_origins  换 token 时校验 Origin（也是 iframe 的 frame-ancestors 名单）
//        ↓
//   POST /api/consult/sdk/token   → scope=consult:embed 的 15 分钟短 token
//     └─ 全局闸门（auth/scopeGuard.ts）只放行 /api/consult/{stages,projects}
//
// **换 token 必须由第三方页面自己发**，不能由 iframe 里的页面发：iframe 里发出的请求
// Origin/Referer 是**我们自己的**域名，那道白名单于是对每个 pk 都成立，等于没配。
//
// **`external_uid` 是第三方页面传的，不可信。** 它在这里签进 JWT（之后每个请求的租户
// 都从签名过的 token 里取，不从请求参数取），但纯前端下第三方页面上的任何人都能改掉
// 它、读到同一把 key 下别的终端用户的项目和客户原始资料 —— 所以它只是**展示隔离**，
// 不是安全边界。要真隔离，接入方得出一个最小后端来签这个值。这句必须同时出现在
// 文档页上：不说的话他们会拿它装真客户的品牌资料。
// ============================================================================

export const CONSULT_SDK_SCOPE = 'consult:embed';
export const CONSULT_PK_PREFIX = 'pk_consult_';
const TOKEN_TTL_SECONDS = 15 * 60;

const MAX_EXTERNAL_UID_CHARS = 64;
const EXTERNAL_UID_RE = /^[A-Za-z0-9_.:@-]+$/;

/** 存得进去但永远匹配不上的白名单条目要**拒**，不能存。存下来的话后台那一行显示得和
 *  配对了的一模一样，而接入方那边是稳定 403 —— 他只会反复核对自己那个没写错的域名。
 *  话术里带上那几条原文：不带的话「哪一条不对」得靠猜（最常见的是漏了 https://）。 */
function originFormatError(bad: string[]): string {
  return (
    `这几条不是合法的域名，存进去只会稳定 403（要 https://example.com 这种形式：带 http/https、不带路径）：${bad.join('、')}。` +
    '一行一个，或者用逗号/空格分隔。'
  );
}

/** 新 key 的缺省上限（086）。和 `ai_app_quota` 的「没配就不限」相反 —— 理由见那份迁移。 */
export const DEFAULT_DAILY_AI_LIMIT = 50;
export const DEFAULT_MAX_PROJECTS = 200;

/**
 * 上限字段的取值。**0 是合法值**（等于把这把 key 冻住），所以不能写 `Number(x) || 缺省`
 * —— 那样管理员填 0 会被悄悄改回 50，他以为已经冻住了而第三方那边照样在调。
 * 不是 >= 0 的整数就返回 null（由调用方回 400），别兜成缺省值。
 */
function limitOr(raw: unknown, fallback: number): number | null {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) return null;
  return n;
}

interface ConsultSdkKeyRow {
  pk: string;
  user_id: string;
  name: string;
  allowed_origins: string;
  enabled: number;
  rate_limit: number;
}

/** 短 token 里那两个自定义 claim。业务侧只认这里的值，不认请求参数。 */
export interface ConsultSdkClaims {
  scope: string;
  pk: string;
  euid: string;
}

export function registerConsultSdkRoutes(router: Router): void {
  router.options('/sdk/token', (req, res) => {
    if (req.headers.origin) applySdkCors(res, req.headers.origin, 'POST, OPTIONS');
    res.status(204).end();
  });

  router.post('/sdk/token', (req: Request, res: Response) => {
    const pk = String(req.body?.pk || req.query.pk || '');
    if (!pk.startsWith(CONSULT_PK_PREFIX)) {
      return res.status(400).json({ error: 'Missing or invalid pk' });
    }

    // externalUid 必填，**不给缺省值**：默认成空串的话，这个接入方所有终端用户
    // 会共用一个归属键，A 客户的品牌资料出现在 B 客户的项目列表里 —— 那个列表
    // 读起来就是一列正常的项目，没有一处报错。只有一个共享工作台的接入方可以
    // 自己传一个固定值，那是他明确选的。
    const externalUid = String(req.body?.externalUid || '').trim();
    if (!externalUid) {
      return res.status(400).json({
        error:
          'externalUid is required — it is the per-end-user key that keeps one customer\'s projects out of another\'s list. Pass a stable id from your side (or a fixed value if all your users really do share one workspace).',
      });
    }
    if (externalUid.length > MAX_EXTERNAL_UID_CHARS || !EXTERNAL_UID_RE.test(externalUid)) {
      return res.status(400).json({
        error: `externalUid must be <= ${MAX_EXTERNAL_UID_CHARS} chars of [A-Za-z0-9_.:@-]`,
      });
    }

    const db = getDatabase();
    const row = db.prepare('SELECT * FROM consult_sdk_keys WHERE pk = ?').get(pk) as
      | ConsultSdkKeyRow
      | undefined;
    if (!row || !row.enabled) {
      return res.status(401).json({ error: 'Invalid or disabled key' });
    }

    const origin = requestOrigin(req);
    if (!originAllowed(row.allowed_origins, origin)) {
      // 把收到的 Origin 回出去：接入方最常见的错是配了 https 用了 http、
      // 或者配了带路径的整条 URL。只回一句「Origin not allowed」的话他核对的是
      // 自己配的那一行，而问题在浏览器实际发出来的这一行。
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

    const claims: ConsultSdkClaims & { id: string; username: string; role: 'user' } = {
      id: user.id,
      username: user.username,
      role: 'user',
      scope: CONSULT_SDK_SCOPE,
      pk,
      euid: externalUid,
    };
    const token = jwt.sign(claims, getJwtSecret(), { expiresIn: TOKEN_TTL_SECONDS });

    db.prepare('UPDATE consult_sdk_keys SET last_used_at = ? WHERE pk = ?')
      .run(new Date(nowMs).toISOString(), pk);

    if (req.headers.origin) applySdkCors(res, req.headers.origin, 'POST, OPTIONS');

    res.json({
      token,
      token_type: 'Bearer',
      expires_in: TOKEN_TTL_SECONDS,
      // 回显 externalUid：接入方传错大小写 / 传了个 undefined 字符串时，
      // 项目会静默落到另一个租户下，而界面上只是「项目列表空了」。
      external_uid: externalUid,
    });
  });
}

// ==================== Admin: consult SDK key 管理 ====================
// 这些路由挂在 /admin/* 下，由 consult.ts 里的 `consultRouter.use('/admin', requireAdmin)`
// 统一鉴权 —— 调用本函数必须在挂上那道闸门之后（见 consult.ts 的顺序注释）。

export function registerConsultSdkAdminRoutes(router: Router): void {
  router.get('/admin/sdk-keys', (_req, res) => {
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT k.pk, k.user_id, k.name, k.allowed_origins, k.enabled, k.rate_limit,
             k.daily_ai_limit, k.max_projects, k.created_at, k.last_used_at, u.username
      FROM consult_sdk_keys k LEFT JOIN user u ON k.user_id = u.id
      ORDER BY k.created_at DESC
    `).all() as any[];
    res.json(rows.map((r) => ({
      ...r,
      allowed_origins: safeParseArray(r.allowed_origins),
      enabled: !!r.enabled,
      // 今天用了多少、名下多少项目一起回：只回上限不回用量的话，接入方那边被 429 挡住时
      // 后台这一行看起来完全正常，管理员没法判断该调高上限还是有人在滥用。
      ...sdkKeyUsage(r.pk),
    })));
  });

  router.post('/admin/sdk-keys', (req, res) => {
    const { userId, name, allowedOrigins, rateLimit, dailyAiLimit, maxProjects } = req.body || {};
    if (!userId) return res.status(400).json({ error: 'userId is required' });

    const db = getDatabase();
    if (!db.prepare('SELECT id FROM user WHERE id = ?').get(userId)) {
      return res.status(400).json({ error: 'user not found' });
    }

    // 白名单为空直接拒：空清单在 originAllowed 里是「谁都不放行」，接入方拿到的是
    // 一把怎么试都 403 的 key，而后台那一行看起来是建好了的。
    const origins = normalizeOriginsInput(allowedOrigins);
    if (!origins.length) {
      return res.status(400).json({
        error: '至少配一个 allowedOrigins（第三方页面的域名，如 https://example.com）—— 空白名单的 key 换不到 token，而后台看起来是建好的',
      });
    }
    const bad = invalidOrigins(origins);
    if (bad.length) {
      return res.status(400).json({ error: originFormatError(bad) });
    }

    const aiLimit = limitOr(dailyAiLimit, DEFAULT_DAILY_AI_LIMIT);
    const projectCap = limitOr(maxProjects, DEFAULT_MAX_PROJECTS);
    if (aiLimit === null || projectCap === null) {
      return res.status(400).json({ error: 'dailyAiLimit / maxProjects 必须是 >= 0 的整数' });
    }

    const pk = generatePk(CONSULT_PK_PREFIX);
    db.prepare(`
      INSERT INTO consult_sdk_keys
        (pk, user_id, name, allowed_origins, enabled, rate_limit, daily_ai_limit, max_projects, created_at)
      VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)
    `).run(
      pk, userId, name || '', JSON.stringify(origins), Number(rateLimit) || 60,
      aiLimit, projectCap, new Date().toISOString()
    );

    invalidateFrameAncestors(); // 新 key 的域名要立刻能嵌，不然读起来像「配了没用」
    res.json({
      pk, user_id: userId, name: name || '', allowed_origins: origins, enabled: true,
      daily_ai_limit: aiLimit, max_projects: projectCap,
    });
  });

  router.patch('/admin/sdk-keys/:pk', (req, res) => {
    const db = getDatabase();
    if (!db.prepare('SELECT pk FROM consult_sdk_keys WHERE pk = ?').get(req.params.pk)) {
      return res.status(404).json({ error: 'Not found' });
    }

    const { name, allowedOrigins, enabled, rateLimit, dailyAiLimit, maxProjects } = req.body || {};
    for (const [field, raw] of [['dailyAiLimit', dailyAiLimit], ['maxProjects', maxProjects]] as const) {
      if (raw === undefined) continue;
      const v = limitOr(raw, -1);
      if (v === null) return res.status(400).json({ error: `${field} 必须是 >= 0 的整数` });
      const col = field === 'dailyAiLimit' ? 'daily_ai_limit' : 'max_projects';
      db.prepare(`UPDATE consult_sdk_keys SET ${col} = ? WHERE pk = ?`).run(v, req.params.pk);
    }
    if (name !== undefined) {
      db.prepare('UPDATE consult_sdk_keys SET name = ? WHERE pk = ?').run(String(name), req.params.pk);
    }
    if (allowedOrigins !== undefined) {
      const origins = normalizeOriginsInput(allowedOrigins);
      if (!origins.length) {
        return res.status(400).json({ error: '白名单不能清空 —— 空清单的 key 换不到 token，要停用就用 enabled=false' });
      }
      const bad = invalidOrigins(origins);
      if (bad.length) {
        return res.status(400).json({ error: originFormatError(bad) });
      }
      db.prepare('UPDATE consult_sdk_keys SET allowed_origins = ? WHERE pk = ?')
        .run(JSON.stringify(origins), req.params.pk);
    }
    if (enabled !== undefined) {
      db.prepare('UPDATE consult_sdk_keys SET enabled = ? WHERE pk = ?').run(enabled ? 1 : 0, req.params.pk);
    }
    if (rateLimit !== undefined) {
      db.prepare('UPDATE consult_sdk_keys SET rate_limit = ? WHERE pk = ?').run(Number(rateLimit) || 60, req.params.pk);
    }

    invalidateFrameAncestors();
    res.json({ success: true });
  });

  router.delete('/admin/sdk-keys/:pk', (req, res) => {
    const db = getDatabase();
    db.prepare('DELETE FROM consult_sdk_keys WHERE pk = ?').run(req.params.pk);
    invalidateFrameAncestors();
    res.json({ success: true });
  });
}
