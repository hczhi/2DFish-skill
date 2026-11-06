import type { Migration } from '../migrator.js';
import { PITCH_SLOT, PITCH_METHOD } from '../../services/bp/methods.js';

// 播种「模拟路演 · 投资人追问」skill（单独一条迁移：131 可能已经在开发库上跑过，改 131 不会再执行）。
// 只管怎么问、怎么点评；轮次、分数校验、平均分由系统定。INSERT OR IGNORE：后台改过的不覆盖。
export const migration_133: Migration = {
  id: '133_seed_bp_pitch_skill',
  up(db) {
    const now = new Date().toISOString();
    db.prepare(`INSERT OR IGNORE INTO prompt_skills (id, key, name, description, body, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)`)
      .run(PITCH_SLOT, PITCH_SLOT, 'BP · 模拟路演', 'BP 模拟路演里 AI 投资人怎么追问、怎么点评。轮次上限、分数校验、平均分由系统定；投资人类型的关注点在代码里（pitchService.PERSONAS）。', PITCH_METHOD, now, now);
    db.prepare(`INSERT OR IGNORE INTO prompt_skill_files (id, skill_id, kind, filename, body, sort_order, created_at, updated_at) VALUES (?, ?, 'main', 'SKILL.md', ?, 0, ?, ?)`)
      .run(`${PITCH_SLOT}-main`, PITCH_SLOT, PITCH_METHOD, now, now);
    db.prepare(`INSERT OR IGNORE INTO prompt_skill_bindings (slot, skill_id, updated_at) VALUES (?, ?, ?)`).run(PITCH_SLOT, PITCH_SLOT, now);
  },
};
