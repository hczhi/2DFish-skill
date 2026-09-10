// 「这一页的提纲原文装不进这个版式」这一条警告。**只喊不改**（不自动拆页、不自动换版式）。
//
// 为什么必须有：原文进了生成 prompt 之后（`PageInput.outlineText`），装不下的那一页模型会
// **自己压缩** —— 六行地产数据合成一句「华东市场领先」，出来是一页排得整整齐齐、读起来
// 完全通顺的幻灯片，而它压掉了哪几句一个字都不会说。这是整条链上最后一个静默丢内容的口子。
//
// 为什么不自动处理：拆页会让页数凭空变多、换版式会让「模型挑的版式」变成代码挑的 ——
// 两种都是他以为规划就是这样，而下次同样的提纲又是这个结果，他不知道该改提纲还是改 prompt
// （同 planService 的 `repeatWarnings` / `kindWarnings`）。
//
// 容量哪来的：**先从库文件那条目自己写的「约 900–1100 字」里取上界**（L37 / L38 / L39 这类
// 长文版式的条目里都写着），取不到才按 `形状` 落一个保守的默认值。写死一张「L 编号 → 字数」
// 的表不行：新加一条长文版式忘了进表的话，那一条会**永远**带着一句「这一页超容」——
// 而现在的表现相反（漏写「约 N 字」= 按形状那个保守值算 = 顶多多喊一句，有声）。

import type { LayoutShape, PptLayout } from './layoutLibrary.js';

/**
 * 按 `形状` 的保守容量（提纲原文字数）。`形状` 是库文件里**必填**的一行（漏了 layoutLibrary
 * 直接抛错），所以这张表不会出现「新版式查不到」的空洞。
 */
const BY_SHAPE: Record<LayoutShape, number> = {
  聚焦: 200, // 单一主角：一句金句 / 一个人物，多一段就压过主角
  分屏: 320,
  并列: 420, // 3–4 个同构小块，每块几十字
  对比: 380,
  数据: 300, // 大数字占地方，字是配角
  时序: 380,
};

/** 超过容量多少才喊。贴着容量就喊的话几乎每页都有一条，真正超一倍的那几页会被一起忽略。 */
const SLACK = 1.2;

/** 「能装长文」的门槛：库文件里写着约 N 字、N 到这个数以上的才配进建议名单。 */
const LONGFORM_CHARS = 600;

/** 这一条版式大约装多少字提纲原文。 */
export function capacityOf(layout: PptLayout): number {
  // 条目里的「约 900–1100 字」/「约 700-900 字」取上界（`selectText` 带着「适用」那一行）。
  const m = layout.selectText.match(/约\s*(\d+)\s*(?:[–\-~至]\s*(\d+)\s*)?字/);
  if (m) {
    const hi = Number(m[2] || m[1]);
    if (Number.isFinite(hi) && hi > 0) return hi;
  }
  return BY_SHAPE[layout.shape];
}

/**
 * 这一页原文装不下时的那一句话（装得下返回 `null`）。
 *
 * 措辞里三个数都要有：**原文多少字 / 这个版式大约装多少字 / 换哪几条能装**——只说
 * 「内容偏多」的话他没法判断是拆页还是换版式，而生成出来的那一页看起来是完整的，
 * 于是他什么也不会做。
 */
export function outlineFitProblem(
  layout: PptLayout,
  outlineText: string,
  label: string,
  longform: PptLayout[]
): string | null {
  const chars = outlineText.trim().length;
  if (!chars) return null;
  const cap = capacityOf(layout);
  if (chars <= cap * SLACK) return null;
  const alt = longform
    .filter((l) => l.id !== layout.id && capacityOf(l) > cap)
    .slice(0, 3)
    .map((l) => `${l.id}（约 ${capacityOf(l)} 字）`);
  return (
    `${label}的提纲原文有 ${chars} 字，${layout.id}（形状：${layout.shape}）一页大约装 ${cap} 字 —— ` +
    `照现在生成的话模型会自己把这一段压缩，而它压掉了哪几句不会说（页面看起来是完整的一页）。` +
    `拆成两页，或者换一条装得下的版式${alt.length ? `：${alt.join(' / ')}` : ''}。`
  );
}

/** 库里「能装长文」的那几条（按容量从大到小），给上面那句话当建议名单用。 */
export function longformLayouts(lib: PptLayout[]): PptLayout[] {
  return lib
    .filter((l) => capacityOf(l) >= LONGFORM_CHARS)
    .sort((a, b) => capacityOf(b) - capacityOf(a));
}
