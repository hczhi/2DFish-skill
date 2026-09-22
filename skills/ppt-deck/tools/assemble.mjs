#!/usr/bin/env node
// 把若干页 <section> 拼成一个**自包含的单文件 .html**（纯字符串拼接，不联网、不调模型）。
//
//   node tools/assemble.mjs <deck.json> [输出.html]
//
// 只有这一份拼装实现。自己另拼一份的后果不是报错：那一份里少贴一层蒙版、少注一段配色，
// 出来照样是一份翻得动、看起来正常的稿子 —— 而「照这套骨架跑出来长这样」正是 kb/ 里
// 那些案例存在的全部理由，两边漂开的那一刻两份都在骗人。
//
// 这个脚本会大声失败的几件事（每一件不喊的话，产物都是「打开一看很正常」）：
//   ① 骨架里找不到幻灯片插入点 → 拼出来是一份**全白**的 deck（页脚、翻页全都正常）。
//   ② 某一页的 html 里没有 <section> → 那一页静默消失，整份只是「内容跳了一段」。
//   ③ 图片文件找不到 → 那一格是破图/空白，而文字、版式、翻页全对，看起来像「这一页没配图」。
//   ④ 配色/字体 id 认不出 → 回落成默认那套的话，整份是另一套颜色，而每一页单看都正常。
//   ⑤ 还有格子停在占位图 → 产物里是灰块，所以最后那份报告会把页号一个个列出来。
//   ⑥ 输出里还留着 {{...}} 记号 → 那几个字会**原样印在画面上**。

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const KB = path.resolve(HERE, '..', 'kb');

/** 骨架里 <section> 的插入点（kb/template.html 里那一行注释，一个字都不能差）。 */
const SLOT = '<!-- partN_fragment.html 的 <section> 在此按顺序插入 -->';

/** 占位图记号：这是一个**固定字符串**，不是真实地址。assemble 把它换成内联的 SVG。 */
const PH_PREFIX = '/ppt-cases/ph-';
const PH_FILES = { '/ppt-cases/ph-16x9.svg': 'ph-16x9.svg', '/ppt-cases/ph-1x1.svg': 'ph-1x1.svg', '/ppt-cases/ph-3x4.svg': 'ph-3x4.svg' };

const MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.gif': 'image/gif', '.avif': 'image/avif', '.svg': 'image/svg+xml',
};

class DeckError extends Error {}

// ---------------------------------------------------------------- 主流程

function main(argv) {
  const [src, outArg] = argv;
  if (!src) {
    console.error('用法：node tools/assemble.mjs <deck.json> [输出.html]');
    process.exit(2);
  }
  const jsonPath = path.resolve(src);
  const deck = readJson(jsonPath);
  const baseDir = deck.imageBase ? path.resolve(path.dirname(jsonPath), deck.imageBase) : path.dirname(jsonPath);
  const out = buildDeck(deck, baseDir);
  const outPath = path.resolve(outArg || jsonPath.replace(/\.json$/i, '') + '.html');
  fs.writeFileSync(outPath, out.html);

  console.log(`已生成 ${outPath}`);
  console.log(`  ${out.pages} 页，内联了 ${out.inlined} 张图，文件 ${(Buffer.byteLength(out.html) / 1048576).toFixed(2)} MB`);
  for (const w of out.warnings) console.log(`  ⚠ ${w}`);
}

