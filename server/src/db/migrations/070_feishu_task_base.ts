import type { Migration } from '../migrator.js';

// 任务表搬到**独立的多维表格 base**，并且开放给群成员编辑。
//
// ── 为什么必须独立一个 base，不能留在项目日记 base 里 ──
// 飞书的文档权限接口（`drive.permissionMember.create`）的 token 是 **base 级**，
// 没有「只授权某一张表」这个粒度。所以把整群提成 edit 会连带「记录」「复盘」
// 两张表一起可编辑 —— 而那两张表的同步是**只追加**的（bitable.ts:grantView 的
// 注释写了理由）：群里任何人删掉一行，那行再也不会回来，库里还有但表和库从此
// 不一致，而人看的是表。任务表要可编辑、日志表必须只读，这两个要求在同一个
// base 里没法同时满足，所以拆。
//
// ── 为什么不复用 068 的 task_table_id / task_view_id ──
// 那两列指向的是**项目日记 base 里**那张老「任务」表，值是非空的。复用的话
// 「这个项目还没有任务 base」就没法判断了（非空会被当成已经建好），于是新表
// 永远建不出来，而派任务照旧写进那张只读的老表 —— 用户在表里改不动，
// 却也不会收到任何提示。所以新开一组列，用 `task_base_app_token` 是否为空判断。
// 老的两列在切换完成后随 068 一起删。
export const migration_070: Migration = {
  id: '070_feishu_task_base',
  up(db) {
    const cols = db.prepare('PRAGMA table_info(feishu_diary_projects)').all() as Array<{
      name: string;
    }>;
    const add = (name: string, decl: string) => {
      if (!cols.some((c) => c.name === name)) {
        db.exec(`ALTER TABLE feishu_diary_projects ADD COLUMN ${name} ${decl}`);
      }
    };

    // 空串 = 这个项目还没有任务 base。判据只看这一列（见文件头）。
    add('task_base_app_token', `TEXT NOT NULL DEFAULT ''`);
    add('task_base_table_id', `TEXT NOT NULL DEFAULT ''`);
    add('task_base_url', `TEXT NOT NULL DEFAULT ''`);

    // 列名 → field_id 的 JSON 映射。
    //
    // **这一列是「开放编辑」的代价。** 多维表格写记录的接口只收
    // 「字段名 → 值」的 map（没有按 field_id 写入这个选项），而表一旦可编辑，
    // 群里任何人都能把「进展」改叫「状态」、把「预计完成日期」改叫「deadline」。
    // 那之后写入会撞 FieldNameNotFound，一整条派活指令失败。
    // 所以建表时把 field_id 记下来，写之前用 field_id 反查**当前**列名。
    // 没有这一列的话，用户改一次列名，助理就再也派不了任务，
    // 而报错内容（字段不存在）跟他刚做的事对不上号。
    add('task_field_map', `TEXT NOT NULL DEFAULT ''`);

    // 两个看板视图的 id。存下来是为了链接能直接落在看板上。
    // **「分组依据」设不了** —— `appTableView.patch` 的 property 只有
    // filter_info / hidden_fields / hierarchy_config，没有分组。视图能建出来，
    // 分组要用户在飞书里手点一次，所以建完必须在回帖里说这件事。
    add('task_board_view_id', `TEXT NOT NULL DEFAULT ''`);
    add('task_person_view_id', `TEXT NOT NULL DEFAULT ''`);

    // 0 = 收紧链接分享那一步失败了，表处于租户默认可见范围（实测是「组织内
    // 拿到链接的人可阅读」）。任务 base 的链接是发在群里的，所以这一位为 0
    // 时回帖必须提醒手动收紧 —— 和日志表同一个理由。
    add('task_base_link_share_closed', 'INTEGER NOT NULL DEFAULT 0');
  },
};
