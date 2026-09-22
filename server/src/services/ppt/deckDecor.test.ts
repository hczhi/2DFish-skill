// 整份共用那层装饰底图（106）。测的是**跳过**这一件事：垫不上去的页在画面上和
// 「垫上了但浓度太低」长得一模一样 —— 少了 reason 的话面板上那几行「第 N 页没垫上：…」
// 就是空的，他会翻到那几页上反复点按钮、或者把浓度拉到 100%（而真正的原因是这一页
// 已经是整页一张图）。所以这里断言的是 ①**整份拼出来的那份**里哪几页带着这一层
// （导出的 .html / .pptx 走的就是它），② 每一条跳过都说得出成因。
import { describe, it, expect } from 'vitest';
import { assembleDeck, applyDeckDecor } from './deckShell.js';

const meta = { brandCn: '巧南', brandEn: 'QiaoNan', topic: 'T', decor: { url: '/uploads/x.png', alpha: 0.2 } };

const split = '<section class="slide" data-eid="a"><h2>分屏</h2></section>';
const backdrop = '<section class="slide" data-eid="b"><div class="case-bg" data-backdrop="1"></div></section>';
const poster = '<section class="slide" data-eid="c" data-poster="1"><img src="/x.png" /></section>';
const own = '<section class="slide" data-eid="d"><div class="page-decor" data-decor="1"><img src="/y.png" /></div></section>';

describe('整份那层装饰底图', () => {
  it('只垫在分屏页上，另外三种页在拼好的整份里一点都没有', () => {
    const out = assembleDeck([split, backdrop, poster, own], meta, { veils: [0, 0, 0, 0] });
    // 按 data-eid 切开数：全份数一次 `--deck-decor` 出现几回的话，垫错页和垫对页数量一样。
    const carries = (eid: string) =>
      new RegExp(`<section[^>]*data-eid="${eid}"[^>]*--deck-decor\\s*:\\s*url\\(/uploads/x\\.png\\)`).test(out);
    expect(carries('a')).toBe(true);
    expect(carries('b')).toBe(false);
    expect(carries('c')).toBe(false);
    expect(carries('d')).toBe(false);
    // 浓度也要跟着进去：漏了这个变量的话 CSS 里的默认值是 0，图配上了而画面一点没变。
    expect(out).toMatch(/--deck-decor-a\s*:\s*0?\.2/);
  });

  it('每一种垫不上去都说得出成因（空 reason = 面板上那一行是空白）', () => {
    for (const html of [backdrop, poster, own]) {
      const r = applyDeckDecor(html, meta.decor);
      expect(r.applied).toBe(false);
      expect(r.reason.length).toBeGreaterThan(4);
    }
    // 地址里带引号/括号会把整个 style 属性截断（这一页的底色和蒙版一起没了），所以宁可不垫。
    const bad = applyDeckDecor(split, { url: '/a b".png', alpha: 0.2 });
    expect(bad.applied).toBe(false);
    expect(bad.reason).toBeTruthy();
  });

  it('关掉之后，原来垫过的那一页上不会留着旧地址', () => {
    const on = applyDeckDecor(split, meta.decor).html;
    const off = applyDeckDecor(on, null).html;
    expect(off).not.toContain('/uploads/x.png');
  });
});
