import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { requireAdmin } from '../auth/guards.js';
import { getDatabase } from '../db/index.js';
import { generateApiToken, hashApiToken } from '../auth/middleware.js';
import OpenAI from 'openai';
import {
  listProviders, upsertProvider, deleteProvider, maskProvider, getProvider,
  dedicatedChannelStatus, appChannelStatus, REQUIRED_LLM_TIERS,
} from '../services/aiProviderService.js';
import {
  createRelayKey, listRelayKeys, getRelayKeyById, revokeRelayKey,
} from '../services/relayKeyService.js';
import { relayUsage } from '../services/relayService.js';
import { AI_APPS, isValidAppScope } from '../core/llm/apps.js';
import { normalizeBaseUrl } from '../core/llm/baseUrl.js';
import { getAppQuotaStatus } from '../core/llm/gateway.js';
import { parsePagination, patchRow } from '../core/http.js';
import { encryptSecret, maskSecret } from '../core/secrets.js';

export const adminRouter = Router();
adminRouter.use(requireAdmin);

// --- User Management ---

adminRouter.get('/users', (req: Request, res: Response) => {
  const { page, pageSize, offset } = parsePagination(req);
  const db = getDatabase();

  const { total } = db.prepare('SELECT COUNT(*) as total FROM user').get() as { total: number };
  const users = db.prepare(`
    SELECT u.id, u.username, u.role, u.created_at, u.updated_at,
      COALESCE(u.use_dedicated_ai, 0) as use_dedicated_ai,
      (SELECT COUNT(*) FROM ai_logs WHERE user_id = u.id) as total_ai_calls,
      q.daily_limit, q.used_today, q.last_reset_date
    FROM user u
    LEFT JOIN ai_quota q ON q.user_id = u.id
    ORDER BY u.created_at ASC
    LIMIT ? OFFSET ?
  `).all(pageSize, offset);
  res.json({ users, total, page, page_size: pageSize });
});

adminRouter.post('/users', (req: Request, res: Response) => {
  const { username, password, role = 'user' } = req.body;
  if (!username || !password) {
    res.status(400).json({ error: 'username and password are required' });
    return;
  }
  if (role && !['admin', 'user'].includes(role)) {
    res.status(400).json({ error: 'role must be "admin" or "user"' });
    return;
  }

  const db = getDatabase();
  const existing = db.prepare('SELECT id FROM user WHERE username = ?').get(username);
  if (existing) {
    res.status(409).json({ error: 'Username already exists' });
    return;
  }

  const id = uuidv4();
  const passwordHash = bcrypt.hashSync(password, 10);
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO user (id, username, password_hash, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, username, passwordHash, role, now, now);

  res.status(201).json({ id, username, role, created_at: now });
});

adminRouter.patch('/users/:id/role', (req: Request, res: Response) => {
  const { role } = req.body;
  if (!role || !['admin', 'user'].includes(role)) {
    res.status(400).json({ error: 'role must be "admin" or "user"' });
    return;
  }

  const db = getDatabase();
  const user = db.prepare('SELECT id FROM user WHERE id = ?').get(req.params.id);
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  db.prepare('UPDATE user SET role = ?, updated_at = ? WHERE id = ?')
    .run(role, new Date().toISOString(), req.params.id);

  res.json({ success: true });
});

adminRouter.post('/users/:id/reset-password', (req: Request, res: Response) => {
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 6) {
    res.status(400).json({ error: 'newPassword must be at least 6 characters' });
    return;
  }

  const db = getDatabase();
  const user = db.prepare('SELECT id FROM user WHERE id = ?').get(req.params.id);
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  const hash = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE user SET password_hash = ?, token_version = COALESCE(token_version, 1) + 1, updated_at = ? WHERE id = ?')
    .run(hash, new Date().toISOString(), req.params.id);

  res.json({ success: true });
});

// --- Quota Management ---

