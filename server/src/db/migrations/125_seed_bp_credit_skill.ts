import type { Migration } from '../migrator.js';
import { CREDIT_METHOD, CREDIT_SLOT } from '../../services/bp/methods.js';

// 播种「BP · 企业信用档案」skill 并绑到 slot `bp-credit`，让管理员在 /admin/skills 里直接改。
// 不播的话后台下拉里那一格是空的，看不出这里能配（同 105 的理由）。
// 内容就是代码里的内置默认，不写输出格式（见 services/bp/prompts.ts）。INSERT OR IGNORE：后台改过的不覆盖。
export const migration_125: Migration = {
  id: '125_seed_bp_credit_skill',
  up(db) {
    const now = new Date().toISOString();
    db.prepare(
      `INSERT OR IGNORE INTO prompt_skills (id, key, name, description, body, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?)`
    ).run(
      CREDIT_SLOT,
      CREDIT_SLOT,
      'BP · 企业信用档案',
      'BP 报告 5.9「企业信用档案」的整理口径（工商 / 股权 / 知识产权 / 风险信息）。检索词、全称核验、「查不到」的写法由系统定。',
      CREDIT_METHOD,
      now,
      now
    );
    db.prepare(
      `INSERT OR IGNORE INTO prompt_skill_files (id, skill_id, kind, filename, body, sort_order, created_at, updated_at)
       VALUES (?, ?, 'main', 'SKILL.md', ?, 0, ?, ?)`
    ).run(`${CREDIT_SLOT}-main`, CREDIT_SLOT, CREDIT_METHOD, now, now);
    db.prepare(
      `INSERT OR IGNORE INTO prompt_skill_bindings (slot, skill_id, updated_at) VALUES (?, ?, ?)`
    ).run(CREDIT_SLOT, CREDIT_SLOT, now);
  },
};
