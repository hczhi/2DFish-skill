// 自由改造：他选中这一页里的一块，说一句「改成两列卡片，每张配一张小图」，模型**可以重排结构、
// 新写文案、加图槽**，不受案例库那条版式的约束（`aiEditService.ts` 那条路是反过来的：文案打码、
// 只许改 inline style，适合「间距拉开一点」这种微调）。
//
// 放开的每一条都换成「出声」，不是换成静默（硬规则 1）。但**只报他看着屏幕发现不了的那几种**
// —— 报「新增了 3 个图槽」「删掉了 1 张图」这种他一眼就看见的，只会让那几条提示整体变成
// 一堵他一律略过的墙，于是真正要紧的那两条（下面这两条）跟着被略过：
// - **丢掉原文**放开了 —— 但丢了哪几句要逐句列出来。不列的话那一块少一句话，读起来完全正常。
// - **新写文案**放开了 —— 但新写了哪几句要逐句列出来。他要的是排版，模型顺手替他改了一句
//   文案的话，屏幕上是一页完整正常的幻灯片。
//
// 收紧的那几条一个都不能放（放了就是「页面照样渲染、读起来正常」的失败）：编一个不存在的记号
// （屏幕上留着 `@@T9@@`）、编一个类名（那一块回到默认流式布局）、写死颜色（换肤那天不跟着变）、
// 编一个图片地址（破图和「这一格本来是空的」长得一样）、自己写 `data-eid`（撞上别处那一段，
// 改一句字落到另一块上）、`position:fixed`（脱出 1920×1080 那层缩放，导出的文件里飞到画面外）。

import { jsonGateway, jsonFailMessage } from '../../core/llm/parseJson.js';
import { templateClasses, templateVars } from './deckShell.js';
import { PLACEHOLDERS } from './pageService.js';
import { findImageSlots } from './imageService.js';
import {
  findRegionByPath, maskRegion, unmaskRegion, eidsIn, domTree, CJK_RE, PageEditError,
  assignMissingEids, maxEidNumber, isVoidTag, hardcodedColors,
} from './pageEdit.js';

/** 自由改造要吐一整块新结构（可能比原来长几倍），剩下的是留给思维链的空间（硬规则 2）。 */
const MAX_REMAKE_TOKENS = 9000;

/** 他那句要求的上限。比微调那条（400）宽：自由改造这一步他会连着描述版面、配图、层级。 */
export const MAX_REMAKE_INSTRUCTION = 1000;

export interface AiRemakeInput {
  /** 库里那一整页（`<section>`），改完的整页原样返回 */
  html: string;
  /** 从 `<section>` 数下来的孩子下标路径（空数组 = 整页） */
  path: number[];
  /** 前端认为这一块里有哪几段文字 —— 用来核「他框住的和这边算出来的是同一块」 */
  eids: string[];
  instruction: string;
}

