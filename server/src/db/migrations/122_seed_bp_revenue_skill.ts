import type { Migration } from '../migrator.js';
import { REVENUE_METHOD, REVENUE_SLOT } from '../../services/bp/methods.js';

// 播种「BP · 收入质量」skill 并绑到 slot `bp-revenue`，让管理员在 /admin/skills 里直接改。
// 不播的话后台下拉里那一格是空的，看不出这里能配（同 105 的理由）。
// 内容就是代码里的内置默认，不写输出格式（见 services/bp/prompts.ts）。INSERT OR IGNORE：后台改过的不覆盖。
export const migration_122: Migration = {
  id: '122_seed_bp_revenue_skill',
  up(db) {
    const now = new Date().toISOString();
    db.prepare(
      `INSERT OR IGNORE INTO prompt_skills (id, key, name, description, body, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?)`
    ).run(
      REVENUE_SLOT,
      REVENUE_SLOT,
      'BP · 收入质量（摘数字）',
      'BP 报告 5.12「收入质量体检」从 BP 里摘原始数字时的口径（收入 vs 合同额、累计 vs 年度、预测不算）。要摘哪几项、比率公式和风险阈值由系统定，不在这里写。',
      REVENUE_METHOD,
      now,
      now
    );
    db.prepare(
      `INSERT OR IGNORE INTO prompt_skill_files (id, skill_id, kind, filename, body, sort_order, created_at, updated_at)
       VALUES (?, ?, 'main', 'SKILL.md', ?, 0, ?, ?)`
    ).run(`${REVENUE_SLOT}-main`, REVENUE_SLOT, REVENUE_METHOD, now, now);
    db.prepare(
      `INSERT OR IGNORE INTO prompt_skill_bindings (slot, skill_id, updated_at) VALUES (?, ?, ?)`
    ).run(REVENUE_SLOT, REVENUE_SLOT, now);
  },
};
