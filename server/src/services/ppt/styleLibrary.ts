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

import { library, libraryVersion } from './layoutLibrary.js';
import { designVars, type DesignSpec } from './designSpec.js';

/** 版式里那一格图的三路（每套画风各一份模板） */
export type SlotImageMode = 'concept' | 'case' | 'data';
/** 整页级的两路（模板是**文件级一份**，见 md §6） */
export type PageImageMode = 'backdrop' | 'poster';
export type ImageMode = SlotImageMode | PageImageMode;

export const PER_STYLE_MODES: SlotImageMode[] = ['concept', 'case', 'data'];
export const PAGE_MODES: PageImageMode[] = ['backdrop', 'poster'];
/**
 * `data-img-mode` 认的全部取值。**新增一路必须同时进这里**：`findImageSlots` 认不出的值一律
 * 按 concept 算 —— 整页背景图会拿 concept 那套模板生成（主体居中、四边留白、还带一句
 * 「主体离边缘留一点」），铺满整页之后画面上是一张「怎么看都不像背景」的图，而一处都不报错。
 */
export const IMAGE_MODES: ImageMode[] = [...PER_STYLE_MODES, ...PAGE_MODES];

export function isPageMode(mode: ImageMode): mode is PageImageMode {
  return (PAGE_MODES as string[]).includes(mode);
}

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
  templates: Record<SlotImageMode, string>;
}

export interface DeckColors {
  brand: string;
  accent: string;
  bg: string;
  bgAlt: string;
}

/**
 * 一律带上的尾巴：模型很爱在图里写字，而带字的插画在 deck 里就是一处错别字。
 *
 * 「主体离边缘留一点」也写在这一句里，**不进 18 套模板** —— 每格图都会被版式裁一刀
 * （`object-fit:cover`），主体贴边的话裁掉的正好是它。写在模板里的话 18 处只会改到一处。
 *
 * **三条尾巴和模板同语言（中文）**：混着写的话用户在「编辑这一格的提示词」里核到的是半句
 * 英文，而模型对夹在中文长句里的那半句英文明显更不当真 —— 症状是「不许写字这条好像没生效」，
 * 而图每张都正常（见 illustration-style.md §2.0 第一条）。
 */
const HARD_TAIL = '画面主体离四边留出一点距离。画面里不许出现任何文字、字母、数字、水印、UI 界面元素。';

/**
 * 整页背景图的尾巴：**「主体离边缘留一点」那半句必须去掉** —— 背景图铺满整页、四边各被裁一刀，
 * 让它往里收之后画面四周是一圈空白（页面上是「这张背景图怎么缩在中间」），而图本身完全正常。
 * 「不许有字」照旧（用户的文字压在上面，图里再有字就是两层字叠着）。
 */
const BACKDROP_TAIL =
  '画面铺满整幅、四边直接出血，不要边框、不要外框、不要暗角。画面里不许出现任何文字、字母、数字、水印、UI 界面元素。';

/**
 * 单图模式的尾巴：**这一路不许写「不许出现文字」** —— 整页就这一张图，字是要印在里面的。
 * 照抄 `HARD_TAIL` 的话模型两句话打架，挑了「不写字」那边就是一张没有任何文案的插画铺满整页
 * （画面很好看，而这一页的内容一个字都不在了）。
 *
 * 「文字内容」这四个字要和 poster 模板里那个段标一模一样（md §6）—— 两边叫法不一样的话模型
 * 不知道这句限制指的是哪一段，于是顺手多印一句标语，而那句读起来和这一页的文案一样自然。
 */
const POSTER_TAIL =
  '画面里不要出现人物、人脸、人手。' +
  '不要水印、不要 UI 界面元素、不要 logo、不要页码，除「文字内容」里那几行之外不要出现任何别的字。';

/**
 * 「画什么」那句里点了人的词。只用来**出声**（`personConflictNote`），不用来改提示词。
 *
 * 不写成「自动把人删掉」：subject 是规划那一步写的、也可能是他自己改的，替换掉之后
 * 界面上那句话和真发出去的不是同一句（他会一直在框里改一句压根没发出去的话）。
 */
const PERSON_WORDS = /人物|人像|人脸|人手|男[士子人]|女[士子人]|工程师|员工|团队|客户|医生|老师|学生|工人|技师|专家|领导|顾客|用户形象|剪影|侧影|背影|双手|手持|握着|站在|坐在/;

