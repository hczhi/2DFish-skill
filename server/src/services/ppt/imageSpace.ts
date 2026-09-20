// 「这一格的图，哪一块会被文字压住」—— 从**版式的几何**算出来，不问模型。
//
// 为什么必须算：生图提示词里的「留白方向」是 PPT 可用性的命门（主体偏哪边、哪边空着给标题）。
// 让规划模型自己在 `data-img-prompt` 里写「左侧留白」的话，它写的是它想象的版式，而版式是我们
// 自己的库定的 —— 两边不一致时没有任何报错：出来的图主体正好长在标题底下，页面照旧渲染正常，
// 用户只会觉得「这张图怎么这么挤」，然后一张张重生（每张都是一次真实花费）。
//
// 三条边界：
// ① **只认绝对定位的块。** 版式库里所有「文字压在图上」的页（全幅那一档）都是
//    `.lNN-wrap{position:absolute;inset:0}` + 绝对定位的文字块，这一层能算准。流式/grid 排的
//    那些（图在自己的面板里、文字在旁边）算不出来 → **不给提示**，这正是对的：那种图不需要留白。
// ② **算不出来就不说话**，不能回落成「主体居中」之类的默认句。回落的话每一页都带一句自信的
//    留白指示，而其中一部分是错的 —— 比「没有这一句」更糟（模型会照错的那边让开）。
// ③ 假设写在常量里（`UNKNOWN_EXTENT` / `CENTER_KEEP` / `BUSY_BAND`），不散在代码里：这几个数
//    调一次就会改掉所有页的留白方向，散着写的话下次只会改到一处。

import { library, libraryVersion } from './layoutLibrary.js';
import { demoFragments } from './demoDeck.js';

/** 舞台就是 1920×1080（`#stage`），`.slide` 是 `inset:0`，所以页面坐标系直接用它。 */
const PAGE = { x: 0, y: 0, w: 1920, h: 1080 };

/** 只锚了一边、量不出宽/高的块，按容器的这个比例往里算。偏大比偏小安全（宁可多留一点白）。 */
const UNKNOWN_EXTENT = 0.45;
/** 两边都锚死（`inset:0` / `top`+`bottom`）又居中对齐的容器，内容只占中间这一段。 */
const CENTER_KEEP = 0.6;
/** 一条三等分带被文字盖掉这么多就算「忙」。 */
const BUSY_BAND = 0.45;
/**
 * 报出「左边 0–55%」这种**真区间**用的细分条数（1% 一条）。
 *
 * 为什么不直接用上面那 3×3：三等分只够判**方位**（左/右/上/下），报不出分界在哪 ——
 * 而「那一侧」在模型那里是个很软的说法，实测它给的留白经常只有画面的四分之一，
 * 于是主体照旧探到标题底下，页面渲染完全正常。
 */
const PROFILE_STEPS = 100;
/** 一条细带被文字盖掉这么多就算「忙」（和 `BUSY_BAND` 同一个尺度）。 */
const BUSY_STEP = 0.45;
/** 扫到连续这么多条干净带就算「这一簇文字到这儿为止」（版式的 `--pad-x:140px` ≈ 7 条）。 */
const CLUSTER_GAP = 10;
/**
 * 算出来的分界落在 15–85 之外、或者留给主体的那一段窄于 `FREE_MIN`，就**不报数字**，
 * 退回只说方位的那一句（文件头 ②：编一个数比没有这一句更糟 —— 模型会照那个数让开，
 * 而主体被挤到画面边上，图看起来只是「构图有点怪」）。
 */
const SPAN_MIN = 15;
const SPAN_MAX = 85;
const FREE_MIN = 25;

export type SpaceWhere = 'left' | 'right' | 'sides' | 'center' | 'top' | 'bottom' | 'middle' | 'most';

export interface SpaceHint {
  where: SpaceWhere;
  /** 文字盖掉了图的百分之几（整数，给日志看） */
  pct: number;
  /** 拼进生图提示词的那一句（**跟画风模板同语言** —— 模板是中文的，这一句也必须是中文） */
  prompt: string;
  /** 说人话的那一句（日志/界面用，带百分比） */
  cn: string;
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface El {
  name: string;
  classes: string[];
  style: Record<string, string>;
  parent: number;
  /** 自己这一层的文字（不含子元素） */
  text: string;
  /** 带 `data-img-prompt` 的第几格（从 1 起），不是槽位就是 0 */
  slot: number;
}

// ---------------------------------------------------------------- CSS

const VOID_TAGS = new Set(['img', 'br', 'hr', 'input', 'source', 'meta', 'link']);

function styleBlocks(css: string): string {
  const blocks = [...css.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]);
  return blocks.length ? blocks.join('\n') : css;
}

