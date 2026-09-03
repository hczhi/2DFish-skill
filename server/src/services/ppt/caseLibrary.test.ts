import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { libraryRoot } from './layoutLibrary.js';
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
