import { describe, it, expect } from 'vitest';
import { imageGroupProblems } from './imageGroups.js';

// 「一行图会参差」这件事在生成那一刻**看不见**：占位图三张是同一个文件，预览里一行整整齐齐，
// 真图配上来才一高一矮 —— 而那时图已经生成过、钱已经花了。所以这一条只能靠代码在生成时算。

const page = (inner: string) => `<section class="slide"><div class="slide-inner">${inner}</div></section>`;
const row = (cells: string) => page(`<div style="display:grid;grid-template-columns:repeat(2,1fr)">${cells}</div>`);
const cell = (ph: string, style = 'width:100%') =>
  `<div><img src="/ppt-cases/${ph}" style="${style}" data-img-prompt="x"><p>说明</p></div>`;

describe('同一组图的高度', () => {
  it('混着两种比例的占位图、而这一组没钉死高度时要喊', () => {
    const said = imageGroupProblems(row(cell('ph-16x9.svg') + cell('ph-3x4.svg')));
    expect(said.join(' ')).toMatch(/不同比例的占位图/);
    // 比例名字要点出来：不点名的话他只能一格格点开看 data-img-prompt 猜是哪两格。
    expect(said.join(' ')).toContain('ph-3x4.svg');
  });

  it('这一组已经钉死高度时一个字都不说（混比例只是裁掉一点）', () => {
    // 这条才是真正会出事的方向：多报一次就占掉「这一页有 N 处注意」那个数字和右侧那个红标，
    // 而那是这一页唯一的报警 —— 真正要看的那条（版式塌了 / 还是占位图）会被当成噪音无视，
    // migration 094 删的就是这种句子。所以 `.gallery img{aspect-ratio}` 这种钉法必须认得出来。
    const fixed = 'width:100%;aspect-ratio:16/9;object-fit:cover';
    expect(imageGroupProblems(row(cell('ph-16x9.svg', fixed) + cell('ph-3x4.svg', fixed)))).toEqual([]);
    expect(
      imageGroupProblems(
        page(
          '<div class="gallery g2">' +
            '<div><img src="/ppt-cases/ph-16x9.svg"></div><div><img src="/ppt-cases/ph-3x4.svg"></div></div>'
        )
      )
    ).toEqual([]);
  });
});
