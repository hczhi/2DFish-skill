// 导出整份 deck 成一个**可编辑的 .pptx**（不调 AI）。
//
// 做法：服务端开一个 chromium 把 deck 渲染出来，**逐个 DOM 节点译成 pptx 自己的对象** ——
// 有底色/边框的块 → 形状，`<img>` 和内嵌 `<svg>` → 图片，每一段字 → 文本框。整页**不垫底图**：
// 客户在 PowerPoint 里点得中每一块，能挪、能删、能改色。
//
// pptx 里没有伪元素这个东西，而这套模板 65 个版式里 65 个都用 `::before/::after` 画装饰 ——
// 所以走之前先把它们**实体化成真节点**（见 walkPage 里那一段），照片上的遮罩/幕帘也在里面。
//
// 剩下的代价一条都不能不说（硬规则 1，全在 `pptxNotes` 里）：pptx 里**没有渐变填充、没有毛玻璃 /
// 混合模式 / clip-path / 竖排**。这几样缺了之后文件打开完全正常，只是「少了个小装饰」「颜色淡了
// 一档」—— 没有任何一处会报错，所以只能靠那几句话告诉他哪儿和网页不一样。
//
// 六条承重的边界（每一条都是「文件下载下来了、打开一片正常」的失败）：
// ① **画的先后按「每层 (z-index, 第几个子节点)」排，文字一律最后画。** pptx 里就是按加入顺序叠
//    的，而 CSS 的绘制顺序不是 DOM 顺序 —— 照 DOM 顺序塞的话实体化出来的幕帘（`z-index:1`，
//    位置在最后一个子节点）会压在这一页所有色块上面，整页闷掉一档。
// ② **图不能直接写 src**：页面里是 `/ppt-cases/*.svg`（pptx 压根不收 svg）或者 COS 上的地址，
//    写进去在 PowerPoint 里是个红叉。所以逐个截成像素再贴字节。
// ③ **截某一块之前要把别的都藏掉**：playwright 截的是「这块矩形范围内画面上的样子」，压在图上
//    的标题会被一起烙进图里 —— 然后文本框又写一遍同一句，屏幕上同一句话叠两份。
// ④ **元素的 opacity 要烙进像素**，不能用 pptx 的 `transparency`（苹果那套渲染器无视
//    `alphaModFix`）—— 症状是「在 PowerPoint 里对、在 Mac 预览/Keynote 里整页发白」。
// ⑤ **每一块字的位置是按行盒量的，不是元素盒**（见 walkPage 里那一段）。
// ⑥ **一次只让一两份稿子在导**：每份要开一个 chromium（一两百 MB），并发上来小机器上是进程被
//    OOM 杀掉 —— 现象是「点了导出，转一会儿整个后端断了」。

import type { Browser, Page } from 'playwright';
import PptxModule from 'pptxgenjs';
import { exportDeck } from './exportService.js';
import type { DeckPageInput } from './pageService.js';
import type { DeckMeta } from './deckShell.js';

export class PptxExportError extends Error {}

export interface PptxExportResult {
  filename: string;
  /** 文件字节的 base64（回 JSON 不回 attachment：下面那几句提示得有地方说，见 api/ppt.ts）。 */
  base64: string;
  bytes: number;
  pages: number;
  /** 可编辑文本块数 —— 这个数是「可编辑」这件事唯一的凭据，前端要显示出来。 */
  textBlocks: number;
  /** 形状（色块/线条/圆点）个数。 */
  shapes: number;
  /** 贴进去的图片张数（`<img>` + 内嵌 svg + CSS 背景图那几块）。 */
  images: number;
  warnings: string[];
}

/** 设计稿 1920×1080 → pptx 13.333in × 7.5in，所以 1px = 1/144 in，字号 pt = px × 0.5。 */
const PX_TO_IN = 1 / 144;
const PX_TO_PT = 0.5;
const SLIDE_W = 13.333;
const SLIDE_H = 7.5;
const inch = (px: number) => +(px * PX_TO_IN).toFixed(3);

/** 一段连着的、样式一样的字。行内 `<b>/<em>/<span class=hl>` 各出一段。 */
interface Run {
  t: string;
  bold: boolean;
  italic: boolean;
  color: string;
  sizePx: number;
  serif: boolean;
}
interface Side {
  side: 'top' | 'right' | 'bottom' | 'left';
  w: number;
  color: string;
}
interface Placed {
  x: number; y: number; w: number; h: number; rot: number; alpha: number;
  /** 画的先后：从根到自己、每层一对 (z-index, 第几个子节点)。见 walkPage 里 `zOf` 那一段。 */
  ord: number[];
}
interface TextNode extends Placed {
  kind: 'text';
  runs: Run[];
  sizePx: number; color: string; align: string;
  serif: boolean; lineHeight: number; spacingPx: number; lines: number; fillHint: string | null;
}
interface ShapeNode extends Placed {
  kind: 'shape';
  fill: string | null;
  radius: number;
  /** 四条边各自的宽和色（**不是**一个总的边框）。见 emitPage：单边的要自己画细长矩形。 */
  borders: Side[];
}
interface ImageNode extends Placed {
  kind: 'image';
  /** 页面里给它打的标记，截图那一步靠它定位。 */
  id: string;
}
type Node = TextNode | ShapeNode | ImageNode;
interface PageWalk {
  nodes: Node[];
  broken: number;
  /** 「pptx 里没有对应画法」的分类计数，键见 `DEGRADE_NOTE`。 */
  degrade: Record<string, number>;
}

/**
 * 每一类「画不出来」对应的一句人话。**这一份是导出这条路上唯一的降级出声**：缺了之后文件
 * 打开完全正常，客户只会觉得「这版设计有点素」，而我们这边一处都不报错。
 */
const DEGRADE_NOTE: Record<string, string> = {
  pseudo:
    '有几处纯 CSS 画的小装饰没能变成对象（挂在 `<img>` 这类装不了子节点的标签上，' +
    '或者内容是 `url()`/编号那种生成内容）—— pptx 里那几个装饰是没有的',
  gradient: '渐变底退成了渐变的第一个色（pptx 的形状只有纯色填充）',
  cssBg:
    '用 CSS 背景图铺的那几块（不是 `<img>`）是连同压在上面的遮罩一起贴成一张图片的 —— ' +
    '能挪能删，但那块的遮罩在 PowerPoint 里改不了',
  clipPath: 'clip-path 裁出来的斜切/异形，在 pptx 里是个完整的矩形',
  glass: '毛玻璃（backdrop-filter）在 pptx 里没有，那一块只剩它自己的底色',
  blend: '混合模式（mix-blend-mode）在 pptx 里没有，那一块按原色画',
  filter: 'CSS 滤镜（filter：模糊/提亮那种）在 pptx 里没有',
  vertical: '竖排文字（writing-mode）在 pptx 里是横排的',
  svg: '内嵌 SVG 图标是当图片贴进去的（能挪能删，但改不了颜色和线条）',
  overflow: '这一块在网页上被裁掉了一截（overflow:hidden），而 pptx 的文本框不裁 —— 那几行会露出来',
  transform: '缩放/倾斜/3D 变换没还原（纯旋转是还原了的）',
  textGradient: '渐变填充的大数字退成了渐变的第一个色',
};

