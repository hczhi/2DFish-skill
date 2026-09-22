// 这一页的图怎么用：**分屏**（图占版式里那一格，库里所有版式的原样）/ **背景图**（那一格的图
// 改成整页铺底 + 一层幕帘，文字压在上面）/ **单图**（整页换成一张把文字印在里面的图，见文件末
// `toPoster`）。三路都是纯代码搬 DOM，**不调 AI、不花一分钱**（真正那张图要他再点一次生成配图）。
//
// 为什么是「就地变形 + 可逆」而不是换版式重生成：换版式要重新生成整页（一次真实调用），而他要的
// 只是「这张图别再切一条硬边」。变形只动 html 那一列（版式、文字、`data-img-prompt` 原样留着），
// **但这一页的图一律清回占位图**（`clearSlotImages`：那张是按上一个模式的构图生的，搬过去就是
// 一页「看起来效果很差」的正常页面）；`images_json` / `pending_images_json` 跟着清由调用方做
// （`api/ppt.ts` 的 image-mode）—— 只清 html 的话面板上那一格挂着缩略图而画面里是占位图。
//
// 四条边界（每一条都是「画面上一切正常」的那种事故）：
// ① **变形后这一页必须还是正好 1 个图槽，而且是第 1 个。** 配图记录（`images_json`）、备好的图
//    回填、面板上「配图 1/1 张」认的都是 `findImageSlots` 数出来的那个序号。原来那个槽位只是
//    「藏起来」而 `data-img-prompt` 还留着的话，这一页变成 2 槽：下一次生成的图贴进看不见的那一格，
//    画面里的背景图从此再也换不掉，而接口 200、缩略图也在。所以原槽位上那两个属性是**摘掉**
//    （原文存进 `data-was-img-*`，改回来时原样放回）。
// ② **图上面压着实底的那几层必须处理掉，处理不了就拒。** 背景图那一层是 `.case-bg`（`z-index:0`，
//    section 的第一个孩子），全幅版式的 `.lNN-wrap{position:absolute;inset:0;background:var(--c-bg)}`
//    正好压在它上面 —— 不改成透明的话那张图**整片看不见**，而页面每一层都渲染正常、一处不报错，
//    等于花钱生了一张谁也看不到的图。浅底（`--c-bg` 那几个）就地改透明；品牌色/深底一律**拒掉**
//    并说出是哪个类名上的哪个值：那种页上的字是 `var(--c-brand-on)`/白色，把底改透明之后白字直接
//    压在照片上读不出来（字确实在那儿，投影时才发现）。
// ③ **幕帘浓度要能调**（`--bg-mask`，骨架里缺省 .80）：照旧 .80 的话那张图在页面上只剩一层几乎
//    看不见的底纹，他会以为「生图失败了」再点一次（每次真扣一次额度）。
// ④ **不是定位元素的那一层也要拒。** 背景图是定位元素（`z-index:0`），非定位的那一层的文字画在
//    它下面 —— 变形之后这一页看起来「只剩一张图」，文字并没有丢，而这一条在库里所有版式上都成立
//    （`.slide-inner` / `.lNN-wrap` 都是 absolute），真出现就是新写的版式破了这个前提。

import { findImageSlots, replaceSlotUrls, MAX_SLOTS_PER_PAGE, type ImageSlot } from './imageService.js';
import { classDecls } from './imageSpace.js';
import { PLACEHOLDERS, stripHeaders } from './pageService.js';
import { POSTER_TEXT_ATTR, encodePosterText, decodePosterText } from './posterText.js';
// 这两个判据和类型挪到了 `pageMarkers.ts`（拼页那一层也要判，而它不能 import 这个文件
// —— 理由见那个文件顶上）。这里照旧往外 export，调用点一个都不用改。
import { pageImageMode, hasDecor, type PageImageMode } from './pageMarkers.js';
import { applyDeckDecor, type DeckDecor } from './deckShell.js';

export { pageImageMode, hasDecor, type PageImageMode };

export class ImageModeError extends Error {}

/**
 * 变形时给这一页写的幕帘浓度（骨架缺省是 .80 —— 那么浓的话图只剩一层底纹，见文件头 ③）。
 *
 * **改这个数要一起改三处**：前端滑块那个兜底值（`PptPlan.vue` 的 `BACKDROP_MASK_DEFAULT`，
 * 不改的话没读到服务端值的那一下滑块写着旧数而页面是新数）、发给生图模型那句「压暗多少」
 * （`library/illustration-style.md` §6 —— 说浓了模型会主动把画面提亮提反差，说淡了它会交一张
 * 灰蒙蒙的均值图，两种都不报错）、`docs/API.md` 里那个缺省值。
 */
export const BACKDROP_MASK = 0.3;

/**
 * 装饰底图那一层的缺省浓度（`--decor-a`）。
 *
 * **改这个数要一起改三处**（同 `BACKDROP_MASK`）：骨架里 `.page-decor` 那条 CSS 的缺省值
 * （不对的话没写过这个变量的老页面和滑块显示的数差一截）、前端滑块的兜底值
 * （`PptPlan.vue` 的 `DECOR_ALPHA_DEFAULT`）、`docs/API.md` 里那个缺省值。
 */
export const DECOR_ALPHA = 0.18;

/** 这几个底色是「页面本来的底」，可以就地改透明；其余（品牌色/强调色/墨色/写死的颜色）一律拒。 */
const NEUTRAL_BG = new Set([
  '',
  'none',
  'transparent',
  '#fff',
  '#ffffff',
  'white',
  'var(--c-bg)',
  'var(--c-bg-alt)',
  'var(--c-card)',
]);

const VOID_TAGS = new Set(['img', 'br', 'hr', 'input', 'source', 'meta', 'link']);

interface OpenTag {
  name: string;
  /** 开标签在 html 里的起点 */
  at: number;
  /** 开标签原文 */
  text: string;
  parent: number;
  classes: string[];
  style: Record<string, string>;
}

function declsOf(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of text.split(';')) {
    const at = part.indexOf(':');
    if (at < 0) continue;
    const k = part.slice(0, at).trim().toLowerCase();
    if (k) out[k] = part.slice(at + 1).trim();
  }
  return out;
}

/**
 * 扫出每个开标签的**位置 + 原文 + 父子关系**（变形要按位置改标签，所以不能用 `imageSpace` 那个
 * 只给结构的扫描）。闭合标签从栈顶往下找同名的 —— 模型写的 html 偶尔缺一个闭合标签，
 * 严格配平的话那一页的祖先链整条错位，而变形出来的 html 照旧能渲染。
 */
function scanTags(html: string): OpenTag[] {
  const els: OpenTag[] = [];
  const stack: number[] = [];
  for (const m of html.matchAll(/<(\/?)([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>])*)>/g)) {
    const name = m[2].toLowerCase();
    if (m[1]) {
      for (let i = stack.length - 1; i >= 0; i--) {
        if (els[stack[i]].name === name) {
          stack.length = i;
          break;
        }
      }
      continue;
    }
    const attrs = m[3];
    els.push({
      name,
      at: m.index ?? 0,
      text: m[0],
      parent: stack.length ? stack[stack.length - 1] : -1,
      classes: (attrs.match(/\sclass\s*=\s*"([^"]*)"/)?.[1] || '').trim().split(/\s+/).filter(Boolean),
      style: declsOf(attrs.match(/\sstyle\s*=\s*"([^"]*)"/)?.[1] || ''),
    });
    if (!VOID_TAGS.has(name) && !/\/\s*$/.test(attrs)) stack.push(els.length - 1);
  }
  return els;
}

