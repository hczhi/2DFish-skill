import type { Migration } from '../migrator.js';

// 让一个 skill 由多个文件组成（对齐 Anthropic skill 的 SKILL.md + references/ 结构）：
// - kind='main'      主文件（每个 skill 恰好一条）
// - kind='reference' 引用文件（references/ 下的每个 md，一条一行）
// 主文件里用 {{ref:filename}} 占位符引用某个引用文件，运行时展开注入 prompt。
export const migration_031: Migration = {
  id: '031_skill_files',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS prompt_skill_files (
        id TEXT PRIMARY KEY,
        skill_id TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'reference',
        filename TEXT NOT NULL,
        body TEXT NOT NULL DEFAULT '',
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_skill_files_skill ON prompt_skill_files (skill_id);
    `);

    // 把已有 skill 的 body 迁成一条 kind=main 的文件记录（幂等：已有 main 就跳过）。
    const now = new Date().toISOString();
    const skills = db
      .prepare('SELECT id, body FROM prompt_skills')
      .all() as Array<{ id: string; body: string }>;
    const hasMain = db.prepare(
      "SELECT 1 FROM prompt_skill_files WHERE skill_id = ? AND kind = 'main' LIMIT 1"
    );
    const insert = db.prepare(
      `INSERT INTO prompt_skill_files (id, skill_id, kind, filename, body, sort_order, created_at, updated_at)
       VALUES (?, ?, 'main', 'SKILL.md', ?, 0, ?, ?)`
    );
    for (const s of skills) {
      if (hasMain.get(s.id)) continue;
      insert.run(`${s.id}-main`, s.id, s.body || '', now, now);
    }
  },
};
