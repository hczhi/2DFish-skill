import type { Migration } from '../migrator.js';
import fs from 'fs';
import path from 'path';

// 把 writing-style skill（xhs-ask slot 的平台底座）刷新为最新版
// skills/WRITING_STYLE_SKILL.md（单根生长法：正向手艺 + 避坑禁令）。
//
// 背景：migration 030 用硬编码快照建了 writing-style，031 又把该快照 backfill 成主文件。
// 之后 .md 被重写为新版，但 DB 里仍是旧正文——本迁移把真相源（prompt_skill_files 主文件）
// 与镜像（prompt_skills.body）一起更新到新版。仅当 DB 里还是旧内容时才覆盖，避免踩掉用户在后台的手动改动。
function loadSkillMd(skillName: string): string {
  const skillPath = path.resolve(process.cwd(), `../skills/${skillName}.md`);
  if (!fs.existsSync(skillPath)) return '';
  const content = fs.readFileSync(skillPath, 'utf-8');
  const match = content.match(/```\n([\s\S]*?)\n```/);
  return match ? match[1] : content;
}

export const migration_036: Migration = {
  id: '036_refresh_writing_style',
  up(db) {
    const body = loadSkillMd('WRITING_STYLE_SKILL');
    if (!body) return; // 文件缺失时不动 DB

    const now = new Date().toISOString();

    // 只在主文件仍是「旧硬编码正文」时刷新——判据：不含新版特有的「单根生长」。
    // 若用户已在后台改过，则大概率不含这句以外的旧特征，此处保守只认旧正文的标志句。
    const main = db
      .prepare("SELECT id, body FROM prompt_skill_files WHERE skill_id = 'writing-style' AND kind = 'main'")
      .get() as { id: string; body: string } | undefined;

    const isNewAlready = (main?.body || '').includes('单根生长');
    if (main && !isNewAlready) {
      db.prepare('UPDATE prompt_skill_files SET body = ?, updated_at = ? WHERE id = ?').run(body, now, main.id);
    }

    // 同步镜像 body（向后兼容旧读法），并顺带更新描述。
    db.prepare(
      "UPDATE prompt_skills SET body = ?, description = ?, updated_at = ? WHERE id = 'writing-style' AND body NOT LIKE '%单根生长%'"
    ).run(
      body,
      '人类化写作通则（单根生长法）：先讲怎么长出好内容（正向手艺），再讲避坑（禁令）。作为 xhs 生成/陪写的平台底座。',
      now
    );
  },
};
