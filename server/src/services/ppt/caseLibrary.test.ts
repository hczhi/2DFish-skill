import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { libraryRoot, layoutById } from './layoutLibrary.js';
import { MIN_FONT_PX } from './designSpec.js';
import { imageGroupProblems } from './imageGroups.js';
import { leadEchoProblem } from './pageService.js';
import { templateClasses } from './deckShell.js';

// `cases/*.md` 是**喂给模型的说明**（那一条的 buildText），`library/template.html` 才是真的渲染
// 用的骨架。两边漂开的时候没有一处报错：模型照 md 老老实实写出一个 `<div class="tri-head">`，
// template 里没有这个类，那一块掉回默认流式布局 —— 页面照样渲染、接口 200，屏幕上是三栏图
// 上方凭空多出一条白底、标题竖着堆在里面还溢出到图上，看起来是「这个版式塌了」。
// 而 `checkPage` 给的建议是「重新生成一次通常就好了」，这时那句话是假的：重新生成拿到的是
// 同样的一版，他会一遍遍花钱重试。`demoDeck.test.ts` 只核 demo 片段，核不到这些 md。

/** 每个 case md 里的 ```html 代码块（build-part 结构模板，模型照它写）。 */
function htmlBlocks(md: string): string[] {
  return [...md.matchAll(/```html\n([\s\S]*?)```/g)].map((m) => m[1]);
}

/** 结构模板里的 HTML 注释不算代码：那几句正是用来**点名**禁用的东西（「页眉由代码贴，这里不要写」）。 */
function stripComments(html: string): string {
  return html.replace(/<!--[\s\S]*?-->/g, ' ');
}

/** md 里的代码块（```css 骨架 + ```html 结构模板）—— 正文散文不算，那里会**点名**禁用的变量。 */
function codeBlocks(md: string): string[] {
  return [...md.matchAll(/```(?:css|html)\n([\s\S]*?)```/g)].map((m) => m[1]);
}

