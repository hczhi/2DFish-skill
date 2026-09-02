import { describe, it, expect } from 'vitest';
import { exportDeck, ExportError } from './exportService.js';

// 导出这条路上每种失败都是「文件下载下来了、双击打开一片正常」：图的相对地址在
// file:// 下全是破图（而文字和版式完全正常，看起来像这份稿子就没配图）、占位图没换
// 也是一样的灰块、品牌名里一个斜杠就让下载静默不发生。所以这几条必须有测试。

const meta = { brandCn: '云启科技', brandEn: 'YQ', topic: 'AI 转型路径' };

function page(page: number, inner: string) {
  return { page, html: `<section class="slide"><div class="slide-inner">${inner}</div></section>` };
}

describe('导出整份 deck', () => {
  it('图的相对地址全部改成绝对地址（两种写法都要认）', () => {
    const r = exportDeck(
      [
        page(1, '<img src="https://cos/a.png" alt="">'),
        page(2, '<div style="background-image:url(/uploads/b.png)"></div><img src="/ppt-cases/ph-1x1.svg">'),
      ],
      2,
      meta,
      'https://ppt.example.com/'
    );
    expect(r.html).toContain('src="https://ppt.example.com/ppt-cases/ph-1x1.svg"');
    expect(r.html).toContain('url(https://ppt.example.com/uploads/b.png)');
    // 已经是绝对地址的不动，deck 外壳的占位符必须已经填掉
    expect(r.html).toContain('src="https://cos/a.png"');
    expect(r.html).not.toContain('{{');
    expect(r.html).toContain('云启科技');
  });

  it('还剩占位图 / 图落在本机磁盘 / 字体走 CDN 三件都要点名', () => {
    // 这三样在导出那一刻的预览里全都看不出来 —— 用户是转给别人打开时才发现。
    const r = exportDeck([page(1, '<img src="/ppt-cases/ph-16x9.svg"><img src="/uploads/x.png">')], 1, meta, 'https://p.io');
    expect(r.placeholders).toBe(1);
    expect(r.warnings.join(' ')).toMatch(/占位图/);
    expect(r.warnings.join(' ')).toMatch(/\/uploads/);
    expect(r.warnings.join(' ')).toMatch(/字体/);
  });

  it('本机地址要单独说一句（发给别人打不开）', () => {
    const r = exportDeck([page(1, '<img src="/ppt-cases/ph-16x9.svg">')], 1, meta, 'http://localhost:5173');
    expect(r.warnings.join(' ')).toMatch(/只有你自己这台机器/);
  });

  it('导出地址不对时抛错，而不是拼出一份图全是错地址的文件', () => {
    expect(() => exportDeck([page(1, 'x')], 1, meta, 'ppt.example.com')).toThrow(ExportError);
  });

  it('文件名里不留路径分隔符', () => {
    // `a/b.html` 会让浏览器把文件存到别处或者直接不下载，而那次点击什么都不发生。
    const r = exportDeck([page(1, 'x')], 1, { ...meta, topic: '2026 战略/规划：第一版' }, 'https://p.io');
    expect(r.filename).not.toMatch(/[\\/:]/);
    expect(r.filename).toMatch(/\.html$/);
  });
});
