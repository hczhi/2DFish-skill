import type { Migration } from '../migrator.js';

/**
 * 联网检索采纳的资料（/consult 的 L1 数据源）。
 *
 * 存下来而不是「搜完直接进 prompt」：搜索结果是用户**逐条勾选**采纳的 ——
 * 不勾的那些是噪音（同名公司、几年前的旧闻），全塞进去的话 AI 会照着别人家的
 * 数字写这家企业的现状卡，而那一节读起来完全正常。落库同时也是「这条结论当初
 * 依据了哪几个来源」的唯一记录：定稿的 source_level 是按有没有它算出来的。
 *
 * `(project_id, url)` 唯一：同一条来源采纳两遍，prompt 里那段资料就出现两遍，
 * 模型会把它当成两处独立印证（「多个来源都提到…」），而界面上只是多了一行。
 *
 * db/index.ts 没开 PRAGMA foreign_keys，删项目要自己清
 * （见 services/consult/projectStore.ts:deleteProject）。
 */
export const migration_079: Migration = {
  id: '079_consult_sources',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS consult_sources (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES consult_projects(id),
        stage_key TEXT NOT NULL,               -- 在哪一步采纳的（显示用；进 prompt 的是整个项目的）
        title TEXT NOT NULL DEFAULT '',
        url TEXT NOT NULL DEFAULT '',
        domain TEXT NOT NULL DEFAULT '',       -- 标注「（联网·域名·年份）」用的那个域名
        published TEXT NOT NULL DEFAULT '',    -- Tavily 常常不给，空串表示「未标日期」
        snippet TEXT NOT NULL DEFAULT '',
        query TEXT NOT NULL DEFAULT '',        -- 当初搜的词，用来判断这条是回答什么问题的
        created_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_consult_sources_url
        ON consult_sources (project_id, url);
      CREATE INDEX IF NOT EXISTS idx_consult_sources_project
        ON consult_sources (project_id, created_at);
    `);
  },
};