/**
 * 单图这一路的尾巴写死了「不要出现人物」，而「画什么」那句里点名要人时**两句话在打架** ——
 * 模型自己挑一边：挑了尾巴那边就是一张没有人的图（和他要的不一样），挑了 subject 那边
 * 就是一张人脸糊掉/六根手指的整页主视觉（铺满整页时一眼就废）。两种都回 200、都挂上缩略图，
 * 而提示词里两句话都在，他只会一张张重生（每张真花钱）。
 *
 * 所以这里只**说出来**，不替他改：要人物的话把这一格改成分屏图（split），或者在
 * 「编辑提示词」里自己写一整条（`fullPrompt` 会绕过这条尾巴）。
 */
export function personConflictNote(mode: ImageMode, subject: string): string | null {
  if (mode !== 'poster' || !PERSON_WORDS.test(subject)) return null;
  return (
    '这一格是单图模式，而单图的提示词尾巴写死了「不要出现人物、人脸、人手」——' +
    '「画什么」那句里却点了人，两句话打架，模型会自己挑一边（多半是画一张没有人的图）。' +
    '真要人物就把这一页改回分屏图，或者在这里自己写一整条提示词（自定义的那一条不带这句尾巴）。'
  );
}

let cachedStyles: PptStyle[] | null = null;
let cachedPageTemplates: Record<PageImageMode, string> | null = null;
let cachedColors: DeckColors | null = null;
let cachedDevices: Record<PageImageMode, string[]> | null = null;
// 这两份是 library 的派生物，所以跟着它的版本号一起作废：不跟的话改了
// illustration-style.md / template.html 的 `:root` 之后生成用的是新骨架、生图提示词
// 还是旧画风旧色值，「md 改了一半生效」而两边都不报错。
let cachedAt = -1;

function freshen(): void {
  const v = libraryVersion();
  if (v === cachedAt) return;
  cachedAt = v;
  cachedStyles = null;
  cachedPageTemplates = null;
  cachedColors = null;
  cachedDevices = null;
}

export function styles(): PptStyle[] {
  freshen();
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
  cachedPageTemplates = null;
  cachedColors = null;
  cachedDevices = null;
}

/**
 * 整页图那两路的模板（md §6，**全库一份**）。
 *
 * 缺一路就抛：回落到 concept 模板的话，「背景图」拿到的是一张主体居中、四边留白、还写着
 * 「主体离边缘留一点」的概念插画 —— 铺满整页之后就是「这张图怎么看都不像背景」，
 * 而生成成功、贴上了、一处不报错（而且真扣了一次额度）。
 */
export function pageTemplates(): Record<PageImageMode, string> {
  freshen();
  if (!cachedPageTemplates) {
    const md = library().illustrationStyle;
    const out = {} as Record<PageImageMode, string>;
    for (const mode of PAGE_MODES) {
      const tpl = codeBlockAfter(md, `#### ${mode} 模板`);
      if (!tpl) {
        throw new Error(
          `配图画风库里找不到「#### ${mode} 模板」那个代码块（library/illustration-style.md §6 整页图模板）—— 整页${
            mode === 'backdrop' ? '背景图' : '单图'
          }没有模板可用。`
        );
      }
      out[mode] = tpl;
    }
    cachedPageTemplates = out;
  }
  return cachedPageTemplates;
}

/**
 * 整页那两路的**设计手法库**（md §6.1）。一次只发一条，**挑哪一条由代码算**（见 `pickDevice`）。
 *
 * 为什么不把那一串手法列在模板里让模型挑：它每次挑的是同一条（模型有自己的偏好），于是
 * 整份稿子里每一页背景图长得都差不多 —— 而每一张单看都不错、接口 200、一处都不报错，
 * 这就是「太单调、没设计感」剩下的那一半。
 *
 * **一路少于三条就抛**：只剩一条的话全份又变成同一个手法，而提示词读起来完全正常。
 */
