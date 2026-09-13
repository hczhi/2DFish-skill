// 客户资料文件 → 纯文本。**只做程序提取，不调 AI**（AI 梳理是下一层的事）。
//
// 存在的理由和这一层的边界：这段文本最终会进「客户原始资料」，而那段资料是后面
// 十二步每一次调用的地基。所以这里的每一种失败都必须**说出真实成因**，绝不返回空串
// 让上层接着往下走 —— 一个扫描版 PPT 提取出 0 字，静默追加的话用户以为资料进去了，
// 十二步全按空资料推，而每一步的正文读起来完全正常（同 intakeService「0 题必须抛错」）。
//
// 另一类同样危险的「成功」：提取到了字，但那些字没法读（pptx 的文本散在各个 shape 里、
// GBK 的 txt 解成一片 �）。这种不抛错，走 `notes` 回给界面，由用户在预览区里自己看 ——
// 所以 notes 必须显示出来，吞掉它等于把「提取出一份碎片」和「提取干净」画成同一个样子。

import JSZip from 'jszip';
import mammoth from 'mammoth';
import WordExtractor from 'word-extractor';
import { extractPdf, PDF_MAGIC } from './pdfExtract.js';

/**
 * 一次能传多大。客户给的品牌 PPT 动辄几百兆（整本手册、内嵌视频），给 300MB。
 *
 * 注意这个数**不是**只关这一处：文件走 multer 的 memoryStorage，整份进内存
 * （zip 的话解压出来的 XML 还要再占一份），所以调它等于调这台机器的峰值内存。
 * 反代那一层还有一道自己的上限（Nginx 的 `client_max_body_size` 缺省 1MB）——
 * 它拦下来的是一句 **413 HTML**，不经过我们任何代码，界面上只有一句
 * 「上传失败」而后端日志里一个字都没有，看起来像接口挂了。
 */
export const MAX_FILE_BYTES = 300 * 1024 * 1024;

/**
 * 支持的扩展名（`.ppt` 不在里面 —— 见 LEGACY_PPT_HINT）。
 *
 * 图片（.png/.jpg/…）**不在这里**：它们走的是完全另一条路（大模型识别，要花额度，
 * 见 imageExtractService.ts），而这个文件的合约是「只做程序提取、不调 AI」。
 * 把图片混进来的话，一次「提取」会静默扣掉一次他今天 10 次里的额度。
 */
export const SUPPORTED_EXTS = ['.txt', '.md', '.docx', '.doc', '.pptx', '.pdf'] as const;

/**
 * `.ppt`（PowerPoint 97-2003 的二进制格式）在 Node 里没有能用的解析库。
 * 硬解出来的是夹着大段二进制垃圾的字符串 —— 交给模型梳理之后会得到一份通顺的、
 * 完全编出来的资料，而那份东西看起来和真的一样。所以这里明确拒绝并给出路。
 */
const LEGACY_PPT_HINT =
  '.ppt 是 PowerPoint 97-2003 的老格式，程序读不出里面的文字（硬读会得到一堆二进制乱码，'
  + '让 AI 去梳理只会编出一份看起来很正常的假资料）。请在 PowerPoint / WPS 里打开它，'
  + '「另存为」选 .pptx 再传一次。';

export class ExtractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExtractError';
  }
}

export interface ExtractResult {
  filename: string;
  ext: string;
  text: string;
  chars: number;
  /** 「提取成功了，但可能不是你要的」——必须显示给用户。 */
  notes: string[];
}

export function extFromName(filename: string): string {
  const m = /\.[a-z0-9]+$/i.exec(filename.trim());
  return m ? m[0].toLowerCase() : '';
}

/** ZIP（= docx/pptx 这类 OOXML）和 OLE2（= 97-2003 的 doc/ppt）的文件头。 */
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const OLE2_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

