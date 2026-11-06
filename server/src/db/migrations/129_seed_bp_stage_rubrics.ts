import type { Migration } from '../migrator.js';
import { STAGE_SLOTS, STAGE_RUBRICS } from '../../services/bp/methods.js';

// 播种 BP 五维评分的「分阶段标尺」skill（每个轮次一份），绑到各自的 slot，管理员在 /admin/skills 里校准。
// 内容就是代码里的内置默认；只写判分口径，分数 / 梯队由系统算。INSERT OR IGNORE：后台改过的不覆盖。
const NAMES: Record<string, string> = { angel: '天使 / 种子轮', preA: 'Pre-A 轮', A: 'A 轮', B: 'B 轮及以后', general: '未写明轮次（通用）' };

export const migration_129: Migration = {
  id: '129_seed_bp_stage_rubrics',
  up(db) {
    const now = new Date().toISOString();
    const skill = db.prepare(`INSERT OR IGNORE INTO prompt_skills (id, key, name, description, body, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)`);
    const file = db.prepare(`INSERT OR IGNORE INTO prompt_skill_files (id, skill_id, kind, filename, body, sort_order, created_at, updated_at) VALUES (?, ?, 'main', 'SKILL.md', ?, 0, ?, ?)`);
    const bind = db.prepare(`INSERT OR IGNORE INTO prompt_skill_bindings (slot, skill_id, updated_at) VALUES (?, ?, ?)`);
    for (const [stage, slot] of Object.entries(STAGE_SLOTS)) {
      const body = STAGE_RUBRICS[stage as keyof typeof STAGE_RUBRICS];
      skill.run(slot, slot, `BP · 评分标尺 · ${NAMES[stage]}`, `BP 报告 01-02 五维评分在「${NAMES[stage]}」时用的判分口径（这个阶段该有什么、不该苛求什么）。平台参考口径，可按你的经验校准。`, body, now, now);
      file.run(`${slot}-main`, slot, body, now, now);
      bind.run(slot, slot, now);
    }
  },
};
