import { Router, type Request, type Response } from 'express';
import { getDatabase } from '../db/index.js';
import { parsePagination } from '../core/http.js';
import {
  DuplicateAppError,
  deleteApp,
  getApp,
  listApps,
  parseAllowedChats,
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
import * as diaryStore from '../services/feishuAssistant/diary/store.js';
import { reviewTableUrl } from '../services/feishuAssistant/diary/bitable.js';
import {
  ACTIONS,
  allRequiredScopes,
  optionalScopeGroups,
} from '../services/feishuAssistant/actions/index.js';
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
    // 同理但更强：读群聊记录的权限（总结群聊用）在飞书后台是要额外说明用途的
    // 一档，而这是一个可选功能。混进 scopes 里的后果是**所有人**的接入流程都
    // 卡在这一项上（见 actions/index.ts 的 OPTIONAL_SCOPES）。
    // 带上 feature 说明，否则用户看到一串权限点不知道开了能干什么、不开会缺什么。
    optional_scopes: optionalScopeGroups(),
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

  // **没带 allowed_chats 就不动它**（传 undefined 下去，见 UpsertAppInput）。
  //
  // 以前这里是 `: []`，而 upsertApp 是整行替换 —— 于是任何只带部分字段的调用
  // （前端的启停开关、一键放行某个群都是这样调的）都会把白名单清空。
  // 清空不会报错，表现是「所有群都放行」（空 = 不限群），也就是一次点「停用」
  // 再点「启用」就把本模块唯一那道闸静默拆了，而界面上白名单那一栏也跟着空了，
  // 用户只会以为自己没配过。
  const chats = Array.isArray(allowed_chats)
    ? allowed_chats.map((c: unknown) => String(c).trim()).filter(Boolean)
    : undefined;

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

  // 解析统一在 appStore（dispatcher 判放行用的是同一个函数）——
  // 两处各写一份的话，页面上的「已放行」迟早和机器人的实际行为不一致，
  // 而不一致的方向恰恰是页面显示"拦住了"、实际放行。
  const { chats: allowed, malformed } = parseAllowedChats(app.allowed_chats);

  res.json({
    chats: listChats(app.app_id).map((c) => ({
      ...c,
      // 列坏了的时候 dispatcher 一律不放行，这里也得如实说 ——
      // 否则页面显示「已放行」而群里 @ 了没反应。
      in_allowlist: malformed ? false : allowed.length === 0 || allowed.includes(c.chat_id),
    })),
    // 空白名单 = 不限群。前端要据此把「已放行」标成"因为白名单是空的"，
    // 而不是"你勾过它" —— 后者会让用户以为已经设好防护了。
    allowlist_empty: !malformed && allowed.length === 0,
    // 列坏了要露出来，而且要给出处置办法（重存一次白名单）。不说的话现象是
    // 「所有群都不响应」，而配置页看起来一切正常。
    allowlist_malformed: malformed,
  });
});

// ==================== 项目日记 ====================

/**
 * 只读。**这一整节都不写库、不调飞书接口。**
 *
 * 存在的理由是那几张多维表格**不在任何人的云文档空间里**（建表时没传 folder_token）
 * 而且链接分享是主动关掉的 —— 链接被群消息刷走之后，飞书里搜不到、找不回。
 * 群里可以 @ 助理说「有哪些项目」问回来，但那要求你在群里；这一页是网页侧的入口。
 *
 * 为什么坚持只读：记录是通过 @ 助理产生的，每条都带记录人、时间、原始 message_id，
 * 而且同步是**只追加**的（推上去就置状态位，永不重推）。开一个网页写入口
 * 就得回答「网页删掉的这条，表格里那行怎么办」——答案只能是"删不掉"，
 * 于是库和表从此不一致。想改就在群里说，那条路径可追溯。
 *
 * **唯一的例外是删掉整个项目**（DELETE .../projects/:projectId）。它成立恰恰是因为
 * 上面那条理由不适用：它不试图和表格保持一致，而是**放弃**那几张表 ——
 * 飞书那侧一个字都不动，只解除关联并把链接还给用户。逐条删做不到这一点
 *（删一行就得在表里也删一行，而那是不可逆的），删掉整个项目做得到。
 */

