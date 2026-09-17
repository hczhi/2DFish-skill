// 可编辑 pptx 的**探针**（T1）：只读，不写库、不调 AI、不碰 `exportService`。
//
// 要回答的问题只有一个：**我们这套 HTML，照 pptxgenjs 的三个原语（addText / addShape /
// addImage）能还原多少，还剩多少东西压根认不出来。** 先量出这个数再决定要不要做导出功能 ——
// 反过来先写功能的话，做完才发现半页都得截图（客户拿到的 pptx 里那半页一个字都改不了），
// 而那份 pptx 打开时看起来是完整的一份稿子。
//
// 用法（Node 必须 21.7.3）：
//   ./node_modules/.bin/tsx scripts/probe-pptx.mts            # 默认 L2,L47,L16
//   ./node_modules/.bin/tsx scripts/probe-pptx.mts L4,L45,L54 tmp/probe.pptx
//   ./node_modules/.bin/tsx scripts/probe-pptx.mts all tmp/all.pptx   # 全库扫一遍，出一张「哪些版式要修」的表
//
// 三条要留意的边界，不然量出来的数会骗人：
// ① **字体**。`template.html` 从 Google Fonts 拉 Noto Sans/Serif SC，拉不到的时候浏览器用
//    回落字体排版 —— 行宽、行数、每一块的高度全变，而量出来的数字看起来一样正常。所以下面
//    等 `document.fonts.ready` 并**核一遍 Noto 到底有没有生效**，没生效就在结论里喊出来。
// ② **只有 `.active` 那一页是可见的**（`.slide` 默认 `visibility:hidden`）。不逐页切 active
//    就量的话，除第一页以外每页都是「0 个文本、0 个形状」，读起来像「这些版式很简单」。
// ③ **`fit()` 把 `#stage` 缩放过**。直接拿 `getBoundingClientRect()` 当设计稿坐标的话，
//    整页坐标按缩放比例整体偏小，pptx 里每一块都挤在左上角 —— 而每一块单看都在页面上。
//    所以先把 transform 关掉，并且照 `#stage` 的实测宽度再归一化一次。
import fs from 'fs';
import path from 'path';
import http from 'http';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';
// pptxgenjs 4.x 是 CJS/ESM 双发布，tsx 里拿到的是 `{ default: ctor }` —— 直接 `new` 那个命名空间
// 会报 "not a constructor"。
import PptxModule from 'pptxgenjs';
import { demoFragments, demoIds } from '../src/services/ppt/demoDeck.js';
import { assembleDeck } from '../src/services/ppt/deckShell.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');
/** demo 片段里的图都是 `/ppt-cases/ph-*.svg`，实体在前端的 public 下。 */
const publicRoot = path.join(repoRoot, 'client/public');

const arg = (process.argv[2] || 'L2,L47,L16').trim();
const ids = arg.toLowerCase() === 'all' ? demoIds() : arg.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
// 相对路径按**当前目录**解（不是仓库根）：按仓库根解的话，在 server/ 下敲 `tmp/x.pptx`
// 会写到仓库根的 tmp/ —— 那个目录不在 .gitignore 里，产物会跟着 git status 一起冒出来。
const outFile = path.resolve(process.argv[3] ? process.cwd() : path.join(repoRoot, 'server'), process.argv[3] || 'tmp/probe.pptx');

/** 设计稿 1920×1080 → pptx 13.333in × 7.5in，所以 1px = 1/144 in，字号 pt = px × 0.5。 */
const PX_TO_IN = 1 / 144;
const PX_TO_PT = 0.5;
const inch = (px: number) => +(px * PX_TO_IN).toFixed(3);

/**
 * 「认不出来」的分类。页面里 bump 的是短码，这里是给人看的全称 —— 扫全库时
 * 65 页 × 每页几行的话读不出「哪一类最该修」，所以短码用于逐页那一行，全称用于末尾汇总表。
 */
const DEGRADE: Record<string, string> = {
  pseudo: '伪元素装饰（::before/::after，DOM 里没有这个节点，只能整块截图）',
  gradient: '渐变底（pptx 里只能近似成纯色，或整块截图）',
  runs: '行内强调 <b>/<em>（pptx 要拆成多个 run 才保得住，否则整段变一个样式）',
  cssBg: 'CSS 背景图（background-image:url，不是 <img>，走不到 addImage）',
  edgeBorder: '单边边框/色条（已按边各画一个细长矩形；走形状描边会变成整圈框）',
  clipPath: 'clip-path 裁形',
  glass: 'backdrop-filter 毛玻璃',
  blend: 'mix-blend-mode 混合',
  filter: 'filter 滤镜',
  vertical: '竖排文字 writing-mode',
  transform: 'transform 缩放/倾斜/3D（纯旋转+位移已按角度还原，不进这一条）',
  textGradient: '文字渐变填充 background-clip:text（已退成渐变首色填字，不再画成整块色带）',
  overflow: '这一块自己 overflow:hidden 且内容更高（浏览器里已经裁掉一截）',
};

