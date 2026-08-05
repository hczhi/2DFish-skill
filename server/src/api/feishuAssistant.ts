import { Router } from 'express';
import { getDatabase } from '../db/index.js';
import { parsePagination } from '../core/http.js';
import {
  DuplicateAppError,
  deleteApp,
  getApp,
  listApps,
  setIntentSupplement,
  toView,
  upsertApp,
} from '../services/feishuAssistant/appStore.js';
import {
  clientFor,
  connectApp,
  connectionStatus,
  disconnectApp,
} from '../services/feishuAssistant/connection.js';
import { listCommands } from '../services/feishuAssistant/commandLog.js';
import { listChats } from '../services/feishuAssistant/chatStore.js';
import { ACTIONS, allRequiredScopes } from '../services/feishuAssistant/actions/index.js';
import { listDepartments, listUsers } from '../services/feishuAssistant/directory/store.js';
import { DIRECTORY_SCOPES, syncDirectory } from '../services/feishuAssistant/directory/sync.js';
import { getSkillForSlot } from '../services/skillRegistryService.js';

export const feishuAssistantRouter = Router();

// 飞书助理的管理接口。全部 PROTECTED（默认级别，无需在 middleware 里登记）——
// 事件是通过长连接进来的，没有需要对外开放的回调端点，
// 所以本模块不引入任何 public 路由，也就没有 webhook 方案里的验签面。

// 后台管理页复用同一批接口 —— 管理员在 GET /apps、GET /commands 里天然看到全部，
// assertOwn 也放行管理员对任意应用的启停/删除，所以不需要另开一套 /admin/* 路由。

/** 每个应用只能由归属账号或管理员操作。 */
function assertOwn(req: { user?: { id: string; role: string } }, appUserId: string): boolean {
  return req.user!.role === 'admin' || req.user!.id === appUserId;
}

// ==================== 能力清单 ====================

/**
 * 助理支持的动作，以及需要在飞书开发者后台开通的权限点。
 * 前端把这个直接渲染成「接入前请先开通以下权限」——权限没开时飞书返回的
 * error code 很难对应到具体缺哪一项，让用户一次配齐比事后猜要省事得多。
 */
feishuAssistantRouter.get('/capabilities', (_req, res) => {
  res.json({
    actions: ACTIONS.map((a) => ({
      name: a.name,
      description: a.description,
      examples: a.examples,
      scopes: a.scopes,
    })),
    scopes: allRequiredScopes(),
    // 单列一份：名册同步的权限和动作权限的性质不一样 ——
    // 不开也能用助理（只是必须 @ 到人），前端据此把它渲染成「可选，但强烈建议」。
    directory_scopes: DIRECTORY_SCOPES,
    events: ['im.message.receive_v1'],
    // 应用没填补充规则时实际生效的那份（migration 056 播的示例模板）。
    // 前端「填入示例模板」按钮用它，而不是在客户端再抄一份 —— 抄一份的话，
    // 管理员改了平台模板之后按钮填出来的还是旧的，而用户以为那就是当前默认。
    default_supplement: getSkillForSlot('feishu-intent') || '',
  });
});

// ==================== 应用绑定 ====================

feishuAssistantRouter.get('/apps', (req, res) => {
  // 管理员看全部，普通用户只看自己的。
  const isAdmin = req.user!.role === 'admin';
  const rows = isAdmin ? listApps() : listApps(req.user!.id);

  // 管理员视角要能看出"这个应用花的是谁的额度"，光有 user_id 看不出来。
  // 只在管理员分支查用户名：普通用户看到的全是自己的应用，没有意义。
  const names = isAdmin ? usernamesFor(rows.map((r) => r.user_id)) : {};

  res.json({
    apps: rows.map((r) => ({
      ...toView(r),
      live_state: connectionStatus(r.app_id),
      ...(isAdmin ? { owner_username: names[r.user_id] ?? '（用户已删除）' } : {}),
    })),
  });
});

/** 批量取用户名，避免每行一次查询。 */
function usernamesFor(userIds: string[]): Record<string, string> {
  const unique = [...new Set(userIds)];
  if (unique.length === 0) return {};
  const rows = getDatabase()
    .prepare(`SELECT id, username FROM user WHERE id IN (${unique.map(() => '?').join(',')})`)
    .all(...unique) as Array<{ id: string; username: string }>;
  return Object.fromEntries(rows.map((r) => [r.id, r.username]));
}

