import type { Migration } from '../migrator.js';

// 项目任务：在项目群里 @ 助理派活，落库 + 同步到项目多维表格的「任务」表（带甘特视图）。
//
// ── 为什么要在我们库里存一份，飞书任务不是已经有了吗 ──
// 飞书任务（`task/v2`）是**给执行人看的待办**，它按「谁的任务」组织，
// 而这个功能要的是「这个项目派了哪些活、谁在做、什么时候交」——
// 一个按项目组织的横向视图。两者的差别不是展示偏好，是三个硬缺口：
//   1. `task.list` **只返回调用身份自己的任务**（这里就是机器人自己创建的那些），
//      查不到项目里其他人自建的活，也没有「按项目筛」这个维度；
//   2. 飞书任务没有「开始时间」（只有 due），而甘特图的横条需要起止两端；
//   3. 任务改名之后，历史上那个名字在飞书那侧就不存在了 ——
//      而用户永远用**新名字**称呼它（「把 logo 那个任务改成 5 号交」）。
// 所以库里这张表是数据源，飞书任务是**执行侧的镜像**（提醒、待办列表），
// 多维表格是**看板侧的镜像**（甘特图）。三者同步失败都只降级成一句 warning，
// 和 066 的记录同一个套路。
//
// ── 为什么不复用 feishu_commands.result 反查 ──
// 那条路（`actions/recent.ts:findRecentTarget`）是在没有任务表的年代唯一的办法：
// 从最近 7 天、50 行指令日志里按关键词捞出上次创建时返回的 guid。它的三个限制
// 恰好都是这张表要解决的：**7 天**（一个季度的项目派活查不到）、
// **只能改我自己帮你建的那些**（日志里没有的就是不存在）、
// 以及**没有状态**（「logo 那个做完了吗」无从回答）。
// 保留 recent.ts 是因为它还兜着一类东西：任务表里没有的（比如助理之外建的），
// 以及别的动作的目标反查。任务解析优先查这张表，查不到再回落。
//
// ── 为什么 project_id 可以为空 ──
// 「派给张三一个任务」在**没有绑项目的群**里也是合法指令（就是一条纯待办）。
// 那时候没有项目可挂，但仍然要落库 —— 否则「改一下昨天那个任务」又退回到
// 翻指令日志。所以 project_id 可空，绑了项目的群才填。
// 空 project_id 的行不进多维表格（没有表可进），这一点在同步侧判。
export const migration_068: Migration = {
  id: '068_feishu_project_tasks',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS feishu_project_tasks (
        id TEXT PRIMARY KEY,
        app_id TEXT NOT NULL,
        -- NULL = 这条任务不属于任何项目（在没绑项目的群里派的活）。
        -- 见文件头：这种行不进多维表格，但仍然可以被「改一下那个任务」找到。
        project_id TEXT,
        -- 任务名称。**用户改名后这里跟着改**，因为他之后只会用新名字称呼它。
        title TEXT NOT NULL,
        -- 任务内容/说明。和 title 分开是因为甘特图上显示的是 title，
        -- 而「内容」经常是一整段（「参考上次那版，主色调换成品牌蓝」）。
        content TEXT NOT NULL DEFAULT '',
        -- 负责人。open_id 是身份，name 是**派活那一刻**的显示名 ——
        -- 人改名后 name 不跟着变（表格里那行是历史事实），open_id 才是身份。
        -- 都可能为空：「明天前把合同发出去」没说派给谁，那就是派给自己/无主。
        owner_open_id TEXT NOT NULL DEFAULT '',
        owner_name TEXT NOT NULL DEFAULT '',
        -- 起止毫秒时间戳。**毫秒，不是秒** —— 飞书任务的 due.timestamp 和
        -- 多维表格的日期字段都是毫秒，用 actions/time.ts 的助手换算，别手算。
        -- 两端都可空：只说了「3 天后交」时没有开始时间，甘特图上就是个点。
        start_ms INTEGER,
        end_ms INTEGER,
        -- 状态。取值是代码里的枚举（见 diary/taskStatus.ts），不是 LLM 自由填的字符串：
        -- 模型给「进行中的」「in progress」「已完成✅」三种写法时，
        -- 多维表格的单选字段会各建一个选项，而甘特图按状态上色就此失效。
        status TEXT NOT NULL DEFAULT 'todo',
        -- 飞书任务那侧的 guid / 链接。空 = 建飞书任务那一步失败了（或者没建），
        -- 库里这条仍然有效 —— 提醒功能没了，项目视图还在。
        guid TEXT NOT NULL DEFAULT '',
        url TEXT NOT NULL DEFAULT '',
        created_by TEXT NOT NULL DEFAULT '',
        created_by_name TEXT NOT NULL DEFAULT '',
        -- 派活那条消息。和记录表一样，(app_id, message_id, step_index) 是
        -- 重放幂等的**唯一**保证：飞书成功也会重投事件，claimEvent 只挡得住
        -- 同一进程内的重复，跨重启靠这个唯一键。
        message_id TEXT NOT NULL DEFAULT '',
        step_index INTEGER NOT NULL DEFAULT 0,
        created_ms INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        -- 状态位：写进多维表格的时间。NULL = 还没推上去，下一次操作补推。
        bitable_synced_at TEXT,
        -- 多维表格里对应那一行的 record_id。任务和记录不同：记录只追加，
        -- 而任务**会被改**（改期、改状态、换负责人），所以必须记住行号才能更新那一行。
        -- 空 = 还没推上去，或者当初推的时候没拿到 record_id（那时只能重新追加一行）。
        bitable_record_id TEXT NOT NULL DEFAULT ''
      );

      -- 重放幂等。message_id 允许为空串（网页侧或将来的定时任务建的任务没有消息），
      -- 所以这里不能用 UNIQUE —— SQLite 里 '' 是个正常值，两条空 message_id 会撞。
      -- 用**部分索引**只约束真的来自消息的那些行。
      CREATE UNIQUE INDEX IF NOT EXISTS idx_feishu_project_tasks_msg
        ON feishu_project_tasks (app_id, message_id, step_index)
        WHERE message_id != '';

      -- 项目视图（甘特图的数据源）按开始时间排；没有开始时间的排在最后。
      CREATE INDEX IF NOT EXISTS idx_feishu_project_tasks_project
        ON feishu_project_tasks (project_id, start_ms);
      -- 补推未同步的走这条。
      CREATE INDEX IF NOT EXISTS idx_feishu_project_tasks_pending
        ON feishu_project_tasks (project_id, bitable_synced_at);
      -- 「改一下那个任务」按 app + 说话人 + 关键词找目标时走这条。
      -- 不带 project_id：没绑项目的群里派的活也要能找到。
      CREATE INDEX IF NOT EXISTS idx_feishu_project_tasks_app
        ON feishu_project_tasks (app_id, created_ms DESC);
    `);

    // 项目的多维表格里多一张「任务」表 + 一个甘特视图。
    // 已经存在的项目补不了这两列的内容（建表要调飞书接口，迁移里不能联网），
    // 所以留空 —— 同步侧发现为空时会**按需建表**，见 diary/bitable.ts
    // ensureTaskTable。这比在迁移里罗列所有项目再逐个调接口安全得多：
    // 迁移失败会让整个服务起不来，而一次建表失败只该让那一条指令带个 warning。
    const cols = db.prepare('PRAGMA table_info(feishu_diary_projects)').all() as Array<{
      name: string;
    }>;
    if (!cols.some((c) => c.name === 'task_table_id')) {
      db.exec(
        `ALTER TABLE feishu_diary_projects ADD COLUMN task_table_id TEXT NOT NULL DEFAULT ''`
      );
    }
    if (!cols.some((c) => c.name === 'task_view_id')) {
      // 甘特视图的 view_id。存下来是为了链接能**直接打开甘特图**：
      // 不带 ?view= 的话点进去是那张表的默认表格视图，用户看不到甘特图，
      // 而「甘特图」正是这个功能被要求的形态。
      db.exec(`ALTER TABLE feishu_diary_projects ADD COLUMN task_view_id TEXT NOT NULL DEFAULT ''`);
    }
  },
};
