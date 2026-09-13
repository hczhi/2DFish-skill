import { describe, it, expect, vi, beforeEach } from 'vitest';

// 这一步每种失败都是「浏览器里照样渲染出一页」：缺 `</section>` 只是下半页没了、类名写错
// 只是那一块掉回默认流式布局、全幅版式包进 .slide-inner 只是四边多了留白、模型自己写的
// 页码只是和它在 deck 里的位置对不上 —— 手测时全都读成「这个版式设计得就这样」。

vi.mock('../../core/llm/gateway.js', () => ({ aiGateway: vi.fn() }));

const { aiGateway } = await import('../../core/llm/gateway.js');
// 版式启用状态在库里（layoutState）：checkPage 要按它给「换成哪几条装得下」的建议。
const { initDatabase } = await import('../../db/index.js');
initDatabase();
const { generatePage, buildDeck, PageError } = await import('./pageService.js');
const { domTree } = await import('./pageEdit.js');

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
    // L13 是全幅版式（内容整块脱离 .slide-inner）：包进去出来是一张四边留白的「全幅」图，
    // 不报错。L2/L3 那种「背景图铺满、文字仍在 .slide-inner 里」的**不算全幅**，别拿来当例子。
    reply('<section class="slide"><div class="slide-inner"><h2>标题</h2></div></section>');
    const r = await generatePage({ ...base, layoutId: 'L13' }, 'u1');
    expect(r.problems.join(' ')).toMatch(/L13 是全幅版式/);
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

  it('页眉换成提纲里那条模块名（模型自己写的那个整块摘掉，不剩孤立的 </div>）', async () => {
    // 三种静默：模型改写模块名（每页左上角那行字都不太一样，只有连着翻才看出来）；不摘掉它
    // 就贴我们那份（absolute 定位，同一个位置叠两行字，像渲染错了）；摘的时候切早一个
    // `</div>`（后面那块内容跑到外层容器里，那一页排版整段塌掉而 HTML 照样渲染）。
    reply(
      '<section class="slide">' +
        '<div class="slide-header"><div class="kicker">案例</div></div>' +
        '<div class="slide-inner"><h2 class="page-title">三阶段路径</h2></div>' +
        '</section>'
    );
    const r = await generatePage({ ...base, layoutId: 'L1', section: '第二部分 · 标杆案例' }, 'u1');
    expect(r.html).toContain('<div class="slide-header"><div class="kicker">第二部分 · 标杆案例</div></div>');
    expect(r.html).not.toContain('>案例<'); // 模型写的那句没留下
    expect((r.html.match(/slide-header/g) || []).length).toBe(1);
    // `<div>` 一定还是配对的（切早了 slide-inner 会少一个闭合）
    expect((r.html.match(/<div/g) || []).length).toBe((r.html.match(/<\/div>/g) || []).length);
  });

  it('只有封面那两条不贴页眉，全幅的内容页照样贴；正文里重复写的那行模块名摘掉', async () => {
    // 拿 fullbleed 当「不贴页眉」用的话，L11/L18/L19/L21/L22 这 5 条的模块名会静默消失
    // （模型写的那份被摘掉、代码又不贴），而画面完全正常、problems 里一个字都没有。
    // 反过来在封面上贴一行 = 那一页凭空多一行模块名，也没有一处会说。
    reply('<section class="slide"><div class="l13-bg"></div></section>');
    const cover = await generatePage({ ...base, layoutId: 'L13', section: '第二部分' }, 'u1');
    expect(cover.html).not.toContain('slide-header');

    reply('<section class="slide"><div class="tri-narrative"></div></section>');
    const wide = await generatePage({ ...base, layoutId: 'L11', section: '第四部分 · 推进节奏' }, 'u1');
    expect(wide.html).toContain('<div class="slide-header"><div class="kicker">第四部分 · 推进节奏</div></div>');

    // 正文里那行重复的模块名要**摘掉**，不是报一句了事：这条模型每页都犯，报出来是十几条
    // 一样的提示、每一条都要他自己去就地编辑删 —— 而画面上那两行字（一行代码贴的 17px
    // 加宽字距、一行模型 inline 写的）看起来像设计的一部分。序号写法不一样也算同一个模块名。
    reply(
      '<section class="slide"><div class="slide-inner">' +
        '<div class="kicker" style="font-size:20px">二、方法</div><h2 class="page-title">三阶段</h2></div></section>'
    );
    const dup = await generatePage({ ...base, layoutId: 'L1', section: '方法' }, 'u1');
    expect(dup.html).toContain('<div class="slide-header"><div class="kicker">方法</div></div>');
    expect((dup.html.match(/class="kicker"/g) || []).length).toBe(1);
    expect(dup.html).not.toContain('二、方法');
    expect(dup.problems.join(' ')).toMatch(/正文里有 1 处又写了一遍「方法」/);
  });

  it('不贴页眉的那两条也查重复：多写的摘掉、剩下的重复照样喊出来', async () => {
    // 这个检查原来排在 `layout.noHeader` 的提前返回后面，于是 L2/L13 一个字都不查 ——
    // 而它们恰好是最容易重复的两页（一行小标签 + 一个大标题写的是同一句话），
    // 画面上就是同一句话上下出现两遍，problems 里一个字都没有。留第一处：全摘掉的话
    // 章节页会变成只剩一个标题的空页。
    reply(
      '<section class="slide"><div class="l13-bg"></div>' +
        '<div class="kicker">第二部分</div><h2 class="l13-title">第二部分</h2>' +
        '<div class="kicker">第二部分</div></section>'
    );
    const r = await generatePage({ ...base, layoutId: 'L13', section: '第二部分' }, 'u1');
    expect(r.html).not.toContain('slide-header');
    expect((r.html.match(/class="kicker"/g) || []).length).toBe(1);
    expect(r.problems.join(' ')).toMatch(/「第二部分」在这一页上出现了 2 次/);
  });

  it('这一页的 prompt 里带着这份稿子的规范，而且不再出现别的配色的色值', async () => {
    // 两种静默：规范没带进去 = 紧凑档照标准档的容量排（下面空一块 / 被 overflow:hidden 切掉
    // 一行）；prompt 里还留着一份色值表 = 模型把 `#C8A24B` 写进 inline style，换配色那天
    // 那一处不跟着变。两种都是一页完整正常的幻灯片。
    reply('<section class="slide"><div class="slide-inner"><h2>三阶段路径</h2></div></section>');
    await generatePage({ ...base, layoutId: 'L1', design: { palette: 'P-C', font: 'F-B', density: 'D-C', header: 'H-A' } }, 'u1');
    const prompt = (aiGateway as any).mock.calls[0][0].messages[0].content as string;
    expect(prompt).toContain('墨绿');
    expect(prompt).toContain('全黑体');
    expect(prompt).toMatch(/紧凑[\s\S]*108px/);
    // 通用令牌那份文档里不能再有第二份调色板（那一段是原样发出去的：模型会照表把色值
    // 写死在 inline style 里，而 id 还和 designSpec 里那套撞名）
    expect(prompt).not.toMatch(/--c-(?:brand|accent|bg)\s*:\s*#/);
    expect(prompt).not.toContain('P-E'); // 库里压根没有这个 id 的配色
  });

  it('提纲原文逐字进 prompt，并且写明它才是内容（要点只是骨架）', async () => {
    // 不带原文的话这一步的输入只剩规划那次写的摘要（一页摊到几十个 token），提纲上那六行
    // 数字一个字都进不了 prompt —— 出来是一页排得很好、内容只剩三成的幻灯片，一处不报错。
    reply('<section class="slide"><div class="slide-inner"><h2>三阶段路径</h2></div></section>');
    const outlineText = '1.1 市场规模\n- 全国 3.2 万亿，华东占 38%\n- 同比 +12%';
    await generatePage({ ...base, layoutId: 'L1', outlineText }, 'u1');
    const prompt = (aiGateway as any).mock.calls[0][0].messages[0].content as string;
    expect(prompt).toContain('全国 3.2 万亿，华东占 38%');
    expect(prompt).toMatch(/一条都不许合并|不许省略/);
  });

  it('原文装不进这个版式时要点名字数（只喊不改）', async () => {
    // 装不下时模型会自己压缩，六行数据合成一句话 —— 页面完整通顺，压掉了哪几句它不会说。
    // 不点名字数的话他不知道该拆页还是换版式，于是重新生成同一页、再花一次钱。
    reply('<section class="slide"><div class="slide-inner"><h2>三阶段路径</h2></div></section>');
    const r = await generatePage({ ...base, layoutId: 'L1', outlineText: '数'.repeat(900) }, 'u1');
    const said = r.problems.join('\n');
    expect(said).toContain('900 字');
    expect(said).toMatch(/L1（形状：分屏）一页大约装 \d+ 字/);
    expect(said).toContain('L37'); // 装得下的那几条要点名，不然他只能自己翻 51 个版式
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

  it('蒙版按页码贴，每一页都有一层（传进来的顺序是乱的）', () => {
    // 这里错了不会报错：照数组下标取的话压暗的是**别的那一页**，漏一页的话那一页只是
    // 「翻过去亮了一下」—— 两种都是一份读起来正常的稿子，而滑块上的数字是他调过的那个。
    const html = buildDeck(
      [{ page: 2, html: sec(2), veil: 0.6 }, { page: 1, html: sec(1) }],
      2,
      meta
    );
    const veils = [...html.matchAll(/<section[^>]*data-p="(\d)"[^>]*--veil:([\d.]+)/g)];
    expect(veils.map((m) => [m[1], m[2]])).toEqual([['1', '0'], ['2', '0.6']]);
  });

  it('拼装不往 <section> 里塞任何孩子（塞了的话「删这一块」会删到隔壁那一块）', () => {
    // 就地编辑那一套（删这一块 / 整块对齐 / AI 改这一块）是按「从 section 数下来的第几个
    // 孩子」定位的：浏览器数的是拼装出来这一份，代码切的是库里那一份。这里多插一个元素
    // （097 的蒙版原来就是 section 的第一个孩子）之后两边整体错一位 —— 选中的那一块里
    // 有文字时报的是一句「这一页在别处改过」（指错方向），没有文字时 eid 交叉核对空对空，
    // 于是删掉/改掉的是隔壁那一块而接口 200。
    const stored = '<section class="slide"><div class="a"></div><div class="slide-inner">x</div></section>';
    const assembled = buildDeck([{ page: 1, html: stored, veil: 0.4 }], 1, meta);
    const kids = (h: string) =>
      domTree(h.slice(h.indexOf('<section class="slide"'), h.indexOf('</section>') + 10))[0]
        .children.map((c) => c.name);
    expect(kids(assembled)).toEqual(kids(stored));
  });

  it('按页码排，不按传进来的顺序', () => {
    // 批量生成是逐页回来的，传进来的顺序可能是完成顺序 —— 照它拼的话每一页都对、章节全乱。
    const html = buildDeck([{ page: 2, html: sec(2) }, { page: 1, html: sec(1) }], 2, meta);
    expect(html.indexOf('data-p="1"')).toBeLessThan(html.indexOf('data-p="2"'));
    expect(html).not.toContain('{{');
  });
});
