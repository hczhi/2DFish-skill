import { describe, it, expect, beforeEach, vi } from 'vitest';

// 「先定方向」这一屏只有两种失败形态，两种在界面上都读作成功：
// 一是模型给的岔路口全不能用（缺依据 / 凑不出带代价的选项）时回一屏空白 ——
// 那读起来就是「这一步没有要你拍板的取舍，直接出方案吧」，而这条路存在的全部理由
// 就是别让模型悄悄替顾问定；
// 二是丢掉的那几处不出声 —— 少一处的卡片和「这一步只有两处要定」一模一样，
// 而那一处最后就是模型自己定的。
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
const { createProject, saveEntry, platformOwner, appendMessage } = await import('./projectStore.js');
const { buildDecisions, applyDecisions } = await import('./decisionService.js');
const { draftFastStage } = await import('./draftService.js');

initDatabase();

/** 一处能用的岔路口（有依据、两个选项都带代价）。 */
const GOOD = {
  methodRef: '操法 2',
  question: '角色取「效率专家」还是「陪伴者」？',
  basis: '看竞品那一步定稿写了对手全在讲硬件参数',
  options: [
    { label: '效率专家', detail: '对着车场运营方讲通行效率', cost: '放弃车主端的情感沟通' },
    { label: '陪伴者', detail: '对着车主讲省心', cost: '放弃对 B 端招标的说服力' },
  ],
};

describe('consult 先定方向（岔路口）', () => {
  let project: any;

  beforeEach(() => {
    getDatabase().exec(
      'DELETE FROM consult_messages; DELETE FROM consult_entries; DELETE FROM consult_stages; DELETE FROM consult_projects;'
    );
    project = createProject(platformOwner('u1'), '捷停车', '停车场 SaaS，覆盖 2000+ 车场');
    for (const k of ['self', 'industry', 'competitor', 'audience']) {
      saveEntry(project.id, k, { conclusion: k, confidence: 'mid' });
    }
    replies.length = 0;
  });

  it('模型给的岔路口全不能用时抛错，不回一屏「这一步没有要你定的」', async () => {
    replies.push({
      text: JSON.stringify({
        points: [
          // 没依据：这种岔路口多半是编的，而卡片上它和真的一模一样
          { question: '要不要做高端线？', options: GOOD.options },
          // 选项没有代价：三个都挺好，顾问随手点一个 = 模型替他定了
          {
            question: '主打哪个人群？',
            basis: '资料里两类客户都有',
            options: [
              { label: '车场运营方', detail: 'B 端' },
              { label: '车主', detail: 'C 端' },
            ],
          },
        ],
        noFork: '',
      }),
    });
    await expect(buildDecisions('u1', project, 'positioning')).rejects.toThrow(
      /这一步没有要你拍板的取舍/
    );
  });

  it('丢掉的那几处必须出现在 dropped 里，不能只少一张卡片', async () => {
    replies.push({
      text: JSON.stringify({
        points: [
          GOOD,
          // 只凑出一个带代价的选项 —— 一个选项的「岔路口」是通知，不是选择
          {
            question: '定价带往上走还是往下走？',
            basis: '客户资料写了客单价偏低',
            options: [{ label: '往上走', cost: '放弃现有的低价客户' }, { label: '往下走' }],
          },
        ],
        noFork: '',
        missing: ['去年各城市的车场数'],
      }),
    });
    const sheet = await buildDecisions('u1', project, 'positioning');
    expect(sheet.points.map((p) => p.question)).toEqual([GOOD.question]);
    expect(sheet.dropped.join()).toContain('定价带往上走还是往下走？');
    // 缺事实的走 missing，不做成选项（做成选项就是让他猜一个数字）
    expect(sheet.missing).toEqual(['去年各城市的车场数']);
  });

  // ── 拍板 ──────────────────────────────────────────────
  //
  // 这三条测的是同一种事故的三个入口：**正文的地基是谁定的，在正文里看不出来。**

  /** 往对话里塞一版岔路口清单（正常是路由干的），返回那条消息的 id。 */
  const putSheet = (points: any[]) =>
    appendMessage(project.id, 'positioning', {
      role: 'assistant',
      kind: 'decisions',
      content: '（岔路口）',
      payload: { points, noFork: '', missing: [], dropped: [], truncated: false },
    }).id;

  it('拿旧那一版的选择去拍板要拒掉，不把答案配到新问题上', () => {
    // 清单里的 id 是按顺序生成的（d1..dN），所以重出一版之后同一个 d1 已经是另一个问题。
    // 照旧存下来的记录是「问题 A + 答案 B」，而它在对话里、在正文的方法论速览里
    // 读起来完全正常 —— 顾问以为自己定的是这一版看到的那几处。
    const old = putSheet([{ ...GOOD, id: 'd1' }]);
    putSheet([{ ...GOOD, id: 'd1', question: '品类先占「智慧停车」还是「车场运营服务」？' }]);
    expect(() => applyDecisions(project.id, 'positioning', old, [{ id: 'd1', label: '效率专家' }])).toThrow(
      /不是最新那一版/
    );
  });

  it('有一处没选就不算定完（留空的那处 AI 会自己定，而正文看不出来）', () => {
    const sheet = putSheet([
      { ...GOOD, id: 'd1' },
      { ...GOOD, id: 'd2', question: '画像先按车场规模分还是按城市线级分？' },
    ]);
    expect(() =>
      applyDecisions(project.id, 'positioning', sheet, [{ id: 'd1', label: '效率专家' }])
    ).toThrow(/还有 1 处没定/);
  });

  it('慢车道没拍板就不出正文（不然那几处取舍又是 AI 自己定的）', async () => {
    // 这条闸是整个流程的意义所在：不拦的话 /draft 就是「AI 替你把取舍定了再写一份完整
    // 正文」，而它的产出和照顾问定的方向写出来的一模一样。
    await expect(draftFastStage('u1', project, 'positioning')).rejects.toThrow(/要先定方向再出正文/);
  });
});