// ---------------------------------------------------------------- 改标签

/** 往开标签里塞/改一个属性（自闭合的 `/>` 要留在最后）。 */
function setAttr(tag: string, name: string, value: string): string {
  const re = new RegExp(`\\s${name}="[^"]*"`);
  if (re.test(tag)) return tag.replace(re, ` ${name}="${value}"`);
  return tag.replace(/\s*\/?>$/, (tail) => ` ${name}="${value}"${tail.trimStart() || '>'}`);
}

function dropAttr(tag: string, name: string): string {
  return tag.replace(new RegExp(`\\s${name}="[^"]*"`), '');
}

function attrOf(tag: string, name: string): string | null {
  return tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1] ?? null;
}

/**
 * 往 inline style 里追加几条声明，**并把原来那串存进 `keep` 这个属性里**（改回来时原样放回）。
 *
 * 不存原文、改回来时按属性名撤那几条的话：原来 inline 上就写着同名声明的那一层（比如某一页的
 * `style="background:#fff"`）会被一起撤掉 —— 改回分屏之后那一块的白底没了，而页面照旧渲染正常
 * （白底上少一块白，通常要到换深色配色那天才看出来）。
 */
function addStyle(tag: string, decls: string, keep: string): string {
  const cur = attrOf(tag, 'style');
  const marked = setAttr(tag, keep, cur ?? '');
  return setAttr(marked, 'style', cur ? `${cur.replace(/;\s*$/, '')};${decls}` : decls);
}

/** 把 `addStyle` 存下来的那串原样放回（空串 = 原来压根没有 style，整个属性摘掉）。 */
function restoreStyle(tag: string, keep: string): string {
  const orig = attrOf(tag, keep);
  const cleared = dropAttr(tag, keep);
  return orig ? setAttr(cleared, 'style', orig) : dropAttr(cleared, 'style');
}

function addClass(tag: string, cls: string): string {
  const cur = attrOf(tag, 'class');
  if (cur === null) return setAttr(tag, 'class', cls);
  return cur.split(/\s+/).includes(cls) ? tag : setAttr(tag, 'class', `${cur} ${cls}`.trim());
}

function dropClass(tag: string, cls: string): string {
  const cur = attrOf(tag, 'class');
  if (cur === null) return tag;
  return setAttr(tag, 'class', cur.split(/\s+/).filter((c) => c && c !== cls).join(' '));
}

/** 按位置改一批标签（**从后往前** —— 从前往后改会让后面记下来的位置全部错位）。 */
function splice(html: string, edits: { at: number; len: number; text: string }[]): string {
  let out = html;
  for (const e of [...edits].sort((a, b) => b.at - a.at)) {
    out = out.slice(0, e.at) + e.text + out.slice(e.at + e.len);
  }
  return out;
}

// ---------------------------------------------------------------- 判断

/** 这一层刷了什么底（inline 优先，其次类名从骨架表里读）。 */
function bgOf(el: OpenTag): { from: string; value: string } | null {
  const inline = el.style.background ?? el.style['background-color'];
  if (inline !== undefined) return { from: 'inline style', value: inline };
  for (const cls of el.classes) {
    const d = classDecls(cls);
    const v = d?.background ?? d?.['background-color'];
    if (v !== undefined) return { from: `.${cls}`, value: v };
  }
  return null;
}

/**
 * 这一层是不是「铺满整页」的那种（`inset:0` 或四边都锚 0）。
 *
 * 只有这种层才会挡住背景图 —— 装饰用的色带/色块（只锚一两条边）挡不住整页，把它们也算进来的话
 * 这个功能在半数版式上会被一句「这一页的底是品牌色」拒掉，而那块色带压根不在图的上面。
 */
function fullBleed(el: OpenTag): boolean {
  const zero = (v?: string) => v !== undefined && /^0(px|%)?$/.test(v.trim());
  const pick = (prop: string): string | undefined => {
    if (el.style[prop] !== undefined) return el.style[prop];
    for (const cls of el.classes) {
      const v = classDecls(cls)?.[prop];
      if (v !== undefined) return v;
    }
    return undefined;
  };
  if (zero(pick('inset'))) return true;
  return ['top', 'right', 'bottom', 'left'].every((p) => zero(pick(p)));
}

/**
 * 铺满整页又刷了实底的那一层：**浅底就地改透明**（原文存进 `keep` 那个属性，撤的时候原样放回），
 * **别的底一律拒**并说出是哪个类名上的哪个值。没刷底的回 null（不用动）。
 *
 * 背景图和装饰背景两条路共用这一份：各写一遍的话「哪几个底算浅底」会分叉 ——
 * 一边放过去的那种底在另一边被拒（或者更糟：放过去之后白字压在图上读不出来），
 * 而两边遇到的是同一层 `.lNN-wrap{background:var(--c-bg)}`。
 */
function clearCover(
  el: OpenTag,
  keep: string,
  tail: string
): { at: number; len: number; text: string } | null {
  const bg = bgOf(el);
  if (!bg) return null;
  if (!NEUTRAL_BG.has(bg.value.trim().toLowerCase())) {
    throw new ImageModeError(
      `这一页的底是 ${bg.from} 上的 ${bg.value}（不是页面本来的浅底）：改成透明之后这一页的字` +
        '（那种底上用的是白字 / `var(--c-brand-on)`）会直接压在照片上读不出来，不改的话' +
        tail
    );
  }
  return { at: el.at, len: el.text.length, text: addStyle(el.text, 'background:transparent', keep) };
}

/**
 * 把这一页图槽上的图**清回占位图**（分屏 ⇄ 背景图两个方向都清，单图那一路换上的本来就是占位图）。
 *
 * 为什么不把原来那张搬过去：那张是按**上一个模式**的构图生的 —— 分屏那一格的图铺满整页时主体被
 * 裁掉一大半、正好压在文字底下；反过来背景图那张（画面里留着文字那一侧的大片空白）塞回一格里看
 * 就是一张空图。搬过去的话这一页每一层都渲染正常、面板上写着「配图 1/1 张」，唯一的症状是
 * 「这个功能效果很差」，而真正要做的只是按新模式的提示词再生一张（`notes` 里那句话就是说这个，
 * 可他看着画面里明明有图，不会去点）。清回占位图之后画面上直接就写着「这一格还没有图」。
 *
 * `data-img-prompt` / `data-img-mode` **一个字不动**：清的只是地址。连提示词一起清的话下一次
 * 生成没有「画什么」，模型自己编一张 —— 图很好看，和这一页无关（硬规则 3）。
 */
