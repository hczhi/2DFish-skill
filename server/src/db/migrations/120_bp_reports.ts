import type { Migration } from '../migrator.js';

/**
 * `bp_reports`：一份 BP 分析报告 = 一次后台任务。
 *
 * 一份报告要串十几次 AI 调用、跑几分钟，只放在浏览器内存里的话刷新一次就没了 ——
 * 额度扣了、结果算出来了，界面上只剩一个空的上传框（同 109 consult_runs 的理由）。
 *
 * - `bp_text` 存 BP 提取出来的全文：后面每一章都要拿原文核引文、算页码，换一章重跑也要它。
 *   原文件不存（BP 是敏感商业信息，上传那条路转存的 COS 是公开可访问的）。
 * - `result_json` 按章节键存（`{ factCard: …, consistency: … }`），一章跑完就写一章：
 *   后面某一章挂了，前面已经出来的照样能看，而失败那一章的原文成因在 `error`。
 * - `step` 是「正在跑哪一章」，界面上的进度就读它。
 * - 启动时遗留的 running 标成 interrupted（`reapInterruptedBpReports`）：驱动它的是内存里
 *   那个游离的 async 函数，进程一没必然死了，不收尸的话这份报告永远显示「分析中」。
 */
export const migration_120: Migration = {
  id: '120_bp_reports',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS bp_reports (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        filename TEXT NOT NULL,
        bp_text TEXT NOT NULL,
        empty_pages INTEGER NOT NULL DEFAULT 0,
        -- running / done / failed / interrupted
        status TEXT NOT NULL,
        step TEXT,
        error TEXT,
        result_json TEXT NOT NULL DEFAULT '{}',
        notes_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        finished_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_bp_reports_user ON bp_reports (user_id, created_at);
    `);
  },
};
