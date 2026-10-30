import type { Migration } from '../migrator.js';

// 口播动效卡模版的上线状态。模版本身（组件、字段、测试数据）在前端代码里，这里只记作者在调试台点过的上线 / 下线。
// 没有行 = 草稿：新加的模版默认不上线，必须在调试台看过才放给用户。
export const migration_117: Migration = {
  id: '117_broll_templates',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS broll_templates (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL CHECK (status IN ('draft', 'live')),
        updated_at TEXT NOT NULL
      )
    `);
  },
};
