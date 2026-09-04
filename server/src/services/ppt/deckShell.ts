// deck 外壳：把若干个 `<section>` 塞进 `library/template.html`。
//
// **只有这一份实现**（版式 demo 和生成产出的预览都走它）。各写一份的后果不是报错：
// 预览里那一页好看，真 deck 里同一段 HTML 已经换了一副骨架 —— 而「照我们的骨架跑出来
// 长这样」就是案例库和预览存在的全部理由，漂开的那一刻两边都在骗人。

import { library, libraryVersion } from './layoutLibrary.js';
import { designStyleBlock, type DesignSpec } from './designSpec.js';

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
}

export interface AssembleOptions {
  /**
   * 页脚（品牌 + 主题 + 进度条 + 页码 + 目录）。默认带上。
   *
   * **制作过程中的单页预览一律传 false**：它 absolute 压在画面底部那 54px 上，
   * 挡住的是这一页自己的内容，而看起来像「这一页排版就是这样」（截图上就是被那条
   * 白带切掉的一行）。整份放映和导出要带 —— 那两处靠它翻页、看进度、跳目录。
   *
   * 用 `display:none` 而不是把 `<footer>` 删掉：末尾那段脚本会 `getElementById('page-ind')`
   * / `#progress i` / 目录面板，元素没了的话 `go()` 在第一次翻页时就抛异常 ——
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
    // 的 deck —— 页脚、目录、缩放全都正常，只是全白。
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
  const slides =
    design +
    hideFooter +
    sections.map((s, i) => applyVeil(stripPageNumber(s), opts.veils?.[i] ?? 0)).join('\n');
  // 一律用函数形式替换：片段正文里的 `$&` / `$1` 在字符串形式下会被当成引用展开，
  // 悄悄吃掉几个字符。
  return template
    .replace(SLOT, () => slides)
    .replace(/\{\{BRAND_CN\}\}/g, () => meta.brandCn)
    .replace(/\{\{BRAND_EN\}\}/g, () => meta.brandEn)
    .replace(/\{\{TOPIC\}\}/g, () => meta.topic);
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
 * 贴在 `<section>` 开标签紧后面 = DOM 里的第一个孩子：`.slide-veil` 是 `z-index:1`，
 * 背景图那层是 0/auto、内容那层是 2 以上，所以它夹在中间（见 template.html 里
 * `.slide-veil` 上那段注释）。同 z-index 的兄弟（`.corners`、`.l18-cn`）靠「后画的在上面」
 * 压在它上面 —— 所以**必须是第一个孩子**，贴到末尾的话那几个元素会被压暗。
 *
 * 先摘掉已有的那一层：拼装在读的时候每次都跑一遍，不摘的话同一页会越叠越黑
 * （每存一次多一层 0.4，看起来只是「这一页怎么越来越暗」）。
 */
export function applyVeil(html: string, opacity: number): string {
  const cleaned = html.replace(/<div class="slide-veil"[^>]*><\/div>\s*/g, '');
  // 夹逼 + 非数字回落到 0：NaN 写进 style 的话整条声明被浏览器丢掉，蒙版变成**全黑不透明**
  // （opacity 缺省 1），那一页只剩一块黑，而没有一处报错。
  const o = Number.isFinite(opacity) ? Math.min(1, Math.max(0, opacity)) : 0;
  const div = `<div class="slide-veil" style="opacity:${o}"></div>`;
  let injected = false;
  const out = cleaned.replace(/<section\b[^>]*>/, (m) => {
    injected = true;
    return m + div;
  });
  if (!injected) {
    // 这里静默返回原文的话，那一页就是唯一一页没有蒙版的 —— 而它在放映里翻过去只是「亮了一下」。
    throw new Error('这一页里找不到 <section> 开标签，蒙版贴不上去（这段 HTML 不是一页幻灯片）。');
  }
  return out;
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
