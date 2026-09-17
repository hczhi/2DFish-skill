// pptx 导出这条路上唯一「出错时会伪装成成功」的地方：**回执**。
//
// 导出本身不会假成功（起不了浏览器、拼不出 deck 都会抛）。会骗人的是这几种：字体没取到、
// 图没取到、某页一块可编辑文本都没有、**pptx 里压根画不出来的那几类样式**（伪元素装饰、渐变、
// 毛玻璃…）—— 这几种下载下来的都是一份能打开、翻起来正常的 pptx，只有那句话能告诉用户
// 「你手上这份和网页版不一样」。所以只测 `pptxNotes` 说不说、说什么。
import { describe, it, expect } from 'vitest';
import { pptxNotes } from './pptxDeck.js';

const clean = { fontsOk: true, textless: [], placeholders: 0, broken: 0 };

describe('pptxNotes', () => {
  it('一切正常时也要说「位置是按服务器上量的字宽摆的」', () => {
    // 这条不说的话，客户机器上少装两个字体导致的「有几行挤在一起」会被当成导出坏了。
    const notes = pptxNotes(clean);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatch(/Noto Sans\/Serif SC/);
  });

  it('pptx 里画不出来的那几类要报「几处、哪几页」', () => {
    // 这是这条路上最会骗人的一件事：缺了伪元素装饰、渐变退成纯色之后，文件打开完全正常，
    // 客户只会觉得「这版设计有点素」，我们这边一处都不报错。
    const notes = pptxNotes({
      ...clean,
      pages: 12,
      degrade: { pseudo: { places: 33, pages: [1, 2, 3, 4, 5, 6, 7, 8] }, glass: { places: 1, pages: [4] } },
    }).join('\n');
    expect(notes).toMatch(/8 页里共 33 处/);
    expect(notes).toMatch(/第 4 页共 1 处/);
  });

  it('文件大到发不出去时要报体积', () => {
    // 这件事只有他要把附件发给别人时才撞上，那时没有一处能说明体积是怎么来的。
    const notes = pptxNotes({ ...clean, bytes: 31 * 1024 * 1024 }).join('\n');
    expect(notes).toMatch(/31 MB/);
  });

  it('服务器没取到字体时点明「位置和宽度是按回落字体量的」', () => {
    const notes = pptxNotes({ ...clean, fontsOk: false });
    expect(notes.some((n) => /回落字体/.test(n))).toBe(true);
  });

  it('图没取到 / 有页改不了字都要报出页号和张数', () => {
    const notes = pptxNotes({ ...clean, broken: 3, textless: [2, 7] }).join('\n');
    expect(notes).toMatch(/3 张图/);
    // 「哪几页改不了字」是客户当面双击时才会发现的事 —— 页号必须在话里。
    expect(notes).toMatch(/第 2、7 页/);
  });
});
