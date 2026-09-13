import { describe, it, expect } from 'vitest';
import { addCanvasText, addCanvasImage, setCanvasBox, deleteCanvasEl, CANVAS_W } from './canvasEdit.js';
import { blankPageHtml } from './blankPage.js';
import { applyTextEdit, PageEditError } from './pageEdit.js';

// 这里测的都是「出错时画布上一切正常」的路径：编号撞车（改这一块的字落到另一块上）、
// 往普通版式页上写绝对定位（那一行别的内容跟着塌，而接口 200）、块被摆到画布外面
// （预览和导出里都不在，而接口说「已摆好」）、删一块把画布标签删坏（后面新加的块落到画布外，
// 坐标系不管它，拖一下就跳位）。

describe('ppt canvasEdit', () => {
  it('新加的块当场就带 data-eid，编号跟着整页最大号走 —— 撞号的话改这一块的字会落到另一块上', () => {
    const a = addCanvasText(blankPageHtml());
    const b = addCanvasText(a.html);

    // 空白页永远不经过 injectEids（它只在生成那一步跑），所以 eid 必须是这里写上的 ——
    // 没有的话浮动条上「双击改字 / 改字色字号」对着画布上的文字全部点了没反应。
    expect(a.eid).not.toBe(b.eid);
    expect(a.bel).not.toBe(b.bel);
    const edited = applyTextEdit(b.html, { eid: b.eid, oldText: '双击改这段字', newText: '第二块' });
    expect(edited.html).toContain('>第二块<');
    // 改的是第二块：撞号时这一句会把第一块也改掉（两块都是正常的文字，一处都不说）
    expect(edited.html.match(/双击改这段字/g)).toHaveLength(1);
  });

  it('普通版式页上摆不了 —— 放行的话那一块脱离排版、同一行别的内容跟着塌，而接口 200', () => {
    const normal = '<section class="slide"><div class="slide-inner"><h2 data-eid="t1">标题</h2></div></section>';
    expect(() => addCanvasText(normal)).toThrow(PageEditError);
    expect(() => setCanvasBox(normal, { bel: 'b1', box: { left: 0, top: 0 } })).toThrow(/不是空白页/);
  });

  it('拖出画布的坐标夹回画布里 —— 不夹的话那一块在预览和导出里都不在，而接口说「已摆好」', () => {
    const a = addCanvasText(blankPageHtml());
    const r = setCanvasBox(a.html, { bel: a.bel, box: { left: 5000, top: -80, width: 600, height: 200 } });

    expect(r.box).toEqual({ left: CANVAS_W - 600, top: 0, width: 600, height: 200 });
    // 只追加一条声明的话浏览器只认第一个 style= —— 库里是新坐标而画面一动不动
    expect(a.html.match(/style=/g)).toHaveLength(1);
    expect(r.html.match(/style=/g)).toHaveLength(1);
    expect(r.html).toContain(`left:${CANVAS_W - 600}px`);
  });

  it('画布上的图不带 data-img-prompt，落点按它自己的比例 —— 否则配图那条路会把它当成图槽盖掉', () => {
    const r = addCanvasImage(blankPageHtml(), { url: '/uploads/a.png', ratio: '3:2' });

    // 带上 data-img-prompt 的话 findImageSlots 会把他自己摆的这张数成「这一页的第 1 格」，
    // 下一次「生成图 / 换一批图」直接盖上去 —— 画面上还是一页有图的幻灯片，只是图换了。
    expect(r.html).not.toContain('data-img-prompt');
    expect(r.html).toContain('src="/uploads/a.png"');
    // 比例不对不会报错，只会被 object-fit:cover 裁掉两边（图本身没变，构图缺一块）
    expect(r.box.height).toBe(Math.round((r.box.width * 2) / 3));
  });

  it('删中间一块只删那一块，画布标签还是闭合的（删坏了的话后面新加的块会落到画布外面）', () => {
    let html = addCanvasText(blankPageHtml()).html;
    const mid = addCanvasText(html);
    html = addCanvasText(mid.html).html;

    html = deleteCanvasEl(html, { bel: mid.bel }).html;

    expect(html).not.toContain(`data-bel="${mid.bel}"`);
    expect(html.match(/data-bel=/g)).toHaveLength(2);
    // 画布还认得出来（认不出的话下一次「加一段文字」直接报错，或者插到 </section> 外面）
    const next = addCanvasText(html);
    expect(next.html.indexOf(`data-bel="${next.bel}"`)).toBeLessThan(next.html.indexOf('</div>\n</section>'));
  });
});