/** 拼整份。`deck` 的字段见 example/sample-deck.json 和 SKILL.md。 */
export function buildDeck(deck, baseDir) {
  const meta = normalizeMeta(deck.meta);
  const design = normalizeDesign(deck.design);
  const pages = Array.isArray(deck.pages) ? deck.pages : null;
  if (!pages || !pages.length) throw new DeckError('deck.pages 是空的 —— 拼不出任何幻灯片。');

  const template = fs.readFileSync(path.join(KB, 'template.html'), 'utf8');
  if (!template.includes(SLOT)) {
    throw new DeckError(`kb/template.html 里找不到幻灯片插入点（${SLOT}）—— 拼出来会是一份空白 deck。`);
  }

  let inlined = 0;
  const stillPlaceholder = [];
  const sections = pages.map((p, i) => {
    const no = i + 1;
    const raw = typeof p === 'string' ? p : p?.html;
    if (typeof raw !== 'string' || !raw.includes('<section')) {
      throw new DeckError(`第 ${no} 页里没有 <section>（这一段不是一页幻灯片）—— 少一页的 deck 翻起来和完整的一模一样，只是内容跳了一段。`);
    }
    const veil = typeof p === 'string' ? 0 : p?.veil;
    const r = inlineImages(fillMeta(applyVeil(stripPageNumber(raw), veil, no), meta), baseDir, no);
    inlined += r.inlined;
    if (r.placeholders) stillPlaceholder.push(`第 ${no} 页 ${r.placeholders} 格`);
    return r.html;
  });

  // 占位图内联成 data: 之后，骨架里那几条按 src 前缀写的规则就再也匹配不上了
  // （`.page-decor` 那条豁免、L74/L75 把占位图压到 .22 的那两条）—— 不改选择器的话
  // 产物里那几页的占位图会以全不透明的样子压在文字上，而一处都不报错。
  const shell = template.split(PH_SELECTOR).join('img[data-ph]');
  const style = designStyleBlock(design);
  const html = fillMeta(shell.replace(SLOT, () => style + sections.join('\n')), meta);

  const leftover = html.match(/\{\{[A-Z_]+\}\}/g);
  if (leftover) {
    throw new DeckError(`输出里还留着 ${[...new Set(leftover)].join(' / ')} —— 这几个字会原样印在画面上。`);
  }

  const warnings = [];
  if (stillPlaceholder.length) {
    warnings.push(
      `还有格子停在占位图（${stillPlaceholder.join('、')}）：产物里它们是灰块。` +
        `先把这几格的图生出来、填回 src，再拼一次。`
    );
  }
  return { html, pages: sections.length, inlined, warnings };
}

const PH_SELECTOR = `img[src^="${PH_PREFIX}"]`;

// ---------------------------------------------------------------- meta / 设计规范

function normalizeMeta(raw) {
  const meta = {
    brandCn: str(raw?.brandCn),
    brandEn: str(raw?.brandEn),
    topic: str(raw?.topic),
  };
  // 空着的话画面上是一块空白页眉/页脚，读起来像「这份稿子就没有署名」。
  for (const k of ['brandCn', 'brandEn', 'topic']) {
    if (!meta[k]) throw new DeckError(`meta.${k} 是空的 —— 页眉/页脚会留一块空白，而画面看起来完全正常。`);
  }
  return meta;
}

/** `{{BRAND_CN}}` 这几个记号。**一律用函数形式替换**：正文里的 `$&` / `$1` 在字符串形式下会被当成引用展开，悄悄吃掉几个字符。 */
function fillMeta(s, meta) {
  return s
    .replace(/\{\{BRAND_CN\}\}/g, () => meta.brandCn)
    .replace(/\{\{BRAND_EN\}\}/g, () => meta.brandEn)
    .replace(/\{\{TOPIC\}\}/g, () => meta.topic);
}

let optionsCache = null;
function designOptions() {
  if (!optionsCache) optionsCache = readJson(path.join(KB, 'design-options.json'));
  return optionsCache;
}

/**
 * 五个档位 id。**认不出一律抛，不回落成默认那套**：回落的话整份是另一套颜色/字体，
 * 而每一页单看都是一页正常的幻灯片，没有一处能告诉他这个 id 打错了。
 */
