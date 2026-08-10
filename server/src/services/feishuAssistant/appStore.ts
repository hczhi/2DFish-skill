import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../../db/index.js';
import { encryptSecret, maskSecret, resolveSubmittedSecret } from '../../core/secrets.js';
import { deleteDirectory } from './directory/store.js';
import { deleteChats } from './chatStore.js';
import { deleteDiaryData } from './diary/store.js';

// feishu_apps 表的读写。密文只在这一层进出，上层拿到的 app_secret 一律是密文，
// 真正解密发生在 client.ts 建 SDK client 的那一个点（和 feishuBitable.ts 同样的约定）。

export interface FeishuApp {
  id: string;
  user_id: string;
  name: string;
  app_id: string;
  app_secret: string;
  enabled: number;
  allowed_chats: string;
  conn_state: string;
  conn_error: string | null;
  conn_at: string | null;
  /** 组织架构名册的同步状态，见 migrations/057 与 directory/sync.ts */
  dir_sync_state: string;
  dir_sync_error: string | null;
  dir_sync_at: string | null;
  dir_user_count: number;
  dir_source: string;
  /**
   * 本企业的补充规则（059）。追加到意图解析 prompt 上，只用来帮模型听懂
   * 这家公司的说法。空串 = 回落到平台默认（skill slot `feishu-intent`）。
   */
  intent_supplement: string;
  created_at: string;
  updated_at: string;
}

/** 给前端的形状：secret 脱敏，allowed_chats 解析成数组。 */
export interface FeishuAppView {
  id: string;
  user_id: string;
  name: string;
  app_id: string;
  app_secret: string;
  enabled: boolean;
  allowed_chats: string[];
  conn_state: string;
  conn_error: string | null;
  conn_at: string | null;
  dir_sync_state: string;
  dir_sync_error: string | null;
  dir_sync_at: string | null;
  dir_user_count: number;
  dir_source: string;
  intent_supplement: string;
  created_at: string;
  updated_at: string;
}

/** 白名单解析的结果。`malformed` 那一位是本文件里最要紧的一个字段，见下。 */
export interface AllowedChats {
  chats: string[];
  /**
   * 库里那串东西**不是**我们写进去的形状（不是 JSON、或不是数组）。
   *
   * 必须和「空数组」分开表示：空数组是有意义的配置（= 不限群），而解析失败
   * 意味着**我们不知道用户配了什么**。两者混成一个空数组的话，一次数据损坏
   * 就把「只放行三个群」静默变成「所有群都放行」—— 这是本模块唯一一道
   * 防止任何人把机器人拉进自己的群、烧掉绑定账号 AI 额度的闸。
   */
  malformed: boolean;
}

/**
 * 解析 `allowed_chats` 列。**只有这一个地方解析它。**
 *
 * 以前 dispatcher、toView、`GET /apps/:id/chats` 各写了一份一模一样的
 * try/catch，而「空 = 不限群」这条规则是靠三处各自记得来保证的 ——
 * 其中任何一处算错，用户看到的都是「已放行」（读起来像"防护已生效"）。
 */
export function parseAllowedChats(raw: string | null | undefined): AllowedChats {
  const text = (raw ?? '').trim();
  // 空列本身是合法的初始状态（刚绑定、还没配），不算损坏。
  if (!text) return { chats: [], malformed: false };
  try {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) return { chats: [], malformed: true };
    return {
      chats: parsed.filter((c): c is string => typeof c === 'string' && !!c.trim()),
      malformed: false,
    };
  } catch {
    return { chats: [], malformed: true };
  }
}