feishuAssistantRouter.post('/apps', async (req, res) => {
  const { id, name, app_id, app_secret, enabled, allowed_chats } = req.body ?? {};

  if (!id && (!app_id || !app_secret)) {
    res.status(400).json({ error: '新增应用必须填 App ID 和 App Secret' });
    return;
  }

  const existing = id ? getApp(String(id)) : undefined;
  if (id && !existing) {
    res.status(404).json({ error: '应用不存在' });
    return;
  }
  if (existing && !assertOwn(req, existing.user_id)) {
    res.status(403).json({ error: '无权修改他人绑定的飞书应用' });
    return;
  }

  const chats = Array.isArray(allowed_chats)
    ? allowed_chats.map((c: unknown) => String(c).trim()).filter(Boolean)
    : [];

  let saved;
  try {
    saved = upsertApp({
      id: existing?.id,
      // 归属账号不允许通过请求体指定，否则管理员之外的人可以把应用挂到别人账号下
      // （从而消耗别人的 AI 额度）。编辑时保持原归属。
      userId: existing?.user_id ?? req.user!.id,
      name: String(name ?? '').trim() || '飞书助理',
      appId: String(app_id ?? existing?.app_id ?? '').trim(),
      appSecret: String(app_secret ?? ''),
      enabled: enabled === undefined ? true : !!enabled,
      allowedChats: chats,
    });
  } catch (e) {
    if (e instanceof DuplicateAppError) {
      res.status(409).json({ error: e.message });
      return;
    }
    throw e;
  }

  // 连接状态跟着配置走：启用就（重）连，停用就断开。
  // 建连失败要把原因回给用户——凭证填错是最常见的情况，静默失败会让他以为绑好了。
  let connError = '';
  try {
    if (saved.enabled) await connectApp(saved);
    else await disconnectApp(saved.app_id);
  } catch (e) {
    connError = e instanceof Error ? e.message : String(e);
  }

  // 绑定成功后自动同步一次组织架构。
  //
  // 放在绑定流程里而不是让用户额外点一次按钮：名册决定了「私聊里能不能指名同事」，
  // 而用户在绑定的那一刻并不知道有这回事，等他发现「给张三发消息」不好用时，
  // 大概会以为是功能坏了。同样不 await（几十秒），失败也不影响绑定 ——
  // 权限没开是最常见的情况，状态会写进 dir_sync_error 供他事后处理。
  // 只在从未同步过时触发：编辑名称/白名单不该顺手重跑一次全量同步。
  if (saved.enabled && !connError && (saved.dir_sync_state || 'idle') === 'idle') {
    void syncDirectory(clientFor(saved), saved.app_id, {
      onLog: (msg) => console.log(`[feishu][dir] ${saved.app_id} ${msg}`),
    }).catch((e) => {
      console.error(`[feishu][dir] ${saved.app_id} 首次同步失败:`, e instanceof Error ? e.message : e);
    });
  }

  const fresh = getApp(saved.id)!;
  res.json({
    app: { ...toView(fresh), live_state: connectionStatus(fresh.app_id) },
    conn_error: connError || undefined,
  });
});

feishuAssistantRouter.delete('/apps/:id', async (req, res) => {
  const app = getApp(req.params.id);
  if (!app) {
    res.status(404).json({ error: '应用不存在' });
    return;
  }
  if (!assertOwn(req, app.user_id)) {
    res.status(403).json({ error: '无权删除他人绑定的飞书应用' });
    return;
  }
  // 先断连再删行：反过来的话连接会成为孤儿，事件进来后查不到应用配置。
  await disconnectApp(app.app_id);
  deleteApp(app.id);
  res.json({ ok: true });
});

/**
 * 手动重连。凭证没改但连接掉了（网络抖动、飞书侧重启）时的自助入口，
 * 否则用户只能重启整个服务。
 */
