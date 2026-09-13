import { describe, it, expect, vi, beforeEach } from 'vitest';

// 提纲整理这一步只有一种事故形态，而它百分之百伪装成成功：**整理后的提纲读起来更顺、
// 层级更整齐**，而中间某一行实质内容（一组数字、一句结论）被当成备注删掉了 ——
// 页面照旧生成得出来，他要逐字对原文才发现。所以这里断言的是：
//   ① 留下来的每一行都是**逐字**的（删的动作在代码里，模型只给行号）；
//   ② 删掉带数字的行必须逐行点名；
//   ③ 模型给的行号越界时**不许夹到边界**（夹一下就删了别的一行）。
// happy path（判得准不准）不测 —— 那是他自己看那份清单核的。

const gateway = vi.fn();
vi.mock('../../core/llm/parseJson.js', async () => {
  const actual = await vi.importActual<any>('../../core/llm/parseJson.js');
  return { ...actual, jsonGateway: (...args: any[]) => gateway(...args) };
});

const { initDatabase } = await import('../../db/index.js');
initDatabase();

const { cleanOutline, OutlineCleanError } = await import('./outlineCleanService.js');

function reply(rows: any[], extra: Record<string, any> = {}) {
  return { parsed: rows, raw: JSON.stringify(rows), finish: 'stop', ...extra };
}

const OUTLINE = [
  '一、市场概况',           // 1
  '- 全国 3.2 万亿，华东占 38%',  // 2
  '（备注：这里要补一张图）',      // 3
  '',                      // 4
  '二、落地路径',            // 5
  '- 三步走：试点、复制、规模化', // 6
].join('\n');

beforeEach(() => gateway.mockReset());

describe('提纲整理', () => {
  it('只按行号删，留下来的每一行逐字不动', async () => {
    gateway.mockResolvedValue(reply([{ line: 3, why: '他自己的待办' }, { line: 4, why: '空行' }]));
    const r = await cleanOutline(OUTLINE, 'u1');
    expect(r.cleaned).toBe('一、市场概况\n- 全国 3.2 万亿，华东占 38%\n\n二、落地路径\n- 三步走：试点、复制、规模化');
    // 空行不算删（没有内容会丢），列出来只会把真正要核的那几行冲下去
    expect(r.removed).toEqual([{ line: 3, text: '（备注：这里要补一张图）', why: '他自己的待办' }]);
    expect(r.problems).toEqual([]);
  });

  it('删掉带数字的行要逐行点名并带上原文（这一行删错了整理后照样通顺）', async () => {
    gateway.mockResolvedValue(reply([{ line: 2, why: '和主题无关' }]));
    const r = await cleanOutline(OUTLINE, 'u1');
    expect(r.cleaned).not.toContain('3.2 万亿');
    const said = r.problems.join('\n');
    expect(said).toContain('第 2 行');
    expect(said).toContain('3.2 万亿');
    expect(said).toContain('和主题无关');
  });

  it('行号越界不夹到边界，忽略并说一句（夹一下删的是别的一行）', async () => {
    gateway.mockResolvedValue(reply([{ line: 99, why: '备注' }, { line: 0, why: '备注' }]));
    const r = await cleanOutline(OUTLINE, 'u1');
    expect(r.cleaned).toBe(OUTLINE);
    expect(r.removed).toEqual([]);
    expect(r.problems.join('\n')).toMatch(/行号里有 2 个用不了/);
  });

  it('模型把整份都当成无效信息时抛错，不回一个空提纲', async () => {
    gateway.mockResolvedValue(reply([1, 2, 3, 4, 5, 6].map((line) => ({ line, why: '会议记录' }))));
    // 回 200 + 空 cleaned 的话，界面上是一个空提纲框加一句「整理好了」，
    // 而他刚粘进去的几千字看起来是自己弄丢的。
    await expect(cleanOutline(OUTLINE, 'u1')).rejects.toThrow(OutlineCleanError);
  });

  it('被截断时照旧用救回来的那几条，但要说后半截没看过', async () => {
    const rows = [{ line: 3, why: '待办' }];
    gateway.mockResolvedValue({ parsed: null, raw: `${JSON.stringify(rows).slice(0, -1)}`, finish: 'length', reasoningTokens: 900 });
    const r = await cleanOutline(OUTLINE, 'u1');
    expect(r.removed.map((x) => x.line)).toEqual([3]);
    expect(r.problems.join('\n')).toMatch(/截断/);
    expect(r.problems.join('\n')).toContain('900');
  });
});