export interface AiRemakeResult {
  html: string;
  /** 一句话摘要（模型那句 + 代码数出来的那几个数） */
  summary: string;
  /** 「改了什么」逐条，每一条都是放开之后必须出声的那种改动 */
  notes: string[];
  region: string;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

export async function aiRemakeRegion(input: AiRemakeInput, userId: string): Promise<AiRemakeResult> {
  const instruction = (input.instruction || '').trim();
  if (!instruction) {
    throw new PageEditError('没说要改成什么样 —— 写一句（比如「改成两列卡片，每张配一张小图」）再点。');
  }
  if (instruction.length > MAX_REMAKE_INSTRUCTION) {
    throw new PageEditError(
      `这句要求有 ${instruction.length} 字，上限 ${MAX_REMAKE_INSTRUCTION} 字 —— 再长的话把它拆成两次改。`
    );
  }
  const picked = findRegionByPath(input.html, input.path);

  // 他框住的那一块和这边按路径算出来的必须是同一块（同 `aiEditRegion`）：不核的话他框住的是
  // 这一块、AI 改的是隔壁那一块，而返回的摘要和画面都读得通。
  const want = [...input.eids].sort().join(',');
  const got = [...eidsIn(picked.html)].sort().join(',');
  if (want !== got) {
    throw new PageEditError(
      '你选中的那一块和库里那一页对不上（这一页在这期间重新生成过，或者在别处改过）。这次没改也没花额度，刷新一下重新选。'
    );
  }

  // 他点中的是一张图（或别的自闭合标签）时**自动往外挪一层**，并在摘要里说出来。
  // 不挪的话「把这张大图拆成三张」这件事无论怎么改 prompt 都不可能成功：`<img>` 里装不了
  // 三个 `<img>`，而下面「还得是一整块、最外层标签不变」那两条会把每一次尝试都拒掉 ——
  // 他看到的是一句「模型回的不是一整块」，读起来像模型不行，于是一直重试（每次花一次额度）。
  const widened = isVoidTag(picked.name) && input.path.length > 0;
  const region = widened ? findRegionByPath(input.html, input.path.slice(0, -1)) : picked;
  if (isVoidTag(region.name)) {
    throw new PageEditError(
      `你选中的是一个 <${region.name}>，它里面装不了东西 —— 按 ↖ 选到外面那一层（那一块的容器）再点自由改造。这次没改也没花额度。`
    );
  }

  // 原文照旧打码。自由改造允许它**丢掉**某一句（下面会逐句报出来），但不允许它**改写**：
  // 手里只有 `@@T3@@` 的话，「把这句润色一下」这件事它做不到（硬规则 3 的做法，不是靠 prompt 求）。
  const { masked, tokens } = maskRegion(region.html);

  const allowedClasses = new Set<string>([...templateClasses(), ...classesIn(input.html)]);
  const knownVars = templateVars();
  // 变量名和类名**列给它**，不让它猜（硬规则 3）：它猜 `--c-text` / `--c-muted` 这种名字，
  // 每猜一次就是一次「校验没过、白花一次额度」，而他看到的只是一句「用了不存在的样式变量」。
  const r = await jsonGateway<{ html?: string; summary?: string }>(
    () => ({
      messages: [{
        role: 'user',
        content: buildPrompt(masked, region.name, instruction, {
          vars: [...knownVars].sort(),
          classes: [...new Set(classesIn(input.html))],
        }),
      }],
      temperature: 0.5,
      max_tokens: MAX_REMAKE_TOKENS,
    }),
    // 不指定 tier、也不发 response_format（同这个模块其余几处）：平台渠道可能压根没有 strong
    // 那一档，指定它只是让人以为「换成强模型了」。
    { userId, source: 'ppt', operation: 'ai-remake-region', noThinking: true }
  );
  if (!r.parsed?.html) {
    throw new PageEditError(
      jsonFailMessage('这一块的改造', {
        raw: r.raw,
        finish: r.finish,
        reasoningTokens: r.reasoningTokens,
        budget: MAX_REMAKE_TOKENS,
        noThinkingRequested: r.noThinkingRequested,
      })
    );
  }

  const edited = String(r.parsed.html).trim();
  const notes = validateRemadeRegion(edited, {
    tokens,
    masked,
    regionName: region.name,
    original: region.html,
    allowedClasses,
    knownVars,
  });

  // 新写出来的那几段字要拿到编号才双击改得动，编号由**代码**接着页面上最大那个往后排
  // （硬规则 3：让模型自己编的话它会写 `data-eid="t1"`，撞上这一页别处那一段）。
  // 补了几个编号**不报** —— 那几段字他在屏幕上看得见，双击就能改，没什么要提醒的。
  const restored = unmaskRegion(edited, tokens);
  const { html: withEids } = assignMissingEids(restored, maxEidNumber(input.html));

  const html = input.html.slice(0, region.from) + withEids + input.html.slice(region.to);
  const said = String(r.parsed.summary || '').trim().replace(/\s+/g, ' ').slice(0, 120);
  // 摘要里那几个数是代码数出来的（硬规则 3）：模型说「保留了原有文案」这句话是免费的。
  let summary = `${said || '重排了这一块'}（原文 ${tokens.size} 处里留下 ${keptTokens(edited, tokens)} 处）`;
  if (widened) {
    // 「改的其实不是你点的那一层」这件事进**摘要**而不是进 notes：它每次都会出现（点图必然
    // 走这一支），当成一条提示的话它会把 notes 里那两条要紧的挤下去；但完全不说也不行 ——
    // 他点的是一张图、回来却是隔壁那几段字也变了，不说的话那看起来像 AI 乱改。
    const cls = rootClasses(region.html);
    summary +=
      `。你点中的是那张图本身，图里装不了别的东西 —— 这次改的是它外面那一层 ` +
      `<${region.name}${cls.length ? ` class="${cls.join(' ')}"` : ''}>`;
  }
  return { html, region: region.name, summary, notes, usage: r.usage };
}

/** 这一页里已经用过的类名（模型只许用这些 + template 里定义过的）。 */
function classesIn(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/class="([^"]*)"/g)) out.push(...m[1].trim().split(/\s+/).filter(Boolean));
  return out;
}