/** 同时最多几份在导。超了直接拒（见文件头 ⑥）。 */
const MAX_CONCURRENT = 2;
let running = 0;

export async function exportDeckPptx(
  pages: DeckPageInput[],
  total: number,
  meta: DeckMeta,
  baseUrl: string
): Promise<PptxExportResult> {
  if (running >= MAX_CONCURRENT) {
    throw new PptxExportError(
      `服务器上已经有 ${running} 份稿子在导 pptx（这一步要开浏览器把每一页渲染一遍）—— ` +
        `等几十秒再点一次；同时导太多会把后端挤爆。`
    );
  }
  // 拼装、改地址、占位图计数全走 .html 那条路（同一份 buildDeck，缺页会被它拒掉）。
  // **它的 warnings 这里不能照抄**：那几句说的是「文件里的图片地址指向 xxx，打不开就是破图」，
  // 而 pptx 里图是字节贴进去的 —— 照抄的话用户会去查一个压根不存在的问题。
  const { html, filename, placeholders } = exportDeck(pages, total, meta, baseUrl);
  running++;
  let browser: Browser | null = null;
  try {
    browser = await launch();
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    // `setContent` + 绝对地址：图走 baseUrl 从平台上取。**服务器取不到那个地址时图是空白框**，
    // 所以下面数了 `broken` 并在提示里点名（见 `pptxNotes`）。
    await page.setContent(html, { waitUntil: 'load' });
    // esbuild（keepNames）会把下面 evaluate 里的具名函数编译成 `__name(fn, '…')`，而那个助手只
    // 存在于 Node 这一侧 —— 浏览器里是 `ReferenceError: __name is not defined`，报错指向 evaluate
    // 内部第 1 行，完全看不出成因。dist（tsc）不这么干，但**用 tsx 跑同一份代码时会**（脚本、
    // 冒烟、以后可能的 vitest e2e），所以补一个同名恒等函数进页面。
    // 用 `addScriptTag` 而不是 `addInitScript`：后者只在导航时注入，`setContent` 之后不生效
    // （实测就是上面那个 ReferenceError）。
    await page.addScriptTag({ content: 'globalThis.__name = globalThis.__name || ((f) => f)' });
    await page.addStyleTag({
      content:
        // `.slide` 的显隐是 opacity + 0.5s 过渡。刚翻到这一页就量的话那一刻 opacity 还是 0，
        // 整页会被当成不可见跳过 —— 结果是除第一页以外每页都空白，而文件本身打开完全正常。
        '.slide,.slide *{transition:none!important;animation:none!important}' +
        // 整页那层 3.5% 噪点肌理（`#stage::after` 的 svg 底纹）要关掉。它压在所有东西上面
        // （z-index:40），而截图那一步是「把这块矩形范围内画面上的样子截下来」—— 留着的话每一张
        // 贴进 pptx 的图上都糊着一层噪点，**每个像素都不一样**，jpeg 压不动，体积翻倍。
        '#stage::after{display:none!important}' +
        // 被实体化过的那些元素，原来的伪元素要杀掉（见 walkPage 里那一段）。不杀的话同一处装饰
        // 有两份，半透明的那种（照片上的遮罩、幕帘）颜色深一倍 —— 而整页看起来只是「这块偏暗」。
        '#stage [data-pptx-nopseudo]::before,#stage [data-pptx-nopseudo]::after{content:none!important}',
    });
    // 字体：等它，但**不为它卡死**（服务器取不到 Google Fonts 是常态）。取不到时喊一句。
    await page.evaluate(() => Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 8000))]));
    const fontsOk = await page.evaluate(
      () => document.fonts.check('700 54px "Noto Serif SC"', '标题') && document.fonts.check('400 24px "Noto Sans SC"', '正文')
    );
    const count = await page.evaluate(() => document.querySelectorAll('.slide').length);
    if (!count) {
      throw new PptxExportError('渲染出来的这份 deck 里一页幻灯片都没有（template 的插入点被改坏了？）—— 不给导一份空文件。');
    }

    const PptxGenJS: any = (PptxModule as any).default || PptxModule;
    const pptx = new PptxGenJS();
    pptx.defineLayout({ name: 'DECK', width: SLIDE_W, height: SLIDE_H });
    pptx.layout = 'DECK';

    let textBlocks = 0, shapes = 0, images = 0, broken = 0;
    const textless: number[] = [];
    /** 类别 → 出现在哪几页 + 一共几处。「涉及几页」才是他决定要不要回去改模板的那个数。 */
    const degrade: Record<string, { places: number; pages: number[] }> = {};
    for (let i = 0; i < count; i++) {
      const walk = await walkPage(page, i);
      broken += walk.broken;
      const t = walk.nodes.filter((n) => n.kind === 'text').length;
      if (!t) textless.push(i + 1);
      textBlocks += t;
      shapes += walk.nodes.filter((n) => n.kind === 'shape').length;
      images += walk.nodes.filter((n) => n.kind === 'image').length;
      for (const [k, v] of Object.entries(walk.degrade)) {
        const e = degrade[k] || (degrade[k] = { places: 0, pages: [] });
        e.places += v;
        e.pages.push(i + 1);
      }
      await emitPage(pptx, page, walk);
    }

    const buf: Buffer = (await pptx.write({ outputType: 'nodebuffer' })) as Buffer;
    return {
      filename: filename.replace(/\.html$/i, '') + '.pptx',
      base64: buf.toString('base64'),
      bytes: buf.length,
      pages: count,
      textBlocks,
      shapes,
      images,
      warnings: pptxNotes({ fontsOk, textless, placeholders, broken, bytes: buf.length, degrade, pages: count }),
    };
  } finally {
    running--;
    await browser?.close().catch(() => {});
  }
}

/**
 * 起 chromium。**装不上浏览器时要把原文喊出来**：合成一句「导出失败」的话，用户看到的是
 * 「这个功能坏了」，而实际要做的是在服务器上跑一次 `npx playwright install chromium`。
 */
async function launch(): Promise<Browser> {
  try {
    const { chromium } = await import('playwright');
    return await chromium.launch({ headless: true });
  } catch (e: any) {
    throw new PptxExportError(
      `服务器上起不了浏览器，pptx 导不了（.html 那条路不受影响）：${e?.message || e}。` +
        `多半是这台机器没装 chromium —— 在 server 目录下跑一次 \`npx playwright install chromium\`。`
    );
  }
}

/**
 * 导出后用户会当面发现、而文件自己打开完全正常的那几件事。**纯函数**，所以有测试盯着：
 * 这几句话是这条路上唯一的「降级出声」，漏掉哪一条都不会有任何一处报错。
 */
