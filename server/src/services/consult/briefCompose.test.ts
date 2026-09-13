import { describe, it, expect } from 'vitest';

// 上传的文件内容现在是**自动带进**客户资料的（用户不再逐份点「插入」），所以这条路上
// 每一种失败都长成「创建成功」：少带一份 = 资料里少一节，而剩下的读起来照样是一份完整的
// 资料，后面十二步就照着少一份的资料推，每一步的正文都正常。手测测不出来。

const { composeBrief, buildBrief, MAX_ATTACHMENTS } = await import('./briefCompose.js');
const { MAX_BRIEF_CHARS } = await import('./projectStore.js');
const { TIDY_BUDGET_CHARS } = await import('./fileTidyService.js');

const att = (filename: string, text: string, variant: 'tidy' | 'raw' = 'tidy') => ({
  filename,
  text,
  variant,
});

describe('consult 新建项目时合成客户资料', () => {
  it('每一份文件都进了资料，并且各自标出来源和是不是 AI 整理过的', () => {
    const list = Array.from({ length: MAX_ATTACHMENTS }, (_, i) => att(`文件${i}.pptx`, `内容${i}`));
    const brief = buildBrief('我手打的那段', list);
    for (let i = 0; i < MAX_ATTACHMENTS; i++) {
      expect(brief).toContain(`【上传文件：文件${i}.pptx（AI 整理）】`);
      expect(brief).toContain(`内容${i}`);
    }
    expect(brief.startsWith('我手打的那段')).toBe(true);
    // 原文那份要标成「原文」：三种来源（客户自己写的 / 从 PPT 抠的 / AI 重新组织过的）
    // 可信度不一样，混成一段之后再也分不出来。
    expect(buildBrief('', [att('a.docx', 'x', 'raw')])).toContain('（原文）');
  });

  it('合计超上限时拒绝并列出每份占多少字，不截断', () => {
    const list = Array.from({ length: MAX_ATTACHMENTS }, (_, i) =>
      att(`文件${i}.pptx`, '甲'.repeat(TIDY_BUDGET_CHARS))
    );
    const typed = '乙'.repeat(MAX_BRIEF_CHARS - MAX_ATTACHMENTS * TIDY_BUDGET_CHARS);
    // 点名每一份的字数：只说「超了 N 字」的话他得对着五张一样的卡片自己数。
    expect(() => buildBrief(typed, list)).toThrow(/文件0\.pptx/);
    expect(() => buildBrief(typed, list)).toThrow(new RegExp(`超过上限 ${MAX_BRIEF_CHARS} 字`));
  });

  it('单份超上限时点名是哪个文件，空的那份也报错而不是跳过', () => {
    expect(() => buildBrief('', [att('品牌手册.pptx', '甲'.repeat(TIDY_BUDGET_CHARS + 10))])).toThrow(
      /品牌手册\.pptx/
    );
    // 跳过空的那一份 = 资料里少一节，而界面上那张卡片还在，他以为它带进去了。
    expect(() => buildBrief('', [att('空的.docx', '   ')])).toThrow(/空的\.docx/);
  });

  it('前端那个「合计 N 字」照的是同一份拼法（两边漂了的话，显示 19800 点下去被拒 20300）', () => {
    const list = [att('a.pptx', 'AAA'), att('b.docx', 'BBB', 'raw')];
    const mirrored = ['手打', ...list.map((a) => `【上传文件：${a.filename}（${a.variant === 'tidy' ? 'AI 整理' : '原文'}）】\n${a.text}`)].join('\n\n');
    expect(composeBrief('手打', list)).toBe(mirrored);
  });
});