adminRouter.get('/quotas', (req: Request, res: Response) => {
  const { page, pageSize, offset } = parsePagination(req);
  const db = getDatabase();
  const today = new Date().toISOString().split('T')[0];

  const { total } = db.prepare('SELECT COUNT(*) as total FROM user').get() as { total: number };
  const quotas = db.prepare(`
    SELECT u.id as user_id, u.username,
      COALESCE(q.daily_limit, 10) as daily_limit,
      COALESCE(q.used_today, 0) as used_today,
      COALESCE(q.last_reset_date, ?) as last_reset_date
    FROM user u
    LEFT JOIN ai_quota q ON q.user_id = u.id
    ORDER BY u.username ASC
    LIMIT ? OFFSET ?
  `).all(today, pageSize, offset);
  res.json({ quotas, total, page, page_size: pageSize });
});

adminRouter.patch('/quotas/:userId', (req: Request, res: Response) => {
  const { daily_limit } = req.body;
  if (typeof daily_limit !== 'number' || daily_limit < 0) {
    res.status(400).json({ error: 'daily_limit must be a non-negative number' });
    return;
  }

  const db = getDatabase();
  const today = new Date().toISOString().split('T')[0];

  const existing = db.prepare('SELECT user_id FROM ai_quota WHERE user_id = ?').get(req.params.userId);
  if (existing) {
    db.prepare('UPDATE ai_quota SET daily_limit = ? WHERE user_id = ?')
      .run(daily_limit, req.params.userId);
  } else {
    db.prepare('INSERT INTO ai_quota (user_id, daily_limit, used_today, last_reset_date) VALUES (?, ?, 0, ?)')
      .run(req.params.userId, daily_limit, today);
  }

  res.json({ success: true });
});

// --- AI Usage Dashboard ---

adminRouter.get('/ai-usage', (req: Request, res: Response) => {
  const { days = '7' } = req.query;
  const safeDays = Math.min(Math.max(Number(days) || 7, 1), 365);
  const db = getDatabase();

  const since = new Date();
  since.setDate(since.getDate() - safeDays);
  const sinceStr = since.toISOString();

  const byUser = db.prepare(`
    SELECT u.username, COUNT(*) as calls, SUM(al.total_tokens) as tokens
    FROM ai_logs al JOIN user u ON al.user_id = u.id
    WHERE al.created_at >= ?
    GROUP BY al.user_id
    ORDER BY calls DESC
  `).all(sinceStr);

  const bySource = db.prepare(`
    SELECT source, COUNT(*) as calls, SUM(total_tokens) as tokens
    FROM ai_logs WHERE created_at >= ?
    GROUP BY source
  `).all(sinceStr);

  const byDay = db.prepare(`
    SELECT DATE(created_at) as day, COUNT(*) as calls, SUM(total_tokens) as tokens
    FROM ai_logs WHERE created_at >= ?
    GROUP BY DATE(created_at)
    ORDER BY day
  `).all(sinceStr);

  const total = db.prepare(`
    SELECT COUNT(*) as calls, SUM(total_tokens) as tokens,
      SUM(input_tokens) as input_tokens, SUM(output_tokens) as output_tokens
    FROM ai_logs WHERE created_at >= ?
  `).get(sinceStr);

  res.json({ byUser, bySource, byDay, total, days: safeDays });
});

// --- System Config ---

const ALLOWED_CONFIG_KEYS = ['platform_api_key', 'platform_api_base_url', 'platform_model', 'web_search_api_key', 'cos_secret_id', 'cos_secret_key', 'cos_bucket', 'cos_region', 'tender_scoring_weights', 'tender_scoring_prompt', 'tender_extract_prompt', 'tender_pre_filter_threshold'];

/**
 * 需要加密存储 + 脱敏回显的 key，显式列出。
 *
 * 原来是按 key.includes('key') 判断的，于是 cos_secret_id 因为名字里没有 'key'
 * 被整串明文返回给了前端 —— 判断依据是命名巧合而不是语义，加一个
 * 叫 xxx_token 的配置项就会重演一次。
 */
const SECRET_CONFIG_KEYS = new Set(['platform_api_key', 'web_search_api_key', 'cos_secret_id', 'cos_secret_key']);

