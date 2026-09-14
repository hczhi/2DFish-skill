// PDF 的**文字层** → 纯文本。和 fileExtract 一样：只做程序提取，不调 AI。
//
// 「文字层」是这里唯一要想清楚的概念。一份 PDF 长得再正常，里面也可能一个字符都没有 ——
// 扫描件、把 PPT 导成图再拼成的 PDF、设计软件导出时把文字转成了曲线，全是这种。
// 那种文件在这里提取出 0 字，而**它在用户手里看起来和普通 PDF 完全一样**（能翻页、能看字），
// 所以这条路上必须明确报错并说出路（导成 PNG/JPG 走图片识别），不能返回空串 ——
// 静默的话他以为资料进去了，后面十二步全按空资料推，每一步的正文读起来完全正常。
//
// 第二种同样危险的「成功」：提出来的**是**字符，但那些字符不是给人看的。PDF 的字体子集
// 常常不带 ToUnicode 映射表（尤其是中文字体子集、InDesign/Illustrator 导出的），那时候
// 每个字形映射到的是私用区码位（U+E000 那一段）或者 U+FFFD —— 提取出来是一片没人读得懂的
// 符号，而字数还很可观。那一片东西进了「客户原始资料」之后，模型读不懂就照行业常识补，
// 补出来的资料读起来一切正常。
// 所以这里按乱码比例分两档：太多就报错让他导图片，少量就走 notes 让他自己扫一眼。

import type { TextItem } from 'pdfjs-dist/types/src/display/api.js';
import { ExtractError } from './fileExtract.js';

/** PDF 的文件头（`%PDF`）。按它分派，不按扩展名 —— 理由同 fileExtract 里那段。 */
export const PDF_MAGIC = Buffer.from('%PDF');

/**
 * 最多读这么多页。品牌资料里几百页的 PDF 是有的（整本 VI 手册），全读一遍是分钟级的
 * CPU + 一份几十万字的字符串，而这条链路后面装得下的只有两万字。
 *
 * 截掉的页数**必须出声**（notes）：不说的话「这份 PDF 后面 300 页的内容不在资料里」
 * 这件事在界面上没有任何痕迹，而剩下那 200 页读起来照样是一份完整的资料。
 */
export const MAX_PDF_PAGES = 200;

/** 乱码（U+FFFD + 私用区）占比超过这个数就直接报错 —— 那份文字对咨询没有任何用处。 */
const GARBLED_FATAL_RATIO = 0.3;
/** 少量乱码只提示：中文 PDF 里夹几个私用区符号（图标字体、项目符号）是常态。 */
const GARBLED_NOTE_RATIO = 0.03;

/**
 * 没有文字层时的那句话。**必须给出路**：只说「提取不到文字」的话他只会换个导出方式
 * 反复传同一份东西（每次都要等一次上传），而真正管用的动作是把那几页导成图片走识别。
 */
const NO_TEXT_LAYER_HINT =
  '这份 PDF 没有文字层：里面的每一页都是图（扫描件、或者导出时把文字转成了曲线/位图），'
  + '程序读不到一个字符 —— 它在阅读器里看起来正常，但那些字对程序来说是图案。\n'
  + '出路：在 PDF 阅读器里把要用的那几页**导出成 PNG / JPG**（Acrobat「导出为图像」、'
  + '预览「导出」、或者直接截图），然后把图片传上来 —— 图片会走大模型识别。'
  + '一次最多 5 个文件，所以挑内容最要紧的那几页。';

/**
 * PDF 文字层 → 按页分节的纯文本。分页标记用的是和 pptx 同一种
 * （`--- 第 N 页 ---`）—— 整理那一步按它切段（`fileTidyService.splitForTidy`），
 * 换个写法的话切段会退回「按字数硬切」，而切在一页中间的两段会各自把半截内容
 * 当完整的一节整理，拼起来读得通但是重复的。
 */
