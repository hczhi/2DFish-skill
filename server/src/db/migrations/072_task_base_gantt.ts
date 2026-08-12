import type { Migration } from '../migrator.js';

// 任务管理表（070）上的甘特视图 id。
//
// 存在的理由是**幂等**，不是为了链接。这个视图和「飞书任务」那一列都是给
// 070 之前建的 base 补上去的（迁移里不能调飞书接口），补的时机是下一次派活 ——
// 也就是说那段代码会被反复执行。没有这一列的话每次派活都会再建一个「甘特图」
// 视图，一个项目十几个同名视图（上限 200/base），而每次派活都成功、没有任何报错。
//
// 空串 = 还没建过。用户手动把视图删了之后我们**不会**重建（id 还在），
// 这是刻意的：他删了就是不想要，而重建会让他每次派活都得再删一次。
export const migration_072: Migration = {
  id: '072_task_base_gantt',
  up(db) {
    const cols = db.prepare('PRAGMA table_info(feishu_diary_projects)').all() as Array<{
      name: string;
    }>;
    if (!cols.some((c) => c.name === 'task_gantt_view_id')) {
      db.exec(`ALTER TABLE feishu_diary_projects ADD COLUMN task_gantt_view_id TEXT NOT NULL DEFAULT ''`);
    }
  },
};
