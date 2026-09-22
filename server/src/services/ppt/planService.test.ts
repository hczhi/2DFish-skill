import { describe, it, expect, vi, beforeEach } from 'vitest';

// 这一步的每种失败都是「一份看起来完整的规划」：编出来的版式名（L99 读起来和 L2 一样真）、
// 被截断只规划了一半、连续五页同一个版式。全都不报错，手测时和挑得准的那一版分不开 ——
// 所以必须有测试。happy path 不测（挑得准不准是他自己看 demo 判断的）。

const gateway = vi.fn();
vi.mock('../../core/llm/parseJson.js', async () => {
  const actual = await vi.importActual<any>('../../core/llm/parseJson.js');
  return { ...actual, jsonGateway: (...args: any[]) => gateway(...args) };
});

const { initDatabase } = await import('../../db/index.js');
initDatabase();

const { planDeck, PlanError } = await import('./planService.js');
const { setLayoutEnabled } = await import('./layoutState.js');

function reply(rows: any[], extra: Record<string, any> = {}) {
  return { parsed: rows, raw: JSON.stringify(rows), finish: 'stop', ...extra };
}
const page = (layoutId: string, title = '标题') => ({ layoutId, title, why: '理由', points: ['a'], images: 0 });

beforeEach(() => gateway.mockReset());

