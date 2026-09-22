// deck 外壳：把若干个 `<section>` 塞进 `library/template.html`。
//
// **只有这一份实现**（版式 demo 和生成产出的预览都走它）。各写一份的后果不是报错：
// 预览里那一页好看，真 deck 里同一段 HTML 已经换了一副骨架 —— 而「照我们的骨架跑出来
// 长这样」就是案例库和预览存在的全部理由，漂开的那一刻两边都在骗人。

import { library, libraryVersion } from './layoutLibrary.js';
import { designStyleBlock, type DesignSpec } from './designSpec.js';
import { pageImageMode, hasDecor } from './pageMarkers.js';

/** template.html 里 `<section>` 的插入点。 */
export const SLOT = '<!-- partN_fragment.html 的 <section> 在此按顺序插入 -->';

export interface DeckMeta {
  brandCn: string;
  brandEn: string;
  topic: string;
  /**
   * 这份稿子的设计规范（096）。**跟着 meta 走，不另开一个参数**：拼装的调用点有十几处
   * （单页预览、整份、导出、配图后的预览），漏传一处的话那一处是默认配色 —— 预览里蓝的、
   * 导出的文件橙的，两份各自都好看。没有就是默认那套（老 deck）。
   */
  design?: DesignSpec;
  /**
   * 整份共用的那层装饰底图（106）。**跟着 meta 走，理由同 `design`**：拼装的调用点有十几处，
   * 另开一个参数的话漏传的那一处（比如配完图那次预览）静默没有这一层 —— 现象是
   * 「换了张图之后底纹怎么没了，刷新一下又回来了」，两份各自都是正常的一页。
   */
  decor?: DeckDecor;
}

/** 整份共用的那层装饰底图：一个地址 + 一个浓度（`ppt_decks.decor_url` / `decor_alpha`）。 */
export interface DeckDecor {
  url: string;
  alpha: number;
}

export interface AssembleOptions {
  /**
   * 页脚（品牌 + 主题 + 进度条 + 页码）。默认带上。「目录 ▾」那个下拉已经从 template
   * 里去掉了（见 template.html 的 footer）。
   *
   * **制作过程中的单页预览一律传 false**：它 absolute 压在画面底部那 54px 上，
   * 挡住的是这一页自己的内容，而看起来像「这一页排版就是这样」（截图上就是被那条
   * 白带切掉的一行）。整份放映和导出要带 —— 那两处靠它翻页、看进度。
   *
   * 用 `display:none` 而不是把 `<footer>` 删掉：末尾那段脚本会 `getElementById('page-ind')`
   * / `#progress i`，元素没了的话 `go()` 在第一次翻页时就抛异常 ——
   * 现象是「键盘翻页没反应」，控制台之外一点提示都没有。
   */
  footer?: boolean;
  /**
   * 每页的黑色蒙版透明度（097），**按 `sections` 的下标对齐**。不传 = 全 0（没有蒙版）。
   *
   * 长度不够就抛（见 `assembleDeck`）：短一位的话后面那些页静默按 0 拼，
   * 而界面上它们的滑块停在他调过的位置 —— 「保存好像没生效」，而实际是这一处漏传。
   * 单页预览一律走 `assemblePreview`（第三个参数必填），少传一处的话就是
   * 「预览里没蒙版、整份里有」，两份各自都是正常的幻灯片。
   */
  veils?: number[];
}

/** 拼出可以直接丢进 iframe / 存成文件的整份 deck。 */
export function assembleDeck(sections: string[], meta: DeckMeta, opts: AssembleOptions = {}): string {
  const template = library().template;
  if (!template.includes(SLOT)) {
    // 插入点被改掉的话下面那次 replace 什么都不会发生，出来的是一份**没有任何幻灯片**
    // 的 deck —— 页脚、缩放全都正常，只是全白。
    throw new Error(`template.html 里找不到幻灯片插入点（${SLOT}）—— 拼出来会是一份空白 deck。`);
  }
  // 隐藏页脚那句 CSS 跟着幻灯片一起插进 body（不去找 `</head>`）：找不到那个标签时
  // replace 什么都不做，页脚会悄悄回来 —— 而那正是这个参数要去掉的东西。
  const hideFooter = opts.footer === false ? '<style>#footer{display:none}</style>\n' : '';
  // 设计规范那一段同样插在这里（`designStyleBlock` 上的注释说明为什么不去找 `</head>`）。
  // 它只覆盖 `:root` 变量和少数几条规则，所以**已经生成过的页刷新就跟着变**——
  // 页面里的颜色写的都是 `var(--c-*)`，一次调用都不用重花。
  const design = meta.design ? designStyleBlock(meta.design) : '';
  if (opts.veils && opts.veils.length < sections.length) {
    throw new Error(
      `蒙版透明度只给了 ${opts.veils.length} 个，却要拼 ${sections.length} 页 —— ` +
        `按下标对齐的话后面那几页会静默变成 0（没有蒙版），而界面上它们是调过的。`
    );
  }
  const slides = sections.map((s, i) => previewSection(s, meta, opts.veils?.[i] ?? 0)).join('\n');
  return fillMeta(template.replace(SLOT, () => design + hideFooter + slides), meta);
}

