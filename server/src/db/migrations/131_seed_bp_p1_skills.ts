import type { Migration } from '../migrator.js';
import { TEAM_SLOT, TEAM_METHOD, CREDIBILITY_SLOT, CREDIBILITY_METHOD, FINANCING_SLOT, FINANCING_METHOD } from '../../services/bp/methods.js';

// 播种团队评估 / 可信度核验 / 融资方案三章的「分析方法」skill（同 124 的写法）。INSERT OR IGNORE：后台改过的不覆盖。
const SKILLS = [
  { slot: TEAM_SLOT, body: TEAM_METHOD, name: 'BP · 团队竞争力评估', desc: 'BP 报告 5.10 团队评估的写法。成员名单、外部印证的名字核验、核实状态由系统定。' },
  { slot: CREDIBILITY_SLOT, body: CREDIBILITY_METHOD, name: 'BP · 可信度核验', desc: 'BP 报告 5.7 声明核验的写法。证据清单、原文核验、整体评级由系统定。' },
  { slot: FINANCING_SLOT, body: FINANCING_METHOD, name: 'BP · 融资方案', desc: 'BP 报告 09 融资方案的建议写法。融资额、估值、门槛、股权数字全部由系统算（参考口径在「BP 参考口径」后台）。' },
];

export const migration_131: Migration = {
  id: '131_seed_bp_p1_skills',
  up(db) {
    const now = new Date().toISOString();
    const skill = db.prepare(`INSERT OR IGNORE INTO prompt_skills (id, key, name, description, body, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)`);
    const file = db.prepare(`INSERT OR IGNORE INTO prompt_skill_files (id, skill_id, kind, filename, body, sort_order, created_at, updated_at) VALUES (?, ?, 'main', 'SKILL.md', ?, 0, ?, ?)`);
    const bind = db.prepare(`INSERT OR IGNORE INTO prompt_skill_bindings (slot, skill_id, updated_at) VALUES (?, ?, ?)`);
    for (const s of SKILLS) {
      skill.run(s.slot, s.slot, s.name, s.desc, s.body, now, now);
      file.run(`${s.slot}-main`, s.slot, s.body, now, now);
      bind.run(s.slot, s.slot, now);
    }
  },
};
