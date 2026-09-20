import { describe, it, expect } from 'vitest';
import { toBackdrop, toSplit, toPoster, ImageModeError } from './imageModes.js';
import { findImageSlots, previewSpecPrompt } from './imageService.js';

// 非全幅（左图右字）：`.slide-inner` 和 `.l70-*` 都不刷底，变形应该一次过。
const SPLIT_PAGE = `<section class="slide" data-layout="L70">
  <div class="slide-inner">
    <div class="l70-grid">
      <div class="l70-fig"><img src="/uploads/ppt/a1.jpg" alt="" data-img-prompt="一位工程师在车间调试设备" data-img-mode="case"></div>
      <div class="l70-say"><h1 class="page-title">我们的能力</h1></div>
    </div>
  </div>
</section>`;

// 全幅：`.l71-wrap{inset:0;background:var(--c-bg)}` 正好压在背景图那一层上面。
const FULLBLEED_PAGE = `<section class="slide" data-layout="L71">
  <div class="l71-wrap">
    <div class="l71-img"><img src="/ppt-cases/ph-16x9.svg" alt="" data-img-prompt="横构图；主体偏右上" data-img-mode="case"></div>
    <div class="l71-txt"><h1 class="page-title">出血角图</h1></div>
  </div>
</section>`;

// 品牌色整页（L72）：改透明白字就压在照片上，不改图整片被挡住。
const BRAND_PAGE = `<section class="slide" data-layout="L72">
  <div class="l72-wrap">
    <div class="l72-field">
      <div class="l72-band"><img src="/ppt-cases/ph-16x9.svg" alt="" data-img-prompt="横构图；底部留一条安静的区域" data-img-mode="case"></div>
    </div>
    <div class="l72-txt"><h1 class="page-title">品牌色大色场</h1></div>
  </div>
</section>`;

describe('背景图模式', () => {
  it('变形后这一页还是正好 1 个图槽（原来那一格不许再算一格）', () => {
    // 两格的话下一次生成的图贴进藏起来那一格：接口 200、缩略图也在，而画面里的背景图换不掉。
    const out = toBackdrop(SPLIT_PAGE).html;
    const slots = findImageSlots(out);
    expect(slots.map((s) => s.mode)).toEqual(['backdrop']);
    expect(slots[0].src).toBe('/uploads/ppt/a1.jpg');
  });

  it('压在背景图上面那一层的实底要改成透明', () => {
    // 不改的话那张图整片看不见，而页面每一层都渲染正常 —— 一次真实花费换一张谁也看不到的图。
    const out = toBackdrop(FULLBLEED_PAGE).html;
    const wrap = out.match(/<div class="l71-wrap"[^>]*>/)![0];
    expect(wrap).toContain('background:transparent');
  });

  it('品牌色/深底的页拒掉，并说出是哪个类名上的哪个值', () => {
    let err: unknown;
    try {
      toBackdrop(BRAND_PAGE);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ImageModeError);
    expect((err as Error).message).toContain('.l72-field');
    expect((err as Error).message).toContain('var(--c-brand)');
  });

  it('切完之后备图/预览那条提示词要跟着换成背景图那套，而且锁 16:9', () => {
    // 规划里那条永远写着 `concept` / `3:4`（切模式只改 html 上的记号），跟着规划走的话
    // 他切完再点「AI 生成」花的那次钱买回来的是一张主体居中、四边留白、一个字都没有的
    // 概念插画（3:4 竖图铺满 16:9 的页面，左右被裁掉一大半）—— 而预览、面板、接口全是正常的。
    const page = toBackdrop(
      SPLIT_PAGE.replace('/uploads/ppt/a1.jpg', '/ppt-cases/ph-3x4.svg')
    ).html;
    const r = previewSpecPrompt(
      { subject: '一位工程师在车间调试设备', mode: 'concept', ratio: '3:4' },
      { owner: { userId: 'u1', sdkPk: null, externalUid: null }, index: 1, title: '我们的能力', pageHtml: page }
    );
    expect(r.mode).toBe('backdrop');
    expect(r.prompt).toContain('四边直接出血');
    expect(r.prompt).not.toContain('主体离四边留出一点距离');
    expect(r.prompt).toContain('16:9 横构图');
    expect(r.size).toBe('1536x1024');
  });

  it('改回分屏之后图槽和那张图都回到原来那一格，记号一个不留', () => {
    // 记号留着的话这一页在库里永远是「背景图模式」：再点一次变形被拒，而画面上是分屏的。
    const back = toSplit(toBackdrop(FULLBLEED_PAGE).html).html;
    const slots = findImageSlots(back);
    expect(slots.length).toBe(1);
    expect(slots[0].prompt).toBe('横构图；主体偏右上');
    expect(slots[0].mode).toBe('case');
    expect(slots[0].src).toBe('/ppt-cases/ph-16x9.svg');
    expect(back).not.toMatch(/data-backdrop|data-was-img|has-bg|visibility:hidden|--bg-mask/);
    expect(back).toContain('<div class="l71-wrap">');
  });
});

