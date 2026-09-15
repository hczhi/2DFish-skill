import { describe, it, expect } from 'vitest';
import {
  PALETTE_VARS, PALETTES, FONTS, DENSITIES, HEADERS, DEFAULT_DESIGN,
  readDesignSpec, parseDesignSpec, designStyleBlock, DesignSpecError,
} from './designSpec.js';
import { templateVars } from './deckShell.js';
import { library } from './layoutLibrary.js';

// 设计规范这条路上的失败全长得像「这一版配色有点脏」：少给一个变量 = 蓝色稿子上留着
// 橙色高亮块；变量名拼错 = 浏览器把整条声明丢掉（那一处掉回继承色）；认不出的 id 悄悄
// 回落 = 下拉里写着「墨绿」而整份是橙的。三样都不报错，每一页单看都完整正常。

describe('deck 设计规范', () => {
  it('每套配色都把这一批变量给齐，而且名字都是 template 里真有的', () => {
    const known = templateVars();
    for (const v of PALETTE_VARS) {
      expect(known.has(v), `template.html 的 :root 里没有 ${v} —— 覆盖它等于凭空造一个没人读的变量`).toBe(true);
    }
    for (const p of PALETTES) {
      if (!p.vars) continue; // 默认那套故意不写覆盖（见 PALETTES 上的注释）
      expect(Object.keys(p.vars).sort(), p.id).toEqual([...PALETTE_VARS].sort());
    }
    // 字体那两个字族同理：拼错的话标题字体不变，而选中的是「全黑体」。
    for (const f of FONTS) {
      for (const k of Object.keys(f.vars || {})) expect(known.has(k), `${f.id} 的 ${k}`).toBe(true);
    }
  });

  it('照片页那层幕帘的底色和它压着的那一页底色是同一个（不然中间横着一道接缝）', () => {
    // `--mask-rgb` 只在 `.case-bg::after` 那类幕帘上用，`--mask-rgb-alt` 用在 `.slide.cool` 上
    // （那一档的底色是 `--bg-cool`）。填成别的浅色时照片渐隐进去的是另一个色相，画面中间
    // 横着一道看得出来的接缝 —— 而浏览器、checkPage、导出全都正常，problems 里一个字都没有。
    const rgb = (hex: string) =>
      [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(',');
    for (const p of PALETTES) {
      if (!p.vars) continue; // 默认那套跟着 template 的 :root 走（那一份已经是配对的）
      expect(p.vars['--mask-rgb'], `${p.id} 的 --mask-rgb 要等于 --c-bg`).toBe(rgb(p.vars['--c-bg']));
      expect(p.vars['--mask-rgb-alt'], `${p.id} 的 --mask-rgb-alt 要等于 --bg-cool`).toBe(rgb(p.vars['--bg-cool']));
    }
  });

  it('色块上那个字色（--c-*-on）在每套配色里都读得出来', () => {
    // 白字只在深底上成立，而品牌色/点缀色的深浅是每套配色自己定的：默认那套的橙对白字 2.6:1、
    // 天青 2.3:1（AA 要 4.5）。写死 `#fff` 或者照着「反色就是白色」填的话，浅色品牌色那套上
    // 徽章/圆按钮/H-C 页眉色块里的字直接读不出来 —— 而浏览器、checkPage、导出全都正常，
    // 现象只是「这一页字有点看不清」。**量哪几个底色是从 template 里扫出来的**（谁真的被
    // 当过 background），不写死一份名单：`--c-brand-deep` 是渐变色块（`.bio-bleed`）的两头、
    // 只量 `--c-brand` 的话那两头会悄悄掉到线下；而 `--c-accent-deep` 现在只当文字色用
    // （kicker），写进名单反倒会逼着 `--c-accent-on` 去同时满足两个明度差很远的底
    // （墨绿那套的陶土色深浅版一个要白字一个要黑字，无解）—— 哪天有版式拿它铺底，
    // 这条测试自己就开始管它了。
    const lum = (hex: string) =>
      [1, 3, 5]
        .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
        .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
        .reduce((s, v, i) => s + [0.2126, 0.7152, 0.0722][i] * v, 0);
    const ratio = (a: string, b: string) => {
      const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
      return (hi + 0.05) / (lo + 0.05);
    };
    const tpl = library().template.replace(/\/\*[\s\S]*?\*\//g, '');
    const root = /:root\{([\s\S]*?)\n\}/.exec(tpl)![1];
    const base: Record<string, string> = {};
    for (const m of root.matchAll(/(--[\w-]+):\s*([^;]+);/g)) base[m[1]] = m[2].trim();
    const backgrounds = new Set<string>();
    for (const m of tpl.matchAll(/background(?:-color)?:[^;}]*/g)) {
      for (const v of m[0].matchAll(/var\((--c-(?:brand|accent)(?:-deep)?)\)/g)) backgrounds.add(v[1]);
    }
    expect(backgrounds.has('--c-brand'), 'template 里连一处品牌色底都扫不出来 = 这条正则失效了').toBe(true);
    for (const p of PALETTES) {
      const v = { ...base, ...(p.vars || {}) }; // 默认那套（P-A）就是 template 的 :root
      for (const bg of backgrounds) {
        const on = bg.startsWith('--c-brand') ? '--c-brand-on' : '--c-accent-on';
        expect(
          ratio(v[bg], v[on]),
          `${p.id}：${on}(${v[on]}) 压在 ${bg}(${v[bg]}) 上只有 ${ratio(v[bg], v[on]).toFixed(2)}:1`
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('template 里不许再出现「品牌色/点缀色实底 + 写死白字」', () => {
    // 上一条量的是变量本身，管不到「有人又写了一次 color:#fff」—— 那一处不跟着配色走，
    // 于是浅色品牌色那套上它是白压浅橙。跨规则的那种（父元素铺色块、子元素写白字）静态扫不出来，
    // 只能靠这一条挡住同一条声明里的写法，剩下的靠 PALETTE_VARS 那段注释。
    const css = library().template.replace(/\/\*[\s\S]*?\*\//g, '');
    const bad: string[] = [];
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const body = m[2];
      if (!/background(-color)?:[^;]*var\(--c-(brand|accent)\b/.test(body)) continue;
      if (/color:\s*(#fff|#ffffff|white|rgba?\(255,\s*255,\s*255)/i.test(body)) {
        bad.push(m[1].trim().replace(/\s+/g, ' '));
      }
    }
    expect(bad, '这几条要改成 var(--c-brand-on) / var(--c-accent-on)').toEqual([]);
  });

  it('认不出的 id 一律抛，不回落成默认那套', () => {
    expect(() => readDesignSpec({ palette: 'P-Z', font: 'F-A', density: 'D-B' })).toThrow(DesignSpecError);
    // 缺一项也抛：缺的那项悄悄回默认的话，界面上三个下拉都对，而整份混了两套规范。
    expect(() => readDesignSpec({ palette: 'P-B', density: 'D-B' })).toThrow(DesignSpecError);
    expect(readDesignSpec({ palette: 'p-b', font: 'F-C', density: 'D-A', header: 'h-b' })).toEqual({
      palette: 'P-B', font: 'F-C', density: 'D-A', header: 'H-B',
    });
  });

  it('库里存着一个已经删掉的 id 时回落到默认那档并说出来', () => {
    const r = parseDesignSpec(JSON.stringify({ palette: 'P-GONE', font: 'F-B', density: 'D-B' }));
    expect(r.spec.palette).toBe(DEFAULT_DESIGN.palette);
    expect(r.spec.font).toBe('F-B'); // 认得的那两项不受影响
    expect(r.problems.join('|')).toMatch(/配色 P-GONE 不在库里/);
    // 老 deck（空串）是默认那套，而且不该报任何问题 —— 报了的话每份老稿子打开都是一句红字。
    expect(parseDesignSpec('')).toEqual({ spec: DEFAULT_DESIGN, problems: [] });
  });

  it('疏密改的是 :root 那组 --pad-*，而且每一档都给页眉留出了那条带', () => {
    // 两种静默：疏密只压 `.slide-inner{padding}` 的话页眉留在默认那一档上（舒展档的页眉比
    // 正文左边 36px、紧凑档的正文起点比页眉还高，两行字直接叠在一起）；--pad-top 收进页眉
    // 那条带里的话，那一页的标题和左上角的模块名重叠 —— 两种都是一页完整正常的幻灯片。
    const tpl = library().template;
    expect(tpl).toMatch(/\.slide-header\{[^}]*left:var\(--pad-x\)/);
    expect(tpl).toMatch(/\.slide-inner\{[^}]*padding:var\(--pad-top\) var\(--pad-x\) var\(--pad-bottom\)/);
    const headY = Number(/--head-y:(\d+)px/.exec(tpl)![1]);
    const tops = [Number(/--pad-top:(\d+)px/.exec(tpl)![1])];
    for (const d of DENSITIES) {
      if (!d.rules) continue;
      expect(d.rules, `${d.id} 要改 :root 的变量，不能压 .slide-inner`).toMatch(/^:root\{/);
      expect(d.rules, d.id).not.toContain('.slide-inner');
      tops.push(Number(/--pad-top:(\d+)px/.exec(d.rules)![1]));
    }
    // 页眉那行是 17px 的加宽字距小字，留 30px 才不压到正文第一行。
    for (const top of tops) expect(top).toBeGreaterThan(headY + 30);
  });

  it('绕开 .slide-inner 的版式容器不许自己写一份页眉安全区', () => {
    // L16 的 `.l16-wrap` 原来是 `inset:0` + `padding:160px 64px 40px`：它绕开了 `.slide-inner`，
    // 于是自己抄了一份页眉安全区。而那一份是**模型能改的** —— prompt 明说「单元数量变了就用
    // inline style 顺手调间距」，它写一句 `style="padding:36px 56px"` 就把整条 padding（含 top）
    // 顶掉（inline 简写胜过 template 里的普通声明），标题落进 44–100px 那条页眉带，而
    // `.slide-header` 是 z-index:30 —— 屏幕上是页眉压住标题，而页面渲染、类名校验、图位统计
    // 全部正常，problems 里一个字都没有。安全区只能有一份，在 `.slide-inner` 上。
    const css = [...library().template.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)]
      .map((m) => m[1])
      .join('\n')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    const bad: string[] = [];
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const sel = m[1].trim().replace(/\s+/g, ' ');
      if (sel.startsWith('@') || sel.includes('.slide-inner')) continue;
      if (!/inset:\s*0/.test(m[2])) continue;
      const top = (/padding-top:\s*([^;]+)/.exec(m[2]) || /padding:\s*([^\s;]+)/.exec(m[2]))?.[1]?.trim();
      if (top && !/^0(px|%)?$/.test(top)) bad.push(`${sel} → padding-top:${top}`);
    }
    expect(bad).toEqual([]);
  });

  it('默认那一套注出来是空字符串（外壳里一句覆盖都没有）', () => {
    // 不空的话默认稿子上多一段和 template 抄重的色值，template 改了色它就钉在旧值上。
    expect(designStyleBlock(DEFAULT_DESIGN)).toBe('');
    const block = designStyleBlock({ palette: 'P-B', font: 'F-B', density: 'D-C', header: 'H-C' });
    expect(block).toContain('--c-brand:#2A5DB0');
    expect(block).toContain(DENSITIES.find(d => d.id === 'D-C')!.rules!);
    // 页眉那档的规则也要注：漏了的话下拉里选着「品牌色块」而每页左上角还是默认那行小字，
    // 界面上和存进去的对不上，而每一页都是一页正常的幻灯片。
    expect(block).toContain(HEADERS.find(h => h.id === 'H-C')!.rules!);
    expect(block).toContain('data-design="P-B/F-B/D-C/H-C"');
  });

  it('页眉那几档只碰 .slide-header，而且每档都把 kicker 的样式写全', () => {
    // 只改字号的话别的属性留在 template 的默认值上 —— 出来是一档「有点像默认那档但又不一样」
    // 的页眉，而每一页都正常、没有一处会说。碰到 `.slide-inner` / `:root` 的话这一档会顺手
    // 改掉正文的排版，而他改的只是页眉那个下拉。
    for (const h of HEADERS) {
      if (!h.rules) continue; // 默认那档不写覆盖（就是 template 里那一份）
      expect(h.rules, h.id).not.toMatch(/\.slide-inner|:root|\.page-title/);
      expect(h.rules.startsWith('.slide-header'), h.id).toBe(true);
      // 「不显示」那档是整块隐藏，不用写字样
      if (h.rules.includes('display:none')) continue;
      for (const prop of ['font-size', 'font-weight', 'letter-spacing', 'color']) {
        expect(h.rules, `${h.id} 少写了 ${prop}`).toContain(prop);
      }
    }
  });
});
