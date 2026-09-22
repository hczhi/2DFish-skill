import { describe, it, expect } from 'vitest';
import {
  toBackdrop, toSplit, toPoster, addDecor, removeDecor, applyDefaultImageMode, backdropMask, backdropBlocker,
  ImageModeError,
} from './imageModes.js';
import { findImageSlots, previewSpecPrompt, specsFromSlots } from './imageService.js';

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
  });

  it('「能不能改成背景图」的结论要和真变形一致（不一致就是一个按钮凭空消失）', () => {
    // 前端照它决定要不要画「改成背景图」那个按钮。判「不能」而其实能变的话，那个按钮在这一页上
    // **压根不出现**，界面上还挂着一句「这一页的版式不做背景图模式」—— 他只会以为这一条版式
    // 不支持，一处都不报错（反过来判错了至少还有一句红字）。
    expect(backdropBlocker(SPLIT_PAGE)).toBeNull();
    // 深底那一条（`.l67-wrap` 是 `var(--c-ink-deep)`）：真变形抛的原文要原样回出去 ——
    // 合成一句「不支持」的话他会去换配色、去改这一页的底，而那几条路都没用。
    const dark = `<section class="slide" data-layout="L67">
  <div class="l67-wrap">
    <div class="l67-bg"><img src="/ppt-cases/ph-16x9.svg" alt="" data-img-prompt="整页气氛底图" data-img-mode="concept"></div>
    <div class="l67-txt"><h1 class="page-title">商业模式</h1></div>
  </div>
</section>`;
    expect(() => toBackdrop(dark)).toThrow(ImageModeError);
    expect(backdropBlocker(dark)).toContain('l67-wrap');
  });

  it('换模式要把原来那张图清回占位图，并说出它还在素材库里', () => {
    // 搬过去的话：那张是按「左图右字」那一格生的，铺满整页主体被裁掉一大半、正好压在文字底下
    // —— 页面每一层都渲染正常、面板上写着「配图 1/1 张」，唯一的症状是「这个功能效果很差」，
    // 而他要做的只是再点一次「生成配图」。反过来清了不说的话，他以为真花过钱的那张被弄丢了。
    const r = toBackdrop(SPLIT_PAGE);
    expect(r.html).not.toContain('/uploads/ppt/a1.jpg');
    const slots = findImageSlots(r.html);
    expect(slots[0].src).toBe('/ppt-cases/ph-16x9.svg');
    // 「画什么」不许跟着清 —— 清了的话下一次生成模型自己编一张（图很好看，和这一页无关）。
    expect(slots[0].prompt).toBe('一位工程师在车间调试设备');
    expect(r.notes.join('\n')).toContain('素材库');

    // 改回分屏同理：背景图那张（留着文字那一侧的大片空白）不许搬回这一格。
    const back = toSplit(r.html.replace('/ppt-cases/ph-16x9.svg', '/uploads/ppt/bd.jpg'));
    expect(back.html).not.toContain('/uploads/ppt/bd.jpg');
    expect(findImageSlots(back.html)[0].src).toBe('/ppt-cases/ph-16x9.svg');
    expect(back.notes.join('\n')).toContain('素材库');
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

  it('一格图都没有的页也要排出一格、并且规划里那份清单跟着变成 1 格', () => {
    // 两段都会静默：加不出图槽 = 这一页变成一张纯占位图，永远生不出东西；
    // 图槽有了而规划里还是 0 格 = 备图那一栏一个格子都不出现，**那张图压根没有按钮可以生成**
    // （画面、接口、notes 全是正常的，他只会以为单图模式坏了）。
    const textOnly = `<section class="slide" data-layout="L01">
  <div class="slide-inner"><h1 class="page-title">三年三步走</h1><ul><li>先做深一个行业</li></ul></div>
</section>`;
    const r = toPoster(textOnly);
    const slots = findImageSlots(r.html);
    expect(slots.length).toBe(1);
    const sync = specsFromSlots([], slots);
    expect(sync.changed).toBe(true);
    expect(sync.specs.length).toBe(1);
    // 「画什么」按标题凑的那一句要真的进清单（空着的话那一格生不出图，一直停在占位图上）
    expect(sync.specs[0].subject).toContain('三年三步走');
    expect(sync.specs[0].mode).toBe('poster');
  });

  it('切过单图模式的页重新生成之后，规划里那一格不许还写着单图', () => {
    // L67 那一页就是这么坏的：格数没变（1 → 1），清单于是把 `mode:'poster'` 整条留下来，
    // 而「先备图」那一步压根没有 html、画法只能从清单来 —— 一格气氛底图按单图那套模板生成，
    // `{{SLIDE_TEXT}}` 原样发出去（这时候一个字都传不进去），模型自己编几句印进画面，
    // 回来一张「整页幻灯片」贴进底图槽位：页面渲染完全正常，只是标题出现了两遍。
    const stale = [{ subject: '围绕「我们的 能力」的一张整页主视觉', mode: 'poster' as const, ratio: '16:9' as const }];
    const sync = specsFromSlots(stale, findImageSlots(SPLIT_PAGE));
    expect(sync.specs[0].mode).toBe('case');
    // 不算「变了」的话调用方不写库，刷新一次又回到单图（而面板上那一行看起来是对的）
    expect(sync.changed).toBe(true);
    expect(sync.problems.join('')).toMatch(/单图/);
    // 「画什么」那句不动（可能是他自己写的），只在提示里点一句
    expect(sync.specs[0].subject).toContain('整页主视觉');
  });

  it('一个字都扒不出来的页要拒掉，不许兜一句', () => {
    // 兜一句的话模型编的那几行读起来和这一页的文案一样自然，而这一页的内容一个字都不在了。
    const blank = `<section class="slide" data-layout="L13"><div class="slide-inner"><div class="l13-fig"><img src="/ppt-cases/ph-16x9.svg" alt="" data-img-prompt="一片安静的海" data-img-mode="case"></div></div></section>`;
    expect(() => toPoster(blank)).toThrow(ImageModeError);
  });
});

