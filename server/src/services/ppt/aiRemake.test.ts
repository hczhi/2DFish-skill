import { describe, it, expect, vi } from 'vitest';
import {
  injectEids, maskRegion, findRegionByPath, eidsIn, maxEidNumber, assignMissingEids, PageEditError,
} from './pageEdit.js';
import { realignImageRecords } from './imageService.js';

// 只有「点中一张图」那条用例要走完整条路（它的关键就在调用前那几行），所以把网关换掉。
const stub = vi.hoisted(() => ({ html: '', summary: '', prompt: '' }));
vi.mock('../../core/llm/parseJson.js', () => ({
  jsonGateway: async (body: () => any) => {
    stub.prompt = body().messages[0].content;
    return { parsed: { html: stub.html, summary: stub.summary }, raw: '' };
  },
  jsonFailMessage: () => '模型没按 JSON 回',
}));

const { validateRemadeRegion, aiRemakeRegion } = await import('./aiRemakeService.js');

// 自由改造放开了「删原文 / 新写中文 / 加图」，所以这条路上的失败全长成一页读起来完全正常的
// 幻灯片：少了一句话、多了一句不是他写的话、新那段字的编号撞上别处那一段。手测三种都看不
// 出来 —— 前两类必须进 notes，第三类必须直接拦。反过来「加了几个图槽 / 删了一张图」他一眼
// 就看见，报出来只会把上面那两条挤成一堵他一律略过的墙，所以一条都不许出。

const PAGE = injectEids(`<section class="slide">
  <div class="slide-inner">
    <div class="l02-head"><h2 class="l02-title">全域增长的三个支点</h2></div>
    <div class="l02-body">
      <div class="l02-item"><div class="num">01</div><div class="desc">先把渠道打通，再谈投放效率</div></div>
      <img src="/ppt-cases/ph-16x9.svg" data-img-prompt="山野远眺，有景深" alt="">
    </div>
  </div>
</section>`);

const REGION = findRegionByPath(PAGE, [0, 1]);
const { masked, tokens } = maskRegion(REGION.html);
/** 那句原文对应的记号（写死 `@@T2@@` 的话打码顺序一变这个测试就变成测别的了）。 */
const TEXT = [...tokens].find(([, v]) => v.includes('渠道'))![0];

const ctx = {
  tokens,
  masked,
  regionName: REGION.name,
  original: REGION.html,
  allowedClasses: new Set(['l02-body', 'l02-item', 'num', 'desc', 'col']),
  knownVars: new Set(['--c-brand', '--c-ink']),
};

