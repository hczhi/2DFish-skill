// deck 外壳：把若干个 `<section>` 塞进 `library/template.html`。
//
// **只有这一份实现**（版式 demo 和生成产出的预览都走它）。各写一份的后果不是报错：
// 预览里那一页好看，真 deck 里同一段 HTML 已经换了一副骨架 —— 而「照我们的骨架跑出来
// 长这样」就是案例库和预览存在的全部理由，漂开的那一刻两边都在骗人。

import { library, libraryVersion } from './layoutLibrary.js';

/** template.html 里 `<section>` 的插入点。 */
export const SLOT = '<!-- partN_fragment.html 的 <section> 在此按顺序插入 -->';

export interface DeckMeta {
  brandCn: string;
  brandEn: string;
  topic: string;
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
  const slides = hideFooter + sections.map(stripPageNumber).join('\n');
  // 一律用函数形式替换：片段正文里的 `$&` / `$1` 在字符串形式下会被当成引用展开，
  // 悄悄吃掉几个字符。
  return template
    .replace(SLOT, () => slides)
    .replace(/\{\{BRAND_CN\}\}/g, () => meta.brandCn)
    .replace(/\{\{BRAND_EN\}\}/g, () => meta.brandEn)
    .replace(/\{\{TOPIC\}\}/g, () => meta.topic);
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