describe('版式详情 md 与 template.html 对不对得上', () => {
  const dir = join(libraryRoot(), 'cases');
  const files = readdirSync(dir).filter((f) => f.endsWith('.md'));

  it('结构模板里用到的每个类名都在 template.html 里有定义', () => {
    // 和 `checkPage` / `demoDeck.test.ts` 用同一把尺子（只扫 <style> 里的选择器）。
    // 根 `<section>` 自己那一行不算：那一层的尺寸定位全由 `.slide` 给，`l13-cover` /
    // `fullbleed` 这类语义标签一个字都不影响画面（`checkPage` ① 同样跳过它）。
    const known = templateClasses();
    const missing: string[] = [];
    for (const f of files) {
      for (const block of htmlBlocks(readFileSync(join(dir, f), 'utf-8'))) {
        const inner = block.replace(/^[\s\S]*?<section[^>]*>/, '');
        for (const m of inner.matchAll(/class="([^"]+)"/g)) {
          for (const tok of m[1].trim().split(/\s+/)) {
            if (!known.has(tok)) missing.push(`${f}:${tok}`);
          }
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('骨架里用到的每个 CSS 变量都在 template.html 的 :root 里有定义', () => {
    // 编出来的变量名（`--c-text` / `--c-text-2` / `--c-line` 各在 5 份 md 里活了很久）不会报错：
    // 浏览器把那**一整条声明**丢掉，字色掉回继承色、pill 的 `background` 直接透明、
    // `border-top` 整条消失 —— 页面照样渲染、接口 200，看起来只是「这一版配色淡了点」。
    // 模型是照这几份 md 写 inline style 的（prompt 明写「颜色只用 var(--…)」），所以 md 里
    // 编一个，生成的每一页就都带着它。
    const root = readFileSync(join(libraryRoot(), 'template.html'), 'utf-8');
    const defined = new Set([...root.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
    const missing: string[] = [];
    for (const f of [...files, '../layout-library.md']) {
      for (const block of codeBlocks(readFileSync(join(dir, f), 'utf-8'))) {
        for (const m of block.matchAll(/var\(\s*(--[a-z0-9-]+)/g)) {
          if (!defined.has(m[1])) missing.push(`${f}:${m[1]}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('md 的 CSS 骨架和 template.html 逐条声明一致', () => {
    // 上面两条只核**名字**（类名在不在、变量名在不在），数值一个都不核 —— 于是同一条规则的
    // 两份拷贝会慢慢漂开，而两边都「存在」，没有一处会说：`.l21-left` md 写 `top:88px`、
    // template 是垂直居中；`.l14-hero::after` 的渐变方向在 md 里是反的；`.l18-headline` md
    // 是 `top:14%` 而 template 已经为了避让页眉改成 18%。模型照 md 想象版面、浏览器照
    // template 渲染，出来的每一页都完整正常，只是「和案例长得不太一样」。
    // 最贵的一次就是 `.l16-wrap`：md 那份写着 `padding:160px`（自带页眉安全区），模型据此
    // 认为这一层的 padding 是可调的，一句 inline style 就把标题推进页眉带里。
    // 只在 md 里存在的规则同样算错：那是在教模型写一个**永远不会渲染的装饰**（L18 那条
    // `.l18-cn::before` 波浪线就这样，template 里只有 `.l18-cn svg`）。
    const tplCss = [...readFileSync(join(libraryRoot(), 'template.html'), 'utf-8')
      .matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join('\n');
    const norm = (s: string) =>
      s.replace(/\s*([;:,])\s*/g, '$1').replace(/'/g, '"').replace(/\s+/g, ' ').replace(/;$/, '').trim();
    /** 一段 CSS 里的 `选择器 → 声明`（注释不算；同名只取第一条，和浏览器读到的第一份一致）。 */
    const rules = (css: string) => {
      const out = new Map<string, string>();
      for (const m of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}@]+)\{([^{}]*)\}/g)) {
        const sel = m[1].trim().replace(/\s+/g, ' ');
        if (!sel || sel.startsWith('@') || out.has(sel)) continue;
        out.set(sel, norm(m[2]));
      }
      return out;
    };
    const tpl = rules(tplCss);
    const bad: string[] = [];
    for (const f of files) {
      const cssBlocks = [...readFileSync(join(dir, f), 'utf-8').matchAll(/```css\n([\s\S]*?)```/g)];
      for (const [sel, body] of rules(cssBlocks.map((m) => m[1]).join('\n'))) {
        if (!tpl.has(sel)) bad.push(`${f}:${sel} 只在 md 里有，template.html 里没有这条规则`);
        else if (tpl.get(sel) !== body) bad.push(`${f}:${sel}\n    md  : ${body}\n    tpl : ${tpl.get(sel)}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('结构模板里不写统一页眉（那一行由代码贴）', () => {
    // md 里留着 `.slide-header` 的话，模型会照着写 —— 而 `applyHeader` 会把它整块摘掉再按
    // 提纲贴一份。非封面页看起来没事（摘了又贴），但两处一冲突（prompt 第 4 条明写「不要写」）
    // 就没人知道哪边是准的；真出事的是 L2/L13 这两条封面：写了被摘、代码又不贴，那一页的
    // 模块名凭空消失，而画面完全正常、problems 里一个字都没有。
    const bad: string[] = [];
    for (const f of files) {
      for (const block of htmlBlocks(readFileSync(join(dir, f), 'utf-8'))) {
        if (/(?<![\w-])slide-header(?![\w-])/.test(stripComments(block))) bad.push(f);
      }
    }
    expect(bad).toEqual([]);
  });

  it('非全幅版式的结构模板必须包 .slide-inner，全幅和出血版式必须不包', () => {
    // 少了它有两处静默：`checkPage` 每次生成都报一句「内容会贴到画面边缘」（他照 md 改不掉，
    // 因为 md 就是这么写的），而**疏密档直接失效** —— D-A/D-C 改的就是 `.slide-inner` 的
    // padding，没有这一层的页面在「舒展 / 紧凑」之间一个像素都不变。反过来全幅页包了它，
    // 出来是一张四边留白的「全幅」图。
    const bad: string[] = [];
    for (const f of files) {
      const id = /^(L\d+)-/.exec(f)?.[1];
      const layout = id ? layoutById(id) : undefined;
      if (!layout) {
        bad.push(`${f}:案例库里没有这条版式`);
        continue;
      }
      // 出血版式（L12）是第三种：不是全幅，但浮卡 + 色带要脱离标准 padding，所以也不包。
      // `checkPage` 里那两条判断用的是同一个条件。
      const want = !layout.fullbleed && !layout.hasCard;
      for (const block of htmlBlocks(readFileSync(join(dir, f), 'utf-8'))) {
        const has = /(?<![\w-])slide-inner(?![\w-])/.test(stripComments(block));
        if (has !== want) bad.push(`${f}:${want ? '该包 .slide-inner 却没包' : '不该包 .slide-inner 却包了'}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('根 <section> 上只出现 template.html 里真有定义的类（包装层是里面的第一个 div）', () => {
    // 上面那条类名检查**故意跳过根 `<section>` 那一行**（`checkPage` ① 也跳过），所以写在
    // 那里的任何东西都不会被报出来 —— L13 的 `l13-cover fullbleed` 这种「语义标签」在那里
    // 活了很久，一个字不影响画面，但它教模型「包装类可以写在 section 上」：轮到 `l17-wrap`
    // 那种带 `display:grid` 的，整页会被挤进左半列，而 HTML 照样渲染、problems 里一个字都没有。
    const known = templateClasses();
    const bad: string[] = [];
    for (const f of files) {
      for (const block of htmlBlocks(readFileSync(join(dir, f), 'utf-8'))) {
        const root = /<section[^>]*class="([^"]+)"/.exec(block);
        for (const tok of (root?.[1] || '').trim().split(/\s+/)) {
          if (tok && !known.has(tok)) bad.push(`${f}:${tok}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('配色归一表里不留十六进制色值（换 palette 时那几处不会跟着变）', () => {
    // 每份 md 的「原色 → 变量」表是给模型看的映射，写死 `#3DB4D9` 的那几行它会照抄进
    // inline style —— 于是整份 deck 换成墨绿之后，那一页的数字/色带还是原截图的青色。
    // 页面渲染正常、接口 200、problems 里一个字都没有，看起来就是「这个版式本来就有个青色块」。
    // 纯白是例外（暗底上的字直接写 `#fff`，L19 的 md 明写「不走变量」），所以只放过白色。
    const bad: string[] = [];
    for (const f of [...files, '../layout-library.md']) {
      const md = readFileSync(join(dir, f), 'utf-8');
      md.split('\n').forEach((line, i) => {
        for (const m of line.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
          const hex = m[0].toUpperCase();
          if (/^#(FFF|FFFFFF)$/.test(hex)) continue;
          bad.push(`${f}:${i + 1}:${m[0]}`);
        }
      });
    }
    expect(bad).toEqual([]);
  });

  it('骨架和结构模板里没有低于下界的字号', () => {
    // 小字是这套库长出来的方式：一条版式为了塞下双语/单位/口径，就把那一行压到 11–13px，
    // 每一页单看都排得下、都好看 —— 而 1920 舞台投到 1080p 就是 1:1，13px 在会议室后排
    // 读不出来，浏览器、`checkPage`、导出一处都不报错（原来有 23 处这样的声明）。
    // 骨架和 md 里的结构模板要一起扫：md 那份是**发给模型的范本**，它会照着写 inline style。
    // 运行时那一半在 `checkPage` ⑥（模型自己压字号）。
    // 播放器自己的 UI（页脚目录面板、提示条）不算舞台内容，它们跟着浏览器窗口显示，不投屏。
    const bad: string[] = [];
    const scan = (label: string, css: string, ignore?: RegExp) => {
      for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const sel = m[1].trim().replace(/\s+/g, ' ');
        if (ignore?.test(sel)) continue;
        for (const f of m[2].matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)) {
          if (Number(f[1]) < MIN_FONT_PX) bad.push(`${label}:${sel} → ${f[1]}px`);
        }
      }
    };
    scan('template.html', readFileSync(join(dir, '../template.html'), 'utf-8').replace(/\/\*[\s\S]*?\*\//g, ''), /^[#]|\.toc-/);
    for (const f of files) {
      for (const block of htmlBlocks(readFileSync(join(dir, f), 'utf-8'))) {
        for (const m of stripComments(block).matchAll(/style="([^"]*)"/g)) {
          for (const s of m[1].matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)) {
            if (Number(s[1]) < MIN_FONT_PX) bad.push(`${f}:inline → ${s[1]}px`);
          }
        }
      }
      // md 里那份 CSS 骨架和 template 是逐条对账的（上面那条测试），所以只扫 inline style 就够。
    }
    expect(bad).toEqual([]);
  });

  it('结构模板里并排的那几张图是同一个高度', () => {
    // 案例 md 是**发给模型的范本**：范本里一行三张图有两张写了 height、第三张没写，模型每一页
    // 都照着排，出来是一行参差不齐的图 + 下面几行错开的小字，而 `checkPage` ⑦ 会把这句话
    // 报在每一页上（他改不掉，因为范本就是这么写的）。运行时那一半在 `checkPage` ⑦。
    const bad: string[] = [];
    for (const f of files) {
      for (const block of htmlBlocks(readFileSync(join(dir, f), 'utf-8'))) {
        for (const p of imageGroupProblems(block)) bad.push(`${f}:${p}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('结构模板里的领句不是标题的复制', () => {
    // 范本里那行小字写着和大标题一样的话，模型每一页都照着抄（那一格它本来就不知道填什么）——
    // 出来是一行 20px 加宽字距的小字 + 同一句话的大标题，看起来像版式自带的装饰，
    // 而 `checkPage` ⑧ 会把这句话报在每一页上，他照 md 改不掉。运行时那一半在 `checkPage` ⑧。
    const bad: string[] = [];
    for (const f of files) {
      for (const block of htmlBlocks(readFileSync(join(dir, f), 'utf-8'))) {
        for (const p of leadEchoProblem(stripComments(block), {})) bad.push(`${f}:${p}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('结构模板里的图片地址只用占位图，不编外链', () => {
    // 编出来的 `cases/pXX_col1.jpg` 那种地址在屏幕上是一个破图，而破图和「这一格本来是
    // 空的」长得一样；配图是后面独立一步由代码换的（硬规则 3：地址不经过模型）。
    const bad: string[] = [];
    for (const f of files) {
      for (const block of htmlBlocks(readFileSync(join(dir, f), 'utf-8'))) {
        for (const m of block.matchAll(/url\(\s*['"]?([^'")]+)/g)) {
          if (!m[1].startsWith('/ppt-cases/')) bad.push(`${f}:${m[1]}`);
        }
        for (const m of block.matchAll(/<img[^>]+src="([^"]+)"/g)) {
          if (!m[1].startsWith('/ppt-cases/')) bad.push(`${f}:${m[1]}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });
});