export function toView(row: FeishuApp): FeishuAppView {
  const { chats } = parseAllowedChats(row.allowed_chats);
  return {
    id: row.id,
    user_id: row.user_id,
    name: row.name,
    app_id: row.app_id,
    app_secret: maskSecret(row.app_secret),
    enabled: !!row.enabled,
    allowed_chats: chats,
    conn_state: row.conn_state,
    conn_error: row.conn_error,
    conn_at: row.conn_at,
    // 这几列是 057 加的。都兜一个默认值——前端拿到 undefined 会渲染成空白徽章。
    dir_sync_state: row.dir_sync_state || 'idle',
    dir_sync_error: row.dir_sync_error ?? null,
    dir_sync_at: row.dir_sync_at ?? null,
    dir_user_count: row.dir_user_count ?? 0,
    dir_source: row.dir_source || '',
    intent_supplement: row.intent_supplement || '',
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function listApps(userId?: string): FeishuApp[] {
  const db = getDatabase();
  // userId 省略 = 管理员看全部 / 启动时拉全部去建连。
  return userId
    ? (db
        .prepare('SELECT * FROM feishu_apps WHERE user_id = ? ORDER BY created_at DESC')
        .all(userId) as FeishuApp[])
    : (db.prepare('SELECT * FROM feishu_apps ORDER BY created_at DESC').all() as FeishuApp[]);
}

export function listEnabledApps(): FeishuApp[] {
  return getDatabase()
    .prepare("SELECT * FROM feishu_apps WHERE enabled = 1 AND app_id <> '' AND app_secret <> ''")
    .all() as FeishuApp[];
}

export function getApp(id: string): FeishuApp | undefined {
  return getDatabase().prepare('SELECT * FROM feishu_apps WHERE id = ?').get(id) as
    | FeishuApp
    | undefined;
}

export function getAppByAppId(appId: string): FeishuApp | undefined {
  return getDatabase().prepare('SELECT * FROM feishu_apps WHERE app_id = ?').get(appId) as
    | FeishuApp
    | undefined;
}

export class DuplicateAppError extends Error {
  constructor(appId: string) {
    super(`飞书应用 ${appId} 已被绑定。同一个应用不能绑定两次——那会建两条长连接，同一条消息被处理两遍。`);
    this.name = 'DuplicateAppError';
  }
}

export interface UpsertAppInput {
  id?: string;
  userId: string;
  name: string;
  appId: string;
  /** 明文；空串或与脱敏值相同表示"不修改"（编辑场景） */
  appSecret: string;
  enabled: boolean;
  /**
   * 群白名单。**`undefined` = 不改动**（编辑场景里没带这个字段）。
   *
   * 和 `appSecret` 的「空串 = 不改」是同一类保护，理由更硬：这个函数是整行替换
   * 语义，而调用方有好几处只带部分字段（启停应用、一键放行某个群）。
   * 传 `[]` 兜底的话，任何一次这种调用都会把用户配好的白名单清空 ——
   * 清空的表现不是报错，是**所有群都被放行**（空 = 不限群），
   * 也就是一次「停用/启用」把唯一那道闸静默拆了。
   * 想真正清空就显式传 `[]`。
   */
  allowedChats?: string[];
}

export function upsertApp(input: UpsertAppInput): FeishuApp {
  const db = getDatabase();
  const now = new Date().toISOString();
  const existing = input.id ? getApp(input.id) : undefined;

  // app_id 唯一。UNIQUE 索引会拦，但那样抛出来的是 SQLITE_CONSTRAINT，
  // 前端只会看到 500；这里先查一次好给出能读懂的原因。
  const clash = getAppByAppId(input.appId);
  if (clash && clash.id !== existing?.id) throw new DuplicateAppError(input.appId);

  const secret = existing
    ? resolveSubmittedSecret(input.appSecret, existing.app_secret)
    : encryptSecret(input.appSecret);

  // 没带 allowedChats = 保留库里那份原样（见 UpsertAppInput 上的注释）。
  const chats =
    input.allowedChats === undefined
      ? (existing?.allowed_chats ?? '[]')
      : JSON.stringify(input.allowedChats);

  if (existing) {
    db.prepare(
      `UPDATE feishu_apps SET name = ?, app_id = ?, app_secret = ?, enabled = ?,
       allowed_chats = ?, updated_at = ? WHERE id = ?`
    ).run(input.name, input.appId, secret, input.enabled ? 1 : 0, chats, now, existing.id);
    return getApp(existing.id)!;
  }

  const id = uuidv4();
  db.prepare(
    `INSERT INTO feishu_apps
       (id, user_id, name, app_id, app_secret, enabled, allowed_chats, conn_state, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'idle', ?, ?)`
  ).run(id, input.userId, input.name, input.appId, secret, input.enabled ? 1 : 0, chats, now, now);
  return getApp(id)!;
}

export function deleteApp(id: string): boolean {
  const existing = getApp(id);
  const removed = getDatabase().prepare('DELETE FROM feishu_apps WHERE id = ?').run(id).changes > 0;
  // 名册按 app_id 存（不是行 id），没有外键级联。不清的话解绑后重新绑同一个应用，
  // 会直接拿到一份可能已经过期几个月的旧名册，而界面显示「从未同步」。
  if (removed && existing) {
    deleteDirectory(existing.app_id);
    // 会话表同理（058）：留着它，重新绑定后「机器人在哪些群里」显示的是上一次的群，
    // 而机器人可能早就被踢出去了。
    deleteChats(existing.app_id);
    // 项目日记（066）也按 app_id 存。这一份清起来后果最重，值得说清楚：
    // 留着它，重新绑定同一个应用后，那些项目会指向**上一次建的多维表格**，
    // 而新应用（新的 tenant_access_token 身份）对那些表没有任何权限 ——
    // 表现是「记一下」永远同步失败，而项目看起来是好的。
    // 多维表格本身不删（那是用户的数据，删了没有回收站）；解绑意味着
    // 这些表从此归飞书那边的所有者管，不再由助理维护。
    deleteDiaryData(existing.app_id);
  }
  return removed;
}

/**
 * 保存本企业的补充规则（059）。
 *
 * **刻意不并进 `upsertApp`**：那个函数是整行替换语义，而前端有好几处只带部分
 * 字段就调它（停用/启用、从提示里一键放行某个群）。规则一旦挂在它上面，
 * 任何一次这样的调用都会把用户写了半天的那段话清成空串 —— 和白名单
 * 「保存时静默丢掉没列出来的 id」是同一类事故，只是更难发现（没人会立刻
 * 去重读那段规则，只会在几天后觉得助理"忽然听不懂话了"）。
 *
 * 空串是有意义的值（= 回落到平台默认），所以这里不做"空就跳过"。
 */
export function setIntentSupplement(id: string, text: string): boolean {
  return (
    getDatabase()
      .prepare('UPDATE feishu_apps SET intent_supplement = ?, updated_at = ? WHERE id = ?')
      .run(text, new Date().toISOString(), id).changes > 0
  );
}

export function setConnState(appId: string, state: string, error?: string | null): void {
  getDatabase()
    .prepare('UPDATE feishu_apps SET conn_state = ?, conn_error = ?, conn_at = ? WHERE app_id = ?')
    .run(state, error ?? null, new Date().toISOString(), appId);
}
