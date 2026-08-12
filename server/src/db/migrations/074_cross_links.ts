import type { Migration } from '../migrator.js';

// 三张表之间的互跳入口（项目日记 base ↔ 任务 base ↔ 项目总表）。
//
// 用户看到的东西：日记 base 里多一张「🔗 相关链接」表（指向任务管理表），任务
// base 里也多一张（指向项目日志表），项目总表的每一行多一列「任务表」。
// 在这之前这三张表互相之间没有任何入口 —— 它们都不在任何人的云文档空间里
// （建表时没传 folder_token），链接分享也是关掉的，所以群消息被刷走之后
// 用户手上就只剩一个链接，另外两张表**再也找不回来**（只能 @ 助理问）。
//
// 这里存的全都是「已经建过了」的凭据，理由和 072/073 一样：建表/建列要调飞书
// 接口，而迁移跑在启动路径上 —— 一次网络抖动会让整个服务起不来，换来的只是
// 一张链接表。所以补建挂在**下一次派活 / 下一次建项目**上，会被反复执行，
// 幂等只能靠这几列。少了它们的后果都是「每次都成功，只是越来越多」：
// 每次派活多一张同名「相关链接」表 / 总表里多一列同名「任务表」。
//
// 为什么列是「建过没有」而不是「表里现在有没有」：用户手动删掉那一列/那张表
// 之后，看现状的写法会一直重建 —— 他删一次我们加一次，谁都不会报错。
export const migration_074: Migration = {
  id: '074_cross_links',
  up(db) {
    const has = (table: string, col: string) =>
      (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some(
        (c) => c.name === col
      );

    // 「🔗 相关链接」表的 id。空串 = 还没建出来。两个 base 各一张。
    if (!has('feishu_diary_projects', 'link_table_id')) {
      db.exec("ALTER TABLE feishu_diary_projects ADD COLUMN link_table_id TEXT NOT NULL DEFAULT ''");
    }
    if (!has('feishu_diary_projects', 'task_link_table_id')) {
      db.exec(
        "ALTER TABLE feishu_diary_projects ADD COLUMN task_link_table_id TEXT NOT NULL DEFAULT ''"
      );
    }

    // 项目总表的「任务表」列：建过了 / 老行的链接补过了。分两位是因为它们
    // 会分别失败 —— 列建成了但补链接那步挂了的话，只该重试后面那一步。
    if (!has('feishu_diary_indexes', 'task_col_added')) {
      db.exec(
        'ALTER TABLE feishu_diary_indexes ADD COLUMN task_col_added INTEGER NOT NULL DEFAULT 0'
      );
    }
    if (!has('feishu_diary_indexes', 'task_col_backfilled')) {
      db.exec(
        'ALTER TABLE feishu_diary_indexes ADD COLUMN task_col_backfilled INTEGER NOT NULL DEFAULT 0'
      );
    }
  },
};