export function clearSlotImages(html: string): { html: string; cleared: string[] } {
  const slots = findImageSlots(html);
  const urls = new Map<number, string>();
  const cleared: string[] = [];
  for (const s of slots) {
    // 占位图按这一格的比例挑：一律 16x9 的话，3:4 那一格下一次生成发出去的 size 也跟着变成横图
    // （`ratioOf` 是照占位图地址算的），回来一张横图塞进竖格子里被裁掉两边，而接口 200。
    const ph = s.ratio.startsWith('1:1') ? PLACEHOLDERS[1]
      : s.ratio.startsWith('3:4') ? PLACEHOLDERS[2] : PLACEHOLDERS[0];
    if (s.src === ph) continue;
    if (s.src && !PLACEHOLDERS.includes(s.src)) cleared.push(s.src);
    urls.set(s.index, ph);
  }
  return { html: urls.size ? replaceSlotUrls(html, slots, urls) : html, cleared };
}

function rootSection(els: OpenTag[]): OpenTag {
  const root = els.find((e) => e.name === 'section');
  if (!root) throw new ImageModeError('这一页的 HTML 里找不到 <section>（先重新生成这一页）。');
  return root;
}

/** 那个带 `data-img-prompt` 的元素（可能是外层容器，不一定是图本身 —— 见 `innerTarget`）。 */
function slotOwner(els: OpenTag[], slot: ImageSlot): OpenTag {
  const target = els.find((e) => e.at === slot.at);
  const chain: OpenTag[] = [];
  for (let i = target ? target.parent : -1; i >= 0; i = els[i].parent) chain.push(els[i]);
  const owner = [target, ...chain].find((e) => e && /\sdata-img-prompt="/.test(e.text));
  if (!target || !owner) {
    throw new ImageModeError('这一页的图位扫不出来（这一页在别处改过？刷新一下再试）。');
  }
  return owner;
}

// ---------------------------------------------------------------- 变形

export interface ModeResult {
  html: string;
  mode: PageImageMode;
  /** 变形本身没出错，但他应该知道的那几句（都是「画面上看不出来」的那种） */
  notes: string[];
  /** 单图模式：**真的会印进图里**的那几行字（第一行是大标题）。界面要显示出来，见 `toPoster`。 */
  text?: string[];
}

/**
 * 分屏 → 背景图：那一格的**图位**搬到 `.case-bg`（整页铺底 + 幕帘，图本身清回占位图，
 * 见 `clearSlotImages`），原来那一格藏起来但**留在原地**。
 *
 * 为什么不是「删掉原来那一格」：那一格是版式网格/绝对定位的一部分，删了之后旁边那一栏会摊开
 * 占满整行（画面照旧完整，只是排版变成另一页），而且改回来时没法还原。藏着的那一格同时是
 * 「改回来」的锚点（`data-backdrop-hidden`）。
 */
export function toBackdrop(html: string, opts: { mask?: number } = {}): ModeResult {
  if (pageImageMode(html) === 'backdrop') {
    throw new ImageModeError('这一页已经是背景图模式了（要调幕帘浓度就直接改浓度，要改回分屏点「改回分屏」）。');
  }
  // 装饰层自己占一格，不先去掉的话下面那条判据回的是「这一页有 2 格图」—— 他会去找那第二格图
  // 在哪（画面上压根看不出装饰层是一格），而真正要点的是「去掉装饰背景」。
  if (hasDecor(html)) {
    throw new ImageModeError(
      '这一页有一层装饰背景 —— 先点「去掉装饰背景」再改成背景图。' +
        '（背景图模式整页就是一张图，装饰层垫在它下面完全看不见，而它照旧占一格图位、照旧能点「AI 生成」花钱。）'
    );
  }
  const mask = opts.mask ?? BACKDROP_MASK;
  if (!Number.isFinite(mask) || mask < 0 || mask > 1) {
    throw new ImageModeError(`幕帘浓度要是 0 到 1 之间的数（收到 ${JSON.stringify(opts.mask)}），这一页没改。`);
  }
  // 原来那张图**先清回占位图**（`clearSlotImages`），再往下搬图位 —— 藏起来那一格里也不留
  // 那个地址：留着的话「改回分屏」会把它原样放回这一格（等于图自己回来了），而导出的那份 html
  // 里浏览器照旧会去拉一张谁也看不见的图。
  const wipe = clearSlotImages(html);
  html = wipe.html;
  const slots = findImageSlots(html);
  if (slots.length !== 1) {
    throw new ImageModeError(
      slots.length === 0
        ? '背景图模式要这一页正好有一格图，而这一页一格都没有（换成有图的版式，或者先在这一页加一块图）。'
        : `背景图模式要这一页正好有一格图，而这一页有 ${slots.length} 格 —— 铺成背景之后另外 ${slots.length - 1} 格会空着（那几格的图再也贴不上去）。`
    );
  }
  const slot = slots[0];
  if (slot.via === 'none') {
    throw new ImageModeError('这一格既没有 src 也没有 background-image，搬不成背景图（先重新生成这一页）。');
  }
  const els = scanTags(html);
  const root = rootSection(els);
  const owner = slotOwner(els, slot);
  const edits: { at: number; len: number; text: string }[] = [];
  const notes: string[] = [];

  // 图上面压着的那几层：**图的祖先链**（不含 section 本身；图在里面，所以它们一定盖着图）
  // + section 的其它直接孩子里**铺满整页**的那几层（全幅版式里文字有时单独一个 wrapper ——
  // 只看祖先链的话那一层照旧是实底，图整片看不见，而页面渲染完全正常）。
  const idx = new Map(els.map((e, i) => [e, i] as const));
  const rootAt = idx.get(root)!;
  const covers = new Map<number, OpenTag>();
  for (let i = els[idx.get(owner)!].parent; i >= 0 && els[i] !== root; i = els[i].parent) {
    covers.set(i, els[i]);
  }
  els.forEach((e, i) => {
    // 页眉是代码贴的（`.slide-header`，`z-index:30`、不刷底），不算一层。
    if (e.parent === rootAt && !e.classes.includes('slide-header') && fullBleed(e)) covers.set(i, e);
  });
  covers.delete(idx.get(owner)!); // 槽位自己下面要藏掉，它刷什么底都不影响

  for (const el of covers.values()) {
    if (el.classes.includes('case-bg')) {
      throw new ImageModeError('这一页的图已经是整页背景图了（版式自带的那种），不用再变形。');
    }
    const edit = clearCover(
      el,
      'data-backdrop-bg',
      '背景图整片被它挡住 —— 两种都是「页面看起来完全正常」。这一页不做背景图模式，换一页浅底的（左字右图那种）。'
    );
    if (edit) edits.push(edit);
  }

  // 原槽位：摘掉 `data-img-prompt`/`data-img-mode`（文件头 ①），原文存起来，整块藏掉。
  const prompt = attrOf(owner.text, 'data-img-prompt') ?? '';
  const mode = attrOf(owner.text, 'data-img-mode');
  let hidden = setAttr(owner.text, 'data-was-img-prompt', prompt);
  if (mode !== null) hidden = setAttr(hidden, 'data-was-img-mode', mode);
  hidden = dropAttr(dropAttr(hidden, 'data-img-prompt'), 'data-img-mode');
  edits.push({
    at: owner.at,
    len: owner.text.length,
    text: addStyle(hidden, 'visibility:hidden', 'data-backdrop-hidden'),
  });

  // section：加 `has-bg`（幕帘跟着 cool/暖两套色走）+ 这一页的幕帘浓度。
  edits.push({
    at: root.at,
    len: root.text.length,
    text: addStyle(addClass(root.text, 'has-bg'), `--bg-mask:${mask}`, 'data-backdrop-sec'),
  });

  // 背景图那一层插成 section 的**第一个**孩子：`findImageSlots` 按文档顺序编号，
  // 插在后面的话这一页的图槽序号变成 2，而 `images_json` 里那条记录是 1 —— 面板上
  // 「配图 1/1 张」照旧，画面里却是占位图（下一次生成又会多扣一次）。
  //
  // `z-index:-1` 覆盖掉 `.case-bg` 那条 `z-index:0`：0 的话只有**定位过的**那几块内容画在图上面，
  // 而这一条路上的页是**没有按背景图设计过的**（骨架里那句「不定位的内容块必须补
  // position:relative;z-index:2」只适用于库里自带背景图的那几条版式）—— 一个不定位的文字块
  // 会被整片盖住，画面上是「这一页只剩一张图」，文字并没有丢，没有一处会报错。
  // -1 等于「排在 section 自己的底色之上、所有内容之下」，任何版式都成立。
  // 背景图那一层换上的是**占位图**，不是原来那一格那张（见 `clearSlotImages` 上的注释）。
  const bd =
    `<div class="case-bg" data-backdrop="1" style="z-index:-1">` +
    `<img src="${PLACEHOLDERS[0]}" alt="" data-img-prompt="${prompt}" data-img-mode="backdrop">` +
    `</div>`;
  const out = splice(html, edits);
  const head = out.indexOf('>', out.indexOf('<section')) + 1;
  const withBd = out.slice(0, head) + bd + out.slice(head);

  const had = wipe.cleared.length > 0;
  notes.push(
    '这一页的图位已经铺成整页背景（原来那一格藏起来了，点「改回分屏」能还原）。' +
      (had
        ? '原来那张图**清掉了**（它是按那一格的构图生的，铺满整页会被裁掉一大半、主体正好压在文字底下）' +
          ' —— 那张还在素材库 /ppt/assets 里，要用回它就在这一格「素材库里挑」。'
        : '') +
      '现在这一页是占位图 —— 点一次「生成配图」才会按背景图那套提示词出真图' +
      '（画面里留出文字那一侧、不带任何文字，一次真实花费）。'
  );
  return { html: withBd, mode: 'backdrop', notes };
}

/**
 * 这一页**能不能**改成背景图：能就回 `null`，不能就回那句真实原因（`toBackdrop` 抛的原文）。
 *
 * 实现是「真变一次再把结果丢掉」（纯字符串活，不落库、不花钱），**故意不另写一份判据**：
 * 另写一份的话两边早晚漂开，而两个方向都是静默的 —— 判「能」而实际抛的话按钮在那儿、点下去
 * 一句红字（这个还看得见）；判「不能」而实际能变的话**那个按钮直接不出现**，他只会以为
 * 这一页不支持这个功能（而库里那几条深底版式里真正不支持的只是一部分），一处都不报错。
 *
 * 只对**分屏页**有意义（别的模式压根没有「改成背景图」这个按钮），所以调用方对非分屏页
 * 一律回 `null`，而不是把「已经是背景图模式了」这种话当成不支持的理由发给前端。
 */
export function backdropBlocker(html: string): string | null {
  try {
    toBackdrop(html);
    return null;
  } catch (e) {
    if (e instanceof ImageModeError) return e.message;
    throw e;
  }
}

/**
 * 只调这一页背景图上那层幕帘的浓度（`--bg-mask`）。**不重新生成、不花钱。**
 *
 * 单独一条是因为：浓度不合适（图看不见 / 字读不清）是这个模式最常见的不满意，而唯一的另一条路
 * 是「改回分屏再变一次」—— 那会把图搬回去再搬回来，中间他很可能顺手点一次「生成配图」（真花钱），
 * 而他要的只是这一个数。
 */
export function setBackdropMask(html: string, mask: number): ModeResult {
  if (pageImageMode(html) !== 'backdrop') {
    throw new ImageModeError('这一页不是背景图模式，没有幕帘可调。');
  }
  if (!Number.isFinite(mask) || mask < 0 || mask > 1) {
    throw new ImageModeError(`幕帘浓度要是 0 到 1 之间的数（收到 ${JSON.stringify(mask)}），这一页没改。`);
  }
  const els = scanTags(html);
  const root = rootSection(els);
  // 原来那串（`--bg-mask` 之前的样子）照旧存在 `data-backdrop-sec` 里 —— 先原样放回再写一遍，
  // 不然「调五次浓度」会在 style 里叠五条 `--bg-mask`（生效的是最后一条，改回分屏时撤不干净）。
  const base = restoreStyle(root.text, 'data-backdrop-sec');
  const text = addStyle(base, `--bg-mask:${mask}`, 'data-backdrop-sec');
  return {
    html: splice(html, [{ at: root.at, len: root.text.length, text }]),
    mode: 'backdrop',
    notes: [],
  };
}

/** 这一页背景图上那层幕帘现在多浓（不是背景图模式回 null）。 */
export function backdropMask(html: string): number | null {
  if (pageImageMode(html) !== 'backdrop') return null;
  const sec = scanTags(html).find((e) => e.name === 'section');
  const v = Number(sec?.style['--bg-mask']);
  return Number.isFinite(v) ? v : BACKDROP_MASK;
}

/** 背景图 → 分屏：把变形时加的记号全撤掉，图清回占位图（背景图那张**不**搬回这一格）。 */
export function toSplit(html: string): ModeResult {
  if (pageImageMode(html) !== 'backdrop') {
    throw new ImageModeError('这一页不是背景图模式，没有可以改回去的东西。');
  }
  const els = scanTags(html);
  const root = rootSection(els);
  const bd = els.find((e) => /\sdata-backdrop="1"/.test(e.text));
  const bdImg = els.find((e) => bd && e.parent === els.indexOf(bd));
  const hidden = els.find((e) => /\sdata-backdrop-hidden="/.test(e.text));
  if (!bd || !hidden) {
    throw new ImageModeError('这一页的背景图那一层扫不出来（这一页在别处改过？刷新一下再试）。');
  }
  // 背景图那一层现在挂的地址（可能是变形之后重新生成的那张）。**不搬回原来那一格**：那张是按
  // 「整页铺底」生的（画面里留着文字那一侧的大片空白），塞回一格里看是一张空图，而面板上写着
  // 「配图 1/1 张」—— 详见 `clearSlotImages`。只用来决定下面那句话怎么说。
  const url = bdImg ? attrOf(bdImg.text, 'src') : null;

  const edits: { at: number; len: number; text: string }[] = [];
  // 撤掉压着那几层的 `background:transparent`（style 原文存在那个属性里）
  for (const el of els) {
    if (el === root || !/\sdata-backdrop-bg="/.test(el.text)) continue;
    edits.push({ at: el.at, len: el.text.length, text: restoreStyle(el.text, 'data-backdrop-bg') });
  }
  // 原槽位：属性放回去、取消隐藏
  let back = hidden.text;
  const prompt = attrOf(back, 'data-was-img-prompt') ?? '';
  const mode = attrOf(back, 'data-was-img-mode');
  back = setAttr(back, 'data-img-prompt', prompt);
  if (mode !== null) back = setAttr(back, 'data-img-mode', mode);
  back = dropAttr(dropAttr(back, 'data-was-img-prompt'), 'data-was-img-mode');
  edits.push({ at: hidden.at, len: hidden.text.length, text: restoreStyle(back, 'data-backdrop-hidden') });
  // section：撤 `has-bg` 和幕帘浓度
  edits.push({
    at: root.at,
    len: root.text.length,
    text: restoreStyle(dropClass(root.text, 'has-bg'), 'data-backdrop-sec'),
  });
  // 背景图那一层整块删掉（连闭合标签）
  const close = html.indexOf('</div>', bd.at);
  if (close < 0) throw new ImageModeError('背景图那一层没有闭合标签，改不回去（刷新一下再试）。');
  edits.push({ at: bd.at, len: close + '</div>'.length - bd.at, text: '' });

  // 藏起来那一格的 `src` 是变成背景图**之前**的样子（没配过图就还是占位图），所以这里只要把
  // 剩下的真图清掉就行 —— 一律换成 16x9 占位图的话，本来是 3:4 的那一格下一次生成会出横图。
  const cleared = clearSlotImages(splice(html, edits));
  const dropped = (url && !PLACEHOLDERS.includes(url) ? [url] : []).concat(cleared.cleared);
  return {
    html: cleared.html,
    mode: 'split',
    notes: [
      dropped.length
        ? '已经改回分屏。刚才那张背景图**没有搬回这一格**（它是按「整页铺底」生的，画面里留着文字那一侧的' +
          '大片空白，塞回一格里看就是一张空图）—— 那张还在素材库 /ppt/assets 里，要用回它就在这一格' +
          '「素材库里挑」。这一格现在是占位图，点一次「生成配图」会按这一格的构图重画一张（一次真实花费）。'
        : '已经改回分屏（这一格是占位图 —— 点一次「生成配图」才会出真图，一次真实花费）。',
    ],
  };
}

// ---------------------------------------------------------------- 单图模式（poster）

/**
 * 印进图里的字最多几行。**超了的那几行丢掉并点名说出来**：一张 1536×1024 的图上排不下
 * 十几行字 —— 硬塞的话模型会把字挤成一团、或者自己挑几句写（挑掉的那几句没有一处会说，
 * 而图上每个字都清清楚楚）。
 */
export const MAX_POSTER_LINES = 6;
/** 一行最多几个字（超了整行丢掉并说出来 —— 截半句的话印在图上那半句读起来完全通顺）。 */
const MAX_POSTER_LINE_CHARS = 48;

const POSTER_PLACEHOLDER = PLACEHOLDERS[0];

/**
 * 「画什么」那句话写进属性时只做 html 转义。**不能借 `encodePosterText`**：那一份还会把 `|`
 * 转成 `&#124;`（它要用 `|` 当分隔符），而 `findImageSlots` 读 `data-img-prompt` 是照原文拿的
 * —— 发给模型的提示词里会多出一串 `&#124;`，而图照样生得出来，只是画面里多了点莫名的东西。
 */
function attrText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&');
}

/** 标签之间那些字，按文档顺序（标签一律换成换行 —— 换成空串的话 `<b>` 两侧的字会粘成一个词）。 */
function textLines(html: string): string[] {
  return decodeEntities(html.replace(/<[^>]*>/g, '\n'))
    .split('\n')
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

/** 这一页真正属于内容的那一段（去掉代码贴的页眉、去掉脚本/样式）。 */
function pageBody(html: string): string {
  return stripHeaders(html).replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ');
}

/**
 * 这一页的标题那一行。**单图和装饰背景两条路共用这一份**：各写一遍正则的话，改了「标题算哪个
 * 元素」之后只会改到一处 —— 另一条路上「画什么」那句围的是眼标（`.kicker` 那个「02 / 能力」），
 * 而提示词、图、界面全部正常。
 */
function headlineIn(body: string): string {
  const head =
    /<(h1|h2)\b[^>]*>([\s\S]*?)<\/\1>/i.exec(body) ||
    /<([a-z][\w-]*)\b[^>]*class="[^"]*(?<![\w-])page-title(?![\w-])[^"]*"[^>]*>([\s\S]*?)<\/\1>/i.exec(body);
  return head ? textLines(head[2]).join(' ') : '';
}

/**
 * 这一页要印进单图里的那几行字，**全部由代码从这一页的 html 里扒**（硬规则 3）。
 *
 * 四条是承重的：
 * ① **左上角那行模块名要摘掉**（`stripHeaders`，代码贴的那一份）：印进图里之后，画面上是
 *    模块名 + 播放器页脚上同一个模块名，同一句话在这一页出现两次，而图本身完全正常。
 * ② **标题提到第一行**：poster 模板把第一行当大标题（四倍字号）。按文档顺序硬拿第一行的话，
 *    带眼标（`.kicker`「02 / 能力」）的那几条版式会把那个小标签印成满屏大字，而正经标题
 *    变成一行小字 —— 图很好看，只是主次反了。
 * ③ **丢掉的每一行都要点名**（太长的、超出行数的）：静默丢的话他看到的是一张漂亮的图，
 *    而这一页少了两条要点，对不回是哪一步弄掉的。
 * ④ **一个字都扒不到时不许兜一句**（调用方拒掉）：模型编的那几句读起来和这一页的文案一样自然。
 */
export function posterLines(html: string): { lines: string[]; notes: string[] } {
  const body = pageBody(html);
  const headline = headlineIn(body);

  const seen = new Set<string>();
  const all: string[] = [];
  for (const line of textLines(body)) {
    // 一个字的那些是装饰（箭头 / 序号点 / 竖线），印进图里是几个莫名的符号。
    if (line.length < 2) continue;
    if (seen.has(line)) continue;
    seen.add(line);
    all.push(line);
  }
  if (headline) {
    const at = all.indexOf(headline);
    if (at > 0) all.splice(at, 1);
    if (at !== 0) all.unshift(headline);
  }

  const notes: string[] = [];
  const kept: string[] = [];
  const tooLong: string[] = [];
  for (const line of all) {
    if (line.length > MAX_POSTER_LINE_CHARS) {
      tooLong.push(line);
      continue;
    }
    if (kept.length >= MAX_POSTER_LINES) continue;
    kept.push(line);
  }
  const over = all.filter((l) => l.length <= MAX_POSTER_LINE_CHARS).slice(MAX_POSTER_LINES);
  if (tooLong.length) {
    notes.push(
      `有 ${tooLong.length} 行字太长（超过 ${MAX_POSTER_LINE_CHARS} 个字），没印进图里：` +
        `${tooLong.map((l) => `「${l.slice(0, 18)}…」`).join('、')} —— 一张图上排不下整段话，` +
        '硬塞的话模型会把字挤成一团或者自己挑几句写。要保留这几句就「改回原版」。'
    );
  }
  if (over.length) {
    notes.push(
      `这一页有 ${kept.length + over.length} 行字，只有前 ${MAX_POSTER_LINES} 行印进图里，` +
        `没印的是：${over.map((l) => `「${l.slice(0, 18)}」`).join('、')}。`
    );
  }
  return { lines: kept, notes };
}

/** 这一页单图里印的是哪几行字（不是单图模式就是空数组）。 */
export function posterText(html: string): string[] {
  const m = new RegExp(`\\s${POSTER_TEXT_ATTR}="([^"]*)"`).exec(html);
  return m ? decodePosterText(m[1]) : [];
}

/**
 * 分屏/背景图 → 单图模式：整页换成**一张图**（文字印在图里，由生图模型排版）。
 *
 * 变形本身不花钱（换上的是占位图），真正的那张要他再点一次「生成配图」。
 *
 * 四条是承重的：
 * ① **这一页原来的样子整份存起来**（`poster_from_html`，104），不是在这里塞一段注释：
 *    注释里那几个 `data-img-prompt` 照样被 `findImageSlots` 数进来 —— 这一页变成两三格，
 *    下一次生成的图贴进注释里那一格，而画面上的单图再也换不掉（接口 200、缩略图也在）。
 * ② **印哪几行字由代码定**（`posterLines`）：让模型自己从画面里读的话，它会顺手改写/编一句，
 *    印出来的那几句读起来和这一页的文案一样自然（硬规则 3）。
 * ③ **section 里的内容全换掉，页眉一起走**：留着原来那些文字块的话，它们压在图上面
 *    （`z-index:2` > 图的 0），画面上是「图里的字和页面上的字叠成两层」，两层都渲染正常。
 * ④ **原来那几张图要点名**：那是真花过钱的，变形之后从这一页消失（还在素材库里、改回原版
 *    也会回来）—— 不说的话他以为图丢了，会再生一遍。
 */
export function toPoster(html: string): ModeResult {
  if (pageImageMode(html) === 'poster') {
    throw new ImageModeError('这一页已经是单图模式了（要换一张就点「生成配图」，要回到有文字的版式点「改回原版」）。');
  }
  // 单图会把 section 里的东西整个换掉 —— 装饰层（连那张已经花钱生出来的图）会跟着一起消失，
  // 而变形本身成功、画面上是一张挺好的图，他压根不会想到那一层去哪了。
  if (hasDecor(html)) {
    throw new ImageModeError(
      '这一页有一层装饰背景 —— 先点「去掉装饰背景」再改成单图。' +
        '（单图整页就是一张图，装饰层会跟着这一页的版式一起被换掉，包括那一格已经生成的图。）'
    );
  }
  const { lines, notes } = posterLines(html);
  if (!lines.length) {
    throw new ImageModeError(
      '这一页扫不出任何文字，单图模式会生成一张什么字都没有的插画（而这一页的内容一个字都不在了）。' +
        '先在这一页写点内容，或者用背景图模式（那一路本来就不带文字）。'
    );
  }
  const els = scanTags(html);
  const root = rootSection(els);
  const close = html.lastIndexOf('</section>');
  if (close < 0) throw new ImageModeError('这一页的 HTML 里找不到 </section>（先重新生成这一页）。');

  // 「画什么」：这一页原来那一格的提示词优先（那是按这一页的内容写的一句画面描述），
  // 一格都没有的话按标题凑一句 —— 两种都要在 notes 里说出来是哪一种，不然「这张图怎么
  // 画的是另一回事」他只能一张张重生（每张都是一次真实花费）。
  const slots = findImageSlots(html);
  const fromSlot = slots.find((s) => s.prompt)?.prompt || '';
  const subject = fromSlot || `围绕「${lines[0]}」的一张整页主视觉`;
  const art =
    `\n  <div class="poster-art"><img src="${POSTER_PLACEHOLDER}" alt=""` +
    ` data-img-prompt="${attrText(subject)}" data-img-mode="poster"` +
    ` ${POSTER_TEXT_ATTR}="${encodePosterText(lines)}"></div>\n`;
  const out =
    html.slice(0, root.at) + setAttr(root.text, 'data-poster', '1') + art + html.slice(close);

  notes.push(
    `这一页现在是一张占位图 —— 点「生成配图」才会出真的单图（图里会印上这 ${lines.length} 行字，` +
      `第一行「${lines[0]}」是大标题）。`
  );
  notes.push(
    fromSlot
      ? `画面按原来那一格的提示词生成：「${fromSlot}」。`
      : `这一页原来没有图，「画什么」是按标题凑的一句：「${subject}」—— 要指定画面就「改回原版」，` +
          '在那一格的提示词里写清楚再改成单图。'
  );
  const hadImages = slots.filter((s) => s.src && !PLACEHOLDERS.includes(s.src)).length;
  if (hadImages) {
    notes.push(
      `原来那 ${hadImages} 张图不在这一页里了（还在素材库 /ppt/assets 里，「改回原版」也会带回来）—— 别重新生成。`
    );
  }
  notes.push(
    '单图模式下这一页**不能就地改字**（字在图里）：导出的 pptx 里它是一整张图，' +
      '换配色/改标题都要先「改回原版」。模型偶尔会把某个字写错或者写成别的字形，生成完请把图放大看一眼。'
  );
  return { html: out, mode: 'poster', notes, text: lines };
}

// ---------------------------------------------------------------- 装饰背景（decor）
//
// 和上面三路**不是一回事**：那三路是「这一页的图怎么用」（互斥的模式），这一条是**在分屏页上
// 多垫一层**很淡的线条/几何/肌理，版式和原来那几格图一个字都不动。所以：
// ① 它不进 `pageImageMode`（那个函数回的是这一页的模式，硬塞一个 'decor' 进去的话界面上
//    这一页显示成「装饰背景模式」，而「改成背景图 / 改成单图」那两个按钮的判据全靠它）；
// ② **这一页的图一律不清**（不走 `clearSlotImages`）：加的是一层，原来那几格该长什么样还长什么样
//    —— 清掉的话他点一下「加装饰背景」，这一页配好的图全变回占位图（每张都是真花过钱的）；
// ③ 图槽插在**最后**（`</section>` 之前）：插在前面的话原来那几格的序号整体后移一位，而
//    `images_json` / 备好的图 / 面板上「配图 N 张」认的都是序号 —— 下一次生成的图贴进别的格子里，
//    接口 200、缩略图也在。

/** 这一层现在多淡（没有这一层就回 null）。 */
export function decorAlpha(html: string): number | null {
  if (!hasDecor(html)) return null;
  const el = scanTags(html).find((e) => /\sdata-decor="1"/.test(e.text));
  const v = Number(el?.style['--decor-a']);
  return Number.isFinite(v) ? v : DECOR_ALPHA;
}

export interface DecorResult {
  html: string;
  /** 加完/调完之后这一层的浓度（没有这一层就是 null） */
  alpha: number | null;
  notes: string[];
}

function checkAlpha(alpha: number): void {
  if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) {
    throw new ImageModeError(`装饰层浓度要是 0 到 1 之间的数（收到 ${JSON.stringify(alpha)}），这一页没改。`);
  }
}

/** 浓度 0 的时候必须说出来：页面上那一层完全看不见，而他刚点过「AI 生成」（真扣过一次额度）。 */
function alphaNote(alpha: number): string[] {
  return alpha === 0
    ? ['浓度是 0 —— 这一层在页面上完全看不见（图还在，拖一下滑块就出来）。']
    : [];
}

/**
 * 给这一页加一层装饰底图（**纯代码搬 DOM，不调 AI、不花钱**；真正那张图要他再点一次生成）。
 *
 * 四条边界：
 * ① **只在分屏页上加。** 背景图/单图那两页整页已经是一张图了，再垫一层在它**下面**等于什么都
 *    没发生 —— 接口 200、备图栏多一格、还能点「AI 生成」（一次真实花费），而画面上一点变化都没有。
 * ② **已经有一层时拒掉**，并指到滑块上：再加一层的话这一页有两个 decor 槽位，序号往后的那些
 *    记录全错位，而画面上只是「颜色好像深了一点」。
 * ③ **满 6 格时拒掉**（`MAX_SLOTS_PER_PAGE`）：第 7 格会被 `specsFromSlots` 截掉 —— 那一格
 *    在备图面板上压根不出现，只能走「配全部图」那条真花钱的路，而装饰层这一层是加上了的。
 * ④ **「画什么」由代码从这一页的标题算**（硬规则 3）：让模型自己看着页面编一句的话，它每一页
 *    编的方向都不一样，而全份统一正是这条路的全部意义（统一那件事归「视觉母题」那一档）。
 */
export function addDecor(html: string, opts: { alpha?: number } = {}): DecorResult {
  const cur = pageImageMode(html);
  if (cur !== 'split') {
    throw new ImageModeError(
      cur === 'backdrop'
        ? '这一页是背景图模式 —— 整页已经是一张图了，装饰层垫在它下面等于什么都看不见（还会多出一格图位、多花一次钱）。要装饰背景就先「改回分屏」。'
        : '这一页是单图模式 —— 整页就是一张图（连字都印在里面），装饰层垫在它下面完全看不见。要装饰背景就先「改回原版」。'
    );
  }
  if (hasDecor(html)) {
    throw new ImageModeError('这一页已经有一层装饰背景了（要它淡一点/浓一点就拖「装饰层浓度」那个滑块，要换一张就点那一格的「AI 生成」）。');
  }
  const alpha = opts.alpha ?? DECOR_ALPHA;
  checkAlpha(alpha);
  const slots = findImageSlots(html);
  if (slots.length >= MAX_SLOTS_PER_PAGE) {
    throw new ImageModeError(
      `这一页已经有 ${slots.length} 格图（上限 ${MAX_SLOTS_PER_PAGE} 格），再加一层装饰背景的话那一格备不了图、` +
        '也换不了图（只剩「配全部图」那条真花钱的路）。这一页不加装饰背景。'
    );
  }
  const els = scanTags(html);
  const root = rootSection(els);
  const close = html.lastIndexOf('</section>');
  if (close < 0) throw new ImageModeError('这一页的 HTML 里找不到 </section>（先重新生成这一页）。');

  // 铺满整页又刷了实底的那几层会把这一层整片挡住（装饰层是 `z-index:-1`，在它们下面）——
  // 浅底就地改透明，别的底拒掉。不处理的话「加完一点变化都没有」，而一处都不报错。
  const rootAt = els.indexOf(root);
  const edits: { at: number; len: number; text: string }[] = [];
  for (const el of els) {
    if (el.parent !== rootAt || el.classes.includes('slide-header') || !fullBleed(el)) continue;
    const edit = clearCover(
      el,
      'data-decor-bg',
      '装饰背景整片被它挡住（加完画面上一点变化都没有）—— 两种都是「页面看起来完全正常」。这一页不加装饰背景。'
    );
    if (edit) edits.push(edit);
  }

  const headline = headlineIn(pageBody(html));
  const subject = headline
    ? `和「${headline}」这一页气质一致的一层抽象装饰底纹`
    : '一层抽象装饰底纹';
  // 前后**不加换行/缩进**：`removeDecor` 是按标签位置整块删的，加了的话去掉之后那几个空白字符
  // 留在 html 里 —— 加上再去掉五次，这一页的 html 和原来差十行空白（画面上完全一样，
  // 而「这一页改过没有」那类对账全是按字符串比的）。
  const layer =
    `<div class="page-decor" data-decor="1" style="--decor-a:${alpha}">` +
    `<img src="${PLACEHOLDERS[0]}" alt="" data-img-prompt="${attrText(subject)}" data-img-mode="decor">` +
    `</div>`;
  const out = splice(html, edits);
  const at = out.lastIndexOf('</section>');
  const notes = [
    `这一页多了一层装饰背景（第 ${slots.length + 1} 格，垫在所有内容底下，原来那几格图一个字都没动）。` +
      '现在它是占位图 —— 点那一格的「AI 生成」才会出真图（一次真实花费），画风跟着「项目设置 › 视觉母题」走。',
    ...alphaNote(alpha),
  ];
  if (!headline) {
    notes.push(
      '这一页扫不出标题，那一格的「画什么」写的是一句通用的（「一层抽象装饰底纹」）—— 要它跟这一页的内容有关就在那一格的提示词里自己写一句。'
    );
  }
  if (edits.length) {
    notes.push(
      `这一页有 ${edits.length} 层铺满整页的浅色底，已经就地改成透明（不改的话装饰层整片被挡住，看起来像没生效）—— 去掉装饰背景时会原样放回。`
    );
  }
  return { html: out.slice(0, at) + layer + out.slice(at), alpha, notes };
}

/** 只调这一层的浓度（**不重新生成、不花钱**，同 `setBackdropMask`）。 */
export function setDecorAlpha(html: string, alpha: number): DecorResult {
  if (!hasDecor(html)) throw new ImageModeError('这一页没有装饰背景，没有浓度可调。');
  checkAlpha(alpha);
  const el = scanTags(html).find((e) => /\sdata-decor="1"/.test(e.text))!;
  // 把原来那条 `--decor-a` 摘掉再写一条：直接追加的话「调五次」会在 style 里叠五条
  // （生效的是最后一条，而 `decorAlpha` 读到的是第一条 —— 滑块和画面从此差一截）。
  const kept = (attrOf(el.text, 'style') || '')
    .split(';')
    .filter((d) => d.trim() && !/^--decor-a\s*:/.test(d.trim()))
    .join(';');
  const style = kept ? `${kept};--decor-a:${alpha}` : `--decor-a:${alpha}`;
  return {
    html: splice(html, [{ at: el.at, len: el.text.length, text: setAttr(el.text, 'style', style) }]),
    alpha,
    notes: alphaNote(alpha),
  };
}

/** 去掉装饰背景：那一层整块删掉，为它改透明的那几层原样放回。 */
export function removeDecor(html: string): DecorResult {
  if (!hasDecor(html)) throw new ImageModeError('这一页没有装饰背景。');
  const els = scanTags(html);
  const layer = els.find((e) => /\sdata-decor="1"/.test(e.text))!;
  const img = els.find((e) => e.parent === els.indexOf(layer));
  const url = img ? attrOf(img.text, 'src') : null;
  const close = html.indexOf('</div>', layer.at);
  if (close < 0) throw new ImageModeError('装饰背景那一层没有闭合标签，去不掉（刷新一下再试）。');
  const edits: { at: number; len: number; text: string }[] = [
    { at: layer.at, len: close + '</div>'.length - layer.at, text: '' },
  ];
  for (const el of els) {
    if (el === layer || !/\sdata-decor-bg="/.test(el.text)) continue;
    edits.push({ at: el.at, len: el.text.length, text: restoreStyle(el.text, 'data-decor-bg') });
  }
  const notes = ['已经去掉这一页的装饰背景（版式和那几格图原样留着）。'];
  if (url && !PLACEHOLDERS.includes(url)) {
    // 不说的话他以为那张图跟着没了，会重新加一层再生一张（一次真实花费）。
    notes.push('刚才那张装饰图还在素材库里（/ppt/assets）—— 再加一层的话可以在那一格「素材库里挑」，不用重新生成。');
  }
  return { html: splice(html, edits), alpha: null, notes };
}

// ---------------------------------------------------------------- 整份共用的那层装饰底图（106）
//
// 贴那一层的代码在 `deckShell.applyDeckDecor`（拼页那一处，一张图全份复用、不占图位）。
// 这里只管**它在这一页上会不会被挡住** —— 那件事要读骨架里的类名声明（`classDecls`），
// 而 deckShell 不能 import 这个文件（成环，见 `pageMarkers.ts` 头注）。

/**
 * 铺满整页的不透明底会把这一层整片挡住（它是 `z-index:-1`，盖得住 `.slide` 自己的底色、
 * 盖不住任何铺满的子元素）。挡住就回一句**真实成因**给接口报出去。
 *
 * **这里不像 `addDecor` 那样把浅底就地改透明**：那一条是他给这一页单独点的，改的是这一页；
 * 而整份这一层一按下去就是几十页，顺手改掉每一页的底色属于「他没要求的改动」——
 * 而且撤的时候要逐页放回，漏一页就是那一页的底色从此是透明的（画面上看不出来，导出 pptx 才发现）。
 * 所以这几页照实报出去，让他对那几页单独加页级的装饰背景。
 */
export function deckDecorBlocker(html: string): string | null {
  const els = scanTags(html);
  const root = els.find((e) => e.name === 'section');
  if (!root) return '这一页的 HTML 里找不到 <section>（先重新生成这一页）。';
  const rootAt = els.indexOf(root);
  for (const el of els) {
    if (el.parent !== rootAt || el.classes.includes('slide-header') || !fullBleed(el)) continue;
    const bg = bgOf(el);
    if (!bg) continue;
    const v = bg.value.trim().toLowerCase();
    if (v === '' || v === 'none' || v === 'transparent') continue;
    return (
      `这一页有一层铺满整页的底（${bg.from} 上的 ${bg.value}）挡着 —— 整份那一层垫在它下面看不见。` +
      '要这一页也有底纹就在「这一页的图」里单独给它加一层装饰背景。'
    );
  }
  return null;
}

/**
 * 这一页装饰层里那张**真图**（地址 + 那一格的提示词），给「这张图整份都用」那个按钮用。
 *
 * 还是占位图的话回 null 而不是那个 `/ppt-cases/ph-…` 地址：占位图被整份垫上去之后，几十页
 * 底下各多一张浅灰细纹 —— 画面上几乎看不出变化，而接口 200、后台记着地址，看起来像这个功能没生效。
 * 地址由服务端从 html 现读，**不让前端传**：前端另写一遍「装饰层那张图是哪一个」的话，
 * 换过模式/删过一格之后它挑中的是别的一格，而整份底纹变成了那一页正文里的一张配图。
 */
export function decorImage(html: string): { url: string; prompt: string } | null {
  if (!hasDecor(html)) return null;
  const els = scanTags(html);
  const layer = els.find((e) => /\sdata-decor="1"/.test(e.text));
  if (!layer) return null;
  const img = els.find((e) => e.parent === els.indexOf(layer));
  const url = img ? attrOf(img.text, 'src') : null;
  if (!url || PLACEHOLDERS.includes(url)) return null;
  return { url, prompt: decodeEntities(attrOf(img!.text, 'data-img-prompt') || '') };
}

export interface DeckDecorPageReport {
  page: number;
  applied: boolean;
  /** 没垫上的真实成因（垫上了就是空串） */
  reason: string;
}

/**
 * 整份那层底图**逐页**垫得上垫不上（给接口原样报给他看）。
 *
 * 静默跳过是这个功能最容易出的事故：他点一下「整份都用」，四十页里有六页没有 ——
 * 不说的话现象是「这个功能时好时坏」，他会回去反复重新生成那张图（每张真花一次钱）。
 */
export function deckDecorReport(
  pages: Array<{ page: number; html: string }>,
  decor: DeckDecor | null
): DeckDecorPageReport[] {
  return pages.map(({ page, html }) => {
    if (!html) return { page, applied: false, reason: '这一页还没生成。' };
    const r = applyDeckDecor(html, decor);
    if (!r.applied) return { page, applied: false, reason: r.reason };
    const blocked = deckDecorBlocker(html);
    return { page, applied: !blocked, reason: blocked || '' };
  });
}

// ---------------------------------------------------------------- 版式自带的默认图模式

/**
 * 库文件里 `- **默认图模式**：背景图` 那一档：**生成完这一页就地变形**，不用他每次手点
 * 「改成背景图」（L1 / L3 / L20 / L66 这几条本来就是「一张大图 + 一侧文字」的版式）。
 *
 * 两条边界：
 * ① **变形失败不许吞**。深底/品牌色整页那几页 `toBackdrop` 会拒（图整片被挡住），这时这一页
 *    留在分屏是**对的**，但必须把真实成因喊出来 —— 吞掉的话库文件上写着「默认背景图」、
 *    生成出来是一页正常的左图右字，他只会以为这一行没生效、反复重新生成（每次一次真调用）。
 * ② **只在生成那一次做**，不在读取/拼整份那条路上做：那两条路上做的话他点「改回分屏」之后
 *    一刷新又变回背景图，而两次都不报错（现象是「这个按钮点了没用」）。
 */
export function applyDefaultImageMode(
  html: string,
  want: '' | 'backdrop',
  ctx: { page: number; layoutId: string; mask?: number }
): { html: string; changed: boolean; problems: string[] } {
  if (want !== 'backdrop') return { html, changed: false, problems: [] };
  // 版式自带整页背景图的（`.case-bg`）或者已经是背景图记号的，本来就到位了。
  if (pageImageMode(html) === 'backdrop') return { html, changed: false, problems: [] };
  try {
    // 幕帘浓度跟着版式那一行走（`（幕帘 N%）`，见 `PptLayout.defaultBackdropMask`）：
    // 本来就是整页照片的那几条自己带一层蒙版，它在变形之后照旧画在幕帘上面，两层叠起来
    // 照片灰掉一半 —— 而页面、接口、problems 全都正常。`??` 不是 `||`：0 是有效值，
    // 写成 `||` 的话「幕帘 0%」静默变回 30%，md 上写的那个数永远不生效。
    return { html: toBackdrop(html, { mask: ctx.mask ?? BACKDROP_MASK }).html, changed: true, problems: [] };
  } catch (e: any) {
    return {
      html,
      changed: false,
      problems: [
        `第 ${ctx.page} 页的版式 ${ctx.layoutId} 默认是背景图模式，但这一页没能改过去：${e?.message || e}` +
          ' —— 这一页现在是分屏（图占一侧）。要整页背景图就先按上面那句改这一页的内容，再点「改成背景图」。',
      ],
    };
  }
}
