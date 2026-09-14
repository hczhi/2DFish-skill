import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { extractFile, ExtractError } from './fileExtract.js';

// 这里只测「出错时会伪装成成功」的那几条：提取出 0 字、少了几页、按错的格式解出乱码。
// 剩下的（不支持的扩展名、空文件、超大文件）都是当场报错给用户的，手测就看到了。

/** 造一个只有我们的解析器要读的那几个条目的 pptx。 */
async function pptx(slides: Record<number, string[]>, notes: Record<number, string[]> = {}) {
  const zip = new JSZip();
  const para = (t: string) => `<a:p><a:r><a:t>${t}</a:t></a:r></a:p>`;
  for (const [n, lines] of Object.entries(slides)) {
    zip.file(`ppt/slides/slide${n}.xml`, `<p:sld><p:cSld>${lines.map(para).join('')}</p:cSld></p:sld>`);
  }
  for (const [n, lines] of Object.entries(notes)) {
    zip.file(`ppt/notesSlides/notesSlide${n}.xml`, `<p:notes>${lines.map(para).join('')}</p:notes>`);
  }
  return zip.generateAsync({ type: 'nodebuffer' });
}

describe('fileExtract', () => {
  it('整份 PPT 一个字都提不到时抛错，不返回空字符串', async () => {
    // 扫描件 / 整页是图的 PPT 就是这样。返回空串的话调用方会把「空资料」当成
    // 提取成功追加进「客户原始资料」，后面十二步全按空资料推，每一步都不报错。
    const buf = await pptx({ 1: [], 2: [] });
    await expect(extractFile('全是图.pptx', buf)).rejects.toThrow(ExtractError);
    await expect(extractFile('全是图.pptx', buf)).rejects.toThrow(/没有提取到任何文字/);
  });

  it('部分页提不到字时，要把漏掉的页数报出来', async () => {
    // 这一条最像成功：正文有内容、分页也整齐，只是少了两页。不报数的话
    // 「这份 PPT 本来就很简略」和「两页内容画在图里没提出来」在界面上是同一个样子。
    const { text, emptyPages } = await extractFile('半图.pptx', await pptx({ 1: ['品牌定位'], 2: [], 3: [] }));
    expect(text).toContain('品牌定位');
    expect(emptyPages).toBe(2);
  });

  it('按页分节输出，slide10 排在 slide2 后面，备注也取进来', async () => {
    // 拉平成一大段的话拿到的是几百个无序短语，模型只能靠猜来组织，而组织出来的
    // 结构读着很像原稿。页序错了同理：结论顺序全跟着错，正文照样通顺。
    const { text } = await extractFile(
      'deck.pptx',
      await pptx({ 2: ['第二页标题'], 10: ['第十页标题'] }, { 10: ['这页的真内容在备注里'] })
    );
    expect(text.indexOf('第二页标题')).toBeLessThan(text.indexOf('第十页标题'));
    expect(text).toContain('--- 第 10 页 ---');
    expect(text).toContain('（备注）这页的真内容在备注里');
  });

  it('同一行被拆成多个 run 时要拼回去，XML 实体要解开', async () => {
    // Word/PPT 会把一句话按格式拆成好几个 <a:t>。不拼回去就是一句话变成好几行碎片，
    // 而碎片和「这份 PPT 就是这么排的」看不出区别。
    const zip = new JSZip();
    zip.file(
      'ppt/slides/slide1.xml',
      '<a:p><a:r><a:t>正骨水</a:t></a:r><a:r><a:t>&amp;</a:t></a:r><a:r><a:t>湿毒清</a:t></a:r></a:p>'
    );
    const { text } = await extractFile('x.pptx', await zip.generateAsync({ type: 'nodebuffer' }));
    expect(text).toContain('正骨水&湿毒清');
  });

  it('扩展名和真实格式不一致时按文件头解析，并说出实际是什么格式', async () => {
    // 按扩展名分派的话，一个 pptx 改名成 .docx 会被 mammoth 解出一段不知所云的东西
    // （或者 .docx 改名成 .doc 被老解析器解出夹乱码的正文，实测「防火规���」）——
    // 都不报错，只是资料里多了一段读起来很正常的错内容。
    const { ext, text, notes } = await extractFile('明明是ppt.docx', await pptx({ 1: ['品牌定位'] }));
    expect(ext).toBe('.pptx');
    expect(text).toContain('品牌定位');
    expect(notes.join(' ')).toMatch(/实际是 \.pptx 格式/);
  });

  it('老的 .ppt（OLE2）明确拒绝并给出路，不当成坏掉的 zip', async () => {
    // 「另存为 .pptx 就能用」和「这个文件坏了」是两句完全不同的话。回后者的话
    // 用户会去重新导出同一个 .ppt，再传一次，再失败。
    const ole2 = Buffer.concat([
      Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
      Buffer.alloc(600),
    ]);
    await expect(extractFile('老板给的.ppt', ole2)).rejects.toThrow(/另存为.*\.pptx/);
  });

  it('GBK 的 txt 要解对并出声说换过编码', async () => {
    // 按 UTF-8 解出来是满屏 �。那一片乱码进资料之后，模型读不懂就照行业常识补，
    // 补出来的正文和照真资料写的一模一样。
    const gbk = Buffer.from([0xd6, 0xd0, 0xce, 0xc4, 0xb6, 0xa8, 0xce, 0xbb]); // 中文定位
    const { text, notes } = await extractFile('客户资料.txt', gbk);
    expect(text).toBe('中文定位');
    expect(notes.join(' ')).toMatch(/GBK/);
  });
});
