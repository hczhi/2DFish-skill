import type { Migration } from '../migrator.js';

// 飞书助理：用户在飞书里 @ 机器人下达自然语言指令，服务端解析成动作并调飞书 API 执行。
//
// 与既有两套飞书代码的关系：
//   - services/tender/feishuNotify.ts   群自定义机器人 webhook + 加签，纯出站，无回调通道
//   - services/tender/feishuBitable.ts  app_id/app_secret → tenant_access_token，纯出站
// 本模块是第一个**入站**方向：事件由飞书推给我们。走官方 SDK 的长连接（WSClient），
// 服务端主动建 WebSocket 出去，因此不需要公网回调地址、不需要验签/AES 解密/challenge 握手。
// 长连接只支持企业自建应用，且集群下是竞争消费（同一事件只有一个实例收到）——
// 本项目是单实例部署（见 core/jobs.ts reapZombieJobs 的同样假设），不构成问题。
//
// ── 为什么凭证挂在平台账号上（user_id）而不是平台级 system_config ──
// 自建应用只能在创建它的租户内使用，所以每家公司必须用自己的应用，凭证天然是 per-account 的
// （和 feishuBitable.ts 里同样的理由）。一个账号可以绑多个应用。
// 连带好处：意图解析的 AI 调用记在这个 user_id 上，于是"扣哪个账号的额度"这件事
// 直接复用既有的专属渠道机制（migrations/052）——账号配了专属渠道就烧他自己的 key，
// 没配就走平台额度。飞书里说话的人**不需要**有平台账号，只需要 open_id（事件自带）。
export const migration_053: Migration = {
  id: '053_feishu_assistant',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS feishu_apps (
        id TEXT PRIMARY KEY,
        -- 归属的平台账号。AI 额度、指令日志的可见性都按这个字段判定。
        user_id TEXT NOT NULL,
        name TEXT NOT NULL DEFAULT '',
        app_id TEXT NOT NULL,
        -- AES-GCM 密文（core/secrets.ts）。和 tender 的 feishu_app_secret 一致，
        -- 解密只在真正要用的那一个点上做。
        app_secret TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        -- 群白名单（JSON 数组的 chat_id）。空数组 = 不限。
        -- 自建应用被拉进任何群都会收到 @，没有白名单就等于谁拉谁能用这个账号的额度。
        allowed_chats TEXT NOT NULL DEFAULT '[]',
        -- 最近一次连接状态，供后台展示。连接是长驻的，出问题时用户唯一能看到的线索就是这里。
        conn_state TEXT NOT NULL DEFAULT 'idle',
        conn_error TEXT,
        conn_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      -- 同一个飞书应用不能被绑定两次：两条记录会建两条长连接，
      -- 同一个事件被投递两次（且分属不同账号，DB 去重也拦不住跨账号重复）。
      CREATE UNIQUE INDEX IF NOT EXISTS idx_feishu_apps_app_id ON feishu_apps (app_id);
      CREATE INDEX IF NOT EXISTS idx_feishu_apps_user ON feishu_apps (user_id);

      -- 事件去重。飞书是 at-least-once：即使我们成功返回 200 也可能重复推送，
      -- 失败则按 15s/5min/1hr/6hr 重推 4 次。不去重的后果是重复建任务/重复发消息。
      -- 主键用 message_id 而非 event_id —— im.message.receive_v1 的文档明确要求
      -- 「请使用 message_id 去重，不要依赖 event_id」。
      -- SDK 的 LarkChannel 自带一层内存 dedup，但进程重启后失效，所以权威去重必须落库。
      CREATE TABLE IF NOT EXISTS feishu_events (
        message_id TEXT PRIMARY KEY,
        app_id TEXT NOT NULL,
        received_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_feishu_events_received ON feishu_events (received_at);

      -- 指令执行日志。@ 一下没反应时，这是唯一能告诉你卡在哪的东西
      -- （收到了吗 → 解析成什么 → 调用失败原因）。
      CREATE TABLE IF NOT EXISTS feishu_commands (
        id TEXT PRIMARY KEY,
        app_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        chat_id TEXT NOT NULL,
        chat_type TEXT NOT NULL DEFAULT 'group',
        -- 飞书侧发言人。没有平台账号，只有 open_id。
        sender_open_id TEXT NOT NULL DEFAULT '',
        sender_name TEXT NOT NULL DEFAULT '',
        -- 剥掉 @ 占位符后的正文
        text TEXT NOT NULL DEFAULT '',
        -- 意图解析结果
        action TEXT,
        params TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        error TEXT,
        -- 动作产物摘要（任务链接、日程链接等），前端直接展示
        result TEXT,
        duration_ms INTEGER,
        created_at TEXT NOT NULL,
        completed_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_feishu_commands_user ON feishu_commands (user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_feishu_commands_app ON feishu_commands (app_id, created_at DESC);
    `);
  },
};
