// 单图模式（poster）要**印在画面里**的那几行字，怎么存在 html 的属性里、怎么读回来。
//
// 为什么是单独一个文件：写的那一头在 `imageModes.toPoster`（变形时从这一页扒出来），读的那一头
// 在 `imageService.findImageSlots`（生图时塞进提示词的 `TEXT:` 那一段），而 `imageModes` 依赖
// `imageService`（反过来不行）。各写一半的话两头的转义早晚不一致 —— 一头把 `|` 转义了另一头
// 不认，那几行字就在错的地方断开：印出来的每个字都是我们给的，只是标题的后半句跑到了正文里，
// 而图看起来完全正常（硬规则 3）。
//
// 分隔符用 `|`：JSON 塞进属性要转义一堆引号，而这几行字是要发给模型的原文 —— 属性里存的
// 东西必须一眼看得出来（`ai_logs` 里翻提示词时对得上）。

export const POSTER_TEXT_ATTR = 'data-poster-text';

/** 一行原文 → 属性里那一段（`|` 也要转义：标题里真有一个 `|` 的话会把那一行劈成两行）。 */
export function encodePosterText(lines: string[]): string {
  return lines
    .map((s) =>
      s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/\|/g, '&#124;')
    )
    .join('|');
}

/** 属性里那一段 → 几行原文（先按 `|` 切、再解转义，顺序反了的话转义过的 `|` 会被当成分隔符）。 */
export function decodePosterText(raw: string): string[] {
  if (!raw) return [];
  return raw
    .split('|')
    .map((s) =>
      s
        .replace(/&#124;/g, '|')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&gt;/g, '>')
        .replace(/&lt;/g, '<')
        .replace(/&amp;/g, '&')
        .trim()
    )
    .filter(Boolean);
}