interface TextNode {
  kind: 'text';
  x: number; y: number; w: number; h: number;
  text: string; sizePx: number; bold: boolean; color: string; align: string;
  serif: boolean; lineHeight: number; runs: number; clipped: boolean;
  /** CSS letter-spacing（px）。丢掉它的话 kicker/英文小标题那种拉开字距的行会挤成一团。 */
  spacingPx: number;
  /** 自己连同祖先的 opacity 连乘。我们大量用 opacity 做次要文字，当成不透明画会明显变重。 */
  alpha: number;
  /** 浏览器里实际排了几行（按行盒数，不是按高度猜）。1 行的块在 pptx 里要禁止自动换行，见下。 */
  lines: number;
  /** `background-clip:text` 时字面上的 `color` 是 transparent，真正的颜色在渐变里 —— 拿渐变首色顶上。 */
  fillHint: string | null;
  /** 祖先/自己的纯旋转累加（度）。x/y/w/h 是**未旋转**的盒子。 */
  rot: number;
}
interface Side { side: 'top' | 'right' | 'bottom' | 'left'; w: number; color: string }
interface ShapeNode {
  kind: 'shape';
  x: number; y: number; w: number; h: number;
  fill: string | null; radius: number; gradient: boolean;
  /** 四条边各自的宽和色（**不是**一个总的边框）。见下面 emit 处：单边的要自己画细长矩形。 */
  borders: Side[];
  /** CSS 里转了多少度（纯旋转才认）。x/y/w/h 是**未旋转**的盒子，靠这个角度转回去。 */
  rot: number;
  alpha: number;
}
interface ImageNode {
  kind: 'image';
  x: number; y: number; w: number; h: number; rot: number;
  /** 自己连同祖先的 opacity 连乘。**playwright 截元素时不带自己那层 opacity**，见 emit 处。 */
  alpha: number;
  probeId: string; src: string;
}
type Node = TextNode | ShapeNode | ImageNode;
interface PageWalk { nodes: Node[]; degrade: Record<string, number>; title: string }

// ── 把 demo 片段拼成一份 deck，用 http 起本地服务（file:// 下 `/ppt-cases/…` 解析不到，
//    图会全部变成 0×0，量出来「这一页没有图」）───────────────────────────────
const frags = demoFragments();
const missing = ids.filter((id) => !frags.has(id));
if (missing.length) {
  console.error(`demo-slides.html 里没有这些片段：${missing.join(' / ')}（能用的：${[...frags.keys()].join(' ')}）`);
  process.exit(1);
}
const html = assembleDeck(
  ids.map((id) => frags.get(id)!),
  { brandCn: '云启数科', brandEn: 'YUNQI DATA', topic: 'pptx 探针' },
  // 页脚是整份 deck 共用的一条（不在 `.slide` 里），逐页导出时要另外处理 —— 这一片先关掉，
  // 免得把它算进「认不出来的」里。
  { footer: false }
);

const server = http.createServer((req, res) => {
  const url = (req.url || '/').split('?')[0];
  if (url === '/' || url === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }
  const file = path.join(publicRoot, path.normalize(url).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(publicRoot) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404).end('not found');
    return;
  }
  const ext = path.extname(file).toLowerCase();
  const type = ext === '.svg' ? 'image/svg+xml' : ext === '.png' ? 'image/png' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type });
  res.end(fs.readFileSync(file));
});
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
const port = (server.address() as import('net').AddressInfo).port;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 });
// tsx（esbuild keepNames）会把下面 `page.evaluate` 里的具名函数编译成 `__name(fn, '…')`，
// 而那个助手函数只存在于 Node 这一侧 —— 浏览器里跑起来是 `ReferenceError: __name is not defined`，
// 报错指向 evaluate 内部第 1 行，完全看不出成因。补一个同名恒等函数进页面就行。
await page.addInitScript('globalThis.__name = globalThis.__name || ((f) => f)');
await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
// `.slide` 的显隐是 `opacity` + 0.5s transition。刚给一页加上 `.active` 就量的话，那一刻
// 计算出来的 `opacity` 还是 0，下面的可见性判断会把**整页**当不可见跳过 —— 结果是除第一页
// 以外每页都报「0 个文本、0 个形状」，读起来像「这些版式很简单」。所以先把过渡关掉。
await page.addStyleTag({ content: '.slide,.slide *{transition:none!important;animation:none!important}' });
// 字体：等它，但**不为它卡死**（离线机器上 Google Fonts 永远不 ready）。
await page.evaluate(() => Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 8000))]));
const fontsOk = await page.evaluate(() => document.fonts.check('700 54px "Noto Serif SC"', '标题') && document.fonts.check('400 24px "Noto Sans SC"', '正文'));

