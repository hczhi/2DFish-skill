import { describe, it, expect, beforeEach } from 'vitest';
import { initDatabase, getDatabase } from '../../db/index.js';
import { createProject, saveEntry, listEntries, parseEntryAiOpportunities } from './projectStore.js';
import { requireStage, StageError } from './draftService.js';

initDatabase();

// 两条都是「出错时看起来完全正常」的路径：
// 下游没被标 stale，报告里两节互相矛盾但一句错都不报；
// 越过前提/走错车道做出来的结论，读起来和正常的一模一样。

describe('consult 定稿与闸门', () => {
  let projectId: string;

  beforeEach(() => {
    const db = getDatabase();
    db.exec('DELETE FROM consult_entries; DELETE FROM consult_stages; DELETE FROM consult_projects;');
    projectId = createProject('u1', '捷停车', '停车场 SaaS，覆盖 2000+ 车场').id;
  });

  it('改上游结论要把全部下游标成待重跑，自己那条清掉 stale 并涨版本', () => {
    // 先把四看 + 品牌定位定下来
    for (const k of ['self', 'industry', 'competitor', 'audience', 'positioning']) {
      saveEntry(projectId, k, { conclusion: `${k} 的结论`, confidence: 'mid' });
    }
    const beforeStale = listEntries(projectId).filter((e) => e.stale).length;
    expect(beforeStale).toBe(0);

    // 回头改「看自己」 —— 定位是照旧口径写的，必须被标出来
    const { entry, staled } = saveEntry(projectId, 'self', { conclusion: '改过的结论', confidence: 'high' });
    expect(entry.version).toBe(2);
    expect(entry.stale).toBe(0);
    expect(staled).toContain('positioning');
    expect(staled).toContain('audience');
    expect(staled).not.toContain('self');

    // 重跑定位（再存一次）之后它自己的 stale 要清掉，否则那个 ⚠ 永远摘不掉，
    // 用户会一直重跑同一步。
    const again = saveEntry(projectId, 'positioning', { conclusion: '按新口径重写', confidence: 'high' });
    expect(again.entry.stale).toBe(0);
    expect(again.entry.version).toBe(2);
  });

  it('AI 赋能机会要真的落到那一列上，改一次结论也不许丢', () => {
    // 丢了的话这一步照样显示「已定稿」，只是报告最后那一章「AI 转型机会清单」
    // 少一个模块 —— 而那一章读起来是一份完整的清单，没有任何一处报错。
    saveEntry(projectId, 'self', {
      conclusion: '结论',
      confidence: 'mid',
      aiOpportunities: ['用 AI 从工单里自动归类高频故障，替掉人工月度盘点'],
    });
    const first = listEntries(projectId).find((e) => e.stage_key === 'self')!;
    expect(parseEntryAiOpportunities(first.ai_opportunities)).toEqual([
      '用 AI 从工单里自动归类高频故障，替掉人工月度盘点',
    ]);

    // 改一次结论（走的是另一条 SQL：UPDATE 而不是 INSERT）
    saveEntry(projectId, 'self', {
      conclusion: '改过的结论',
      confidence: 'high',
      aiOpportunities: ['同上那条', '第二条'],
    });
    const second = listEntries(projectId).find((e) => e.stage_key === 'self')!;
    expect(second.version).toBe(2);
    expect(parseEntryAiOpportunities(second.ai_opportunities)).toEqual(['同上那条', '第二条']);
  });

  it('前提没定稿、车道不对、阶段不存在，一律抛错而不是照样干活', () => {
    // 缺前提：报错里必须点名缺的是哪一步，只说「未解锁」用户会当功能坏了
    expect(() => requireStage(projectId, 'positioning')).toThrow(StageError);
    try {
      requireStage(projectId, 'industry');
    } catch (e: any) {
      expect(e.message).toContain('看自己');
      expect(e.status).toBe(409);
    }

    saveEntry(projectId, 'self', { conclusion: 'x', confidence: 'mid' });
    expect(requireStage(projectId, 'industry', { lanes: ['fast', 'plan'] }).stage.key).toBe('industry');

    // 慢车道的阶段不能走快车道的出草稿接口：拿到的是一句「梳理事实」式的结论，
    // 用户 review 一下就定稿，四问该有的取舍过程整个消失，而报告照样完整。
    for (const k of ['industry', 'competitor', 'audience']) {
      saveEntry(projectId, k, { conclusion: k, confidence: 'mid' });
    }
    expect(() => requireStage(projectId, 'positioning', { lanes: ['fast', 'plan'] })).toThrow(/慢车道/);

    // 不认识的 key：写进去的定稿谁也读不到（阶段栏按代码清单渲染），进度还是 0/14
    expect(() => requireStage(projectId, 'no_such_stage')).toThrow(/没有这个阶段/);
  });
});
