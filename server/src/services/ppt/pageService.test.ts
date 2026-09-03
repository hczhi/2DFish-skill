import { describe, it, expect, vi, beforeEach } from 'vitest';

// 这一步每种失败都是「浏览器里照样渲染出一页」：缺 `</section>` 只是下半页没了、类名写错
// 只是那一块掉回默认流式布局、全幅版式包进 .slide-inner 只是四边多了留白、模型自己写的
// 页码只是和它在 deck 里的位置对不上 —— 手测时全都读成「这个版式设计得就这样」。

vi.mock('../../core/llm/gateway.js', () => ({ aiGateway: vi.fn() }));

const { aiGateway } = await import('../../core/llm/gateway.js');
const { generatePage, buildDeck, PageError } = await import('./pageService.js');

function reply(content: string, finish = 'stop', reasoningTokens?: number) {
  (aiGateway as any).mockResolvedValue({
    response: {
      choices: [{ message: { content }, finish_reason: finish }],
      usage: { completion_tokens_details: { reasoning_tokens: reasoningTokens } },
    },
    usage: { input_tokens: 100, output_tokens: 200, total_tokens: 300 },
    duration_ms: 1000,
    noThinking: true,
  });
}

const base = {
  page: 3,
  total: 12,
  section: '第二章',
  title: '三阶段路径',
  points: ['试点', '复制', '平台化'],
  images: 0,
};

beforeEach(() => vi.clearAllMocks());

describe('生成一页 HTML', () => {
  it('模型没写 <section> 时抛错，而不是回一段空 HTML', async () => {
    // 回空 HTML 的话 iframe 里是一块白，读起来像这个版式渲染塌了。
    reply('好的，这一页我建议用左右分栏，左边放三个阶段……');
    await expect(generatePage({ ...base, layoutId: 'L1' }, 'u1')).rejects.toThrow(PageError);
    await expect(generatePage({ ...base, layoutId: 'L1' }, 'u1')).rejects.toThrow(/没有返回 <section>/);
  });

  it('额度全花在思维链上时，报错里要带那个 token 数', async () => {
    // 不带的话用户只会一路调高 max_tokens，而那个数字永远调不完（硬规则 2）。
    reply('', 'length', 5800);
    await expect(generatePage({ ...base, layoutId: 'L1' }, 'u1')).rejects.toThrow(/5800/);
  });

  it('被截断（没有 </section>）时补上闭合并喊出来', async () => {
    reply('<section class="slide"><div class="slide-inner"><h2>三阶段路径</h2>', 'length');
    const r = await generatePage({ ...base, layoutId: 'L1' }, 'u1');
    expect(r.html.trimEnd().endsWith('</section>')).toBe(true);
    expect(r.problems.join(' ')).toMatch(/截断/);
  });

  it('模型写的页码角标被摘掉（页面上不显示页码）', async () => {
    // 那两个类已经从 template 里删了，留着的话它掉回默认流式布局 —— 正文里凭空多出
    // 一行「07 / 9」，读起来像这一页的设计（不报错），而它和这一页在 deck 里的位置无关。
    reply(
      '<section class="slide"><div class="slide-inner"><h2>三阶段路径</h2>' +
        '<div class="page-badge"><b>07</b> / 9</div><div class="wm">{{PAGE_NUM}}</div></div></section>'
    );
    const r = await generatePage({ ...base, layoutId: 'L1' }, 'u1');
    expect(r.html).not.toContain('page-badge');
    expect(r.html).not.toContain('07');
    expect(r.html).not.toContain('{{');
  });

  it('全幅版式被包进 .slide-inner 时点名说出来', async () => {
    // L2 是全幅版式：包进去出来是一张四边留白的「全幅」图，不报错。
    reply('<section class="slide"><div class="slide-inner"><h2>标题</h2></div></section>');
    const r = await generatePage({ ...base, layoutId: 'L2' }, 'u1');
    expect(r.problems.join(' ')).toMatch(/L2 是全幅版式/);
  });

  it('整份那段和这一页那段的要求都进了 prompt，而且排在版式骨架和配色 token 之后', async () => {
    // 两件事：夹在近 8000 字的版式骨架前面的话模型照旧按版式建议排；页级那段顶掉整份那段
    // 的话，他在这一页补一句话，整份定的语气就在这一页悄悄失效了 —— 两种出来都是一页
    // 完整正常的幻灯片，只是要求没生效，没有一处会说（他只会再写一遍、再花一次额度）。
    reply('<section class="slide"><div class="slide-inner"><h2>三阶段路径</h2></div></section>');
    await generatePage(
      { ...base, layoutId: 'L1', deckNotes: '语气克制，不要感叹号', notes: '这一页的数字用等宽字体' },
      'u1'
    );
    const prompt = (aiGateway as any).mock.calls[0][0].messages[0].content as string;
    expect(prompt).toContain('语气克制，不要感叹号');
    expect(prompt).toContain('这一页的数字用等宽字体');
    expect(prompt.indexOf('语气克制')).toBeGreaterThan(prompt.indexOf('## 配色与排版 token'));
  });

  it('用了 template 里没有的类名要点名，且预览是套好外壳的整页', async () => {
    reply('<section class="slide"><div class="slide-inner"><h2 class="mega-title">三阶段</h2></div></section>');
    const r = await generatePage({ ...base, layoutId: 'L1' }, 'u1');
    expect(r.problems.join(' ')).toMatch(/mega-title/);
    // previewHtml 由服务端用 deckShell 拼（前端自己拼一遍的话「预览里好看、真 deck 里
    // 换了骨架」两边都不报错），所以占位符必须已经填掉。
    expect(r.previewHtml).toContain('mega-title');
    expect(r.previewHtml).not.toContain('{{');
  });
});

describe('拼整份 deck', () => {
  const sec = (n: number) => `<section class="slide" data-p="${n}"><div class="slide-inner">${n}</div></section>`;
  const meta = { brandCn: '云启数科', brandEn: 'YUNQI', topic: 'AI 转型' };

  it('缺页不给拼，并点名缺哪几页', () => {
    // 缺页的 deck 翻起来和完整的一模一样（页码是按规划总页数写的），只是内容跳了一段。
    expect(() => buildDeck([{ page: 1, html: sec(1) }, { page: 3, html: sec(3) }], 3, meta)).toThrow(/第 2 页/);
  });

  it('整份 deck 带页脚，制作过程中的单页预览不带', async () => {
    // 反了都不报错：单页预览里那条页脚压在画面底部 54px 上，挡掉的一行看起来像
    // 「这一页排版就是这样」；而导出的文件丢了页脚就没有进度条和目录，双击打开一切正常。
    expect(buildDeck([{ page: 1, html: sec(1) }], 1, meta)).not.toContain('#footer{display:none}');
    reply('<section class="slide"><div class="slide-inner"><h2>三阶段路径</h2></div></section>');
    const r = await generatePage({ ...base, layoutId: 'L1' }, 'u1');
    expect(r.previewHtml).toContain('#footer{display:none}');
  });

  it('按页码排，不按传进来的顺序', () => {
    // 批量生成是逐页回来的，传进来的顺序可能是完成顺序 —— 照它拼的话每一页都对、章节全乱。
    const html = buildDeck([{ page: 2, html: sec(2) }, { page: 1, html: sec(1) }], 2, meta);
    expect(html.indexOf('data-p="1"')).toBeLessThan(html.indexOf('data-p="2"'));
    expect(html).not.toContain('{{');
  });
});