/** 最外层那个标签上的类名（`class="…"` 出现的第一处就是它 —— 上面已经确认只有一个顶层标签）。 */
function rootClasses(html: string): string[] {
  const open = /^<[a-zA-Z][^>]*>/.exec(html)?.[0] || '';
  return (/\sclass="([^"]*)"/.exec(open)?.[1] || '').trim().split(/\s+/).filter(Boolean);
}

/**
 * 带着占位图、却没落进任何图槽的那几个标签（缺 `data-img-prompt`）。在配图那条链上它们等于
 * 不存在 —— 而画面上就是一张图。背景图（`background-image:url(占位图)`）也算，所以按标签扫、
 * 不逐个查 `<img>`。
 */
function orphanPlaceholders(html: string): string[] {
  const slotAt = new Set(findImageSlots(html).map((s) => s.at));
  return [...html.matchAll(/<[a-zA-Z][^>]*>/g)]
    .filter((m) => PLACEHOLDERS.some((p) => m[0].includes(p)) && !slotAt.has(m.index ?? -1))
    .map((m) => m[0]);
}

function keptTokens(html: string, tokens: Map<string, string>): number {
  return [...tokens.keys()].filter((k) => html.includes(k)).length;
}

/** 文本节点里的中文段（图片提示那种属性值不算 —— 那一条单独报「新增了图槽」）。 */
function cjkTexts(html: string): string[] {
  return html
    // 标签换成一个正文里不可能出现的分隔符再切（用空格切的话一句话中间有空格就被拆成两句，
    // 报出来是「新写了 3 句」而其实是 1 句）。**写成转义**，源码里不要放真的 NUL 字节 ——
    // 那会让整份文件被 grep / diff 当二进制，改这个文件时一行都看不见。
    .replace(/<[^>]*>/g, '\u0000')
    .split('\u0000')
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter((s) => s && CJK_RE.test(s));
}

/** 只差空白 = 没改（模型经常把缩进和换行重排一遍）。 */
function squash(s: string): string {
  return s.replace(/>\s+</g, '><').replace(/\s+/g, ' ').trim();
}

/** 一句话报出来时截短（整段几十字的话那条提示自己就变成一堵墙，他不会读）。 */
function brief(s: string, n = 18): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

export interface RemakeValidateCtx {
  tokens: Map<string, string>;
  /** 发出去那一版（打完码的）—— 用来分辨「输出里这句中文是新写的还是本来就在属性里」 */
  masked: string;
  regionName: string;
  original: string;
  allowedClasses: Set<string>;
  knownVars: Set<string>;
}

/**
 * 回来那一段的校验。**抛出来的每一条都是「不拦就悄悄改错东西」**，返回的每一条都是
 * 「放开了、但必须说出来」—— 两者的区别只有一个判据：他看着屏幕能不能发现。
 */
