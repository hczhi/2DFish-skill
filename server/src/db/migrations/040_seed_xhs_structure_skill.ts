import type { Migration } from '../migrator.js';
import fs from 'fs';
import path from 'path';

// Seed 结构化写作底座 skill（思维方法层：定主题/搭结构/校验），绑定到新 slot xhs-structure。
// 正文取自 skills/XHS_STRUCTURE_SKILL.md 里的代码块（沿用 032 的提取方式）。
// 若绑定已存在则不覆盖（INSERT OR IGNORE），后台可自行改绑。

function loadSkillMd(skillName: string): string {
  const skillPath = path.resolve(process.cwd(), `../skills/${skillName}.md`);
  if (!fs.existsSync(skillPath)) return '';
  const content = fs.readFileSync(skillPath, 'utf-8');
  const match = content.match(/```\n([\s\S]*?)\n```/);
  return match ? match[1] : content;
}

export const migration_040: Migration = {
  id: '040_seed_xhs_structure_skill',
  up(db) {
    const now = new Date().toISOString();
    const body = loadSkillMd('XHS_STRUCTURE_SKILL');

    db.prepare(
      `INSERT OR IGNORE INTO prompt_skills (id, key, name, description, body, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?)`
    ).run(
      'xhs-structure',
      'xhs-structure',
      '小红书结构化写作底座',
      '定主题/搭结构/校验的思维方法层：帮作者把模糊想法理成撑得住的结构树，不替他写。',
      body,
      now,
      now
    );

    db.prepare(
      `INSERT OR IGNORE INTO prompt_skill_files (id, skill_id, kind, filename, body, sort_order, created_at, updated_at)
       VALUES (?, ?, 'main', 'SKILL.md', ?, 0, ?, ?)`
    ).run('xhs-structure-main', 'xhs-structure', body, now, now);

    db.prepare(
      'INSERT OR IGNORE INTO prompt_skill_bindings (slot, skill_id, updated_at) VALUES (?, ?, ?)'
    ).run('xhs-structure', 'xhs-structure', now);
  },
};