export async function extractPdf(
  filename: string,
  buf: Buffer,
  notes: string[]
): Promise<{ text: string; emptyPages: number }> {
  // 懒加载：pdfjs 是十几兆的一整份解析器，放在模块顶上会拖慢每次服务启动和
  // 每个用不到 PDF 的测试文件。
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');

  let doc;
  try {
    doc = await pdfjs.getDocument({
      data: new Uint8Array(buf),
      // Node 里没有 DOM，这几项关掉纯文字提取用不到的部分（不关会打一屏
      // 「Cannot polyfill DOMMatrix」，而那句话和真失败混在一起没法读）。
      isEvalSupported: false,
      useSystemFonts: false,
      disableFontFace: true,
      verbosity: 0,
    }).promise;
  } catch (e: any) {
    // 加密的 PDF 要单独认：pdfjs 回的是英文的 PasswordException，透出去的话
    // 「要密码」和「文件坏了」长成同一句，而两者的下一步动作完全不同。
    if (e?.name === 'PasswordException' || /password/i.test(String(e?.message))) {
      throw new ExtractError(
        `${filename} 有密码保护（打开或者复制受限），程序读不了。请在阅读器里打开它、`
        + '「另存为」一份去掉密码的副本再传。'
      );
    }
    throw new ExtractError(
      `${filename} 解析失败（${e?.message || '未知错误'}）——文件多半在传输中被截断了，`
      + '或者本身不是一份完整的 PDF。请重新导出一份再传。'
    );
  }

  const pages = Math.min(doc.numPages, MAX_PDF_PAGES);
  if (doc.numPages > MAX_PDF_PAGES) {
    notes.push(
      `这份 PDF 有 ${doc.numPages} 页，只提取了前 ${MAX_PDF_PAGES} 页 —— 第 `
      + `${MAX_PDF_PAGES + 1} 页之后的内容**不在**下面的正文里。要用后面那部分的话，`
      + '请在阅读器里把那几页单独导出成一份 PDF 再传。'
    );
  }

  const blocks: string[] = [];
  const emptyPages: number[] = [];
  for (let i = 1; i <= pages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const text = joinItems(content.items as TextItem[]);
    // 每页读完就放掉：不放的话一份两百页的 PDF 会把整本的渲染中间态一起攥在内存里
    // （multer 的 memoryStorage 已经攥着原文件了）。
    page.cleanup();
    if (!text) {
      emptyPages.push(i);
      continue;
    }
    blocks.push(`--- 第 ${i} 页 ---\n${text}`);
  }

  if (!blocks.length) throw new ExtractError(NO_TEXT_LAYER_HINT);

  // 「有几页一个字都没读到」**不进 notes**（那一栏现在只留「这一份和你以为的不一样」，
  // 每份都顶几条黄框的话真出问题的那条就淹了）—— 它走 emptyPages 计数，
  // 显示在卡片的字数那一行。要它一个字都不说是不行的：剩下那些页拼起来读着完整，
  // 没人会发现少了几页（这几页的解法也不一样 —— 导成 PNG/JPG 当图片传）。

  const out = blocks.join('\n\n');
  const bad = countGarbled(out);
  const ratio = bad / out.length;
  if (ratio > GARBLED_FATAL_RATIO) {
    throw new ExtractError(
      `${filename} 有文字层，但提取出来的 ${out.length} 个字符里有 ${bad} 个是乱码（`
      + `${Math.round(ratio * 100)}%）—— 这份 PDF 的字体没带 Unicode 映射表`
      + '（常见于中文字体子集、设计软件导出的稿子），字形能显示，但对程序来说没有对应的字。\n'
      + '出路：① 用阅读器打开，全选复制，直接贴进资料框（复制出来是好的话就能用）；'
      + '② 把要用的那几页导出成 PNG / JPG 再传上来走图片识别。\n'
      + '这里不把这份乱码交上去是有意的：它进了客户资料之后，AI 读不懂就会照行业常识把内容'
      + '补出来，而补出来的那份资料读起来和真的一模一样。'
    );
  }
  if (ratio > GARBLED_NOTE_RATIO) {
    notes.push(
      `正文里有 ${bad} 处乱码（占 ${Math.round(ratio * 100)}%，PDF 字体缺 Unicode 映射表）。`
      + '请扫一眼下面的正文，乱码多的那几段自己删掉 —— 留着的话 AI 会照常识把它们补成通顺的句子。'
    );
  }
  return { text: out, emptyPages: emptyPages.length };
}

/**
 * 一页的 text item 拼成行。
 *
 * pdfjs 给的是一串片段（同一行常常被拆成好几个 item，字体一变就断一次），
 * 换行看 `hasEOL`。**不能简单地全部用空格连起来**：那样一页出来是一条几千字的长行，
 * 而后面整理那一步是按行切段的（超长行只能硬切），切在句子中间的两段会各自把半截
 * 内容当完整的一节整理。
 */
function joinItems(items: TextItem[]): string {
  let line = '';
  const lines: string[] = [];
  const flush = () => {
    const t = line.replace(/[ \t]+/g, ' ').trim();
    if (t) lines.push(t);
    line = '';
  };
  for (const it of items) {
    if (typeof it.str !== 'string') continue;
    line += it.str;
    if (it.hasEOL) flush();
  }
  flush();
  return lines.join('\n');
}

/**
 * 乱码字符数：U+FFFD（解码失败）+ 私用区 U+E000–U+F8FF（字体子集没带映射表时
 * 每个字形都落在这里）。私用区必须算进来 —— 只数 U+FFFD 的话，一份满屏私用区符号的
 * 中文 PDF 在这里是「0 处乱码」，一路顺畅地进客户资料。
 */
function countGarbled(s: string): number {
  return (s.match(/[\uFFFD\uE000-\uF8FF]/g) || []).length;
}

