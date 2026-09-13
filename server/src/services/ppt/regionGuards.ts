// 两条 AI 改块路径（`aiEditService` 微调 / `aiRemakeService` 自由改造）共用的那几条校验。
//
// **一份**：这几条原来在两个文件里各抄了一遍，而它们拦的是同一个模型的同一批毛病 ——
// 于是踩到一次只会修一边，另一条路照旧。实际发生过的就是 `position:fixed`：自由改造那边拦着，
// 微调那边没有（而微调的 prompt 第 3 条正让模型「要新样式就写 inline style」，写出 fixed 的概率
// 更高）。走微调那条路写进去之后，预览里那一块位置只是差一点，**导出成文件之后飞到画面外** ——
// 接口 200、摘要写着「拉开了间距」、库里也存了。
//
// 放在这里的判据是「两条路要拦的东西完全一样」。不一样的不要往里搬（记号丢失、中文、
// data-eid、图片地址那几条两边规则相反：微调不许丢原文、自由改造允许），搬进来的话得加一个
// 开关参数，而开关传错值就是静默走另一条规则 —— 现象是「AI 怎么把我的文案改了」。
import { hardcodedColors, PageEditError } from './pageEdit.js';

/** 一段 HTML 里出现过的类名（模型只许用这些 + template 里定义过的）。 */
export function classesIn(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/class="([^"]*)"/g)) out.push(...m[1].trim().split(/\s+/).filter(Boolean));
  return out;
}

export interface RegionGuardCtx {
  /** 改之前那一块（用来分辨「这个色值本来就在」） */
  original: string;
  allowedClasses: Set<string>;
  knownVars: Set<string>;
}

/**
 * 脚本 / 样式表 / 事件属性 / `position:fixed` / 编出来的类名 / 写死的颜色 / 不存在的变量名。
 * 任何一条不过就抛（`PageEditError` → 400），一个字都不写库。
 *
 * 这七条拦的都是「页面照样渲染、读起来完全正常」的失败：`<style>` 改的是整份 deck 的每一页、
 * `<script>` 在导出的文件里真的执行、`fixed` 脱出 1920×1080 那层缩放（导出之后飞到画面外）、
 * 编出来的类名让那一块回到默认流式布局（看起来像「版式塌了」）、写死的色值换肤那天不跟着变、
 * 编出来的变量名让浏览器把**整条声明**丢掉（字色掉回继承色，看起来只是「这一版配色淡了点」）。
 */
export function checkRegionGuards(html: string, ctx: RegionGuardCtx): void {
  if (/<(script|style)[\s>]/i.test(html)) {
    throw new PageEditError('模型写了 <script> 或 <style>（那玩意儿会影响整份 deck 的每一页，或者在导出的文件里真的执行），这一块没改。');
  }
  if (/\son[a-z]+\s*=/i.test(html)) {
    throw new PageEditError('模型写了 onclick 这类事件属性（会在预览和导出的文件里真的执行），这一块没改。');
  }
  if (/position\s*:\s*fixed/i.test(html)) {
    throw new PageEditError('模型用了 position:fixed —— 它脱出这一页 1920×1080 的缩放，预览里看着还行，导出之后那一块会飞到画面外。这一块没改，改用 absolute。');
  }

  const unknown = new Set<string>();
  for (const c of classesIn(html)) if (!ctx.allowedClasses.has(c)) unknown.add(c);
  if (unknown.size) {
    throw new PageEditError(
      `模型编了类名（${[...unknown].slice(0, 5).join(' / ')}）：模板里没有这几条样式，那几块会变成没排版的文字堆在一起。这一块没改 —— ` +
        '新样式得写成 inline style（要么用这一页里已经有的类名）。'
    );
  }

  const colors = hardcodedColors(html, ctx.original);
  if (colors.length) {
    throw new PageEditError(
      `模型写死了颜色（${colors.slice(0, 4).join(' / ')}）：换一套配色时这一块不会跟着变，而它读起来完全正常。这一块没改 —— ` +
        '颜色得用 var(--c-…)（阴影和蒙版那种半透明黑白除外，比如 rgba(0,0,0,.08)）。'
    );
  }
  const badVars = [...html.matchAll(/var\(\s*(--[a-z0-9-]+)/g)]
    .map((m) => m[1])
    .filter((v) => !ctx.knownVars.has(v));
  if (badVars.length) {
    // 报错里要**列出能用的那些**：只说「不存在」的话他只能再点一次让模型再猜一个名字
    // （`--c-text` 猜完猜 `--c-muted`），而每一次都是一次真实花费。
    throw new PageEditError(
      `模型用了不存在的样式变量（${[...new Set(badVars)].slice(0, 4).join(' / ')}）：浏览器会把整条声明丢掉，那一块的颜色/间距直接没有，而页面照样渲染。这一块没改。` +
        `能用的只有这些：${[...ctx.knownVars].sort().join(' ')}`
    );
  }
}
