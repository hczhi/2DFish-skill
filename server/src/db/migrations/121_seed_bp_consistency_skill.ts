import type { Migration } from '../migrator.js';
import { CONSISTENCY_METHOD, CONSISTENCY_SLOT } from '../../services/bp/methods.js';

// 播种「BP · 一致性审计」skill 并绑到 slot `bp-consistency`，让管理员在 /admin/skills 里直接改。
// 不播的话后台下拉里那一格是空的，看不出这里能配（同 105 的理由）。
// 内容就是代码里的内置默认，不写输出格式（见 services/bp/prompts.ts）。INSERT OR IGNORE：后台改过的不覆盖。
export const migration_121: Migration = {
  id: '121_seed_bp_consistency_skill',
  up(db) {
    const now = new Date().toISOString();
    db.prepare(
      `INSERT OR IGNORE INTO prompt_skills (id, key, name, description, body, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?)`
    ).run(
      CONSISTENCY_SLOT,
      CONSISTENCY_SLOT,
      'BP · 一致性审计',
      'BP 报告 5.11「内部一致性交叉表」的分析方法：比对哪些指标、怎么判冲突和严重程度。输出格式和引文核验由系统定，不在这里写。',
      CONSISTENCY_METHOD,
      now,
      now
    );
    db.prepare(
      `INSERT OR IGNORE INTO prompt_skill_files (id, skill_id, kind, filename, body, sort_order, created_at, updated_at)
       VALUES (?, ?, 'main', 'SKILL.md', ?, 0, ?, ?)`
    ).run(`${CONSISTENCY_SLOT}-main`, CONSISTENCY_SLOT, CONSISTENCY_METHOD, now, now);
    db.prepare(
      `INSERT OR IGNORE INTO prompt_skill_bindings (slot, skill_id, updated_at) VALUES (?, ?, ?)`
    ).run(CONSISTENCY_SLOT, CONSISTENCY_SLOT, now);
  },
};
