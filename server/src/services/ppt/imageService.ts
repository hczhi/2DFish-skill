// 给已生成的那一页真的配图：扫出所有 `data-img-prompt` 的槽位，逐个生图，把
// 占位图的地址换成转存后的永久地址。
//
// 生图走 `core/image/imageGateway.ts`（kind='image' 的接入点，后台可配），这一层管的是
// 「哪几个槽位、用什么提示词、图贴回哪里、以及每一种部分失败怎么说出来」。
//
// 四件事是承重的，少一件都是「看起来正常」的失败：
// ① **整页只解析一次接入点、只取一次画风，并把两样都绑死**（`providerId` / `styleId`）。
//    按 kind 解析时同 kind 有第二条会挑「最近更新的那条」，于是一页里的几张图可能出自
//    两个模型 —— 每张单看都不错，翻下来笔触不统一，而没有一处报错。画风同理：一份 deck
//    只能一个 styleId（见 styleLibrary.ts），而**换了画风之后已经配好的那几页不会自动
//    重做**，所以返回里必须带上这次用的 styleId 让界面能对出差异。
// ② **失败的槽位保留占位图**，绝不把 src 换成一个坏地址：破图和「这一格本来是空的」
//    在屏幕上长得一样，而占位图明显是「还没配图」。
// ③ **额度按张扣**（应用额度 + 总额，顺序和 aiGateway 一致），撞墙时**不回滚已经生成的**
//    那几张 —— 那几张的钱已经花了，抛掉整个结果等于让用户再花一遍。
// ④ **`storage='local'` 必须出声**：图落在本机磁盘上，换机器/多实例部署之后那几张就是
//    404，而生成那一刻预览里一切正常。

import { checkAndDeductAppQuota, checkAndDeductQuota, QuotaExceededError } from '../../core/llm/gateway.js';
import { logAIUsage } from '../../core/llm/client.js';
import { generateImage } from '../../core/image/imageGateway.js';
import { resolveImageProvider } from '../../services/aiProviderService.js';
import { assemblePreview, type DeckMeta } from './deckShell.js';
import { rememberAsset } from './assetStore.js';
import { type PptOwner } from './tenant.js';
import { type DesignSpec } from './designSpec.js';
import {
  MAX_SLOTS_PER_PAGE, IMAGE_RATIOS, sizeForRatio, sizeMismatchNote,
  type ImageRatio, type PlannedImage, type PreparedImage,
} from './imageSpec.js';
import { PLACEHOLDERS } from './pageService.js';
import { POSTER_TEXT_ATTR, decodePosterText } from './posterText.js';
import {
  styles, styleById, defaultStyleId, renderStylePrompt, leftoverPlaceholders, personConflictNote,
  requiredPromptParts, IMAGE_MODES, isPageMode, type ImageMode, type PptStyle, type RequiredPromptPart,
} from './styleLibrary.js';
import { computeSpaceHints, spaceHintForLayout } from './imageSpace.js';

// 一页最多几张图定义在 `imageSpec.ts`：规划那一步也要按同一个数出规格，
// 各写一份的话规划会备出 8 张而这里只肯配 6 张，多出来那两张的钱已经花了。
export { MAX_SLOTS_PER_PAGE } from './imageSpec.js';

/** 单张生图的上限。缺省 180 秒 × 6 张 = 一个能把反代拖到超时的请求。 */
const IMAGE_TIMEOUT_MS = 120_000;

export class PptImageError extends Error {}

export interface ImageSlot {
  index: number;
  prompt: string;
  /** 这一格要哪一路模板（页面上的 `data-img-mode`，没写按 concept 算） */
  mode: ImageMode;
  /** 槽位现在的地址（占位图或上一次生成的图） */
  src: string;
  /** 图贴在哪：`src` 属性还是 style 里的 `background-image: url(...)` */
  via: 'src' | 'bg' | 'none';
  ratio: string;
  /**
   * 单图模式（poster）要**印在画面里**的那几行字（`data-poster-text`，代码从这一页扒的原文，
   * 见 `imageModes.posterLines`）。别的路一律空数组 —— 这一句必须一路传到提示词里：
   * 不传的话模板里 `TEXT: {{SLIDE_TEXT}}` 那个占位符原样发出去，模型会自己编几句印在图上，
   * 读起来和这一页的文案一样自然（硬规则 3）。
   */
  text: string[];
  /** 整个开标签的原文（替换时按它找回来） */
  tag: string;
  at: number;
}

export interface FilledImage {
  index: number;
  prompt: string;
  mode: ImageMode;
  ratio: string;
  url?: string;
  error?: string;
  skipped?: boolean;
  storage?: 'cos' | 'local';
  model?: string;
}

export interface FillImagesResult {
  html: string;
  previewHtml: string;
  images: FilledImage[];
  problems: string[];
  /** 撞额度了：前端要显眼提示，而不是当成「有几张失败」 */
  quotaExceeded: boolean;
  provider: { id: string; model: string };
  /** 这一页的图是用哪套画风生的（换了画风之后旧的那几页不会自动重做，界面要对得出来） */
  style: { id: string; name: string };
}

export interface FillImagesContext {
  /** 租户 + 付钱的账号（`tenant.ts`）。**钱记在 `owner.userId` 上**，图记在租户名下。 */
  owner: PptOwner;
  title: string;
  section?: string;
  topic?: string;
  /** true = 已经生成过的那几张也重做（缺省跳过，不重复花钱） */
  force?: boolean;
  /** 画风（S-A ~ S-F）。不给按 md 里标了「（默认）」的那一套算 */
  styleId?: string;
  meta: DeckMeta;
  /** 出处（写进素材库那一行）。不给也照样进库，只是列表上看不出这张是哪份稿子的。 */
  deckId?: string;
  page?: number;
  /** 这一页的蒙版透明度（097）。配完图那一眼的预览要带上它，否则「配了图之后蒙版没了」。 */
  veil?: number;
  /**
   * 他自己改写过整条提示词的那几格（key = 图槽序号，值 = `PlannedImage.fullPrompt`）。
   *
   * **必须传**（调用方从 `plan_json` 的 `imageSpecs` 里取）：不传的话「换一批图」这条路重新
   * 按画风模板拼一条发出去 —— 他在框里逐字改好、备图时也确认过的那条在这条路上完全不生效，
   * 而两条路都回 200、缩略图都换了（只是图又变回原来那个样子）。
   */
  promptOverrides?: Map<number, string>;
}

/**
 * 扫出这一页的图槽位。认的是 `data-img-prompt`（`pageService` 的 prompt 要求每个图元素
 * 都带它）—— 那也是这一步唯一的输入。
 */