/**
 * `{{BRAND_CN}}` 这几个占位符。**一律用函数形式替换**：正文里的 `$&` / `$1` 在字符串形式下
 * 会被当成引用展开，悄悄吃掉几个字符。
 *
 * 外壳和每一页各自替换一遍（`previewShell` + `previewSection`）和整份替换一遍等价 ——
 * 这几个记号是字面量，不会跨接缝断开。等价这件事有测试盯着（`deckShell.test.ts`）。
 */
function fillMeta(s: string, meta: DeckMeta): string {
  return s
    .replace(/\{\{BRAND_CN\}\}/g, () => meta.brandCn)
    .replace(/\{\{BRAND_EN\}\}/g, () => meta.brandEn)
    .replace(/\{\{TOPIC\}\}/g, () => meta.topic);
}

/**
 * 前端拼单页预览用的插入点。**故意不是 `SLOT`**：那一个在 template.html 里，
 * 每次拼装都会被吃掉；这一个是我们发给前端的外壳里留的洞。
 */
export const PREVIEW_SLOT = '<!--PPT_PREVIEW_SLIDE-->';

/**
 * 单页预览的**外壳**（一份 deck 里所有页共用，约 85KB）和**这一页那一段**
 * （`previewSection`，约 1-2KB）分开发给前端，由前端做一次 `replace(PREVIEW_SLOT, …)`。
 *
 * 为什么分：`GET /decks/:id/pages` 原来给每一页都回一整份 `assemblePreview`，也就是把同一份
 * 外壳抄了 N 遍 —— 实测那份 41 页的稿子响应 3658KB，而库里那些页的 html 合计只有 51.5KB
 * （`server/scripts/bench-ppt.mts`）。这件事界面上完全看不出来，只是「打开这份稿子有点慢」。
 *
 * **前端只做字符串替换、不重算任何东西**：蒙版（097 那层黑）和页码剥离都在
 * `previewSection` 里，也就是仍然只有服务端这一份实现。前端自己贴蒙版的话，预览里
 * 和导出的文件里会是两种深浅，而两边各自都是一页正常的幻灯片。
 */
export function previewShell(meta: DeckMeta): string {
  const template = library().template;
  if (!template.includes(SLOT)) {
    throw new Error(`template.html 里找不到幻灯片插入点（${SLOT}）—— 拼出来会是一份空白 deck。`);
  }
  const design = meta.design ? designStyleBlock(meta.design) : '';
  return fillMeta(
    template.replace(SLOT, () => `${design}<style>#footer{display:none}</style>\n${PREVIEW_SLOT}`),
    meta
  );
}

/**
 * 塞进 `PREVIEW_SLOT` 的那一段（贴好蒙版和整份那层装饰底图、剥掉页码、填过品牌记号）。
 *
 * **整份那层底图在这里贴，不在存 html 的时候贴**：存进去的话「改一张图」要重写所有页
 * （一页失败就是半份有半份没有），而这里是每一处拼装的唯一入口 —— 预览、整份放映、导出 HTML
 * 走的都是它，所以三处不可能显示成三种样子。
 */
export function previewSection(html: string, meta: DeckMeta, veilOpacity: number): string {
  const decor = applyDeckDecor(stripPageNumber(html), meta.decor);
  return fillMeta(applyVeil(decor.html, veilOpacity), meta);
}

/**
 * 制作过程中的单页预览（套外壳、不要页脚）。
 *
 * **单页预览只走这一个函数**：第三个参数必填，所以新加一处预览时编译器会逼你回答
 * 「这一页的蒙版是多少」。直接调 `assembleDeck` 的话漏掉 `veils` 不报错，
 * 现象是「预览里没蒙版、刷新/导出之后有」—— 两份各自都是一页正常的幻灯片。
 */