const walkOne = async (index: number): Promise<PageWalk> =>
  page.evaluate((k) => {
    const stage = document.getElementById('stage')!;
    stage.style.transform = 'none'; // 见文件头 ③
    const slides = [...document.querySelectorAll<HTMLElement>('.slide')];
    slides.forEach((s, i) => s.classList.toggle('active', i === k)); // 见文件头 ②
    const slide = slides[k];
    const sr = stage.getBoundingClientRect();
    const S = 1920 / sr.width; // 保险：transform 万一没关掉也不会整页偏

    const nodes: any[] = [];
    const degrade: Record<string, number> = {};
    const bump = (key: string) => { degrade[key] = (degrade[key] || 0) + 1 };
    const box = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { x: (r.left - sr.left) * S, y: (r.top - sr.top) * S, w: r.width * S, h: r.height * S };
    };
    let imgSeq = 0;

    // ── 旋转：先把「旋转 + 位移」这类 transform **摘掉**，再量 ──────────────────
    // `transform` 不影响布局，所以摘掉之后每个后代量到的正是它「没转之前」的盒子，之后再拿
    // 那个矩阵把中心点算回去、角度交给 pptx 的 `rotate` 就还原得回来。
    // 不摘的话量到的是**转完之后的外接矩形**（比元素本身大、还是正的）：L43 那三张斜卡片会变成
    // 三个更大的正方块，卡片上的字和图照旧是平的，看起来就是「排版整片没对齐」。
    const spun: { el: HTMLElement; a: number; ox: number; oy: number; m: DOMMatrixReadOnly }[] = [];
    const rotated: HTMLElement[] = [];
    for (const el of [...slide.querySelectorAll<HTMLElement>('*')]) {
      const t = getComputedStyle(el).transform;
      if (t === 'none') continue;
      const m = new DOMMatrixReadOnly(t);
      // 只认「旋转 + 位移」（两轴等长且垂直、不翻转）。缩放/倾斜/3D 的照旧 bump('transform')：
      // 那种摘掉之后尺寸会真的变，硬还原会把一块画到别处去。
      const ok = m.is2D && Math.abs(Math.hypot(m.a, m.b) - 1) < 0.01 && Math.abs(Math.hypot(m.c, m.d) - 1) < 0.01
        && Math.abs(m.a * m.c + m.b * m.d) < 0.02 && m.a * m.d - m.b * m.c > 0;
      if (!ok) continue;
      rotated.push(el);
      spun.push({ el, m, a: (Math.atan2(m.b, m.a) * 180) / Math.PI, ox: 0, oy: 0 });
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
    // 盒子（未变换）+ 从里到外每一层变换 → pptx 要的「摆哪里 + 转多少度」。
    // `p' = O + M·(p − O)`，位移分量 e/f 也在 M 里 —— 只当纯旋转算的话
    // `rotate(1.6deg) translateY(24px)` 那张卡片会回到没位移的位置（差 24px，看着就是没对齐）。
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

    const visit = (el: HTMLElement, insideText: boolean, alphaIn: number, spins: Spin[]) => {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return;
      // opacity 是**连乘**的（`.slide` / 卡片 / 这一行各带一层）。只看自己那一层的话，
      // 祖先上写着 .6 的次要区块在 pptx 里全按原色画，整页比浏览器里重一档。
      const alpha = alphaIn * (Number.isFinite(Number(cs.opacity)) ? Number(cs.opacity) : 1);
      const b = box(el);
      const mine = spun.find((s) => s.el === el);
      const sp = mine ? [mine, ...spins] : spins; // 自己那一层最先作用，然后才是外面几层

      // 认不出来的那些：pptx 里没有对应画法，只能截图（或者丢掉）。
      for (const p of ['::before', '::after']) {
        const ps = getComputedStyle(el, p);
        if (ps.content && ps.content !== 'none' && ps.content !== 'normal') bump('pseudo');
      }
      if (cs.clipPath !== 'none') bump('clipPath');
      if (cs.backdropFilter && cs.backdropFilter !== 'none') bump('glass');
      if (cs.mixBlendMode !== 'normal') bump('blend');
      if (cs.filter !== 'none') bump('filter');
      if (cs.writingMode !== 'horizontal-tb') bump('vertical');
      // 纯旋转已经按角度还原了（上面 spun），这里只报缩放/倾斜那种真还不了的。
      if (el !== stage && cs.transform !== 'none' && !mine) bump('transform');
      const clipText = (cs as any).webkitBackgroundClip === 'text' || (cs as any).backgroundClip === 'text';
      if (clipText) bump('textGradient');

      // 形状：有底色 / 有边框 / 有渐变底的块。
      const bgc = cs.backgroundColor;
      const hasBg = bgc !== 'rgba(0, 0, 0, 0)' && bgc !== 'transparent';
      const borders = (['Top', 'Right', 'Bottom', 'Left'] as const).map((s) => ({
        side: s.toLowerCase() as Side['side'],
        w: parseFloat((cs as any)['border' + s + 'Width']) || 0,
        color: (cs as any)['border' + s + 'Color'] as string,
      }));
      const bw = Math.max(...borders.map((s) => s.w));
      // `border-left: 4px` 那种左侧色条在我们模板里到处都有，而 pptx 的形状描边只有「四边一起」。
      if (bw > 0 && borders.some((s) => s.w !== bw)) bump('edgeBorder');
      const bgi = cs.backgroundImage;
      const gradient = bgi !== 'none' && !bgi.includes('url(');
      const firstColor = bgi.match(/rgba?\([^)]+\)|#[0-9a-f]{3,8}/i)?.[0] || null;
      if (bgi.includes('url(')) bump('cssBg');
      if (gradient && !clipText) bump('gradient');
      // **`background-clip:text` 的块不出形状。** 那种渐变只在字的笔画里可见，当成一块底色画出来
      // 就是一条横贯整格的色带，把它自己那个大数字盖掉 —— 而那一格看起来「设计上就有条色带」。
      if ((hasBg || bw > 0 || (gradient && !clipText)) && b.w >= 2 && b.h >= 2) {
        nodes.push({
          kind: 'shape', ...place(b, sp), alpha,
          fill: hasBg ? bgc : gradient && !clipText ? firstColor : null,
          radius: parseFloat(cs.borderTopLeftRadius) || 0,
          gradient: gradient && !clipText,
          borders: borders.filter((s) => s.w > 0),
        });
      }

      if (el.tagName === 'IMG') {
        const probeId = `pi${k}-${++imgSeq}`; // 带页号：不带的话第二页的 pi1 和第一页的撞上，截图那一步直接报 strict mode violation
        el.setAttribute('data-probe-id', probeId);
        nodes.push({ kind: 'image', ...place(b, sp), alpha, probeId, src: (el as HTMLImageElement).currentSrc || (el as HTMLImageElement).src });
        return;
      }

      // 文字：**自己直接挂着文字**的那一层才算（不然一句话会被外面每一层容器各报一遍）。
      // 取的必须是「自己的文字 + 行内子节点的文字」，**不能用 `innerText`**：`innerText` 会把
      // 块级子节点的文字也捞进来，而下面的行盒只量自己这几行 —— `.point-bar`（flex：一个
      // 序号圆点 + 一句话）于是变成「一个两行的文本框塞在一行的位置上」，序号被顶到句子上面
      // 一行去，而圆点自己还在原位：看起来就是「序号和文字错位了」。
      const pre = /^(pre|pre-wrap|pre-line|break-spaces)$/.test(cs.whiteSpace);
      const flat = (t: string) => (pre ? t : t.replace(/[\s ]+/g, ' '));
      const parts: string[] = [];
      for (const cn of [...el.childNodes]) {
        if (cn.nodeType === 3) parts.push(flat(cn.textContent || ''));
        else if (cn.nodeType === 1) {
          const ce = cn as HTMLElement;
          if (ce.tagName === 'BR') parts.push('\n'); // `<br>` 的 textContent 是空的，硬换行会整段并成一行
          else if (getComputedStyle(ce).display.startsWith('inline')) parts.push(flat(ce.innerText || ce.textContent || ''));
        }
      }
      const own = parts.join('').trim();
      let textHere = false;
      if (own && !insideText) {
        textHere = true;
        const runs = [...el.children].filter((c) => ['B', 'EM', 'I', 'STRONG', 'U', 'SPAN'].includes(c.tagName)).length;
        // **只有自己 `overflow:hidden/clip` 的块才算「被裁」。** 只看 scrollHeight > clientHeight
        // 的话，任何一个内容比自己高、但溢出照旧可见的块都会被报成「已经裁了一截」——
        // 那是一句假警报，而它读起来像「你的版式坏了」。
        const clipped = /hidden|clip/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 2;
        // **文字的位置要按行盒量，不能拿元素盒的左上角当文本框原点。** 元素盒含 padding，
        // 而且文字常常是被 flex/`vertical-align`/行高顶到中间的 —— 表格单元格、小胶囊、
        // 序号圆点里的字于是整片往左上偏一截，而每个字都在、颜色也对，看起来像「这版式有点松」。
        // 顺带：行数也用行盒的 top 去重数，不用 `scrollHeight / lineHeight` 猜（有 padding 的块
        // 猜出来一律 ≥2 行，下面那条「单行不换行」就永远不生效）。
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
        const inset = (k: string) => (parseFloat((cs as any)['border' + k + 'Width']) || 0) + (parseFloat((cs as any)['padding' + k]) || 0);
        // 多行的块用**内容盒**的宽（CSS 就是按这个宽度折行的）。用行盒并集的话宽度 = 最宽那一行，
        // 比 CSS 窄几个像素，于是每行末尾的词都掉到下一行，一路串下去多出一两行并从框底溢出。
        const cw = Math.max(1, r0.width - inset('Left') - inset('Right'));
        const tb = ink.length
          ? lines === 1
            ? { x: (Math.min(...ink.map((r) => r.left)) - sr.left) * S, y: (Math.min(...ink.map((r) => r.top)) - sr.top) * S, w: (Math.max(...ink.map((r) => r.right)) - Math.min(...ink.map((r) => r.left))) * S, h: (Math.max(...ink.map((r) => r.bottom)) - Math.min(...ink.map((r) => r.top))) * S }
            : { x: (r0.left + inset('Left') - sr.left) * S, y: (Math.min(...ink.map((r) => r.top)) - sr.top) * S, w: cw * S, h: (Math.max(...ink.map((r) => r.bottom)) - Math.min(...ink.map((r) => r.top))) * S }
          : b;
        nodes.push({
          kind: 'text', ...place(tb, sp), alpha,
          text: own,
          sizePx: parseFloat(cs.fontSize),
          bold: Number(cs.fontWeight) >= 600,
          color: cs.color,
          align: cs.textAlign,
          serif: /Serif/i.test(cs.fontFamily),
          lineHeight: parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4,
          // `normal` 时 parseFloat 是 NaN，直接传给 pptx 会写出一个坏的 spc 值
          spacingPx: parseFloat(cs.letterSpacing) || 0,
          lines,
          // 渐变填字的块本身 `color: transparent`，照着写进 pptx 就是**一整块隐形的字**
          // （那一格看起来只是空着，而文本框、内容、位置全都在）。
          fillHint: clipText ? firstColor : null,
          runs,
          clipped,
        });
        if (runs) bump('runs');
        if (clipped) bump('overflow');
      }
      // 只有**行内**子节点的文字算在上面那一块里，块级子节点要自己出一块（它的文字压根没被
      // 上面收走）。一律传 `true` 的话，`.point-bar` 里的序号圆点、卡片里的小标签会整片消失。
      for (const child of [...el.children]) {
        const inlineChild = getComputedStyle(child).display.startsWith('inline') || child.tagName === 'BR';
        visit(child as HTMLElement, insideText || (textHere && inlineChild), alpha, sp);
      }
    };
    visit(slide, false, 1, []);
    const t = slide.querySelector('h1.page-title');
    return { nodes, degrade, title: t ? (t as HTMLElement).innerText.trim().slice(0, 24) : '' };
  }, index);