export function pageDevices(): Record<PageImageMode, string[]> {
  freshen();
  if (!cachedDevices) {
    const md = library().illustrationStyle;
    const out = {} as Record<PageImageMode, string[]>;
    for (const mode of PAGE_MODES) {
      const block = codeBlockAfter(md, `#### ${mode} 设计手法`);
      const list = block
        .split('\n')
        .map((l) => l.replace(/^[-*]\s*/, '').trim())
        .filter(Boolean);
      if (list.length < 3) {
        throw new Error(
          `配图画风库里「#### ${mode} 设计手法」只解析出 ${list.length} 条（library/illustration-style.md §6.1）—— ` +
            '每条要写成 `- …` 一行一条。少于三条的话整份稿子的整页图会全用同一个手法，而每一张单看都正常、一处都不报错。'
        );
      }
      out[mode] = list;
    }
    cachedDevices = out;
  }
  return cachedDevices;
}

/**
 * 这一页用哪一条设计手法。**按页码轮**（`pageKey`），再按 deckId 错开起点，所以
 * 连着两页一定不是同一条，而**同一页两次拼出来一定一样** —— 随机挑的话「完整提示词」那个
 * 框里显示的手法和真发出去的那条不是一回事，他照着预览调完，回来的图是另一个手法（两条都通顺）。
 *
 * 没给页码时退到 `theme` 的哈希（主题里带页标题，所以每页也还是不一样）——
 * 一律回第一条的话，忘了传页码的那条路上全份又是同一个手法，而一处都不报错。
 */
function pickDevice(mode: PageImageMode, input: RenderStyleInput): string {
  const list = pageDevices()[mode];
  const key = input.pageKey ?? hashKey(input.theme);
  return list[Math.abs(key + hashKey(input.deckKey || '')) % list.length];
}

function hashKey(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
  return h;
}

