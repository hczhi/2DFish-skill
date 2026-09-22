// 导出整份 deck 成一个 .html 文件（不调 AI，纯合并 + 改地址）。
//
// 拼装照旧只走 `buildDeck`（缺页会被它拒掉），这一层只多做两件事，而两件都是
// 「文件下载下来了、双击打开一片正常」的失败：
//
// ① **把相对地址改成绝对地址**。生成出来的页里图是 `/ppt-cases/ph-*.svg` 或
//    `/uploads/xxx.png` —— 那是相对平台域名的。存成本地文件后 `file:///` 下这两个
//    路径指向的是磁盘根目录，于是整份 deck 的图**全是破图**，而文字、版式、翻页
//    全都正常，看起来像「这份稿子设计上就没配图」。
// ② **把这份文件还依赖什么说出来**（占位图没换、图落在本机磁盘、字体走 Google CDN、
//    导出地址是 localhost）。这些在导出那一刻的预览里全都看不出来 —— 用户是把文件
//    转给别人打开时才发现，而那时候没有任何一处能告诉他成因。
//
// 真正的单文件（图和字体打进文件里）是后面的一片，所以这里必须明说「这份文件要能
// 访问到平台才完整」，不能让人以为拿到的是一份到哪都能开的东西。

import { buildDeck, type DeckPageInput } from './pageService.js';
import type { DeckMeta } from './deckShell.js';

export class ExportError extends Error {}

export interface ExportResult {
  filename: string;
  html: string;
  warnings: string[];
  /** 还没换成真图的格子数（前端要显眼提示：这几格在导出的文件里是灰的占位图） */
  placeholders: number;
}

export function exportDeck(
  pages: DeckPageInput[],
  total: number,
  meta: DeckMeta,
  baseUrl: string
): ExportResult {
  const base = normalizeBase(baseUrl);
  const deck = buildDeck(pages, total, meta);
  const { html, rewritten, placeholders, localFiles } = absolutize(deck, base);

  const warnings: string[] = [];
  if (placeholders) {
    warnings.push(
      `还有 ${placeholders} 格是占位图（灰底的那种），导出的文件里它们就是灰块 —— ` +
        `先在页面上点「给全部页配图」再导出。`
    );
  }
  if (localFiles) {
    warnings.push(
      `有 ${localFiles} 张图存在这台服务器的磁盘上（/uploads 下，COS 没配好）：` +
        `这份文件里它们指向 ${base}/uploads/…，换机器或者多实例部署之后就是破图。`
    );
  }
  if (rewritten) {
    warnings.push(
      `这份文件里的 ${rewritten} 处图片地址指向 ${base} —— 打开它的机器访问不到这个地址时` +
        `那几格就是破图（图还没打进文件里，那是后面才做的一片）。`
    );
    if (/localhost|127\.0\.0\.1|:5173|:3001/.test(base)) {
      warnings.push(
        `导出地址是 ${base}，只有你自己这台机器能打开 —— 要发给别人的话，等部署到线上域名后再导出一次。`
      );
    }
  }
  if (html.includes('fonts.googleapis.com')) {
    warnings.push(
      '字体是从 Google Fonts 取的：断网或者取不到的时候会掉回系统字体，标题字重和字距会变' +
        '（版面看着像塌了一点，但不会报错）。'
    );
  }

  return { filename: fileName(meta), html, warnings, placeholders };
}

function normalizeBase(raw: string): string {
  const base = String(raw || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\/[^/\s]+$/i.test(base)) {
    // 兜一个「看起来对」的值的话，整份文件里的图会指向一个拼出来的假地址，
    // 而下载和打开都不报错 —— 只是每一格都是破图。
    throw new ExportError(`导出地址不对（${raw || '空'}），拼出来的文件里图片地址会全是错的，所以这里不给导。`);
  }
  return base;
}

/** 只改 `src="/…"` / `href="/…"` / `url(/…)` 这三种单斜杠开头的相对地址（`//` 是协议相对，别动）。 */
function absolutize(
  html: string,
  base: string
): { html: string; rewritten: number; placeholders: number; localFiles: number } {
  let rewritten = 0;
  const out = html
    .replace(/(\s(?:src|href)=")(\/[^/"][^"]*)"/g, (_m, a, p) => {
      rewritten++;
      return `${a}${base}${p}"`;
    })
    .replace(/url\(\s*(['"]?)(\/[^/'")\s][^'")\s]*)\1\s*\)/g, (_m, q, p) => {
      rewritten++;
      return `url(${q}${base}${p}${q})`;
    });
  return {
    html: out,
    rewritten,
    // 只数**图片地址**上的，不是整份文件里这几个字出现过几次：骨架的 CSS 里也有
    // `img[src^="/ppt-cases/ph-"]`（装饰层那条豁免），跟着数进来的话这句警告写的是
    // 「还有 3 格是占位图」而实际只有 1 格 —— 他会满份稿子去找那两格不存在的灰块，
    // 而每一格都已经是真图了。同理 `/uploads/` 那条也只数地址。
    placeholders: countRefs(out, '/ppt-cases/ph-'),
    localFiles: countRefs(out, '/uploads/'),
  };
}

/** 数「有几处图片**地址**里带这一段」：`src=`/`href=` 和 CSS 的 `url()` 都算，别的字面不算。 */
function countRefs(html: string, needle: string): number {
  const seg = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?:(?:src|href)="[^"]*${seg})|(?:url\\(\\s*['"]?[^'")\\s]*${seg})`, 'g');
  return (html.match(re) || []).length;
}

/**
 * 文件名里不能留路径分隔符和引号：`a/b` 会让浏览器把文件存到别处或者直接不下载，
 * 而那次点击在界面上什么都不发生（读起来像导出功能坏了）。
 */
function fileName(meta: DeckMeta): string {
  const raw = (meta.topic || meta.brandCn || '展示稿').trim().slice(0, 40);
  const safe = raw.replace(/[\\/:*?"<>|\r\n\t]+/g, '-').replace(/^-+|-+$/g, '') || '展示稿';
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return `${safe}-${stamp}.html`;
}
