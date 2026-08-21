import { describe, it, expect, beforeEach, vi } from 'vitest';

// 这条链路的失败全是「界面上看起来完全正常」：
// 只出一个方向 → 看起来就是「AI 的建议」，用户直接采纳，这一步该有的取舍消失了；
// 模型给的置信度认不出来 → 编出来的结论挂着 🟢 高，用户不会回来核；
// 模型回一段通顺的综述而不是清单里那几张表 → 读起来完全像一节方案，
// 只有逐项去数才看得出企业现状卡 / 痛点优先级矩阵不在里面；
// 下游 prompt 少带了直接依赖的正文 → 后面每一步照着一句话总结自己编细节，同样不报错。
//
// mock 必须在 import 业务代码之前（ESM 提升）。
const replies: Array<{ text: string; finish?: string }> = [];
const sent: any[] = [];
vi.mock('../../core/llm/gateway.js', () => ({
  aiGateway: vi.fn(async (params: any) => {
    sent.push(params);
    const r = replies.shift();
    if (!r) throw new Error('测试没有为这次 LLM 调用准备返回值');
    return { response: { choices: [{ message: { content: r.text }, finish_reason: r.finish || 'stop' }] } };
  }),
  SAMPLING: { analytic: { temperature: 0.2 } },
  QuotaExceededError: class extends Error {},
}));

const { initDatabase, getDatabase } = await import('../../db/index.js');
const { createProject, saveEntry } = await import('./projectStore.js');
const { adoptSources } = await import('./sourceStore.js');
const { draftFastStage, draftDirections } = await import('./draftService.js');

initDatabase();

/** 一份「按清单写了」的正文，长度过得了下限。 */
const FULL_BODY = `## 1. 企业现状卡\n| 维度 | 事实 | 判读 |\n| --- | --- | --- |\n| 法定身份 | 某科技有限公司 | 🟢 |\n`.padEnd(600, '文');