export function pptxNotes(s: {
  fontsOk: boolean;
  textless: number[];
  placeholders: number;
  broken: number;
  bytes?: number;
  /** 类别 → 一共几处 + 出现在哪几页，键见 `DEGRADE_NOTE`。 */
  degrade?: Record<string, { places: number; pages: number[] }>;
  /** 总页数，只用来判断「几乎每页都有」时别去列 65 个页号。 */
  pages?: number;
}): string[] {
  const out: string[] = [];
  if (!s.fontsOk) {
    out.push(
      '服务器上没取到 Noto Sans/Serif SC（Google Fonts 拉不到），每一块字的位置和宽度是按回落字体' +
        '量出来的：导出的 pptx 里会有几行位置偏一点或者换行不一样，而文件本身打开是正常的。'
    );
  }
  if (s.broken) {
    out.push(
      `有 ${s.broken} 张图服务器自己没取到（导出时它是从平台地址取图的），pptx 里那几格是空的 —— ` +
        `多半是这台服务器访问不到导出地址，或者图存在别的实例的磁盘上。`
    );
  }
  if (s.placeholders) {
    out.push(`还有 ${s.placeholders} 格是占位图（灰底的那种），pptx 里它们就是灰块 —— 先点「配全部图」再导。`);
  }
  if (s.textless.length) {
    out.push(
      `第 ${s.textless.join('、')} 页一块可编辑文本都没有 —— 那几页在 PowerPoint 里双击不出光标（整页改不了字）。`
    );
  }
  // 「哪一类在 pptx 里压根画不出来」：按**涉及几页**排（不是按处数）—— 一页里出现 40 次的东西
  // 看起来比 60 页各出现一次的更严重，而后者才是要回去改模板的那个。
  for (const [k, e] of Object.entries(s.degrade || {}).sort((a, b) => b[1].pages.length - a[1].pages.length)) {
    const where =
      s.pages && e.pages.length > 6
        ? `${e.pages.length} 页里共 ${e.places} 处`
        : `第 ${e.pages.join('、')} 页共 ${e.places} 处`;
    out.push(`${DEGRADE_NOTE[k] || k}（${where}）。`);
  }
  // 大小要报出来：图是逐块贴进去的，图多的稿子几十 MB 很正常，而「附件发不出去 / 微信传不了」
  // 这件事只有他要发给别人时才撞上，那时没有一处能说明体积是怎么来的。
  if (s.bytes && s.bytes > 20 * 1024 * 1024) {
    out.push(
      `这份 pptx 有 ${(s.bytes / 1024 / 1024).toFixed(0)} MB（图是一张张贴进去的，图多就这么大）—— ` +
        `邮件附件和微信可能发不出去，用网盘或者只导要用的那几页。`
    );
  }
  // 这一条**每次都要说**：整页不再是一张图了，所以位置是我们按服务器上这台浏览器量出来的。
  // 不说的话「客户那边有几行挤在一起」会被当成导出坏了，而实际是他机器上没装那两个字体。
  out.push(
    '这份里每一块都是独立对象（文本框 / 色块 / 图片），能挪、能删、能改色 —— 代价是位置按服务器上' +
      '量的字宽摆的：客户机器上没装 Noto Sans/Serif SC 时，会有个别小标题挤在一起或者多折一行。'
  );
  return out;
}

/**
 * 走一页的 DOM，出一张「哪些块、摆哪里、什么样」的表。整段在浏览器里跑（`page.evaluate`）。
 * 这里面每一条注释都对应踩过一次的坑，改之前先读。
 */
