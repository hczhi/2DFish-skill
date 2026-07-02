import { readFile } from './fileService.js';
import matter from 'gray-matter';
import fs from 'fs';
import path from 'path';

export interface SkillInfo {
  name: string;
  description: string;
  path: string;
  body: string;
  isProject: boolean;
  keywords?: string[];
  category?: string;
}

const WORKSPACES_ROOT = path.resolve(process.cwd(), '../workspaces');

function extractKeywordsFromDescription(desc: string): string[] {
  const keywords = new Set<string>();
  const lines = desc.split('\n');
  for (const line of lines) {
    const triggerMatch = line.match(/触发方式[：:]\s*(.+)/);
    if (triggerMatch) {
      const parts = triggerMatch[1].split(/[、,，]/);
      for (const p of parts) {
        const clean = p.replace(/[「」『』]/g, '').trim();
        if (clean && clean.length > 1) keywords.add(clean);
      }
    }
    const quoted = line.match(/[「『]([^」』]+)[」』]/g);
    if (quoted) {
      for (const m of quoted) {
        const inner = m.slice(1, -1).trim();
        if (inner.length > 1) keywords.add(inner);
      }
    }
  }
  return [...keywords];
}

export function loadAllSkills(): SkillInfo[] {
  const skills: SkillInfo[] = [];
  const basePath = path.join(WORKSPACES_ROOT, 'default', 'skills');

  if (!fs.existsSync(basePath)) return skills;

  const entries = fs.readdirSync(basePath, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;

    if (entry.isDirectory()) {
      const skillMdPath = path.join(basePath, entry.name, 'SKILL.md');
      if (fs.existsSync(skillMdPath)) {
        try {
          const content = fs.readFileSync(skillMdPath, 'utf-8');
          const { data, content: body } = matter(content);
          const explicitKeywords = data.trigger?.keywords || [];
          const inferredKeywords = explicitKeywords.length === 0
            ? extractKeywordsFromDescription(data.description || '')
            : [];
          skills.push({
            name: data.name || entry.name,
            description: data.description || '',
            path: `skills/${entry.name}/SKILL.md`,
            body: body.trim(),
            isProject: true,
            keywords: [...explicitKeywords, ...inferredKeywords],
            category: data.category,
          });
        } catch { /* skip */ }
      } else {
        const subEntries = fs.readdirSync(path.join(basePath, entry.name), { withFileTypes: true });
        for (const sub of subEntries) {
          if (!sub.isDirectory() || sub.name.startsWith('.')) continue;
          const subSkillMd = path.join(basePath, entry.name, sub.name, 'SKILL.md');
          if (fs.existsSync(subSkillMd)) {
            try {
              const content = fs.readFileSync(subSkillMd, 'utf-8');
              const { data, content: body } = matter(content);
              const explicitKeywords = data.trigger?.keywords || [];
              const inferredKeywords = explicitKeywords.length === 0
                ? extractKeywordsFromDescription(data.description || '')
                : [];
              skills.push({
                name: data.name || sub.name,
                description: data.description || '',
                path: `skills/${entry.name}/${sub.name}/SKILL.md`,
                body: body.trim(),
                isProject: true,
                keywords: [...explicitKeywords, ...inferredKeywords],
                category: data.category,
              });
            } catch { /* skip */ }
          }
        }
      }
    } else if (entry.name.endsWith('.md')) {
      try {
        const content = readFile(`skills/${entry.name}`);
        const { data, content: body } = matter(content);
        skills.push({
          name: data.name || entry.name.replace('.md', ''),
          description: data.description || '',
          path: `skills/${entry.name}`,
          body: body.trim(),
          isProject: false,
          keywords: data.trigger?.keywords || data.keywords || [],
          category: data.category,
        });
      } catch { /* skip */ }
    }
  }

  return skills;
}

export function findMatchingSkills(userMessage: string): SkillInfo[] {
  const skills = loadAllSkills();
  const matched: SkillInfo[] = [];
  const msgLower = userMessage.toLowerCase();

  for (const skill of skills) {
    const triggers = [
      skill.name.toLowerCase(),
      `@${skill.name.toLowerCase()}`,
    ];
    if (skill.keywords) {
      for (const kw of skill.keywords) {
        triggers.push(kw.toLowerCase());
      }
    }
    if (triggers.some(t => msgLower.includes(t))) {
      matched.push(skill);
    }
  }

  return matched;
}

export function buildSkillPromptSection(skills: SkillInfo[]): string {
  if (skills.length === 0) return '';

  const sections = skills.map(skill => `
### Skill: ${skill.name}
${skill.description ? `> ${skill.description}` : ''}

${skill.body}
`).join('\n');

  return `
## 激活的 Skills
以下 Skill 已被用户触发，请按照 Skill 的指示执行：
${sections}`;
}