describe('装饰背景', () => {
  it('加一层：原来那几格一个字都不动，装饰那一格排在最后', () => {
    // 清了原来那几格 = 他点一下「加装饰背景」，这一页配好的图全变回占位图（每张真花过钱）；
    // 插在前面 = 原来那几格序号整体后移一位，而 `images_json` / 备好的图认的是序号，
    // 下一次生成的图贴进别的格子里，接口 200、缩略图也在。
    const r = addDecor(SPLIT_PAGE);
    const slots = findImageSlots(r.html);
    expect(slots.map((s) => s.mode)).toEqual(['case', 'decor']);
    expect(slots[0].src).toBe('/uploads/ppt/a1.jpg');
    expect(slots[0].prompt).toBe('一位工程师在车间调试设备');
    // 「画什么」由代码从这一页标题算（硬规则 3），而且那一格要真的进规划清单 ——
    // 不进的话备图栏上压根没有这一格，那张图只能走「配全部图」那条真花钱的路。
    expect(slots[1].prompt).toContain('我们的能力');
    const sync = specsFromSlots([{ subject: '一位工程师在车间调试设备', mode: 'case', ratio: '3:4' }], slots);
    expect(sync.specs.map((s) => s.mode)).toEqual(['case', 'decor']);
  });

  it('铺满整页的浅底要就地改透明（装饰层在它下面，不改的话整片看不见）', () => {
    // 不改的话「加完一点变化都没有」：接口 200、备图栏多一格、还能点「AI 生成」（一次真实花费）。
    const wrap = addDecor(FULLBLEED_PAGE).html.match(/<div class="l71-wrap"[^>]*>/)![0];
    expect(wrap).toContain('background:transparent');
  });

  it('去掉之后 html 完全回到原样（改透明那几层也放回去）', () => {
    // 放不回去的话这一页从此没有底色（浅灰变纯白），而「装饰背景」那个开关看起来是关着的。
    expect(removeDecor(addDecor(FULLBLEED_PAGE).html).html).toBe(FULLBLEED_PAGE);
    expect(removeDecor(addDecor(SPLIT_PAGE).html).html).toBe(SPLIT_PAGE);
  });

  it('有装饰层时改成背景图/单图要拒掉，不许带着它一起变形', () => {
    // 不拒的话背景图那一页留着两格图（下一次生成的图贴进看不见的那一格），
    // 单图那一页则是把刚生成的装饰图连版式一起换掉 —— 两种都 200、画面也渲染正常。
    const withDecor = addDecor(SPLIT_PAGE).html;
    expect(() => toBackdrop(withDecor)).toThrow(ImageModeError);
    expect(() => toPoster(withDecor)).toThrow(/装饰背景/);
  });
});

describe('版式自带的默认图模式', () => {
  it('转不过去的那一页要说出真实成因，不许悄悄留在分屏', () => {
    // 吞掉的话库文件上写着「默认图模式：背景图」，而生成出来是一页正常的左图右字 ——
    // 他只会以为那一行没生效，反复重新生成这一页（每次一次真实调用）。
    const r = applyDefaultImageMode(BRAND_PAGE, 'backdrop', { page: 4, layoutId: 'L3' });
    expect(r.changed).toBe(false);
    expect(r.html).toBe(BRAND_PAGE);
    expect(r.problems.join('')).toContain('.l72-field'); // 成因要点到是哪一层挡住的
    expect(r.problems.join('')).toContain('L3');
    // 没写那一行的版式一句话都不许多说（每页都冒一句提示 = 真正该看的那几句被淹掉）
    expect(applyDefaultImageMode(BRAND_PAGE, '', { page: 4, layoutId: 'L7' }).problems).toEqual([]);
  });

  it('版式写的「幕帘 0%」要真的落到这一页上', () => {
    // 丢了这个数（或者用 `||` 把 0 吃掉）= 退回 30% 的白幕帘，叠在 L13/L21/L55 自己那层
    // 黑蒙版上，出来是一张灰掉的照片 —— 而白字清清楚楚、接口 200、problems 是空的。
    const r = applyDefaultImageMode(SPLIT_PAGE, 'backdrop', { page: 2, layoutId: 'L55', mask: 0 });
    expect(r.changed).toBe(true);
    expect(backdropMask(r.html)).toBe(0);
  });
});