export function validateRemadeRegion(html: string, ctx: RemakeValidateCtx): string[] {
  if (!html) throw new PageEditError('模型没回内容，这一块没改。再试一次。');
  const notes: string[] = [];

  // ① 还得是一整块、最外层标签不变。多包一层的话定位类留在原来那一层上，画面看起来只是
  //    「这块位置不对」；换掉外层标签则会让这一块跑到别的位置。
  const roots = domTree(html);
  if (roots.length !== 1 || roots[0].start !== 0 || roots[0].end !== html.length) {
    throw new PageEditError(
      `模型回的不是一整块（数出来 ${roots.length} 个顶层标签，或者有标签没闭合）—— 直接贴回去会把这一页的结构切断。这次没改。` +
        `如果你要的是「把这一块拆成好几块」，按 ↖ 选到外面那一层（能装下这几块的那个容器）再改。`
    );
  }
  if (roots[0].name !== ctx.regionName) {
    throw new PageEditError(
      `模型把最外层从 <${ctx.regionName}> 换成了 <${roots[0].name}>：定位和尺寸挂在原来那一层上，换掉之后这一块会跑到别的位置。这次没改。`
    );
  }
  // 最外层那几个类名也得留着。**只比标签名拦不住「原封不动地多包一层」**（外面套一个
  // `<div class="col">` 之后顶层还是一个 `<div>`）：这一块在页面上的位置和尺寸是父级按这个
  // 类名给的，换掉/包起来之后里面的内容一个字都没变、只是整块跑到别的地方或者塌成内容高度。
  const rootWas = rootClasses(ctx.original);
  const rootNow = new Set(rootClasses(html));
  const rootLost = rootWas.filter((c) => !rootNow.has(c));
  if (rootLost.length) {
    throw new PageEditError(
      `模型动了最外层的类名（少了 ${rootLost.join(' / ')}，可能是在外面又包了一层）：这一块的位置和尺寸是父级按这几个类名给的，少了之后整块会跑位或者塌掉，而里面的内容读起来完全正常。这次没改 —— 新样式写在里面。`
    );
  }

  // ② 记号。**丢掉是允许的**（自由改造本来就可能删掉一段），但重复 = 同一句话出现两遍，
  //    编一个 = 还原不回来，屏幕上留着 `@@T9@@` 这种字样。
  const seen = new Map<string, number>();
  for (const m of html.matchAll(/@@[A-Z]+\d+@@/g)) seen.set(m[0], (seen.get(m[0]) || 0) + 1);
  const dup = [...seen].filter(([k, n]) => n > 1 && ctx.tokens.has(k)).map(([k]) => k);
  const made = [...seen.keys()].filter((k) => !ctx.tokens.has(k));
  if (dup.length || made.length) {
    const why = [
      dup.length ? `${dup.length} 处原文出现了两遍（${dup.slice(0, 3).join(' ')}）` : '',
      made.length ? `编了 ${made.length} 个不存在的记号（${made.slice(0, 3).join(' ')}）` : '',
    ].filter(Boolean).join('；');
    throw new PageEditError(`模型把被挡住的原文弄坏了（${why}）—— 这一块没改，再试一次。`);
  }
  // 丢掉的图**不报**：少一张图他一眼就看见（那一块的画面整个变了）。丢掉的**字**要报 ——
  // 三句里少一句，剩下两句照样排得整整齐齐，读起来完全正常。
  const lostText: string[] = [];
  for (const [k, v] of ctx.tokens) {
    if (!seen.has(k) && k.startsWith('@@T')) lostText.push(v);
  }
  if (lostText.length) {
    notes.push(
      `丢掉了 ${lostText.length} 段原文：${lostText.slice(0, 3).map((s) => `「${brief(s)}」`).join('、')}` +
        `${lostText.length > 3 ? ' 等' : ''} —— 不是你要的就再改一次（这几句只在这一版里没了，库里那份提纲还在）。`
    );
  }

  // ③ `data-eid`。**只许留着原来那几个**：编一个出来会撞上这一页别处那一段（改一句字落到
  //    另一块上），而两块都是正常的文字。新写的那几段不写 eid，由代码补。
  const eidWas = new Set(eidsIn(ctx.original));
  const eidNow = eidsIn(html);
  const eidBad = eidNow.filter((e) => !eidWas.has(e));
  const eidDup = eidNow.filter((e, i) => eidNow.indexOf(e) !== i);
  if (eidBad.length || eidDup.length) {
    throw new PageEditError(
      `模型自己编了编辑标记（data-eid：${[...new Set([...eidBad, ...eidDup])].slice(0, 4).join(' / ')}）：` +
        '那几段字会和这一页别处的字撞号，改一句落到另一块上，而画面上一点异样都没有。这一块没改。'
    );
  }
  const eidLost = [...eidWas].filter((e) => !eidNow.includes(e));
  if (eidLost.length && eidLost.length !== lostText.length) {
    // 记号还在、eid 没了 = 那句话留着但从此双击改不动（屏幕上一点异样都没有）。丢掉整段字
    // 的那几处上面已经报过，这里只报「字留着、编辑标记没了」这种。
    notes.push(`有 ${eidLost.length} 段字的编辑标记没了（${eidLost.slice(0, 4).join(' ')}）—— 那几段暂时双击改不动，重新生成这一页会补回来。`);
  }

  // ④ 脚本 / 样式表 / 事件属性 / position:fixed。前两个影响整份 deck 的每一页或在导出的
  //    文件里真的执行；`fixed` 脱出 1920×1080 那层缩放 —— 预览里位置还差不多，导出之后飞到画面外。
  if (/<(script|style)[\s>]/i.test(html)) {
    throw new PageEditError('模型写了 <script> 或 <style>（那玩意儿会影响整份 deck 的每一页，或者在导出的文件里真的执行），这一块没改。');
  }
  if (/\son[a-z]+\s*=/i.test(html)) {
    throw new PageEditError('模型写了 onclick 这类事件属性（会在预览和导出的文件里真的执行），这一块没改。');
  }
  if (/position\s*:\s*fixed/i.test(html)) {
    throw new PageEditError('模型用了 position:fixed —— 它脱出这一页 1920×1080 的缩放，预览里看着还行，导出之后那一块会飞到画面外。这一块没改，改用 absolute。');
  }

  // ⑤ 类名。编出来的类名不报错，那一块只是回到默认流式布局 —— 看起来像「版式塌了」。
  //    自由改造要的新样子一律写 inline style（那条路不需要类名）。
  const unknown = new Set<string>();
  for (const c of classesIn(html)) if (!ctx.allowedClasses.has(c)) unknown.add(c);
  if (unknown.size) {
    throw new PageEditError(
      `模型编了类名（${[...unknown].slice(0, 5).join(' / ')}）：模板里没有这几条样式，那几块会变成没排版的文字堆在一起。这一块没改 —— 新样式得写成 inline style（要么用这一页里已经有的类名）。`
    );
  }

  // ⑥ 颜色。写死的色值换肤那天不跟着变；编出来的变量名会让浏览器把整条声明丢掉。
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
    // 报错里要列出**有哪些**：只说「不存在」的话他只能再点一次让模型再猜一个名字（`--c-text`
    // 猜完猜 `--c-muted`），而每一次都是一次真实花费。
    throw new PageEditError(
      `模型用了不存在的样式变量（${[...new Set(badVars)].slice(0, 4).join(' / ')}）：浏览器会把整条声明丢掉，那一块的颜色/间距直接没有，而页面照样渲染。这一块没改。` +
        `能用的只有这些：${[...ctx.knownVars].sort().join(' ')}`
    );
  }

  // ⑦ 图片地址。真图是「生成这一页的图」那一步换进来的，模型只能写占位图（硬规则 3）：
  //    编一个地址出来在屏幕上和「这一格本来是空的」长得一样。
  const urls = [...html.matchAll(/(?:\ssrc=|url\()\s*["']?([^"')\s>]+)/g)].map((m) => m[1]);
  const badUrl = urls.filter((u) => !PLACEHOLDERS.includes(u) && !ctx.original.includes(u));
  if (badUrl.length) {
    throw new PageEditError(
      `模型自己写了图片地址（${[...new Set(badUrl)].slice(0, 3).join(' / ')}）：那是一张破图，而破图和「这一格本来是空的」长得一样。` +
        `这一块没改 —— 新图只能先放占位图（${PLACEHOLDERS.join(' / ')}）+ data-img-prompt。`
    );
  }

  // ⑧ 新加的图必须让配图那一条链**扫得到**。认的是 `data-img-prompt`（`findImageSlots`），
  //    少了它的那一处在整条链上等于不存在：备图面板上没有这一格（那一整块按规划的清单画）、
  //    「配全部图」不算它、生图那一步跳过它 —— 画面上那一格永远停在占位图上，而它看起来
  //    就是一张图/一块留白。
  //    按**占位图有没有落进某个图槽**算，不逐个查 `<img>`：`data-img-prompt` 写在外层容器上、
  //    占位图在里面那个 `<img>` 上是对的写法（`findImageSlots` 的 innerTarget），逐个查会把它拒掉；
  //    反过来只查 `<img>` 的话**背景图**（`background-image:url(占位图)`）整个漏过去 ——
  //    踩过的就是这一次：画面上多了一张背景图，而备图面板上那一格压根不出现。
  //    只拦**这次新多出来的**那几处：这一页可能本来就带着一处（这条检查上线前存下来的背景图
  //    就是），按总数拦的话那一页从此每次改造都撞同一句「模型加了 1 处图」—— 而那处不是模型
  //    加的、他改一句话也绕不开，只能一次次重试，每次花一次额度。本来就有的那几处交给
  //    面板上那条横幅，并且下面 prompt 里会让这次顺手补上。
  const orphanNow = orphanPlaceholders(html).length;
  const orphanWas = orphanPlaceholders(ctx.original).length;
  if (orphanNow > orphanWas) {
    throw new PageEditError(
      `模型新加了 ${orphanNow - orphanWas} 处图但没写 data-img-prompt（要什么图）：配图那一步扫的就是这个属性，` +
        '缺了它那一格在备图面板上压根不出现、生图也跳过它，永远停在占位图上 —— 而画面上它看起来就是一张图。这一块没改。' +
        `（背景图要写成 <div style="background-image:url(${PLACEHOLDERS[0]});background-size:cover" data-img-prompt="要什么图">）`
    );
  }
  // 加了几个图槽**不报**：占位图上印着「图槽位 16:9」，他在屏幕上看得清清楚楚。

  // ⑨ 新写的文案。放开了（自由改造要加一栏就得有字），但要逐句列出来：他要的是排版，
  //    模型顺手替他写了一句的话，屏幕上是一页完整正常的幻灯片。
  const before = cjkTexts(ctx.masked);
  const fresh = cjkTexts(html).filter((s) => !before.includes(s));
  if (fresh.length) {
    notes.push(
      `AI 新写了 ${fresh.length} 句文案：${fresh.slice(0, 4).map((s) => `「${brief(s)}」`).join('、')}` +
        `${fresh.length > 4 ? ' 等' : ''} —— 双击就能改成你的说法。`
    );
  }

  // ⑩ 原样退回来。这一条最像成功：摘要照样写着「重排了这一块」、校验全过、库里也写了，
  //    而画面上一个像素都没变 —— 他会以为是自己没看出差别，然后再点一次（再花一次额度）。
  if (!notes.length && squash(html) === squash(ctx.masked)) {
    notes.push('模型把这一块原样退回来了，画面上一个像素都没变（这一次的额度已经花掉了）—— 换一句更具体的说法再试，比如「排成三列，每列一张 1:1 的小图 + 一行标题」。');
  }

  return notes;
}

function buildPrompt(
  masked: string,
  regionName: string,
  instruction: string,
  palette: { vars: string[]; classes: string[] }
): string {
  return `你在**重新设计**一页幻灯片里的一块。这一页是 1920×1080 的固定坐标系，这一块的外层尺寸由页面给定。

【这一块现在是这样】
${masked}

【他要你做的】
${instruction}

【能用的样式变量（只有这些，别的都不存在）】
${palette.vars.join(' ')}

【这一页已经在用的类名（想复用现成卡片/栏目的样子就用这几个；别的类名一律不许写）】
${palette.classes.join(' ')}

【你可以自由做的】
- 重排结构：加/删/嵌套元素，改成多列、卡片、时间轴、叠图…… 不必照原来那条版式。
- 新样式一律写 inline style（\`style="…"\`），想怎么排都行。
- 需要新文字时可以写中文（会逐句列给他确认）。
- 需要新图时写 \`<img src="/ppt-cases/ph-16x9.svg" data-img-prompt="这一格要什么图（中文一句话）" data-img-mode="case">\`
  （比例三种：\`ph-16x9.svg\` 横 / \`ph-1x1.svg\` 方 / \`ph-3x4.svg\` 竖；\`data-img-mode\` 三种：case 实景 / concept 概念 / data 信息图）。
- 要**背景图**（图垫在文字下面）时写在容器上，\`data-img-prompt\` 一样不能少：
  \`<div style="background-image:url(/ppt-cases/ph-16x9.svg);background-size:cover;background-position:center" data-img-prompt="要什么图" data-img-mode="case">…</div>\`
  —— 少了 \`data-img-prompt\` 那一格生图那一步扫不到，永远停在占位图上。
${
  orphanPlaceholders(masked).length
    ? `- 这一块里现在有 ${orphanPlaceholders(masked).length} 处占位图挂在元素上却**没有** \`data-img-prompt\`（配图那一步扫不到它，
  所以它永远停在占位图上）。这次顺手给它补上 \`data-img-prompt="这一格要什么图（中文一句话）" data-img-mode="case"\`，
  写在带 \`background-image\` / \`src\` 那个元素本身上。\n`
    : ''
}
【硬规则，违反任何一条这次改造都会被整段丢掉】
1. \`@@T1@@\` \`@@IMG1@@\` \`@@A1@@\` 这种记号是他原来的文案和图片。可以挪位置、他要求删的可以删，
   但**不能改写、不能重复、不能编新的**。
2. 类名只能用上面列出来的那些。**要新样式就写 inline style，不许编类名**（模板里没有那条样式）。
3. 颜色只能用上面列出来的那几个变量（\`var(--c-ink)\` 这种），**不许写 #hex / rgb()，也不许用没列出来的变量名**
   （阴影和蒙版那种半透明黑白除外：\`rgba(0,0,0,.08)\` \`rgba(255,255,255,.6)\` 可以）
   —— 列表里没有 \`--c-text\` \`--c-muted\` 这类名字，写了浏览器会把整条声明丢掉。
4. 图片地址只能是上面那三个占位图，**不许写别的地址**（真图是下一步生成后替换进来的）。
5. \`data-eid="…"\` 原样留在它现在所在的元素上（那一段被删掉时它跟着删）；**新元素不要写 data-eid**。
6. 不许写 \`<script>\` / \`<style>\` / \`onclick\` 这类属性，不许用 \`position:fixed\`。
7. 只回这一块，最外层还是 \`<${regionName}>\` **且原来那几个类名一个不少**（它的位置和尺寸靠这几个类名），
   不要在外面多包一层、不要回整页。内容不能超出这一块原来的地盘。

【只回这个 JSON，不要别的字】
{"html":"改完的这一块（一整段 HTML，写成一行，不要换行）","summary":"一句话说你改成了什么样"}`;
}
