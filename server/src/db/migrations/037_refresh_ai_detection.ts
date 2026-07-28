import type { Migration } from '../migrator.js';
import fs from 'fs';
import path from 'path';

// 把 ai-detection skill（ai-detection slot，去味自检用）刷新为最新版
// skills/AI_DETECTION_SKILL.md——第一原理改成"困惑度/用词可预测性"，修辞指纹降为表层症状。
//
// 背景同 036：migration 032 用 INSERT OR IGNORE 从 .md seed，之后 .md 被重写，DB 仍是旧正文。
// 真相源是 prompt_skill_files 里 kind='main' 那条，prompt_skills.body 只是镜像，两处一起刷。
// 幂等：仅当 DB 还不含新版标志句"第一原理"时才覆盖，避免踩掉后台手动改动。
function loadSkillMd(skillName: string): string {
  const skillPath = path.resolve(process.cwd(), `../skills/${skillName}.md`);
  if (!fs.existsSync(skillPath)) return '';
  const content = fs.readFileSync(skillPath, 'utf-8');
  const match = content.match(/```\n([\s\S]*?)\n```/);
  return match ? match[1] : content;
}

export const migration_037: Migration = {
  id: '037_refresh_ai_detection',
  up(db) {
    const body = loadSkillMd('AI_DETECTION_SKILL');
    if (!body) return;

    const now = new Date().toISOString();

    const main = db
      .prepare("SELECT id, body FROM prompt_skill_files WHERE skill_id = 'ai-detection' AND kind = 'main'")
      .get() as { id: string; body: string } | undefined;

    const isNewAlready = (main?.body || '').includes('第一原理');
    if (main && !isNewAlready) {
      db.prepare('UPDATE prompt_skill_files SET body = ?, updated_at = ? WHERE id = ?').run(body, now, main.id);
    }

    db.prepare(
      "UPDATE prompt_skills SET body = ?, updated_at = ? WHERE id = 'ai-detection' AND body NOT LIKE '%第一原理%'"
    ).run(body, now);
  },
};