adminRouter.get('/config', (_req: Request, res: Response) => {
  const db = getDatabase();
  const configs = db.prepare('SELECT key, value, updated_at FROM system_config').all() as { key: string; value: string; updated_at: string }[];

  const result: Record<string, { value: string; updated_at: string }> = {};
  for (const c of configs) {
    result[c.key] = {
      value: SECRET_CONFIG_KEYS.has(c.key) ? maskSecret(c.value) : c.value,
      updated_at: c.updated_at,
    };
  }

  res.json({ config: result, allowed_keys: ALLOWED_CONFIG_KEYS });
});

adminRouter.post('/config', (req: Request, res: Response) => {
  const { key, value } = req.body;
  if (!key || value === undefined) {
    res.status(400).json({ error: 'key and value are required' });
    return;
  }
  if (!ALLOWED_CONFIG_KEYS.includes(key)) {
    res.status(400).json({ error: `Invalid config key. Allowed: ${ALLOWED_CONFIG_KEYS.join(', ')}` });
    return;
  }

  const db = getDatabase();
  const now = new Date().toISOString();
  // base_url 入库先归一化，理由同 ai_providers：粘完整的 .../chat/completions
  // 进来，SDK 会再拼一次，上游回 404 «Invalid URL»。见 core/llm/baseUrl.ts。
  const stored =
    key === 'platform_api_base_url'
      ? normalizeBaseUrl(String(value))
      : SECRET_CONFIG_KEYS.has(key)
        ? encryptSecret(String(value))
        : value;
  db.prepare('INSERT OR REPLACE INTO system_config (key, value, updated_at) VALUES (?, ?, ?)')
    .run(key, stored, now);

  res.json({ success: true });
});

adminRouter.delete('/config/:key', (req: Request, res: Response) => {
  // 白名单同样要卡在 DELETE 上：不然可以删掉白名单外的任意配置行
  // （比如某个模块自己写进去的运行时状态），POST 拦得住而 DELETE 拦不住。
  if (!ALLOWED_CONFIG_KEYS.includes(req.params.key)) {
    res.status(400).json({ error: 'Invalid config key' });
    return;
  }
  const db = getDatabase();
  db.prepare('DELETE FROM system_config WHERE key = ?').run(req.params.key);
  res.json({ success: true });
});

// --- AI Model Providers ---
// 按任务档位配多个文本模型（tier: default/strong/fast）+ 未来的生图（kind: image）。
// api_key 一律脱敏返回；POST 时 api_key 传空串表示「不改动」（沿用脱敏回显值不覆盖真值）。

// 不传 owner_user_id 时只返回平台级，避免系统配置页混进用户私有配置。
adminRouter.get('/providers', (req: Request, res: Response) => {
  const owner = req.query.owner_user_id ? String(req.query.owner_user_id) : undefined;
  // apps 一并下发：scope_app 下拉框的选项必须来自服务端的同一份白名单。
  // 前端自己抄一份的话，加了新模块只更新一边 —— 抄的那份漏了谁，谁就永远配不上。
  res.json({ providers: listProviders(owner).map(maskProvider), apps: AI_APPS });
});

