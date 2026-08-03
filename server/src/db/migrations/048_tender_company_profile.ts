import type { Migration } from '../migrator.js';

function addColumnIfNotExists(db: any, table: string, column: string, definition: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as any[];
  if (!cols.some((c: any) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

// 公司简介：给 LLM 评分喂一段自由文本的"我司是谁"。
//
// 为什么要它：现有的差异化通道只有 case_tags / qualifications / excluded_types 三个标签数组，
// 而这三个字段在代码里只出现在 prompt 拼接处，没有任何规则做数值计算 ——
// 也就是说它们本质上已经是一段被切碎的公司简介了。切碎反而是纯损失：
// "只做执行不做创意"、"团队 30 人最多同时接 3 个大案"、"国企甲方做得好"
// 这类真正决定投不投的信息，塞不进标签。
//
// profile_updated_at 是"评分是否过时"的判据：
// recommendService 已评过的 (user, tender) 会直接 skip，用户改完简介看列表没动静
// 会以为功能坏了。推荐行上存下打分时的 profile 版本戳，不一致就在前台标"配置已更新"。
export const migration_048: Migration = {
  id: '048_tender_company_profile',
  up(db) {
    addColumnIfNotExists(db, 'tender_user_preferences', 'company_profile', "TEXT DEFAULT ''");
    addColumnIfNotExists(db, 'tender_user_preferences', 'profile_updated_at', 'TEXT');

    // 打分那一刻用的 profile 版本戳。NULL = 简介功能上线前的历史评分，
    // 前台不给它们打"过时"标（否则一上线全部亮红，等于噪音）。
    addColumnIfNotExists(db, 'tender_recommendations', 'scored_profile_at', 'TEXT');
  },
};