export function assemblePreview(html: string, meta: DeckMeta, veilOpacity: number): string {
  return assembleDeck([html], meta, { footer: false, veils: [veilOpacity] });
}

/**
 * 往一页里贴那层黑色蒙版（097）。**每一页都贴，opacity 0 也贴** —— 由代码固定写死，
 * 不让模型写：交给模型的话它会挑着页写、还会顺手改成渐变或者半透明白，
 * 而每一页单看都是正常的设计。
 *
 * **只往 `<section>` 开标签上写一个 `--veil` 变量，不往里塞任何元素。** 那一层黑现在是
 * `.slide::before`（见 template.html 里那段注释）。原来贴的是 `<div class="slide-veil">` 作为
 * 第一个孩子 —— 而那个 div 只存在于拼装出来的这一份、库里那份 html 里没有，于是浏览器里数出来
 * 的孩子下标整体多一位，就地编辑里「删这一块 / 整块对齐 / AI 改这一块」（都按 `<section>` 数
 * 下来的下标路径定位）全错一格：轻则一句「你选中的那一块和库里那一页对不上」，重则那一块里
 * 没有文字时 eid 交叉核对是空对空，删掉/改掉的是隔壁那一块而接口 200。
 * **所以拼装这一层往 section 里加任何孩子都会重犯这个 bug**（见 pageService.test.ts 里那条断言）。
 *
 * 顺手摘掉老页面里可能存着的那个 div 和上一次写进去的 `--veil`：不摘的话同一页越叠越黑
 * （看起来只是「这一页怎么越来越暗」），而 style 里两个 `--veil` 时生效的是后一个 ——
 * 他调的那个数悄悄不作数。
 */
export function applyVeil(html: string, opacity: number): string {
  const cleaned = html.replace(/<div class="slide-veil"[^>]*><\/div>\s*/g, '');
  // 夹逼 + 非数字回落到 0：NaN 写进去的话 `opacity:var(--veil,0)` 整条声明在计算值那一步
  // 作废、回到初始值 1，那一页只剩一块黑，而没有一处报错。
  const o = Number.isFinite(opacity) ? Math.min(1, Math.max(0, opacity)) : 0;
  // 这里静默返回原文的话，那一页就是唯一一页没有蒙版的 —— 而它在放映里翻过去只是「亮了一下」。
  return writeSectionVars(cleaned, { '--veil': String(o) }, '蒙版');
}

/**
 * 往 `<section>` 开标签上写若干个自定义属性（`--veil` / `--deck-decor…` 都走这一份）。
 *
 * **只有这一份实现**：贴一层背景到页上就是「往 section 上写一个变量」，而这件事有三个坑，
 * 各写一遍的话下一层只踩中其中一两个：
 * ① 已经有 `style` 的（版式会往 section 上写背景图）必须**并进那一个属性里** —— 另起一个
 *    `style="…"` 的话 HTML 只认前面那一个，后加的整条被丢掉，这一层对那几页静默失效；
 *    单引号的 `style='…'` 也要认（同一个原因）。
 * ② 先摘掉上一次写进去的同名变量：不摘的话同一页越叠越浓（看起来只是「这一页怎么越来越暗」），
 *    而 style 里出现两次时生效的是后一个 —— 他调的那个数悄悄不作数。
 * ③ 扫不到 `<section>` 一律抛，不静默返回原文。
 */
