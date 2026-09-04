import { describe, it, expect } from 'vitest';
import { styles, styleById, defaultStyleId, renderStylePrompt, deckColors, leftoverPlaceholders } from './styleLibrary.js';

// 画风这条路上的失败全是「每张图单看都不错」：解析不出来 = 换画风没有任何区别；
// 占位符没换掉 = 把「本页主题，1句」这几个字发给模型；颜色没换掉 = 图和 deck 不是一套色。
// 三样都不报错，用户只会以为这个模型画不了他要的风格。

describe('配图画风库', () => {
  it('六套画风都解析出三路模板（少一路那一套整条丢掉 = 那个 mode 静默换画法）', () => {
    const list = styles();
    expect(list.map(s => s.id)).toEqual(['S-A', 'S-B', 'S-C', 'S-D', 'S-E', 'S-F']);
    for (const s of list) {
      expect(s.name, s.id).toBeTruthy();
      expect(s.applicable, s.id).toBeTruthy();
      expect(s.templates.concept.length, s.id).toBeGreaterThan(50);
      expect(s.templates.case.length, s.id).toBeGreaterThan(50);
      expect(s.templates.data.length, s.id).toBeGreaterThan(50);
    }
    // 「（默认）」那一套要能认出来，否则下拉的缺省项是排在第一位的那条（可能不是默认）
    expect(defaultStyleId()).toBe('S-A');
    expect(styleById('s-a')?.isDefault).toBe(true);
  });

  it('渲染出来的提示词里不能剩下任何占位符，而且颜色是 deck 真在用的色值', () => {
    const style = styleById('S-C')!; // 国风水墨：和默认那套差别最大
    const prompt = renderStylePrompt(style, 'concept', {
      theme: 'AI 转型 · 三阶段路径',
      scene: '一位工程师侧影',
      ratio: '3:4 portrait',
    });
    expect(leftoverPlaceholders(prompt)).toEqual([]);
    expect(prompt).toContain('AI 转型 · 三阶段路径');
    expect(prompt).toContain('一位工程师侧影');
    expect(prompt).toContain('3:4 portrait');
    expect(prompt).toContain(deckColors().brand); // #F0861A
    // 选了水墨就得真的是水墨（回落成默认那套的话这里会是 isometric）
    expect(prompt.toLowerCase()).toContain('ink');
    // 模型很爱在图里写字，这条尾巴一律要带
    expect(prompt).toContain('No text');
  });

  it('图的颜色跟着这份稿子的配色走，不是 template 那份默认色', () => {
    // 一直用默认那份的话，蓝色系/墨绿系的稿子配出来的图全是橙的 —— 每张图单看都不错，
    // 一处都不报错，他只会以为「这个模型画不了蓝色」，或者一张张重生（每张都真花钱）。
    const s = styleById('S-A')!;
    const input = { theme: '增长', scene: '柱状图', ratio: '16:9 landscape' };
    const blue = renderStylePrompt(s, 'concept', { ...input, design: { palette: 'P-B', font: 'F-A', density: 'D-B', header: 'H-A' } });
    expect(blue).toContain('#2A5DB0');
    expect(blue).not.toContain(deckColors().brand); // 默认那套的橙不能出现
    // 不传规范 = 默认那套（老 deck），照旧是 template 里那个色
    expect(renderStylePrompt(s, 'concept', input)).toContain(deckColors().brand);
  });

  it('三路 mode 出来的提示词不一样（不然 data 页拿到的是概念插画）', () => {
    const s = styleById('S-A')!;
    const input = { theme: '增长', scene: '柱状图与上升曲线', ratio: '16:9 landscape' };
    const concept = renderStylePrompt(s, 'concept', input);
    const data = renderStylePrompt(s, 'data', input);
    expect(concept).not.toBe(data);
    expect(data.toLowerCase()).toContain('infographic');
  });
});
