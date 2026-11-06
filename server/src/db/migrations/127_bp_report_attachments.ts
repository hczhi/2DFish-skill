import type { Migration } from '../migrator.js';

/**
 * `bp_reports.attachments_json`：BP 之外一起传的补充材料清单（名字 / 类型 / 字数 / 提醒）。
 * 正文已经拼进 bp_text（带「附件K」分隔），这一列只给界面列清单用 —— 不列的话他看不出
 * 哪几份被读进去了、哪一份是图片识别的（模型抄的字，不是文件里的文字层）。
 */
export const migration_127: Migration = {
  id: '127_bp_report_attachments',
  up(db) {
    const cols = db.prepare(`PRAGMA table_info(bp_reports)`).all() as { name: string }[];
    if (!cols.some((c) => c.name === 'attachments_json')) {
      db.exec(`ALTER TABLE bp_reports ADD COLUMN attachments_json TEXT NOT NULL DEFAULT '[]'`);
    }
  },
};
