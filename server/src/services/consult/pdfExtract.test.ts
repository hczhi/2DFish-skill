import { describe, it, expect } from 'vitest';
import { extractFile, ExtractError } from './fileExtract.js';

// 只测「出错时会伪装成成功」的那几条。PDF 这条路上最贵的一种是**没有文字层**：
// 扫描件在阅读器里和普通 PDF 一模一样，而程序提取出 0 字 —— 静默通过的话，
// 用户以为那份 30 页的品牌手册进了资料，后面十二步全按空资料推，每一步的正文都正常。

/**
 * 手搓一份带文字层的最小 PDF。`pages` 里每一项是那一页的几行文字，
 * 空数组 = 那一页没有任何文字（= 扫描页在程序眼里的样子）。
 *
 * 不用现成的库造 fixture 是有意的：这里要造的恰恰是「不正常」的 PDF（整页无文字），
 * 而导出工具造不出那种东西。
 */
function makePdf(pages: string[][]): Buffer {
  const objs: string[] = [];
  const ref = (i: number) => `${i} 0 R`;
  // 1 = Catalog，2 = Pages，之后每页两个对象（Page + Contents），最后一个是字体
  const pageIds = pages.map((_, i) => 3 + i * 2);
  const fontId = 3 + pages.length * 2;
  objs.push('<< /Type /Catalog /Pages 2 0 R >>');
  objs.push(`<< /Type /Pages /Kids [${pageIds.map(ref).join(' ')}] /Count ${pages.length} >>`);
  pages.forEach((lines, i) => {
    const content = lines.length
      ? `BT /F1 12 Tf 20 700 Td 14 TL\n${lines.map((l) => `(${l}) Tj T*`).join('\n')}\nET`
      : '0 0 1 RG 20 20 100 100 re S'; // 只画一个方框：有内容流，但一个字符都没有
    objs.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents ${ref(pageIds[i] + 1)}`
      + ` /Resources << /Font << /F1 ${ref(fontId)} >> >> >>`
    );
    objs.push(`<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`);
  });
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');

  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

describe('PDF 文字层提取', () => {
  it('整份没有文字层时报错，并给出「导成图片再传」这条出路', async () => {
    // 这份文件在他手里能翻页、能看字，所以「提取不到文字」本身讲不通 ——
    // 必须说清是没有文字层，并给出下一步动作，否则他只会换个导出方式反复传同一份。
    const buf = makePdf([[], []]);
    await expect(extractFile('扫描版手册.pdf', buf)).rejects.toThrow(ExtractError);
    await expect(extractFile('扫描版手册.pdf', buf)).rejects.toThrow(/没有文字层/);
    await expect(extractFile('扫描版手册.pdf', buf)).rejects.toThrow(/PNG \/ JPG/);
  });

  it('只有几页是图时报出漏了几页，其余照常提取', async () => {
    // 这一条最像成功：正文有内容、分页整齐，只是第 2、4 页的内容压根不在里面。
    // 页数走 emptyPages（显示在卡片的字数那一行），不进 notes —— 见 ExtractResult.emptyPages。
    const { text, emptyPages, ext } = await extractFile(
      '半扫描.pdf',
      makePdf([['Brand positioning'], [], ['Revenue 1234'], []])
    );
    expect(ext).toBe('.pdf');
    expect(text).toContain('Brand positioning');
    expect(emptyPages).toBe(2);
  });

  it('按页分节，分页标记和 pptx 用同一种写法', async () => {
    // 整理那一步（fileTidyService.splitForTidy）按 `--- 第 N 页 ---` 决定在哪里切段。
    // 换个写法不报错：切段退回按字数硬切，切在一页中间的两段会各自把半截内容当完整的
    // 一节整理，拼起来读得通、但是重复且缺东西的。
    const { text } = await extractFile('deck.pdf', makePdf([['Page one text'], ['Page two text']]));
    expect(text).toContain('--- 第 1 页 ---');
    expect(text).toContain('--- 第 2 页 ---');
    expect(text.indexOf('Page one text')).toBeLessThan(text.indexOf('Page two text'));
  });

  it('叫 .pdf 但文件头不是 PDF 时说清是文件头不对，不去当 zip 解', async () => {
    // 落到 zip 那条路的话回的是一句「解压失败」，他会以为文件坏了重新导一遍 ——
    // 而真正的成因是这份东西压根不是 PDF（改过扩展名）。
    await expect(extractFile('资料.pdf', Buffer.from('PK\x03\x04not really'))).rejects.toThrow(
      /文件头不是 PDF/
    );
  });
});