// 带眼标（`.kicker`）+ 一行超长要点的页：印进图里的字全靠代码扒（硬规则 3）。
const POSTER_PAGE = `<section class="slide" data-layout="L70">
  <div class="slide-header"><span>品牌升级</span></div>
  <div class="slide-inner">
    <div class="l70-grid">
      <div class="l70-fig"><img src="/uploads/ppt/a1.jpg" alt="" data-img-prompt="一位工程师在车间调试设备" data-img-mode="case"></div>
      <div class="l70-say">
        <div class="kicker">02 / 能力</div>
        <h1 class="page-title">我们的<b>能力</b></h1>
        <ul><li>十年行业经验</li><li>${'长'.repeat(60)}</li></ul>
      </div>
    </div>
  </div>
</section>`;

describe('单图模式', () => {
  it('印进图里的字：标题在第一行、页眉那行模块名不进去、超长那行丢掉要点名', () => {
    // 这几行是发给模型「照着印」的原文。标题没提到第一行 = 眼标被印成满屏大字而标题变小字；
    // 模块名进去 = 同一句话在图里和页脚各出现一次；超长那行静默丢 = 图很漂亮，只是少了一条要点。
    const r = toPoster(POSTER_PAGE);
    expect(r.text?.[0]).toBe('我们的 能力');
    expect(r.text).toContain('02 / 能力');
    expect(r.text).not.toContain('品牌升级');
    expect(r.text?.some((l) => l.includes('长长长'))).toBe(false);
    expect(r.notes.join('\n')).toContain('太长');
  });

  it('变形后正好 1 个图槽、走 poster 那一路，那几行字原样读得回来', () => {
    // 多一格的话下一次生成的图贴进看不见的那一格（接口 200、缩略图也在，而画面换不掉）；
    // 读不回那几行字的话提示词里的 `TEXT:` 是空的 —— 模型自己编几句印上去，读起来完全自然。
    const slots = findImageSlots(toPoster(POSTER_PAGE).html);
    expect(slots.length).toBe(1);
    expect(slots[0].mode).toBe('poster');
    expect(slots[0].text).toEqual(toPoster(POSTER_PAGE).text);
    expect(slots[0].prompt).toBe('一位工程师在车间调试设备');
  });

  it('备图/预览那条提示词里要带着这几行原文（不带的话模型自己编几句印上去）', () => {
    // 这一格的 job 也是从 html 现算的：不从 html 读那几行字的话，模板里 `{{SLIDE_TEXT}}`
    // 原样发出去 —— 回来那张图上印着几句读起来完全像这一页文案的字，而它一个字都不是这一页写的。
    const r = previewSpecPrompt(
      { subject: '一位工程师在车间调试设备', mode: 'case', ratio: '3:4' },
      {
        owner: { userId: 'u1', sdkPk: null, externalUid: null },
        index: 1,
        title: '我们的能力',
        pageHtml: toPoster(POSTER_PAGE).html,
      }
    );
    expect(r.mode).toBe('poster');
    expect(r.prompt).toContain('"我们的 能力"');
    expect(r.prompt).not.toContain('{{SLIDE_TEXT}}');
    // 单图这一路的尾巴写死了「不要出现人物」，而这句「画什么」点的是一位工程师 ——
    // 两句话打架时模型自己挑一边（多半是画一张没有人的图），不喊的话看起来只是
    // 「模型没听懂这句话」，他会一张张重生（每张真扣一次额度）。
    expect(r.prompt).toContain('不要出现人物');
    expect(r.problems.join('')).toMatch(/打架/);
  });

  it('一个字都扒不出来的页要拒掉，不许兜一句', () => {
    // 兜一句的话模型编的那几行读起来和这一页的文案一样自然，而这一页的内容一个字都不在了。
    const blank = `<section class="slide" data-layout="L13"><div class="slide-inner"><div class="l13-fig"><img src="/ppt-cases/ph-16x9.svg" alt="" data-img-prompt="一片安静的海" data-img-mode="case"></div></div></section>`;
    expect(() => toPoster(blank)).toThrow(ImageModeError);
  });
});
