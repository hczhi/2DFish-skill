import { describe, it, expect, beforeEach } from 'vitest';
import { initDatabase, getDatabase } from '../../db/index.js';
import { createProject, buildStageRail, deleteProject, listProjects, appendMessage } from './projectStore.js';
import { STAGES } from './stages.js';
import { adoptSources } from './sourceStore.js';

initDatabase();

// 这两条都是「出错时看起来完全正常」的路径：阶段栏少一节照样能出报告，
// 孤儿行照样被计数查询算进去。手测都看不出来。

describe('consult projectStore', () => {
  let projectId: string;

  beforeEach(() => {
    const db = getDatabase();
    db.exec(
      'DELETE FROM consult_sources; DELETE FROM consult_messages; DELETE FROM consult_entries; DELETE FROM consult_stages; DELETE FROM consult_projects;'
    );
    projectId = createProject('u1', '捷停车', '资料若干').id;
  });

  it('阶段栏按代码里的清单出，表里没有的照样出、表里多的不出', () => {
    const db = getDatabase();
    // 模拟一个「老项目」：一行 consult_stages 都没有，外加一个已下线的阶段残留。
    // 若按表里有哪些行来渲染，老项目会看不到任何阶段（或看到一个已删掉的阶段），
    // 而报告照样拼得出来，只是永远缺那一节 —— 没有任何一处报错。
    db.prepare(
      `INSERT INTO consult_stages (id, project_id, stage_key, status, round, created_at, updated_at)
       VALUES ('x', ?, 'retired_stage', 'decided', 3, '', '')`
    ).run(projectId);

    const rail = buildStageRail(projectId);
    expect(rail.map((s) => s.key)).toEqual(STAGES.map((s) => s.key));

    // 定稿了「看自己」之后，「看行业」才解锁；缺前提时要说出缺的是哪一步
    // （只回一个 false 的话界面只能写「未解锁」，用户会当成功能坏了）。
    expect(rail.find((s) => s.key === 'industry')).toMatchObject({
      unlocked: false,
      missing: ['看自己'],
    });
    db.prepare(
      `INSERT INTO consult_entries (id, project_id, stage_key, conclusion, created_at, updated_at)
       VALUES ('e1', ?, 'self', '停车场 SaaS', '', '')`
    ).run(projectId);
    const after = buildStageRail(projectId);
    expect(after.find((s) => s.key === 'self')).toMatchObject({ status: 'decided', hasEntry: true });
    expect(after.find((s) => s.key === 'industry')).toMatchObject({ unlocked: true, missing: [] });
  });

  it('删项目要连知识库、阶段进度、对话和联网资料一起删掉', () => {
    const db = getDatabase();
    db.prepare(
      `INSERT INTO consult_entries (id, project_id, stage_key, conclusion, created_at, updated_at)
       VALUES ('e1', ?, 'self', 'x', '', '')`
    ).run(projectId);
    db.prepare(
      `INSERT INTO consult_stages (id, project_id, stage_key, status, round, created_at, updated_at)
       VALUES ('s1', ?, 'self', 'decided', 1, '', '')`
    ).run(projectId);
    appendMessage(projectId, 'self', { role: 'user', content: '聊过一句' });
    adoptSources(projectId, 'self', '停车 SaaS 行业规模', [
      { title: '一份行业报告', url: 'https://example.com/a', snippet: '市场规模…' },
    ]);

    // db/index.ts 没开 PRAGMA foreign_keys，REFERENCES 只是注释。
    // 留下的孤儿不报错，但 listProjects 的 decided_count 是子查询算出来的，
    // 于是「已删掉的项目」的定稿数会一直挂在新建的同名项目上。
    expect(deleteProject(projectId, 'u1')).toBe(true);
    expect(db.prepare('SELECT COUNT(*) c FROM consult_entries').get()).toEqual({ c: 0 });
    expect(db.prepare('SELECT COUNT(*) c FROM consult_stages').get()).toEqual({ c: 0 });
    expect(db.prepare('SELECT COUNT(*) c FROM consult_messages').get()).toEqual({ c: 0 });
    expect(db.prepare('SELECT COUNT(*) c FROM consult_sources').get()).toEqual({ c: 0 });
    expect(listProjects('u1')).toEqual([]);
  });
});
