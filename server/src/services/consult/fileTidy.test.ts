import { describe, it, expect, beforeEach, vi } from 'vitest';

// 上传资料的 AI 整理只有两种「读起来完全正常」的失败，这里就守这两种：
//
// ① 模型一个字都没返回 → 回一份空的整理结果，在界面上和「这份原文本来就没什么可删的」
//    长得一模一样，用户直接把空的插进资料，后面十二步照着空资料出结论。
// ② 「只删不编」被破掉 → 模型顺手补一个客单价/年份，它以「客户说的」身份进全部结论，
//    而它在正文里和客户亲口说的一模一样。数字比对是界面上唯一会露馅的地方。
//
// mock 必须在 import 业务代码之前（ESM 提升）。
const replies: Array<{ text: string; finish?: string; reasoning?: number }> = [];
const sentSystems: string[] = [];
vi.mock('../../core/llm/gateway.js', () => ({
  aiGateway: vi.fn(async (params: any) => {
    sentSystems.push(params.messages.find((m: any) => m.role === 'system').content);
    const r = replies.shift();
    if (!r) throw new Error('测试没有为这次 LLM 调用准备返回值');
    return {
      response: {
        choices: [{ message: { content: r.text }, finish_reason: r.finish || 'stop' }],
        usage: { completion_tokens_details: { reasoning_tokens: r.reasoning || 0 } },
      },
      usage: { output_tokens: 120 },
      duration_ms: 3500,
    };
  }),
  SAMPLING: { analytic: { temperature: 0.2 } },
  QuotaExceededError: class extends Error {},
}));

const { tidyExtractedText, planTidy } = await import('./fileTidyService.js');

describe('consult 上传资料的 AI 整理', () => {
  beforeEach(() => {
    replies.length = 0;
    sentSystems.length = 0;
  });

  it('模型空返回时抛错并说清成因，不回一份空的整理结果', async () => {
    replies.push({ text: '   ', reasoning: 9700 });
    await expect(tidyExtractedText('u1', '品牌介绍.pptx', '正骨水，广西玉林制药')).rejects.toThrow(
      // 成因要指到思维链上（硬规则 2）—— 只说「整理失败」的话他会一直重点那个按钮。
      /思维链没关掉/
    );
  });

  it('整理后多出原文里没有的数字要逐个点名（只删不编被破掉时唯一露馅的地方）', async () => {
    replies.push({
      text: '## 公司概况\n覆盖 3000 个车场，去年营收 8600 万，成立于 2015 年。\n- 1 期已完工',
    });
    const r = await tidyExtractedText('u1', 'x.docx', '覆盖 3000 个车场，成立于 2015 年。第 1 页');
    // 8600 是编出来的 → 必须报；3000 / 2015 原文有 → 不报；序号 1 太短 → 不报（满篇都是）
    expect(r.addedNumbers).toEqual(['8600']);
  });

  it('「这份文件里没有的」那一节只在一次装得下时才要，分段时每段都不许要', async () => {
    // 提炼会把没提到的类目整节删掉，所以缺料清单是用户唯一能知道「这份文件没给销量数据」
    // 的地方 —— 单段时省掉它，后面十二步会照常识把这些补齐，补出来的读起来像真资料。
    // 而分段时每段各报一次的话，那一段里没有的东西往往就在下一段里：拼出来是一份
    // 自相矛盾的缺料清单，他会照着它去跟客户要已经给过的资料，而两种都不报错。
    replies.push({ text: '## 品牌与公司\n- 玉林制药\n\n## 这份文件里没有的\n- 没有销量数据' });
    await tidyExtractedText('u1', 'x.pptx', '正骨水，广西玉林制药');
    expect(sentSystems).toHaveLength(1);
    expect(sentSystems[0]).toContain('## 这份文件里没有的');

    sentSystems.length = 0;
    const raw = `--- 第 1 页 ---\n${'甲'.repeat(9000)}\n--- 第 2 页 ---\n${'乙'.repeat(9000)}`;
    replies.push({ text: '## 品牌与公司\n- 甲' }, { text: '## 产品与服务\n- 乙' });
    await tidyExtractedText('u1', 'x.pptx', raw);
    expect(sentSystems).toHaveLength(2);
    for (const s of sentSystems) expect(s).not.toContain('## 这份文件里没有的');
    expect(sentSystems[1]).toContain('第 2 段（共 2 段）');
  });

  it('分段整理时失败的那一段退回原文并点名，不静默丢掉，也不谎报花了几次额度', async () => {
    // 静默丢掉的话「AI 整理」那一栏少了一整段，而它读起来照样是一份完整的资料；
    // 而 planTidy 报 2 次、实际扣 4 次的话，他只会以为额度算错了。
    const raw = `--- 第 1 页 ---\n${'甲'.repeat(9000)}\n--- 第 2 页 ---\n${'乙'.repeat(9000)}`;
    expect(planTidy(raw).calls).toBe(2);

    replies.push({ text: '## 第一部分\n甲甲甲' });
    replies.push({ text: '' }); // 第二段空返回
    const r = await tidyExtractedText('u1', 'x.pptx', raw);

    expect(r.calls).toBe(planTidy(raw).calls);
    expect(r.fallbackChunks).toBe(1);
    expect(r.text).toContain('## 第一部分');
    expect(r.text).toContain('乙'.repeat(9000)); // 第二段的原文一个字都不能少
    expect(r.notes.join('\n')).toMatch(/第 2\/2 段整理失败/);
  });
});
