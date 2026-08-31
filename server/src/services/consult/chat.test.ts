import { describe, it, expect, beforeEach, vi } from 'vitest';

// 阶段内对话的失败全是「回答得很通顺，只是答的不是这回事」：
// 串了别的阶段的上下文 → 讨论品牌定位时照着看行业那段答，一句错都不报；
// 模型空返回却把用户那句话留在库里 → 他以为没发出去又问一遍，下一轮 AI
// 带着重复的问题回答，也不报错。
//
// mock 必须在 import 业务代码之前（ESM 提升）。
const replies: Array<{ text: string; finish?: string }> = [];
const sent: any[] = [];
vi.mock('../../core/llm/gateway.js', () => ({
  aiGateway: vi.fn(async (params: any) => {
    sent.push(params);
    const r = replies.shift();
    if (!r) throw new Error('测试没有为这次 LLM 调用准备返回值');
    return {
      response: { choices: [{ message: { content: r.text }, finish_reason: r.finish || 'stop' }] },
    };
  }),
  SAMPLING: { analytic: { temperature: 0.2 } },
  QuotaExceededError: class extends Error {},
}));

const { initDatabase, getDatabase } = await import('../../db/index.js');
const { createProject, appendMessage, listMessages, platformOwner } = await import('./projectStore.js');
const { chatInStage, directionsToText, entryToText } = await import('./chatService.js');

initDatabase();

describe('consult 阶段内对话', () => {
  let project: any;

  beforeEach(() => {
    const db = getDatabase();
    db.exec(
      'DELETE FROM consult_messages; DELETE FROM consult_entries; DELETE FROM consult_stages; DELETE FROM consult_projects;'
    );
    project = createProject(platformOwner('u1'), '捷停车', '停车场 SaaS，覆盖 2000+ 车场');
    replies.length = 0;
    sent.length = 0;
  });

  it('只带本阶段的对话进 prompt，不串别的阶段', async () => {
    appendMessage(project.id, 'self', { role: 'user', content: '看自己这段说的是客单价' });
    appendMessage(project.id, 'industry', { role: 'user', content: '看行业这段说的是政策' });

    replies.push({ text: '回答' });
    await chatInStage('u1', project, 'self', '接着说客单价');

    const text = JSON.stringify(sent[0].messages);
    expect(text).toContain('看自己这段说的是客单价');
    expect(text).toContain('接着说客单价');
    expect(text).not.toContain('看行业这段说的是政策');
  });

  it('模型空返回时抛错，且不把用户那句话留在对话里', async () => {
    replies.push({ text: '', finish: 'length' });
    await expect(chatInStage('u1', project, 'self', '这个结论依据够吗')).rejects.toThrow(
      /没有返回内容/
    );
    expect(listMessages(project.id, 'self')).toEqual([]);
  });

  it('方向卡的文字版要带序号，否则「第 2 个方向」没有指代对象', () => {
    const text = directionsToText({
      directions: [
        { title: '效率专家', tagline: '让每个车位多赚一次', markdown: '**🔧 核心解决方案**\n| a |' },
        { title: '资产运营', tagline: '把车场当资产经营', markdown: '**🔧 核心解决方案**\n| b |' },
      ],
    });
    expect(text).toContain('方向 2：资产运营');
    // 三件套整段要在进 prompt 的那段文字里：只带标题的话「第 2 个方向的第 3 条动作
    // 换掉」这种话模型看不到那张表，只能顺着话自己编一条，读起来完全正常。
    expect(text).toContain('| b |');
  });

  // 定稿气泡摊的那一节按标题关键词认。取错一节不会报错：气泡里挂着一张表，
  // 标题、格式、数字全在，只是它是隔壁那一节的 —— 顾问照着它去讲。
  it('定稿气泡只摊本步那一节，摊到下一个小节就停', () => {
    const body = [
      '## 0. 方法论速览',
      '照操法五维推的。',
      '## 1. 企业现状卡（表格：维度 | 事实 | 判读）',
      '| 维度 | 事实 |',
      '| --- | --- |',
      '| 现金跑道 | 半年 |',
      '## 2. 核心基因与优势清单',
      '这一节不该出现在气泡里',
    ].join('\n');
    const text = entryToText({
      stage_key: 'self',
      conclusion: '一句话总结',
      body,
      confidence: 'mid',
      source_level: 'L2',
      version: 1,
    });
    expect(text).toContain('| 现金跑道 | 半年 |');
    expect(text).not.toContain('这一节不该出现在气泡里');
    expect(text).not.toContain('方法论速览');
  });

  it('正文里没有那一节时要说出来，不能静默省掉', () => {
    const text = entryToText({
      stage_key: 'self',
      conclusion: '一句话总结',
      body: '## 1. 现状概述\n模型没按清单命名这一节',
      confidence: 'mid',
      source_level: 'L2',
      version: 1,
    });
    // 省掉的话气泡读起来是「这一版没有这张表」，而真实原因是那一节名字对不上
    expect(text).toMatch(/企业现状卡.*没找到/s);
  });
});