// ── 逐页走 + 出 pptx ──────────────────────────────────────────────
const PptxGenJS: any = (PptxModule as any).default || PptxModule;
const pptx = new PptxGenJS();
pptx.defineLayout({ name: 'DECK', width: 13.333, height: 7.5 });
pptx.layout = 'DECK';

const report: { id: string; walk: PageWalk }[] = [];
for (let i = 0; i < ids.length; i++) {
  // `PROBE_SHOTS=1` 时顺手存一张浏览器里的原样（tmp/shot-L45.png），用来和导出的 pptx 对着看。
  // **必须在 walkOne 之前照**：walkOne 会把带旋转的元素的 transform 摘掉（见那边的注释），
  // 摘完再照的话对照图自己就是歪的那份，比出来「一模一样」而两边其实都错了。
  if (process.env.PROBE_SHOTS) {
    await page.evaluate((k) => {
      document.getElementById('stage')!.style.transform = 'none';
      [...document.querySelectorAll<HTMLElement>('.slide')].forEach((s, j) => s.classList.toggle('active', j === k));
    }, i);
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    await page.locator('#stage').screenshot({ path: path.join(path.dirname(outFile), `shot-${ids[i]}.png`), scale: 'css' });
  }
  const walk = await walkOne(i);
  if (process.env.PROBE_JSON) fs.writeFileSync(path.join(path.dirname(outFile), `nodes-${ids[i]}.json`), JSON.stringify(walk.nodes, null, 1));
  report.push({ id: ids[i], walk });
  const slide = pptx.addSlide();
  // **底层（色块/图）先全画完，文字最后画。** 上面是按 DOM 顺序收的，而 CSS 的绘制顺序不是
  // DOM 顺序：元素背景画在**所有**在流内容之下，带 z-index/定位的还会再抬到最上面。照 DOM
  // 顺序往 pptx 里塞的话，后面那个兄弟节点的底色会盖住前面已经画好的字 —— 序号圆点压在正文上、
  // 渐变色带压在大数字上就是这么来的，而每个元素都在、位置也对，看起来像「设计上本来有块色」。
  // 我们的模板里没有「故意用色块盖住字」的设计，所以「字永远在最上层」这条是安全的。
  for (const n of [...walk.nodes.filter((x) => x.kind !== 'text'), ...walk.nodes.filter((x) => x.kind === 'text')]) {
    if (n.kind === 'shape') {
      // 四条边一样时才用形状自己的描边。**只有一两条边有边框的（我们模板里到处是
      // `border-left:4px` 这种色条、`border-bottom` 这种标题下划线），照最大边宽给描边的话
      // pptx 里画出来是整整一圈框** —— 而每一块单看都「有个框」，读起来像设计本来就这样。
      // 那种一律不给描边，改成按边各画一个细长矩形（pptx 里就是个 rect，客户还能单独删）。
      const bs = n.borders;
      const uniform = bs.length === 4 && bs.every((s) => s.w === bs[0].w && s.color === bs[0].color);
      // `border-radius:50%`（序号圆点、右下那个圆形箭头按钮）要画成**椭圆**，不是圆角方块 ——
      // 一律 roundRect 的话一整页的圆点全成了方片，而每一个单看都还「像个设计」。
      // 胶囊（`999px` 的药丸标签）留在 roundRect，但**圆角要给足**：pptxgenjs 不传 `rectRadius`
      // 时用的是默认那点小圆角，药丸会变成方角条。
      const short = Math.min(n.w, n.h);
      const circle = Math.abs(n.w - n.h) <= short * 0.15 && n.radius * 2 >= short - 1;
      const type = circle ? pptx.ShapeType.ellipse : n.radius > 8 ? pptx.ShapeType.roundRect : pptx.ShapeType.rect;
      slide.addShape(type, {
        x: inch(n.x), y: inch(n.y), w: inch(n.w), h: inch(n.h), rotate: n.rot || undefined,
        rectRadius: type === pptx.ShapeType.roundRect ? Math.min(inch(n.radius), inch(short / 2)) : undefined,
        fill: n.fill ? { color: hex(n.fill), transparency: transp(n.fill, n.alpha) } : { type: 'none' } as any,
        line: uniform ? { color: hex(bs[0].color), width: bs[0].w * PX_TO_PT, transparency: transp(bs[0].color, n.alpha) } : { type: 'none' } as any,
      });
      if (!uniform) {
        // pptx 的 `rotate` 是绕**各自**的中心转的。几条边分开画之后，得先把每条边的中心绕整块的
        // 中心转过去，再让它自己也转同样的角度 —— 只给角度不搬中心的话，那几条边会散在原处各自打转。
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
            line: { type: 'none' } as any,
          });
        }
      }
    } else if (n.kind === 'text') {
      // 单行的块再多给两成宽（按对齐方向让出去）。光靠上面的 `wrap:false` 不够：
      // **QuickLook 的渲染器直接无视 `wrap="none"`**（实测 spc/wrap 都写进 XML 了，缩略图照旧折行），
      // 换客户机器上某个第三方阅读器同理 —— 那时候现象是「这份 pptx 在他那儿排版糊了」。
      const cushion = n.kind === 'text' && n.lines === 1 ? Math.max(8, n.w * 0.2) : 0;
      const cx = n.x - (n.align === 'center' ? cushion / 2 : n.align === 'right' ? cushion : 0);
      slide.addText(n.text, {
        x: inch(cx), y: inch(n.y), w: inch(n.w + cushion), h: inch(n.h),
        fontSize: +(n.sizePx * PX_TO_PT).toFixed(1),
        bold: n.bold,
        color: hex(n.fillHint || n.color),
        // 字族只能写**装机字体名**。写 CSS 变量名或写一个客户机器上没有的字体，PowerPoint 会
        // 静默换字，行宽全变、几乎每页都溢出，而导出这一步一切正常。
        fontFace: n.serif ? 'Noto Serif SC' : 'Noto Sans SC',
        align: (n.align === 'center' ? 'center' : n.align === 'right' ? 'right' : 'left') as any,
        // 字距要带上：kicker / 英文小标题那几行在 CSS 里拉开了 2-6px，不带的话它们在 pptx 里
        // 挤成一团（缩略图上就是一坨看不清的蓝字），而每个字都在、导出也不报错。
        charSpacing: n.spacingPx ? +(n.spacingPx * PX_TO_PT).toFixed(1) : undefined,
        // 透明度也要跟着 fillHint 走：拿 `transparent` 去算的话是 100%，字是「有内容但全透明」，
        // 那一格在 PowerPoint 里空着而框和文字都在，比画错更难查。
        transparency: transp(n.fillHint || n.color, n.alpha),
        // 文本框宽度是按浏览器实测宽度给的，也就是**刚好一行**。换台机器字体一换（客户机器上
        // 大概没有 Noto Sans SC），同一句话宽一点点就折成两行，而框高只够一行 —— 现象是
        // kicker/小标题变成一团糊在一起的字，看起来像「这个版式排坏了」。浏览器里本来就只有
        // 一行的块一律禁止换行，让它像 CSS 里 overflow 可见那样溢出。
        wrap: n.lines > 1, rotate: n.rot || undefined,
        valign: 'top', margin: 0, lineSpacingMultiple: +(n.lineHeight / n.sizePx).toFixed(2), isTextBox: true,
      });
    } else {
      // 图先按「截这一块」处理：demo 里是 svg 占位图，而 **pptx 不收 svg**，直接写 src 的话
      // 那一格在 PowerPoint 里是个红叉。真图将来同一条路（截图或原图字节）。
      //
      // 截之前把**除它以外的一切都藏起来**。playwright 的 element screenshot 截的是「这一块的
      // 矩形范围内画面上的样子」，压在它上面的标题/正文会被一起烙进图里 —— 全幅背景图那一页
      // 于是变成「烙了一遍字的底图 + 真文本框又写一遍同一句」：屏幕上同一句话叠着两份、
      // 字体粗细还略微不同，而导出这一步一处都不报错。
      //
      // 用 `visibility`（不是 z-index）：`.case-bg{z-index:-1}` / `.slide-inner{z-index:2}` 各自
      // 是一个层叠上下文，给里面那张图写多大的 z-index 都爬不出它父层 —— 试过，字照旧烙进去，
      // 只是背景亮度变了（那张图被抬到了自己那层的遮罩之上），更难看出哪儿不对。
      // visibility 可继承也可被子元素覆盖，所以「全藏 + 只放出这一块」是一条稳的。
      await page.evaluate((id) => {
        const style = document.getElementById('probe-solo') || Object.assign(document.createElement('style'), { id: 'probe-solo' });
        // 「只放出这一块」那条必须**也带 `#stage`**：两条都写了 `!important` 之后比的是特异度，
        // `#stage *` 里有个 id（1,0,0）压得住光秃秃的属性选择器（0,1,0） —— 那样目标自己也一直是
        // hidden，playwright 会在「element is not visible」上死等到 30 秒超时。
        style.textContent = `#stage *{visibility:hidden!important}#stage [data-probe-id="${id}"],#stage [data-probe-id="${id}"] *{visibility:visible!important}`;
        document.head.appendChild(style);
      }, n.probeId);
      // `scale:'css'` = 按 CSS 像素截（不跟 deviceScaleFactor 2 走）。设计稿 1920px 铺满
      // 13.333in 本身就是 144dpi，2 倍再截只是把体积翻四倍：一张全幅底图 6.5MB、三页就 10MB，
      // 十几页的稿子会大到发不出去，而导出这一步只是「慢一点」，没有一处会说体积是这么来的。
      const buf = await page.locator(`[data-probe-id="${n.probeId}"]`).screenshot({ omitBackground: true, scale: 'css' });
      await page.evaluate(() => document.getElementById('probe-solo')?.remove());
      // 透明度要自己补上，而且必须**烙进像素**（`shrink` 的第 4 个参数），不能用 pptx 的
      // `transparency`：① 元素截图是按不透明截的（`opacity:.22` 的底图截出来是一张实图），
      // 不补的话它把身下那块深色底盖成一张灰图 —— 整页从深色变浅色，每一块内容都在、位置也对，
      // 看起来像「这个版式本来是浅色的」（白字于是在浅底上几乎看不见，L39 就是这样）；
      // ② `transparency` 写出来的是 `<a:alphaModFix>`，**苹果这套渲染器直接忽略它**（实测
      // qlmanage：底下垫一块 2E2C2C、图给 78 也照旧是一整片浅灰），所以那条路的症状是
      // 「在 PowerPoint 里对、在 Mac 上预览/Keynote 里整页发白」—— 两边都不报错。
      const img = await shrink(buf.toString('base64'), n.w, n.h, n.alpha);
      slide.addImage({
        data: `${img.mime};base64,${img.b64}`, x: inch(n.x), y: inch(n.y), w: inch(n.w), h: inch(n.h),
        rotate: n.rot || undefined,
      });
    }
  }
}
await browser.close();
server.close();
fs.mkdirSync(path.dirname(outFile), { recursive: true });
await pptx.writeFile({ fileName: outFile });

