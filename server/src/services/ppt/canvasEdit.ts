/**
 * 空白页画布上的摆放操作（加一个文字框 / 拖动缩放 / 删掉一块）。**不调 AI、不花额度。**
 *
 * 为什么不并进 `applyStyleEdit`（那条已经在改 inline style 了）：那条接口每一页都能调，
 * 而这里写的是 `position:absolute` + `left/top/width/height` —— 落在一页普通版式上的话，
 * 那个元素当场从 flex 项变成脱离文档流的绝对定位块，整页重排。接口 200、那一块本身
 * 摆在他指的位置上，而**同一行里别的块**会跟着塌/挤，翻起来只是「这一页设计得有点怪」。
 * 所以几何操作走这一条独立的路，而且**必须先确认这一页有 `.bl-canvas`**（见 `canvasRange`）。
 *
 * 画布元素的形状是固定的、只由这里生成：
 *   `<div class="bl-el bl-text" data-bel="b1" data-eid="t1" style="left:..px;top:..px;width:..px;height:..px">字</div>`
 * 两个编号各有各的用处，**都得有**：
 * - `data-bel` 是这里定位用的（拖动/缩放/删）；
 * - `data-eid` 是**已有那套**「双击改字 / 改字色字号字重」用的。空白页永远不经过
 *   `injectEids`（它只在生成那一步跑，而空白页压根不生成），所以 eid 必须在这里当场写上 ——
 *   不写的话浮动条上那几个按钮对着画布上的文字全都「点了没反应」，而这一页显示得好好的。
 *
 * 元素里**不许再套 `<div>`**（图是 `<div class="bl-el bl-img"><img></div>`，图本身不是 div）：
 * 删和改都按「开标签 → 第一个 `</div>`」收尾，套了的话删一块会把它后面的兄弟一起带走。
 */
import { PageEditError, maxEidNumber, parseStyle, writeStyle } from './pageEdit.js';

/** 设计稿坐标系（`#stage` 是 1920×1080 的固定尺寸，骨架里也一律写 px）。 */
export const CANVAS_W = 1920;
export const CANVAS_H = 1080;

/** 一块最小 40px：再小的话拖手柄自己就比它大，按下去必定是缩放、永远拖不动它，
 *  而它在画布上看起来只是「一个很小的块」。 */
const MIN_BOX = 40;

/** 一页画布最多摆这么多块。上限拦的是 html 无限长（存得下、渲染得动，但预览和导出会越来越卡）。 */
const MAX_ELS = 60;

/** 新加的文字框默认那句话。**不留空** —— 空的块在画布上是看不见的，他会以为「加」这个按钮没反应。 */
export const DEFAULT_TEXT = '双击改这段字';

/** 新块的默认落点：每加一块往右下挪一格，加满 6 块回到起点。完全重叠的话第二块把第一块
 *  盖得严严实实，界面上就是「点了加，什么都没多出来」。 */
const STEP = 48;
const BOX_W = 560;
const BOX_H = 120;
/** 新放进来的图有多宽（高度按这张图自己的比例算 —— 见 `addCanvasImage`）。 */
const IMG_W = 720;

/** `.bl-canvas` 那一层在 html 里的范围（开标签结束位置 / 内容结束位置）。 */
function canvasRange(html: string): { inner: number; end: number } {
  const at = html.search(/<div[^>]*class="[^"]*\bbl-canvas\b[^"]*"[^>]*>/i);
  if (at < 0) {
    // 这里是那道承重的拦：普通版式页没有这一层。放行的话会往那一页写绝对定位的块，
    // 整行跟着重排，而接口 200、页面照样渲染（见文件头）。
    throw new PageEditError(
      '这一页不是空白页 —— 只有「插一页空白页」建出来的那种页能自己摆文字和图。' +
        '往普通版式页上摆的话那一块会脱离原来的排版，同一行里别的内容会跟着塌，而页面照样渲染。这次没动。'
    );
  }
  const openEnd = at + /<div[^>]*>/i.exec(html.slice(at))![0].length;
  // 深度数到配对的那个 `</div>`：直接找最后一个 `</div>` 的话，将来 `<section>` 里多一层
  // 包裹（页眉、蒙版）就会把新块插到画布外面 —— 它在画布之外照样显示，只是不受这里的
  // 坐标系管，拖一下就跳位。
  let depth = 1;
  const re = /<\/?div\b[^>]*>/gi;
  re.lastIndex = openEnd;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    depth += m[0].startsWith('</') ? -1 : 1;
    if (depth === 0) return { inner: openEnd, end: m.index };
  }
  throw new PageEditError('这一页的画布标签没闭合（html 坏了）。这次没动，重新插一页空白页吧。');
}

