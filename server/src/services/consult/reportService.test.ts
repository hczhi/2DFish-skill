import { describe, it, expect, beforeEach } from 'vitest';
import { initDatabase, getDatabase } from '../../db/index.js';
import { createProject, saveEntry, listEntries, platformOwner } from './projectStore.js';
import { STAGES } from './stages.js';
import { buildReport, missingStages } from './reportService.js';

initDatabase();

// 导出这条路上的失败全长成「一份完整方案」：少两章、或者某几章是在上游被改之前定的，
// 文档读起来和完整的一模一样（每章都有结论、有表格、有置信度），顾问直接发给客户。

describe('导出方案', () => {
  let project: any;

  beforeEach(() => {
    const db = getDatabase();
    db.exec('DELETE FROM consult_entries; DELETE FROM consult_stages; DELETE FROM consult_projects;');
    project = createProject(platformOwner('u1'), '捷停车', '停车场 SaaS');
  });

  const finalizeAll = (skip: string[] = []) => {
    for (const s of STAGES) {
      if (skip.includes(s.key)) continue;
      saveEntry(project.id, s.key, {
        conclusion: `${s.label} 的一句话结论`,
        body: `## 1. ${s.label}\n\n正文`,
        confidence: 'mid',
      });
    }
  };

  it('没定稿完要点名缺哪几步（导出闸门就靠这个）', () => {
    finalizeAll(['digital']);
    const missing = missingStages(listEntries(project.id));
    expect(missing).toEqual([STAGES.find((s) => s.key === 'digital')!.label]);
  });

  it('过期的章节要写进文档正文，不能只回给接口', () => {
    finalizeAll();
    // 回头改「看自己」：下游全部被标 stale，而那几章各自都读得通
    saveEntry(project.id, 'self', { conclusion: '改过的结论', body: '新正文', confidence: 'high' });
    const out = buildReport(project, listEntries(project.id));
    expect(out.stale.length).toBeGreaterThan(0);
    expect(out.markdown).toContain('章已过期');
    expect(out.markdown).toContain('⚠ **这一章已过期**');
  });

  it('只有结论没有正文的章节要说出来，不能只剩那句结论', () => {
    finalizeAll(['creative']);
    saveEntry(project.id, 'creative', { conclusion: '广告语定了', body: '', confidence: 'mid' });
    const out = buildReport(project, listEntries(project.id));
    expect(out.noBody).toContain(STAGES.find((s) => s.key === 'creative')!.label);
    expect(out.markdown).toContain('这一步定稿时没有保存正文');
  });
});