// ── 结论 ─────────────────────────────────────────────────────────
const line = '─'.repeat(64);
console.log(line);
if (!fontsOk) {
  console.log('⚠️ Noto Sans/Serif SC **没有加载成功**（Google Fonts 拉不到）。下面每一块的位置和高度');
  console.log('   都是回落字体排出来的，和线上真实产出不是一回事 —— 数字仅供参考，别照它下结论。');
  console.log(line);
}
let tText = 0, tShape = 0, tImage = 0;
/** 每一类：总处数 + 涉及哪些版式。**「涉及几个版式」才是决定要不要改 CSS 的那个数** ——
 *  只看总处数的话，一个版式里出现 40 次的东西看起来比 60 个版式各出现一次的更严重。 */
const all = new Map<string, { count: number; ids: string[] }>();
const noText: string[] = [];
for (const { id, walk } of report) {
  const t = walk.nodes.filter((n) => n.kind === 'text').length;
  const s = walk.nodes.filter((n) => n.kind === 'shape').length;
  const g = walk.nodes.filter((n) => n.kind === 'image').length;
  tText += t; tShape += s; tImage += g;
  if (!t) noText.push(id);
  const ds = Object.entries(walk.degrade).sort((a, b) => b[1] - a[1]);
  for (const [k, v] of ds) {
    const e = all.get(k) || { count: 0, ids: [] };
    e.count += v; e.ids.push(id);
    all.set(k, e);
  }
  const tag = `${id}${walk.title ? ` · ${walk.title}` : ''}`.padEnd(26, ' ');
  console.log(`${tag} 文本 ${String(t).padStart(2)} / 形状 ${String(s).padStart(2)} / 图 ${g}   ${ds.map(([k, v]) => `${k}×${v}`).join(' ') || '—'}`);
}
console.log(line);
console.log(`${report.length} 页合计：可编辑文本 ${tText} 块 / 形状 ${tShape} 个 / 图 ${tImage} 张；认不出来的共 ${[...all.values()].reduce((a, b) => a + b.count, 0)} 处`);
console.log(line);
console.log('按「涉及多少个版式」排（要不要改 CSS 看这个数）：');
for (const [k, e] of [...all.entries()].sort((a, b) => b[1].ids.length - a[1].ids.length)) {
  const list = e.ids.length > 10 ? `${e.ids.slice(0, 10).join(' ')} …等 ${e.ids.length} 个` : e.ids.join(' ');
  console.log(`  ${k.padEnd(13)} ${String(e.ids.length).padStart(2)} 个版式 / ${e.count} 处  ${DEGRADE[k] || k}`);
  console.log(`  ${' '.repeat(13)} ${list}`);
}
if (noText.length) {
  console.log(line);
  // 这一条是整份报告里唯一「客户会当面发现」的：那几页在 PowerPoint 里双击不出光标。
  console.log(`⚠️ 这些版式一块可编辑文本都没有 —— 导出后整页改不了字：${noText.join(' ')}`);
}
console.log(line);
console.log(`pptx：${outFile}`);
console.log('这份 pptx **没有**垫整页截图（T2 才做），所以缺的正是上面那些 —— 差距一眼能看出来。');

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