async function walkPage(page: Page, index: number): Promise<PageWalk> {
  return page.evaluate((k) => {
    const stage = document.getElementById('stage')!;
    stage.style.transform = 'none'; // fit() 把整页缩放过；不关的话每一块都挤在左上角
    const slides = [...document.querySelectorAll<HTMLElement>('.slide')];
    // 翻页走**页面自己的 `go()`**（页脚不导之后，「页码/进度条停在第 1 页」那个坑不再咬人了，
    // 但翻页仍然只走这一个入口）：go() 里除了 `.active` 还写页码、进度条、目录高亮，往后
    // 只要有一样东西是它写而这里自己 toggle 不到的，导出的每一页都会停在第 1 页的状态，
    // 而每页单看都完全正常。
    const w = window as any;
    if (typeof w.go === 'function') w.go(k);
    else slides.forEach((s, i) => s.classList.toggle('active', i === k));
    const slide = slides[k];
    const sr = stage.getBoundingClientRect();
    const S = 1920 / sr.width; // 保险：transform 万一没关掉也不会整页偏

    const nodes: any[] = [];
    const degrade: Record<string, number> = {};
    const bump = (key: string) => { degrade[key] = (degrade[key] || 0) + 1 };
    let broken = 0;
    let imgSeq = 0;
    const box = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { x: (r.left - sr.left) * S, y: (r.top - sr.top) * S, w: r.width * S, h: r.height * S };
    };

    // 这一页要走的两棵树：幻灯片本体 + 顶部那条 5px 色带。色带在 `.slide` **外面**（`#stage` 的
    // 兄弟节点），不单独走的话 pptx 里每一页上边缘那条品牌色线都没有，而页面看起来只是「上面少了条线」。
    //
    // **页脚整块不导**（品牌名 + 主题 + 进度条 + 「3 / 12」页码）—— 他要的：pptx 里不要页脚、
    // 不要分页。三点连着的：① 只能是「不走这棵树」，不能用 `display:none` 把它藏掉再走 ——
    // `#footer` 是 `#stage` 的 flex 子项，藏掉之后 `#slides` 的高度和每一块字量出来的位置全都
    // 变了一档，而导出的每一页看起来只是「排得比网页上松一点」；② 网页那份（.html）照旧有页脚，
    // 放映靠它看进度，所以别去改 template；③ 页脚原来每页都贡献 2–3 块文字，所以
    // `pptxNotes` 里那句「第 N 页一块可编辑文本都没有」在这之前**永远不可能出现** ——
    // 现在它才真的能响，纯图版式导成一页动不了的图会被它喊出来。
    const roots = [slide, document.getElementById('top-band')].filter(Boolean) as HTMLElement[];

    // ── 伪元素实体化：**必须在量任何东西之前** ──────────────────────────────
    // pptx 里没有「伪元素」这个东西，而这套模板 65 个版式里 65 个都用 `::before/::after` 画装饰
    // （照片上那层遮罩、幕帘、小三角、引号、竖线、色条）。所以先把它们换成**真的节点**：把伪
    // 元素的 computed style 一条条抄到一个 `<i>` 上，插进同一个元素里（`::before` 插最前、
    // `::after` 插最后），同时给那个元素打个标记让上面那条 `content:none` 把原来的伪元素杀掉。
    //
    // 三条要留意的：
    // ① 抄的是 **computed style（用值，px）**，所以插进去之后布局和原来一模一样；`content` 那条
    //    **不能抄**（真元素上抄过去在 Chrome 里不生效，反而会把里面的文字吃掉），伪元素自己的
    //    文字（引号、箭头、循环符号）用 textContent 补。
    // ② 原来那个伪元素必须**同时**杀掉，不然同一处装饰有两份：半透明的那种（照片遮罩、幕帘）
    //    颜色深一倍，而整页看起来只是「这张图偏暗」，没有一处报错。
    // ③ `<img>`/`<br>`/svg 这类装不了子节点的标签只能跳过（它们本来也很少挂装饰）—— 跳过的
    //    要 bump('pseudo') 报出去，不报的话那个装饰在 pptx 里凭空消失而谁都不知道。
    const inline = 'http://www.w3.org/1999/xhtml';
    for (const root of roots) {
      for (const el of [root, ...root.querySelectorAll<HTMLElement>('*')]) {
        if (el.namespaceURI !== inline) continue; // svg 里面的 path/g 之类
        for (const p of ['::before', '::after']) {
          const pcs = getComputedStyle(el, p);
          const c = pcs.content;
          if (!c || c === 'none' || c === 'normal') continue;
          if (/^(IMG|BR|INPUT|HR|TEXTAREA|SELECT)$/.test(el.tagName)) { bump('pseudo'); continue }
          // `url()/counter()/attr()` 这种生成内容抄不过去（模板里目前只有 "" 和三个字符），
          // 装饰盒子照旧实体化，但要报一句 —— 不报的话那个图标/编号在 pptx 里没了。
          if (/\b(url|counter|counters|attr|image-set)\(/.test(c)) bump('pseudo');
          const deco = document.createElement('i');
          for (let j = 0; j < pcs.length; j++) {
            const prop = pcs[j];
            if (prop === 'content') continue;
            deco.style.setProperty(prop, pcs.getPropertyValue(prop));
          }
          const m = c.match(/^"([\s\S]*)"$|^'([\s\S]*)'$/);
          if (m) deco.textContent = m[1] ?? m[2] ?? '';
          deco.setAttribute('data-pptx-pseudo', '');
          if (p === '::before') el.insertBefore(deco, el.firstChild);
          else el.appendChild(deco);
          el.setAttribute('data-pptx-nopseudo', '');
        }
      }
    }

    // ── 旋转：先把「旋转 + 位移」这类 transform **摘掉**再量 ────────────────────
    // `transform` 不影响布局，所以摘掉之后量到的正是「没转之前」的盒子，再拿矩阵把中心点算
    // 回去、角度交给 pptx 的 `rotate` 就还原得回来。不摘的话量到的是**转完之后的外接矩形**
    // （比元素本身大、还是正的）：斜卡片会变成一个更大的正方块，上面的字和图照旧是平的，
    // 看起来是「整片没对齐」。
    const spun: { el: HTMLElement; a: number; ox: number; oy: number; m: DOMMatrixReadOnly }[] = [];
    const rotated: HTMLElement[] = [];
    for (const root of roots) {
      for (const el of [root, ...root.querySelectorAll<HTMLElement>('*')]) {
        const t = getComputedStyle(el).transform;
        if (t === 'none') continue;
        const m = new DOMMatrixReadOnly(t);
        // 只认「旋转 + 位移」（两轴等长且垂直、不翻转）。缩放/倾斜/3D 摘掉之后尺寸会真的变，
        // 硬还原会把一块画到别处去 —— 那种就让它按未变换的样子画，并 bump('transform')。
        const ok = m.is2D && Math.abs(Math.hypot(m.a, m.b) - 1) < 0.01 && Math.abs(Math.hypot(m.c, m.d) - 1) < 0.01
          && Math.abs(m.a * m.c + m.b * m.d) < 0.02 && m.a * m.d - m.b * m.c > 0;
        if (!ok) continue;
        rotated.push(el);
        spun.push({ el, m, a: (Math.atan2(m.b, m.a) * 180) / Math.PI, ox: 0, oy: 0 });
      }
    }
    // 两趟：**先全摘完再量原点** —— 边摘边量的话里层那个的原点还带着外层的变换。
    for (const el of rotated) el.style.transform = 'none';
    for (const s of spun) {
      const r = s.el.getBoundingClientRect();
      const [px, py] = getComputedStyle(s.el).transformOrigin.split(' ').map(parseFloat);
      s.ox = (r.left + (px || 0) - sr.left) * S;
      s.oy = (r.top + (py || 0) - sr.top) * S;
    }
    type Spin = typeof spun[number];
    // 盒子（未变换）+ 从里到外每一层变换 → 「摆哪里 + 转多少度」。`p' = O + M·(p − O)`：
    // 位移分量 e/f 也在 M 里 —— 只当纯旋转算的话 `rotate(1.6deg) translateY(24px)` 那张卡片上的
    // 字会回到没位移的位置（差 24px，看着就是没对齐）。
    const place = (bx: { x: number; y: number; w: number; h: number }, sp: Spin[]) => {
      let cx = bx.x + bx.w / 2, cy = bx.y + bx.h / 2, rot = 0;
      for (const s of sp) {
        const dx = cx - s.ox, dy = cy - s.oy;
        cx = s.ox + s.m.a * dx + s.m.c * dy + s.m.e * S;
        cy = s.oy + s.m.b * dx + s.m.d * dy + s.m.f * S;
        rot += s.a;
      }
      return { x: cx - bx.w / 2, y: cy - bx.h / 2, w: bx.w, h: bx.h, rot: +rot.toFixed(1) };
    };

    // `text-transform` 要自己算：取的是 textContent（原文），而屏幕上是 CSS 变形之后的样子 ——
    // 不算的话 kicker 那种 `uppercase` 的小标题在 pptx 里是小写，两份对不上。
    const cased = (t: string, mode: string) =>
      mode === 'uppercase' ? t.toUpperCase()
        : mode === 'lowercase' ? t.toLowerCase()
        : mode === 'capitalize' ? t.replace(/(^|\s)(\S)/g, (_m, a, b) => a + b.toUpperCase())
        : t;

    // 一块字里的**行内**结构拆成若干段（run）：`<b>` 加粗、`<em>` 斜体、`<span class=hl>` 换色。
    // 整块按最外层那一份样式写的话，句子里加粗的那几个词、标红的那个数字全被抹平成一样的字 ——
    // 而那一页读起来只是「没有重点」，没有一处报错。
    const collect = (node: HTMLElement, out: Run[]) => {
      const cs = getComputedStyle(node);
      const pre = /^(pre|pre-wrap|pre-line|break-spaces)$/.test(cs.whiteSpace);
      const norm = (t: string) => (pre ? t : t.replace(/[\s ]+/g, ' '));
      const style = (): Omit<Run, 't'> => ({
        bold: Number(cs.fontWeight) >= 600,
        italic: cs.fontStyle === 'italic',
        color: cs.color,
        sizePx: parseFloat(cs.fontSize),
        serif: /Serif/i.test(cs.fontFamily),
      });
      for (const cn of [...node.childNodes]) {
        if (cn.nodeType === 3) {
          const t = cased(norm(cn.textContent || ''), cs.textTransform);
          if (t) out.push({ t, ...style() });
        } else if (cn.nodeType === 1) {
          const ce = cn as HTMLElement;
          // `<br>` 的 textContent 是空的，不认它的话硬换行的两三行会并成一行（框宽只够一行 →
          // 后面的字直接被挤出框外）。
          if (ce.tagName === 'BR') { out.push({ t: '\n', ...style() }); continue; }
          const ccs = getComputedStyle(ce);
          if (ccs.display === 'none' || ccs.visibility === 'hidden') continue;
          if (ccs.display.startsWith('inline')) collect(ce, out);
        }
      }
    };

    // 画的先后：**不能照 DOM 顺序**。CSS 里 `z-index:-1` 的那层肌理在自己父块的背景之上、内容
    // 之下，`z-index:1` 的幕帘在照片之上、正文之下 —— 照 DOM 顺序塞进 pptx 的话（伪元素实体化
    // 之后它们是**最后一个子节点**）那层幕帘会压在这一页所有色块上面，整页闷掉一档，而每一块
    // 都在、位置也对，看起来像「这版设计偏暗」。所以每个节点带一串「从根到自己、每层 (z, 第几个
    // 子节点)」的键，画之前按这串键排一遍：同一层里先按 z-index，再按 DOM 顺序，父块自己的底色
    // 因为键更短所以排在自己所有子节点之前。
    const zOf = (cs: CSSStyleDeclaration) => (cs.zIndex === 'auto' ? 0 : parseInt(cs.zIndex, 10) || 0);
    const visit = (el: HTMLElement, insideText: boolean, alphaIn: number, spins: Spin[], ord: number[]) => {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return;
      // opacity 是**连乘**的（页/卡片/这一行各带一层）。只看自己那一层的话，祖先上写着 .6 的
      // 次要区块在 pptx 里全按原色画，整页比网页版重一档。
      const alpha = alphaIn * (Number.isFinite(Number(cs.opacity)) ? Number(cs.opacity) : 1);
      const b = box(el);
      const mine = spun.find((s) => s.el === el);
      const sp = mine ? [mine, ...spins] : spins; // 自己那一层最先作用，然后才是外面几层
      const clipText = (cs as any).webkitBackgroundClip === 'text' || (cs as any).backgroundClip === 'text';

      // pptx 里压根没有对应画法的那些，逐条数出来（`pptxNotes` 会把它们变成话）。
      // 伪元素不在这里数 —— 上面已经实体化成真节点了，只有实体化不了的那几种才 bump。
      if (cs.clipPath !== 'none') bump('clipPath');
      if (cs.backdropFilter && cs.backdropFilter !== 'none') bump('glass');
      if (cs.mixBlendMode !== 'normal') bump('blend');
      if (cs.filter !== 'none') bump('filter');
      if (cs.writingMode !== 'horizontal-tb') bump('vertical');
      // 纯旋转已经按角度还原了（上面 spun），这里只报缩放/倾斜那种真还不了的。
      if (cs.transform !== 'none' && !mine) bump('transform');
      if (clipText) bump('textGradient');

      // ── 形状：有底色 / 有边框 / 有渐变底的块 ──────────────────────────
      const bgc = cs.backgroundColor;
      const hasBg = bgc !== 'rgba(0, 0, 0, 0)' && bgc !== 'transparent';
      const borders = (['Top', 'Right', 'Bottom', 'Left'] as const).map((side) => ({
        side: side.toLowerCase() as Side['side'],
        w: parseFloat((cs as any)['border' + side + 'Width']) || 0,
        color: (cs as any)['border' + side + 'Color'] as string,
      }));
      const bw = Math.max(...borders.map((s) => s.w));
      const bgi = cs.backgroundImage;
      const gradient = bgi !== 'none' && !bgi.includes('url(');
      const firstColor = bgi.match(/rgba?\([^)]+\)|#[0-9a-f]{3,8}/i)?.[0] || null;
      if (gradient && !clipText) bump('gradient');
      // **`background-clip:text` 的块不出形状。** 那种渐变只在字的笔画里可见，当成一块底色画出来
      // 就是一条横贯整格的色带，把它自己那个大数字盖掉 —— 而那一格看起来「设计上就有条色带」。
      if ((hasBg || bw > 0 || (gradient && !clipText)) && b.w >= 2 && b.h >= 2) {
        nodes.push({
          kind: 'shape', ...place(b, sp), alpha, ord,
          fill: hasBg ? bgc : gradient && !clipText ? firstColor : null,
          radius: parseFloat(cs.borderTopLeftRadius) || 0,
          borders: borders.filter((s) => s.w > 0),
        });
      }

      // ── 图：`<img>` / 内嵌 svg / 用 CSS 背景图铺的空块 ───────────────────
      // 三种都截成像素再贴（见文件头 ②）。CSS 背景图那种**只在它自己没内容时**才这么办：
      // 有子节点或有字的话截图会把那些一起烙进去，然后下面又各画一份，屏幕上是叠着两层。
      // （以后要是把伪元素实体化成真节点，这个「没有子节点」的判断要跟着放行那种节点，
      //  不然 `.p5-visual` 那几块的背景图会整片消失。）
      // 「实体化出来的那个装饰节点」不算内容：不放行的话 `.p5-visual`/`.hero-case`/`.photo`
      // 那几块（自己带一层 `::after` 遮罩）会因为「有子节点」走不到这条路上，整张背景图消失，
      // 而那一页看起来只是「留白多」。它们的遮罩因此是**烙进这张图**的（在提示里说了）。
      const kids = [...el.children].filter((c) => !c.hasAttribute('data-pptx-pseudo'));
      const ownText = [...el.childNodes].some((n) => n.nodeType === 3 && (n.textContent || '').trim());
      const cssBgOnly = bgi.includes('url(') && !kids.length && !ownText;
      const isSvg = el.tagName.toLowerCase() === 'svg';
      if (el.tagName === 'IMG' || isSvg || cssBgOnly) {
        // 服务器取不到那张图时 `naturalWidth` 是 0：截出来是个空白块，而整页看起来只是
        // 「这一页留白多」。数出来，让上层喊（`pptxNotes`）。
        if (el.tagName === 'IMG' && !(el as HTMLImageElement).naturalWidth) { broken++; return }
        if (isSvg) bump('svg');
        if (cssBgOnly) bump('cssBg');
        // 0 尺寸的块不能交给 playwright 截（它会在「element is not visible」上等到 30 秒超时）。
        if (b.w >= 1 && b.h >= 1) {
          const id = `i${k}-${++imgSeq}`;
          el.setAttribute('data-pptx-img', id);
          nodes.push({ kind: 'image', ...place(b, sp), alpha, ord, id });
        }
        return; // 里面的东西（svg 的 path、img 没有子节点）已经在像素里了
      }

      // ── 文字：**自己直接挂着文字**的那一层才算 ──────────────────────────
      // （不然一句话会被外面每一层容器各报一遍。）取的必须是「自己的文字 + 行内子节点的文字」，
      // **不能用 `innerText`**：`innerText` 会把块级子节点的文字也捞进来，而下面的行盒只量自己
      // 这几行 —— 「序号圆点 + 一句话」那种 flex 行于是变成「一个两行的文本框塞在一行的位置
      // 上」，序号被顶到句子上面一行去，而圆点自己还在原位：看起来就是「序号和文字错位了」。
      const runs: Run[] = [];
      collect(el, runs);
      if (runs.length) {
        runs[0].t = runs[0].t.replace(/^\s+/, '');
        runs[runs.length - 1].t = runs[runs.length - 1].t.replace(/\s+$/, '');
      }
      // 样式一样的相邻两段并起来（`<span>` 套 `<span>` 很常见），省得一句话被切成十几个 run。
      const merged: Run[] = [];
      for (const r of runs) {
        if (!r.t) continue;
        const last = merged[merged.length - 1];
        if (last && last.bold === r.bold && last.italic === r.italic && last.color === r.color
          && last.sizePx === r.sizePx && last.serif === r.serif) last.t += r.t;
        else merged.push({ ...r });
      }
      const own = merged.map((r) => r.t).join('');
      let textHere = false;
      if (own.trim() && !insideText) {
        textHere = true;
        // **只有自己 `overflow:hidden/clip` 的块才算「被裁」。** 只看 scrollHeight > clientHeight
        // 的话，任何一个内容比自己高、但溢出照旧可见的块都会被报成「已经裁了一截」—— 那是一句
        // 假警报，而它读起来像「你的版式坏了」。
        if (/hidden|clip/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 2) bump('overflow');
        // **文字的位置要按行盒量，不能拿元素盒的左上角当文本框原点。** 元素盒含 padding，而且
        // 文字常常被 flex/行高顶到中间 —— 表格单元格、小胶囊、序号圆点里的字于是整片往左上偏
        // 一截，而每个字都在、颜色也对，看起来像「这版式有点松」。行数也用行盒的 top 去重数，
        // 不用 `scrollHeight / lineHeight` 猜（有 padding 的块猜出来一律 ≥2 行，下面那条
        // 「单行不换行」就永远不生效）。
        const rects: DOMRect[] = [];
        for (const cn of [...el.childNodes]) {
          if (cn.nodeType === 3) {
            const rg = document.createRange();
            rg.selectNodeContents(cn);
            rects.push(...([...rg.getClientRects()] as DOMRect[]));
          } else if (cn.nodeType === 1 && getComputedStyle(cn as Element).display.startsWith('inline')) {
            // 行内的 `<b>/<em>/<span>` 也算进来：漏掉的话并集比看到的字窄，pptx 里末尾会被挤下去。
            rects.push(...([...(cn as Element).getClientRects()] as DOMRect[]));
          }
        }
        const ink = rects.filter((r) => r.width > 0 && r.height > 0);
        const lines = new Set(ink.map((r) => Math.round(r.top))).size || 1;
        const r0 = el.getBoundingClientRect();
        const inset = (k2: string) => (parseFloat((cs as any)['border' + k2 + 'Width']) || 0) + (parseFloat((cs as any)['padding' + k2]) || 0);
        // 多行的块用**内容盒**的宽（CSS 就是按这个宽度折行的）。用行盒并集的话宽度 = 最宽那一行，
        // 比 CSS 窄几个像素，于是每行末尾的词都掉到下一行，一路串下去多出一两行并从框底溢出。
        const cw = Math.max(1, r0.width - inset('Left') - inset('Right'));
        const tb = ink.length
          ? lines === 1
            ? {
                x: (Math.min(...ink.map((r) => r.left)) - sr.left) * S,
                y: (Math.min(...ink.map((r) => r.top)) - sr.top) * S,
                w: (Math.max(...ink.map((r) => r.right)) - Math.min(...ink.map((r) => r.left))) * S,
                h: (Math.max(...ink.map((r) => r.bottom)) - Math.min(...ink.map((r) => r.top))) * S,
              }
            : {
                x: (r0.left + inset('Left') - sr.left) * S,
                y: (Math.min(...ink.map((r) => r.top)) - sr.top) * S,
                w: cw * S,
                h: (Math.max(...ink.map((r) => r.bottom)) - Math.min(...ink.map((r) => r.top))) * S,
              }
          : b;
        nodes.push({
          kind: 'text', ...place(tb, sp), alpha, ord,
          runs: merged,
          sizePx: parseFloat(cs.fontSize),
          color: cs.color,
          align: cs.textAlign,
          serif: /Serif/i.test(cs.fontFamily),
          lineHeight: parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4,
          // `normal` 时 parseFloat 是 NaN，直接传给 pptx 会写出一个坏的 spc 值
          spacingPx: parseFloat(cs.letterSpacing) || 0,
          lines,
          // 渐变填字的块本身 `color: transparent`，照着写进 pptx 就是**一整块隐形的字**
          // （那一格看起来只是空着，而文本框、内容、位置全都在）。退成渐变的第一个色。
          fillHint: clipText ? firstColor : null,
        });
      }
      // 只有**行内**子节点的文字算在上面那一块里，块级子节点要自己出一块（它的文字压根没被
      // 上面收走）。一律传 `true` 的话，flex 行里的序号圆点、卡片里的小标签会整片消失。
      [...el.children].forEach((child, i) => {
        const ccs = getComputedStyle(child);
        const inlineChild = ccs.display.startsWith('inline') || child.tagName === 'BR';
        visit(child as HTMLElement, insideText || (textHere && inlineChild), alpha, sp, [...ord, zOf(ccs), i]);
      });
    };
    // 三棵树按它们自己的 z-index 排（`.slide` 5 / 页脚 50 / 顶部色带 60）—— 顶部那条色带压在最上面。
    roots.forEach((root, i) => visit(root, false, 1, [], [zOf(getComputedStyle(root)), i]));
    return { nodes, broken, degrade };
  }, index);
}

