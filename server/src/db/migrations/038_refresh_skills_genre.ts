import type { Migration } from '../migrator.js';
import fs from 'fs';
import path from 'path';

// 把 writing-style 与 ai-detection 两个平台 skill 刷新到「文体维度」版：
// - WRITING_STYLE_SKILL.md 新增「第零部分：先定文体」（story/lyric/punchline 分体手艺）
// - AI_DETECTION_SKILL.md 新增「第零步：先认文体，再套指纹规则」（防误伤金句/抒情体）
//
// 机制同 036/037：真相源是 prompt_skill_files 里 kind='main' 那条，prompt_skills.body 只是镜像，两处一起刷。
// 幂等：仅当 DB 还不含各自的新版标志句时才覆盖，避免踩掉后台手动改动或重复刷新。
function loadSkillMd(skillName: string): string {
  const skillPath = path.resolve(process.cwd(), `../skills/${skillName}.md`);
  if (!fs.existsSync(skillPath)) return '';
  const content = fs.readFileSync(skillPath, 'utf-8');
  const match = content.match(/```\n([\s\S]*?)\n```/);
  return match ? match[1] : content;
}

function refresh(db: any, skillId: string, mdName: string, marker: string, now: string): void {
  const body = loadSkillMd(mdName);
  if (!body) return; // 文件缺失时不动 DB
  if (!body.includes(marker)) return; // .md 还没含新标志句，说明本次没更新到位，跳过

  const main = db
    .prepare("SELECT id, body FROM prompt_skill_files WHERE skill_id = ? AND kind = 'main'")
    .get(skillId) as { id: string; body: string } | undefined;

  const isNewAlready = (main?.body || '').includes(marker);
  if (main && !isNewAlready) {
    db.prepare('UPDATE prompt_skill_files SET body = ?, updated_at = ? WHERE id = ?').run(body, now, main.id);
  }

  // 镜像 body：仅当还不含标志句时刷新
  db.prepare(
    'UPDATE prompt_skills SET body = ?, updated_at = ? WHERE id = ? AND body NOT LIKE ?'
  ).run(body, now, skillId, `%${marker}%`);
}

export const migration_038: Migration = {
  id: '038_refresh_skills_genre',
  up(db) {
    const now = new Date().toISOString();
    refresh(db, 'writing-style', 'WRITING_STYLE_SKILL', '第零部分', now);
    refresh(db, 'ai-detection', 'AI_DETECTION_SKILL', '第零步', now);
  },
};
