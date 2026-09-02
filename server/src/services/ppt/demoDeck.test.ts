import { describe, it, expect } from 'vitest';
import { demoDeck, demoFragments, DemoNotFoundError } from './demoDeck.js';
import { loadLibrary } from './layoutLibrary.js';
import { templateClasses } from './deckShell.js';

// 这条链路的每种失败都在页面上读成「这个版式本身不行」：
// 少一段片段 → 卡片上挂着「效果 demo」而 iframe 里是一句报错；类名写错一个 → 那一块回到
// 默认流式布局，看起来是版式塌了；占位符没填 → 页脚上是一行 {{BRAND_CN}}。
// 手测 22 张卡片时这些和「设计就是这样」分不开，所以必须有测试。

describe('版式 demo deck', () => {
  it('每个版式都有一段 demo（一一对应，不多不少）', () => {
    const ids = [...demoFragments().keys()];
    const layoutIds = loadLibrary().layouts.map((l) => l.id);
    // 版式库对**每条**都给 demoUrl（demo 是我们自己跑出来的，不是外部素材），
    // 所以少一段 = 那张卡片上的绿标在说谎。
    expect(ids).toEqual(layoutIds);
  });

  it('片段里用到的每个类名都在 template.html 里有定义', () => {
    // 用 deckShell 那份**严格**的类名集合（只扫 <style> 里的选择器），和生成产出的校验
    // 是同一把尺子。原来这里写的是 `template.includes('.'+tok)` —— 那是个筛子：
    // `.tr` 会因为 `.tri-col` 里含这两个字符而通过，于是它守不住任何东西。
    const known = templateClasses();
    const missing: string[] = [];
    for (const [id, body] of demoFragments()) {
      for (const m of body.matchAll(/class="([^"]+)"/g)) {
        for (const tok of m[1].trim().split(/\s+/)) {
          if (!known.has(tok)) missing.push(`${id}:${tok}`);
        }
      }
    }
    // 类名拼错不报错，那一块只是回到默认流式布局 —— 而这份 demo 的全部作用就是
    // 「照我们的骨架跑出来长这样」，塌了的那一版看起来就是版式本身不行。
    expect(missing).toEqual([]);
  });

  it('拼出来的整份 deck 有 22 页且不留占位符', () => {
    const html = demoDeck();
    expect(html.match(/<section class="slide/g)?.length).toBe(22);
    // 占位符没填的话页脚上是一行 {{BRAND_CN}}，而 deck 其他地方全正常
    expect(html).not.toContain('{{');
    // 插入点被改掉时 replace 什么都不做，出来是一份全白但页脚/目录都正常的 deck
    expect(html).not.toContain('partN_fragment.html');
  });

  it('?only= 只出那一页，认不出的 id 抛 DemoNotFoundError 而不是回空 deck', () => {
    const one = demoDeck('l12');
    expect(one.match(/<section class="slide/g)?.length).toBe(1);
    expect(one).toContain('data-demo="L12"');
    // 空 deck 在 iframe 里是一块白 + 一个「1 / 1」的页脚，读起来像这个版式渲染塌了
    expect(() => demoDeck('L99')).toThrow(DemoNotFoundError);
  });
});