/** 把一页画成一张 pptx 幻灯片：色块和图先画完，文字最后画（见文件头 ①）。 */
async function emitPage(pptx: any, page: Page, walk: PageWalk): Promise<void> {
  const slide = pptx.addSlide();
  // 图要先都截出来（异步），再按顺序画 —— 边画边截的话顺序和上面那条「文字最后」冲不上。
  const shots = new Map<string, { mime: string; b64: string }>();
  for (const n of walk.nodes) {
    if (n.kind === 'image') shots.set(n.id, await shootNode(page, n));
  }
  // 色块和图按上面那串键排（同一层先 z-index 再 DOM 顺序），文字一律最后画：字被自己身后
  // 某个兄弟节点的底色盖住是这条路上最容易出的错，而那一页看起来只是「这里本来有块色」。
  const cmp = (a: Node, b: Node) => {
    for (let i = 0; i < Math.max(a.ord.length, b.ord.length); i++) {
      const d = (a.ord[i] ?? -Infinity) - (b.ord[i] ?? -Infinity);
      if (d) return d;
    }
    return 0;
  };
  for (const n of [...walk.nodes.filter((x) => x.kind !== 'text').sort(cmp), ...walk.nodes.filter((x) => x.kind === 'text')]) {
    if (n.kind === 'shape') emitShape(pptx, slide, n);
    else if (n.kind === 'image') {
      const shot = shots.get(n.id)!;
      slide.addImage({
        data: `${shot.mime};base64,${shot.b64}`,
        x: inch(n.x), y: inch(n.y), w: inch(n.w), h: inch(n.h), rotate: n.rot || undefined,
      });
    } else emitText(slide, n);
  }
}

