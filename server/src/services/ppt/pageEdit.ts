// 就地改文字（不调 AI、不花钱）。他在预览里双击一段字改完，前端只回「哪一块 + 改前那句 +
// 改后那句」，**改 html 这件事全在这里做**：前端把整份 html 序列化回来的话，一次 DOMParser
// 往返就可能把整页的引号/自闭合标签/实体全换一遍，而页面照样渲染 —— 那种改动看不出来，
// 直到导出的文件里某一块塌了。
//
// 定位靠 `data-eid`（生成那一步由 `injectEids` 写进 html，见 pageService）。**不按「第 N 个
// 元素」重算**：重算的话改一次文字就可能让编号漂一位，下一次编辑落到隔壁那一块上 ——
// 两块都是正常的文字，界面上一处都不说。

export class PageEditError extends Error {}

/** 一次能改多长。超了拒：一段特别长的字会顶出版式的 `overflow:hidden`，多出来的部分
 *  一个字都不显示、一处都不报错（他会以为「存上了但没生效」）。 */
export const MAX_EDIT_TEXT = 1000;

/** 这些标签里的「文字」不是给人看的文案（改了是把 CSS/脚本当文案编辑），不给编号。 */
const SKIP_TAGS = new Set(['style', 'script', 'title', 'textarea', 'svg', 'path']);

/** 没有闭合标签的那些 —— 当成「不可能是一段文字的容器」。 */
const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta',
  'param', 'source', 'track', 'wbr',
]);

/** 标签 / 注释。属性值里的 `>` 不算标签结束（`data-img-prompt="…>…"` 会把扫描切错）。 */
const TAG_RE = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>])*)>/g;

interface Leaf {
  /** 开标签里属性那一段的范围（改 inline style 就是重写这一段） */
  attrsFrom: number;
  /** 开标签里 `>` 的位置（插 `data-eid` 就插在它前面） */
  gt: number;
  /** 文字内容在 html 里的范围（开标签之后 → 闭标签之前） */
  start: number;
  end: number;
  attrs: string;
}

/**
 * 扫出所有「只装着一段文字」的元素：开标签之后紧接着就是它自己的闭标签（中间没有别的标签）。
 *
 * 只认这一种是有意的：`<div>CONTENTS<span>目录</span></div>` 这种混排的外层**不算**
 * （改它得连里面那个 span 一起重写，而按文本节点改会把 span 整个吃掉 —— 页面照样渲染，
 * 只是那两个字连着样式一起没了）。外层不给 eid，前端于是不让双击，并明确说这一块要走
 * 重新生成 / AI 编辑。
 */
function leaves(html: string): Leaf[] {
  const out: Leaf[] = [];
  let open: { name: string; attrsFrom: number; gt: number; end: number; attrs: string } | null = null;
  TAG_RE.lastIndex = 0;
  for (let m = TAG_RE.exec(html); m; m = TAG_RE.exec(html)) {
    if (m[0].startsWith('<!--')) {
      open = null;
      continue;
    }
    const name = m[2].toLowerCase();
    const isClose = m[1] === '/';
    const selfClosing = /\/\s*$/.test(m[3] || '');
    if (isClose) {
      if (open && open.name === name && m.index > open.end) {
        const text = html.slice(open.end, m.index);
        if (text.trim() && !text.includes('<')) {
          out.push({
            attrsFrom: open.attrsFrom, gt: open.gt, start: open.end, end: m.index, attrs: open.attrs,
          });
        }
      }
      open = null;
    } else if (selfClosing || VOID_TAGS.has(name) || SKIP_TAGS.has(name)) {
      open = null;
    } else {
      open = {
        name,
        // `<` + 标签名 之后就是属性那一段
        attrsFrom: m.index + 1 + m[2].length,
        gt: m.index + m[0].length - 1,
        end: m.index + m[0].length,
        attrs: m[3] || '',
      };
    }
  }
  return out;
}

/**
 * 给每一段可编辑的文字打上 `data-eid="tN"`（生成这一页时做一次，跟着 html 一起存下来）。
 *
 * **编号存进 html、不在编辑时重算**：重算的话「改一段字」和「编号漂一位」会同时发生，
 * 下一次编辑就落到隔壁那一块上 —— 两块都是正常的文字，界面上一处都不说。
 * 已经带 eid 的 html 原样返回（幂等）：重编一遍号的话，前端手上那份预览里的 t3 和库里
 * 的 t3 会指向两个不同的元素。
 */