function normalizeDesign(raw) {
  const o = designOptions();
  const pick = (list, val, what) => {
    const id = str(val) || o.default[what];
    const hit = list.find((x) => x.id === id);
    if (!hit) {
      throw new DeckError(`design.${what} = "${id}" 认不出来。可选：${list.map((x) => `${x.id}（${x.name}）`).join('、')}`);
    }
    return hit;
  };
  return {
    palette: pick(o.palettes, raw?.palette, 'palette'),
    font: pick(o.fonts, raw?.font, 'font'),
    density: pick(o.densities, raw?.density, 'density'),
    header: pick(o.headers, raw?.header, 'header'),
    motif: pick(o.motifs, raw?.motif, 'motif'),
  };
}

/**
 * 设计规范那一段 `<style>`（和幻灯片一起插进 body）。
 *
 * **插 body、不去找 `</head>`**：找不到那个标签时替换什么都不做，而现象只是「配色没变」。
 * 疏密和页眉两档的 rules 都要注 —— 漏一档不报错，出来是「选了细宋体而页眉还是加粗小字」。
 */
function designStyleBlock(d) {
  const vars = { ...(d.palette.vars || {}), ...(d.font.vars || {}) };
  const decl = Object.entries(vars).map(([k, v]) => `${k}:${v}`).join(';');
  const rules = (d.density.rules || '') + (d.header.rules || '');
  if (!decl && !rules) return '';
  const tag = `${d.palette.id}/${d.font.id}/${d.density.id}/${d.header.id}`;
  return `<style id="deck-design" data-design="${tag}">${decl ? `:root{${decl}}` : ''}${rules}</style>\n`;
}

// ---------------------------------------------------------------- 每一页的处理

/**
 * 往一页里贴那层黑色蒙版：**每一页都贴，0 也贴**，而且只往 `<section>` 开标签上写一个
 * `--veil` 变量、不往里塞任何元素（那一层黑是 `.slide::before`）。塞元素的话这一页在
 * 浏览器里数出来的孩子下标整体多一位，任何按下标定位的后续加工都会错一格。
 */