/** 画布上现有的每一块（按 html 顺序）。 */
function elements(html: string): { bel: string; start: number; attrsFrom: number; gt: number; end: number }[] {
  const { inner, end } = canvasRange(html);
  const body = html.slice(inner, end);
  const out: { bel: string; start: number; attrsFrom: number; gt: number; end: number }[] = [];
  const re = /<div\b([^>]*)>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    const bel = /data-bel="([^"]+)"/i.exec(m[1] || '')?.[1];
    if (!bel) continue;
    const close = body.indexOf('</div>', re.lastIndex);
    if (close < 0) break;
    out.push({
      bel,
      start: inner + m.index,
      attrsFrom: inner + m.index + '<div'.length,
      gt: inner + m.index + m[0].length - 1,
      end: inner + close + '</div>'.length,
    });
  }
  return out;
}

function findEl(html: string, bel: string) {
  const el = elements(html).find((e) => e.bel === bel);
  if (!el) {
    // 静默忽略的话：iframe 里那一块已经跟着鼠标挪到新位置了，接口 200，而库里还是旧坐标 ——
    // 下一次刷新它自己跳回去，看起来像「拖动有时候不保存」。
    throw new PageEditError(
      `这一页画布上找不到 ${bel} 那一块 —— 这一页在别处改过（或那一块已经被删了）。这次没动，刷新一下再摆。`
    );
  }
  return el;
}

/** 数字收进画布里。夹回来这件事**在画面上看得见**（那一块自己弹回边上），所以不额外报一句。 */
function clamp(v: unknown, lo: number, hi: number, dflt: number): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return dflt;
  return Math.min(hi, Math.max(lo, n));
}

export interface CanvasBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * 往画布上加一个文字框。返回新块的 `bel` / `eid`（前端拿它接着选中、双击改字）。
 *
 * `eid` 按**整页现有的最大号 +1**（`maxEidNumber`），不按画布上的块数：删过一块之后按块数
 * 算会撞上还在的那一块的编号，于是改这一块的字改到另一块上 —— 两块都是正常的文字，一处都不说。
 */
export function addCanvasText(html: string): { html: string; bel: string; eid: string; box: CanvasBox } {
  const els = elements(html);
  if (els.length >= MAX_ELS) {
    throw new PageEditError(`这一页已经摆了 ${els.length} 块，上限 ${MAX_ELS} 块。这次没加。`);
  }
  const nums = els.map((e) => Number(/^b(\d+)$/.exec(e.bel)?.[1] || 0));
  const bel = `b${Math.max(0, ...nums) + 1}`;
  const eid = `t${maxEidNumber(html) + 1}`;
  const k = els.length % 6;
  const box: CanvasBox = {
    left: 160 + STEP * k,
    top: 200 + STEP * k,
    width: BOX_W,
    height: BOX_H,
  };
  const { end } = canvasRange(html);
  const tag =
    `<div class="bl-el bl-text" data-bel="${bel}" data-eid="${eid}" ` +
    `style="left:${box.left}px;top:${box.top}px;width:${box.width}px;height:${box.height}px">${DEFAULT_TEXT}</div>`;
  return { html: `${html.slice(0, end)}${tag}${html.slice(end)}`, bel, eid, box };
}

/**
 * 往画布上放一张图（**只能是素材库里的那几张** —— url 由调用方从 `getAsset` 取出来，
 * 这条接口不收前端传来的任意地址：收的话他能贴一个外站图进去，导出的那份 html 换台机器
 * 打开是一张裂图/一块白，而这边显示得好好的）。
 *
 * 落点按**这张图自己的比例**摆，不按固定 16:9：`.bl-img img` 是 `object-fit:cover`，比例不对
 * 会**裁掉两边**（图本身没变，只是构图缺了一块）—— 而屏幕上那就是一张摆好的图，一处都不说。
 *
 * **绝对不写 `data-img-prompt`**：图槽位是 `findImageSlots` 按那个属性扫出来的，写上的话
 * 他自己摆的这张会被数成「这一页的第 N 格」，下一次配图/换一批图会把生成的图盖上去 ——
 * 画面上是一页有图的幻灯片，只是图换了，而面板上照旧写着「1/1 张有图」。
 */
