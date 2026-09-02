import { describe, it, expect } from 'vitest';
import { loadLibrary, layoutById } from './layoutLibrary.js';

// 这个解析器的每种失败都伪装成成功：漏掉几条案例、某条的 buildText 是空的、
// fullbleed 判反了 —— 三种都不报错，生成阶段照样出一份完整的 HTML，
// 只是版式是模型自己编的 / 全幅图被包进 padding 里成了一张留白图。
// 手测看不出来（页面是好看的，只是不是那个版式），所以必须有测试。

describe('版式案例库', () => {
  it('22 条案例全部解析出来，且每条都有非空的选型文本和生成文本', () => {
    const lib = loadLibrary();
    const ids = lib.layouts.map((l) => l.id);
    expect(ids).toEqual(Array.from({ length: 22 }, (_, i) => `L${i + 1}`));

    // 空文本进 prompt 等于这一条案例不存在，而它在列表里还是一行
    const empty = lib.layouts.filter((l) => !l.selectText.trim() || !l.buildText.trim());
    expect(empty.map((l) => l.id)).toEqual([]);

    // 每条都要有「适用」，选版式那一步全靠它匹配内容
    expect(lib.layouts.filter((l) => !l.applicable).map((l) => l.id)).toEqual([]);
  });

  it('全幅集合按文末那句话算，不只看条目里的「是否全幅」', () => {
    // L2/L3 那几条老条目压根没写「是否全幅」，漏了就会被包进 .slide-inner，
    // 出来是一张四边留白的「全幅」图
    expect(layoutById('L2')?.fullbleed).toBe(true);
    expect(layoutById('L3')?.fullbleed).toBe(true);
    expect(layoutById('L18')?.fullbleed).toBe(true);
    // L12 明写「否」但要 has-card（色带溢出卡片边缘）
    expect(layoutById('L12')?.fullbleed).toBe(false);
    expect(layoutById('L12')?.hasCard).toBe(true);
    expect(layoutById('L14')?.fullbleed).toBe(false);
  });

  it('详情按 L 编号找而不是按版式名，改过名的 L12 也要带上 CSS 骨架', () => {
    // 文件名还是 L12-bio-portrait-card.md，条目名已改成 circle-float-card
    const l12 = layoutById('L12')!;
    expect(l12.name).toBe('circle-float-card');
    expect(l12.hasDetail).toBe(true);
    expect(l12.buildText).toContain('bio-card');
    // L1–L10 没有详情，buildText 回落成索引条目原文（不能是空的）
    expect(layoutById('L5')?.hasDetail).toBe(false);
    expect(layoutById('L5')?.buildText).toContain('stat-grid');
  });
});
