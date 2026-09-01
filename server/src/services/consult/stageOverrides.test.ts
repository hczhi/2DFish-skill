import { describe, it, expect, beforeEach, vi } from 'vitest';

// 后台改「分析操法」只有一种失败形态，而它完全看不出来：
// **界面上显示改过了，发给模型的还是代码里那份缺省。** 那种情况下出来的正文每节都在、
// 表格也满，顾问对着后台那份新操法一条条数也数不出缺什么 —— 只有 prompt 里能看出来。
// 反过来，把内容清空之后如果真的存了个空串，这一步就变成「没有规定的推导顺序」，
// 模型自己想一套把表格填满，同样读起来完全正常。所以这里断言的是**进 prompt 的那段文字**。
//
// mock 必须在 import 业务代码之前（ESM 提升）。
const replies: Array<{ text: string }> = [];
const sent: any[] = [];
vi.mock('../../core/llm/gateway.js', () => ({
  aiGateway: vi.fn(async (params: any) => {
    sent.push(params);
    const r = replies.shift();
    if (!r) throw new Error('测试没有为这次 LLM 调用准备返回值');
    return { response: { choices: [{ message: { content: r.text }, finish_reason: 'stop' }] } };
  }),
  SAMPLING: { analytic: { temperature: 0.2 } },
  QuotaExceededError: class extends Error {},
}));

const { initDatabase, getDatabase } = await import('../../db/index.js');
const { createProject, platformOwner } = await import('./projectStore.js');
const { draftFastStage } = await import('./draftService.js');
const { setStageOverride } = await import('./stageOverrides.js');
const { STAGE_DEFAULTS, stageByKey } = await import('./stages.js');

initDatabase();

const FULL_BODY = `## 1. 企业现状卡\n| 维度 | 事实 | 判读 |\n| --- | --- | --- |\n| 法定身份 | 某科技有限公司 | 🟢 |\n`.padEnd(600, '文');
const DEFAULT_FIRST_LINE = STAGE_DEFAULTS.find((s) => s.key === 'self')!.method[0];

describe('后台改咨询步骤的操法（088）', () => {
  let project: any;

  beforeEach(() => {
    getDatabase().exec(
      'DELETE FROM consult_stage_prompts; DELETE FROM consult_messages; DELETE FROM consult_entries; DELETE FROM consult_stages; DELETE FROM consult_projects;'
    );
    project = createProject(platformOwner('u1'), '捷停车', '停车场 SaaS，覆盖 2000+ 车场，客单价偏低');
    replies.length = 0;
    sent.length = 0;
  });

  it('改过的操法要真的进 prompt，清空之后回落缺省而不是变成空的', async () => {
    setStageOverride('self', 'method', '先问客户三件事：谁付钱、谁在用、谁不满意\n再按这三件事各写一段', 'admin');

    replies.push({ text: JSON.stringify({ conclusion: 'c', body: FULL_BODY, confidence: 'mid', gaps: [] }) });
    await draftFastStage('u1', project, 'self');
    let prompt = JSON.stringify(sent[0].messages);
    expect(prompt).toContain('先问客户三件事：谁付钱、谁在用、谁不满意');
    // 缺省那份必须**被换掉**而不是叠在一起：两份操法同时在 prompt 里的话，模型按哪一份
    // 推都说得通，而后台显示的是他改过的那份。
    expect(prompt).not.toContain(DEFAULT_FIRST_LINE);

    // 「恢复缺省」= 提交空内容。存成空串的话这一步的操法整段消失，而界面上和「没改过」
    // 长得一模一样（下面这两条断言就是那种情况唯一会失败的地方）。
    sent.length = 0;
    expect(setStageOverride('self', 'method', '   \n\n', 'admin').mode).toBe('default');
    expect(stageByKey('self')!.method[0]).toBe(DEFAULT_FIRST_LINE);

    replies.push({ text: JSON.stringify({ conclusion: 'c', body: FULL_BODY, confidence: 'mid', gaps: [] }) });
    await draftFastStage('u1', project, 'self');
    prompt = JSON.stringify(sent[0].messages);
    expect(prompt).toContain(DEFAULT_FIRST_LINE);
    expect(prompt).not.toContain('先问客户三件事');
  });
});