function emitShape(pptx: any, slide: any, n: ShapeNode): void {
  // 四条边一样时才用形状自己的描边。**只有一两条边有边框的（模板里到处是 `border-left:4px`
  // 这种色条、`border-bottom` 这种标题下划线），照最大边宽给描边的话 pptx 里画出来是整整一圈
  // 框** —— 而每一块单看都「有个框」，读起来像设计本来就这样。那种一律不给描边，改成按边各画
  // 一个细长矩形（pptx 里就是个 rect，客户还能单独删）。
  const bs = n.borders;
  const uniform = bs.length === 4 && bs.every((s) => s.w === bs[0].w && s.color === bs[0].color);
  // `border-radius:50%`（序号圆点、圆形箭头按钮）要画成**椭圆**，不是圆角方块 —— 一律 roundRect
  // 的话一整页的圆点全成了方片，而每一个单看都还「像个设计」。胶囊（999px 的药丸标签）留在
  // roundRect，但**圆角要给足**：不传 `rectRadius` 时 pptxgenjs 用它自己那点小圆角，药丸会变方角条。
  const short = Math.min(n.w, n.h);
  const circle = Math.abs(n.w - n.h) <= short * 0.15 && n.radius * 2 >= short - 1;
  const type = circle ? pptx.ShapeType.ellipse : n.radius > 8 ? pptx.ShapeType.roundRect : pptx.ShapeType.rect;
  slide.addShape(type, {
    x: inch(n.x), y: inch(n.y), w: inch(n.w), h: inch(n.h), rotate: n.rot || undefined,
    rectRadius: type === pptx.ShapeType.roundRect ? Math.min(inch(n.radius), inch(short / 2)) : undefined,
    fill: n.fill ? { color: hex(n.fill), transparency: transp(n.fill, n.alpha) } : { type: 'none' },
    line: uniform ? { color: hex(bs[0].color), width: bs[0].w * PX_TO_PT, transparency: transp(bs[0].color, n.alpha) } : { type: 'none' },
  });
  if (uniform) return;
  // pptx 的 `rotate` 是绕**各自**的中心转的。几条边分开画之后，得先把每条边的中心绕整块的中心
  // 转过去，再让它自己也转同样的角度 —— 只给角度不搬中心的话，那几条边会散在原处各自打转。
  const cx = n.x + n.w / 2, cy = n.y + n.h / 2, a = ((n.rot || 0) * Math.PI) / 180;
  for (const s of bs) {
    // 边框画在 border-box **里侧**（getBoundingClientRect 已经含边框），所以贴着各自那条边。
    const r = s.side === 'top' ? { x: n.x, y: n.y, w: n.w, h: s.w }
      : s.side === 'bottom' ? { x: n.x, y: n.y + n.h - s.w, w: n.w, h: s.w }
      : s.side === 'left' ? { x: n.x, y: n.y, w: s.w, h: n.h }
      : { x: n.x + n.w - s.w, y: n.y, w: s.w, h: n.h };
    const dx = r.x + r.w / 2 - cx, dy = r.y + r.h / 2 - cy;
    const mx = cx + dx * Math.cos(a) - dy * Math.sin(a), my = cy + dx * Math.sin(a) + dy * Math.cos(a);
    slide.addShape(pptx.ShapeType.rect, {
      x: inch(mx - r.w / 2), y: inch(my - r.h / 2), w: inch(r.w), h: inch(r.h), rotate: n.rot || undefined,
      fill: { color: hex(s.color), transparency: transp(s.color, n.alpha) },
      line: { type: 'none' },
    });
  }
}

