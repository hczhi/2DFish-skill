import { describe, it, expect } from 'vitest';
import { styles, styleById, defaultStyleId, renderStylePrompt, deckColors, leftoverPlaceholders, pageTemplates } from './styleLibrary.js';

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
    // 比例那句要翻成中文（`3:4 portrait` 原样留在提示词里 = 整条里夹一句英文，见 md §2.0 第一条）
    expect(prompt).toContain('3:4 竖构图');
    expect(prompt).toContain(deckColors().brand); // #F0861A
    // 选了水墨就得真的是水墨（回落成默认那套的话这里会是等距）
    expect(prompt).toContain('水墨');
    // 模型很爱在图里写字，这条尾巴一律要带
    expect(prompt).toContain('不许出现任何文字');
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

  it('三路 mode 都把「这一格画什么」写进提示词（data 那三套原来只有页标题，图漂亮但答错题）', () => {
    // 原来 data 模板里只有 `<本页主题>` 一个占位，规划里那句「画什么」一个字都没进提示词 ——
    // 回来的是一张按页标题瞎画的通用信息图，每张单看都不错，一处不报错。
    const input = { theme: '增长', scene: '三条产线的良率对比。', ratio: '16:9 landscape' };
    for (const s of styles()) {
      for (const mode of ['concept', 'case', 'data'] as const) {
        const p = renderStylePrompt(s, mode, input);
        expect(p, `${s.id}/${mode}`).toContain('三条产线的良率对比');
        // 句尾标点要去掉：`Subject: <场景>, built from …` 是接着写的，留着句号出来是一句断掉的话
        expect(p, `${s.id}/${mode}`).not.toMatch(/[。.][,，]/);
      }
    }
  });

  it('18 套模板都有机位和光影两段（省掉就退回正面平光的均值图 = 页面太平的真正来源）', () => {
    for (const s of styles()) {
      for (const mode of ['concept', 'case', 'data'] as const) {
        expect(s.templates[mode], `${s.id}/${mode} 少了机位段`).toContain('机位：');
        expect(s.templates[mode], `${s.id}/${mode} 少了光线与质感段`).toContain('光线与质感：');
      }
    }
  });

  it('18 套模板 + 两套整页模板里不许再剩下英文句子（夹一句英文 = 那一句他核不动、模型也不当真）', () => {
    // 只挑一半翻的话症状是「不许写字/留白那一句好像没生效」，而图每张都正常、一处不报错。
    const all = [
      ...styles().flatMap((s) => (['concept', 'case', 'data'] as const).map((m) => [`${s.id}/${m}`, s.templates[m]] as const)),
      ...(['backdrop', 'poster'] as const).map((m) => [m, pageTemplates()[m]] as const),
    ];
    for (const [key, tpl] of all) {
      // 连着三个以上的英文单词才算「英文句子」（`SaaS 插画风`、`f/2`、`35mm`、占位符不算）
      const en = tpl.replace(/\{\{[A-Z_]+\}\}/g, '').match(/[A-Za-z][A-Za-z'/-]*(\s+[A-Za-z][A-Za-z'/-]*){2,}/);
      expect(en?.[0], `${key} 里还剩英文`).toBeUndefined();
    }
  });

  it('整页那两路要有「设计手法」段、而且不许把整幅调成低反差低饱和（回来的是灰蒙蒙的均值图）', () => {
    // 这两条一起丢掉的症状是「背景图/单图出来都挺正常，就是单调、没设计感、每页长得差不多」——
    // 一处都不报错，而每张都是一次真实花费。「读得清」靠的是代码算的留空区 + 0.62 压暗蒙版，
    // 不是把整幅拉灰（见 md §6）。
    for (const mode of ['backdrop', 'poster'] as const) {
      const tpl = pageTemplates()[mode];
      expect(tpl, `${mode} 少了设计手法段`).toContain('设计手法：');
      // 手法**必须是代码填的那一条**（`{{DEVICE}}`）。把手法库整段列给模型让它「挑一条」的话，
      // 它每页都挑同一条（自己最顺手的那条）—— 一份稿子翻下来每页一个路子，一处都不报错。
      expect(tpl, `${mode} 的设计手法不是代码挑的（写死或让模型自己挑 = 全份一个路子）`).toContain('{{DEVICE}}');
      expect(tpl, `${mode} 又把整幅调低了`).not.toMatch(/低反差|低饱和/);
    }
  });

  it('设计手法按页码轮着换，同一页两次一模一样（不轮 = 全份一个路子；不稳 = 预览和真发出去的不是一条）', () => {
    // 预览那条路和「换一批图」那条路拼的是同一条提示词，所以这一条一旦跟着随机数走，
    // 他在框里看到的和真发给模型的就不是同一句 —— 两边都 200，图回来只是「和预览的不一样」。
    const s = styleById('S-A')!;
    const base = { theme: '增长', scene: '', ratio: '16:9 landscape', slideText: ['我们的能力', '三条产线'], deckKey: 'deck-1' };
    const p3 = renderStylePrompt(s, 'backdrop', { ...base, pageKey: 3 });
    const p4 = renderStylePrompt(s, 'backdrop', { ...base, pageKey: 4 });
    expect(p3).not.toBe(p4);
    expect(renderStylePrompt(s, 'backdrop', { ...base, pageKey: 3 })).toBe(p3);
    // 手法里写了 {{BRAND}}，所以它必须在颜色替换**之前**填进去，否则那几个字原样发出去
    expect(leftoverPlaceholders(p3)).toEqual([]);
    expect(leftoverPlaceholders(renderStylePrompt(s, 'poster', { ...base, pageKey: 3 }))).toEqual([]);
  });

  it('三路 mode 出来的提示词不一样（不然 data 页拿到的是概念插画）', () => {
    const s = styleById('S-A')!;
    const input = { theme: '增长', scene: '柱状图与上升曲线', ratio: '16:9 landscape' };
    const concept = renderStylePrompt(s, 'concept', input);
    const data = renderStylePrompt(s, 'data', input);
    expect(concept).not.toBe(data);
    expect(data).toContain('信息图');
  });
});