export function injectEids(html: string): string {
  if (/\sdata-eid=/.test(html)) return html;
  const found = leaves(html);
  let out = html;
  // 从后往前插，前面那几个位置才不会因为插入而漂掉。
  for (let i = found.length - 1; i >= 0; i--) {
    out = `${out.slice(0, found[i].gt)} data-eid="t${i + 1}"${out.slice(found[i].gt)}`;
  }
  return out;
}

/** 库里那份 html 里这一块现在是哪句话（前端核对 / 报错时说得出「现在是哪句」）。 */
function findByEid(html: string, eid: string): Leaf | undefined {
  return leaves(html).find((l) => new RegExp(`data-eid=["']${escapeRe(eid)}["']`).test(l.attrs));
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 空白差异不算改动：html 源码里那段文字前后带着缩进和换行，而浏览器给的 textContent 不一样。 */
function norm(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** 进 html 的文字一律转义。不转的话他打一个 `<` 或 `&`，从那里到块尾的内容就被浏览器当成
 *  标签吃掉 —— 页面照样渲染、接口 200，只是那一块少了半句话（或整块消失）。 */
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * 把这一块的文字换成他打的那句，返回新的整份 `<section>`。
 *
 * 三条拒绝都是「不拒就悄悄改错东西」：
 * ① **eid 找不到就拒** —— 这一页在这期间重新生成过（eid 全换了一批），按序号猜的话
 *    会改到别的一块上，而两块都是正常的文字。
 * ② **改前那句和库里现在那句对不上就拒** —— 同一份稿子在另一个标签页里改过/重新生成过，
 *    这次编辑是拿着旧画面在改，覆盖上去等于把那边的改动悄悄擦掉。
 * ③ **改成空的拒** —— 那一块会缩成一条看不见的线，而页面照样渲染，读起来像「这个版式
 *    本来这里就是空的」。要去掉整块得走重新生成。
 *
 * 换行折成空格：转成 `<br>` 的话这一块就多了个子标签，下一次它不再是「只装着一段文字」的
 * 元素 —— 界面上那一块**从此双击不动**了，而没有一处会说为什么。
 */
export function applyTextEdit(
  html: string,
  edit: { eid: string; oldText: string; newText: string }
): { html: string; text: string } {
  const leaf = findByEid(html, edit.eid);
  if (!leaf) {
    throw new PageEditError(
      `这一页里找不到 ${edit.eid} 那一块 —— 这一页很可能在这期间重新生成过（每次生成都会重新编号）。这次没存，刷新一下再改。`
    );
  }
  const now = html.slice(leaf.start, leaf.end);
  if (norm(now) !== norm(edit.oldText)) {
    throw new PageEditError(
      `这一块现在库里是「${norm(now).slice(0, 40)}」，不是你改之前看到的那句 —— 这一页在别处改过或重新生成过。这次没存，刷新一下看看现在是哪句。`
    );
  }
  const next = norm(edit.newText.replace(/\r?\n/g, ' '));
  if (!next) {
    throw new PageEditError(
      '改成空的话这一块会缩成一条看不见的线，而页面照样渲染 —— 看起来像这个版式本来就这样。' +
        '要去掉整块请选中它、点浮动条上的 🗑（那个是把这一块整段删掉，不留空壳）。这次没存。'
    );
  }
  if (next.length > MAX_EDIT_TEXT) {
    throw new PageEditError(
      `这段有 ${next.length} 字，上限 ${MAX_EDIT_TEXT} 字 —— 再长会顶出版式的 overflow:hidden，多出来的一个字都不显示也不报错。这次没存。`
    );
  }
  return {
    html: `${html.slice(0, leaf.start)}${esc(next)}${html.slice(leaf.end)}`,
    text: next,
  };
}

// ── 选中一整块（AI 编辑要改的范围）────────────────────────────

export interface HtmlNode {
  name: string;
  /** 开标签第一个字符的位置 */
  start: number;
  /** 闭标签之后一个字符的位置 */
  end: number;
  innerFrom: number;
  innerTo: number;
  children: HtmlNode[];
}

/**
 * 按标签配平扫出这一页的元素树（顶层通常就是那一个 `<section>`）。
 *
 * 手写扫描而不是 DOMParser/cheerio：服务端没有这两样，而且**解析器会顺手「修正」结构**
 * （`<p>` 里的 `<div>` 会被挪出去、少一个闭标签会被自动补上）—— 修正过的树和库里那份
 * html 对不上，于是按下标 splice 回去会切在别的地方，而页面照样渲染。
 */
export function domTree(html: string): HtmlNode[] {
  const roots: HtmlNode[] = [];
  const stack: HtmlNode[] = [];
  const push = (n: HtmlNode) => (stack.length ? stack[stack.length - 1].children.push(n) : roots.push(n));
  TAG_RE.lastIndex = 0;
  for (let m = TAG_RE.exec(html); m; m = TAG_RE.exec(html)) {
    if (m[0].startsWith('<!--')) continue;
    const name = m[2].toLowerCase();
    const after = m.index + m[0].length;
    if (m[1] === '/') {
      // 找到栈里最近的同名开标签就闭合到它（中间那些没闭合的一起收掉）。
      // 找不到就当这个闭标签不存在 —— 抛错的话一处手写的 `</div>` 会让整页编辑不了。
      const at = [...stack].reverse().findIndex((n) => n.name === name);
      if (at < 0) continue;
      for (let k = 0; k <= at; k++) {
        const n = stack.pop()!;
        n.innerTo = m.index;
        n.end = after;
      }
      continue;
    }
    const node: HtmlNode = { name, start: m.index, end: after, innerFrom: after, innerTo: after, children: [] };
    push(node);
    if (!/\/\s*$/.test(m[3] || '') && !VOID_TAGS.has(name)) stack.push(node);
  }
  // 没闭合的那些收在文末（截断的页面就是这样）。
  while (stack.length) {
    const n = stack.pop()!;
    n.innerTo = html.length;
    n.end = html.length;
  }
  return roots;
}

/**
 * 按「从这一页的 `<section>` 数下来的第几个孩子」定位选中的那一块。
 *
 * **不按 eid 求公共祖先**：他选中的那一块里可能有几个没有文字的元素（图、装饰条），
 * 按 eid 算出来的公共祖先会是里面更小的一层 —— 于是他框住的是整块、AI 改的是里面那一层，
 * 而返回的摘要读起来完全正常。路径是浏览器数出来的下标，代码这边照样数一遍（硬规则 3）。
 */
export function findRegionByPath(
  html: string,
  path: number[]
): { name: string; from: number; to: number; html: string; attrsFrom: number; gt: number } {
  const roots = domTree(html);
  let node = roots.find((n) => n.name === 'section') || roots[0];
  if (!node) {
    throw new PageEditError('这一页存的不是一段 HTML（连一个标签都没有），选不出要改的那一块。');
  }
  for (const i of path) {
    const next = node.children[i];
    if (!next) {
      throw new PageEditError(
        '你选中的那一块和库里那一页对不上（这一页在这期间重新生成过或在别处改过）。这次没改，刷新一下重新选。'
      );
    }
    node = next;
  }
  return {
    name: node.name,
    from: node.start,
    to: node.end,
    html: html.slice(node.start, node.end),
    // 开标签里属性那一段（改这一块的 inline style 就是重写它）。`innerFrom` 是 `>` 之后一位。
    attrsFrom: node.start + 1 + node.name.length,
    gt: node.innerFrom - 1,
  };
}

/** 这段 html 里有哪些 `data-eid`（顺序就是出现顺序）。 */
export function eidsIn(html: string): string[] {
  return [...html.matchAll(/data-eid=["']([^"']+)["']/g)].map((m) => m[1]);
}

// ── 打码 / 还原（AI 编辑只让模型碰结构，碰不到文案）────────────────

/** 中日韩文字和全角标点。模型输出里出现这个 = 它在自己写文案（打码之后原文一个字都不在里面）。 */
export const CJK_RE = /[\u2E80-\u9FFF\u3000-\u303F\uFE30-\uFE4F\uFF00-\uFFEF]/;

/**
 * 把这一块里的**文案、图片、带中文的属性**换成 `@@T1@@` 这种记号，只留结构给模型看。
 *
 * 这是「AI 编辑不许改文案」唯一靠得住的做法：靠 prompt 说「不要改文字」的话，模型会顺手
 * 润色一两句、把「及」改成「和」—— 那是一页读起来完全正常的幻灯片，而他要的那句话变了，
 * 没有一处会说。打完码之后**整段里一个中文都不剩**，于是「输出里有中文」就等于「它在编文案」，
 * 一条正则就能拦住（见 CJK_RE）。图片整个标签打码：地址和 `data-img-prompt` 因此不经过模型
 * （硬规则 3），它只能搬动那个记号的位置。
 */
export function maskRegion(html: string): { masked: string; tokens: Map<string, string> } {
  if (/<(script|style)[\s>]/i.test(html)) {
    throw new PageEditError(
      '这一块里有 <script> 或 <style>，AI 编辑不改这种块（把 CSS/脚本打码发出去，模型改错了整份 deck 的每一页都会跟着变）。'
    );
  }
  const src = html.replace(/<!--[\s\S]*?-->/g, '');
  const tokens = new Map<string, string>();
  let n = 0;
  const put = (kind: string, value: string) => {
    const key = `@@${kind}${++n}@@`;
    tokens.set(key, value);
    return key;
  };
  let out = '';
  let last = 0;
  TAG_RE.lastIndex = 0;
  for (let m = TAG_RE.exec(src); m; m = TAG_RE.exec(src)) {
    const gap = src.slice(last, m.index);
    // 纯空白原样留着（缩进换行是模型读结构的线索），有字的一律打码 —— 混排块里那半句
    // （`<div>正文<span>强调</span></div>` 的「正文」）也在这里被换掉，漏了它模型就会去润色它。
    out += /\S/.test(gap) ? put('T', gap) : gap;
    last = m.index + m[0].length;
    if (m[0].startsWith('<!--')) continue;
    if (m[2].toLowerCase() === 'img') {
      out += put('IMG', m[0]);
      continue;
    }
    // 属性值里的中文（`data-img-prompt` 那些）也要打码：留着它模型会照着改一版新的画图提示，
    // 而下一次配图就照那句去画 —— 图变了、页面完全正常。
    out += m[0].replace(/([\w:-]+)\s*=\s*"([^"]*)"/g, (all, k: string, v: string) =>
      CJK_RE.test(v) ? `${k}="${put('A', v)}"` : all
    );
  }
  const tail = src.slice(last);
  out += /\S/.test(tail) ? put('T', tail) : tail;
  return { masked: out, tokens };
}