/**
 * 把截出来的 PNG 重新编码到「正好铺满它在页面上那块地方」的尺寸，不透明的转 JPEG。
 *
 * 借页面里的 canvas 做（省一个 sharp 依赖）。喂的是 **data: URL** —— 那种不算跨域，
 * 不会污染 canvas；直接拿 CDN 上那张原图画进去的话 `toDataURL` 抛 SecurityError，
 * 而那是真图上线之后才会出现的错，本机 demo（同源 svg）永远测不出来。
 *
 * 有半透明像素时留 PNG：一律转 JPEG 的话带透明背景的插画会多出一块黑底/白底，
 * 而那一页看起来只是「这张图的底色不对」。`alpha < 1` 的图同理只能留 PNG（体积换正确）。
 */
async function shrink(pngB64: string, wPx: number, hPx: number, alpha = 1): Promise<{ mime: string; b64: string }> {
  return page.evaluate(
    async ({ b64, w, h, a }) => {
      const im = new Image();
      im.src = `data:image/png;base64,${b64}`;
      await im.decode();
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(w));
      c.height = Math.max(1, Math.round(h));
      const ctx = c.getContext('2d')!;
      ctx.globalAlpha = a; // CSS 的 opacity 烙进像素，见调用处
      ctx.drawImage(im, 0, 0, c.width, c.height);
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      let opaque = true;
      for (let i = 3; i < d.length; i += 4) if (d[i] < 250) { opaque = false; break }
      const url = opaque ? c.toDataURL('image/jpeg', 0.82) : c.toDataURL('image/png');
      return { mime: opaque ? 'image/jpeg' : 'image/png', b64: url.split(',')[1] };
    },
    { b64: pngB64, w: wPx, h: hPx, a: alpha }
  );
}
