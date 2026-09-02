// 配图画风库。6 套画风（S-A ~ S-F）× 3 个 mode（concept / case / data）的提示词模板，
// **唯一来源是 `library/illustration-style.md`**（同版式库：文件跟着代码走）。
//
// 为什么要从 md 里解析出来、而不是在代码里写死一段：写死那一段的话「换画风」这个下拉
// 换的是别的东西 —— 用户选了「国风水墨」，出来的还是等距 SaaS 插画，而每张图单看都不错、
// 没有一处报错，他只会以为这个模型画不了水墨。
//
// 三条是承重的：
// ① **解析出 0 套必须抛错**（同 layoutLibrary）：回空列表的话下游会照空列表继续生成，
//    症状是「画风选了没用」。
// ② **颜色占位符必须换成 deck 真正在用的色值**（`template.html` 的 `:root`）。留着
//    `{{BRAND}}` 原样发给模型的话，它会照自己的理解配色 —— 图和 deck 的品牌色不是一套，
//    翻起来只是「这几张图有点跳」。
// ③ **一份 deck 只能一个 styleId**，而且换了画风之后已经配好的那几页**不会自动重做** ——
//    调用方必须把这件事说出来（见 imageService / PptPlan.vue）。

import { library } from './layoutLibrary.js';

export type ImageMode = 'concept' | 'case' | 'data';
export const IMAGE_MODES: ImageMode[] = ['concept', 'case', 'data'];

export interface PptStyle {
  /** 'S-A' */
  id: string;
  /** '现代 SaaS 等距' */
  name: string;
  /** 是不是 md 里标着「（默认）」的那一套 */
  isDefault: boolean;
  applicable: string;
  render: string;
  composition: string;
  taboo: string;
  /** 三个 mode 的提示词模板原文（含 `<…>` 和 `{{…}}` 占位） */
  templates: Record<ImageMode, string>;
}

export interface DeckColors {
  brand: string;
  accent: string;
  bg: string;
  bgAlt: string;
}

/** 一律带上的尾巴：模型很爱在图里写字，而带字的插画在 deck 里就是一处错别字。 */
const HARD_TAIL = 'No text, no letters, no numbers, no watermark, no UI chrome.';

let cachedStyles: PptStyle[] | null = null;
let cachedColors: DeckColors | null = null;

export function styles(): PptStyle[] {
  if (!cachedStyles) cachedStyles = parseStyles(library().illustrationStyle);
  return cachedStyles;
}

export function styleById(id: string): PptStyle | undefined {
  const key = id.trim().toUpperCase();
  return styles().find((s) => s.id === key);
}

/** 下拉的缺省项：md 里标了「（默认）」的那一套，没有就第一条。 */
export function defaultStyleId(): string {
  const list = styles();
  return (list.find((s) => s.isDefault) || list[0]).id;
}

export function resetStyleCache(): void {
  cachedStyles = null;
  cachedColors = null;
}