adminRouter.post('/providers', (req: Request, res: Response) => {
  const b = req.body || {};
  if (b.kind && !['llm', 'image'].includes(b.kind)) {
    res.status(400).json({ error: 'kind 只能是 llm 或 image' });
    return;
  }
  if (b.tier && !['default', 'strong', 'fast'].includes(b.tier)) {
    res.status(400).json({ error: 'tier 只能是 default/strong/fast' });
    return;
  }
  if (b.extra_json !== undefined) {
    try { JSON.parse(b.extra_json || '{}'); } catch { res.status(400).json({ error: 'extra_json 不是合法 JSON' }); return; }
  }
  // owner_user_id 必须指向真实用户：拼错了会造出一条永远不会被任何人用到的
  // "孤儿" provider，而表现只是"专属渠道没生效"，极难排查。
  if (b.owner_user_id) {
    const exists = getDatabase().prepare('SELECT id FROM user WHERE id = ?').get(String(b.owner_user_id));
    if (!exists) { res.status(400).json({ error: 'owner_user_id 对应的用户不存在' }); return; }
  }
  // scope_app 同理，而且更隐蔽：它靠字符串等于 GatewayOptions.source 来匹配，
  // 写成 'XHS' 或 'ui_review' 的表现是「保存成功、界面正常、永远不生效」。
  // 白名单在 core/llm/apps.ts。
  if (b.scope_app && !isValidAppScope(String(b.scope_app))) {
    res.status(400).json({
      error: `scope_app「${b.scope_app}」不是已知应用。可选：${AI_APPS.map((a) => a.id).join(' / ')}`,
    });
    return;
  }
  // 归属类字段（owner_user_id / scope_app）只在 body 里**出现过**时才传下去。
  // 写成 `b.scope_app || ''` 的话，一次没带该字段的编辑（改个 label、换个 model）
  // 就把「xhs 专用」悄悄变成全站通用 —— 一个应用的 key 摊给所有应用；
  // owner_user_id 同理，而且更严重：用户的专属配置会变成平台配置，从此平台替他付钱。
  // upsertProvider 里用 `?? existing` 保留旧值，前提就是这里传 undefined 而不是空值。
  const saved = upsertProvider({
    id: b.id || undefined,
    kind: b.kind,
    tier: b.tier,
    label: b.label,
    base_url: b.base_url,
    api_key: b.api_key,
    model: b.model,
    extra_json: b.extra_json,
    enabled: b.enabled,
    ...('owner_user_id' in b ? { owner_user_id: b.owner_user_id || null } : {}),
    ...('scope_app' in b ? { scope_app: b.scope_app || '' } : {}),
  });
  res.json({ provider: maskProvider(saved) });
});

adminRouter.delete('/providers/:id', (req: Request, res: Response) => {
  // 顺带吊销的对外 key 数量必须回出去并显示：删接入点的人不一定知道有下游在用它，
  // 不说的话那几个下游明天开始收到「接口已关闭」，而这边只看到一句「已删除」。
  const { revokedRelayKeys } = deleteProvider(req.params.id);
  res.json({ success: true, revoked_relay_keys: revokedRelayKeys });
});

// --- 对外中转接口的 key（migration 082）---
// 挂在「某个用户的某条专属接入点」上：调用记在这个用户头上（ai_logs → 用量/限流按人算），
// 转发用绑定的那条接入点。接入点停用或删除后这把 key 立刻不可用（见 relayKeyService）。

adminRouter.post('/users/:id/relay-keys', (req: Request, res: Response) => {
  const db = getDatabase();
  const user = db.prepare('SELECT id FROM user WHERE id = ?').get(req.params.id);
  if (!user) { res.status(404).json({ error: 'User not found' }); return; }

  const providerId = String(req.body?.provider_id || '').trim();
  const provider = providerId ? getProvider(providerId) : undefined;
  // 必须是这个用户自己的接入点：挂到平台级或别人的接入点上，这把 key 花的就是别人的
  // key，而后台那一页看着是「这个用户的对外接口」，用量也记在他头上。
  if (!provider || provider.owner_user_id !== req.params.id) {
    res.status(400).json({ error: '请选择该用户自己的接入点（provider_id 不存在或不属于这个用户）' });
    return;
  }
  if (provider.kind !== 'llm') {
    res.status(400).json({ error: '只有文本模型（kind=llm）能生成对外接口 —— 生图接入点转出来的 /chat/completions 永远调不通' });
    return;
  }

  const { key, row } = createRelayKey(req.params.id, providerId, String(req.body?.label || ''));
  // key 明文只有这一次 —— 前端必须当场让管理员复制走，库里只有 sha256
  res.json({ key, relay_key: row, provider: maskProvider(provider) });
});

adminRouter.delete('/relay-keys/:keyId', (req: Request, res: Response) => {
  const row = getRelayKeyById(req.params.keyId);
  if (!row) { res.status(404).json({ error: '这把 key 不存在' }); return; }
  revokeRelayKey(req.params.keyId, '管理员手动吊销');
  res.json({ success: true, relay_key: getRelayKeyById(req.params.keyId) });
});

// --- 用户专属 AI 渠道 ---
// 管理员为单个用户配一整套独立模型接入点。开关打开后该用户所有 AI 调用只走自己的 key，
// 不回落平台（缺档直接报错）、也不受平台每日额度限制。详见 migrations/052。

