import { describe, it, expect, vi, beforeEach } from 'vitest';

// 这一步的每种失败都是「一份看起来完整的规划」：编出来的版式名（L23 读起来和 L2 一样真）、
// 被截断只规划了一半、连续五页同一个版式。全都不报错，手测时和挑得准的那一版分不开 ——
// 所以必须有测试。happy path 不测（挑得准不准是他自己看 demo 判断的）。

const gateway = vi.fn();
vi.mock('../../core/llm/parseJson.js', async () => {
  const actual = await vi.importActual<any>('../../core/llm/parseJson.js');
  return { ...actual, jsonGateway: (...args: any[]) => gateway(...args) };
});

const { planDeck, PlanError } = await import('./planService.js');

function reply(rows: any[], extra: Record<string, any> = {}) {
  return { parsed: rows, raw: JSON.stringify(rows), finish: 'stop', ...extra };
}
const page = (layoutId: string, title = '标题') => ({ layoutId, title, why: '理由', points: ['a'], images: 0 });

beforeEach(() => gateway.mockReset());

describe('排版规划', () => {
  it('模型编出来的版式名不进结果，而且要点名说出它给了什么', async () => {
    gateway.mockResolvedValue(reply([page('L1'), page('L23', '落地路径'), page('L4')]));
    const r = await planDeck('提纲', 'u1');
    // 绝不静默替换成某一条：替成 L1 之后这一页排出来也好看，只是不是模型挑的那个，
    // 而用户以为是。
    expect(r.pages.map((p) => p.layoutId)).toEqual(['L1', 'L4']);
    expect(r.problems.join('\n')).toContain('L23');
    expect(r.problems.join('\n')).toContain('落地路径');
    // 页码由代码按留下来的页重排 —— 沿用模型的下标会出现「第 1、3 页」这种跳号
    expect(r.pages.map((p) => p.page)).toEqual([1, 2]);
  });

  it('连续 3 页同版式要喊出来（翻起来单调，但每一页单看都合理）', async () => {
    gateway.mockResolvedValue(reply([page('L1'), page('L5'), page('L5'), page('L5'), page('L7')]));
    const r = await planDeck('提纲', 'u1');
    expect(r.pages).toHaveLength(5);
    expect(r.problems.join('\n')).toMatch(/第 2–4 页连续 3 页都是 L5/);
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