function parseStyles(md: string): PptStyle[] {
  const out: PptStyle[] = [];
  // `### S-A 现代 SaaS 等距（默认）`
  const heads = [...md.matchAll(/^###\s+(S-[A-Z])\s+([^\n]+)$/gm)];
  for (let i = 0; i < heads.length; i++) {
    const h = heads[i];
    const body = md.slice(h.index! + h[0].length, i + 1 < heads.length ? heads[i + 1].index! : md.length);
    const rawName = h[2].trim();
    const templates = {} as Record<ImageMode, string>;
    for (const mode of IMAGE_MODES) {
      templates[mode] = codeBlockAfter(body, `#### ${mode} 模板`);
    }
    // 三套模板缺一套就整条丢掉：缺的那个 mode 会静默回落到别的模板，出来的图是
    // 「概念插画」而这一页要的是信息图 —— 每张单看都不错，只是答错了题。
    if (!templates.concept || !templates.case || !templates.data) continue;
    out.push({
      id: h[1],
      name: rawName.replace(/[（(]默认[）)]/g, '').trim(),
      isDefault: /[（(]默认[）)]/.test(rawName),
      applicable: field(body, '适用'),
      render: field(body, '渲染'),
      composition: field(body, '构图'),
      taboo: field(body, '禁忌'),
      templates,
    });
  }
  if (!out.length) {
    // 解析出 0 套和「库是空的」在接口上长得一样（200 + 空列表），而下游会照空列表
    // 继续生图 —— 症状是「换画风没有任何区别」。
    throw new Error(
      '配图画风库解析出 0 套（library/illustration-style.md）—— 检查条目标题是不是还写成「### S-X <名称>」、每套下面是不是还有 concept / case / data 三个「#### <mode> 模板」代码块。'
    );
  }
  return out;
}

function codeBlockAfter(body: string, heading: string): string {
  const at = body.indexOf(heading);
  if (at === -1) return '';
  const m = /```[a-z]*\n([\s\S]*?)```/.exec(body.slice(at));
  return m ? m[1].trim() : '';
}

function field(body: string, label: string): string {
  const re = new RegExp(`^-\\s*\\*\\*${label}\\*\\*\\s*[：:]\\s*(.*)$`, 'm');
  const m = re.exec(body);
  return m ? m[1].trim() : '';
}

/**
 * deck 真正在用的四个色值（`template.html` 的 `:root`）。
 * 取不到就抛错：把 `{{BRAND}}` 原样发出去的话，图的配色和 deck 不是一套（见文件头 ②）。
 */
export function deckColors(): DeckColors {
  if (cachedColors) return cachedColors;
  const css = library().template;
  const pick = (name: string): string => {
    const m = new RegExp(`--${name}\\s*:\\s*([^;\\n]+)`).exec(css);
    if (!m) throw new Error(`template.html 的 :root 里找不到 --${name} —— 生图提示词里的颜色占位符会换不掉。`);
    return m[1].trim();
  };
  cachedColors = { brand: pick('c-brand'), accent: pick('c-accent'), bg: pick('c-bg'), bgAlt: pick('c-bg-alt') };
  return cachedColors;
}

export interface RenderStyleInput {
  /** 这一页在讲什么（deck 主题 + 页标题） */
  theme: string;
  /** 这一格要什么图（槽位的 data-img-prompt 原文） */
  scene: string;
  /** '16:9 landscape' */
  ratio: string;
}

/**
 * 把画风模板渲染成一条最终提示词。
 *
 * 模板里的 `<…>` 是给人看的填空说明（`<本页主题，1句>` / `<产品界面场景描述…>` /
 * `<size>`），一个都不能留 —— 留着就等于把说明文字当需求发给模型了。
 */
export function renderStylePrompt(style: PptStyle, mode: ImageMode, input: RenderStyleInput): string {
  const c = deckColors();
  const body = (style.templates[mode] || style.templates.concept)
    .replace(/<size>/g, () => `${input.ratio} composition`)
    // 带「主题」字样的那一处填主题，其余的 `<…>` 都是场景描述。
    .replace(/<[^>\n]*>/g, (m) => (/主题/.test(m) ? input.theme : input.scene))
    .replace(/\{\{BRAND\}\}/g, () => c.brand)
    .replace(/\{\{ACCENT\}\}/g, () => c.accent)
    .replace(/\{\{BG_ALT\}\}/g, () => c.bgAlt)
    .replace(/\{\{BG\}\}/g, () => c.bg);
  return `${body.replace(/\s*\n\s*/g, ' ').trim()} ${HARD_TAIL}`;
}

/** 渲染后还剩下的占位符（调用方要喊出来：那几个字会原样发给模型）。 */
export function leftoverPlaceholders(prompt: string): string[] {
  return [...new Set((prompt.match(/\{\{[^}]*\}\}|<[^>\n]{2,40}>/g) || []))];
}