adminRouter.get('/users/:id/dedicated-ai', (req: Request, res: Response) => {
  const db = getDatabase();
  const user = db.prepare('SELECT id, username FROM user WHERE id = ?').get(req.params.id) as
    | { id: string; username: string }
    | undefined;
  if (!user) { res.status(404).json({ error: 'User not found' }); return; }

  res.json({
    user,
    providers: listProviders(req.params.id).map(maskProvider),
    status: dedicatedChannelStatus(req.params.id),
    required_tiers: REQUIRED_LLM_TIERS,
    apps: AI_APPS,
    // 逐个应用、逐档报告「实际会用哪条配置」。
    // 关键是 fallbackToShared：只配了 xhs 的 fast、忘了 strong 时，
    // strong 会静默回落到通用配置（可能是很贵的模型），运行时完全看不出来。
    app_resolutions: Object.fromEntries(
      AI_APPS.map((a) => [a.id, appChannelStatus(req.params.id, a.id)])
    ),
    app_quotas: getAppQuotaStatus(req.params.id),
    // 对外中转 key。已吊销的也回：下游收到「接口已关闭」时管理员要能在这里
    // 看到是哪一把、什么时候废的、为什么废（手动吊销 / 接入点被删）——
    // 界面上找不到那把 key 的话，只能怀疑接口坏了。
    relay_keys: listRelayKeys(req.params.id),
    // 合计用量（这个人所有 key 加起来）。ai_logs 没有 key 维度，界面上不能把它
    // 摆到某一行 key 旁边 —— 见 relayUsage 的注释。
    relay_usage: relayUsage(req.params.id),
  });
});

// --- 按应用的每日额度（migrations/062）---
// 语义：**额外的天花板，不替代账号总额**。没有行 = 该应用不限。
// 与专属渠道无关：专属渠道用户同样受这个限制（见 checkAndDeductAppQuota 注释）。

adminRouter.put('/users/:id/app-quota', (req: Request, res: Response) => {
  const { app, daily_limit } = req.body || {};
  const db = getDatabase();

  const user = db.prepare('SELECT id FROM user WHERE id = ?').get(req.params.id);
  if (!user) { res.status(404).json({ error: 'User not found' }); return; }

  if (!isValidAppScope(app) || !app) {
    res.status(400).json({ error: `app 必须是已知应用之一：${AI_APPS.map((a) => a.id).join(' / ')}` });
    return;
  }

  // null / 负数 = 取消限制（删行）。0 是**合法且不同**的值：意思是「一次都不许调」，
  // 是管理员临时掐停某个应用的手段，不能和「不限制」混在一起。
  if (daily_limit === null || daily_limit === undefined) {
    db.prepare('DELETE FROM ai_app_quota WHERE user_id = ? AND app = ?').run(req.params.id, app);
    res.json({ success: true, app, daily_limit: null });
    return;
  }
  if (typeof daily_limit !== 'number' || !Number.isInteger(daily_limit) || daily_limit < 0) {
    res.status(400).json({ error: 'daily_limit 必须是非负整数，或传 null 表示取消限制' });
    return;
  }

  const today = new Date().toISOString().split('T')[0];
  // 只改上限，不动 used_today —— 管理员中途调额度不该把今天已用的次数抹掉，
  // 否则「调一次额度」就等于「白送一天」。ON CONFLICT 里刻意不写 used_today。
  db.prepare(
    `INSERT INTO ai_app_quota (user_id, app, daily_limit, used_today, last_reset_date)
     VALUES (?, ?, ?, 0, ?)
     ON CONFLICT(user_id, app) DO UPDATE SET daily_limit = excluded.daily_limit`
  ).run(req.params.id, app, daily_limit, today);

  res.json({ success: true, app, daily_limit });
});

