import type { Migration } from '../migrator.js';

// AI 提取时判定「和关键词库完全不相关」的标讯会被置成 status='rejected'（作废），
// 这一列记下**为什么**被判掉。
//
// 为什么值得开一列而不是从 ai_extracted 那段 JSON 里读：草稿库的列表查询
// 不选 ai_extracted（每行几 KB 的正文摘要），而「已作废」这个视图存在的唯一
// 意义就是让人能复查误杀 —— 只显示一句「已作废」而不说原因的话，用户没法判断
// 是闸门太狠还是那条本来就该丢，只会干脆不看这个视图，于是误杀变成永久静默丢失。
//
// 空串 = 没被判过（草稿/已提取/已评分都是空）。恢复为草稿时必须一起清掉它，
// 否则那条重新提取成功后仍带着一条陈旧的作废理由，读起来像「又被判掉了」。
export const migration_075: Migration = {
  id: '075_tender_reject_reason',
  up(db) {
    const cols = db.prepare('PRAGMA table_info(tenders)').all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === 'reject_reason')) {
      db.exec(`ALTER TABLE tenders ADD COLUMN reject_reason TEXT NOT NULL DEFAULT ''`);
    }
  },
};
