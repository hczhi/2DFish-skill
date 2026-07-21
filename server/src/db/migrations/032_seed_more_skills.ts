import type { Migration } from '../migrator.js';
import fs from 'fs';
import path from 'path';
import { SCORING_PROMPT } from '../../services/xhs/scoringService.js';

// 把 xhs 评分、discover 的 SEO 评分 / AI 味检测这三处硬编码 / 读文件的 prompt
// 统一迁进 skill 系统，并绑定到各自的 slot。
// SEO / AI 检测的正文来自 skills/*.md 里的代码块（沿用原 loadSkill 的提取方式）。

function loadSkillMd(skillName: string): string {
  const skillPath = path.resolve(process.cwd(), `../skills/${skillName}.md`);
  if (!fs.existsSync(skillPath)) return '';
  const content = fs.readFileSync(skillPath, 'utf-8');
  const match = content.match(/```\n([\s\S]*?)\n```/);
  return match ? match[1] : content;
}

export const migration_032: Migration = {
  id: '032_seed_more_skills',
  up(db) {
    const now = new Date().toISOString();

    const insertSkill = db.prepare(
      `INSERT OR IGNORE INTO prompt_skills (id, key, name, description, body, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?)`
    );
    const insertMain = db.prepare(
      `INSERT OR IGNORE INTO prompt_skill_files (id, skill_id, kind, filename, body, sort_order, created_at, updated_at)
       VALUES (?, ?, 'main', 'SKILL.md', ?, 0, ?, ?)`
    );
    const bind = db.prepare(
      'INSERT OR IGNORE INTO prompt_skill_bindings (slot, skill_id, updated_at) VALUES (?, ?, ?)'
    );

    const seeds: Array<{ id: string; key: string; name: string; desc: string; body: string; slot: string }> = [
      {
        id: 'xhs-scoring',
        key: 'xhs-scoring',
        name: '小红书爆款评分',
        desc: '按六维度锚点严格诊断小红书笔记能不能爆，输出 JSON。',
        body: SCORING_PROMPT,
        slot: 'xhs-score',
      },
      {
        id: 'seo-score',
        key: 'seo-score',
        name: 'SEO 质量评分',
        desc: '基于 Google 排名因素对文章 SEO 打分，输出可执行优化建议。',
        body: loadSkillMd('SEO_SCORE_SKILL'),
        slot: 'seo-score',
      },
      {
        id: 'ai-detection',
        key: 'ai-detection',
        name: 'AI 味检测',
        desc: '检测文章的 AI 生成痕迹，输出量化评分与修改建议。',
        body: loadSkillMd('AI_DETECTION_SKILL'),
        slot: 'ai-detection',
      },
    ];

    for (const s of seeds) {
      insertSkill.run(s.id, s.key, s.name, s.desc, s.body, now, now);
      insertMain.run(`${s.id}-main`, s.id, s.body, now, now);
      bind.run(s.slot, s.id, now);
    }
  },
};
