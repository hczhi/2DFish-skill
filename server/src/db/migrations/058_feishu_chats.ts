import type { Migration } from '../migrator.js';

// 机器人见过的会话。解决两个互为镜像的问题，它们都只差「记下 chat_id」这一步。
//
// ── 1. 白名单要手打 chat_id ──
// chat_id（`oc_xxx`）在飞书客户端里根本看不到。用户唯一的拿法是先把白名单留空、
// 让机器人在群里跑一次、再去指令日志里把那串 id 抄出来。所以白名单实际上是
//「先不设防跑一遍，再回来补」——而绝大多数人不会回来补。
// 机器人被拉进群时飞书会推 `im.chat.member.bot.added_v1`（SDK 的 botAdded 事件），
// 那一刻我们就知道 chat_id 和群名了。存下来，白名单就从"手打 id"变成"勾选群名"。
//
// ── 2. 白名单外的 @ 是静默丢弃的 ──
// 这让排障表里第一条「日志里根本没有记录」有两种成因：事件真没进来，
// 或者进来了但被白名单拦了。二者的处置完全相反（一个去查连接/权限，
// 一个去加白名单），而用户看到的现象一模一样。
//
// 拦下来的会话不落 feishu_commands（那是**已受理**指令的日志，
// 而且落进去等于让任何人拉机器人进群就能往里灌行），改成在本表上累加计数：
// 「这个群 @ 过你 7 次，全被白名单拦了」，旁边一个「加入白名单」按钮。
//
// 一行 = 一个会话，不是一次事件，所以本表天然有界（机器人在多少个群里就多少行），
// 不需要定期清理。解绑应用时按 app_id 清掉（deleteApp 里做，没有外键级联）。
export const migration_058: Migration = {
  id: '058_feishu_chats',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS feishu_chats (
        -- 按 app_id 隔离，理由同名册（057）：一个应用 = 一个飞书租户。
        app_id TEXT NOT NULL,
        chat_id TEXT NOT NULL,
        -- 群名。botAdded 时用 getChatInfo 查一次；只从被拦事件里认识的群拿不到名字，
        -- 那时留空，前端退化成显示 chat_id（仍然比让用户自己去日志里抄好）。
        name TEXT NOT NULL DEFAULT '',
        chat_type TEXT NOT NULL DEFAULT 'group',
        -- 'bot_added' = 机器人被拉进来时记的；'rejected' = 只在白名单外被拦时见过。
        source TEXT NOT NULL DEFAULT 'bot_added',
        -- 把机器人拉进群的人，出问题时知道该找谁。
        added_by TEXT NOT NULL DEFAULT '',
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        -- 被白名单拦下的次数和最近一次时间。前端据此提示「要放行就勾上」。
        reject_count INTEGER NOT NULL DEFAULT 0,
        last_rejected_at TEXT,
        PRIMARY KEY (app_id, chat_id)
      );
    `);
  },
};
