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