/** 取应用 + 校验归属。返回 undefined 表示已经写过响应了。 */
function appForDiary(req: Request, res: Response) {
  const app = getApp(req.params.id);
  if (!app) {
    res.status(404).json({ error: '应用不存在' });
    return undefined;
  }
  if (!assertOwn(req, app.user_id)) {
    // 日志内容就是公司内部的项目进展 —— 越权读这里比越权改配置更糟。
    res.status(403).json({ error: '无权查看他人绑定的飞书应用' });
    return undefined;
  }
  return app;
}

/**
 * 本应用的项目清单 + 项目总表链接。
 *
 * `index_url` 可能是空串：第一个项目建出来之前总表还不存在，或者当初建总表
 * 那一步失败了。前端必须区分"空串"和"有链接"，不能渲染成一个点不动的空链接。
 */
feishuAssistantRouter.get('/apps/:id/diary/projects', (req, res) => {
  const app = appForDiary(req, res);
  if (!app) return;

  const index = diaryStore.getIndex(app.app_id);
  const stats = diaryStore.projectStats(app.app_id);

  res.json({
    index: index
      ? {
          url: index.url,
          // 关链接分享失败过的话要说出来：那意味着组织内拿到链接的人都能看。
          link_share_closed: !!index.link_share_closed,
        }
      : null,
    projects: diaryStore.listProjects(app.app_id).map((p) => ({
      id: p.id,
      name: p.name,
      chat_id: p.chat_id,
      chat_name: p.chat_name,
      // 「记录」表和「复盘」表的两个链接都给：复盘存在表里的那份是完整版
      // （群里那条被截到 1500 字），而它藏在 base 的第二张表里，
      // 不给专门的链接的话用户点进去只看到「记录」表。
      url: p.url,
      review_url: reviewTableUrl(p),
      link_share_closed: !!p.link_share_closed,
      // null = 当初写进总表那一步失败了，下次在群里记录时会自动补登记。
      in_index: !!p.index_record_id,
      created_by_name: p.created_by_name,
      created_at: p.created_at,
      // 用 store 的初值，**不要在这里抄一份字面量**：抄的那份不会跟着
      // DiaryProjectStats 加字段（任务数、群聊摘要数就是这么漏的），
      // 而漏掉的键在前端读成 undefined、渲染成空白 ——
      // 和「有数据但是 0」看起来完全一样。
      ...(stats[p.id] ?? diaryStore.emptyStats()),
    })),
  });
});

/**
 * 一个项目的日志记录，最新在前。
 *
 * project_id 必须**同时**校验 app_id：光按 id 查的话，拿到一个别家公司的
 * project_id（uuid 猜不出来，但日志页会把它印出来）就能读到那家公司的全部日志。
 */
feishuAssistantRouter.get('/apps/:id/diary/projects/:projectId/records', (req, res) => {
  const app = appForDiary(req, res);
  if (!app) return;

  const project = diaryStore.getProjectById(req.params.projectId);
  if (!project || project.app_id !== app.app_id) {
    res.status(404).json({ error: '项目不存在' });
    return;
  }

  const { pageSize, offset } = parsePagination(req, { defaultSize: 50, maxSize: 200 });
  const { records, total } = diaryStore.listRecordsPage(project.id, { limit: pageSize, offset });

  res.json({
    project: { id: project.id, name: project.name, url: project.url, review_url: reviewTableUrl(project) },
    records: records.map((r) => ({
      id: r.id,
      content: r.content,
      author_name: r.author_name,
      created_ms: r.created_ms,
      created_at: r.created_at,
      // 'manual'（人说的原话）还是 'chat_digest'（AI 从群聊归纳的）。
      // 必须露出来：这张表的全部价值在「当时到底怎么说的」，
      // 而归纳的那些和原话并排放着 —— 分不出来的话整张表就不能当证据用了。
      // 正文里有「【群聊摘要 …】」前缀，但那是给飞书表格用的兜底，
      // 网页端要能据此单独标色/筛选。
      origin: r.origin,
      // 「表里看不到这条」的唯一提示。补推是跟着下一次记录发生的（没有定时任务），
      // 所以一个不再活跃的项目可能长期停在这个状态。
      synced: !!r.bitable_synced_at,
    })),
    total,
  });
});