adminRouter.patch('/users/:id/dedicated-ai', (req: Request, res: Response) => {
  const { enabled } = req.body || {};
  if (typeof enabled !== 'boolean') {
    res.status(400).json({ error: 'enabled 必须是布尔值' });
    return;
  }

  const db = getDatabase();
  const user = db.prepare('SELECT id FROM user WHERE id = ?').get(req.params.id);
  if (!user) { res.status(404).json({ error: 'User not found' }); return; }

  // 开启前卡完备性：三档缺任意一档就开着的话，用户点到那个功能时才会报错，
  // 而报错点离配置动作很远。在这里拦住，让问题在配置时暴露。
  if (enabled) {
    const status = dedicatedChannelStatus(req.params.id);
    if (!status.ready) {
      res.status(400).json({
        error: `专属渠道尚未配齐，缺少档位：${status.missingTiers.join(' / ')}。请先补齐再启用。`,
        missing_tiers: status.missingTiers,
      });
      return;
    }
  }

  db.prepare('UPDATE user SET use_dedicated_ai = ?, updated_at = ? WHERE id = ?')
    .run(enabled ? 1 : 0, new Date().toISOString(), req.params.id);

  res.json({ success: true, enabled });
});

/**
 * 连通性测试。对某条 provider 发一次真实的最小请求。
 *
 * strong 档额外带 response_format: json_object —— xhs 搭结构/校验/诊断等 6 处
 * 硬依赖它，而多数失败在业务层被兜底成空结果（表现是"点了没反应"而不是报错）。
 * 在这里探一次，把不兼容的模型挡在配置阶段。
 *
 * TEST_MAX_TOKENS 给得比"够回一个 ok"大得多，因为**推理模型的思考 token
 * 也算在 max_tokens 里**：deepseek-v4-flash 之类的模型把预算全花在
 * reasoning_content 上，content 是空字符串、finish_reason 是 'length'。
 * 原来这里是 16，实测该模型必然返回空回复 —— 而 200 那行照样 success: true，
 * 管理员看到"连通 ✓ 回复：（空）"，只能怀疑自己的 key。
 * 空回复现在会被判成失败并给出明确提示。
 */
const TEST_MAX_TOKENS = 512;
adminRouter.post('/providers/:id/test', async (req: Request, res: Response) => {
  const provider = getProvider(req.params.id);
  if (!provider) { res.status(404).json({ error: 'Provider not found' }); return; }
  if (!provider.api_key) { res.status(400).json({ error: 'API Key 未设置或无法解密' }); return; }
  if (provider.kind !== 'llm') {
    res.status(400).json({ error: '生图 provider 的适配器尚未实现，暂不支持连通性测试' });
    return;
  }

  const client = new OpenAI({
    apiKey: provider.api_key,
    baseURL: provider.base_url || 'https://api.openai.com/v1',
    timeout: 30_000,
  });
  const wantsJson = provider.tier === 'strong';

  try {
    const started = Date.now();
    const r = await client.chat.completions.create({
      model: provider.model || 'gpt-4o',
      messages: [{ role: 'user', content: wantsJson ? '返回 JSON：{"ok":true}' : 'ping' }],
      max_tokens: TEST_MAX_TOKENS,
      temperature: 0,
      ...(wantsJson ? { response_format: { type: 'json_object' as const } } : {}),
    });
    const choice = r.choices?.[0];
    const reply = choice?.message?.content || '';
    // 推理模型的思考 token 也吃 max_tokens。空 content 意味着这个模型在
    // 本项目实际用的 max_tokens（很多调用点是 300~1500）下有很大概率也吐空，
    // 那对业务是静默失败。宁可在这里判失败。
    const reasoningTokens =
      (r.usage as any)?.completion_tokens_details?.reasoning_tokens ?? 0;
    if (!reply.trim()) {
      res.status(400).json({
        success: false,
        error: `模型返回了空内容（finish_reason=${choice?.finish_reason || '未知'}${reasoningTokens ? `，思考 token ${reasoningTokens}` : ''}）`,
        hint: reasoningTokens
          ? `这是一个推理模型：它的思考过程走 reasoning_content，且**思考 token 也算在 max_tokens 里**。本次已给到 ${TEST_MAX_TOKENS} 仍吐空，说明它在本项目多数调用点（max_tokens 300~1500）下也会返回空内容，不适合直接接入。`
          : '模型连通但没有返回正文，请检查该模型名是否正确、是否需要特殊参数。',
      });
      return;
    }
    res.json({
      success: true,
      duration_ms: Date.now() - started,
      model: r.model || provider.model,
      json_object_supported: wantsJson ? true : undefined,
      reply: reply.slice(0, 200),
      // 推理模型必须在配置阶段就说出来：它会静静吃掉 max_tokens 预算。
      reasoning_tokens: reasoningTokens || undefined,
      reasoning_hint: reasoningTokens
        ? `这是推理模型（本次思考消耗 ${reasoningTokens} token，且计入 max_tokens）。项目里 max_tokens 较小的调用点（如摸鱼缸 300、看板 1000）有返回空内容的风险，建议先在对应功能里实测。`
        : undefined,
    });
  } catch (e: any) {
    // 上游把 json_object 不支持报成 400，和「key 错了」区分开，否则管理员会去反复检查 key。
    const msg = String(e?.message || e);
    const jsonUnsupported = wantsJson && /response_format|json_object/i.test(msg);
    // 404 «Invalid URL» 几乎总是 base_url 的问题，而报错字面上跟地址无关，
    // 管理员会先怀疑 key 和模型名。base_url 现在入库/出库都会归一化，
    // 所以走到这里通常是**路径本身**不对（少了 /v1、网关前缀写错）。
    const badUrl = /invalid url|404/i.test(msg);
    res.status(400).json({
      success: false,
      error: msg.slice(0, 500),
      json_object_supported: jsonUnsupported ? false : undefined,
      hint: jsonUnsupported
        ? '该模型不支持 response_format=json_object，strong 档的结构化任务（小红书搭结构/校验/诊断）会失败，请换一个模型。'
        : badUrl
          ? `请检查 Base URL：这里要填**前缀**（如 https://host/v1），末尾的 /chat/completions 由程序自己拼。当前实际请求的前缀是「${provider.base_url || 'https://api.openai.com/v1'}」，也请确认模型名「${provider.model}」在该网关上存在。`
          : undefined,
    });
  }
});