describe('排版规划', () => {
  it('模型编出来的版式名不进结果，而且要点名说出它给了什么', async () => {
    gateway.mockResolvedValue(reply([page('L1'), page('L99', '落地路径'), page('L4')]));
    const r = await planDeck('提纲', 'u1');
    // 绝不静默替换成某一条：替成 L1 之后这一页排出来也好看，只是不是模型挑的那个，
    // 而用户以为是。
    expect(r.pages.map((p) => p.layoutId)).toEqual(['L1', 'L4']);
    expect(r.problems.join('\n')).toContain('L99');
    expect(r.problems.join('\n')).toContain('落地路径');
    // 页码由代码按留下来的页重排 —— 沿用模型的下标会出现「第 1、3 页」这种跳号
    expect(r.pages.map((p) => p.page)).toEqual([1, 2]);
  });

  it('备选版式编出来的丢掉、和主版式重复的丢掉，丢了要说', async () => {
    // 留着编出来的那个：他在下拉里挑中之后是一句 400，读起来像「这个版式坏了」。
    // 静默丢掉：那一页下拉最前面只剩一条，读起来像「模型认为只有这个版式合适」，
    // 于是他照规划那条生成 —— 而备选整个功能就是给他换的。
    gateway.mockResolvedValue(reply([{ ...page('L1'), alts: ['L5', 'hero-split', 'L1', 'L7'] }]));
    const r = await planDeck('提纲', 'u1');
    expect(r.pages[0].alts).toEqual(['L5', 'L7']);
    expect(r.problems.join('\n')).toContain('hero-split');
  });

  it('连续 3 页同版式要喊出来（翻起来单调，但每一页单看都合理）', async () => {
    gateway.mockResolvedValue(reply([page('L1'), page('L5'), page('L5'), page('L5'), page('L7')]));
    const r = await planDeck('提纲', 'u1');
    expect(r.pages).toHaveLength(5);
    expect(r.problems.join('\n')).toMatch(/第 2–4 页连续 3 页都是 L5/);
  });

  it('同一模块里同类型的页用了两条版式要点名，而同模块连着几页同一条不许再喊单调', async () => {
    // 两头都静默：不点名的话这几页每一页单看都对（编号在库里、页型也对得上），翻起来才发现
    // 三页案例长三个样；反过来「同模块统一成一条」是刚定下的规范，还照旧报「连续 3 页单调」
    // 的话，做对了的事每次换来一句红字，真正该看的那几句被一起划过去。
    const inSec = (layoutId: string, title: string) => ({
      ...page(layoutId, title), kind: '内容', section: '第二部分 · 落地',
    });
    gateway.mockResolvedValue(
      reply([
        { ...page('L2', '封面'), kind: '封面' },
        inSec('L5', '规模'), inSec('L5', '增速'), inSec('L5', '复用率'), inSec('L21', '回滚次数'),
      ])
    );
    const r = await planDeck('提纲', 'u1');
    const said = r.problems.join('\n');
    expect(said).toContain('第 2、3、4、5 页');
    expect(said).toContain('L5 / L21'); // 两条编号都要点出来
    expect(said).toContain('都改成 L5'); // 建议统一成用得最多的那条
    expect(said).not.toMatch(/连续 3 页/);
  });

  it('页型和版式归属对不上要点名（每一页单看都合法，整份少了封面和过渡）', async () => {
    // 这是 `layoutId` 校验放行的那一类错：编号确实在库里，于是界面上是一份挑得「都对」的
    // 规划 —— 而封面那一页排出来是四栏矩阵、章节扉页排出来是一页数据网格，翻起来只是
    // 「这份稿子没什么节奏」。第 4 页那个「过渡页」不在词表里：**不猜**成章节（猜错就会
    // 报一条假警告），只汇总进「没标页型」那一句。
    gateway.mockResolvedValue(
      reply([
        { ...page('L16', '年度汇报'), kind: '封面' },
        { ...page('L5', '三阶段路径'), kind: '章节' },
        { ...page('L21'), kind: '内容' },
        { ...page('L1'), kind: '过渡页' },
      ])
    );
    const said = (await planDeck('提纲', 'u1')).problems.join('\n');
    expect(said).toMatch(/第 1 页「年度汇报」标的是封面页，但 L16 的归属是「内容」/);
    expect(said).toContain('封面可用的是 L2 / L13 / L20');
    expect(said).toMatch(/第 2 页「三阶段路径」标的是章节页，但 L5 的归属是「内容」/);
    expect(said).toMatch(/有 1 页没标页型/);
    expect(said).not.toMatch(/第 4 页/);
  });

  it('截断时救回断点前那几页，并说明只规划到第几页', async () => {
    const rows = [page('L1'), page('L5')];
    const half = JSON.stringify(rows).replace(/\]$/, ',{"layoutId":"L7","tit');
    gateway.mockResolvedValue({ parsed: null, raw: half, finish: 'length', reasoningTokens: 3200 });
    const r = await planDeck('提纲', 'u1');
    expect(r.pages).toHaveLength(2);
    // 不说的话界面上是一份「完整」的两页规划，而他的提纲有二十页
    expect(r.problems[0]).toContain('只规划到第 2 页');
    expect(r.problems[0]).toContain('3200');
  });

  it('图的规格照库里的枚举归一，张数按规格条数算，改动过的都要说出来', async () => {
    // 静默归一的话：本来要信息图的那一格拿到概念插画、竖图位拿到横图被裁掉两边，
    // 每张单看都不错、一处不报错；张数另算的话面板上写着「要 2 张」而下面列了 3 条。
    gateway.mockResolvedValue(
      reply([
        {
          ...page('L1'),
          images: [
            { subject: '等距的城市算力机房', mode: 'infographic', ratio: '16:9' },
            { subject: '一位工程师侧影', mode: 'case', ratio: '9:16' },
            { subject: '', mode: 'data', ratio: '1:1' },
          ],
        },
      ])
    );
    const r = await planDeck('提纲', 'u1');
    expect(r.pages[0].imageSpecs).toEqual([
      { subject: '等距的城市算力机房', mode: 'concept', ratio: '16:9' },
      { subject: '一位工程师侧影', mode: 'case', ratio: '16:9' },
    ]);
    expect(r.pages[0].images).toBe(2);
    const said = r.problems.join('\n');
    expect(said).toContain('infographic');
    expect(said).toContain('9:16');
    expect(said).toMatch(/没写画什么/);
  });

  it('模型只给了图片张数、没说画什么时要出声（这一页没法提前备图）', async () => {
    // 不说的话「先备图再生成页面」那条路对这一页无声地失效，界面上只是又变回了
    // 「先出 HTML，图位全是占位图」，看起来像备图功能坏了。
    gateway.mockResolvedValue(reply([{ ...page('L1'), images: 2 }]));
    const r = await planDeck('提纲', 'u1');
    expect(r.pages[0].images).toBe(2);
    expect(r.pages[0].imageSpecs).toEqual([]);
    expect(r.problems.join('\n')).toMatch(/没说画什么/);
  });

  it('停用的版式不进给模型的那份清单，模型硬给了也要点名说这一页用的是停用的', async () => {
    // 两种静默：清单里还留着它 = 他在案例库里关掉的那一条照旧一份份出现，开关看起来没用；
    // 模型硬给了却不出声 = 那一页照它排出来（`layoutById` 认得它，见 layoutState 文件头
    // 第 ① 条），读起来就是一页正常的幻灯片，而他以为再也不会看到这个版式了。
    setLayoutEnabled('L5', false);
    try {
      gateway.mockResolvedValue(reply([{ ...page('L1'), alts: ['L5', 'L7'] }, page('L5', '三组数据')]));
      const r = await planDeck('提纲', 'u1');
      const prompt = gateway.mock.calls[0][0]().messages[0].content as string;
      expect(prompt).not.toMatch(/(?<![\w-])L5(?![\w-])/);
      const said = r.problems.join('\n');
      expect(said).toMatch(/第 2 页「三组数据」用的 L5 是\*\*已停用\*\*的版式/);
      // 备选里那条停用的静默摘掉（下拉里挑中它是他自己在案例库关的，不算「丢了东西」）
      expect(r.pages[0].alts).toEqual(['L7']);
    } finally {
      setLayoutEnabled('L5', true);
    }
  });

  it('没被任何一页认领的段落并进相邻页，并在那一页上说出来', async () => {
    // 「提纲上的重要内容在成稿里丢了」唯一会发生的地方：页数对得上、每一页单看都合理，
    // 而那几行数据整段没有任何一页认领 —— 界面上和「这几段本来就该合并掉」一模一样。
    // 所以不是提示，是**并进去**（接在前面那一页的原文末尾，保持阅读顺序）。
    const outline = ['封面：年度合作方案', '', '1.1 市场规模', '全国 3.2 万亿，华东占 38%', '同比 +12%', '', '1.2 结论', '优先打华东'].join('\n');
    gateway.mockResolvedValue(reply([{ ...page('L2'), lines: [1, 2] }, { ...page('L7'), lines: [7, 8] }]));
    const r = await planDeck(outline, 'u1');
    expect(r.pages[0].outlineText).toContain('全国 3.2 万亿');
    expect(r.pages[0].outlineRange).toEqual([1, 5]);
    // 并到哪一页不一定对（这几行更该跟着 1.2 走），所以那一页上必须有话
    expect(r.pages[0].coverNote).toContain('第 3–5 行');
    expect(r.pages[1].coverNote).toBeUndefined();
    // 并进去之后 deck 级那条「没被认领」就不该再出现（它是最后一道网，不是常态）
    expect(r.problems.join('\n')).not.toMatch(/没有被任何一页认领/);
  });

  it('这一页的原文按行号在代码里切，不用模型回传的文本', async () => {
    // 让模型自己抄原文的话，抄的过程就是又一次压缩（六行合成两行、数字被改），
    // 而那一段读起来完全通顺 —— 页面上一处都不报错。
    const outline = ['第一行', '第二行 3.2 万亿', '第三行'].join('\n');
    gateway.mockResolvedValue(reply([{ ...page('L2'), lines: [1, 3], source: '第一行到第三行的概括' }]));
    const r = await planDeck(outline, 'u1');
    expect(r.pages[0].outlineText).toBe(outline);
    expect(r.pages[0].outlineRange).toEqual([1, 3]);
  });

  it('行号给不出来时按成因分组汇总，不逐页刷一条', async () => {
    // 三种成因解法完全不同（改 prompt / 提纲行数对不上 / 模型换了格式），合成一句
    // 「行号有问题」等于指错方向；而逐页刷的话 30 条一样的警告会把「漏了哪几段」冲下去。
    const outline = ['一', '二', '三'].join('\n');
    gateway.mockResolvedValue(reply([{ ...page('L2'), lines: [1, 2] }, page('L7'), { ...page('L4'), lines: [2, 99] }]));
    const said = (await planDeck(outline, 'u1')).problems.join('\n');
    expect(said).toContain('第 2 页 压根没给 `lines`');
    expect(said).toContain('第 3 页 行号 2–99 越界（提纲只有 3 行）');
  });

  it('拿不到 JSON 抛错而不是回空规划', async () => {
    gateway.mockResolvedValue({ parsed: null, raw: '好的，我来帮你规划一下', finish: 'stop' });
    // 回 {pages:[]} 的话界面上是「这份提纲拆不出页」，而真实成因是模型没按 JSON 回
    await expect(planDeck('提纲', 'u1')).rejects.toThrow(PlanError);
  });

  it('全部页都用了库里没有的版式时抛错，不回一份 0 页的规划', async () => {
    gateway.mockResolvedValue(reply([page('L88'), page('hero-split')]));
    await expect(planDeck('提纲', 'u1')).rejects.toThrow(/案例库里没有的版式/);
  });
});