export async function extractFile(filename: string, buf: Buffer): Promise<ExtractResult> {
  const ext = extFromName(filename);
  if (ext !== '.ppt' && !SUPPORTED_EXTS.includes(ext as (typeof SUPPORTED_EXTS)[number])) {
    throw new ExtractError(
      `不支持 ${ext || '这种没有扩展名的'} 文件。目前支持：${SUPPORTED_EXTS.join(' / ')}`
    );
  }
  if (!buf.length) throw new ExtractError(`${filename} 是个空文件（0 字节）。`);

  const notes: string[] = [];
  if (ext === '.txt' || ext === '.md') {
    const decoded = decodePlainText(buf);
    if (decoded.note) notes.push(decoded.note);
    return finish(filename, ext, decoded.text, notes);
  }

  // **按文件头分派，不按扩展名。** 改了扩展名的文件到处都有（尤其是为了绕上传限制），
  // 而按扩展名走的后果不是报错：把 .docx 改名成 .doc 传上来，word-extractor 真能解出
  // 一份正文，只是夹着乱码（实测「防火规���」），那份东西进资料之后模型会照常识把
  // 那几个字补掉，读起来完全正常。反过来一个真 .ppt 改名成 .pptx，jszip 只会回一句
  // 「Can't find end of central directory」—— 用户不知道那是「格式太老」还是「文件坏了」。
  const looksZip = buf.subarray(0, 4).equals(ZIP_MAGIC);
  const looksOle2 = buf.subarray(0, 8).equals(OLE2_MAGIC);
  const looksPdf = buf.subarray(0, 4).equals(PDF_MAGIC);

  if (looksPdf) {
    // 「叫 .docx 其实是 PDF」在客户发来的资料里很常见（微信转存、改扩展名图省事）。
    // 按扩展名走的话下面 jszip 只会回一句「解压失败」，而这份文件本身是好的。
    if (ext !== '.pdf') {
      notes.push(`这个文件叫 ${ext}，实际是 PDF（已按 PDF 解析）。`);
    }
    return finish(filename, '.pdf', await extractPdf(filename, buf, notes), notes);
  }
  if (ext === '.pdf') {
    throw new ExtractError(
      `${filename} 的扩展名是 .pdf，但文件头不是 PDF（前四个字节不是 %PDF）——`
      + '它多半是别的东西改了扩展名，或者下载/传输时坏了。请重新导出一份再传。'
    );
  }

  if (looksOle2) {
    // OLE2 里 doc 和 ppt 分不出来（都是同一种容器），只能照扩展名的意图给话术。
    if (ext === '.ppt' || ext === '.pptx') throw new ExtractError(LEGACY_PPT_HINT);
    if (ext === '.docx') {
      notes.push('这个文件叫 .docx，实际是老的 .doc 格式（已按 .doc 解析）。老格式解出来的正文偶尔会夹乱码，请扫一眼。');
    }
    return finish(filename, ext, await extractDoc(buf, notes), notes);
  }

  if (!looksZip) {
    throw new ExtractError(
      `${filename} 的文件头既不是 Word/PPT 的新格式（zip），也不是 97-2003 的老格式，也不是 PDF。`
      + '它大概是被改过扩展名的别的东西（压缩包 / 视频 / 设计软件的源文件）。请用原来的程序打开它，'
      + '另存为 .docx / .pptx / .pdf 再传，或者直接把文字复制进资料框。'
    );
  }

  const zip = await loadZip(filename, buf);
  const isPpt = Object.keys(zip.files).some((p) => p.startsWith('ppt/slides/'));
  const isWord = !!zip.file('word/document.xml');
  if (!isPpt && !isWord) {
    throw new ExtractError(
      `${filename} 是个 zip，但里面既不是 Word 文档也不是 PPT（找不到 word/document.xml 或 ppt/slides/）。`
      + '如果它是 .pages / .key / WPS 的私有格式，请先导出成 .docx / .pptx。'
    );
  }
  // 扩展名和真实格式不一致时说一句：解出来的东西是对的，但不说的话「我传的是 PPT，
  // 怎么提出来是一篇文章」这件事在界面上没有任何解释。
  const realExt = isPpt ? '.pptx' : '.docx';
  if (ext !== realExt) {
    notes.push(`这个文件叫 ${ext}，实际是 ${realExt} 格式（已按 ${realExt} 解析）。`);
  }
  const text = isPpt ? await extractPptx(zip, notes) : await extractDocx(zip, buf, notes);
  return finish(filename, realExt, text, notes);
}

