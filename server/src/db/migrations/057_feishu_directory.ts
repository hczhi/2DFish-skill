import type { Migration } from '../migrator.js';

// 组织架构名册。这是「在私聊里让助理给同事发消息 / 建任务」的前提。
//
// ── 为什么必须落库，而不是每次去飞书查 ──
// 按名字查人的接口（search/v1/user）只能用 user_access_token，我们没有。
// 剩下的路是遍历部门树（contact/v3），但那是几十到几百次 API 调用，
// 不可能放在一条指令的执行路径上（飞书 3 秒超时，且有 QPS 限制）。
// 所以改成「绑定应用时同步一次，之后按需更新」，指令执行时只查本地库。
//
// ── 这张表怎么守住「open_id 绝不由 LLM 编造」 ──
// 加了名册之后 LLM 仍然**不输出 open_id**，它只输出用户说的那个名字；
// open_id 一律由代码在本表里精确查出来（actions/people.ts）。于是 open_id 的
// 来源仍然只有两个，都不经过模型：事件自带的 mentions[]，和这张表。
// 同名查到多个就回一句问清楚，绝不挑一个——把消息发给错误的人是不可接受的失败模式。
//
// ── 为什么单独存部门名 ──
// department_names 是「哪个张三」唯一能拿来区分的东西（销售部的张三 vs 技术部的张三）。
// 歧义提示里没有部门，用户根本没法回答。冗余存一份拼好的字符串而不是查询时 join：
// 部门数据同步时才变，读路径在指令执行的关键链路上。
export const migration_057: Migration = {
  id: '057_feishu_directory',
  up(db) {
    db.exec(`
      -- 部门。用于给人打上「哪个部门」的标签，也用于后台展示组织架构树。
      CREATE TABLE IF NOT EXISTS feishu_directory_departments (
        -- 名册按应用隔离：一个应用 = 一个飞书租户，两家公司的通讯录绝不能混在一起。
        app_id TEXT NOT NULL,
        department_id TEXT NOT NULL,
        name TEXT NOT NULL DEFAULT '',
        parent_id TEXT NOT NULL DEFAULT '',
        member_count INTEGER,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (app_id, department_id)
      );

      CREATE TABLE IF NOT EXISTS feishu_directory_users (
        app_id TEXT NOT NULL,
        open_id TEXT NOT NULL,
        name TEXT NOT NULL DEFAULT '',
        en_name TEXT NOT NULL DEFAULT '',
        -- 归一化后的匹配键（小写、去掉空格和间隔号）。按名字找人全靠它。
        -- 独立成列而不是查询时用函数算：这样能走索引，而且写入和查询共用
        -- 同一个 normalizeName()，不会出现「存的时候归一化了、查的时候没有」。
        match_key TEXT NOT NULL DEFAULT '',
        department_ids TEXT NOT NULL DEFAULT '[]',
        -- 拼好的部门名，只用于同名时告诉用户「哪个张三」。
        department_names TEXT NOT NULL DEFAULT '',
        job_title TEXT NOT NULL DEFAULT '',
        -- 离职的人保留在表里而不是删掉：这样能回「此人已离职」，
        -- 而不是含糊的「通讯录里找不到」——后者会让用户以为是同步没做。
        is_resigned INTEGER NOT NULL DEFAULT 0,
        -- 'contact' = 通讯录接口；'chats' = 群成员兜底（没有部门信息）。
        source TEXT NOT NULL DEFAULT 'contact',
        updated_at TEXT NOT NULL,
        PRIMARY KEY (app_id, open_id)
      );

      -- 按名字找人是执行路径上的查询，必须有索引。
      CREATE INDEX IF NOT EXISTS idx_feishu_dir_users_key
        ON feishu_directory_users (app_id, match_key);
    `);

    // 同步状态挂在 feishu_apps 上，和 conn_state 一样的理由：
    // 同步是后台跑的，用户点完按钮就只能靠这几个字段知道成没成。
    const cols = new Set(
      (db.prepare('PRAGMA table_info(feishu_apps)').all() as Array<{ name: string }>).map(
        (c) => c.name
      )
    );
    const add = (name: string, ddl: string) => {
      if (!cols.has(name)) db.exec(`ALTER TABLE feishu_apps ADD COLUMN ${ddl}`);
    };

    // 'idle' | 'syncing' | 'ok' | 'failed'
    add('dir_sync_state', "dir_sync_state TEXT NOT NULL DEFAULT 'idle'");
    add('dir_sync_error', 'dir_sync_error TEXT');
    add('dir_sync_at', 'dir_sync_at TEXT');
    add('dir_user_count', 'dir_user_count INTEGER NOT NULL DEFAULT 0');
    // 实际用上的数据源。通讯录权限没开时会退到群成员兜底，
    // 那份名册只覆盖机器人所在的群——必须让用户看见，否则他以为同步全了。
    add('dir_source', "dir_source TEXT NOT NULL DEFAULT ''");
  },
};