function emitText(slide: any, n: TextNode): void {
  // 单行的块再多给两成宽（按对齐方向让出去）。光靠下面的 `wrap:false` 不够：**有些阅读器
  // 直接无视 `wrap="none"`**（实测 macOS 的 QuickLook：spc/wrap 都写进 XML 了，照旧折行），
  // 那时候现象是「这份 pptx 在他那儿排版糊了」。
  const cushion = n.lines === 1 ? Math.max(8, n.w * 0.2) : 0;
  const cx = n.x - (n.align === 'center' ? cushion / 2 : n.align === 'right' ? cushion : 0);
  // 行内那几段各带自己的加粗/斜体/颜色/字号（`<b>`、标红的数字、大小混排的单位）。
  // 换行**自己拆成 `breakLine`**，不留 `\n` 在 run 的文字里：pptxgenjs 只对「中间带 \n」的
  // 字符串拆行，**末尾那个 \n 它不拆**（`match(/\n$/)` 那一条），于是 `<b>粗</b><br>正文`
  // 这种的换行会变成一个塞着 CRLF 的 run —— 在 PowerPoint 里那一行直接并到上一行去，
  // 而导出这一步和文件打开都不报错。
  const body: any[] = [];
  for (const r of n.runs) {
    const parts = r.t.split('\n');
    parts.forEach((p, i) => {
      body.push({
        text: p,
        options: {
          bold: r.bold,
          italic: r.italic || undefined,
          color: hex(n.fillHint || r.color),
          fontSize: +(r.sizePx * PX_TO_PT).toFixed(1),
          // 字族只能写**装机字体名**。写 CSS 变量名或写一个客户机器上没有的字体，PowerPoint 会
          // 静默换字，行宽全变、几乎每页都溢出，而导出这一步一切正常。
          fontFace: r.serif ? 'Noto Serif SC' : 'Noto Sans SC',
          // 透明度也要跟着 fillHint 走：拿 `transparent` 去算的话是 100%，字是「有内容但全透明」，
          // 那一格在 PowerPoint 里空着而框和文字都在，比画错更难查。
          transparency: transp(n.fillHint || r.color, n.alpha),
          breakLine: i < parts.length - 1 || undefined,
        },
      });
    });
  }
  slide.addText(body, {
    x: inch(cx), y: inch(n.y), w: inch(n.w + cushion), h: inch(n.h),
    // 块级这几个是**兜底**（run 里都带了一份）：不给的话 pptxgenjs 按它自己的默认值写段落属性，
    // 空段落和 `<br>` 那几行会掉回 18pt 黑体，一段话里凭空多出一行大字。
    // **但 `bold` 绝对不能放在这里**：pptxgenjs 会把块级选项里所有「run 上取值为假」的键覆盖
    // 下去（`if (!textObj.options[key])`），而不加粗的 run 上 `bold` 正是 `false` —— 于是
    // 「粗标题里夹一个细体的单位」「粗体行里那半句常规字重」会整片变粗，而那一页只是「看起来
    // 有点糊」，没有一处报错。
    fontSize: +(n.sizePx * PX_TO_PT).toFixed(1),
    color: hex(n.fillHint || n.color),
    fontFace: n.serif ? 'Noto Serif SC' : 'Noto Sans SC',
    align: n.align === 'center' ? 'center' : n.align === 'right' ? 'right' : 'left',
    // 字距要带上：kicker / 英文小标题那几行在 CSS 里拉开了 2-6px，不带的话它们在 pptx 里
    // 挤成一团，而每个字都在、导出也不报错。
    charSpacing: n.spacingPx ? +(n.spacingPx * PX_TO_PT).toFixed(1) : undefined,
    // 文本框宽度是按浏览器实测宽度给的，也就是**刚好一行**。换台机器字体一换（客户机器上
    // 大概没有 Noto Sans SC），同一句话宽一点点就折成两行，而框高只够一行 —— 现象是
    // kicker/小标题变成一团糊在一起的字，看起来像「这个版式排坏了」。浏览器里本来就只有
    // 一行的块一律禁止换行，让它像 CSS 里 overflow 可见那样溢出。
    wrap: n.lines > 1, rotate: n.rot || undefined,
    valign: 'top', margin: 0, lineSpacingMultiple: +(n.lineHeight / n.sizePx).toFixed(2), isTextBox: true,
  });
}

