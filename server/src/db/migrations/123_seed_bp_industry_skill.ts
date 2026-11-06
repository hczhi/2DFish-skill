import type { Migration } from '../migrator.js';
import { INDUSTRY_METHOD, INDUSTRY_SLOT } from '../../services/bp/methods.js';

// 播种「BP · 行业分析」skill 并绑到 slot `bp-industry`，让管理员在 /admin/skills 里直接改。
// 不播的话后台下拉里那一格是空的，看不出这里能配（同 105 的理由）。
// 内容就是代码里的内置默认，不写输出格式（见 services/bp/prompts.ts）。INSERT OR IGNORE：后台改过的不覆盖。
export const migration_123: Migration = {
  id: '123_seed_bp_industry_skill',
  up(db) {
    const now = new Date().toISOString();
    db.prepare(
      `INSERT OR IGNORE INTO prompt_skills (id, key, name, description, body, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?)`
    ).run(
      INDUSTRY_SLOT,
      INDUSTRY_SLOT,
      'BP · 行业分析',
      'BP 报告 06「宏观分析」的写法：关键数字挑哪些、口径怎么写、趋势怎么落到这家公司。检索词、来源编号与链接、数字核验由系统定，不在这里写。',
      INDUSTRY_METHOD,
      now,
      now
    );
    db.prepare(
      `INSERT OR IGNORE INTO prompt_skill_files (id, skill_id, kind, filename, body, sort_order, created_at, updated_at)
       VALUES (?, ?, 'main', 'SKILL.md', ?, 0, ?, ?)`
    ).run(`${INDUSTRY_SLOT}-main`, INDUSTRY_SLOT, INDUSTRY_METHOD, now, now);
    db.prepare(
      `INSERT OR IGNORE INTO prompt_skill_bindings (slot, skill_id, updated_at) VALUES (?, ?, ?)`
    ).run(INDUSTRY_SLOT, INDUSTRY_SLOT, now);
  },
};
