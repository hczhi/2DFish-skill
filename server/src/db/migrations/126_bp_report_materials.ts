import type { Migration } from '../migrator.js';

/**
 * `bp_report_materials`：报告页上人工补的资料（每份报告、每个联网章节各一组）。
 *
 * kind:
 * - `url`  —— 贴的链接，Tavily Extract 抓下来的正文存在 content；
 * - `file` —— 上传的研报 / 材料，提取出的文字存在 content（原文件不存，同 bp_reports）；
 * - `exclude` —— 勾掉的检索结果（同名公司 / 不相关），只存 url，这一章重跑时不再用它。
 *
 * 存 content 而不是重跑时再抓：同一个链接隔天再抓可能变了 / 抓不到，而报告上「补充资料」那一栏
 * 显示的还是他当时贴的那一篇 —— 两边对不上的话，他核到的是另一个版本。
 * chapter 是 reportRunner 的步骤键（industry / competitors / investors / credit）。
 */
export const migration_126: Migration = {
  id: '126_bp_report_materials',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS bp_report_materials (
        id TEXT PRIMARY KEY,
        report_id TEXT NOT NULL,
        chapter TEXT NOT NULL,
        kind TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        url TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_bp_materials_report ON bp_report_materials (report_id, chapter);
    `);
  },
};