function finish(filename: string, ext: string, raw: string, notes: string[]): ExtractResult {
  const text = normalizeBlankLines(raw);
  if (!text.trim()) {
    // 这是这条链路上最贵的一种失败，所以宁可报错也不返回空串。
    throw new ExtractError(
      `${filename} 里没有提取到任何文字。常见原因：整份是扫描件 / 截图 / 图形排版（文字画在图里），`
      + '程序读不到，AI 也没法凭空梳理。请把文字部分复制出来直接贴进资料框。'
    );
  }
  return { filename, ext, text, chars: text.length, notes };
}

/**
 * 纯文本按 UTF-8 解，解出一堆 U+FFFD 就换 GBK 再解一遍。
 *
 * 中文 Windows 上另存的 txt 默认是 GBK，按 UTF-8 解出来是满屏 �。那种情况**不报错**
 * （文件本身没坏），但必须出声：不说的话那一片乱码会以「客户资料」的身份进 prompt，
 * 模型读不懂就照行业常识补，而补出来的正文读起来完全正常。
 */
function decodePlainText(buf: Buffer): { text: string; note?: string } {
  const utf8 = stripBom(buf.toString('utf8'));
  const utf8Bad = countReplacement(utf8);
  if (!utf8Bad) return { text: utf8 };

  try {
    const gbk = new TextDecoder('gbk', { fatal: false }).decode(buf);
    if (countReplacement(gbk) < utf8Bad) {
      return {
        text: stripBom(gbk),
        note: '这个文件不是 UTF-8 编码，已按 GBK 解码。请扫一眼下面的正文有没有乱码。',
      };
    }
  } catch {
    // 这个 Node 没带 GBK 解码器，走下面那条「说清楚」的路。
  }
  return {
    text: utf8,
    note: `文件编码识别不出来，正文里有 ${utf8Bad} 处乱码（显示成 �）。`
      + '请用记事本 / VS Code 另存为 UTF-8 再传一次 —— 乱码进了资料，AI 会照常识把缺的部分补出来。',
  };
}

async function extractDocx(zip: JSZip, buf: Buffer, notes: string[]): Promise<string> {
  const result = await mammoth.extractRawText({ buffer: buf });
  // mammoth 自己的 messages 里是「这段样式没认出来」这类提示，不影响取文字，不往上报。
  // 但文本框（textbox）里的文字 extractRawText 是取不到的，而 PPT 转 Word、
  // 排版花哨的品牌手册最爱用文本框 —— 提取出来少一整块而剩下的部分完全正常。
  const xml = (await zip.file('word/document.xml')?.async('string')) || '';
  if (/<w:txbxContent/.test(xml)) {
    notes.push('这份 .docx 里有文本框，文本框里的文字提取不到（下面的正文会少这几块）。请核对一下有没有缺内容。');
  }
  return result.value;
}

async function extractDoc(buf: Buffer, notes: string[]): Promise<string> {
  let doc;
  try {
    doc = await new WordExtractor().extract(buf);
  } catch (e: any) {
    // 走到这里说明文件头确实是 OLE2（97-2003 的容器），但里面不是 Word ——
    // 最常见是 .ppt / .xls 被改名成了 .doc，其次是文件损坏。
    throw new ExtractError(
      `这个 .doc 读不出来（${e?.message || '未知错误'}）。它是 97-2003 的老格式文件，但里面不是 Word 文档`
      + '（可能是 .ppt / .xls 改了扩展名，也可能已经损坏）。请用 Word / WPS 打开它，另存为 .docx 再传。'
    );
  }
  const body = doc.getBody() || '';
  // 文本框和脚注是分开取的，不取就静默少一块。分节标出来，别混进正文当成客户的原话。
  const boxes = safeCall(() => doc!.getTextboxes({ mainDocument: true, headersFooters: false }));
  const notesText = safeCall(() => doc!.getFootnotes()) + '\n' + safeCall(() => doc!.getEndnotes());
  const parts = [body];
  if (boxes.trim()) parts.push(`【文本框】\n${boxes}`);
  if (notesText.trim()) parts.push(`【脚注/尾注】\n${notesText}`);
  if (!body.trim() && (boxes.trim() || notesText.trim())) {
    notes.push('这份 .doc 的正文是空的，下面只有文本框 / 脚注里的文字。');
  }
  return parts.join('\n\n');
}