feishuAssistantRouter.post('/apps/:id/reconnect', async (req, res) => {
  const app = getApp(req.params.id);
  if (!app) {
    res.status(404).json({ error: '应用不存在' });
    return;
  }
  if (!assertOwn(req, app.user_id)) {
    res.status(403).json({ error: '无权操作他人绑定的飞书应用' });
    return;
  }
  if (!app.enabled) {
    res.status(400).json({ error: '该应用已停用，请先启用再重连' });
    return;
  }
  try {
    await connectApp(app);
    res.json({ ok: true, live_state: connectionStatus(app.app_id) });
  } catch (e) {
    res.status(502).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ==================== 组织架构名册 ====================

/**
 * 触发一次名册同步。
 *
 * **不 await** syncDirectory：大企业的部门树是几十上百次接口调用，能跑几十秒，
 * HTTP 请求早超时了。状态全程写在 feishu_apps.dir_sync_*，前端轮询 GET /apps 即可。
 * 因此这里返回 202 而不是 200 —— 语义上「已受理，还没做完」。
 */
feishuAssistantRouter.post('/apps/:id/directory/sync', (req, res) => {
  const app = getApp(req.params.id);
  if (!app) {
    res.status(404).json({ error: '应用不存在' });
    return;
  }
  if (!assertOwn(req, app.user_id)) {
    res.status(403).json({ error: '无权操作他人绑定的飞书应用' });
    return;
  }
  if (!app.app_id || !app.app_secret) {
    res.status(400).json({ error: '请先填好 App ID 和 App Secret' });
    return;
  }
  // 已经在同步就直接返回，不排第二个。两次同步并发跑会互相 DELETE 对方刚插进去的行，
  // 最后剩下的是哪一半取决于时序。
  if (app.dir_sync_state === 'syncing') {
    res.status(409).json({ error: '正在同步中，请稍候' });
    return;
  }

  const started = syncDirectory(clientFor(app), app.app_id, {
    onLog: (msg) => console.log(`[feishu][dir] ${app.app_id} ${msg}`),
  });
  // syncDirectory 内部已经把失败写进 dir_sync_error 了，这里只是别让它变成
  // unhandledRejection —— 那会在某些 Node 配置下直接结束进程。
  started.catch((e) => {
    console.error(`[feishu][dir] ${app.app_id} 同步失败:`, e instanceof Error ? e.message : e);
  });

  res.status(202).json({ ok: true, state: 'syncing' });
});

/** 名册内容。后台名册页用：搜人、看部门归属、确认某个人在不在里面。 */
feishuAssistantRouter.get('/apps/:id/directory', (req, res) => {
  const app = getApp(req.params.id);
  if (!app) {
    res.status(404).json({ error: '应用不存在' });
    return;
  }
  if (!assertOwn(req, app.user_id)) {
    res.status(403).json({ error: '无权查看他人绑定的飞书应用' });
    return;
  }

  const { pageSize, offset } = parsePagination(req, { defaultSize: 50, maxSize: 200 });
  const { users, total } = listUsers({
    appId: app.app_id,
    q: req.query.q ? String(req.query.q) : undefined,
    limit: pageSize,
    offset,
  });

  res.json({
    users,
    total,
    departments: listDepartments(app.app_id),
    sync: {
      state: app.dir_sync_state || 'idle',
      error: app.dir_sync_error ?? null,
      at: app.dir_sync_at ?? null,
      user_count: app.dir_user_count ?? 0,
      source: app.dir_source || '',
    },
  });
});

// ==================== 会话（群）清单 ====================

/**
 * 机器人见过的会话。前端用它把白名单从「手打 chat_id」变成「勾选群名」。
 *
 * chat_id 在飞书客户端里看不到，所以没有这个接口时，配白名单的唯一办法是
 * 先不设防跑一遍、再去指令日志里把那串 id 抄出来。
 *
 * 返回值里 `in_allowlist` 是**服务端算的**：白名单为空时等于全部放行，
 * 让前端各自实现这条规则的话，两个页面（用户侧 / 后台）迟早有一个算错。
 */
feishuAssistantRouter.get('/apps/:id/chats', (req, res) => {
  const app = getApp(req.params.id);
  if (!app) {
    res.status(404).json({ error: '应用不存在' });
    return;
  }
  if (!assertOwn(req, app.user_id)) {
    res.status(403).json({ error: '无权查看他人绑定的飞书应用' });
    return;
  }

  let allowed: string[] = [];
  try {
    const parsed = JSON.parse(app.allowed_chats || '[]');
    if (Array.isArray(parsed)) allowed = parsed.filter((c): c is string => typeof c === 'string');
  } catch {
    allowed = [];
  }

  res.json({
    chats: listChats(app.app_id).map((c) => ({
      ...c,
      in_allowlist: allowed.length === 0 || allowed.includes(c.chat_id),
    })),
    // 空白名单 = 不限群。前端要据此把「已放行」标成"因为白名单是空的"，
    // 而不是"你勾过它" —— 后者会让用户以为已经设好防护了。
    allowlist_empty: allowed.length === 0,
  });
});

// ==================== 本企业的补充规则 ====================

/**
 * 一段规则最多多长。
 *
 * 不是防滥用，是防**自伤**：这段话每解析一条指令就随 prompt 发一次，塞一份员工手册
 * 进来的直接后果是每条指令都变贵变慢，而且长文本会把后面的硬性规则（open_id 只许照抄、
 * 输出必须是 JSON）压下去 —— 表现是助理"忽然开始乱发消息"，没人会想到是这个文本框。
 * 真正有用的内容（术语、简称、时间习惯）几百字就够。
 */
const MAX_SUPPLEMENT_CHARS = 4000;

/**
 * 保存本企业的补充规则（migration 059）。
 *
 * 单独一个端点而不是并进 `POST /apps`：那个是整行替换语义，而前端有好几处只带
 * 部分字段就调它（启停、一键放行某个群）。挂上去的话任何一次这种调用都会把
 * 用户写的规则清空，且几天后才会被察觉（"助理忽然听不懂话了"）。
 * 见 appStore.setIntentSupplement 的注释。
 *
 * 空串是合法值 —— 意思是「回落到平台默认那份示例模板」，不是「忽略本次请求」。
 */
feishuAssistantRouter.put('/apps/:id/intent-supplement', (req, res) => {
  const app = getApp(req.params.id);
  if (!app) {
    res.status(404).json({ error: '应用不存在' });
    return;
  }
  if (!assertOwn(req, app.user_id)) {
    res.status(403).json({ error: '无权修改他人绑定的飞书应用' });
    return;
  }

  const text = String(req.body?.text ?? '').trim();
  if (text.length > MAX_SUPPLEMENT_CHARS) {
    res.status(400).json({
      error: `补充规则最多 ${MAX_SUPPLEMENT_CHARS} 字（当前 ${text.length} 字）。这段话每条指令都会发给模型，太长会挤掉后面的硬性规则。`,
    });
    return;
  }

  setIntentSupplement(app.id, text);
  // 回整行（而不是 { ok: true }）：前端那一页同时显示"填了没"的徽章，
  // 少一次刷新就少一次两边不一致的机会。连接不用重建 —— dispatcher 每条消息
  // 都从库里重取应用行（connection.ts 的 `current`），所以下一条指令就生效。
  res.json({ app: { ...toView(getApp(app.id)!), live_state: connectionStatus(app.app_id) } });
});

// ==================== 指令日志 ====================

feishuAssistantRouter.get('/commands', (req, res) => {
  const { pageSize, offset } = parsePagination(req, { defaultSize: 50, maxSize: 100 });
  const isAdmin = req.user!.role === 'admin';

  // 非管理员钉死成自己的记录。app_id 筛选也要校验归属，
  // 否则传别人的 app_id 就能读到别人群里说过的话。
  const appId = req.query.app_id ? String(req.query.app_id) : undefined;
  if (appId && !isAdmin) {
    const rows = listApps(req.user!.id);
    if (!rows.some((r) => r.app_id === appId)) {
      res.status(403).json({ error: '无权查看该应用的指令日志' });
      return;
    }
  }

  const { commands, total } = listCommands({
    userId: isAdmin ? undefined : req.user!.id,
    appId,
    status: req.query.status ? String(req.query.status) : undefined,
    limit: pageSize,
    offset,
  });

  // error_detail 在库里是 JSON 字符串，这里解开成对象 ——
  // 让前端 JSON.parse 一遍没有意义，而且坏数据会炸在渲染里。
  res.json({
    commands: commands.map((c) => ({ ...c, error_detail: parseDetail(c.error_detail) })),
    total,
  });
});

/** 解 error_detail。历史行是 null，解析失败也当没有：日志页不该因为一行坏数据打不开。 */
function parseDetail(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