// --- Module Configs ---

adminRouter.get('/modules', (req: Request, res: Response) => {
  const { page, pageSize, offset } = parsePagination(req);
  const db = getDatabase();

  const { total } = db.prepare('SELECT COUNT(*) as total FROM module_configs').get() as { total: number };
  const modules = db.prepare('SELECT * FROM module_configs ORDER BY created_at ASC LIMIT ? OFFSET ?').all(pageSize, offset);
  res.json({ modules, total, page, page_size: pageSize });
});

adminRouter.patch('/modules/:id', (req: Request, res: Response) => {
  const db = getDatabase();
  const existing = db.prepare('SELECT id FROM module_configs WHERE id = ?').get(req.params.id);
  if (!existing) { res.status(404).json({ error: 'Module not found' }); return; }

  // module_configs 没有 updated_at 列，关掉自动写入。
  const changed = patchRow(db, 'module_configs', {
    columns: ['name', 'description', 'enabled', 'allowed_paths'],
    booleans: ['enabled'],
    json: ['allowed_paths'],
    touchUpdatedAt: false,
  }, req.body, { id: req.params.id });

  if (changed === 0) { res.status(400).json({ error: 'no fields' }); return; }

  const updated = db.prepare('SELECT * FROM module_configs WHERE id = ?').get(req.params.id);
  res.json(updated);
});