export function addCanvasImage(
  html: string,
  asset: { url: string; ratio?: string }
): { html: string; bel: string; box: CanvasBox; ratio: string } {
  const els = elements(html);
  if (els.length >= MAX_ELS) {
    throw new PageEditError(`这一页已经摆了 ${els.length} 块，上限 ${MAX_ELS} 块。这次没加。`);
  }
  const url = String(asset.url || '').trim();
  // 引号/尖括号会把 src 那个属性提前收掉，从那里到标签尾的东西全被浏览器当成属性名 ——
  // 页面照样渲染，只是这一块变成一张裂图（或者整个元素少了 class）。
  if (!url || /["'<>]/.test(url)) {
    throw new PageEditError('这张图的地址不对（空的，或者带引号/尖括号），没加上 —— 换一张再试。');
  }
  const m = /^(\d+)\s*[:：xX×/]\s*(\d+)$/.exec(String(asset.ratio || '').trim());
  const rw = m ? Number(m[1]) : 16;
  const rh = m ? Number(m[2]) : 9;
  const ratio = `${rw}:${rh}`;
  const nums = els.map((e) => Number(/^b(\d+)$/.exec(e.bel)?.[1] || 0));
  const bel = `b${Math.max(0, ...nums) + 1}`;
  const k = els.length % 6;
  const width = Math.min(IMG_W, CANVAS_W - 320);
  const box: CanvasBox = {
    left: 160 + STEP * k,
    top: 200 + STEP * k,
    width,
    height: Math.max(MIN_BOX, Math.round((width * rh) / rw)),
  };
  // 摆不进画布的（竖图太高）整体缩一档，而不是硬夹高度：夹高度的话它当场被裁掉一截，
  // 而屏幕上那就是一张构图不完整的图。
  if (box.top + box.height > CANVAS_H) {
    box.height = CANVAS_H - box.top;
    box.width = Math.max(MIN_BOX, Math.round((box.height * rw) / rh));
  }
  const { end } = canvasRange(html);
  const tag =
    `<div class="bl-el bl-img" data-bel="${bel}" ` +
    `style="left:${box.left}px;top:${box.top}px;width:${box.width}px;height:${box.height}px">` +
    `<img src="${url}" alt=""></div>`;
  return { html: `${html.slice(0, end)}${tag}${html.slice(end)}`, bel, box, ratio };
}

/**
 * 挪一块 / 改一块的大小（拖完鼠标才发一次，拖的过程是 iframe 里本地跟手）。
 *
 * 四个数**一起写**：只写变了的那两个的话，缩放时右下角跟着鼠标而左上角不动这件事要靠
 * 前端算对 —— 算错的时候是「块自己往左上飘了一点」，看起来像手抖。
 */
export function setCanvasBox(
  html: string,
  edit: { bel: string; box: Partial<CanvasBox> }
): { html: string; box: CanvasBox } {
  const el = findEl(html, edit.bel);
  const width = clamp(edit.box.width, MIN_BOX, CANVAS_W, BOX_W);
  const height = clamp(edit.box.height, MIN_BOX, CANVAS_H, BOX_H);
  const box: CanvasBox = {
    left: clamp(edit.box.left, 0, CANVAS_W - width, 0),
    top: clamp(edit.box.top, 0, CANVAS_H - height, 0),
    width,
    height,
  };
  const decls = parseStyle(html.slice(el.attrsFrom, el.gt));
  decls.set('left', `${box.left}px`);
  decls.set('top', `${box.top}px`);
  decls.set('width', `${box.width}px`);
  decls.set('height', `${box.height}px`);
  const attrs = writeStyle(html.slice(el.attrsFrom, el.gt), decls);
  return { html: `${html.slice(0, el.attrsFrom)}${attrs}${html.slice(el.gt)}`, box };
}

/**
 * 删掉画布上的一块。
 *
 * 走这里、不走 `applyDelete`（浮动条上那个 🗑）：那条有一句「删完一个 `data-eid` 都不剩就拒」——
 * 画布上只剩一块文字时它会拒，而理由说的是「重新生成一次才能改文字」，对着空白页完全指错方向。
 * 空白画布**允许删成空的**（本来就是从空的开始摆的）。
 */
export function deleteCanvasEl(html: string, edit: { bel: string }): { html: string } {
  const el = findEl(html, edit.bel);
  return { html: `${html.slice(0, el.start)}${html.slice(el.end)}` };
}