/** 把记号换回原文。 */
export function unmaskRegion(masked: string, tokens: Map<string, string>): string {
  return masked.replace(/@@[A-Z]+\d+@@/g, (k) => (tokens.has(k) ? tokens.get(k)! : k));
}

// ── 改这一块的样式（颜色 / 字号 / 字重）──────────────────────────

/**
 * 调色板：**只能用 `template.html` 的 `:root` 里真有的那几个变量**（`pageEdit.test.ts` 会核）。
 *
 * 两条都是「屏幕上看起来只是配色淡了点」：编一个变量名出来（`--c-text` 那一批在 5 份 md 里
 * 活了很久）浏览器会把**整条声明**丢掉 —— 字色掉回继承色，页面照样渲染、接口 200；
 * 硬编码色值则一律拒（配色归一的铁律：换肤那天这一块不跟着变，而它读起来完全正常）。
 */
export const COLOR_PALETTE = [
  'var(--c-ink-deep)',
  'var(--c-ink)',
  'var(--c-ink-soft)',
  'var(--c-brand)',
  'var(--c-brand-deep)',
  'var(--c-accent)',
  'var(--c-accent-deep)',
  '#fff',
] as const;

/** 字号（px，设计稿是 1920×1080 的固定坐标系，骨架本身也写 px）。上下限拦的是「一按就没影」：
 *  太小看不见、太大顶出 `overflow:hidden`，两种都不报错。 */