function declsOf(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of text.split(';')) {
    const at = part.indexOf(':');
    if (at < 0) continue;
    const k = part.slice(0, at).trim().toLowerCase();
    // `background:url(a:b)` 这种值里也有冒号，所以只切第一个
    if (k) out[k] = part.slice(at + 1).trim();
  }
  return out;
}

interface Sheet {
  /** 类名 → 合并后的声明（只收单类选择器 `.foo`，`.a .b` / `.a.b` 一律不收） */
  byClass: Map<string, Record<string, string>>;
  vars: Record<string, string>;
}

function parseSheet(raw: string): Sheet {
  const css = styleBlocks(raw).replace(/\/\*[\s\S]*?\*\//g, '');
  const byClass = new Map<string, Record<string, string>>();
  const vars: Record<string, string> = {};
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sel = m[1].trim();
    const decls = declsOf(m[2]);
    if (/(^|,)\s*:root\s*$/.test(sel)) {
      for (const [k, v] of Object.entries(decls)) if (k.startsWith('--')) vars[k] = v;
      continue;
    }
    for (const one of sel.split(',')) {
      const cls = /^\.([\w-]+)$/.exec(one.trim())?.[1];
      if (!cls) continue;
      byClass.set(cls, { ...(byClass.get(cls) || {}), ...decls });
    }
  }
  return { byClass, vars };
}

// ---------------------------------------------------------------- HTML

/** 只要父子关系 + class + inline style + 文字长度，所以用标签栈扫一遍就够（没有 HTML 解析器依赖）。 */
function parseEls(html: string): El[] {
  const els: El[] = [];
  const stack: number[] = [];
  let slot = 0;
  let last = 0;
  for (const m of html.matchAll(/<(\/?)([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>])*)>/g)) {
    const at = m.index ?? 0;
    const between = html.slice(last, at).replace(/\s+/g, ' ').trim();
    if (between && stack.length) els[stack[stack.length - 1]].text += between;
    last = at + m[0].length;
    const name = m[2].toLowerCase();
    if (m[1]) {
      // 闭合：栈里从上往下找同名的（模型写的 html 偶尔缺一个闭合标签）
      for (let i = stack.length - 1; i >= 0; i--) {
        if (els[stack[i]].name === name) {
          stack.length = i;
          break;
        }
      }
      continue;
    }
    const attrs = m[3];
    const isSlot = /\sdata-img-prompt\s*=/.test(attrs);
    els.push({
      name,
      classes: (attrs.match(/\sclass\s*=\s*"([^"]*)"/)?.[1] || '').trim().split(/\s+/).filter(Boolean),
      style: declsOf(attrs.match(/\sstyle\s*=\s*"([^"]*)"/)?.[1] || ''),
      parent: stack.length ? stack[stack.length - 1] : -1,
      text: '',
      slot: isSlot ? ++slot : 0,
    });
    if (!VOID_TAGS.has(name) && !/\/\s*$/.test(attrs)) stack.push(els.length - 1);
  }
  return els;
}

// ---------------------------------------------------------------- 长度

/** `140px` / `44%` / `var(--pad-x)` / `calc(var(--pad-x) + 220px)` → px。算不出来回 null。 */
function len(value: string | undefined, base: number, vars: Record<string, string>, depth = 0): number | null {
  if (!value || depth > 4) return null;
  const v = value.trim();
  if (/^-?[\d.]+px$/.test(v)) return parseFloat(v);
  if (/^-?[\d.]+%$/.test(v)) return (parseFloat(v) / 100) * base;
  if (v === '0') return 0;
  const varName = /^var\(\s*(--[\w-]+)\s*(?:,([^)]*))?\)$/.exec(v);
  if (varName) return len(vars[varName[1]] ?? varName[2], base, vars, depth + 1);
  const calc = /^calc\(([\s\S]*)\)$/.exec(v);
  if (calc) {
    // 只认加减（库里就这两种）。乘除出现的时候宁可算不出来，也不要算错一个位置。
    const parts = calc[1].split(/\s(\+|-)\s/);
    let sum = len(parts[0], base, vars, depth + 1);
    for (let i = 1; i < parts.length && sum !== null; i += 2) {
      const term = len(parts[i + 1], base, vars, depth + 1);
      if (term === null) return null;
      sum += parts[i] === '-' ? -term : term;
    }
    return sum;
  }
  return null;
}

/** `padding:0 12%` → 四边（写不出来的那一边算 0）。 */
function padding(style: Record<string, string>, box: Box, vars: Record<string, string>): Box {
  const sh = style.padding?.trim().split(/\s+/) ?? [];
  const pick = (i: number, fallbackIdx: number) => sh[i] ?? sh[fallbackIdx] ?? sh[0];
  const top = len(style['padding-top'] ?? pick(0, 0), box.h, vars) ?? 0;
  const right = len(style['padding-right'] ?? pick(1, 0), box.w, vars) ?? 0;
  const bottom = len(style['padding-bottom'] ?? pick(2, 0), box.h, vars) ?? 0;
  const left = len(style['padding-left'] ?? pick(3, 1), box.w, vars) ?? 0;
  return { x: box.x + left, y: box.y + top, w: Math.max(0, box.w - left - right), h: Math.max(0, box.h - top - bottom) };
}

