import { describe, it, expect, beforeEach, vi } from 'vitest';

// 补料问卷的失败形态全是「看起来正常」：
// 一份空问卷读作「AI 认为你的资料已经够了」，用户于是带着半份资料跑完四看；
// 没填的题写成「答：（空）」进 prompt 之后，AI 把它当成客户确认没有这个东西；
// 整段替换客户资料会把他在另一个输入框里刚存的补充吃掉，而两次操作都显示成功。
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
const { createProject } = await import('./projectStore.js');
const { buildIntake, applyAnswers } = await import('./intakeService.js');
const { saveRound, markApplied, openRound, answeredQuestions } = await import('./intakeStore.js');

initDatabase();

describe('consult 补料问卷', () => {
  let project: any;

  beforeEach(() => {
    getDatabase().exec(
      'DELETE FROM consult_intake; DELETE FROM consult_entries; DELETE FROM consult_stages; DELETE FROM consult_projects;'
    );
    project = createProject('u1', '捷停车', '停车场 SaaS，覆盖 2000+ 车场');
    replies.length = 0;
  });

  it('模型没给出几道题时报错，不回一份空问卷（空问卷=「你的资料够了」）', async () => {
    replies.push({ text: JSON.stringify({ gaps: ['缺财务数据'], questions: [{ question: '  ' }] }) });
    await expect(buildIntake('u1', project)).rejects.toThrow(/不代表你的资料已经齐了/);
  });

  it('只把填了的题追加进资料，空题连题目一起丢掉', () => {
    const { brief, applied } = applyAnswers(
      project,
      [
        { question: '车场的平均客单价是多少？', answer: '每车场每月 1200 元', section: '看自己' },
        { question: '前三大竞品是谁？', answer: '   ' },
      ],
      '2026-08-20'
    );
    expect(applied).toBe(1);
    expect(brief).toContain('每车场每月 1200 元');
    // 没答的那题连题目都不能出现：「问：前三大竞品是谁 答：（空）」进 prompt 之后
    // 会被当成「客户说没有竞品」，比缺料更糟
    expect(brief).not.toContain('前三大竞品');
    // 追加不是替换：原来那段资料必须还在
    expect(brief).toContain('停车场 SaaS，覆盖 2000+ 车场');
  });

  it('同一轮不能补第二遍（补两遍 = 同一批答案在资料里两份，AI 当成两处独立印证）', () => {
    const round = saveRound(project.id, {
      gaps: [],
      questions: [{ id: 'q1', section: '看自己', question: '客单价多少？', why: '', placeholder: '' }],
      truncated: false,
    });
    expect(markApplied(project.id, round.id, { q1: '1200 元' }, 1)).toBe(true);
    // 第二次必须被挡掉（路由据此回 409），而且这一轮不再作为「未提交」返回
    expect(markApplied(project.id, round.id, { q1: '1200 元' }, 1)).toBe(false);
    expect(openRound(project.id)).toBeNull();
  });

  it('已经问过并且答过的题不再出现在下一轮问卷里', async () => {
    const round = saveRound(project.id, {
      gaps: [],
      questions: [
        { id: 'q1', section: '看自己', question: '车场的平均客单价是多少？', why: '', placeholder: '' },
        { id: 'q2', section: '看竞品', question: '前三大竞品是谁？', why: '', placeholder: '' },
      ],
      truncated: false,
    });
    // q2 留空 —— 客户当时答不出来的题，下一轮再问是合理的
    markApplied(project.id, round.id, { q1: '每车场每月 1200 元', q2: '' }, 1);
    expect(answeredQuestions(project.id)).toEqual(['车场的平均客单价是多少？']);

    replies.push({
      text: JSON.stringify({
        gaps: [],
        questions: [
          // 空格不一样也算同一题（中文空格可有可无，原样比会漏掉）
          { question: '车场的 平均客单价是多少？' },
          { question: '前三大竞品是谁？' },
          { question: '续约率是多少？' },
          { question: '车场分布在哪几个城市？' },
        ],
      }),
    });
    const sheet = await buildIntake('u1', project, answeredQuestions(project.id));
    const asked = sheet.questions.map((q) => q.question);
    expect(asked).not.toContain('车场的 平均客单价是多少？');
    expect(asked).toEqual(['前三大竞品是谁？', '续约率是多少？', '车场分布在哪几个城市？']);
    // 剔重之后 id 要重排：界面上的题号按下标画，对不上时用户说的「第 3 题」找不到
    expect(sheet.questions.map((q) => q.id)).toEqual(['q1', 'q2', 'q3']);
  });

  it('补进去会超上限时抛错，不静默截断（截掉的正好是刚填的答案）', () => {
    const big = { ...project, brief: '资'.repeat(19990) };
    expect(() => applyAnswers(big, [{ question: 'q', answer: '答'.repeat(100) }], '2026-08-20')).toThrow(
      /不会自动截断/
    );
  });
});
