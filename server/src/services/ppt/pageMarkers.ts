// 页面 html 上那几个记号：这一页现在是哪个模式、有没有自己那一层装饰底图。
//
// **单独一个文件，只因为拼页那一层也要判这件事。** `deckShell` 不能 import `imageModes`
// （imageModes → pageService → deckShell 成环，起服务时是一句 TDZ 报错），而拼页时要回答
// 「这一页能不能垫全份共用的那张装饰底图」（106）。在 deckShell 里另抄一遍这两个正则的话，
// 以后多出一种页模式时只会加在 imageModes 那一份上 —— 漏掉的这一份把新模式当成分屏页，
// 于是整页一张图的那几页被悄悄盖上一层底纹：画面完整、接口 200，只是那张花过钱的图淡了一档。

export type PageImageMode = 'split' | 'backdrop' | 'poster';

/**
 * 这一页现在是哪个模式（`data-backdrop` / `data-poster` 是变形时留下的记号）。
 *
 * **poster 先判**：单图那一页是从任意一页变过来的，section 上可能还留着上一次背景图变形的
 * `has-bg`（无害），而 `data-backdrop` 那一层已经不在了 —— 反过来判的话界面上这一页写着
 * 「背景图模式」，点「改回分屏」回的是一句「扫不出背景图那一层」，而他要的那个「改回原版」
 * 按钮压根不出现。
 */
export function pageImageMode(html: string): PageImageMode {
  if (/\sdata-poster="1"/.test(html)) return 'poster';
  return /\sdata-backdrop="1"/.test(html) ? 'backdrop' : 'split';
}

/** 这一页自己那层装饰背景（`.page-decor`）在不在。 */
export function hasDecor(html: string): boolean {
  return /\sdata-decor="1"/.test(html);
}
