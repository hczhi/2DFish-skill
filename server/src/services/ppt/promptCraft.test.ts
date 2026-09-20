import { describe, it, expect, vi, beforeEach } from 'vitest';

// 「AI 润色这一格的提示词」有三种失败会读成成功：
// ① 这一格原来有「他改写的那一整条」时，润色回来的还是那条旧的 —— 按钮转了一圈、额度扣了一次，
//    而框里一个字都没变（他只会再点几次，每次都真扣一次）；
// ② 模型一个字都没返回（思维链把 max_tokens 花光了，硬规则 2），空串被当成那一句用 ——
//    发出去的提示词里「画什么」是空的，图照样生得出来，只是和这一页无关；
// ③ 模型回的是「好的，以下是…」+ 那一句，取了第一行 —— 存进去的「画什么」是一句寒暄。

vi.mock('../../core/llm/gateway.js', () => ({
  aiGateway: vi.fn(),
  checkAndDeductAppQuota: vi.fn(),
  checkAndDeductQuota: vi.fn(),
  QuotaExceededError: class extends Error {},
}));
vi.mock('../../core/llm/client.js', () => ({ logAIUsage: vi.fn() }));
vi.mock('../../core/image/imageGateway.js', () => ({ generateImage: vi.fn() }));
vi.mock('./assetStore.js', () => ({ rememberAsset: vi.fn(() => true) }));

const { aiGateway } = await import('../../core/llm/gateway.js');
const { polishSpecPrompt, rewriteSpecPrompt, PromptCraftError } = await import('./promptCraftService.js');

const owner = { userId: 'u1', sdkPk: null, externalUid: null };
const ctx = { owner, index: 1, title: '我们的能力', styleId: 'S-A' };
const CUSTOM = '一张只有我自己知道要什么的图：正午的柳州钢厂，逆光，画面左边空着放标题。';
const GOOD = '一座被脚手架半包住的变电站，钢架上挂着水汽，强逆光从右后方来，主体压在画面右下角。';

function reply(content: string, extra: { finish?: string; reasoning?: number } = {}) {
  (aiGateway as any).mockResolvedValue({
    response: {
      choices: [{ message: { content }, finish_reason: extra.finish || 'stop' }],
      usage: { completion_tokens_details: { reasoning_tokens: extra.reasoning ?? 0 } },
    },
    usage: { input_tokens: 500, output_tokens: 60, total_tokens: 560 },
    duration_ms: 1200,
    noThinking: true,
    noThinkingRefused: false,
  });
}

beforeEach(() => vi.clearAllMocks());

describe('AI 润色「画什么」', () => {
  it('这一格原来有他改写的整条时，回去的是重新拼的那条（不是那条旧的自定义）', async () => {
    reply(GOOD);
    const r = await polishSpecPrompt(
      { subject: '算力机房', mode: 'concept', ratio: '16:9', fullPrompt: CUSTOM },
      ctx,
      'u1'
    );
    expect(r.subject).toBe(GOOD);
    expect(r.prompt).toContain(GOOD);
    expect(r.prompt).not.toBe(CUSTOM);
    expect(r.prompt).not.toContain('柳州钢厂'); // 那条旧的一个字都不许留下
    expect(r.prompt).toContain('等距'); // 重新套了画风模板
  });

  it('模型一个字都没返回时报错，并说出思维链花了多少 token（不许把空串当那一句用）', async () => {
    reply('', { reasoning: 2280 });
    await expect(
      polishSpecPrompt({ subject: '算力机房', mode: 'concept', ratio: '16:9' }, ctx, 'u1')
    ).rejects.toThrow(/一个字都没返回[\s\S]*2280 token/);
    // 不带这个数的话他只会一路调高 max_tokens，而那个数字永远调不完（硬规则 2）。
  });

  it('回了「好的，以下是…」+ 那一句时取画面那一句，并把「丢掉了另外几段」说出来', async () => {
    reply(`好的，这是润色后的提示词：\n${GOOD}`);
    const r = await polishSpecPrompt({ subject: '算力机房', mode: 'concept', ratio: '16:9' }, ctx, 'u1');
    expect(r.subject).toBe(GOOD);
    expect(r.problems.join('')).toMatch(/只采用了/);
  });
});

// 「AI 重写整条」最容易读成成功的那一种：模型把代码算的那几段（禁忌尾巴、比例）改写得更顺口
// 或者干脆删掉，回来那一整条读起来比原来专业 —— 存成这一格的自定义之后，图回来是一张带乱码
// 假字的图 / 比例不对被裁掉一半，而接口 200、框里那段通顺、缩略图也好看（每张都真花钱）。
describe('AI 重写整条', () => {
  it('代码算的尾巴和比例被改掉时接回去，并说出是哪几段（不许静默发出去）', async () => {
    reply('一座被脚手架半包住的变电站，钢架上挂着水汽，强逆光从右后方来，主体压在画面右下角，画面里配上「智算未来」几个大字。');
    const r = await rewriteSpecPrompt({ subject: '算力机房', mode: 'concept', ratio: '16:9' }, ctx, 'u1');
    expect(r.prompt).toContain('不许出现任何文字'); // 尾巴接回来了
    expect(r.prompt).toContain('16:9 横构图'); // 比例那句也接回来了
    expect(r.problems.join('')).toMatch(/少了（或被改写了）/);
    expect(r.problems.join('')).toMatch(/尾巴/);
  });

  it('背景图那一格发出去的规范只有 backdrop 那一节（三节的要求是互斥的）', async () => {
    // 三节一起发、或者按规划里那个还写着 concept 的字段挑节的话：模型自己挑一边，回来那一整条
    // 读起来更专业 —— 而背景图缩在中间围一圈白边 / 单图里一个字都没印，接口 200、缩略图也好看。
    reply('一片被薄雾压住的算力机房远景，整片压暗，体积光从右上斜切进来。');
    await rewriteSpecPrompt({ subject: '算力机房', mode: 'backdrop', ratio: '16:9' }, ctx, 'u1');
    const sent = (aiGateway as any).mock.calls[0][0].messages[0].content as string;
    expect(sent).toContain('### backdrop 重写要求');
    expect(sent).toContain('不要边框、外框、暗角');
    expect(sent).not.toContain('### poster 重写要求');
    expect(sent).not.toContain('### slot 重写要求');
  });
});