/** 一个项目的复盘记录。summary 是完整版（不截断的那份）。 */
feishuAssistantRouter.get('/apps/:id/diary/projects/:projectId/summaries', (req, res) => {
  const app = appForDiary(req, res);
  if (!app) return;

  const project = diaryStore.getProjectById(req.params.projectId);
  if (!project || project.app_id !== app.app_id) {
    res.status(404).json({ error: '项目不存在' });
    return;
  }

  const { pageSize, offset } = parsePagination(req, { defaultSize: 20, maxSize: 100 });
  const { summaries, total } = diaryStore.listSummariesPage(project.id, {
    limit: pageSize,
    offset,
  });

  res.json({
    project: { id: project.id, name: project.name, review_url: reviewTableUrl(project) },
    summaries: summaries.map((s) => ({
      id: s.id,
      range_label: s.range_label,
      record_count: s.record_count,
      // 群里那条被截到 1500 字，这里是完整版 —— 这也是这个接口的主要价值。
      summary: s.summary,
      created_by_name: s.created_by_name,
      created_at: s.created_at,
      synced: !!s.bitable_synced_at,
    })),
    total,
  });
});

/**
 * 删掉一个项目。**只删库里的关联，飞书那侧一个字都不动**，见 store.deleteProject。
 *
 * 回执里必须把那几张表的链接原样返回，而且前端必须显示出来。理由是那些表
 * 不在任何人的云文档空间里、链接分享也是关掉的：删掉项目行之后，
 * **这是最后一次能拿到链接的机会** —— 助理不再认识这个项目，
 * 群里问「有哪些项目」也不会再列出它。回执不给链接的话，
 * 这个操作看起来是"删掉了一个条目"，实际是把几张还活着的表变成了找不回的孤儿。
 */
feishuAssistantRouter.delete('/apps/:id/diary/projects/:projectId', (req, res) => {
  const app = appForDiary(req, res);
  if (!app) return;

  // 同 records/summaries：必须**同时**校验 app_id。光按 id 删的话，
  // 拿到别家公司的 project_id 就能删掉那家公司的日志关联。
  const project = diaryStore.getProjectById(req.params.projectId);
  if (!project || project.app_id !== app.app_id) {
    res.status(404).json({ error: '项目不存在' });
    return;
  }

  const removed = diaryStore.deleteProject(project.id);
  if (!removed) {
    res.status(404).json({ error: '项目不存在' });
    return;
  }

  res.json({
    ok: true,
    deleted: {
      name: removed.project.name,
      chat_id: removed.project.chat_id,
      record_count: removed.recordCount,
      summary_count: removed.summaryCount,
      // 飞书里还活着的那几张表。空串表示当初就没建出来（前端别渲染死链接）。
      log_url: removed.project.url,
      review_url: reviewTableUrl(removed.project),
      task_url: removed.project.task_base_url,
      // 总表那一行也留着（它是事后找回上面几个链接的唯一途径），
      // 于是总表会继续列着这个项目 —— 说出来，否则用户下次打开总表会以为没删掉。
      still_in_index: !!removed.project.index_record_id,
    },
  });
});

// ==================== 本企业的补充规则 ====================

