import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { initDatabase } from '../db/index.js';
import {
  detectSkillDirs, importSkillTree, validateSkill, listSkillFiles,
} from '../services/agentSkillService.js';

initDatabase();

// 用真实的下发目录跑一遍导入。这个套件是「1 个总入口 + 4 个子技能」的结构，
// 也就是导入功能最容易搞错的那种形状 —— 当成一个技能导会静默吞掉 4 个。
//
// 目录不在（换台机器 / CI）就跳过，不让它变成一个假失败。
const SUITE = '/Users/czhih/Downloads/director-diary-skills';
const present = fs.existsSync(SUITE);

describe.skipIf(!present)('导入真实的 director-diary-skills 套件', () => {
  it('认出 5 个技能，全部导入，且各自的相对路径是对的', () => {
    expect(detectSkillDirs(SUITE)).toHaveLength(5);

    const result = importSkillTree(SUITE);
    expect(result.failed).toEqual([]);
    expect(result.imported.map((r) => r.skill.name).sort()).toEqual([
      'director-diary-init',
      'director-diary-suite',
      'note-review',
      'project-director-diary',
      'quick-note',
    ]);

    // 总入口不该把子技能的文件吞进来
    const root = result.imported.find((r) => r.skill.name === 'director-diary-suite')!;
    expect(root.files).toContain('director_diary_suite.py');
    expect(root.files.some((f) => f.startsWith('quick-note/'))).toBe(false);

    // 子技能的脚本路径相对它自己的根 —— 带上父目录前缀的话 cd 进去就找不到脚本
    const qn = result.imported.find((r) => r.skill.name === 'quick-note')!;
    expect(qn.files).toContain('scripts/add_record.py');
    expect(listSkillFiles(qn.skill.id).find((f) => f.path === 'scripts/add_record.py')!.executable)
      .toBe(1);
  });

  it('导进来的每个技能，校验问题都是可读的（不崩、不空转）', () => {
    // 这里不断言「零 error」：别人下发的技能本来就可能有不一致，
    // 我们的责任是把问题**说出来**，而不是假装它没问题。
    const result = importSkillTree(SUITE);
    for (const r of result.imported) {
      const issues = validateSkill(r.skill.id);
      for (const i of issues) {
        expect(['error', 'warning']).toContain(i.level);
        expect(i.message.length).toBeGreaterThan(0);
      }
    }
  });
});
