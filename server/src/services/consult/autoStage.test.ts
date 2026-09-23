import { describe, it, expect, beforeEach, vi } from 'vitest';

// 「这一步全自动跑完」的两条「界面上读起来完全正常」的路径：
// ① 跑完是一句「✅ 已自动定稿」，而那几处取舍是 AI 替他定的 —— 这件事只写在拍板那条
//    记录里的话，跑完十四步他读的是十四份已定稿，地基是谁定的要逐步往上翻才看得到；
// ② 断在半句话上的那一版被自动定稿 —— 那一步显示「已定稿」，而缺的那几节从此进下游
//    每一步的 prompt，没有任何一处报错。
//
// mock 必须在 import 业务代码之前（ESM 提升）。
const replies: Array<{ text: string; finish?: string }> = [];
vi.mock('../../core/llm/gateway.js', () => ({
  aiGateway: vi.fn(async () => {
    const r = replies.shift();
    if (!r) throw new Error('测试没有为这次 LLM 调用准备返回值');
    return { response: { choices: [{ message: { content: r.text }, finish_reason: r.finish || 'stop' }] } };
  }),
  SAMPLING: { analytic: { temperature: 0.2 } },
  QuotaExceededError: class extends Error {},
}));

const { initDatabase, getDatabase } = await import('../../db/index.js');
const { createProject, saveEntry, listEntries, listMessages, platformOwner } = await import('./projectStore.js');
const { startRun, activeRuns } = await import('./runStore.js');
const { runStageAuto } = await import('./autoStageService.js');

initDatabase();

const FULL_BODY = `## 1. 占位结论\n| 维度 | 事实 | 判读 |\n| --- | --- | --- |\n`.padEnd(600, '文');
const draftReply = JSON.stringify({ conclusion: '占位成「最省心的车场运营伙伴」', body: FULL_BODY, confidence: 'mid' });
const decisionsReply = JSON.stringify({
  points: [
    {
      methodRef: '操法 2',
      question: '占位取哪个角色？',
      basis: '看自己那一步没定死，两条都说得通',
      options: [
        { label: '省心的运营伙伴', detail: '主打托管', cost: '放弃硬件毛利' },
        { label: '最便宜的硬件', detail: '主打价格', cost: '放弃服务溢价' },
      ],
      recommend: '建议「省心的运营伙伴」—— 客单价撑得住。',
    },
  ],
  noFork: '',
  missing: [],
});

/** 上游四看先定稿，慢车道那一步才解锁。 */
function seedUpstream(projectId: string) {
  for (const k of ['self', 'industry', 'competitor', 'audience']) {
    saveEntry(projectId, k, { conclusion: `${k} 的结论`, body: FULL_BODY, confidence: 'mid' });
  }
}

describe('consult 单步全自动', () => {
  let project: any;

  beforeEach(() => {
    const db = getDatabase();
    db.exec(
      'DELETE FROM consult_runs; DELETE FROM consult_messages; DELETE FROM consult_entries; DELETE FROM consult_stages; DELETE FROM consult_projects;'
    );
    project = createProject(platformOwner('u1'), '捷停车', '停车场 SaaS，覆盖 2000+ 车场，客单价偏低');
    replies.length = 0;
  });

  it('慢车道跑完之后，定稿那条记录里写明地基是 AI 替他定的', async () => {
    seedUpstream(project.id);
    replies.push({ text: decisionsReply }, { text: draftReply });

    const run = startRun(project.id, 'positioning', 'draft')!;
    const out = await runStageAuto('u1', project, run, '');
    expect(out.status).toBe('done');
    expect(out.aiPicked).toBe(1);

    // 定稿那条记录是他跑完之后真正会读的那一条。这句话不在这里的话，
    // 「AI 替他定的地基」只存在于上面那条拍板记录里（要往上翻才看得到）。
    const entryMsg = [...listMessages(project.id, 'positioning')].reverse().find((m) => m.kind === 'entry');
    expect(entryMsg?.content).toMatch(/AI 替你定的/);
    expect(entryMsg?.content).toMatch(/没有人看过/);
    expect(listEntries(project.id).some((e) => e.stage_key === 'positioning')).toBe(true);
  });

  it('被截断的那一版不自动定稿，并且这条 run 上写出成因', async () => {
    seedUpstream(project.id);
    replies.push({ text: decisionsReply }, { text: draftReply, finish: 'length' });

    const run = startRun(project.id, 'positioning', 'draft')!;
    const out = await runStageAuto('u1', project, run, '');
    expect(out.status).toBe('failed');
    expect(listEntries(project.id).some((e) => e.stage_key === 'positioning')).toBe(false);

    // 成因要写出「被截断 + 没有定稿」两半：只写一句「失败」的话他分不清该重跑还是该去看草稿
    const dead = activeRuns(project.id).find((r) => r.id === run.id);
    expect(dead?.status).toBe('failed');
    expect(dead?.error).toMatch(/截断/);
    expect(dead?.error).toMatch(/没.*自动定稿/);
  });
});