describe('ppt 自由改造', () => {
  it('丢掉的原文、AI 新写的文案，都逐条报出来', () => {
    // 删一句是允许的（他可能就是要删），但不说的话那一块只是「短了一截」，读起来完全正常。
    // 新写一句更隐蔽：他要的是排版，模型顺手替他写了一句，屏幕上是一页完整正常的幻灯片。
    const out = masked.replace(TEXT, '<div class="desc">再谈投放效率</div>');
    const notes = validateRemadeRegion(out, ctx);
    expect(notes.join('\n')).toContain('丢掉了 1 段原文：「先把渠道打通，再谈投放效率」');
    expect(notes.join('\n')).toContain('AI 新写了 1 句文案：「再谈投放效率」');
    // 只动排版的那种改动不许报任何一条（什么都报 = 那几条提示他会一律略过）。
    expect(validateRemadeRegion(masked.replace('class="l02-item"', 'class="l02-item" style="display:flex"'), ctx)).toEqual([]);
  });

  it('阴影那种半透明黑白放行，写死品牌色要报出是哪个色值', () => {
    // 拦掉 `rgba(0,0,0,.08)` 的话「加一点投影」这种要求无论怎么写都过不去，而他看到的是一句
    // 「颜色只能用 var(--c-…)」—— 照着做不可能，只能一路重试（每次一次真实花费）。
    const shadow = masked.replace('class="l02-item"', 'class="l02-item" style="box-shadow:0 8px 24px rgba(0,0,0,.08)"');
    expect(validateRemadeRegion(shadow, ctx)).toEqual([]);
    // 真写死了品牌色时，报错里必须是**整个色值**：只报一句「rgba(」的话他不知道是哪一处的什么颜色。
    const brand = masked.replace('class="l02-item"', 'class="l02-item" style="background:rgba(240,134,26,.12)"');
    expect(() => validateRemadeRegion(brand, ctx)).toThrow(/rgba\(240,134,26,\.12\)/);
  });

  it('模型原样退回来时要说「一个像素都没变」', () => {
    // 这一条最像成功：校验全过、摘要照样写着「重排了这一块」，而画面一动不动 —— 他会以为
    // 是自己没看出差别，然后再点一次（再花一次额度）。
    expect(validateRemadeRegion(masked.replace(/>\s+</g, '><'), ctx).join('\n')).toContain('一个像素都没变');
  });

  it('点中的是一张图时改它外面那一层，并且说出来', () => {
    // `<img>` 里装不了三个 `<img>`，所以「把这张大图拆成三张」在 img 上无论怎么试都只会撞到
    // 「不是一整块」那条 —— 读起来像模型不行，他会一直重试（每次花一次额度）。
    const imgPath = [0, 1, 1];
    expect(findRegionByPath(PAGE, imgPath).name).toBe('img');
    const parent = maskRegion(findRegionByPath(PAGE, [0, 1]).html);
    const imgToken = [...parent.tokens].find(([k]) => k.startsWith('@@IMG'))![0];
    stub.summary = '拆成三张小图横排';
    stub.html = parent.masked.replace(
      imgToken,
      ['1x1', '1x1', '1x1'].map((r) => `<img src="/ppt-cases/ph-${r}.svg" data-img-prompt="其中一格" data-img-mode="case">`).join('')
    );
    return aiRemakeRegion({ html: PAGE, path: imgPath, eids: [], instruction: '改成3张图片，横向排列' }, 'u1').then((out) => {
      // 变量名列给它、不让它猜（猜 `--c-text` 的话校验不过，而那一次额度已经花掉了）。
      expect(stub.prompt).toMatch(/能用的样式变量[^\n]*\n[^\n]*--c-ink/);
      // 改的不是他点的那一层，这件事必须说出来（否则「隔壁那几段字也变了」看起来像 AI 乱改），
      // 但它进摘要而不是进 notes —— 点图必然走这一支，当成提示会把要紧的那两条挤下去。
      expect(out.summary).toContain('这次改的是它外面那一层');
      expect(out.summary).toContain('l02-body');
      // 删掉的那张图、新加的那三个图槽都是他一眼就看见的，不许再报 —— 报了那几条提示整体
      // 变成一堵墙，真正会骗人的「AI 顺手替你改了一句文案」跟着被略过。
      expect(out.notes).toEqual([]);
      expect(out.html).toContain('ph-1x1.svg');
      // 改的是外面那一层，所以那一层里原有的文案必须还在（连带被吃掉才是真事故）。
      expect(out.html).toContain('先把渠道打通，再谈投放效率');
      expect(out.html).toContain('全域增长的三个支点');
    });
  });

  it('编一个记号、自己写 data-eid，一律整段丢掉', () => {
    // 编的记号还原不回来，屏幕上留着 `@@T99@@` 那串字。
    expect(() => validateRemadeRegion(masked.replace(TEXT, '@@T99@@'), ctx)).toThrow(/编了 1 个不存在的记号/);
    // 同一句出现两遍。
    expect(() => validateRemadeRegion(masked.replace(TEXT, `${TEXT}${TEXT}`), ctx)).toThrow(/两遍/);
    // 自己写编辑标记 = 撞上这一页别处那一段，之后改一句字落到另一块上，而两块都是正常文字。
    expect(() => validateRemadeRegion(masked.replace('class="l02-item"', 'class="l02-item" data-eid="t9"'), ctx))
      .toThrow(/data-eid/);
  });

  it('自己写图片地址、加图不写 data-img-prompt，一律整段丢掉', () => {
    const img = [...tokens].find(([k]) => k.startsWith('@@IMG'))![0];
    // 编出来的地址是一张破图，而破图和「这一格本来是空的」长得一样。
    expect(() => validateRemadeRegion(masked.replace(img, '<img src="https://cdn.example.com/a.png" data-img-prompt="一张图">'), ctx))
      .toThrow(/图片地址/);
    // 缺 data-img-prompt 的那一格生图那步会跳过，永远停在占位图上（看起来像设计上留白）。
    expect(() => validateRemadeRegion(masked.replace(img, `${img}<img src="/ppt-cases/ph-1x1.svg">`), ctx))
      .toThrow(/data-img-prompt/);
    // **背景图**同样要 —— 只查 `<img>` 的话它整个漏过去：画面上多了一张背景图，而备图面板上
    // 那一格压根不出现（那一整块按规划的清单画），配图也不算它，它永远是占位图。
    const bg = (attrs: string) =>
      masked.replace('class="l02-item"', `class="l02-item" style="background-image:url(/ppt-cases/ph-16x9.svg)"${attrs}`);
    expect(() => validateRemadeRegion(bg(''), ctx)).toThrow(/data-img-prompt/);
    expect(validateRemadeRegion(bg(' data-img-prompt="一张背景图" data-img-mode="case"'), ctx)).toEqual([]);
    // 但**这一页本来就带着**的那种（这条检查上线之前存下来的背景图）不许拦：按总数拦的话那一页
    // 从此每次改造都撞同一句「模型加了 1 处图」，而那处不是这次加的、他改一句要求也绕不开 ——
    // 报错读起来像模型不行，他只会一次次重试，每次花一次额度。
    const already = { ...ctx, original: REGION.html.replace('class="l02-item"', 'class="l02-item" style="background-image:url(/ppt-cases/ph-16x9.svg)"') };
    expect(validateRemadeRegion(bg(''), already)).toEqual([]);
    // 正经加的图槽放行，而且一条提示都不出（占位图上印着「图槽位」，他看得见）。
    const ok = validateRemadeRegion(
      masked.replace(img, `${img}<img src="/ppt-cases/ph-1x1.svg" data-img-prompt="一张小图" data-img-mode="case">`),
      ctx
    );
    expect(ok).toEqual([]);
  });

  it('新写那几段字的编号接着这一页最大那个往后排', () => {
    // 让模型自己写的话它会写 `t1` —— 撞上这一页别处那一段，改一句字落到另一块上。
    const from = maxEidNumber(PAGE);
    const { html, added } = assignMissingEids('<div class="l02-item"><div class="desc">新的一句</div></div>', from);
    expect(added).toEqual([`t${from + 1}`]);
    expect(eidsIn(PAGE)).not.toContain(added[0]);
    expect(html).toContain(`data-eid="${added[0]}"`);
  });

  it('加/删图槽之后，配图记录按新 html 的图槽顺序重排', () => {
    // 图的序号是 `findImageSlots` 按出现顺序数出来的，配图、贴备好的图、面板上「配图 x/y 张」
    // 共用它。改造动过图槽而记录原地不动的话，两种后果都是一页渲染完全正常的幻灯片。
    const REAL = 'https://cos.example.com/a.png';
    const rec = [{ index: 1, prompt: '山野远眺', mode: 'case' as const, ratio: '16:9', url: REAL }];
    const PH = '<img src="/ppt-cases/ph-1x1.svg" data-img-prompt="新的一格">';
    // 在前面插一格：序号整体后移。不重排的话第 1 格那条指的是现在第 2 格那张图，
    // 下一次贴备好的图会落到隔壁那一格上（图文不符）。
    const shifted = realignImageRecords(`<div>${PH}<img src="${REAL}" data-img-prompt="山野远眺"></div>`, rec);
    expect(shifted.images).toEqual([{ ...rec[0], index: 2 }]);
    // 那张真图被改造删掉：整条丢掉。留着的话面板上照旧写「配图 1/1 张」并挂着缩略图，
    // 而画面里全是占位图 —— 他会当这一页配完，直接去拼整份 / 导出。
    const gone = realignImageRecords(`<div>${PH}</div>`, rec);
    expect(gone.images).toEqual([]);
    expect(gone.changed).toBe(true);
  });

  it('原封不动多包一层 / 回来不是一整块，整段丢掉', () => {
    // 只比标签名的话这一条过得去（顶层还是一个 div），而位置和尺寸是父级按 `.l02-body` 给的
    // —— 包起来之后里面一个字都没变，只是整块跑位或塌成内容高度。
    expect(() => validateRemadeRegion(`<div class="col">${masked}</div>`, ctx)).toThrow(/最外层的类名/);
    // 回两块：贴回去会把这一页的结构切断。
    expect(() => validateRemadeRegion(`${masked}<div class="col"></div>`, ctx)).toThrow(/不是一整块/);
  });
});
