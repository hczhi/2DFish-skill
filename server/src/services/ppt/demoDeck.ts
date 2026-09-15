// 22 个版式的效果 demo。**一份 deck，不是 22 个独立 html 文件**：CSS 全部来自
// `library/template.html`（`demo-slides.html` 里只有 `<section>` 片段），请求时把两边拼起来。
//
// 为什么不各存一份完整 html：那 22 份每份都要复制一遍 deck 外壳和版式 CSS，而改了
// template 里某个版式的 CSS 之后，demo 照旧好看、生成出来的页面已经变了 —— 案例库的
// 全部作用就是「照我们的骨架跑出来长这样」，demo 和产出漂开的那一刻这个页面就在骗人，
// 而两边都不报错。同一个 template 拼出来的 demo 漂不了。
//
// 片段和条目的对应关系只靠 `<!-- @demo L<编号> -->` 那行分隔符，顺序 = 页码顺序。

import fs from 'fs';
import path from 'path';
import { libraryRoot, libraryVersion } from './layoutLibrary.js';
import { assembleDeck } from './deckShell.js';

/** 页脚那三个占位符的 demo 取值（真 deck 由生成流程填客户品牌）。 */
const BRAND_CN = '云启数科';
const BRAND_EN = 'YUNQI DATA';
const TOPIC = '版式 demo · 61 个 L 版式的骨架效果';

export class DemoNotFoundError extends Error {}

let cached: Map<string, string> | null = null;
// 跟着 library 的版本号一起作废（`demo-slides.html` 也在那个目录里）：不跟的话改完片段
// 之后案例库卡片上还是旧那一版，而生成出来的页面已经换了 —— 而这些卡片存在的全部理由
// 就是「照我们的骨架跑出来长这样」，漂开的那一刻它就在骗人，两边都不报错。
let cachedAt = -1;

/** 测试里改了文件之后用。 */
export function resetDemoDeckCache(): void {
  cached = null;
  cachedAt = -1;
}

export function demoFragments(): Map<string, string> {
  const v = libraryVersion();
  if (v !== cachedAt) {
    cached = null;
    cachedAt = v;
  }
  if (!cached) cached = loadFragments();
  return cached;
}

export function demoIds(): string[] {
  return [...demoFragments().keys()];
}

/**
 * 拼出可以直接丢进 iframe 的整份 deck。`only` 给一个版式 id 时只放那一页
 * （版式库每张卡片的缩略图就是这个）。
 *
 * 找不到那个 id 时**抛错**而不是回一份空 deck：空 deck 在 iframe 里是一块白底加一个
 * 「1 / 1」的页脚，读起来像这个版式渲染塌了，而真实成因是 demo-slides.html 里少一段。
 */
export function demoDeck(only?: string): string {
  const frags = demoFragments();
  let ids = [...frags.keys()];
  if (only) {
    const key = only.trim().toUpperCase();
    if (!frags.has(key)) {
      throw new DemoNotFoundError(
        `没有 ${key} 的 demo 片段（demo-slides.html 里缺 <!-- @demo ${key} --> 那一段）。`
      );
    }
    ids = [key];
  }

  // 外壳走 deckShell 那一份（生成产出的预览也走它）—— 各拼一遍的话 demo 和产出会漂。
  // `?only=Lk` 是案例库那张卡里的缩略图（一页）：不要页脚 —— 它压在画面底部
  // 那 54px 上，缩到卡片大小之后只剩一条挡住内容的白带。整份 demo 要带（靠它翻页）。
  return assembleDeck(
    ids.map((id) => frags.get(id)!),
    { brandCn: BRAND_CN, brandEn: BRAND_EN, topic: TOPIC },
    { footer: !only }
  );
}

function loadFragments(): Map<string, string> {
  const file = path.join(libraryRoot(), 'demo-slides.html');
  if (!fs.existsSync(file)) {
    throw new Error(`版式 demo 读不到：${file} 不存在（案例库页面上每张卡的效果图都来自它）。`);
  }
  const raw = fs.readFileSync(file, 'utf-8');
  // split 带捕获组 → [前言, 'L1', 片段, 'L2', 片段, …]
  const parts = raw.split(/<!--\s*@demo\s+(L\d+)\s*-->/);
  const out = new Map<string, string>();
  for (let i = 1; i < parts.length; i += 2) {
    const id = parts[i];
    const body = (parts[i + 1] || '').trim();
    // 空片段和「这个版式没做 demo」在页面上长得一样（一块白），而卡片上照样挂着
    // 「有效果 demo」的绿标 —— 所以宁可整个接口炸。
    if (!body.includes('<section')) {
      throw new Error(`${id} 的 demo 片段里没有 <section>（demo-slides.html）—— 那一页会是一块白。`);
    }
    if (out.has(id)) {
      // 重复的那一段会让同一个版式出现两页，页码从此和条目编号对不上。
      throw new Error(`demo-slides.html 里有两段 ${id}。`);
    }
    out.set(id, body);
  }
  if (!out.size) {
    throw new Error(
      'demo-slides.html 解析出 0 个片段 —— 检查分隔符是不是还写成 `<!-- @demo L<编号> -->`。'
    );
  }
  return out;
}
