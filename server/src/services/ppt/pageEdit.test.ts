import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  injectEids, applyTextEdit, applyStyleEdit, applyRegionStyle, applyDelete, eidsIn,
  COLOR_PALETTE, PageEditError,
} from './pageEdit.js';
import { libraryRoot } from './layoutLibrary.js';

// 就地改文字这条路上，出错时画面读起来完全正常的有三种：改到隔壁那一块上、他打的 `<`
// 把半个块吃掉、拿着旧画面覆盖掉别处刚改的那句。手测三种都看不出来。

const PAGE = `<section class="slide">
  <div class="slide-header"><div class="kicker">第一部分</div></div>
  <div class="slide-inner">
    <div class="l17-head">CONTENTS<span class="accent">目录</span></div>
    <img src="/ppt-cases/ph-16x9.svg" data-img-prompt="山野远眺 > 有景深" alt="">
    <div class="desc">一句话说清这一章的落点</div>
  </div>
</section>`;

describe('ppt pageEdit', () => {
  it('只给「只装着一段文字」的元素编号，混排的外层和 img 都不给', () => {
    const withEids = injectEids(PAGE);
    // `.l17-head` 里还有个 span：按文本节点改它会把 span 连着样式一起吃掉，而页面照样渲染。
    // 所以外层不给 eid（前端于是不让双击，并说这一块要走重新生成），里面那个 span 给。
    expect(withEids).toContain('<div class="l17-head">CONTENTS<span class="accent" data-eid=');
    // `data-img-prompt` 里带着 `>`，扫描要是把它当成标签结束，后面所有编号都会错位。
    expect(withEids).not.toMatch(/<img[^>]*data-eid=/);
    expect(withEids).toMatch(/<div class="desc" data-eid="t\d+">/);
    // 幂等：重编一遍号的话，前端手上那份预览里的 t3 和库里的 t3 会指向两个不同的元素。
    expect(injectEids(withEids)).toBe(withEids);
  });

  it('他打的 < 和 & 一律转义进 html', () => {
    const html = injectEids(PAGE);
    const eid = html.match(/<div class="desc" data-eid="(t\d+)"/)![1];
    const r = applyTextEdit(html, {
      eid,
      oldText: '一句话说清这一章的落点',
      newText: '成本 < 3 元 & 交付 > 2 天',
    });
    // 不转义的话从那个 `<` 到块尾会被浏览器当成标签吃掉 —— 页面照样渲染、接口 200，
    // 只是那一块少了半句话。
    expect(r.html).toContain('成本 &lt; 3 元 &amp; 交付 &gt; 2 天');
    expect(r.html).not.toContain('< 3 元');
    // 别的块一个字都没动
    expect(r.html).toContain('第一部分');
  });

  it('改前那句和库里现在那句对不上就拒，不覆盖', () => {
    const html = injectEids(PAGE);
    const eid = html.match(/<div class="desc" data-eid="(t\d+)"/)![1];
    // 他手上这份画面是旧的（这一页在别处改过）。覆盖上去的话那边的改动被悄悄擦掉，
    // 而两边都只看到一句「已保存」。报错里要带上「现在库里是哪句」。
    expect(() =>
      applyTextEdit(html, { eid, oldText: '我以为的那句', newText: '新的一句' })
    ).toThrow(PageEditError);
    expect(() =>
      applyTextEdit(html, { eid, oldText: '我以为的那句', newText: '新的一句' })
    ).toThrow(/一句话说清这一章的落点/);
    // 这一页重新生成过（eid 全换了一批）：按序号猜的话会改到别的一块上。
    expect(() =>
      applyTextEdit(html, { eid: 't999', oldText: '一句话说清这一章的落点', newText: 'x' })
    ).toThrow(/找不到 t999/);
  });

  it('调色板里的每个变量都在 template.html 的 :root 里真有定义', () => {
    // 编一个变量名出来不会报错：浏览器把**整条 `color:` 声明**丢掉，字色掉回继承色 ——
    // 他点了那个色块，画面上那一块颜色没变（或变成了父级的颜色），接口回的是 200。
    const root = readFileSync(join(libraryRoot(), 'template.html'), 'utf-8');
    const defined = new Set([...root.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
    const missing = COLOR_PALETTE.filter((c) => {
      const m = c.match(/var\(\s*(--[a-z0-9-]+)/);
      return m && !defined.has(m[1]);
    });
    expect(missing).toEqual([]);
  });

  it('这一块本来就有 inline style 时只覆盖改的那一个，别的留着', () => {
    const html = injectEids(`<section class="slide"><div class="desc" style="color:var(--c-ink);letter-spacing:.1em">落点</div></section>`);
    const eid = html.match(/data-eid="(t\d+)"/)![1];
    const r = applyStyleEdit(html, { eid, style: { color: 'var(--c-brand)', fontSize: 40 } });
    expect(r.html).toContain('letter-spacing:.1em');
    expect(r.html).toContain('color:var(--c-brand)');
    expect(r.html).toContain('font-size:40px');
    // 追加第二个 `style=` 的话浏览器只认第一个 —— 他点了按钮画面一点不变，而库里写着新值。
    expect(r.html.match(/style=/g)!.length).toBe(1);
    expect(r.html).toContain('落点');
  });

  it('硬编码色值和认不出的属性一律拒，不静默忽略', () => {
    const html = injectEids(`<section class="slide"><div class="desc">落点</div></section>`);
    const eid = html.match(/data-eid="(t\d+)"/)![1];
    // 收下的话换肤那天这一块不跟着变，而它读起来完全正常。
    expect(() => applyStyleEdit(html, { eid, style: { color: '#e94b35' } })).toThrow(PageEditError);
    // 静默忽略的话他点了按钮画面一点不变，看起来像按钮坏了，而接口回 200。
    expect(() => applyStyleEdit(html, { eid, style: { background: 'var(--c-brand)' } })).toThrow(/不支持改 background/);
  });

  it('整块对齐写在他选中那一块自己的开标签上，里面的标签一个都不动', () => {
    // 写到里面那一层（或隔壁那一块）上去的话，页面照样渲染 —— 只是他点的那一块没动、
    // 另一块动了，而接口回 200 加一句「已存」。
    const html = injectEids(PAGE);
    const r = applyRegionStyle(html, { path: [1], style: { alignItems: 'center' } });
    expect(r.region).toBe('div');
    expect(r.html).toContain('<div class="slide-inner" style="align-items:center">');
    // 里面那几层原样（`<img … >` 的属性、混排那一块都不许被顺手重写）。
    expect(r.html).toContain('data-img-prompt="山野远眺 > 有景深"');
    expect(r.html.match(/align-items/g)!.length).toBe(1);
    // flex/grid 不认的值静默写进去 = 浏览器丢掉整条声明，画面一动不动而库里写着新值。
    expect(() => applyRegionStyle(html, { path: [1], style: { alignItems: 'left' } })).toThrow(PageEditError);
  });

  it('取消对齐是删掉那一条 inline 声明，本来就没有时要拒', () => {
    const html = injectEids(`<section class="slide"><div class="col" style="display:flex;align-items:center">落点</div></section>`);
    const off = applyRegionStyle(html, { path: [0], style: { alignItems: null } });
    // 写 `align-items:unset` 的话是**盖住**版式那条、按成拉满 —— 他点的是「取消」，
    // 看到的是第三种样子。所以这里必须是「这一条没了」，而别的声明留着。
    expect(off.html).not.toContain('align-items');
    expect(off.html).toContain('style="display:flex"');
    expect(off.prev['align-items']).toBe('center');
    // 删一个不存在的：html 一个字不变而接口回 200 加一句「已存」—— 他看到的是「点了取消没反应」。
    expect(() => applyRegionStyle(off.html, { path: [0], style: { alignItems: null } })).toThrow(/没有 align-items/);
    // 那几个 CSS 关键字要指到 null 上，不能照着写进 inline。
    expect(() => applyRegionStyle(html, { path: [0], style: { alignItems: 'unset' } })).toThrow(/null/);
  });

  it('删掉一块之后剩下的 eid 一个都不变，隔壁那一块一个字没动', () => {
    // 重编一遍号的话，他手上那份预览里的 t3 和库里的 t3 会指向两个不同的元素 —— 下一次双击
    // 改字落到隔壁那一块上，而两块都是正常的文字，界面上一处都不说。
    const html = injectEids(PAGE);
    const before = eidsIn(html);
    const r = applyDelete(html, { path: [1, 2] });
    expect(r.html).not.toContain('一句话说清这一章的落点');
    expect(eidsIn(r.html)).toEqual(before.slice(0, -1));
    // 只剪那一块：多吃一个字符就是「隔壁那一块少了半句话」，而页面照样渲染。
    expect(r.html).toContain('<div class="slide-header">');
    expect(r.html).toContain('CONTENTS');
    expect(r.html).toContain('data-img-prompt="山野远眺 > 有景深"');
    expect(r.removed.text).toContain('一句话说清这一章的落点');
  });

  it('含图的那一块删不了（删了下一次配图会把第 2 张贴进第 1 格）', () => {
    // 图的序号是按 html 里的出现顺序算的（`findImageSlots`），删掉一个图位之后 images_json /
    // 备好的图 / pasteIntoBuiltPage 全错一位：图文不符，而页面渲染完全正常、接口 200，
    // 界面上只有一句「已删掉」。
    const html = injectEids(PAGE);
    expect(() => applyDelete(html, { path: [1] })).toThrow(/有图/);
    expect(() => applyDelete(html, { path: [1, 1] })).toThrow(PageEditError);
  });

  it('删完变成空页 / 一段可编辑文字都不剩的，一律拒', () => {
    // 空 <section> 在 iframe 里是一块白，和「这个版式渲染塌了」分不开。
    const only = injectEids(`<section class="slide"><div class="desc">落点</div></section>`);
    expect(() => applyDelete(only, { path: [0] })).toThrow(/什么都不剩/);
    // 剩一张图、一个 eid 都没有：界面的 canEditText 会谎报「这一页还没有编辑标记，重新生成
    // 一次才能改文字」，他会为此花掉一次真实调用，而成因是他自己删了最后那段字。
    const withImg = injectEids(
      `<section class="slide"><img src="/ppt-cases/ph-16x9.svg" data-img-prompt="山野" alt=""><div class="desc">落点</div></section>`
    );
    expect(() => applyDelete(withImg, { path: [1] })).toThrow(/最后一段/);
    // 整页（空路径）也不给删。
    expect(() => applyDelete(only, { path: [] })).toThrow(/整页/);
  });
});
