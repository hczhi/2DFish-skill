/**
 * 空白页（他自己往上摆文字和图的那种页）。
 *
 * **不进案例库、没有 L 编号、没有 demo。** 进了的话规划那一步会把它挑给某一页（给模型的
 * 清单里每一条都是可挑的），出来是一页空白的幻灯片 —— 而 `layoutId` 校验一路放行、
 * problems 里一个字都没有，他翻到那儿才发现。所以它是 `plan_json` 里一个特殊的
 * `layoutId`，只能由「插一页空白页」这条路写进去。
 *
 * 插进来那一刻就**带着 html 落库**（`ppt_deck_pages.html` 不为空 = 已生成），和别的插页
 * 相反：空白页压根没有「生成」这一步。不落 html 的话它在界面上是「未生成」，缩略图放的是
 * 版式 demo，而「生成剩下的 N 页」会把它算进去 —— 那一次真实调用按案例库的版式排出一页
 * 读得通的幻灯片，把他摆好的东西整页换掉（现在 html 一开始就在，`runAll` 只挑没生成的那几页）。
 */
export const BLANK_LAYOUT_ID = 'BLANK';

/** 界面上那两行字（`plan_json` 里跟着页一起存）。空着的话缩略图上那个标签是空的，
 *  而「BLANK」这个词只有我们看得懂。 */
export const BLANK_LAYOUT_NAME = '空白页';
export const BLANK_LAYOUT_TITLE = '空白页 · 自己往上加文字和图（不走 AI 生成）';

/** 这一页是不是空白页。**大小写归一后再比**：`plan_json` 是历史数据，混进小写的话这里判 false，
 *  于是「生成这一页」那道拦不住，一次真实调用把画布换成一页版式排出来的幻灯片。 */
export function isBlankPage(layoutId: unknown): boolean {
  return String(layoutId ?? '').trim().toUpperCase() === BLANK_LAYOUT_ID;
}

/**
 * 一页空白画布的 html。
 *
 * `data-layout` 照旧写上（和别的页一样，导出的文件里能看出这一页是什么）；里面只有一个
 * `.bl-canvas`，元素在后面的编辑里一个个加进去。**空的时候不放任何提示文字** ——
 * 放了的话它会跟着导出和放映一起印出去，而屏幕上看不出那句话是我们加的。
 */
export function blankPageHtml(): string {
  return `<section class="slide" data-layout="${BLANK_LAYOUT_ID}">\n  <div class="bl-canvas"></div>\n</section>`;
}
