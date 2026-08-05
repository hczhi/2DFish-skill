import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../../db/index.js';
import { encryptSecret, maskSecret, resolveSubmittedSecret } from '../../core/secrets.js';
import { deleteDirectory } from './directory/store.js';
import { deleteChats } from './chatStore.js';

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

export function toView(row: FeishuApp): FeishuAppView {
  let chats: string[] = [];
  try {
    const parsed = JSON.parse(row.allowed_chats || '[]');
    if (Array.isArray(parsed)) chats = parsed.filter((c): c is string => typeof c === 'string');
  } catch {
    chats = [];
  }
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
  allowedChats: string[];
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

  const chats = JSON.stringify(input.allowedChats);

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
