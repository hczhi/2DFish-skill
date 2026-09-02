// deck 外壳：把若干个 `<section>` 塞进 `library/template.html`。
//
// **只有这一份实现**（版式 demo 和生成产出的预览都走它）。各写一份的后果不是报错：
// 预览里那一页好看，真 deck 里同一段 HTML 已经换了一副骨架 —— 而「照我们的骨架跑出来
// 长这样」就是案例库和预览存在的全部理由，漂开的那一刻两边都在骗人。

import { library } from './layoutLibrary.js';

/** template.html 里 `<section>` 的插入点。 */
export const SLOT = '<!-- partN_fragment.html 的 <section> 在此按顺序插入 -->';

export interface DeckMeta {
  brandCn: string;
  brandEn: string;
  topic: string;
}

/** 拼出可以直接丢进 iframe / 存成文件的整份 deck。 */
export function assembleDeck(sections: string[], meta: DeckMeta): string {
  const template = library().template;
  if (!template.includes(SLOT)) {
    // 插入点被改掉的话下面那次 replace 什么都不会发生，出来的是一份**没有任何幻灯片**
    // 的 deck —— 页脚、目录、缩放全都正常，只是全白。
    throw new Error(`template.html 里找不到幻灯片插入点（${SLOT}）—— 拼出来会是一份空白 deck。`);
  }
  const slides = sections.join('\n');
  // 一律用函数形式替换：片段正文里的 `$&` / `$1` 在字符串形式下会被当成引用展开，
  // 悄悄吃掉几个字符。
  return template
    .replace(SLOT, () => slides)
    .replace(/\{\{BRAND_CN\}\}/g, () => meta.brandCn)
    .replace(/\{\{BRAND_EN\}\}/g, () => meta.brandEn)
    .replace(/\{\{TOPIC\}\}/g, () => meta.topic);
}

let classCache: Set<string> | null = null;

/**
 * template.html 里**已经定义**的类名。生成出来的 HTML 用了不在这里的类名时那一块会
 * 回到默认流式布局 —— 不报错，页面也不空，只是读起来像「这个版式本身塌了」，
 * 所以调用方必须把差集喊出来（见 pageService.checkPage）。
 */
export function templateClasses(): Set<string> {
  if (classCache) return classCache;
  // 只扫 `<style>` 里的：整个文件一起扫的话末尾那段 JS 里的 `document.querySelectorAll`
  // 也会被当成类名（`.querySelectorAll`），于是校验变成筛子 —— 而筛子的表现就是
  // 「校验通过、页面塌了」。
  const out = new Set<string>();
  for (const block of library().template.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) {
    for (const m of block[1].matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) out.add(m[1]);
  }
  classCache = out;
  return out;
}

export function resetDeckShellCache(): void {
  classCache = null;
}