const MIN_FONT_PX = 8;
const MAX_FONT_PX = 400;
const FONT_WEIGHTS = new Set([300, 400, 500, 600, 700, 800, 900]);

/**
 * 对齐。**收两种键**：`textAlign`（普通文字块）和 `justifyContent`（这一块本身是 flex/grid 的
 * 时候）—— 前端按 `getComputedStyle().display` 挑。只收一种的话另一种情形下浏览器**根本不认**
 * 这条声明：接口 200、库里写着 `text-align:center`，而画面一动不动（他会以为按钮坏了）。
 */
const TEXT_ALIGNS = new Set(['left', 'center', 'right']);
const JUSTIFY = new Set(['flex-start', 'center', 'flex-end']);

export interface StylePatch {
  color?: string;
  fontSize?: number;
  fontWeight?: number;
  textAlign?: string;
  justifyContent?: string;
}

/** inline style 拆成 map（顺序无所谓，同名后者胜 —— 浏览器就是这么读的）。 */
function parseStyle(attrs: string): Map<string, string> {
  const m = attrs.match(/\sstyle\s*=\s*"([^"]*)"/i) || attrs.match(/\sstyle\s*=\s*'([^']*)'/i);
  const out = new Map<string, string>();
  for (const part of (m?.[1] || '').split(';')) {
    const i = part.indexOf(':');
    if (i <= 0) continue;
    out.set(part.slice(0, i).trim().toLowerCase(), part.slice(i + 1).trim());
  }
  return out;
}

