import { describe, it, expect } from 'vitest';
import { injectEids, maskRegion, unmaskRegion, findRegionByPath, PageEditError } from './pageEdit.js';
import { validateEditedRegion } from './aiEditService.js';

// AI 编辑这条路上，失败全长成「一页读起来完全正常的幻灯片」：模型顺手把「及」改成「和」、
// 少还原一句话、把 data-eid 抹掉、编一个类名。手测这四种都看不出来。

const PAGE = injectEids(`<section class="slide">
  <div class="slide-inner">
    <div class="l02-head"><div class="kicker">第一部分</div><h2 class="l02-title">全域增长的三个支点</h2></div>
    <div class="l02-body">
      <div class="l02-item"><div class="num">01</div><div class="desc">先把渠道打通，再谈投放效率</div></div>
      <img src="/ppt-cases/ph-16x9.svg" data-img-prompt="山野远眺，有景深" alt="">
    </div>
  </div>
</section>`);

function ctxOf(regionHtml: string, name: string) {
  const { tokens } = maskRegion(regionHtml);
  return {
    tokens,
    regionName: name,
    original: regionHtml,
    allowedClasses: new Set(['slide', 'slide-inner', 'l02-head', 'kicker', 'l02-title', 'l02-body', 'l02-item', 'num', 'desc', 'col']),
    knownVars: new Set(['--c-brand', '--c-ink']),
  };
}

describe('ppt AI 编辑', () => {
  it('打码之后一个中文都不剩，还原回来一字不差', () => {
    // 这是「AI 编辑不许改文案」的全部底气：发出去那段里没有中文，所以「输出里有中文」
    // 就等于「模型在自己写文案」。漏一处（比如混排块里那半句、data-img-prompt 里那句）
    // 的话它就会去润色那一处，而出来是一页完全正常的幻灯片。
    const { masked, tokens } = maskRegion(PAGE);
    expect(masked).not.toMatch(/[⺀-鿿]/);
    expect(unmaskRegion(masked, tokens)).toBe(PAGE);
    // 图整个标签打码：地址和画图提示因此不经过模型（硬规则 3）。
    expect(masked).not.toContain('/ppt-cases/ph-16x9.svg');
    // 编辑标记要留在结构里给模型看（它得把这些原样带回来）。
    expect(masked).toContain('data-eid=');
  });

  it('少还原一句原文 / 自己写中文，一律整段丢掉', () => {
    const region = findRegionByPath(PAGE, [0, 1]);
    const ctx = ctxOf(region.html, region.name);
    const masked = maskRegion(region.html).masked;
    // 少一个记号 = 那句文案凭空消失，而页面照样渲染、只是短了一截。
    const dropped = masked.replace(/@@T2@@/, '');
    expect(() => validateEditedRegion(dropped, ctx)).toThrow(/文案/);
    // 自己写一句中文 = 它在编文案（读起来完全正常，所以只能靠这条拦）。
    const invented = masked.replace('@@T2@@', '@@T2@@<div class="desc">再谈投放效率</div>');
    expect(() => validateEditedRegion(invented, ctx)).toThrow(PageEditError);
  });

  it('抹掉 data-eid / 写死颜色 / 编类名，一律整段丢掉', () => {
    const region = findRegionByPath(PAGE, [0, 1]);
    const ctx = ctxOf(region.html, region.name);
    const masked = maskRegion(region.html).masked;
    // data-eid 掉一个：那段文字还在、样子也对，只是从此双击改不动 —— 屏幕上一点异样都没有。
    expect(() => validateEditedRegion(masked.replace(/ data-eid="t\d+"/, ''), ctx)).toThrow(/data-eid/);
    // 写死色值：换一套配色时这一块不跟着变，而它读起来完全正常。
    expect(() => validateEditedRegion(masked.replace('<div class="l02-body"', '<div style="color:#e94b35" class="l02-body"'), ctx)).toThrow(/写死了颜色/);
    // 编出来的类名不报错，那一块只是回到默认流式布局（看起来像版式塌了）。
    expect(() => validateEditedRegion(masked.replace('class="l02-item"', 'class="l02-grid2"'), ctx)).toThrow(/类名/);
    // 原样回来是合法的（上面那几条不能把正常改动也拦掉）。
    expect(() => validateEditedRegion(masked, ctx)).not.toThrow();
  });

  it('position:fixed 这条路上也拦（原来只有自由改造那条拦着）', () => {
    // 微调这条路的 prompt 正让模型「要新样式就写 inline style」，所以它写出 fixed 的概率更高，
    // 而这条校验原来只在自由改造那份里 —— 走这条路写进去之后，预览里那一块位置只是差一点，
    // **导出成文件之后飞到画面外**（它脱出 1920×1080 那层缩放），而接口 200、摘要写着
    // 「拉开了间距」、库里也存了。两条路共用 `regionGuards` 才不会只修一边。
    const region = findRegionByPath(PAGE, [0, 1]);
    const ctx = ctxOf(region.html, region.name);
    const masked = maskRegion(region.html).masked;
    expect(() => validateEditedRegion(masked.replace('<div class="l02-body"', '<div style="position:fixed;top:40px" class="l02-body"'), ctx))
      .toThrow(/position:fixed/);
  });

  it('按路径定位选中那一块，路径对不上就拒', () => {
    // 按 eid 求公共祖先的话，他框住的是整块、算出来的是里面那一层（图和装饰条没有 eid）——
    // 于是 AI 改的不是他框的那一块，而摘要和画面都读得通。
    const region = findRegionByPath(PAGE, [0, 1]);
    expect(region.name).toBe('div');
    expect(region.html).toContain('l02-body');
    expect(region.html).not.toContain('l02-title');
    expect(() => findRegionByPath(PAGE, [0, 9])).toThrow(PageEditError);
  });
});
