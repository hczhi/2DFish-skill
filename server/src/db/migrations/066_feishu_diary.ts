import type { Migration } from '../migrator.js';

// 项目日记（原「想象日记」）：在飞书群里 @ 助理记项目日志、按时间范围复盘。
//
// ── 曾经有一套 aily 版，已删（见 migration 067）──
// 064 播的是一个 **aily 智能体技能** group-assistant：脚本只打印
// 「Agent 接下来需要建多维表格」这类指令，真正调飞书接口的是 aily 那侧的智能体，
// 状态存在它自己的 config.json 里。本迁移是同一个产品的**原生实现**：
// 接口由我们自己调（走长连接那份 client），状态存在这几张表里。
// 当时留了「两套并存，谁先被 @ 到谁执行」，而并存的实际后果是同一个群里两个东西
// 都在记 —— 项目名一样、内容不一样，复盘读到哪一份取决于用户 @ 的是谁。
// 所以 aily 那套整个删掉了，这几张表是唯一的数据源。
//
// ── 为什么键是 app_id ──
// 和名册（057）、会话（058）一样：一个自建应用 = 一家公司的飞书租户。
// 用 user_id 的话，同一个平台账号绑了两家公司的应用时，A 公司的项目会出现在
// B 公司的总表里。解绑应用时按 app_id 清（deleteApp 里做，没有外键级联）。
//
// ── 为什么数据要在我们库里存一份，而不只写多维表格 ──
// 多维表格是给人看的**镜像**，不是数据源：
//   1. 复盘要按时间范围取记录，从库里一条 SQL 就行；走飞书要分页拉全表再在内存里筛；
//   2. 写飞书会失败（限流、权限没发版、表被人删了）。记录先落库、再带状态位补推，
//      失败的下一次自动重来 —— 和 tender 那套 bitable_synced_at 同一个套路；
//   3. 群成员只有**只读**权限（见 diary/bitable.ts 的 grantView），
//      但表的所有者仍然能删行。库里那份是唯一不会被误删的副本。
// 同步是单向的：只追加、不回读、不覆盖，所以用户在表里自己加的列不会被冲掉。
export const migration_066: Migration = {
  id: '066_feishu_diary',
  up(db) {
    db.exec(`
      -- 每家公司一份「项目总表」（多维表格），列出全部项目及其日志表链接。
      -- 一个 app 一行，所以 app_id 直接做主键。
      CREATE TABLE IF NOT EXISTS feishu_diary_indexes (
        app_id TEXT PRIMARY KEY,
        base_app_token TEXT NOT NULL,
        table_id TEXT NOT NULL,
        -- 带 ?table= 的可点链接。不带的话飞书打开 base 里的第一张表。
        url TEXT NOT NULL DEFAULT '',
        -- 0 = 收紧链接分享那一步失败了，表处于租户默认可见范围（很可能是
        -- 「组织内获得链接的人可阅读」）。必须说出来，见 bitable.ts closeLinkShare。
        link_share_closed INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS feishu_diary_projects (
        id TEXT PRIMARY KEY,
        app_id TEXT NOT NULL,
        -- 项目对应的飞书群。**只来自事件本身**，绝不让 LLM 填（它会编 oc_xxx，
        -- 后果是记录进了别的项目）。私聊没有可绑的群，所以建项目只能在群里做。
        chat_id TEXT NOT NULL,
        -- 建项目那一刻的群名（chatStore 里有就取，没有就空）。只用于展示：
        -- 群改名后这里不会跟着变，而 chat_id 才是身份。
        chat_name TEXT NOT NULL DEFAULT '',
        name TEXT NOT NULL,
        -- 项目自己的多维表格：「记录」表 + 「复盘」表。
        -- 建表失败时这三列为空 —— 那是 claimProject 占位之后、建表还没成功的状态，
        -- 调用方会把这行删掉，所以正常情况下查不到空的行。
        base_app_token TEXT NOT NULL DEFAULT '',
        record_table_id TEXT NOT NULL DEFAULT '',
        review_table_id TEXT NOT NULL DEFAULT '',
        url TEXT NOT NULL DEFAULT '',
        link_share_closed INTEGER NOT NULL DEFAULT 0,
        -- 项目总表里对应那一行的 record_id。NULL = 还没登记进总表
        -- （建项目时那一步失败了），后续操作会自动补登记。
        index_record_id TEXT,
        created_by TEXT NOT NULL DEFAULT '',
        created_by_name TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      -- 一个群一个项目。UNIQUE 在这里不只是数据洁癖：它是并发闸 ——
      -- 两个人同时说「新建项目」时，第二次 INSERT 会撞约束，
      -- 于是只会建出一个多维表格（先占位再建表，见 store.claimProject）。
      CREATE UNIQUE INDEX IF NOT EXISTS idx_feishu_diary_projects_chat
        ON feishu_diary_projects (app_id, chat_id);
      -- 同名项目也不允许：按名字找项目时（私聊里记录）歧义只能靠拒绝解决，
      -- 而两个同名项目会让「记到哪个」永远无法确定。
      CREATE UNIQUE INDEX IF NOT EXISTS idx_feishu_diary_projects_name
        ON feishu_diary_projects (app_id, name);

      CREATE TABLE IF NOT EXISTS feishu_diary_records (
        id TEXT PRIMARY KEY,
        app_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        -- 记录正文。**原样存用户说的话**，不经过 LLM 改写 ——
        -- 日志的价值全在"当时到底怎么说的"，润色过的记录等于把证据换成转述。
        content TEXT NOT NULL,
        -- 那条指令的完整原文（含「记一下」这类前缀）。content 是从它里面摘的，
        -- 而摘的这一步由 LLM 做；留着原文，摘歪了以后还能对账。
        source_text TEXT NOT NULL DEFAULT '',
        author_open_id TEXT NOT NULL DEFAULT '',
        author_name TEXT NOT NULL DEFAULT '',
        message_id TEXT NOT NULL,
        -- 同一条消息里可能有两步都是记录（「记一下 A，再记一下 B」），
        -- 所以幂等键必须带步序号，否则第二条会被当成重复而静默丢掉。
        step_index INTEGER NOT NULL DEFAULT 0,
        -- 毫秒时间戳。复盘按时间范围取记录，用整数比拿 ISO 串做字符串比较稳。
        created_ms INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        -- 状态位：写进多维表格的时间。NULL = 还没推上去，下一次操作会补推。
        bitable_synced_at TEXT
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_feishu_diary_records_msg
        ON feishu_diary_records (app_id, message_id, step_index);
      CREATE INDEX IF NOT EXISTS idx_feishu_diary_records_project
        ON feishu_diary_records (project_id, created_ms DESC);
      -- 补推未同步记录时走这条：状态位为空的那些。
      CREATE INDEX IF NOT EXISTS idx_feishu_diary_records_pending
        ON feishu_diary_records (project_id, bitable_synced_at);

      -- 复盘结果。存下来的理由是**群消息会被刷走**：一条几百字的总结在活跃群里
      -- 半天就翻上去了，而它是这个功能真正的产出。同时也是回帖太长时的落脚点
      -- （群里只发摘要 + 「完整版在复盘表里」）。
      CREATE TABLE IF NOT EXISTS feishu_diary_summaries (
        id TEXT PRIMARY KEY,
        app_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        -- 「本周（09-01 至 09-07）」这种给人看的说法，直接进表和回帖。
        range_label TEXT NOT NULL DEFAULT '',
        range_start_ms INTEGER,
        range_end_ms INTEGER,
        record_count INTEGER NOT NULL DEFAULT 0,
        -- 渲染好的 markdown 全文（不是 LLM 的原始 JSON）。
        summary TEXT NOT NULL,
        created_by TEXT NOT NULL DEFAULT '',
        created_by_name TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        bitable_synced_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_feishu_diary_summaries_project
        ON feishu_diary_summaries (project_id, created_at DESC);
    `);
  },
};