export function findImageSlots(html: string): ImageSlot[] {
  const out: ImageSlot[] = [];
  // 开标签里不会出现裸 `>`（属性值都在引号里），所以按标签切就够。
  for (const m of html.matchAll(/<[a-zA-Z][^>]*\sdata-img-prompt="([^"]*)"[^>]*>/g)) {
    const tag = m[0];
    const at = m.index ?? 0;
    const rawMode = tag.match(/\sdata-img-mode="([^"]*)"/)?.[1]?.trim().toLowerCase();
    // 图贴在哪：先看带 `data-img-prompt` 的这个标签自己（`<img src>` / `background-image:url()`），
    // 它自己没有的话**往里找第一张占位图**（见 `innerTarget`）。
    const target = tagTarget(tag, at) || innerTarget(html, tag, at);
    // 认不出的 mode 按 concept 算（模板缺一路的话这一格会静默换成另一路的画法）。
    const mode: ImageMode = (IMAGE_MODES as string[]).includes(rawMode || '') ? (rawMode as ImageMode) : 'concept';
    out.push({
      index: out.length + 1,
      prompt: m[1].trim(),
      mode,
      text: decodePosterText(tag.match(new RegExp(`\\s${POSTER_TEXT_ATTR}="([^"]*)"`))?.[1] || ''),
      src: target?.src ?? '',
      via: target?.via ?? 'none',
      // 整页那两路（背景图 / 单图）**一律 16:9**，不看原来那张占位图是什么比例：背景图变形时
      // 槽位的 `src` 原样留着（可能是 `ph-3x4.svg`），跟着它算的话发出去的 size 是 1024x1536，
      // 回来一张竖图铺满 16:9 的页面 —— 左右两边被裁掉一大半（提示词里还写着「铺满整幅」），
      // 而接口 200、面板上写着「已生成」。
      ratio: isPageMode(mode) ? '16:9 landscape' : ratioOf(target?.src ?? ''),
      // **替换的目标可能不是带 `data-img-prompt` 那个标签**，所以 tag/at 记的是目标那一个
      // （`replaceSlotUrls` 按它切）—— 记外层的话换出来的 html 会把里面那张 img 整个吃掉。
      tag: target?.tag ?? tag,
      at: target?.at ?? at,
    });
  }
  return out;
}

