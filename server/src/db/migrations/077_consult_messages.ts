import type { Migration } from '../migrator.js';

/**
 * 阶段内对话（/consult）。一个阶段一段对话，用户可以在这一步里继续追问、
 * 让 AI 换个角度分析，聊定了再定稿。
 *
 * **方向卡和结论草稿也写进这张表**（kind='directions' / 'draft'）。它们不是聊天记录，
 * 但必须在对话历史里 —— 用户下一句是「第 2 个方向再往深挖」，而「第 2 个」的指代
 * 对象只存在于那次方向卡里。不存的话 AI 读不到它，会一本正经地答一个别的东西，
 * 语气和格式都完全正常，用户要读完才发现说的不是自己问的那个方向。
 * 顺带也解决了刷新页面方向卡就没了的问题。
 *
 * 按 (project_id, stage_key) 取，不按项目整段取：不同阶段的对话串味的话，
 * 讨论品牌定位时读到的是看行业那段的上下文，回答依然通顺 —— 一句错都不报。
 *
 * db/index.ts 没开 PRAGMA foreign_keys，所以这里的 REFERENCES 只是注释，
 * 删项目要自己清（见 services/consult/projectStore.ts:deleteProject）。
 */
export const migration_077: Migration = {
  id: '077_consult_messages',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS consult_messages (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES consult_projects(id),
        stage_key TEXT NOT NULL,
        role TEXT NOT NULL,                    -- 'user' | 'assistant'
        kind TEXT NOT NULL DEFAULT 'text',     -- 'text' | 'directions' | 'draft'
        content TEXT NOT NULL DEFAULT '',      -- 进 prompt 的那一段（方向卡也要有可读的文字版）
        payload TEXT NOT NULL DEFAULT '',      -- kind != 'text' 时的结构化原文（JSON），前端照它渲染卡片
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_consult_messages_stage
        ON consult_messages (project_id, stage_key, created_at);
    `);
  },
};