function writeStyle(attrs: string, decls: Map<string, string>): string {
  const text = [...decls].map(([k, v]) => `${k}:${v}`).join(';');
  // 删到一条不剩时把整个属性摘掉（留一个 `style=""` 不影响渲染，但下一次 `injectEids` /
  // 手工翻 html 时那一块看起来像「有 inline 样式」，找起来指错方向）。
  if (!text) return attrs.replace(/\sstyle\s*=\s*"[^"]*"/i, '').replace(/\sstyle\s*=\s*'[^']*'/i, '');
  if (/\sstyle\s*=\s*["']/i.test(attrs)) {
    // 覆盖原来那个属性，**不追加第二个 `style=`**：浏览器只认第一个，于是他点了按钮
    // 画面一点变化都没有，而库里明明写着新值。
    return attrs.replace(/\sstyle\s*=\s*"[^"]*"/i, ` style="${text}"`).replace(/\sstyle\s*=\s*'[^']*'/i, ` style="${text}"`);
  }
  return `${attrs} style="${text}"`;
}

/**
 * 改这一块的颜色/字号/字重（写成 inline style，**不动那一页的 `<style>`**：改整份 CSS 的话
 * 一次「这行字大一点」会波及每一页上同一个类）。
 *
 * 三条拒绝都是「不拒就点了没反应」：认不出的属性、调色板之外的颜色（含硬编码色值）、
 * 越界的字号/字重 —— 静默忽略的话他点了按钮画面一点没变，看起来像这个按钮坏了，
 * 而接口回的是 200。
 */
export function applyStyleEdit(
  html: string,
  edit: { eid: string; style: Record<string, unknown> }
): { html: string; style: StylePatch } {
  const leaf = findByEid(html, edit.eid);
  if (!leaf) {
    throw new PageEditError(
      `这一页里找不到 ${edit.eid} 那一块 —— 这一页很可能在这期间重新生成过（每次生成都会重新编号）。这次没存，刷新一下再改。`
    );
  }
  const patch: StylePatch = {};
  for (const [k, v] of Object.entries(edit.style || {})) {
    if (k === 'color') {
      const color = String(v).trim();
      if (!(COLOR_PALETTE as readonly string[]).includes(color)) {
        throw new PageEditError(
          `颜色只能用调色板里那几个（${COLOR_PALETTE.join(' / ')}）—— 「${color}」不在里面。` +
            '硬编码色值换肤那天不会跟着变，而那一块读起来完全正常，所以这里直接拒。这次没存。'
        );
      }
      patch.color = color;
    } else if (k === 'fontSize') {
      const px = Math.round(Number(v));
      if (!Number.isFinite(px) || px < MIN_FONT_PX || px > MAX_FONT_PX) {
        throw new PageEditError(
          `字号 ${v} 不行（只收 ${MIN_FONT_PX}–${MAX_FONT_PX}px）—— 再小看不见、再大会顶出版式的 overflow:hidden，两种都不报错。这次没存。`
        );
      }
      patch.fontSize = px;
    } else if (k === 'fontWeight') {
      const w = Math.round(Number(v));
      if (!FONT_WEIGHTS.has(w)) {
        throw new PageEditError(`字重 ${v} 不行（只收 ${[...FONT_WEIGHTS].join(' / ')}）。这次没存。`);
      }
      patch.fontWeight = w;
    } else if (k === 'textAlign') {
      const a = String(v).trim().toLowerCase();
      if (!TEXT_ALIGNS.has(a)) {
        throw new PageEditError(`对齐 ${v} 不行（只收 ${[...TEXT_ALIGNS].join(' / ')}）。这次没存。`);
      }
      patch.textAlign = a;
    } else if (k === 'justifyContent') {
      const a = String(v).trim().toLowerCase();
      if (!JUSTIFY.has(a)) {
        throw new PageEditError(`对齐 ${v} 不行（这一块是 flex/grid，只收 ${[...JUSTIFY].join(' / ')}）。这次没存。`);
      }
      patch.justifyContent = a;
    } else {
      throw new PageEditError(
        `不支持改 ${k} —— 只能改颜色 / 字号 / 字重 / 对齐。静默忽略的话你点了按钮画面一点不变，看起来像按钮坏了，所以这里直接拒。`
      );
    }
  }
  if (!Object.keys(patch).length) {
    throw new PageEditError('没说要改什么（颜色 / 字号 / 字重 / 对齐至少给一个）。这次没存。');
  }
  const decls = parseStyle(leaf.attrs);
  if (patch.color) decls.set('color', patch.color);
  if (patch.fontSize) decls.set('font-size', `${patch.fontSize}px`);
  if (patch.fontWeight) decls.set('font-weight', String(patch.fontWeight));
  if (patch.textAlign) decls.set('text-align', patch.textAlign);
  if (patch.justifyContent) decls.set('justify-content', patch.justifyContent);
  const attrs = writeStyle(leaf.attrs, decls);
  return {
    html: `${html.slice(0, leaf.attrsFrom)}${attrs}${html.slice(leaf.gt)}`,
    style: patch,
  };
}

// ── 改一整块（容器）的对齐 ────────────────────────────────────────

/**
 * 容器上能改的那两条。**只收 flex/grid 认的那几个值**：`align-items:left` 这种写法浏览器
 * 直接把整条声明丢掉 —— 接口 200、库里写着新值，而画面一动不动。
 */
const ALIGN_ITEMS = new Set(['flex-start', 'center', 'flex-end', 'stretch', 'baseline']);
const JUSTIFY_CONTENT = new Set(['flex-start', 'center', 'flex-end', 'space-between', 'space-around']);

/**
 * 「取消」是 **`null` = 把这一条 inline 声明删掉**，不是写 `align-items:unset`。
 *
 * 这两件事在屏幕上都叫「取消对齐」，但结果不一样：inline 的 `unset`（`initial`/`revert`/`normal`
 * 同理）会**盖住**这一页 `<style>` 里那条，把它按成 `normal`（等于拉满）—— 而版式里写的可能是
 * `center`。于是他点「取消」得到的不是版式原来的样子，而是第三种样子，页面照样渲染。
 * 所以这几个词一律拒，并指到 `null` 上。
 */
const CSS_DEFAULT_WORDS = new Set(['unset', 'initial', 'revert', 'normal', 'inherit', 'auto']);

export interface RegionStylePatch {
  /** `null` = 删掉这一条 inline 声明（回到这一页 `<style>` 里那个值） */
  alignItems?: string | null;
  justifyContent?: string | null;
}

/**
 * 给「他框住的那一整块」写 inline style（现在只有对齐两条）。
 *
 * 定位和 AI 编辑同一套：**从这一页的 `<section>` 数下来的孩子下标路径**（不是 eid —— 容器
 * 压根没有 eid）。调用方必须先核一遍那串 eid 对不对得上（见 api 层）：不核的话浏览器和这边
 * 差一层时，样式写到了隔壁那一块上 —— 页面照样渲染，只是「他点的那一块没动、另一块动了」。
 */
export function applyRegionStyle(
  html: string,
  edit: { path: number[]; style: Record<string, unknown> }
): { html: string; style: RegionStylePatch; region: string; prev: Record<string, string> } {
  const region = findRegionByPath(html, edit.path);
  const patch: RegionStylePatch = {};
  for (const [k, v] of Object.entries(edit.style || {})) {
    const prop = k === 'alignItems' ? 'align-items' : k === 'justifyContent' ? 'justify-content' : '';
    if (!prop) {
      throw new PageEditError(
        `整块上只能改对齐（align-items / justify-content）—— 不支持 ${k}。静默忽略的话你点了按钮画面一点不变，看起来像按钮坏了，而接口回 200。`
      );
    }
    if (v === null || v === '') {
      // 「取消」：删掉这一条（见 CSS_DEFAULT_WORDS 上面那段）。
      (patch as Record<string, string | null>)[k] = null;
      continue;
    }
    const val = String(v).trim().toLowerCase();
    if (CSS_DEFAULT_WORDS.has(val)) {
      throw new PageEditError(
        `要回到版式自己的对齐请发 ${k}: null（把这一条 inline 声明删掉）—— 写 ${prop}:${val} 是**盖住**这一页 <style>` +
          `里那条、按成「拉满」，而版式里写的可能是 center：屏幕上不是「取消了」，是第三种样子，而页面照样渲染。这次没存。`
      );
    }
    const ok = prop === 'align-items' ? ALIGN_ITEMS : JUSTIFY_CONTENT;
    if (!ok.has(val)) {
      throw new PageEditError(`对齐 ${v} 不行（${prop} 只收 ${[...ok].join(' / ')}）。这次没存。`);
    }
    (patch as Record<string, string | null>)[k] = val;
  }
  if (!Object.keys(patch).length) {
    throw new PageEditError('没说要改什么对齐。这次没存。');
  }
  // 自闭合标签（`<img … />`）末尾那个 `/` 要摘掉再写：留着的话拼出来是 `… / style="…">`，
  // 浏览器把 style 当成 `/` 后面的垃圾属性丢掉 —— 页面照样渲染，只是这次改动无声无息。
  const raw = html.slice(region.attrsFrom, region.gt);
  const selfClosing = /\/\s*$/.test(raw);
  const bare = selfClosing ? raw.replace(/\/\s*$/, '') : raw;
  const decls = parseStyle(bare);
  /** 改之前这一条 inline 是什么（回给界面：他点了「取消」之后要知道刚删掉的是哪个值，
   *  不然那一整块变了样而他不知道该点回哪个键）。 */
  const prev: Record<string, string> = {};
  const write = (prop: string, val: string | null | undefined) => {
    if (val === undefined) return;
    prev[prop] = decls.get(prop) || '';
    if (val === null) {
      // 本来就没有这一条时**必须拒**：删一个不存在的东西 html 一个字不变，而接口回 200
      // 加一句「已存」—— 他看到的是「点了取消，对齐没变」，还会以为按钮坏了。
      // 真正的成因是这一块的对齐来自这一页自己的 `<style>`，这里删不掉。
      if (!decls.has(prop)) {
        throw new PageEditError(
          `这一整块的 inline style 里没有 ${prop} —— 它现在的对齐来自这一页自己的 <style>（或就是默认值），这里删不掉（删了 html 一个字都不会变）。要改它直接点那几个对齐键。`
        );
      }
      decls.delete(prop);
      return;
    }
    decls.set(prop, val);
  };
  write('align-items', patch.alignItems);
  write('justify-content', patch.justifyContent);
  const attrs = writeStyle(bare, decls) + (selfClosing ? ' /' : '');
  return {
    html: `${html.slice(0, region.attrsFrom)}${attrs}${html.slice(region.gt)}`,
    style: patch,
    region: region.name,
    prev,
  };
}

// ── 删掉一整块 ────────────────────────────────────────────────────

/** 这段 html 里还有没有「看得见的东西」（有字的文本节点，或者一张图）。 */
function hasVisibleContent(html: string): boolean {
  if (/<img[\s/>]/i.test(html)) return true;
  return /\S/.test(html.replace(/<!--[\s\S]*?-->/g, '').replace(TAG_RE, ''));
}

/**
 * 把他选中的那一整块（含单独一段文字）从这一页里整段剪掉。**不调 AI、不花钱。**
 *
 * 定位和 `applyRegionStyle` 同一套（从 `<section>` 数下来的孩子下标路径 + 调用方拿那串 eid
 * 交叉核对），所以「浏览器和库里差一层」这种情况在那一层就被挡住了 —— 不挡的话删掉的是
 * 隔壁那一块：页面照样渲染、接口 200，只是他框的那块还在、另一块没了。
 *
 * **剩下的 eid 一个都不重编号**（这里绝不调 `injectEids`）：重编一遍的话前端手上那份预览里的
 * t5 和库里的 t5 会指向两个不同的元素，下一次双击改字落到隔壁那一块上，而两块都是正常的文字。
 *
 * 四条拒绝，每一条不拒都是「界面上一句『已删掉』，而错在几步之后才露出来」：
 * ① **块里有 `<img>`（或图槽位）一律拒。** 图的序号是 `findImageSlots` 按 html 顺序扫出来的，
 *    `images_json`、备好的图（`pending_images_json` 按 index 对齐 `plan_json` 的 `imageSpecs`）、
 *    `pasteIntoBuiltPage` 全按这个序号贴 —— 删掉第 1 格所在的那一块之后，下一次「换一批图」
 *    会把第 2 张贴进第 1 格：图文不符，而页面渲染完全正常、接口 200，面板上还照旧写着「3/3 张有图」。
 * ② **`<section>` 自己（空路径）拒。** 剪掉整页在 iframe 里是一块白，和「这个版式渲染塌了」
 *    分不开，而拼整份那边只会说「缺第 N 页」。
 * ③ **删完这一页没有任何看得见的内容了就拒**（同 ②：空 `<section>` = 一块白）。
 * ④ **删完一个 `data-eid` 都不剩就拒**：前端的 `canEditText` 是按「html 里有没有 data-eid」算的，
 *    于是界面会谎报「这一页是加这个功能之前生成的，重新生成一次才能改文字」—— 他会去点一次
 *    真实调用，而真正的成因是他自己把最后一段字删了。
 *
 * `<script>` / `<style>` 那一块也不给删：那是**整份 deck 的样式**（`checkPage` 已经为它报过一条
 * problem），从这里剪掉的话画面上是「这一页忽然好看了/塌了」，而成因在另一页上也会跟着变。
 */
export function applyDelete(
  html: string,
  edit: { path: number[] }
): { html: string; removed: { name: string; cls: string; eids: string[]; text: string } } {
  if (!edit.path.length) {
    throw new PageEditError(
      '这样是把整页剪掉 —— 剩下一个空 <section>，在预览里就是一块白，和「这个版式渲染塌了」分不开。' +
        '要换掉整页请走「重新生成这一页」。这次没删。'
    );
  }
  const region = findRegionByPath(html, edit.path);
  if (/<img[\s/>]/i.test(region.html) || /data-img-prompt=/i.test(region.html)) {
    throw new PageEditError(
      '这一块里有图，删不了 —— 图的序号是按这一页 html 里的出现顺序算的，删掉一个图位之后，' +
        '下一次「换一批图」或重贴备好的图会把第 2 张贴进第 1 格：图文不符，而页面渲染完全正常、' +
        '面板上照旧写着「几张有图」。要去掉这一块请走「重新生成这一页」。这次没删。'
    );
  }
  if (/(?<![\w-])slide-header(?![\w-])/.test(region.html)) {
    // 页眉是整份统一、由代码贴的那一行模块名（096 `applyHeader`）。删掉之后**只有这一页**
    // 左上角是空的，而它在预览里只是「这一页看着比别的干净」—— 翻整份时也只觉得有点怪，
    // 没有一处会说。要整份都不要页眉，那是设计规范的事，不是删一页上的一块。
    throw new PageEditError(
      '这一块是统一页眉（左上角那行模块名，整份每一页都有，由代码贴上去的）—— 只删这一页的话，' +
        '整份里只有这一页左上角是空的，而它看起来只是「这一页比别的干净」，没有一处会提示。' +
        '模块名要改就在「提纲与设置」里改这一页的所属模块，再重新生成这一页。这次没删。'
    );
  }
  if (/<(script|style)[\s>]/i.test(region.html)) {
    throw new PageEditError(
      '这一块里有 <script> 或 <style> —— 那段 CSS 改的是整份 deck 的每一页，从这里剪掉的话' +
        '别的页也会跟着变样，而这里只显示「已删掉」。这次没删。'
    );
  }
  const next = `${html.slice(0, region.from)}${html.slice(region.to)}`;
  if (!hasVisibleContent(next)) {
    throw new PageEditError(
      '删完这一页就什么都不剩了 —— 空的 <section> 在预览里是一块白，读起来像这个版式渲染塌了。这次没删。'
    );
  }
  if (eidsIn(html).length && !eidsIn(next).length) {
    throw new PageEditError(
      '这是这一页最后一段可以编辑的文字 —— 删掉之后界面会说「这一页还没有编辑标记，重新生成一次才能改文字」' +
        '（那是假话，成因是这一块被删了），而他会为此花掉一次真实调用。这次没删。'
    );
  }
  const cls = (region.html.match(/^<[a-zA-Z][\w-]*[^>]*\sclass=["']([^"']*)["']/) || [, ''])[1] || '';
  return {
    html: next,
    removed: {
      name: region.name,
      cls: cls.trim().split(/\s+/)[0] || '',
      eids: eidsIn(region.html),
      // 删掉的那几个字（界面上要说出「删的是这一块」—— 只说 `<div>` 的话他分不出删对了没有）。
      text: norm(region.html.replace(/<!--[\s\S]*?-->/g, '').replace(TAG_RE, ' ')).slice(0, 60),
    },
  };
}