function applyVeil(html, opacity, no) {
  const cleaned = html.replace(/<div class="slide-veil"[^>]*><\/div>\s*/g, '');
  // 夹逼 + 非数字回落 0：NaN 写进去的话 `opacity:var(--veil,0)` 整条声明作废、回到初始值 1,
  // 那一页只剩一块黑，而没有一处报错。
  const o = Number.isFinite(opacity) ? Math.min(1, Math.max(0, opacity)) : 0;
  let injected = false;
  const out = cleaned.replace(/<section\b[^>]*>/, (m) => {
    injected = true;
    const tag = m.replace(/\s*--veil\s*:[^;"']*;?/g, '');
    // 已经有 style 的（版式会往 section 上写背景图）必须**并进那一个属性里**：
    // 另起一个 style="…" 的话 HTML 只认前面那一个，蒙版对这几页静默失效。
    const has = /\sstyle\s*=\s*(["'])/.exec(tag);
    return has
      ? tag.slice(0, has.index + has[0].length) + `--veil:${o};` + tag.slice(has.index + has[0].length)
      : `${tag.slice(0, -1)} style="--veil:${o}">`;
  });
  if (!injected) throw new DeckError(`第 ${no} 页里找不到 <section> 开标签，蒙版贴不上去。`);
  return out;
}

/**
 * 摘掉页码徽章和没被替换的 `{{PAGE}}` / `{{TOTAL}}`。
 * 这几个类的 CSS 已经不在骨架里了 —— 留着的话那个 div 掉回默认流式布局，
 * 变成正文里凭空多出来的一行「01 / 17」，读起来像是这一页的设计。
 */
function stripPageNumber(html) {
  return html
    // 类名要整段匹配：写成 \b 的话 `wm` 会连 `wm-foo` 一起吃掉，而被吃掉的是一整个 div。
    .replace(
      /<div[^>]*class="[^"]*(?<![\w-])(?:page-badge|wm|hc-no|bio-page-num)(?![\w-])[^"]*"[^>]*>[\s\S]*?<\/div>\s*/g,
      ''
    )
    .replace(/\{\{PAGE(?:_NUM)?\}\}\s*\/?\s*(?:\{\{TOTAL\}\})?/g, '')
    .replace(/\{\{TOTAL\}\}/g, '');
}

/**
 * 把这一页里所有图片**读成字节内联进 html**（`src="…"` 和 CSS 的 `url(…)` 两种都认）。
 *
 * 内联是这份产物「发给谁都能打开」的全部依据：留着相对/本机路径的话，文件换一台机器
 * 或者换一个目录之后每一格都是破图，而文字、版式、翻页全都正常。
 * 找不到文件**一律抛**（不跳过）：跳过的话那一格是空白，看起来像这一页本来就没配图。
 */
function inlineImages(html, baseDir, no) {
  let inlined = 0;
  let placeholders = 0;

  const resolve = (raw) => {
    const url = raw.trim().replace(/^['"]|['"]$/g, '');
    // `#id` 是同文档引用（svg 里的渐变就是 `url(#sky)`，内联之后编码成 `%23sky`）——
    // 当成文件去找的话，一张自带渐变的图会把整份拼装拦下来，报的还是「图找不到」。
    if (!url || /^(data:|https?:|\/\/|#|%23)/i.test(url)) return null;
    if (url.startsWith(PH_PREFIX)) {
      const file = PH_FILES[url];
      if (!file) throw new DeckError(`第 ${no} 页用了一个不存在的占位图记号（${url}）—— 可选：${Object.keys(PH_FILES).join(' / ')}`);
      placeholders++;
      return { uri: dataUri(path.join(KB, file)), ph: true };
    }
    const abs = path.isAbsolute(url) ? url : path.resolve(baseDir, url);
    if (!fs.existsSync(abs)) {
      throw new DeckError(
        `第 ${no} 页的图找不到：${url}（找的是 ${abs}）。` +
          `跳过它的话那一格在产物里是空白，而这一页读起来像本来就没配图 —— 所以这里不给拼。`
      );
    }
    inlined++;
    return { uri: dataUri(abs), ph: false };
  };

  let out = html.replace(/(<img\b[^>]*?\bsrc=")([^"]*)"([^>]*>)/g, (m, head, url, tail) => {
    const r = resolve(url);
    if (!r) return m;
    // 占位图要带上 `data-ph`：骨架里那几条规则原来是按 src 前缀写的，内联之后只能靠这个记号
    // （少了它的话占位图不再被压淡，会以全不透明的灰块压在文字上，而一处都不报错）。
    const mark = r.ph && !/\bdata-ph=/.test(m) ? ' data-ph="1"' : '';
    return `${head}${r.uri}"${mark}${tail}`;
  });

  out = out.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (m, q, url) => {
    const r = resolve(url);
    return r ? `url("${r.uri}")` : m;
  });

  return { html: out, inlined, placeholders };
}

function dataUri(file) {
  const ext = path.extname(file).toLowerCase();
  const mime = MIME[ext];
  if (!mime) {
    throw new DeckError(`不认识的图片格式：${file}。能内联的是 ${Object.keys(MIME).join(' / ')}。`);
  }
  const buf = fs.readFileSync(file);
  // svg 走 URL 编码（比 base64 小三成，而且文本在文件里还读得出来）
  if (ext === '.svg') return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(buf.toString('utf8'))}`;
  return `data:${mime};base64,${buf.toString('base64')}`;
}

// ---------------------------------------------------------------- 小工具

function readJson(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    throw new DeckError(`读不到 ${file}`);
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new DeckError(`${file} 不是合法 JSON：${e.message}`);
  }
}

function str(v) {
  return typeof v === 'string' ? v.trim() : '';
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    console.error(e instanceof DeckError ? `拼装失败：${e.message}` : e);
    process.exit(1);
  }
}