describe('consult AI 出草稿 / 出方向', () => {
  let project: any;

  beforeEach(() => {
    const db = getDatabase();
    db.exec(
      'DELETE FROM consult_sources; DELETE FROM consult_entries; DELETE FROM consult_stages; DELETE FROM consult_projects;'
    );
    project = createProject('u1', '捷停车', '停车场 SaaS，覆盖 2000+ 车场，客单价偏低');
    replies.length = 0;
    sent.length = 0;
  });

  it('三件套缺件的方向被丢掉，并且报错里点名缺了哪一件', async () => {
    for (const k of ['self', 'industry', 'competitor', 'audience']) {
      saveEntry(project.id, k, { conclusion: k, confidence: 'mid' });
    }
    // 第二个方向栏目齐全，只是三条动作全是口号（没有交付物/负责人/90 天目标）——
    // 这种卡片在界面上和完整的一模一样，用户照样点「就用这个」，然后在没有落地动作的
    // 情况下定下后面十一步的地基。丢掉它之后只剩一个方向，「一个方向」又会被读成
    // 「AI 就是这么建议的」，所以要抛错；不点名缺了哪一件的话他只会一直重试同一件事。
    replies.push({
      text: JSON.stringify({
        directions: [
          {
            title: '车场效率专家',
            tagline: '让每个车位多赚一次',
            identity: '停车 SaaS 里唯一按车位收益结算的那家',
            reasons: ['r1', 'r2'],
            strengths: [{ item: '2000+ 车场', support: '已联网车场数' }],
            solutions: [
              { action: 'a1', deliverable: 'd1', owner: '产品', goal90: '上线 3 个标杆车场' },
              { action: 'a2', deliverable: 'd2', owner: '运营', goal90: '客单价 +15%' },
            ],
            risks: [{ risk: '重运营', hedge: '先做标杆再复制' }],
          },
          {
            title: '资产运营伙伴',
            tagline: '把车场当资产经营',
            identity: '停车 SaaS 里唯一做资产托管的那家',
            reasons: ['r1', 'r2'],
            strengths: [{ item: '车场数据', support: '三年流水' }],
            solutions: [
              { action: 'a1', deliverable: '', owner: '', goal90: '' },
              { action: 'a2', deliverable: '', owner: '', goal90: '' },
            ],
            risks: [{ risk: '资金占用', hedge: '轻资产切入' }],
          },
        ],
      }),
    });

    await expect(draftDirections('u1', project, 'positioning')).rejects.toThrow(
      /不够拿来做选择[\s\S]*资产运营伙伴[\s\S]*交付物/
    );
  });

  it('认不出的置信度降成低档，空结论直接报错', async () => {
    // 模型把 confidence 写成了 "很高" —— 认不出来的一律按最低算：
    // 宁可让用户回来核一遍，也不要把编出来的结论标成 🟢 高。
    replies.push({
      text: JSON.stringify({
        conclusion: '一句结论',
        body: FULL_BODY,
        rationale: 'r',
        evidence: 'e',
        confidence: '很高',
        gaps: ['缺财务数据'],
      }),
    });
    const first = await draftFastStage('u1', project, 'self');
    expect(first.draft.confidence).toBe('low');
    expect(first.draft.gaps).toEqual(['缺财务数据']);

    // 结论那一格是空的时候必须报错：界面上「空草稿」和「模型没话说」长得一样，
    // 用户会以为这个客户的资料确实分析不出东西。
    replies.push({ text: JSON.stringify({ conclusion: '   ', body: FULL_BODY }) });
    await expect(draftFastStage('u1', project, 'self')).rejects.toThrow(/空的/);
  });

  it('模型只回一段综述（没按输出物清单出正文）时报错，不当成一节方案存下来', async () => {
    // 这是这次改动要挡的那个 bug：一段 300 字的通顺综述在界面上和「六项输出物都在」
    // 区别只在你逐项去数，用户会直接定稿，而这条定稿要作为依据进下游每一步。
    replies.push({
      text: JSON.stringify({
        conclusion: '这是一家做停车场 SaaS 的公司',
        body: '公司目前处于转型期，团队规模较小，产品有一定基础，建议聚焦核心场景。',
        confidence: 'mid',
        gaps: [],
      }),
    });
    await expect(draftFastStage('u1', project, 'self')).rejects.toThrow(/输出物/);
  });

  it('采纳的联网资料要整段进 prompt；一条都没采纳时 prompt 必须明说这次没联网', async () => {
    // 界面上那几条 L1 资料躺在面板里，prompt 里没有 —— 用户以为 AI 读过他勾的东西，
    // 而它照常识编了一遍，结论上还挂着「L1 联网检索」。两头都不报错。
    adoptSources(project.id, 'self', '停车行业规模', [
      { title: '停车行业白皮书', url: 'https://a.com/x', snippet: '2025 年市场规模约 300 亿', published: '2025' },
    ]);
    replies.push({ text: JSON.stringify({ conclusion: 'c', body: FULL_BODY, confidence: 'mid', gaps: [] }) });
    await draftFastStage('u1', project, 'self');
    let prompt = JSON.stringify(sent[0].messages);
    expect(prompt).toContain('2025 年市场规模约 300 亿');
    expect(prompt).toContain('a.com');

    // 反过来：没有联网资料时**不能只是少一段**。少一段的话模型手里只剩客户资料，
    // 它会照常识把推测写成「据公开数据」，读起来和查到的一模一样。
    sent.length = 0;
    getDatabase().exec('DELETE FROM consult_sources');
    replies.push({ text: JSON.stringify({ conclusion: 'c', body: FULL_BODY, confidence: 'mid', gaps: [] }) });
    await draftFastStage('u1', project, 'self');
    prompt = JSON.stringify(sent[0].messages);
    expect(prompt).toContain('还没有采纳任何联网资料');
    expect(prompt).toContain('据公开数据');
  });

  it('下游 prompt 只带直接依赖的正文，其余只带一句话总结', async () => {
    // 「看竞品」的 requires 是 self + industry。全带正文的话做到后面几步 prompt 里
    // 全是表格、客户资料被挤到最后，模型开始照自己的常识写；一条正文都不带的话
    // 它只能照着一句话总结编细节。两种都不报错，回来的东西格式完整。
    saveEntry(project.id, 'self', { conclusion: '自己那句总结', body: '自己那张现状卡', confidence: 'mid' });
    saveEntry(project.id, 'industry', { conclusion: '行业那句总结', body: '行业那张空间表', confidence: 'mid' });
    saveEntry(project.id, 'audience', { conclusion: '用户那句总结', body: '用户那张画像卡', confidence: 'mid' });

    replies.push({ text: JSON.stringify({ conclusion: 'c', body: FULL_BODY, confidence: 'mid', gaps: [] }) });
    await draftFastStage('u1', project, 'competitor');

    const prompt = JSON.stringify(sent[0].messages);
    expect(prompt).toContain('自己那张现状卡');
    expect(prompt).toContain('行业那张空间表');
    expect(prompt).toContain('用户那句总结');
    expect(prompt).not.toContain('用户那张画像卡');
  });
});
