import type { Migration } from '../migrator.js';

// 新版 AI 辅助写作流程的数据层。
// 主旨：人负责洞察/提问/判断，AI 负责结构化/验证/润色 —— 不是一键生成器。
//
// xhs_drafts：把「引导式输入 → 思维导图结构 → 成文」整条流程的状态存下来，
//   中途刷新不丢。structure_json 是可编辑的思维导图节点数组（MindNode[]）。
// xhs_blocklist：用户的禁用表达库，账号级全局资产、所有草稿共享，按 user_id 隔离。
//   生文时以「声明」形式进 prompt（降低出现概率）+ 成文后扫描高亮兜底。
// 均照抄 033 的每用户表范式：id 主键 / user_id / ISO 时间戳 / user_id 索引。
export const migration_039: Migration = {
  id: '039_xhs_writer',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS xhs_drafts (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        brief_json TEXT NOT NULL DEFAULT '{}',
        structure_json TEXT NOT NULL DEFAULT '[]',
        body TEXT NOT NULL DEFAULT '',
        stage TEXT NOT NULL DEFAULT 'brief',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_xhs_drafts_user ON xhs_drafts (user_id, updated_at);

      CREATE TABLE IF NOT EXISTS xhs_blocklist (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        term TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'word',
        note TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_xhs_blocklist_user ON xhs_blocklist (user_id);
    `);
  },
};
