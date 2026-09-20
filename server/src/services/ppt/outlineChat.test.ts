import { describe, it, expect, vi, beforeEach } from 'vitest';

// 「AI 生成提纲」这条路上会伪装成成功的两种：
// ① 提纲**只写了一半**就断了（贴出了开始标记、没有结束标记）—— 提纲天生是「写到哪算哪」的
//    东西，把后半截当提纲带回输入框的话，他看到的是一份读起来完整的提纲，规划出来的稿子也
//    完整，只是少了后面几章，一处都不报错；
// ② 它那句「好的，我按招标场合写了一份：」跟着提纲一起被带回输入框 —— 那一行会被分页那一步
//    当成第一页的要点逐字排上去（页面上多一条寒暄，读起来像是他自己写的）；
// ③ 上传的资料超了总长之后被**截掉后面几份**（或者悄悄少带一份）—— 提纲照样出得来，
//    只是它压根没看过那几份，而卡片还在界面上列着。这条路**不限单份字数**（咨询那边限
//    3500），拒错一份的代价一样：他只能进卡片自己删掉排在后面的那几节。

vi.mock('../../core/llm/gateway.js', () => ({
  aiGateway: vi.fn(),
  checkAndDeductAppQuota: vi.fn(),
  checkAndDeductQuota: vi.fn(),
  QuotaExceededError: class extends Error {},
}));
vi.mock('../../core/llm/client.js', () => ({ logAIUsage: vi.fn() }));
vi.mock('../skillRegistryService.js', () => ({ getSkillForSlot: vi.fn(() => null) }));

const { aiGateway } = await import('../../core/llm/gateway.js');
const { chatOutline, composeMaterials, OUTLINE_OPEN, OUTLINE_CLOSE } = await import('./outlineChatService.js');

const OUTLINE = '云启数科 · AI 转型方案汇报\n一、为什么现在做\n  1. 行业三个变化\n二、我们怎么做';

function reply(content: string, extra: { finish?: string; reasoning?: number } = {}) {
  (aiGateway as any).mockResolvedValue({
    response: {
      choices: [{ message: { content }, finish_reason: extra.finish || 'stop' }],
      usage: { completion_tokens_details: { reasoning_tokens: extra.reasoning ?? 0 } },
    },
    usage: { input_tokens: 800, output_tokens: 400, total_tokens: 1200 },
    duration_ms: 3000,
  });
}

const turns = [{ role: 'user' as const, content: '给客户讲我们的 AI 转型方案，30 分钟，要他们批预算。' }];

beforeEach(() => vi.clearAllMocks());

describe('AI 生成提纲', () => {
  it('提纲只写了一半（没有结束标记）时不给提纲，并说出是截断', async () => {
    reply(`好的，这是提纲：\n${OUTLINE_OPEN}\n${OUTLINE}`, { finish: 'length', reasoning: 1500 });
    const r = await chatOutline(turns, 'u1');
    expect(r.outline).toBeNull(); // 半截提纲绝不许带回输入框
    expect(r.problems.join('')).toMatch(/只写了一半/);
    expect(r.problems.join('')).toMatch(/1500 token/); // 硬规则 2：思维链花了多少必须说
  });

  it('单份不限字数，合计超了整次拒掉并点名，不悄悄少带一份', async () => {
    const files = (n: number, chars: number) =>
      Array.from({ length: n }, (_, i) => ({
        filename: `资料${i + 1}.pptx`,
        text: 'x'.repeat(chars),
        variant: 'tidy' as const,
      }));
    // 份数超了：多出来的两份不许被悄悄扔掉（扔掉之后提纲照样出得来，而卡片还列在界面上）。
    expect(() => composeMaterials(files(7, 100))).toThrow(/最多带 5 个/);
    // 一份七千字的资料**照样收**：这条路不套咨询那边的单份 3500 字上限，
    // 拒掉它之后他唯一的出路是自己进卡片删掉一半，而删掉的正是排在后面那几节。
    expect(composeMaterials(files(1, 7000))).toContain('资料1.pptx');
    // 合计超了：整次拒并点名每份多少字（五张卡片长得一模一样，只说「超长」他不知道删哪个）。
    expect(() => composeMaterials(files(5, 5000))).toThrow(/资料5\.pptx/);
  });

  it('带回去的那份提纲里不含它的寒暄和说明', async () => {
    reply(`好的，我按招标场合写了一份，其中预算那页是我替你假设的：\n${OUTLINE_OPEN}\n${OUTLINE}\n${OUTLINE_CLOSE}\n要改哪一章跟我说。`);
    const r = await chatOutline(turns, 'u1');
    expect(r.outline).toBe(OUTLINE);
    expect(r.outline).not.toMatch(/好的|我按招标场合|跟我说/);
    // 那两句话本身要留在聊天里（他要看到「哪几处是替他假设的」）
    expect(r.reply).toMatch(/替你假设/);
    expect(r.reply).not.toContain('一、为什么现在做');
  });
});