// ---------------------------------------------------------------- 盒子

class Geometry {
  private boxes = new Map<number, Box | null>();

  constructor(private els: El[], private sheet: Sheet) {}

  style(i: number): Record<string, string> {
    const el = this.els[i];
    let out: Record<string, string> = {};
    for (const c of el.classes) out = { ...out, ...(this.sheet.byClass.get(c) || {}) };
    return { ...out, ...el.style };
  }

  /** 这一块在页面坐标系里的位置。算不出来回 null（调用方必须当「不知道」处理，不许兜个默认值）。 */
  box(i: number): Box | null {
    if (this.boxes.has(i)) return this.boxes.get(i)!;
    this.boxes.set(i, null); // 防环
    const s = this.style(i);
    const pos = (s.position || '').toLowerCase();
    if (pos !== 'absolute' && pos !== 'fixed') return null;
    const cb = this.containerBox(i);
    if (!cb) return null;
    const vars = this.sheet.vars;
    const inset = s.inset?.trim();
    const insetAll = inset === '0' || inset === '0px';
    const l = insetAll ? 0 : len(s.left, cb.w, vars);
    const r = insetAll ? 0 : len(s.right, cb.w, vars);
    const t = insetAll ? 0 : len(s.top, cb.h, vars);
    const b = insetAll ? 0 : len(s.bottom, cb.h, vars);
    const wDecl = len(s.width, cb.w, vars) ?? len(s['max-width'], cb.w, vars);
    const hDecl = len(s.height, cb.h, vars) ?? len(s['max-height'], cb.h, vars);

    // 横向：两边锚死 → 拉伸；只锚一边 + 有宽度 → 用宽度；只锚一边没宽度 → 按 UNKNOWN_EXTENT 往里算。
    let x: number;
    let w: number;
    let xStretched = false;
    if (l !== null && r !== null) {
      x = cb.x + l;
      w = cb.w - l - r;
      xStretched = true;
      // **两边都锚死、同时又写了 `width` 时，宽度赢**（CSS 的 over-constrained 规则：left + width
      // 生效，right 被忽略）。库里最常见的就是这一种：`.slide-inner{inset:0}` 上加一句
      // `style="width:54%"`，那是分屏页那半边文字。按「拉伸到整页」算的话它压住的是整幅宽度 ——
      // 于是留白那一句退成「中间那一条」或者干脆报不出区间，而真正空着的右边 46% 一个字都没提到，
      // 模型只好把主体摊满整幅（回来的图是一片没有主角的氛围底，一处不报错）。
      if (wDecl !== null && wDecl < w) {
        w = wDecl;
        xStretched = false;
      }
    } else if (l !== null) {
      x = cb.x + l;
      w = wDecl ?? cb.w * UNKNOWN_EXTENT;
    } else if (r !== null) {
      w = wDecl ?? cb.w * UNKNOWN_EXTENT;
      x = cb.x + cb.w - r - w;
    } else return null;

    let y: number;
    let h: number;
    let yStretched = false;
    if (t !== null && b !== null) {
      y = cb.y + t;
      h = cb.h - t - b;
      yStretched = true;
      // 同上：`top` + `height` 赢，`bottom` 被忽略。
      if (hDecl !== null && hDecl < h) {
        h = hDecl;
        yStretched = false;
      }
    } else if (t !== null) {
      y = cb.y + t;
      h = hDecl ?? cb.h * UNKNOWN_EXTENT;
      // `top:50%` + `translateY(-50%)`：竖向居中，量不出高度就当它占中间那一段
      if (/translatey\(\s*-50%/i.test(s.transform || '')) {
        y = cb.y + cb.h / 2 - h / 2;
      }
    } else if (b !== null) {
      h = hDecl ?? cb.h * UNKNOWN_EXTENT;
      y = cb.y + cb.h - b - h;
    } else return null;

    let box = padding(s, { x, y, w: Math.max(0, w), h: Math.max(0, h) }, vars);
    box = this.centerShrink(box, s, xStretched, yStretched);
    box = this.clip(box, s, cb);
    this.boxes.set(i, box);
    return box;
  }

  /**
   * 拉伸的那根轴上如果是居中对齐，内容只占中间 `CENTER_KEEP`。
   *
   * 这一步是「文字压在图正中间」（L13 那种封面）和「整幅都被压住」的分界：不做的话
   * `inset:0` 的居中文字块量出来是整页，每一张全幅底图都会被判成「没有一块干净的地方」，
   * 于是所有封面图都退成「只要质感、不要主体」—— 出来的图都对，但都没有主体。
   */
  private centerShrink(box: Box, s: Record<string, string>, xStretched: boolean, yStretched: boolean): Box {
    if ((s.display || '').indexOf('flex') < 0) return box;
    const column = /column/.test(s['flex-direction'] || '');
    const mainCenter = /center/.test(s['justify-content'] || '');
    const crossCenter = /center/.test(s['align-items'] || '');
    const shrinkX = column ? crossCenter : mainCenter;
    const shrinkY = column ? mainCenter : crossCenter;
    let out = box;
    if (shrinkX && xStretched) out = { ...out, x: out.x + (out.w * (1 - CENTER_KEEP)) / 2, w: out.w * CENTER_KEEP };
    if (shrinkY && yStretched) out = { ...out, y: out.y + (out.h * (1 - CENTER_KEEP)) / 2, h: out.h * CENTER_KEEP };
    return out;
  }

  /**
   * `clip-path:polygon(...)` 把图裁掉一块（L40 那种斜切）—— 取多边形的包围盒。
   *
   * 不算这一刀的话，斜切版式的提示词会说「左边被文字压住、主体放右边」，而左边那半在页面上
   * 压根不显示：模型让开的是一块看不见的地方，图看起来只是「主体太靠边」。
   */
  private clip(box: Box, s: Record<string, string>, cb: Box): Box {
    const poly = /polygon\(([^)]*)\)/.exec(s['clip-path'] || '');
    if (!poly) return box;
    const xs: number[] = [];
    const ys: number[] = [];
    for (const pair of poly[1].split(',')) {
      const [px, py] = pair.trim().split(/\s+/);
      const rx = len(px, box.w, this.sheet.vars);
      const ry = len(py, box.h, this.sheet.vars);
      if (rx === null || ry === null) return box; // 算不出来就不裁（宁可少一刀，别裁错）
      xs.push(rx);
      ys.push(ry);
    }
    if (!xs.length) return box;
    void cb;
    const x0 = Math.max(0, Math.min(...xs));
    const x1 = Math.min(box.w, Math.max(...xs));
    const y0 = Math.max(0, Math.min(...ys));
    const y1 = Math.min(box.h, Math.max(...ys));
    return { x: box.x + x0, y: box.y + y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
  }

  /** 最近一个定位祖先的盒子；一个都没有就是整页（`.slide` 自己是 `inset:0`）。 */
  private containerBox(i: number): Box | null {
    for (let p = this.els[i].parent; p >= 0; p = this.els[p].parent) {
      const pos = (this.style(p).position || '').toLowerCase();
      if (pos === 'absolute' || pos === 'relative' || pos === 'fixed') {
        const b = this.box(p);
        return b;
      }
    }
    return PAGE;
  }

  isAncestor(a: number, of: number): boolean {
    for (let p = this.els[of].parent; p >= 0; p = this.els[p].parent) if (p === a) return true;
    return false;
  }

  /** 这一块（含子孙）里的文字长度。 */
  textLen(i: number): number {
    let n = this.els[i].text.length;
    for (let j = 0; j < this.els.length; j++) if (this.isAncestor(i, j)) n += this.els[j].text.length;
    return n;
  }
}

// ---------------------------------------------------------------- 判定

function overlap(a: Box, b: Box): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/** 把图分成 3×3，量每一条竖带 / 横带被文字盖掉多少。 */
function bands(img: Box, texts: Box[]): { cols: number[]; rows: number[]; area: number } {
  const cols = [0, 0, 0];
  const rows = [0, 0, 0];
  let area = 0;
  const cw = img.w / 3;
  const ch = img.h / 3;
  for (let c = 0; c < 3; c++) {
    for (let r = 0; r < 3; r++) {
      const cell = { x: img.x + c * cw, y: img.y + r * ch, w: cw, h: ch };
      // 文字块之间可能重叠，取「最大那一块的覆盖」而不是相加（相加会超过 1）
      let cover = 0;
      for (const t of texts) cover = Math.max(cover, overlap(cell, t) / (cw * ch));
      cols[c] += cover / 3;
      rows[r] += cover / 3;
      area += cover / 9;
    }
  }
  return { cols, rows, area };
}

/** 沿一根轴把图切成 100 条，量每一条被文字盖掉多少（0–1）。 */
function coverProfile(img: Box, texts: Box[], axis: 'x' | 'y'): number[] {
  const out: number[] = [];
  const step = (axis === 'x' ? img.w : img.h) / PROFILE_STEPS;
  for (let i = 0; i < PROFILE_STEPS; i++) {
    const cell =
      axis === 'x'
        ? { x: img.x + i * step, y: img.y, w: step, h: img.h }
        : { x: img.x, y: img.y + i * step, w: img.w, h: step };
    let cover = 0;
    // 同上：取「最大那一块的覆盖」，相加会超过 1
    for (const t of texts) cover = Math.max(cover, overlap(cell, t) / (cell.w * cell.h));
    out.push(cover);
  }
  return out;
}

/**
 * 从 `from` 那一头扫进来，**离那一头最近的那一簇忙带**的另一端在第几条（一条忙的都没有回 null）。
 *
 * 要「簇」而不是「最后一条忙带」：一页上除了那一栏正文，还有页眉页脚、角上的页码 ——
 * 直接取最外侧的忙带的话，左栏文字 + 右下角一个页码会算出「左边 0–95% 都被压住」，
 * 于是整张图退成一片没有主体的质感底（图本身完全正常）。
 */
function clusterEdge(prof: number[], from: 'start' | 'end'): number | null {
  let last: number | null = null;
  let gap = 0;
  for (let n = 0; n < prof.length; n++) {
    const i = from === 'start' ? n : prof.length - 1 - n;
    if (prof[i] >= BUSY_STEP) {
      last = i;
      gap = 0;
      continue;
    }
    if (last !== null && ++gap >= CLUSTER_GAP) break;
  }
  return last;
}

/**
 * 我们准备说「这一段空着」的那一段里，**一条忙带都不许有**。
 *
 * 这是整个区间的刹车：`clusterEdge` 只看离那一头最近的那一簇，而一页上常有两簇
 * （左边一栏正文 + 中间一个大数字）。不核这一步的话报出去的是「主体整个放进右边 15–100%」，
 * 而 40–90% 那一段正压着另一栏字 —— 模型会老老实实把主体放进那块，回来的图构图很正常，
 * 只是主体正好在文字底下（页面照旧渲染正常，一处不报错）。核不过就一个数都不报，退回方位词。
 *
 * 阈值用 `BUSY_STEP` 就够：一条带跨的是整条轴，角上的页码 / 页眉那几个字压根压不满它。
 */
function isClean(prof: number[], from: number, to: number): boolean {
  for (let i = Math.max(0, Math.round(from)); i < Math.min(prof.length, Math.round(to)); i++) {
    if (prof[i] >= BUSY_STEP) return false;
  }
  return true;
}

/**
 * 报出去的数一律取 5 的整数倍（54.7% 那种精度是假的，几何本身还有 `UNKNOWN_EXTENT` 在兜），
 * 而且**一律往「文字那一侧」取整** —— 压住的那一段只许说大，空地只许说小。
 *
 * 四舍五入的话 47 会变成 45，而第 45、46 条带其实还压着字：`isClean` 当场判不干净，于是
 * 这一格一个数都不报（退回方位词）—— 症状是「这功能好像只在个别页生效」，而它本来是算对了的。
 */
const ceil5 = (n: number): number => Math.ceil(n / 5) * 5;
const floor5 = (n: number): number => Math.floor(n / 5) * 5;

/**
 * 这一路的分界落在百分之几（沿那根轴、从左/上数）。报不准就回 null（照旧只说方位）。
 *
 * `nearEdge` = 贴着起点那一簇的另一端；`farEdge` = 贴着终点那一簇的这一端。
 * 靠边一侧被压住时（left/top、right/bottom）只有一个分界；center/middle 是中间那一簇的两端；
 * sides 是中间那块空地的两端。
 */
function edgesOf(where: SpaceWhere, img: Box, texts: Box[]): number[] | null {
  if (where === 'most') return null;
  const axis: 'x' | 'y' = where === 'left' || where === 'right' || where === 'sides' || where === 'center' ? 'x' : 'y';
  const prof = coverProfile(img, texts, axis);
  const fromStart = clusterEdge(prof, 'start');
  const fromEnd = clusterEdge(prof, 'end');
  if (fromStart === null || fromEnd === null) return null;
  const nearEdge = ceil5(fromStart + 1);
  const farEdge = floor5(fromEnd);
  // `PROFILE_STEPS` = 100，所以下标就是百分比（改那个常量的话这里要跟着换算）。
  const ok = (n: number) => n >= SPAN_MIN && n <= SPAN_MAX;
  switch (where) {
    case 'left':
    case 'top':
      return ok(nearEdge) && 100 - nearEdge >= FREE_MIN && isClean(prof, nearEdge, 100) ? [nearEdge] : null;
    case 'right':
    case 'bottom':
      return ok(farEdge) && farEdge >= FREE_MIN && isClean(prof, 0, farEdge) ? [farEdge] : null;
    case 'center':
    case 'middle':
      // 压在正中：两边各要留得下东西，而且那两块真的是空的
      return ok(farEdge) &&
        ok(nearEdge) &&
        farEdge >= FREE_MIN &&
        100 - nearEdge >= FREE_MIN &&
        nearEdge > farEdge &&
        isClean(prof, 0, farEdge) &&
        isClean(prof, nearEdge, 100)
        ? [farEdge, nearEdge]
        : null;
    default:
      // sides：中间那块空地（左簇的右沿 → 右簇的左沿）要够宽、而且真的是空的
      return ok(nearEdge) && ok(farEdge) && farEdge - nearEdge >= FREE_MIN && isClean(prof, nearEdge, farEdge)
        ? [nearEdge, farEdge]
        : null;
  }
}

/**
 * 带上真区间的那一句（算不出区间时回 null，由 `phrase` 退回只说方位的那一版）。
 *
 * 两版都留着、不做成一版：区间算不准的时候（几何量不全、页眉页脚把整条轴铺满）宁可少说一个数，
 * 也不能把一个编出来的数发给模型 —— 它会老老实实照那个数让开，而主体被挤到画面边上，
 * 回来的图只是「构图有点怪」，一处都不报错（文件头 ②）。
 */
function spanPhrase(where: SpaceWhere, pct: number, e: number[]): { prompt: string; cn: string } | null {
  const h = `文字盖掉约 ${pct}%`;
  switch (where) {
    case 'left':
      return {
        prompt: `留白：从画面左边数，0–${e[0]}% 这一条会被页面文字压住 —— 那一块要安静、近乎空白，唯一的主体整个放进右边 ${e[0]}–100% 那一块里。`,
        cn: `左边 0–${e[0]}% 被文字压住（主体放右边 ${e[0]}–100%），${h}`,
      };
    case 'right':
      return {
        prompt: `留白：从画面左边数，${e[0]}–100% 这一条会被页面文字压住 —— 那一块要安静、近乎空白，唯一的主体整个放进左边 0–${e[0]}% 那一块里。`,
        cn: `右边 ${e[0]}–100% 被文字压住（主体放左边 0–${e[0]}%），${h}`,
      };
    case 'sides':
      return {
        prompt: `留白：页面文字顺着左右两条边压下来（左边 0–${e[0]}%、右边 ${e[1]}–100%）—— 两侧都要安静，唯一的主体整个放进中间 ${e[0]}–${e[1]}% 那一块里。`,
        cn: `左右两边（0–${e[0]}% / ${e[1]}–100%）被文字压住（主体放中间），${h}`,
      };
    case 'center':
      return {
        prompt: `留白：从画面左边数，${e[0]}–${e[1]}% 正中这一条会被页面文字压住 —— 那一条要安静、细节要少，把好看的东西推到左右两边（0–${e[0]}% 和 ${e[1]}–100%）和四角。`,
        cn: `正中 ${e[0]}–${e[1]}% 被文字压住（细节推到两边），${h}`,
      };
    case 'top':
      return {
        prompt: `留白：从画面上边数，0–${e[0]}% 这一条会被页面文字压住 —— 那一块要安静（开阔的天空、墙面、薄雾），主体整个放进下面 ${e[0]}–100% 那一块里。`,
        cn: `上面 0–${e[0]}% 被文字压住（主体放下面 ${e[0]}–100%），${h}`,
      };
    case 'bottom':
      return {
        prompt: `留白：从画面上边数，${e[0]}–100% 这一条会被页面文字压住 —— 那一块要安静，主体整个放进上面 0–${e[0]}% 那一块里。`,
        cn: `下面 ${e[0]}–100% 被文字压住（主体放上面 0–${e[0]}%），${h}`,
      };
    case 'middle':
      return {
        prompt: `留白：页面文字横穿画面中间 ${e[0]}–${e[1]}% 那一条 —— 那一条要安静，把好看的东西放到上面 0–${e[0]}% 和下面 ${e[1]}–100%。`,
        cn: `中间 ${e[0]}–${e[1]}% 被文字压住（细节放上下），${h}`,
      };
    default:
      return null;
  }
}

function phrase(where: SpaceWhere, pct: number): { prompt: string; cn: string } {
  switch (where) {
    case 'left':
      return {
        prompt: `留白：画面左侧会被页面文字压住 —— 那一侧要安静、近乎空白，主体放在右边那一块。`,
        cn: `左侧被文字压住（主体放右侧），文字盖掉约 ${pct}%`,
      };
    case 'right':
      return {
        prompt: `留白：画面右侧会被页面文字压住 —— 那一侧要安静、近乎空白，主体放在左边那一块。`,
        cn: `右侧被文字压住（主体放左侧），文字盖掉约 ${pct}%`,
      };
    case 'sides':
      return {
        prompt: `留白：页面文字顺着左右两条边都压下来 —— 两侧都要安静，唯一的主体放在中间那三分之一里。`,
        cn: `左右两侧都被文字压住（主体放中间），文字盖掉约 ${pct}%`,
      };
    case 'center':
      return {
        prompt: `留白：页面文字压在画面正中 —— 正中要安静、细节要少，把好看的东西推到四周和四角。`,
        cn: `画面正中被文字压住（细节推到四周），文字盖掉约 ${pct}%`,
      };
    case 'top':
      return {
        prompt: `留白：画面上半部分会被页面文字压住 —— 那一块要安静（开阔的天空、墙面、薄雾），主体放在下半部分。`,
        cn: `上部被文字压住（主体放下部），文字盖掉约 ${pct}%`,
      };
    case 'bottom':
      return {
        prompt: `留白：画面下半部分会被页面文字压住 —— 那一块要安静，主体放在上半部分。`,
        cn: `下部被文字压住（主体放上部），文字盖掉约 ${pct}%`,
      };
    case 'middle':
      return {
        prompt: `留白：页面文字横穿画面中间那一条 —— 那一条要安静，把好看的东西放在靠上和靠下的边上。`,
        cn: `中间横带被文字压住（细节放上下），文字盖掉约 ${pct}%`,
      };
    default:
      return {
        prompt: `留白：页面文字几乎盖满整幅 —— 不要单一的视觉焦点，给一片均匀低反差的质感或氛围，压上文字之后仍然读得清。`,
        cn: `整幅都被文字压住（只要质感、不要主体），文字盖掉约 ${pct}%`,
      };
  }
}

/** 空地是一整块的那四路（另外三路把空地切成两截，主体只能塞进其中一条窄带）。 */
const CONTIGUOUS: SpaceWhere[] = ['left', 'right', 'top', 'bottom'];

function colWhere(busy: number[]): SpaceWhere {
  if (busy.length === 1) return busy[0] === 0 ? 'left' : busy[0] === 2 ? 'right' : 'center';
  return busy.includes(0) && busy.includes(2) ? 'sides' : busy.includes(0) ? 'left' : 'right';
}

function rowWhere(busy: number[]): SpaceWhere {
  if (busy.length === 1) return busy[0] === 0 ? 'top' : busy[0] === 2 ? 'bottom' : 'middle';
  return busy.includes(0) && busy.includes(2) ? 'most' : busy.includes(0) ? 'top' : 'bottom';
}

function classify(img: Box, texts: Box[]): SpaceHint | null {
  const { cols, rows, area } = bands(img, texts);
  if (area < 0.06) return null; // 文字压根不在图上（图在自己的面板里）—— 这种不需要留白指示
  const busyCols = cols.map((v, i) => (v >= BUSY_BAND ? i : -1)).filter((i) => i >= 0);
  const busyRows = rows.map((v, i) => (v >= BUSY_BAND ? i : -1)).filter((i) => i >= 0);
  const pct = Math.round(area * 100);
  const byCol = busyCols.length > 0 && busyCols.length < 3;
  const byRow = busyRows.length > 0 && busyRows.length < 3;
  if (!byCol && !byRow && busyCols.length === 0 && busyRows.length === 0) {
    // 有重叠但没有一条带算得上「忙」（角上一个小标签之类）—— 不值得说
    return null;
  }
  const cw = byCol ? colWhere(busyCols) : null;
  const rw = byRow ? rowWhere(busyRows) : null;
  let where: SpaceWhere = 'most';
  if (cw && rw) {
    // **两根轴都判得出来时，挑「空地是一整块」的那一根**（left/right/top/bottom），
    // 而不是忙带更少的那一根。左边一栏竖排文字（54% 宽、竖向居中）在两根轴上都成立：
    // 竖着看是「左边被压住、主体放右边那一整块」，横着看是「中间那一条被压住、好东西放上下」——
    // 后者把主体切成上下两条窄带，回来的图是一片没有主角的氛围底（每张单看都不错，一处不报错），
    // 而这一格要的正是一个主体。两根都是一整块（或都不是）时才退回原来那条「忙带更少的赢」。
    const cContig = CONTIGUOUS.includes(cw);
    const rContig = CONTIGUOUS.includes(rw);
    where = cContig !== rContig ? (cContig ? cw : rw) : busyCols.length <= busyRows.length ? cw : rw;
  } else if (cw) where = cw;
  else if (rw) where = rw;
  // 能量出真区间就报真区间（「左边 0–55%」），量不准才退回只说方位的那一句。
  const e = edgesOf(where, img, texts);
  const span = e ? spanPhrase(where, pct, e) : null;
  return { where, pct, ...(span || phrase(where, pct)) };
}

/**
 * 图那一格的盒子：`<img>` 自己一般是 `width:100%;height:100%`（`.lNN-bg img` 这种后代选择器，
 * 我们不收），所以往上找**第一个自己不带文字的定位祖先** —— 那就是它被 `object-fit:cover`
 * 填满的那一块。
 *
 * 「祖先自己不带文字」这条是刹车：不加的话人物卡里那张 3:4 的照片会一路找到 `.slide-inner`
 * （`inset:0`），于是一格面板照片被当成整页底图，页面上所有文字都算成压在它上面 ——
 * 出来的提示是「整幅都被文字压住、不要主体」，而那一格要的正是一个人的正脸。
 */
function slotBox(geo: Geometry, els: El[], i: number): Box | null {
  const own = geo.box(i);
  if (own) return own;
  let p = els[i].parent;
  for (let up = 0; p >= 0 && up < 3; up++, p = els[p].parent) {
    if (geo.textLen(p) >= 3) return null;
    const b = geo.box(p);
    if (b) return b;
  }
  return null;
}

/** 模板表解析一次就缓存（热更新靠 `libraryVersion()`）—— 一次变形要问十来个类名的底色。 */
let sheetCache: { stamp: number; sheet: Sheet } | null = null;

function sheetOf(css?: string): Sheet {
  if (css !== undefined) return parseSheet(css);
  const stamp = libraryVersion();
  if (!sheetCache || sheetCache.stamp !== stamp) sheetCache = { stamp, sheet: parseSheet(library().template) };
  return sheetCache.sheet;
}

/**
 * 模板表里这个类名的那几条声明（`.foo{}` 里的原文，表里没有这个类名回 null）。
 *
 * 给「把这一页的图换成整页背景图」用（`imageModes.ts`）：背景图铺在 `.case-bg` 那一层
 * （`z-index:0`），压在它上面的那几层容器只要有一层是实底，**图整片看不见而页面渲染完全正常**
 * —— 一次真实花费换来一张谁也看不到的图；反过来某一层不是定位元素的话，那一层的文字会被
 * 背景图盖住（画面上是「这一页只剩一张图」）。两件事都必须**从这份表里读出来**再决定，
 * 在 `imageModes` 里另写一份正则扫 CSS 的话，哪天骨架里的写法变了（`background-color` 换成
 * `background`、`position` 挪进另一条选择器）那边扫不到就判成「没刷底 / 是定位元素」，
 * 于是那一页照旧生成一张被挡住的图。
 */
export function classDecls(cls: string, css?: string): Record<string, string> | null {
  return sheetOf(css).byClass.get(cls) ?? null;
}

/**
 * 一页 html 里每一格图的留白提示（key = 第几格，和 `findImageSlots` 的 index 一致）。
 *
 * 算不出来的格子**不在返回值里**（不是给个默认句）—— 见文件头 ②。
 */
/**
 * **HTML 还没生成**时这一条版式第 `slot` 格的留白提示（用这条版式的 demo 片段量几何）。
 *
 * 「先备图」那条路（`generateSpecImage`）只有 layoutId、没有 html，不走这一条的话同一句 subject
 * 在两条路上生出来的构图不是一回事：先备的那张主体居中（没有留白指示），配图那条路的主体会
 * 让开文字那一侧 —— 两张图单看都不错，贴进同一个槽位时只有先备的那张被标题压着，而一处都不报错。
 *
 * 认不出的 layoutId / 没有 demo 片段的版式回 null（照旧「算不出来就不说话」，见文件头 ②）。
 */
export function spaceHintForLayout(layoutId?: string, slot = 1): SpaceHint | null {
  const key = (layoutId || '').trim().toUpperCase();
  if (!key) return null;
  let frag: string | undefined;
  try {
    frag = demoFragments().get(key);
  } catch {
    // demo 片段整份读不出来时不要把备图也带崩（那边是一次真实花费，而这里只是一句提示）。
    return null;
  }
  if (!frag) return null;
  return computeSpaceHints(frag).get(slot) ?? null;
}

export function computeSpaceHints(html: string, css?: string): Map<number, SpaceHint> {
  const sheet = sheetOf(css);
  const els = parseEls(html);
  const geo = new Geometry(els, sheet);
  const out = new Map<number, SpaceHint>();
  const slots = els.map((e, i) => ({ i, slot: e.slot })).filter((s) => s.slot > 0);
  // demo 片段里没有 `data-img-prompt`（那是生成阶段模型写上去的），所以退一步认图元素本身 ——
  // 「按 layoutId 预先算这一条版式的留白」走的就是这条（见 `spaceHintForLayout`）。
  const targets = slots.length
    ? slots
    : els
        .map((e, i) => ({ i, e }))
        .filter(({ e }) => e.name === 'img' || /url\(/i.test(e.style['background-image'] || e.style.background || ''))
        .map(({ i }, n) => ({ i, slot: n + 1 }));
  for (const { i, slot } of targets) {
    const img = slotBox(geo, els, i);
    if (!img || img.w < 40 || img.h < 40) continue;
    // 候选文字块：自己带文字、量得出盒子、而且**不是图的祖先**（那一层套着整页所有文字，
    // 收进来的话每一页都会被判成「整幅都被压住」）。
    const cand = els
      .map((_, j) => j)
      .filter((j) => j !== i && !geo.isAncestor(i, j) && !geo.isAncestor(j, i) && geo.textLen(j) >= 3 && geo.box(j));
    // 外层收了就不再收里层（同一段文字算两遍会把覆盖率推高，一路推成 'most'）
    const texts = cand.filter((j) => !cand.some((k) => k !== j && geo.isAncestor(k, j))).map((j) => geo.box(j)!);
    const hint = classify(img, texts);
    if (hint) out.set(slot, hint);
  }
  return out;
}