/**
 * 一段规则最多多长。
 *
 * 不是防滥用，是防**自伤**：这段话每解析一条指令就随 prompt 发一次，塞一份员工手册
 * 进来的直接后果是每条指令都变贵变慢，而且长文本会把后面的硬性规则（open_id 只许照抄、
 * 输出必须是 JSON）压下去 —— 表现是助理"忽然开始把任务派给错的人"，
 * 没人会想到是这个文本框。
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

  // 按群（= 按项目）筛。**不需要额外的归属校验**：非管理员的查询已经被
  // user_id 钉死，传一个别人的 chat_id 只会得到空结果，不会越权。
  // 管理员本来就看全部。
  const chatId = req.query.chat_id ? String(req.query.chat_id) : undefined;

  const { commands, total } = listCommands({
    userId: isAdmin ? undefined : req.user!.id,
    appId,
    chatId,
    status: req.query.status ? String(req.query.status) : undefined,
    limit: pageSize,
    offset,
  });

  // 群名和项目名要一起给。
  //
  // 光有 `chat_id` 等于没有：`oc_xxx` 在飞书客户端里**看不到**，用户没有
  // 任何办法把日志里那一行对上他心里的那个群。而这一页存在的意义正是
  // 「A 项目那条记录到底进去了没有」，认不出群就等于认不出项目。
  const labels = chatLabels(commands.map((c) => ({ appId: c.app_id, chatId: c.chat_id })));

  // error_detail 在库里是 JSON 字符串，这里解开成对象 ——
  // 让前端 JSON.parse 一遍没有意义，而且坏数据会炸在渲染里。
  res.json({
    commands: commands.map((c) => ({
      ...c,
      error_detail: parseDetail(c.error_detail),
      ...(labels[`${c.app_id} ${c.chat_id}`] ?? { chat_name: '', project_name: '' }),
    })),
    total,
    // 筛选下拉的选项。只在指定了 app_id 时给：不指定时（管理员看全部）
    // 各家公司的群会混在一个下拉里，而群名在不同租户之间可能重名，
    // 选出来的结果对不上用户的预期。
    chats: appId ? chatOptions(appId) : [],
  });
});

/**
 * 一批 (app_id, chat_id) 的群名 / 项目名。
 *
 * 两个来源都要查，而且**项目名优先显示、群名兜底**：
 * - `feishu_diary_projects` 有项目名（用户真正记得的那个称呼）；
 * - `feishu_chats` 有群名，但它只在机器人被拉进群时能拿到（要 `im:chat:readonly`，
 *   那不是必需权限），所以经常是空串。
 * 两个都空时前端显示 chat_id 的后几位 —— 认不出来，但至少不是一片空白。
 */
function chatLabels(
  keys: Array<{ appId: string; chatId: string }>
): Record<string, { chat_name: string; project_name: string }> {
  const appIds = [...new Set(keys.map((k) => k.appId).filter(Boolean))];
  if (appIds.length === 0) return {};
  const out: Record<string, { chat_name: string; project_name: string }> = {};
  for (const appId of appIds) {
    for (const c of listChats(appId)) {
      out[`${appId} ${c.chat_id}`] = { chat_name: c.name, project_name: '' };
    }
    for (const p of diaryStore.listProjects(appId)) {
      const k = `${appId} ${p.chat_id}`;
      out[k] = {
        // 项目行里也存了建项目那一刻的群名，chatStore 没有时用它。
        chat_name: out[k]?.chat_name || p.chat_name,
        project_name: p.name,
      };
    }
  }
  return out;
}

/** 某个应用的「群 / 项目」下拉选项。见 GET /commands 里 `chats` 字段的注释。 */
function chatOptions(
  appId: string
): Array<{ chat_id: string; chat_name: string; project_name: string }> {
  const labels = chatLabels(listChats(appId).map((c) => ({ appId, chatId: c.chat_id })));
  const seen = new Set<string>();
  const out: Array<{ chat_id: string; chat_name: string; project_name: string }> = [];
  // 有项目的群排前面：这一页的主要用途是查项目里的指令。
  for (const p of diaryStore.listProjects(appId)) {
    seen.add(p.chat_id);
    out.push({
      chat_id: p.chat_id,
      chat_name: labels[`${appId} ${p.chat_id}`]?.chat_name || p.chat_name,
      project_name: p.name,
    });
  }
  for (const c of listChats(appId)) {
    if (seen.has(c.chat_id)) continue;
    out.push({ chat_id: c.chat_id, chat_name: c.name, project_name: '' });
  }
  return out;
}

/** 解 error_detail。历史行是 null，解析失败也当没有：日志页不该因为一行坏数据打不开。 */
function parseDetail(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