/**
 * 截一块（`<img>` / svg / CSS 背景图那种块）成像素。
 *
 * 截之前把**除它以外的一切都藏起来**（见文件头 ③）。用 `visibility` 而不是 z-index：
 * `.case-bg{z-index:-1}` / `.slide-inner{z-index:2}` 各自是一个层叠上下文，给里面那张图写多大
 * 的 z-index 都爬不出它父层 —— 试过，字照旧烙进去，只是背景亮度变了，更难看出哪儿不对。
 *
 * `scale:'css'` = 按 CSS 像素截（不跟 deviceScaleFactor 走）。设计稿 1920px 铺满 13.333in
 * 本身就是 144dpi，2 倍再截只是把体积翻四倍。
 */
async function shootNode(page: Page, n: ImageNode): Promise<{ mime: string; b64: string }> {
  await page.evaluate((id) => {
    const st = document.getElementById('pptx-solo') || Object.assign(document.createElement('style'), { id: 'pptx-solo' });
    // 「只放出这一块」那条必须**也带 `#stage`**：两条都写了 `!important` 之后比的是特异度，
    // `#stage *` 里有个 id（1,0,0）压得住光秃秃的属性选择器（0,1,0）—— 那样目标自己也一直是
    // hidden，playwright 会在「element is not visible」上死等到 30 秒超时。
    st.textContent = `#stage *{visibility:hidden!important}#stage [data-pptx-img="${id}"],#stage [data-pptx-img="${id}"] *{visibility:visible!important}`;
    document.head.appendChild(st);
  }, n.id);
  const buf = await page.locator(`[data-pptx-img="${n.id}"]`).screenshot({ omitBackground: true, scale: 'css' });
  await page.evaluate(() => document.getElementById('pptx-solo')?.remove());
  return shrink(page, buf.toString('base64'), n.w, n.h, n.alpha);
}

/**
 * 把截出来的 PNG 重编到「正好铺满它在页面上那块地方」的尺寸，不透明的转 JPEG。
 *
 * 借页面里的 canvas 做（省一个 sharp 依赖）。喂的是 **data: URL** —— 那种不算跨域，不会污染
 * canvas；直接拿 CDN 上那张原图画进去的话 `toDataURL` 抛 SecurityError，而那是真图上线之后
 * 才会出现的错，本机 demo（同源 svg）永远测不出来。
 *
 * `alpha` 是元素连乘的 opacity，**必须烙进像素**（见文件头 ④）：① 元素截图是按不透明截的
 * （`opacity:.22` 的底图截出来是一张实图），不补的话它把身下那块深色底盖成一张灰图 —— 整页从
 * 深色变浅色，每一块内容都在、位置也对，看起来像「这个版式本来是浅色的」（白字于是在浅底上
 * 几乎看不见）；② pptx 的 `transparency` 写出来的是 `<a:alphaModFix>`，**苹果那套渲染器直接
 * 忽略它**，症状是「在 PowerPoint 里对、在 Mac 上预览/Keynote 里整页发白」，两边都不报错。
 *
 * 有半透明像素时留 PNG：一律转 JPEG 的话带透明背景的图标会多出一块黑底/白底，而那一页看起来
 * 只是「这个图标的底色不对」。
 */
async function shrink(page: Page, pngB64: string, wPx: number, hPx: number, alpha = 1): Promise<{ mime: string; b64: string }> {
  return page.evaluate(
    async ({ b64, w, h, a }) => {
      const im = new Image();
      im.src = `data:image/png;base64,${b64}`;
      await im.decode();
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(w));
      c.height = Math.max(1, Math.round(h));
      const ctx = c.getContext('2d')!;
      ctx.globalAlpha = a;
      ctx.drawImage(im, 0, 0, c.width, c.height);
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      let opaque = true;
      for (let i = 3; i < d.length; i += 4) if (d[i] < 250) { opaque = false; break }
      const url = opaque ? c.toDataURL('image/jpeg', 0.86) : c.toDataURL('image/png');
      return { mime: opaque ? 'image/jpeg' : 'image/png', b64: url.split(',')[1] };
    },
    { b64: pngB64, w: wPx, h: hPx, a: alpha }
  );
}

function hex(css: string): string {
  const m = css.match(/rgba?\(([^)]+)\)/);
  if (!m) return css.replace('#', '').padEnd(6, '0').slice(0, 6).toUpperCase();
  const [r, g, b] = m[1].split(',').map((x) => Math.max(0, Math.min(255, Math.round(parseFloat(x)))));
  return [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
}

/** rgba 的 alpha × 元素连乘的 opacity → pptxgenjs 的 transparency（0=不透明，100=全透）。 */
function transp(css: string, opacity = 1): number {
  const m = css.match(/rgba\(([^)]+)\)/);
  const a = m ? parseFloat(m[1].split(',')[3] ?? '1') : 1;
  return Math.round((1 - (Number.isFinite(a) ? a : 1) * opacity) * 100);
}
