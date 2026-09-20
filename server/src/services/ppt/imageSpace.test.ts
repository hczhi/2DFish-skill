import { describe, it, expect } from 'vitest';
import { computeSpaceHints } from './imageSpace.js';

// 留白那一句是**代码算给模型的坐标**，所以它错的时候没有任何报错：模型会老老实实照那个数
// 让开，回来的图构图很正常，只是主体正好落在文字底下 —— 他只能一张张重生（每张真花钱）。

const img = '<img data-img-prompt="随便什么" style="position:absolute;inset:0">';
const page = (blocks: string) => `<section style="position:absolute;inset:0">${img}${blocks}</section>`;

describe('留白区间', () => {
  it('左边一栏文字 → 报的是真区间，而且那个数和版式量出来的宽度对得上', () => {
    // 只说「左侧要安静」的话，模型给的留白常常只有画面的四分之一，主体照旧探到标题底下。
    const h = computeSpaceHints(page('<div style="position:absolute;left:0;top:0;bottom:0;width:55%">这一栏是标题和正文</div>'), '');
    expect(h.get(1)!.prompt).toContain('0–55%');
    expect(h.get(1)!.prompt).toContain('55–100%');
  });

  it('文字分成两簇（右边还有一栏）→ 一个数都不报，不许说「右边 30–100% 空着」', () => {
    // 这一条是整个区间的刹车：只看离那一头最近的那一簇的话，报出去的空地里正压着另一栏字。
    const h = computeSpaceHints(
      page(
        '<div style="position:absolute;left:0;top:0;bottom:0;width:30%">这一栏是标题和正文</div>' +
          '<div style="position:absolute;left:70%;top:0;bottom:0;width:8%">竖着的一条注解</div>'
      ),
      ''
    );
    const p = h.get(1)!.prompt;
    expect(p).not.toMatch(/\d+–\d+%/);
    expect(p).toContain('留白'); // 退回只说方位的那一句，不是一句都不说
  });
});