function writeSectionVars(html: string, vars: Record<string, string>, what: string): string {
  const names = Object.keys(vars);
  let injected = false;
  const out = html.replace(/<section\b[^>]*>/, (m) => {
    injected = true;
    let tag = m;
    for (const name of names) tag = tag.replace(new RegExp(`\\s*${name}\\s*:[^;"']*;?`, 'g'), '');
    const decls = names.map((name) => `${name}:${vars[name]};`).join('');
    const has = /\sstyle\s*=\s*(["'])/.exec(tag);
    return has
      ? tag.slice(0, has.index + has[0].length) + decls + tag.slice(has.index + has[0].length)
      : `${tag.slice(0, -1)} style="${decls}">`;
  });
  if (!injected) {
    throw new Error(`这一页里找不到 <section> 开标签，${what}贴不上去（这段 HTML 不是一页幻灯片）。`);
  }
  return out;
}

export interface DeckDecorApply {
  html: string;
  /** 这一页到底垫上了没有 */
  applied: boolean;
  /** 没垫上的**真实成因**（垫上了就是空串）—— 给接口原样报出去 */
  reason: string;
}

/**
 * 地址里不许出现的东西：引号、括号、空白、反斜杠。
 *
 * 这一层的地址是拼进 `style="…--deck-decor:url(…)"` 的，所以带引号/括号的地址**不是「这一页
 * 没底纹」，而是整个 style 属性从那个字符起断掉** —— 那一页的背景图、蒙版跟着一起消失，
 * 而页面照旧渲染、一处不报错。写成 `url(xxx)` 不加引号也是为了这个（属性本身可能是单引号的）。
 */
const BAD_URL = /["'()\s\\]/;

/** 地址能不能拼进 CSS（不能就回一句原因，给接口原样报出去）。 */
export function deckDecorUrlProblem(url: string): string | null {
  if (!url) return '没有地址。';
  if (BAD_URL.test(url)) return `图片地址里有引号/括号/空格（${url}）—— 拼进 CSS 会把这一页的 style 整条截断。`;
  if (!/^(https?:\/\/|\/)/.test(url)) return `图片地址要是 / 开头或者 http(s) 开头（收到 ${url}）。`;
  return null;
}

/**
 * 把整份共用的那层装饰底图贴到这一页上（**只写 section 上那两个变量，不加任何孩子** ——
 * 理由同 `applyVeil`）。这一层长什么样见 template.html 里 `.slide::after` 那段注释。
 *
 * **永不抛**：拼一整份的时候抛出去等于「配了这层底纹之后整份稿子打不开了」。垫不上的页
 * 回一句真实成因（`reason`），由接口报给他看 —— 静默跳过的话他翻到那几页只会以为
 * 「这个功能时好时坏」，然后一遍遍重新生成那张图（每张真花一次钱）。
 *
 * 三种跳过（前两种在这里判，第三种判不了 —— 见 `imageModes.deckDecorBlocker`）：
 * ① 背景图/单图模式那两页：它们自己就是整页一张图，`::after` 在绘制顺序里压在那张图上面，
 *    垫上去等于给花钱生的那张图糊一层底纹；
 * ② 这一页自己加过装饰背景：两层叠着比别的页浓一档，而那一层是他单独配过的，以它为准；
 * ③ 铺满整页的不透明底（`.lNN-wrap{inset:0;background:…}` 那二十来条）挡着 —— 这里看不出来。
 */
export function applyDeckDecor(html: string, decor?: DeckDecor | null): DeckDecorApply {
  // 跳过的页也把这两个变量摘一遍：库里那份 html 里正常不会有，但真混进去一个（手工改过、
  // 从别处拷来的一页）的话，这一页会在「已跳过」的报告下面照旧显示着底纹。
  const skip = (reason: string): DeckDecorApply => ({
    html: html.includes('--deck-decor') ? safeClear(html) : html,
    applied: false,
    reason,
  });
  // 「整份没配这一层 / 刚关掉」走同一条摘变量的路（理由同上）：残留一个变量的话，
  // 开关上写着「没有」而那几页照旧有底纹 —— 他会去找是哪一页自己加的（找不到）。
  if (!decor || !decor.url) return skip('');
  const bad = deckDecorUrlProblem(decor.url);
  if (bad) return skip(bad);
  const mode = pageImageMode(html);
  if (mode !== 'split') {
    return skip(mode === 'poster' ? '这一页是单图模式（整页就是一张图）。' : '这一页是背景图模式（图已经铺满整页）。');
  }
  if (hasDecor(html)) return skip('这一页自己加过装饰背景（以那一层为准）。');
  const a = Number.isFinite(decor.alpha) ? Math.min(1, Math.max(0, decor.alpha)) : 0;
  return {
    html: writeSectionVars(html, { '--deck-decor': `url(${decor.url})`, '--deck-decor-a': String(a) }, '装饰底图'),
    applied: true,
    reason: '',
  };
}

/** 摘变量那一步也不许因为「扫不到 section」把整份拼装带下去（那一页本来就没底纹）。 */
function safeClear(html: string): string {
  try {
    return writeSectionVars(html, { '--deck-decor': 'none', '--deck-decor-a': '0' }, '装饰底图');
  } catch {
    return html;
  }
}

/**
 * 摘掉页码：页面上不显示当前页/总页数（`page-badge` 右上角角标、`wm` 右下角大号水印，
 * 以及 `hc-no` / `bio-page-num` 那两个早废弃的内容区徽章），还有没被替换掉的
 * `{{PAGE}}` / `{{TOTAL}}` / `{{PAGE_NUM}}`。
 *
 * **在拼装这一层做**，不只在生成那一步做：库里已经存着的页是花过真钱生成的，不能靠
 * 「重新生成一次」来去掉页码。而那几个类的 CSS 已经从 template 里删了 —— 留着的话
 * 那个 div 掉回默认流式布局，变成正文里凭空多出来的一行「01 / 17」，在 deck 里读起来
 * 像是这一页的设计，没有一处会报错。
 */
export function stripPageNumber(html: string): string {
  return html
    // 类名要整段匹配（`(?<![\w-])…(?![\w-])`）：写成 \b 的话 `wm` 会连 `wm-foo` 一起吃掉，
    // 而被吃掉的是一整个 div —— 那一块内容凭空少了，页面照样渲染，没有一处报错。
    .replace(
      /<div[^>]*class="[^"]*(?<![\w-])(?:page-badge|wm|hc-no|bio-page-num)(?![\w-])[^"]*"[^>]*>[\s\S]*?<\/div>\s*/g,
      ''
    )
    .replace(/\{\{PAGE(?:_NUM)?\}\}\s*\/?\s*(?:\{\{TOTAL\}\})?/g, '')
    .replace(/\{\{TOTAL\}\}/g, '');
}

let classCache: Set<string> | null = null;
// 跟着 library 的版本号一起作废：不跟的话改了 template.html 之后校验用的还是旧那份类名表,
// 现象是「明明已经加了这个类，checkPage 还在说它没定义」（或者反过来，废弃掉的类不再被拦）。
let classCacheAt = -1;
let varCache: Set<string> | null = null;
let varCacheAt = -1;

/**
 * template.html 里**已经定义**的类名。生成出来的 HTML 用了不在这里的类名时那一块会
 * 回到默认流式布局 —— 不报错，页面也不空，只是读起来像「这个版式本身塌了」，
 * 所以调用方必须把差集喊出来（见 pageService.checkPage）。
 */
export function templateClasses(): Set<string> {
  const v = libraryVersion();
  if (v !== classCacheAt) {
    classCache = null;
    classCacheAt = v;
  }
  if (classCache) return classCache;
  // 只扫 `<style>` 里的：整个文件一起扫的话末尾那段 JS 里的 `document.querySelectorAll`
  // 也会被当成类名（`.querySelectorAll`），于是校验变成筛子 —— 而筛子的表现就是
  // 「校验通过、页面塌了」。
  const out = new Set<string>();
  for (const block of library().template.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) {
    // 注释要先去掉：template 里废弃一个类的写法是把整条规则注释掉并写一句「已废弃」，
    // 连注释一起扫的话那些类名照旧算「已定义」—— 于是 checkPage 对
    // page-badge / hc-no / bio-page-num 这些明确禁掉的东西一句话都不说，
    // 而模型照旧会写它们（那正是页面上又出现页码的原因）。
    const css = block[1].replace(/\/\*[\s\S]*?\*\//g, ' ');
    for (const m of css.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) out.add(m[1]);
  }
  classCache = out;
  return out;
}

/**
 * template.html 的 `:root` 里定义过的 CSS 变量名。
 *
 * 编出来的变量名（`--c-text` 那一批）不会报错：浏览器把**整条声明**丢掉 —— 字色掉回继承色、
 * 背景直接透明，页面照样渲染，看起来只是「这一版配色淡了点」。所以凡是让模型写 inline style
 * 的路径（AI 编辑）都得拿这一份去核。
 */
export function templateVars(): Set<string> {
  const v = libraryVersion();
  if (v !== varCacheAt) {
    varCache = null;
    varCacheAt = v;
  }
  if (varCache) return varCache;
  const out = new Set<string>();
  for (const m of library().template.matchAll(/(--[a-z0-9-]+)\s*:/g)) out.add(m[1]);
  varCache = out;
  return out;
}

export function resetDeckShellCache(): void {
  classCache = null;
  classCacheAt = -1;
  varCache = null;
  varCacheAt = -1;
}
