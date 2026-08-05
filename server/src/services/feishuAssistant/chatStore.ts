import { getDatabase } from '../../db/index.js';

// 机器人见过的会话（migration 058）。
//
// 存在的理由是 chat_id（`oc_xxx`）在飞书客户端里看不到。没有这张表时，
// 配白名单的唯一办法是：先把白名单留空（= 不设防）→ 在群里 @ 一次 →
// 去指令日志里把那串 id 抄出来 → 回来粘上。中间那一步"不设防"是真的不设防，
// 而绝大多数人不会回来做最后一步。
//
// 两个写入口，对应用户会遇到的两种情形：
//   - `recordBotAdded`  机器人被拉进群时（有群名，最好的情况）
//   - `recordRejected`  白名单外被拦时（只有 id，但至少告诉用户"这个群在敲门"）
//
// 一行 = 一个会话，所以本表天然有界（机器人在多少个群里就多少行），不需要定期清理。

export interface ChatRow {
  app_id: string;
  chat_id: string;
  name: string;
  chat_type: string;
  source: string;
  added_by: string;
  first_seen_at: string;
  last_seen_at: string;
  reject_count: number;
  last_rejected_at: string | null;
}

/**
 * 机器人被拉进一个会话。
 *
 * 群名可能拿不到（`getChatInfo` 要 `im:chat:readonly`，而它不在必需权限里）。
 * 拿不到时**不要用空串盖掉已有的名字** —— 第二次被拉进同一个群时
 * 那次成功查到的名字会被抹掉，用户又只剩一串 id 可看。
 */
export function recordBotAdded(input: {
  appId: string;
  chatId: string;
  name?: string;
  chatType?: string;
  addedBy?: string;
}): void {
  const now = new Date().toISOString();
  const name = (input.name ?? '').trim();
  getDatabase()
    .prepare(
      `INSERT INTO feishu_chats
         (app_id, chat_id, name, chat_type, source, added_by, first_seen_at, last_seen_at)
       VALUES (?, ?, ?, ?, 'bot_added', ?, ?, ?)
       ON CONFLICT(app_id, chat_id) DO UPDATE SET
         -- 新名字为空时保留旧的：见函数注释。
         name = CASE WHEN excluded.name <> '' THEN excluded.name ELSE feishu_chats.name END,
         chat_type = excluded.chat_type,
         -- 曾经只是"被拦过"的群，这次被正式拉进来了，来源要升级。
         source = 'bot_added',
         added_by = CASE WHEN excluded.added_by <> '' THEN excluded.added_by ELSE feishu_chats.added_by END,
         last_seen_at = excluded.last_seen_at`
    )
    .run(input.appId, input.chatId, name, input.chatType ?? 'group', input.addedBy ?? '', now, now);
}

/**
 * 一条来自白名单外群聊的指令被拦下了。
 *
 * **刻意不写 feishu_commands**：那张表是"已受理指令"的日志，而这条消息恰恰
 * 没有被受理（没花额度、没调 LLM）。写进去还会有个更实际的问题——任何人
 * 把机器人拉进群，就能往别人的日志里灌行。所以这里只在会话维度累加一个计数：
 * 「这个群 @ 过你 7 次，全被白名单拦了」，用户看一眼就知道要不要放行。
 */
export function recordRejected(input: {
  appId: string;
  chatId: string;
  chatType?: string;
}): void {
  const now = new Date().toISOString();
  getDatabase()
    .prepare(
      `INSERT INTO feishu_chats
         (app_id, chat_id, name, chat_type, source, first_seen_at, last_seen_at,
          reject_count, last_rejected_at)
       VALUES (?, ?, '', ?, 'rejected', ?, ?, 1, ?)
       ON CONFLICT(app_id, chat_id) DO UPDATE SET
         last_seen_at = excluded.last_seen_at,
         reject_count = feishu_chats.reject_count + 1,
         last_rejected_at = excluded.last_rejected_at`
    )
    .run(input.appId, input.chatId, input.chatType ?? 'group', now, now, now);
}

/**
 * 某个应用见过的会话。
 *
 * 排序把「最近被拦过的」放最前面：用户来这个页面，八成就是因为
 * 「在群里 @ 了没反应」，那个群应该第一眼就能看到。
 */
export function listChats(appId: string): ChatRow[] {
  return getDatabase()
    .prepare(
      `SELECT * FROM feishu_chats WHERE app_id = ?
       ORDER BY (reject_count > 0) DESC, last_seen_at DESC`
    )
    .all(appId) as ChatRow[];
}

/** 解绑应用时清掉。和名册一样按 app_id，没有外键级联。 */
export function deleteChats(appId: string): void {
  getDatabase().prepare('DELETE FROM feishu_chats WHERE app_id = ?').run(appId);
}
