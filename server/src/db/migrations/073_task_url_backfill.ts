import type { Migration } from '../migrator.js';

// 「任务管理表里那些老行的『飞书任务』列已经回填过了」这一位。
//
// 回填做的事：072 之后补出来的那一列对**已经存在的行**是空的，而链接（applink 里
// 带 guid）是库里那份任务被砍掉之后唯一能定位到飞书任务的东西。所以要拿
// `feishu_project_tasks` 里的 url 按「助理标记」对齐，补进表里那些空格。
//
// 为什么需要一位状态，而不是每次派活都扫一遍：回填要把整张表读出来（分页
// search）才知道哪些格是空的。不置位的话这个读会挂在**每一条派活指令**上 ——
// 不报错、不出错，只是每次派活都慢一截，而且没人看得出来为什么。
//
// 0 也是「上次没跑成」，所以失败时**不置位**（下次派活再试）。新建的项目直接
// 置 1：它们的每一行在写入时就带着链接（createTask 传 taskUrl），没有可回填的东西。
export const migration_073: Migration = {
  id: '073_task_url_backfill',
  up(db) {
    const cols = db.prepare('PRAGMA table_info(feishu_diary_projects)').all() as Array<{
      name: string;
    }>;
    if (!cols.some((c) => c.name === 'task_url_backfilled')) {
      db.exec(
        'ALTER TABLE feishu_diary_projects ADD COLUMN task_url_backfilled INTEGER NOT NULL DEFAULT 0'
      );
    }
  },
};
