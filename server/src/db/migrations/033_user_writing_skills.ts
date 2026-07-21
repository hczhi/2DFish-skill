import type { Migration } from '../migrator.js';

// 用户私有写作 skill：每个用户可创建多个自己的写作 skill，用于在写作台生成整篇，
// 并可通过「调试闭环」不断完善。与管理员全局的 prompt_skills 完全分开（按 user_id 隔离）。
// 底层沿用「主文件 + 多引用文件 + {{ref}} 展开」的结构。
export const migration_033: Migration = {
  id: '033_user_writing_skills',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS user_writing_skills (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_uws_user ON user_writing_skills (user_id);

      CREATE TABLE IF NOT EXISTS user_writing_skill_files (
        id TEXT PRIMARY KEY,
        skill_id TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'reference',
        filename TEXT NOT NULL,
        body TEXT NOT NULL DEFAULT '',
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_uws_files_skill ON user_writing_skill_files (skill_id);
    `);
  },
};
