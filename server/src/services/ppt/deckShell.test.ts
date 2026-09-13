// 单页预览现在有两条路：整份拼好（`assemblePreview`，生成/配图/就地编辑那几条接口回的）
// 和外壳+一段分开发（`previewShell` + `previewSection`，列表接口回的，前端自己 replace）。
//
// 这两条**必须逐字一致**。漂开的时候没有任何报错：左边缩略图和右边画面都是一页正常的
// 幻灯片，只是设计规范那一段（配色/字体）或者那层蒙版少了一处 —— 而「预览里蓝的、
// 导出的文件橙的」正是 096/097 那两条注释在防的事。手测两边都好看，所以必须有这条断言。
import { describe, it, expect } from 'vitest';
import { assemblePreview, previewShell, previewSection, PREVIEW_SLOT } from './deckShell.js';

const meta = {
  brandCn: '巧南',
  brandEn: 'QiaoNan',
  topic: '这是主题',
  // 默认那套之外的一档，四样都换掉 —— 用默认值的话「设计规范这一段漏了」测不出来。
  design: { palette: 'P-C', font: 'F-C', density: 'D-C', header: 'H-D' },
};

// `$&` 在字符串形式的 replace 里会被当成「刚匹配到的那一段」展开，悄悄吃掉几个字符。
const page = '<section class="slide" data-eid="t1"><h2>标题 $& {{BRAND_CN}}</h2></section>';

describe('单页预览的两条路', () => {
  it('外壳+一段 拼出来的和整份拼的逐字一样（含蒙版和设计规范）', () => {
    for (const veil of [0, 0.35]) {
      const whole = assemblePreview(page, meta, veil);
      const split = previewShell(meta).replace(PREVIEW_SLOT, () => previewSection(page, meta, veil));
      expect(split).toBe(whole);
    }
    // 上面那条断言只有在这几样**真的在**输出里时才有意义（都没有的话两边一样也没说明什么）。
    const out = assemblePreview(page, meta, 0.35);
    expect(out).toMatch(/--veil\s*:\s*0?\.35/);
    expect(out).toContain('--c-');
    expect(out).toContain('#footer{display:none}');
    expect(out).toContain('$&');
  });

  it('外壳里有且只有一个插入点（丢了 = iframe 里是一块白）', () => {
    const shell = previewShell(meta);
    expect(shell.split(PREVIEW_SLOT)).toHaveLength(2);
  });
});