/** 这个标签自己就是图（`<img src>` 或 `background-image:url()`）时的替换目标。 */
function tagTarget(tag: string, at: number): { src: string; via: 'src' | 'bg'; tag: string; at: number } | null {
  const src = tag.match(/\ssrc="([^"]*)"/)?.[1];
  if (src !== undefined) return { src, via: 'src', tag, at };
  const bg = tag.match(/url\(\s*['"]?([^'")\s]+)/)?.[1];
  if (bg !== undefined) return { src: bg, via: 'bg', tag, at };
  return null;
}

/**
 * `data-img-prompt` 写在**外层容器**上、真正的占位图在里面那个 `<img>` 上时，往里找它。
 *
 * 这是踩过的那个坑：模型写出
 * `<div class="p5-visual" style="background-size:cover" data-img-prompt="…"><img src="/ppt-cases/ph-3x4.svg"></div>`
 * —— 外层有 `background-size` 但**没有 `background-image:url()`**，于是这一格被判成
 * `via:'none'`，**备好的图和配好的图永远贴不上去**：接口 200、备图面板上那一格挂着缩略图、
 * problems 里只有一句「既没有 src 也没有 background-image」，而画面里从头到尾是占位图 ——
 * 清掉再挑一张、重新生成一次都一样（`prepare-images` 和 `POST /images` 认的是同一个扫描）。
 * 库里真出现过这样的一页（那一页的 `images_json` 是 `[]`，而 `pending_images_json` 里有图）。
 *
 * 只往**这个元素里面**找（按同名标签配平算出它的闭合位置），且只取第一张：
 * 不配平的话会找到隔壁那一块的图上去，第 1 格的图贴进第 2 格 —— 图文不符而页面渲染完全正常。
 */
function innerTarget(
  html: string,
  openTag: string,
  at: number
): { src: string; via: 'src' | 'bg'; tag: string; at: number } | null {
  const name = openTag.match(/^<([a-zA-Z][\w-]*)/)?.[1]?.toLowerCase();
  // 自闭合 / void 标签没有「里面」
  if (!name || /\/\s*>$/.test(openTag) || name === 'img') return null;
  const inner = at + openTag.length;
  // 找到这个元素的闭合位置（中间可能嵌着同名标签）。
  let depth = 1;
  let end = html.length;
  const re = new RegExp(`<(/?)${name}(?=[\\s/>])`, 'gi');
  re.lastIndex = inner;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    depth += m[1] === '/' ? -1 : 1;
    if (depth === 0) {
      end = m.index;
      break;
    }
  }
  const scope = html.slice(inner, end);
  for (const m of scope.matchAll(/<[a-zA-Z][^>]*>/g)) {
    const t = tagTarget(m[0], inner + (m.index ?? 0));
    // 里面那张图上通常不写 `data-img-prompt`（它在外层），所以这里不挑标签，谁先有图算谁。
    if (t) return t;
  }
  return null;
}

function ratioOf(url: string): string {
  if (url.includes('ph-16x9')) return '16:9 landscape';
  if (url.includes('ph-1x1')) return '1:1 square';
  if (url.includes('ph-3x4')) return '3:4 portrait';
  return '16:9 landscape';
}

/**
 * 六路画法的中文名。**报错/提示里一律用它**，直接写 `backdrop` 的话那句话里夹着一个英文单词，
 * 而界面上这一页写的是「整页背景图」—— 他对不上是不是在说同一件事。
 *
 * **新增一路必须补进来**：漏了的话它掉进末尾那个 `: '概念插画'`，于是装饰背景那一格的提示词
 * 里写着「现在这一页这一格是概念插画」、报错也这么说 —— 他会照着概念插画去改那句话。
 */
export function modeCn(mode: ImageMode): string {
  return mode === 'backdrop' ? '整页背景图'
    : mode === 'poster' ? '单图（字印在图里）'
      : mode === 'decor' ? '装饰背景（垫在整页底下那一层）'
        : mode === 'case' ? '实景/产品'
          : mode === 'data' ? '数据图' : '概念插画';
}

/** `16:9 landscape` → `16:9`（`ratioText` 的反向）。备好的图那一列存的是规划那套字面。 */
function ratioKey(text: string): string {
  return (text || '').trim().split(/\s+/)[0] || '16:9';
}

/**
 * 把规划里的图位清单对齐成**这一页 HTML 里真的排出来的那几个图位**（纯代码，不调 AI）。
 *
 * 两边会对不上的路有两条，而**两条都不报错**：他在「生成前改一下」里换了版式（规划那条
 * L5 是 0 图，换成 L11 之后案例里有图位）、或者生成时按真实内容多排了一块（`buildPrompt`
 * 第 8 条：4 块分类就排 4 栏，每栏一个图位）。清单没跟上的后果全落在**看不见的那一半**：
 * `imageSpecs` 是空的话「这一页详情」里连「规划要 N 张图」那一块都不画（界面上写着
 * 「这一页还没配过图」），`prepare-images` 又按 `specs.length` 卡 index，于是那 4 格
 * **备图/素材库挑/换图一个入口都没有** —— 而画面上就是 4 张占位图，页面渲染完全正常，
 * 他唯一还能点的是「配全部图」（那是真花钱的那条路，且换一张要重花一次）。
 *
 * 四件事是承重的：
 * ① **已有那几格原样留着**（连他改过的 subject 一起）：照 html 的 `data-img-prompt` 覆盖回去
 *    的话，他刚在面板里改的那句提示词会被模型写的那句悄悄换掉（面板上照旧是一句正常的话）。
 * ② **只按条数变化动清单**（`changed`）：条数一样时就算文字不一样也不动 —— 那种情况是他
 *    改了提示词还没重新生成，覆盖等于把他的修改吞掉。
 * ③ **整页那三路（backdrop / poster / decor）的 mode 一律照 html 改回来**（②的例外）：那三个
 *    值规划那一步压根出不来（`normalizeImageSpecs` 只认一格里的三路），只有「改成背景图 /
 *    单图 / 加装饰层」写得进去 —— 所以清单上还挂着它而页面上已经不是了，一定是这一页在那之后
 *    重新生成过（格数没变，①于是把它整条留下来）。留着的后果是**先备图那条路读的是清单**
 *    （`specJob`：没有 html 时 mode / 比例都只能从这里来）：一格 16:9 的气氛底图会按单图那套
 *    模板生成 —— 那条模板要把文字印进画面，而这时候一个字都传不进去（html 还不存在），
 *    于是 `{{SLIDE_TEXT}}` 原样发出去、模型自己编几句印上，出来一张「整页幻灯片」贴进底图槽位：
 *    页面照旧渲染正常，只是标题出现了两遍，一处都不报错（L67 那一页就是这么来的）。
 *    反过来漏认也一样：页面已经是整页背景图而清单还写着概念插画，先备的那张是一张四边留白、
 *    中间一个主体的插画，铺满整页之后主体正好压在标题底下。
 *    **只认「一边是整页那三路」这种对不上**：concept/case/data 三个之间的差异留给①，
 *    那三个规划和面板都改得动，而 `data-img-mode` 少写一个就按 concept 算 —— 跟着 html 改的话
 *    「数据图」会被页面上漏写的那个属性悄悄降成概念插画。
 * ④ **改了必须出声**，并且说清是「按页面实际的图位」改的：静默改的话他上一次看到的 3 格
 *    变成 4 格，会以为自己记错了；而空的 `data-img-prompt` 那几格要单独点名（空提示词生不出
 *    图，那一格会一直停在占位图上，而备图面板上它和别的格子长得一样）。
 */
export function specsFromSlots(
  prev: PlannedImage[],
  slots: ImageSlot[]
): { specs: PlannedImage[]; problems: string[]; changed: boolean } {
  const problems: string[] = [];
  const use = slots.slice(0, MAX_SLOTS_PER_PAGE);
  if (slots.length > use.length) {
    problems.push(
      `这一页排出了 ${slots.length} 个图位，超过一页 ${MAX_SLOTS_PER_PAGE} 格的上限 —— ` +
        `第 ${use.length + 1} 格往后的那几格备不了图（只能走「配全部图」那条真花钱的路），要么重新生成一版少几格的。`
    );
  }
  const reMode: string[] = [];
  const specs: PlannedImage[] = use.map((s, i) => {
    const key = ratioKey(s.ratio);
    const ratio = ((IMAGE_RATIOS as readonly string[]).includes(key) ? key : '16:9') as ImageRatio;
    const p = prev[i];
    if (p) {
      // ③ 整页那三路和一格里那三路对不上：mode 和比例照页面来（subject 不动，那可能是他写的）。
      if (p.mode !== s.mode && (isPageMode(p.mode) || isPageMode(s.mode))) {
        reMode.push(`第 ${i + 1} 格 ${modeCn(p.mode)} → ${modeCn(s.mode)}`);
        return { ...p, mode: s.mode, ratio };
      }
      return p; // ①
    }
    return { subject: s.prompt, mode: s.mode, ratio };
  });
  const changed = specs.length !== prev.length || reMode.length > 0; // ②③
  if (reMode.length) {
    problems.push(
      `规划里这几格的画法和页面上对不上，已经按页面改过来：${reMode.join('、')} —— ` +
        '这一页在切过「背景图 / 单图 / 装饰层」之后重新生成过，清单上还挂着那时候的画法。' +
        '先备图那一步读的是这份清单（那时候还没有 html），不改的话备出来的那张是按另一路画的' +
        '（整页的字会印进图里，或者一张四边留白的插画被铺满整页），而它贴上去照样是一页正常的幻灯片。' +
        '那几格「画什么」那句没动 —— 上一路写的那句现在不一定合用，看一眼再生成。'
    );
  }
  if (specs.length !== prev.length) {
    problems.push(
      `规划里这一页是 ${prev.length} 个图位，页面上实际排出 ${slots.length} 个 —— ` +
        `已按页面上的图位把清单改成 ${specs.length} 格（备图、换图、素材库都认这份清单）。`
    );
    const blank = specs.map((s, i) => (s.subject ? 0 : i + 1)).filter(Boolean);
    if (blank.length) {
      problems.push(
        `新加的第 ${blank.join(' / ')} 格页面上没写要什么图 —— 在「生成前改一下」里给它补一句，` +
          '空着的话那一格生不出图，会一直停在占位图上。'
      );
    }
  }
  return { specs, problems, changed };
}

/**
 * 把**照槽位配好的图**（`POST /images`，真花过钱）记进这一页「备好的图」里。
 *
 * 不记的话：重新生成这一页会把 html 换成一版新的占位图，而回填只认 `pending_images_json`
 * —— 那几张付费图于是**静默消失**，界面上只是「这一页又要配图了」，他只能再花一遍钱
 * （`savePageHtml` 特意不清 `pending_images_json` 就是为了这条路，可这条路上一直没人往里写）。
 *
 * 三件事是承重的：
 * ① **url 相同就原样留着那一条**：素材库挑来的那张（`from:'library'`，没花钱、可能是别的
 *    画风）被覆盖成 `from:'ai'` 的话，「这一页笔触为什么不统一」在界面上就没有线索了。
 * ② **这一次没动到的那几格留着**（失败的、超出图位数的）：那几张也是花过钱的。
 * ③ **跳过的那几格记的是那一页原来的画风**（`prevStyleId`，即 `image_style_id` 那一列），
 *    不是这一次解析出来的那套：换过画风之后旧图会被标成新画风，而它俩长得不一样。
 */
export function keepAsPrepared(
  prev: PreparedImage[],
  filled: FilledImage[],
  ctx: { styleId: string; prevStyleId?: string }
): PreparedImage[] {
  const byIndex = new Map<number, PreparedImage>();
  for (const p of prev) if (p?.url) byIndex.set(Number(p.index), p);
  const at = new Date().toISOString();
  for (const f of filled) {
    if (!f.url || f.error) continue;
    if (byIndex.get(f.index)?.url === f.url) continue; // ①
    byIndex.set(f.index, {
      index: f.index,
      url: f.url,
      prompt: f.prompt,
      mode: f.mode,
      ratio: ratioKey(f.ratio),
      styleId: f.skipped ? ctx.prevStyleId || ctx.styleId : ctx.styleId, // ③
      model: f.model,
      storage: f.storage,
      from: 'ai',
      at,
    });
  }
  return [...byIndex.values()].sort((a, b) => a.index - b.index);
}

/**
 * 规划里的 `16:9` / `1:1` / `3:4` 写成提示词里那句话，和 `ratioOf`（按占位图文件名认）
 * 落在同一套字面上。两条路各写一份的话，同一句 subject 先备图和后配图生出来的图不是一个
 * 构图（一张横的一张方的），而两边都不报错。
 */
export function ratioText(ratio: string): string {
  if (ratio.startsWith('1:1')) return '1:1 square';
  if (ratio.startsWith('3:4')) return '3:4 portrait';
  return '16:9 landscape';
}

/**
 * 画风。**认不出的 styleId 一律拒**，不回落成默认那套（见文件头 ①）：悄悄回落的话用户
 * 选了「国风水墨」拿到的是等距 SaaS 插画，每张单看都不错、没有一处报错。
 */
function resolveStyle(styleId?: string): PptStyle {
  const id = (styleId || defaultStyleId()).trim().toUpperCase();
  const style = styleById(id);
  if (!style) {
    throw new PptImageError(
      `没有画风 ${id} —— 现有的是 ${styles().map((s) => `${s.id} ${s.name}`).join(' / ')}。`
    );
  }
  return style;
}

/** 生图接入点。一次调用只解析一次并按 id 绑死（见文件头 ①）。 */
function resolveProvider(userId: string) {
  const provider = resolveImageProvider(userId);
  if (!provider) {
    throw new PptImageError('未配置生图接入点：请在后台「AI 模型 Provider」里加一条 kind=image 的记录。');
  }
  return { provider, owner: (provider.owner_user_id ? 'dedicated' : 'platform') as 'platform' | 'dedicated' };
}

/**
 * 真的生一张图：扣额度 → 按画风模板渲染提示词 → 生图 → 写 `ai_logs` → 进素材库。
 *
 * 「先备图」和「照槽位配图」两条路共用这一份。各写一份的话其中一条早晚会漏掉扣额度、
 * 漏掉 `ai_logs`（这笔钱在后台一处都看不见）或者漏掉素材库（下次重用时再花一次钱）——
 * 三样漏掉都不报错，那条路看起来完全正常。
 */
async function runOneImage(
  job: {
    subject: string; mode: ImageMode; ratio: string; label: string;
    /** 这一格的留白方向，**代码从版式几何算出来的那一句**（`imageSpace`）。算不出来就不传。 */
    spaceHint?: string;
    /** 单图模式要印进画面的那几行字（代码从这一页扒的原文，见 `ImageSlot.text`）。 */
    slideText?: string[];
    /** 他自己改写的那一整条（有值就原样发，见 `PlannedImage.fullPrompt`）。 */
    fullPrompt?: string;
  },
  ctx: {
    owner: PptOwner; title: string; section?: string; topic?: string; deckId?: string; page?: number;
    /** 这份稿子的设计规范（096）。**不传的话图的配色是默认那套** —— 蓝色系的稿子配出一堆橙图，
     *  每张单看都不错、一处都不报错（见 `styleLibrary.deckColors`）。 */
    design?: DesignSpec;
  },
  style: PptStyle,
  provider: { id: string; model: string },
  providerOwner: 'platform' | 'dedicated'
): Promise<{ url: string; model?: string; storage?: 'cos' | 'local'; problems: string[] }> {
  const problems: string[] = [];
  // 额度按张扣，顺序和 aiGateway 一致（应用额度先扣，专属渠道烧自己的 key 不占总额）。
  // 额度**记在绑定账号上**（`owner.userId`），不是记在租户上：第三方那边的终端用户没有
  // 平台账号，按租户记的话这笔钱在后台一处都对不上人。按 key 的天花板另在 sdkLimits 里。
  checkAndDeductAppQuota(ctx.owner.userId, 'ppt');
  if (providerOwner !== 'dedicated') checkAndDeductQuota(ctx.owner.userId);

  const t0 = Date.now();
  const { prompt, size, problems: promptProblems } = buildImagePrompt(job, ctx, style);
  problems.push(...promptProblems);
  const [img] = await generateImage(prompt, {
    userId: ctx.owner.userId,
    providerId: provider.id,
    n: 1,
    timeoutMs: IMAGE_TIMEOUT_MS,
    // **比例要真发出去**（`size`）：只在提示词里写「16:9 构图」的话，模型爱听就听，
    // 多半还是按自己的默认出一张方图 —— 贴进 16:9 的图槽被 `object-fit:cover` 裁掉上下两条，
    // 画面上是「主体被切了一半」，而接口 200、面板上写着「已生成」。
    size,
    // PPT 的图转存到后台配的「PPT 专用桶」（没配齐就照旧写默认桶）。**这是 PPT 唯一一处生图入口**
    // ——「照槽位配图」和「按规划先备图」都走 runOneImage，漏在别处传的话那一批图会静默回到老桶。
    bucketProfile: 'ppt',
  });
  if (!img?.url) throw new Error('生图接口没有返回图片地址');

  // 尺寸对账：两种「跑成了但不是要的那个尺寸」都必须出声（都只表现成「图被裁掉一块」）。
  if (img.sizeRefused) {
    problems.push(
      `${job.label}：这条接入点不接受 size=${size}（上游原文：${img.sizeRefused}），已经摘掉尺寸重发了一次 ——` +
        '回来那张是它的默认尺寸，贴进图槽可能被裁掉两边。'
    );
  }
  const sizeNote = sizeMismatchNote(size, img.width && img.height ? { width: img.width, height: img.height } : null, job.label);
  if (sizeNote) problems.push(sizeNote);

  // 生图原来完全不进 ai_logs —— 那意味着这笔钱在后台一处都看不见。
  logAIUsage(
    'ppt', 'gen-image', img.model, 0, 0, Date.now() - t0,
    // 要的尺寸和**真回来的**像素都记进日志：只记要的那个的话，「这条接入点不吃 size」
    // 这件事在后台一处都看不见（每条记录都写着 16:9，而图全是方的）。
    `${job.label} ${job.ratio} ${style.id}/${job.mode} size=${size}${img.width && img.height ? ` got=${img.width}x${img.height}` : ''}`,
    ctx.owner.userId, prompt, img.url, img.provider, providerOwner
  );

  // 进素材库（migration 090）。**逐张写**：写在 api 层的话撞额度中断时前面那几张成功的图
  // 进不了库，而它们是真花过钱的。写不进去不能让这一步报错（图已经生成了），但**必须出声**
  // —— 静默的话素材库里少了几张，他只会以为「本来就这样」，下次重用时再花一次钱。
  try {
    rememberAsset(ctx.owner, {
      url: img.url,
      prompt: job.subject,
      mode: job.mode,
      styleId: style.id,
      ratio: job.ratio,
      model: img.model,
      storage: img.storage,
      deckId: ctx.deckId,
      page: ctx.page,
    });
  } catch (e: any) {
    problems.push(
      `${job.label}生成好了，但没进素材库：${e?.message || e}。` +
        '素材库里找不到它，以后想在别的页里重用只能重新生成一次（那是一次真实花费）。'
    );
  }
  return { url: img.url, model: img.model, storage: img.storage, problems };
}

/**
 * 一条**真正会发出去的**提示词 + 要发的 `size`（不调任何接口、不扣额度）。
 *
 * 为什么单独一份：界面上那个「完整提示词」预览走的就是它（`previewSpecPrompt`）。预览另写
 * 一份拼法的话，两边早晚不一致 —— 他照着预览把「留白在左侧」那句改好，而真发出去的还是
 * 旧那句，图回来还是压在标题底下，两处都不报错。所以这里只有一份，生图那条路也从这里拿。
 */
function buildImagePrompt(
  job: {
    subject: string; mode: ImageMode; ratio: string; label: string; spaceHint?: string; slideText?: string[];
    /** 他自己改写的那一整条（有值就原样发，见 `PlannedImage.fullPrompt`）。 */
    fullPrompt?: string;
  },
  // `page` / `deckId` 是**设计手法**那一条的挑选键（`pickDevice`）：不传的话整页那两路
  // 每一页都会拿到同一个手法，而每张图单看都不错、一处都不报错（那就是「每页长得差不多」）。
  ctx: { title: string; section?: string; topic?: string; design?: DesignSpec; page?: number; deckId?: string },
  style: PptStyle
): { prompt: string; size: string; problems: string[] } {
  const problems: string[] = [];
  // 他自己改写过整条：**原样发出去**，一个字都不再拼。改一个字就重新渲染一遍模板的话，
  // 他在框里逐字调好的那条和真发出去的那条不是一回事（而那个框存在的全部意义就是对账）。
  const custom = job.fullPrompt?.trim();
  if (custom) {
    // **每次都出声**：这一格从此不跟画风/模式/配色/subject 走了。不说的话他换了画风、
    // 把这一页切成背景图，回来发现图一点没变，只会一张张重生（每张都是一次真实花费）。
    problems.push(
      `${job.label}用的是你改写过的整条提示词（现在这一页这一格是${modeCn(job.mode)}）——` +
        '换画风、改成背景图/单图、改配色、改上面那句「画什么」都不会再影响它；' +
        '要回到自动拼的那条，在提示词框里点「恢复成自动拼的那条」。'
    );
    const left = leftoverPlaceholders(custom);
    if (left.length) {
      problems.push(`${job.label}你改写的那条里还有 ${left.join(' / ')} —— 这几个字会原样发给模型（那是模板占位符，代码不会再替换）。`);
    }
    // `size` 照旧由代码按比例算（硬规则 3）：他在文字里写「16:9」不等于真发出去的那个值。
    return { prompt: custom, size: sizeForRatio(job.ratio), problems };
  }
  const theme = [ctx.topic, ctx.section, ctx.title].filter(Boolean).join(' · ');
  const prompt = renderStylePrompt(style, job.mode, {
    theme,
    // 只给「画什么」这一句。以前在这里补的 "Single focal subject, safe margins." 现在
    // 分别落在画风模板的 `Subject:` 段（单一主体 + 大小层级）和 `HARD_TAIL`（离边缘留白）里 ——
    // 在这里再补一遍的话它会插在模板句子的中间（`Subject: X. Single focal…, built from …`），
    // 模型读到的是一句断掉的话，而回来的图看着照样正常。
    scene: job.subject,
    ratio: job.ratio,
    design: ctx.design,
    // 「哪一块会被文字压住」一律由代码从版式几何算（`imageSpace` 文件头 ②）：模型自己在
    // `data-img-prompt` 里写的「左侧留白」说的是它想象的版式，主体正好长在标题底下时
    // 页面照旧渲染正常，他只会一张张重生（每张都是一次真实花费）。算不出来就不带这一句。
    spaceHint: job.spaceHint,
    // 单图模式印进画面的那几行字，同样一律是代码扒出来的原文（硬规则 3）。一个字都没传时
    // 模板里 `TEXT: {{SLIDE_TEXT}}` 留着原样发出去，下面那句占位符检查会喊 —— 静默让模型
    // 自己编的话，印在图上那几句读起来和这一页的文案一样自然，而它不是这一页写的东西。
    slideText: job.slideText,
    // 这一页用哪一条设计手法（md §6.1，代码按页码轮着挑）。**两条路都要传**：
    // 漏一条的话那条路上全份用的是同一个手法（或者预览和真发出去的不是同一条）。
    pageKey: ctx.page,
    deckKey: ctx.deckId,
  });
  // 模板里的 `<…>` / `{{…}}` 是给人看的填空说明，漏换的那几个会原样发给模型
  // （它会照着「本页主题，1句」画），而回来的图看着就是「这张不太对」。
  const left = leftoverPlaceholders(prompt);
  if (left.length) {
    problems.push(`${job.label}的提示词里还剩没换掉的占位符 ${left.join(' / ')} —— 这几个字会原样发给模型（画风模板改过？）。`);
  }
  // 单图那条尾巴写死了「不要出现人物」，而这句「画什么」里点了人时两句话打架（见
  // `personConflictNote`）—— 不说的话回来一张没有人的图，看起来只是「模型没听懂」。
  const person = personConflictNote(job.mode, job.subject);
  if (person) problems.push(`${job.label}：${person}`);
  return { prompt, size: sizeForRatio(job.ratio), problems };
}

/**
 * 「先备图」那条路上这一格的 job（画什么 / 哪一路 / 比例 / 留白方向 / 要印的字）。
 *
 * **生图和「看完整提示词」共用这一份**：各拼一次的话预览里那句留白提示可能来自另一条版式，
 * 而他是照着预览调提示词的 —— 图回来还是压在标题底下，两处都不报错。
 *
 * **这一页已经有 html 时，「哪一路」「什么比例」「印哪几行字」一律以 html 为准**，规划里那两个
 * 字段只在 html 还没生成时才算数。「改成背景图 / 改成单图」改的只是 html 上的 `data-img-mode`
 * （规划里那条照旧写着 concept —— 模式一律从 html 现算，不存成一列，见 `pageImageMode`）：
 * 跟着规划走的话，他切完模式再点「AI 生成」或者去看那条完整提示词，拿到的还是概念插画那套
 * 模板（主体居中、四边留白、还写着「不许有字」），而界面上这一页明明写着「整页背景图」——
 * 备图那次是一次真实花费，回来那张贴上去就是「怎么看都不像背景」/「单图模式里一个字都没印」，
 * 一处都不报错。只有「换一批图」那条路读的是 html，于是同一格两条路生出来的东西不是一回事。
 */
function specJob(spec: PlannedImage, ctx: SpecImageContext) {
  const html = ctx.pageHtml?.trim() ? ctx.pageHtml : '';
  const slot = html ? findImageSlots(html)[ctx.index - 1] : undefined;
  return {
    subject: spec.subject,
    mode: slot?.mode ?? spec.mode,
    ratio: slot ? slot.ratio : ratioText(spec.ratio),
    label: `第 ${ctx.page || '?'} 页第 ${ctx.index} 格`,
    // 有 html 就按 html 的几何算（和「换一批图」那条路同一个来源）；没有才拿这条版式的 demo
    // 片段量一遍。背景图那一路尤其明显：变形之后文字压的是整页，而 demo 片段说的是分屏那一半。
    spaceHint: (html ? computeSpaceHints(html).get(ctx.index) : spaceHintForLayout(ctx.layoutId, ctx.index))?.prompt,
    // 单图模式要印进画面的那几行字（代码从这一页的 `data-poster-text` 扒的原文，硬规则 3）。
    // 不传的话模板里 `{{SLIDE_TEXT}}` 原样发出去，模型自己编几句印在图上（读起来像这一页的文案）。
    slideText: slot?.text,
    // 他自己改写过的那一整条（有值就原样发，上面那几样一概不再拼）。
    fullPrompt: spec.fullPrompt,
  };
}

export interface SpecImageContext {
  owner: PptOwner;
  index: number;
  title: string;
  section?: string;
  topic?: string;
  styleId?: string;
  deckId?: string;
  page?: number;
  /** 这份稿子的设计规范（096）：图的配色跟着它走，不传就是默认那套。 */
  design?: DesignSpec;
  /**
   * 这一页**将要**用的版式（他在「生成前」挑的那条，没挑就是规划里那条）。留白提示靠它从
   * demo 片段量出来 —— 不传的话先备的这张没有留白指示、而配图那条路有，同一格两条路生出来
   * 的构图不是一回事（见 `spaceHintForLayout`）。
   */
  layoutId?: string;
  /**
   * 这一页**已经生成的那份 html**（还没生成就不传）。模式 / 比例 / 要印的字都从它现算 ——
   * 见 `specJob` 上那段：不传的话「改成背景图 / 改成单图」在备图和提示词预览这两条路上**完全
   * 不生效**，而两处显示的都是一条读起来很正常的概念插画提示词。
   */
  pageHtml?: string;
}

/**
 * 这一格**真正会发出去的那条提示词**（不生图、不扣额度、不写 `ai_logs`）。
 *
 * 界面上「完整提示词」那一段显示的就是它。为什么必须由服务端算：他在对话框里能改的只有
 * 「画什么」那一句，而发出去的是画风模板 + 配色 + 留白方向 + 尺寸拼起来的一整条 ——
 * 前端自己拼一份近似的话，他照着那份调完，真发出去的还是另一条（图回来「还是不对」，
 * 而两边都不报错）。`problems` 里那几条（没换掉的占位符）也要照原样显示出来。
 */
export function previewSpecPrompt(
  spec: PlannedImage,
  ctx: SpecImageContext
): {
  prompt: string; styleId: string; styleName: string; mode: ImageMode; ratio: string; size: string;
  /** 这一条是他改写过的那一整条（`true`）还是代码现拼的（`false`）。 */
  custom: boolean;
  problems: string[];
} {
  const style = resolveStyle(ctx.styleId);
  const job = specJob(spec, ctx);
  const r = buildImagePrompt(job, ctx, style);
  // `mode` 要回出去给界面显示：这一条是「切模式生效了没」唯一看得见的地方 —— 只回提示词的话
  // 他得自己逐句读那一大段中文去分辨是背景图模板还是概念插画模板（两段都读起来很正常）。
  // `custom` 同理：框里那一大段两种情况下长得一样，不回的话「这条是我改过的、已经不跟画风了」
  // 在界面上没有任何痕迹（而那个「恢复成自动拼的那条」按钮该不该亮也要靠它）。
  return {
    prompt: r.prompt, styleId: style.id, styleName: style.name,
    mode: job.mode, ratio: job.ratio, size: r.size,
    custom: !!spec.fullPrompt?.trim(),
    problems: r.problems,
  };
}

/**
 * 「AI 重写整条」那一步要**核对、少了就接回去**的那几段（尾巴 / 比例 / 要印的字 / 留白方向）。
 *
 * 和生图、和预览同一份 `specJob`：另算一份的话核对用的是另一条版式的留白句（或者规划里那个
 * 还写着 concept 的模式），于是「它被改掉了」永远成立 —— 每次重写都在末尾接一句**别的版式**
 * 的留白提示，而那一整条读起来完全通顺，图回来只是「主体又压在标题底下了」。
 */
export function specPromptParts(spec: PlannedImage, ctx: SpecImageContext): RequiredPromptPart[] {
  const job = specJob(spec, ctx);
  return requiredPromptParts(job.mode, { ratio: job.ratio, slideText: job.slideText, spaceHint: job.spaceHint });
}

/**
 * 按规划里那一条规格现生一张图，**存在那一页上但不进 html**（先备图，HTML 还没生成）。
 *
 * 和「照槽位配图」共用 `runOneImage`（额度 / ai_logs / 素材库都在那里），差别只有一处：
 * 这里没有槽位，所以比例来自规划（`spec.ratio`）而不是占位图的文件名。
 */
export async function generateSpecImage(
  spec: PlannedImage,
  ctx: SpecImageContext
): Promise<{ image: PreparedImage; problems: string[] }> {
  if (!spec.subject.trim()) {
    // 生了也不知道画的是什么（提示词里只剩画风模板），那是一次白花的钱。
    throw new PptImageError(`第 ${ctx.index} 格的规划里没写画什么，没法备图 —— 重新规划一次才会有这句话。`);
  }
  const style = resolveStyle(ctx.styleId);
  const { provider, owner } = resolveProvider(ctx.owner.userId);
  const job = specJob(spec, ctx);
  const r = await runOneImage(job, ctx, style, provider, owner);
  const problems = [...r.problems];
  if (r.storage === 'local') {
    problems.push(
      '这张图存在本机磁盘上（COS 没配好，落在 /uploads 下）。换机器或者多实例部署之后它是 404，' +
        '而现在预览里一切正常 —— 要长期用请在后台把 COS 配好再重新生成。'
    );
  }
  return {
    image: {
      index: ctx.index,
      url: r.url,
      prompt: spec.subject,
      // 记**真正生成时用的**那一路和那个比例（`job`，可能是从 html 读回来的背景图/单图），
      // 不是规划里那两个字段：记规划那份的话备图面板上这一格写着「概念插画 · 3:4」而图是
      // 一张 16:9 的整页背景，素材库里那一行也跟着错 —— 以后按 mode/比例挑图时挑出来的
      // 是另一种图，而每一处都显示得很正常。
      mode: job.mode,
      ratio: ratioKey(job.ratio) as ImageRatio,
      styleId: style.id,
      model: r.model,
      storage: r.storage,
      from: 'ai',
      at: new Date().toISOString(),
    },
    problems,
  };
}

function isPlaceholder(url: string): boolean {
  return PLACEHOLDERS.includes(url);
}

export async function fillPageImages(html: string, ctx: FillImagesContext): Promise<FillImagesResult> {
  const slots = findImageSlots(html);
  if (!slots.length) {
    // 回一个「成功、0 张」的话界面上和「配好图了」分不开，而这一页一张图都没换。
    throw new PptImageError(
      '这一页没有图槽位（没有带 data-img-prompt 的元素），没有可以生成的图。' +
        '想配图就换一个带图的版式再重新生成这一页。'
    );
  }
  if (slots.length > MAX_SLOTS_PER_PAGE) {
    throw new PptImageError(
      `这一页有 ${slots.length} 个图槽位，超过一次 ${MAX_SLOTS_PER_PAGE} 张的上限（一张图几十秒，再多这个请求会被反代掐断）。` +
        '换一个图少一点的版式，或者把这一页拆成两页。'
    );
  }

  // 画风和接入点都整页取一次、按 id 绑死（见文件头 ①）。
  const style = resolveStyle(ctx.styleId);
  const { provider, owner } = resolveProvider(ctx.owner.userId);
  // 留白方向整页算一次（key 和槽位序号一致）。算得出来的格子才有这一句 —— 算不出来的那几格
  // 不许兜一句「主体居中」（`imageSpace` 文件头 ②：编一句自信的错方向比没有这一句更糟）。
  const hints = computeSpaceHints(html);

  const problems: string[] = [];
  const images: FilledImage[] = [];
  const newUrl = new Map<number, string>();
  let quotaExceeded = false;
  let localCount = 0;

  for (const slot of slots) {
    if (slot.via === 'none') {
      // 生成了也贴不上去 —— 那就是白花一次钱，而回复里会写「已生成」。
      problems.push(`第 ${slot.index} 个图槽位既没有 src 也没有 background-image url()，图贴不上去，这一格跳过了。`);
      images.push({ index: slot.index, prompt: slot.prompt, mode: slot.mode, ratio: slot.ratio, error: '没有可以写回的图片地址' });
      continue;
    }
    if (!slot.prompt) {
      problems.push(`第 ${slot.index} 个图槽位的 data-img-prompt 是空的（模型没写要什么图），这一格跳过了。`);
      images.push({ index: slot.index, prompt: '', mode: slot.mode, ratio: slot.ratio, error: 'data-img-prompt 为空' });
      continue;
    }
    if (!ctx.force && !isPlaceholder(slot.src)) {
      // 已经是生成过的图了。默认不重做 —— 重做一次是一次真实花费。
      images.push({ index: slot.index, prompt: slot.prompt, mode: slot.mode, ratio: slot.ratio, url: slot.src, skipped: true });
      continue;
    }

    try {
      const r = await runOneImage(
        {
          subject: slot.prompt,
          mode: slot.mode,
          ratio: slot.ratio,
          label: `第 ${slot.index} 张`,
          spaceHint: hints.get(slot.index)?.prompt,
          slideText: slot.text,
          // 他改写过整条的那几格原样发（和备图那条路同一份来源，见 `promptOverrides`）。
          fullPrompt: ctx.promptOverrides?.get(slot.index),
        },
        // 设计规范搭 `meta` 走（外壳也要它）—— 不往下传的话这条路生出来的图是默认配色，
        // 而「先备图」那条路是对的：同一份稿子里两批图不是一套色，谁都不报错。
        { ...ctx, design: ctx.meta.design },
        style,
        provider,
        owner
      );
      problems.push(...r.problems);
      newUrl.set(slot.index, r.url);
      if (r.storage === 'local') localCount++;
      images.push({
        index: slot.index, prompt: slot.prompt, mode: slot.mode, ratio: slot.ratio,
        url: r.url, storage: r.storage, model: r.model,
      });
    } catch (e: any) {
      if (e instanceof QuotaExceededError) {
        // 已经生成的那几张不回滚（钱花了），停在这里并说清楚 —— 接着往下跑只会拿到
        // 一串一样的错误，而中间夹着刚才那几张的成功。
        quotaExceeded = true;
        problems.push(
          `AI 额度用完了（${e.dailyLimit ? `上限 ${e.dailyLimit} 次/天` : ''}），第 ${slot.index} 张起没再生成。` +
            '已经生成的那几张已经贴上去了，明天 0 点重置后接着点「补齐这一页的图」。'
        );
        images.push({ index: slot.index, prompt: slot.prompt, mode: slot.mode, ratio: slot.ratio, error: '额度已用完' });
        break;
      }
      // 每种失败（模型名不对 / 余额不足 / 配的是视频模型 / 回了 200 但没有图）解法完全
      // 不同，所以带上游原文，不合成一句「生图失败」。
      const msg = e?.message || String(e);
      problems.push(`第 ${slot.index} 张没生成出来（这一格还是占位图）：${msg}`);
      images.push({ index: slot.index, prompt: slot.prompt, mode: slot.mode, ratio: slot.ratio, error: msg });
    }
  }

  if (localCount) {
    problems.push(
      `有 ${localCount} 张图存在本机磁盘上（COS 没配好，落在 /uploads 下）。` +
        '换机器或者多实例部署之后这几张会 404，而现在预览里一切正常 —— 要长期用请在后台把 COS 配好再重新生图。'
    );
  }

  const filled = replaceSlotUrls(html, slots, newUrl);
  return {
    html: filled,
    // 单页预览不带页脚（同 pageService）。
    previewHtml: assemblePreview(filled, ctx.meta, ctx.veil || 0),
    images,
    problems,
    quotaExceeded,
    provider: { id: provider.id, model: provider.model },
    style: { id: style.id, name: style.name },
  };
}

/**
 * 把**备好的**图贴进刚生成的这一页（`index` 第 n 张 → 第 n 个图位）。不调 AI、不花钱。
 *
 * 五件事是承重的：
 * ① **地址由代码写回**，从头到尾不经过模型（硬规则 3）—— 让模型照抄 url 的话它会漏字符、
 *    改域名、或者复用上一页那张，而页面上是一张正常的图（或一个破图，和「这一格空着」
 *    长得一样）。
 * ② **按序号贴**，不按「哪一格还空着」找 —— 空格子优先的话，第 2 张会掉进第 1 格
 *    （图文不符，而页面渲染完全正常）。
 * ③ **多出来的那几张要点名说没地方贴**（模型少写了图位）：静默丢的话那几张的钱没有一处会说，
 *    而他只看到这一页图少了。
 * ④ **贴不上的（没有 src / 没有 background-image url）也要说** —— 那一格会停在占位图上。
 * ⑤ **比例不一致不进 problems**（改由那一格的标签一直显示，见下面那段注释）。
 */
export function applyPreparedImages(
  html: string,
  prepared: PreparedImage[]
): { html: string; used: FilledImage[]; problems: string[] } {
  const problems: string[] = [];
  const used: FilledImage[] = [];
  if (!prepared.length) return { html, used, problems };

  const slots = findImageSlots(html);
  const newUrl = new Map<number, string>();
  for (const img of [...prepared].sort((a, b) => a.index - b.index)) {
    const slot = slots[img.index - 1];
    if (!slot) {
      problems.push(
        `第 ${img.index} 格备好的图没地方贴（这一页只排出了 ${slots.length} 个图位）—— 那张图还在素材库里（/ppt/assets），` +
          '重新生成这一页、或者把它挪到别的页上再用。'
      );
      continue;
    }
    if (slot.via === 'none') {
      problems.push(`第 ${img.index} 个图位既没有 src 也没有 background-image url()，备好的图贴不上去，这一格还是占位图。`);
      continue;
    }
    // 比例对不上（3:4 的格子贴进一张 16:9）**不进 problems**：那是他自己在挑图那一刻
    // 看着「素材库挑的 · 16:9 landscape」点下去的，报成「要注意」的话每挑一张都多一条，
    // 真正要看的那几条（版式塌了 / 没地方贴 / 还是占位图）会被冲下去。这件事改由那一格
    // 的标签一直显示（`PptPlan.vue` 的 `spec-meta` / `prep-meta`：格子的比例和这张图的
    // 比例并排写着，不一致时跟一句「会被裁掉一块」）—— 完全不显示的话构图缺一块看起来
    // 像模型画得不好。
    newUrl.set(slot.index, img.url);
    used.push({
      index: slot.index,
      prompt: img.prompt,
      mode: img.mode,
      ratio: slot.ratio,
      url: img.url,
      storage: img.storage as 'cos' | 'local' | undefined,
      model: img.model,
    });
  }

  // 没贴上图的图位要报出来：占位图在预览里就是「这一页设计得比较空」，
  // 而他以为备过图的这一页已经齐了，直接去拼整份/导出。
  // **只数还是占位图的那几格**：这个函数也用在「改一张图就当场贴进已经生成好的那一页」
  // 那条路上（`prepare-images`），那里别的格子可能早就配过真图了 —— 一并说成「还是占位图」
  // 的话他会去点「补齐这一页的图」，那是白花一次钱。
  const left = slots
    .filter((s) => !newUrl.has(s.index) && PLACEHOLDERS.includes(s.src))
    .map((s) => s.index);
  if (left.length) {
    problems.push(
      `第 ${left.join(' / ')} 个图位还是占位图（那几格没有备好的图）—— 点「补齐这一页的图」会现生（每张一次真实花费）。`
    );
  }
  return { html: replaceSlotUrls(html, slots, newUrl), used, problems };
}

/**
 * 把备好的图贴进**已经生成好的那一页**（换/备一张图当场生效，不用重新生成 —— 那是一次
 * 真实调用，还会连版式和文案一起重排）。纯函数：算出新 html 和新的 `images_json`，
 * 落库由调用方做（`api/ppt.ts` 的 `pastePrepared`）。
 *
 * 三件事是承重的：
 * ① 贴上去的那几格**只覆盖同序号那条配图记录，别的格子留着** —— 整份覆盖的话，之前
 *    `POST /images` 真花钱配的那几张在界面上凭空变成「没配图」，他会再点一次「换一批图」，
 *    那是重花一遍。
 * ② **清掉的那张还留在画面里要说一句**：清掉的只是「备着的图」，缩略图那一格已经变成
 *    「未备」而画面里那一张还在 —— 两处对不上，一处都不报错。
 * ③ 「哪几格还是占位图」由 `applyPreparedImages` 报，它只数**真的**还是占位图的格子
 *    （这里别的格子往往已经配过真图了）。
 */
export function pasteIntoBuiltPage(
  html: string,
  prepared: PreparedImage[],
  current: { images: FilledImage[]; droppedUrl?: string }
): { html: string; images: FilledImage[]; used: FilledImage[]; problems: string[] } {
  const fill = applyPreparedImages(html, prepared);
  const problems = [...fill.problems];
  if (current.droppedUrl && fill.html.includes(current.droppedUrl)) {
    problems.push(
      '清掉的只是「备着的图」—— 画面里那一格还是刚才那张。要换掉就在这一格挑一张/生一张，或者重新生成这一页。'
    );
  }
  const kept = (current.images || []).filter(
    (x) => !fill.used.some((u) => u.index === Number(x?.index))
  );
  return {
    html: fill.html,
    images: [...kept, ...fill.used].sort((a, b) => Number(a.index) - Number(b.index)),
    used: fill.used,
    problems,
  };
}

/**
 * 自由改造（`ai-remake`）加/删图槽之后，把这一页的配图记录（`images_json`）按**新 html 里的
 * 图槽顺序**重新对齐。纯函数，只认 html —— `findImageSlots` 数出来的那个序号就是配图那一步、
 * 备好的图回填、面板上「配图 2/3 张」共用的同一个序号（硬规则 3：这个数在代码里算）。
 *
 * 不对齐的话两种后果都是「界面上一切正常」：
 * ① 一张配好的真图被改造删掉之后记录还在 —— 面板上照旧写着「配图 1/1 张」并挂着那张缩略图，
 *    而画面里那几格全是占位图。他会当这一页已经配完，直接去拼整份 / 导出。
 * ② 在前面插进一个新图槽之后序号整体后移 —— 第 1 格那条记录指的是现在第 2 格里那张图，
 *    下一次贴备好的图（`pasteIntoBuiltPage` 按同序号覆盖）会把图落到隔壁那一格上：
 *    图文不符，而页面渲染完全正常、接口 200。
 *
 * 对齐靠**按地址找它现在在第几格**，不是按序号原地留着：留下来的那张图地址一个字都没变
 * （原文是打了码整段还回来的），所以地址是唯一可靠的锚。找不到 = 这张图不在这一页了，
 * 整条丢掉 —— 留着一条 url 指向页面上没有的图就是 ① 那种谎报。
 */
export function realignImageRecords(
  html: string,
  images: FilledImage[]
): { images: FilledImage[]; dropped: FilledImage[]; changed: boolean } {
  const slots = findImageSlots(html);
  // 同一个地址可能贴在两格上（同一张图用在两处），所以按地址排一队、先来的先占。
  const free = new Map<string, number[]>();
  for (const s of slots) {
    if (!s.src || PLACEHOLDERS.includes(s.src)) continue;
    free.set(s.src, [...(free.get(s.src) || []), s.index]);
  }
  const kept: FilledImage[] = [];
  const dropped: FilledImage[] = [];
  let moved = false;
  for (const rec of [...(images || [])].sort((a, b) => Number(a?.index) - Number(b?.index))) {
    const to = rec?.url ? free.get(rec.url)?.shift() : undefined;
    if (to === undefined) {
      // url 空的那几条（生图失败 / 这一格跳过了）也一起丢：它说的是上一版那几格的事，
      // 留着的话面板上「配图 1/3 张」那个分母是旧版式的格子数。
      dropped.push(rec);
      continue;
    }
    if (to !== Number(rec.index)) moved = true;
    kept.push({ ...rec, index: to });
  }
  return { images: kept, dropped, changed: moved || dropped.length > 0 };
}

/** 从后往前替换（改前面会让后面记下来的位置全部错位）。 */
export function replaceSlotUrls(html: string, slots: ImageSlot[], urls: Map<number, string>): string {
  let out = html;
  for (const slot of [...slots].reverse()) {
    const url = urls.get(slot.index);
    if (!url) continue;
    const tag =
      slot.via === 'src'
        ? slot.tag.replace(/(\ssrc=")[^"]*(")/, (_m, a, b) => `${a}${url}${b}`)
        : slot.tag.replace(/url\(\s*['"]?[^'")\s]+['"]?\s*\)/, () => `url(${url})`);
    out = out.slice(0, slot.at) + tag + out.slice(slot.at + slot.tag.length);
  }
  return out;
}

// 提示词照**画风模板**渲染（`runOneImage` 里的 `renderStylePrompt`），不在这里拼一段自己的
// 画风描述：拼一份的话「换画风」这个下拉换的是别的东西 —— 图的笔触压根不跟着变，
// 而每张图单看都不错、没有一处报错。