adminRouter.post('/modules', (req: Request, res: Response) => {
  const { id, name, description, allowed_paths } = req.body;
  if (!id || !name) { res.status(400).json({ error: 'id and name required' }); return; }

  const db = getDatabase();
  const existing = db.prepare('SELECT id FROM module_configs WHERE id = ?').get(id);
  if (existing) { res.status(409).json({ error: 'Module id already exists' }); return; }

  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO module_configs (id, name, description, allowed_paths, enabled, created_at)
    VALUES (?, ?, ?, ?, 1, ?)
  `).run(id, name, description || '', JSON.stringify(allowed_paths || []), now);

  const created = db.prepare('SELECT * FROM module_configs WHERE id = ?').get(id);
  res.status(201).json(created);
});

// --- Module Tokens ---

adminRouter.get('/users/:id/tokens', (req: Request, res: Response) => {
  const db = getDatabase();
  const tokens = db.prepare(`
    SELECT t.*, mc.name as module_name
    FROM module_tokens t
    LEFT JOIN module_configs mc ON mc.id = t.module_id
    WHERE t.user_id = ?
    ORDER BY t.created_at DESC
  `).all(req.params.id);
  res.json({ tokens });
});

adminRouter.post('/users/:id/tokens', (req: Request, res: Response) => {
  const { module_id, expires_in_days } = req.body;
  if (!module_id) { res.status(400).json({ error: 'module_id is required' }); return; }

  const db = getDatabase();

  const user = db.prepare('SELECT id FROM user WHERE id = ?').get(req.params.id);
  if (!user) { res.status(404).json({ error: 'User not found' }); return; }

  const moduleConfig = db.prepare('SELECT id FROM module_configs WHERE id = ?').get(module_id);
  if (!moduleConfig) { res.status(400).json({ error: 'Invalid module_id' }); return; }

  const existing = db.prepare('SELECT id FROM module_tokens WHERE user_id = ? AND module_id = ?')
    .get(req.params.id, module_id);
  if (existing) { res.status(409).json({ error: 'User already has a token for this module. Revoke it first.' }); return; }

  const token = generateApiToken();
  const tokenHash = hashApiToken(token);
  const tokenPrefix = token.slice(0, 12) + '...';
  const now = new Date().toISOString();

  let expiresAt: string | null = null;
  if (expires_in_days) {
    const d = new Date();
    d.setDate(d.getDate() + parseInt(expires_in_days, 10));
    expiresAt = d.toISOString();
  }

  const id = uuidv4();
  db.prepare(`
    INSERT INTO module_tokens (id, user_id, module_id, token_hash, token_prefix, enabled, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?)
  `).run(id, req.params.id, module_id, tokenHash, tokenPrefix, expiresAt, now);

  res.status(201).json({
    id, module_id, token, token_prefix: tokenPrefix,
    expires_at: expiresAt, created_at: now,
    warning: 'Save this token now. It will not be shown again.',
  });
});

adminRouter.patch('/tokens/:id', (req: Request, res: Response) => {
  const db = getDatabase();
  const existing = db.prepare('SELECT id FROM module_tokens WHERE id = ?').get(req.params.id);
  if (!existing) { res.status(404).json({ error: 'Token not found' }); return; }

  const { enabled } = req.body;
  if (enabled === undefined) { res.status(400).json({ error: 'enabled field required' }); return; }

  db.prepare('UPDATE module_tokens SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, req.params.id);
  res.json({ success: true });
});

adminRouter.delete('/tokens/:id', (req: Request, res: Response) => {
  const db = getDatabase();
  const result = db.prepare('DELETE FROM module_tokens WHERE id = ?').run(req.params.id);
  if (result.changes === 0) { res.status(404).json({ error: 'Token not found' }); return; }
  res.json({ success: true });
});

// --- Token Access Logs ---

adminRouter.get('/users/:id/token-logs', (req: Request, res: Response) => {
  const { module_id, days = '7' } = req.query;
  const { page, pageSize, offset } = parsePagination(req);
  const safeDays = Math.min(Math.max(Number(days) || 7, 1), 365);
  const db = getDatabase();

  const since = new Date();
  since.setDate(since.getDate() - safeDays);
  const sinceStr = since.toISOString();

  let whereClause = 'WHERE l.user_id = ? AND l.created_at >= ?';
  const params: any[] = [req.params.id, sinceStr];

  if (module_id) {
    whereClause += ' AND l.module_id = ?';
    params.push(module_id);
  }

  const { total } = db.prepare(`
    SELECT COUNT(*) as total FROM token_access_logs l ${whereClause}
  `).get(...params) as { total: number };

  const logs = db.prepare(`
    SELECT l.*, mc.name as module_name
    FROM token_access_logs l
    LEFT JOIN module_configs mc ON mc.id = l.module_id
    ${whereClause}
    ORDER BY l.created_at DESC LIMIT ? OFFSET ?
  `).all(...params, pageSize, offset);

  res.json({ logs, total, page, page_size: pageSize });
});
