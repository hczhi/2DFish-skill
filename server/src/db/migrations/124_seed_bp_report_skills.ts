import type { Migration } from '../migrator.js';
import {
  COMPETITORS_SLOT, COMPETITORS_METHOD, INVESTORS_SLOT, INVESTORS_METHOD,
  DIAGNOSIS_SLOT, DIAGNOSIS_METHOD, ADVICE_SLOT, ADVICE_METHOD, PLAN_SLOT, PLAN_METHOD,
} from '../../services/bp/methods.js';

// 播种 BP 报告其余五章的「分析方法」skill 并绑到各自的 slot（同 121-123 的理由：不播的话后台那一格是空的）。
// 内容就是代码里的内置默认，不写输出格式 / 核验规则（见 services/bp/prompts.ts）。INSERT OR IGNORE：后台改过的不覆盖。
const SKILLS = [
  { slot: COMPETITORS_SLOT, body: COMPETITORS_METHOD, name: 'BP · 竞品与对标', desc: 'BP 报告 07「竞品分析」（含生态位十字图）+ 08「对标企业」的写法。检索词、名字核验、融资穿透由系统定。' },
  { slot: INVESTORS_SLOT, body: INVESTORS_METHOD, name: 'BP · 目标融资对象', desc: 'BP 报告 09「目标融资对象」的圈层与写法。机构名 / 合伙人姓名的核验和可信度由系统定。' },
  { slot: DIAGNOSIS_SLOT, body: DIAGNOSIS_METHOD, name: 'BP · 五维评分', desc: 'BP 报告 01-02 五维双轨评分的判分口径与扣分归因。总分、可回收分、梯队、四象限由系统算。' },
  { slot: ADVICE_SLOT, body: ADVICE_METHOD, name: 'BP · BP 优化与追问预演', desc: 'BP 报告 03「BP 优化」+ 04「追问预演」的写法。原句核验由系统定。' },
  { slot: PLAN_SLOT, body: PLAN_METHOD, name: 'BP · 90 天行动清单', desc: 'BP 报告 10「企业 90 天行动清单」的写法。三段排期由系统定。' },
];

export const migration_124: Migration = {
  id: '124_seed_bp_report_skills',
  up(db) {
    const now = new Date().toISOString();
    const skill = db.prepare(
      `INSERT OR IGNORE INTO prompt_skills (id, key, name, description, body, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?)`
    );
    const file = db.prepare(
      `INSERT OR IGNORE INTO prompt_skill_files (id, skill_id, kind, filename, body, sort_order, created_at, updated_at)
       VALUES (?, ?, 'main', 'SKILL.md', ?, 0, ?, ?)`
    );
    const bind = db.prepare(`INSERT OR IGNORE INTO prompt_skill_bindings (slot, skill_id, updated_at) VALUES (?, ?, ?)`);
    for (const s of SKILLS) {
      skill.run(s.slot, s.slot, s.name, s.desc, s.body, now, now);
      file.run(`${s.slot}-main`, s.slot, s.body, now, now);
      bind.run(s.slot, s.slot, now);
    }
  },
};