function parseStyles(md: string): PptStyle[] {
  const out: PptStyle[] = [];
  // `### S-A 现代 SaaS 等距（默认）`
  const heads = [...md.matchAll(/^###\s+(S-[A-Z])\s+([^\n]+)$/gm)];
  for (let i = 0; i < heads.length; i++) {
    const h = heads[i];
    const body = md.slice(h.index! + h[0].length, i + 1 < heads.length ? heads[i + 1].index! : md.length);
    const rawName = h[2].trim();
    const templates = {} as Record<SlotImageMode, string>;
    for (const mode of PER_STYLE_MODES) {
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
 * **这一份稿子**真正在用的四个色值：template.html 的 `:root` 打底，再叠上它自己的设计规范
 * （096 `designVars`）。
 *
 * 不给 `design` 就是默认那套（= template 那份）。**调用方一定要把 deck 的规范传进来**：
 * 一直用默认那份的话，蓝色系的稿子配出来的图全是橙的 —— 每张图单看都不错、没有一处报错，
 * 他只会以为「这个模型画不了蓝色」，或者一张张重生（每张都是一次真实花费）。
 *
 * 取不到就抛错：把 `{{BRAND}}` 原样发出去的话，图的配色和 deck 不是一套（见文件头 ②）。
 */
export function deckColors(design?: DesignSpec): DeckColors {
  freshen();
  if (!cachedColors) {
    const css = library().template;
    const pick = (name: string): string => {
      const m = new RegExp(`--${name}\\s*:\\s*([^;\\n]+)`).exec(css);
      if (!m) throw new Error(`template.html 的 :root 里找不到 --${name} —— 生图提示词里的颜色占位符会换不掉。`);
      return m[1].trim();
    };
    cachedColors = { brand: pick('c-brand'), accent: pick('c-accent'), bg: pick('c-bg'), bgAlt: pick('c-bg-alt') };
  }
  if (!design) return cachedColors;
  // 规范只覆盖它自己列出来的那几个变量（默认那套一个都不覆盖），其余落回 template 那份。
  const ov = designVars(design);
  return {
    brand: ov['--c-brand'] || cachedColors.brand,
    accent: ov['--c-accent'] || cachedColors.accent,
    bg: ov['--c-bg'] || cachedColors.bg,
    bgAlt: ov['--c-bg-alt'] || cachedColors.bgAlt,
  };
}

export interface RenderStyleInput {
  /** 这一页在讲什么（deck 主题 + 页标题） */
  theme: string;
  /** 这一格要什么图（槽位的 data-img-prompt 原文） */
  scene: string;
  /** '16:9 landscape' */
  ratio: string;
  /** 这份稿子的设计规范（096）。**不传就是默认那套配色** —— 见 `deckColors` 上的注释。 */
  design?: DesignSpec;
  /**
   * 这一格的留白方向，**代码从版式几何算出来的那一句**（`imageSpace.computeSpaceHints` 的 `en`）。
   * 算不出来就别传 —— 那边的文件头 ② 说的就是这件事：编一句「主体居中」比没有这一句更糟。
   */
  spaceHint?: string;
  /**
   * 单图模式（poster）要**印在画面里**的那几行字，第一行是标题。
   * 一律由代码从这一页的大纲里取原文（硬规则 3）：让模型自己编的话，印在图上的那几句读起来
   * 和这一页的文案一样自然，而它和大纲里写的不是一回事 —— 没有任何一处会报错。
   */
  slideText?: string[];
  /**
   * 这一页的页码。整页那两路的**设计手法**按它轮着挑（`pickDevice`）——
   * 不传的话退到主题的哈希，见那个函数上的注释。
   */
  pageKey?: number;
  /** 这一份稿子的 id，只用来把手法的起点错开（两份稿子不会从同一条开始）。 */
  deckKey?: string;
}

/**
 * 把画风模板渲染成一条最终提示词。
 *
 * 模板里的 `<…>` 是给人看的填空说明（`<本页主题，1句>` / `<产品界面场景描述…>` /
 * `<size>`），一个都不能留 —— 留着就等于把说明文字当需求发给模型了。
 */
export function renderStylePrompt(style: PptStyle, mode: ImageMode, input: RenderStyleInput): string {
  const c = deckColors(input.design);
  // 场景那句话的句尾标点要去掉：模板里 `Subject: <场景>, built from …` 是接着往下写的，
  // 原样塞进去出来是「…良率对比。, built from …」—— 模型读到的是一句断掉的话（它照样回一张图，
  // 只是不怎么听后半句），而提示词只有在 ai_logs 里翻出来才看得见。
  const scene = input.scene.trim().replace(/[.。,，;；、]+$/, '');
  const page = isPageMode(mode);
  const tpl = page ? pageTemplates()[mode] : style.templates[mode] || style.templates.concept;
  const body = tpl
    .replace(/<size>/g, () => ratioPhrase(input.ratio))
    // 带「主题」字样的那一处填主题，其余的 `<…>` 都是场景描述。
    .replace(/<[^>\n]*>/g, (m) => (/主题/.test(m) ? input.theme : scene))
    // 整页那两路的模板是文件级一份的，画风从这三句进去（md §6）。
    .replace(/\{\{RENDER\}\}/g, () => style.render)
    .replace(/\{\{COMPOSITION\}\}/g, () => style.composition)
    .replace(/\{\{TABOO\}\}/g, () => (style.taboo ? `避免${style.taboo}；` : ''))
    // 这一页的设计手法：**代码挑的那一条**（md §6.1）。必须排在颜色几句**之前** ——
    // 手法原文里带 `{{BRAND}}`，放到后面的话那几个字原样发给模型（它自己配一个颜色，
    // 而图和这份稿子不是一套色，每张单看都不错）。
    .replace(/\{\{DEVICE\}\}/g, () => (page ? pickDevice(mode as PageImageMode, input) : ''))
    // 留白那一句：算不出来就是空串（不是一句编的默认值）。
    .replace(/\{\{SPACE\}\}/g, () => input.spaceHint || '')
    .replace(/\{\{SLIDE_TEXT\}\}/g, () => slideTextLines(input.slideText))
    .replace(/\{\{BRAND\}\}/g, () => c.brand)
    .replace(/\{\{ACCENT\}\}/g, () => c.accent)
    .replace(/\{\{BG_ALT\}\}/g, () => c.bgAlt)
    .replace(/\{\{BG\}\}/g, () => c.bg);
  // 版式里那一格（三路）的模板没有 `{{SPACE}}` 这个位子，留白那句接在尾巴前面 ——
  // 18 套模板各塞一个占位符的话，下次改这条规则只会改到一套（而另外 17 套照旧发出去）。
  const space = !page && input.spaceHint ? ` ${input.spaceHint}` : '';
  const tail = page ? (mode === 'backdrop' ? BACKDROP_TAIL : POSTER_TAIL) : HARD_TAIL;
  return `${body.replace(/\s*\n\s*/g, ' ').trim()}${space} ${tail}`;
}

/** 「重写整条」那一步**必须原样留在那一条里**的一段（代码算的，见 `requiredPromptParts`）。 */
export interface RequiredPromptPart {
  /** 提示里用的名字（哪一段被改掉了） */
  label: string;
  /** 不在了就接回去的原文 */
  text: string;
  /** **全部**出现才算「还在」 */
  probes: string[];
}

/**
 * 整条提示词里**不许模型动**的那几段：禁忌尾巴、比例、单图要印进画面的那几行原文、
 * 代码算出来的留白方向。调用方（`rewriteSpecPrompt`）拿它核对重写回来那条，少了就接回去**并出声**。
 *
 * 为什么这一份要在这里而不是在重写那一步里另写：这四样的原文全在本文件（三条尾巴、
 * `ratioPhrase`、`slideTextLines`）—— 在那边照抄一份的话，改了尾巴之后核对用的还是旧那句，
 * 于是「它每次都被改掉」永远成立（每次都在末尾接一遍旧尾巴），而提示词读起来完全正常。
 */
export function requiredPromptParts(
  mode: ImageMode,
  input: { ratio: string; slideText?: string[]; spaceHint?: string }
): RequiredPromptPart[] {
  const page = isPageMode(mode);
  const tail = page ? (mode === 'backdrop' ? BACKDROP_TAIL : POSTER_TAIL) : HARD_TAIL;
  const phrase = ratioPhrase(input.ratio);
  const out: RequiredPromptPart[] = [
    {
      label: mode === 'poster' ? '「不要出现人物 / 除那几行外不要别的字」那条尾巴' : '「不许出现任何文字」那条尾巴',
      text: tail,
      probes: [mode === 'poster' ? '不要出现人物' : '不许出现任何文字'],
    },
    { label: `比例（${phrase}）`, text: `画面按${phrase}。`, probes: [phrase] },
  ];
  const lines = (input.slideText || []).map((s) => String(s).trim()).filter(Boolean);
  if (lines.length) {
    out.push({
      label: `要印在画面里的那 ${lines.length} 行原文`,
      text: `文字内容（原样印上，不要改写、不要多印别的字）：${slideTextLines(lines)}`,
      probes: lines,
    });
  }
  if (input.spaceHint) {
    out.push({ label: '代码算出来的留白方向', text: input.spaceHint, probes: [input.spaceHint] });
  }
  return out;
}

/**
 * `<size>` 换成的那句话（模板末尾那一段）。**只在拼提示词这一步翻成中文** ——
 * `imageService.ratioText` 回的 `16:9 landscape` 是**数据字面**：它存进 `images_json.ratio`、
 * 界面上那张卡也显示它、`ratioFromText` 还要反着认回 `16:9`。在那边直接改成中文的话，
 * 老的那几行和新的那几行对不上（挑图那一格的比例标签变成空的），而一处都不报错。
 *
 * 认不出的写法原样带出去（宁可留一段英文，也别把比例这件事说错 —— 说错的代价是整张图的构图）。
 */
function ratioPhrase(ratio: string): string {
  const r = ratio.trim();
  if (/1:1|square/i.test(r)) return '1:1 方构图';
  if (/3:4|portrait/i.test(r)) return '3:4 竖构图';
  if (/16:9|landscape/i.test(r)) return '16:9 横构图';
  return `${r} 构图`;
}

/**
 * 要印在画面里的那几行字。**一行一对引号**：连起来写成一段的话模型会把它当描述读，
 * 自己重新断句（标题里的半句跑到正文去），而印出来的每个字都是我们给的那几个 —— 看不出错。
 * 一个字都没给时留着占位符原样发出去，`leftoverPlaceholders` 会喊（调用方必须喊出来）。
 */
function slideTextLines(lines?: string[]): string {
  const kept = (lines || []).map((s) => String(s).trim()).filter(Boolean);
  if (!kept.length) return '{{SLIDE_TEXT}}';
  return kept.map((s) => `"${s.replace(/"/g, "'")}"`).join(' / ');
}

/** 渲染后还剩下的占位符（调用方要喊出来：那几个字会原样发给模型）。 */
export function leftoverPlaceholders(prompt: string): string[] {
  return [...new Set((prompt.match(/\{\{[^}]*\}\}|<[^>\n]{2,40}>/g) || []))];
}