function safeCall(fn: () => string): string {
  try {
    return fn() || '';
  } catch {
    return '';
  }
}

/**
 * pptx = 一个 zip，每页一个 `ppt/slides/slideN.xml`，文字散在 `<a:t>` 里。
 *
 * **必须按页分节输出。** 拉平成一大段的话拿到的是几百个无序短语（标题、图例、页脚、
 * 装饰文字混在一起），那种东西模型只能靠猜来组织，而组织出来的结构读着很像原稿。
 * 备注页（notesSlide）也取 —— 咨询类 PPT 的真内容经常全在备注里，漏掉它提取出来
 * 就只有一堆标题，而「只有标题」和「这份 PPT 本来就很简略」看不出区别。
 */
async function extractPptx(zip: JSZip, notes: string[]): Promise<string> {
  const slides = numbered(zip, /^ppt\/slides\/slide(\d+)\.xml$/);
  if (!slides.length) {
    throw new ExtractError('这个 .pptx 里找不到任何幻灯片（ppt/slides/ 是空的），文件可能损坏了。');
  }
  const notesPages = new Map<number, string>();
  for (const n of numbered(zip, /^ppt\/notesSlides\/notesSlide(\d+)\.xml$/)) {
    notesPages.set(n.index, await zip.file(n.path)!.async('string'));
  }

  const blocks: string[] = [];
  let emptyPages = 0;
  for (const slide of slides) {
    const body = xmlLines(await zip.file(slide.path)!.async('string'));
    const note = xmlLines(notesPages.get(slide.index) || '');
    if (!body && !note) {
      emptyPages++;
      continue;
    }
    const parts = [`--- 第 ${slide.index} 页 ---`];
    if (body) parts.push(body);
    if (note) parts.push(`（备注）${note}`);
    blocks.push(parts.join('\n'));
  }
  if (emptyPages) {
    notes.push(
      `有 ${emptyPages} 页一个字都没提取到（整页是图片 / 图表 / 文字画在图里）。`
      + '这几页的内容不在下面的正文里。'
    );
  }
  return blocks.join('\n\n');
}

/** 文件头已经确认是 zip 了才会走到这里，所以打不开就是文件本身坏了/被截断了。 */
async function loadZip(filename: string, buf: Buffer): Promise<JSZip> {
  try {
    return await JSZip.loadAsync(buf);
  } catch (e: any) {
    throw new ExtractError(
      `${filename} 的文件头是对的，但解压失败（${e?.message || '未知错误'}）——`
      + '文件多半在传输过程中被截断了或者本身损坏。请重新导出一份再传。'
    );
  }
}

function numbered(zip: JSZip, pattern: RegExp): Array<{ path: string; index: number }> {
  return Object.keys(zip.files)
    .map((path) => {
      const m = pattern.exec(path);
      return m ? { path, index: Number(m[1]) } : null;
    })
    .filter((x): x is { path: string; index: number } => !!x)
    .sort((a, b) => a.index - b.index); // slide10 要排在 slide2 后面，字典序不行
}

/** 一个 `<a:p>` 是一行，行内的多个 `<a:t>` 是同一句被拆开的 run，要拼回去。 */
function xmlLines(xml: string): string {
  if (!xml) return '';
  const lines: string[] = [];
  for (const para of xml.split(/<a:p[\s>]/).slice(1)) {
    const runs = [...para.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g)].map((m) => decodeEntities(m[1]));
    const line = runs.join('').replace(/\s+/g, ' ').trim();
    if (line) lines.push(line);
  }
  return lines.join('\n');
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&'); // 放最后，否则 &amp;lt; 会被解成 <
}

function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

function countReplacement(s: string): number {
  return (s.match(/�/g) || []).length;
}

/** 统一换行 + 把三个以上的空行压成两个（word/pptx 里空段落一大堆，白占字数上限）。 */
function normalizeBlankLines(s: string): string {
  return s
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
