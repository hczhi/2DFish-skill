// 排版规划：一份提纲 → 每页挑一个版式。**整份一次调用**，不逐页问。
//
// 为什么一次给全部页：相邻页去重（连续 ≤2 页同版式）、封面/章节页走全幅、整份的节奏
// 都是**跨页**约束。逐页问的话模型看不到上一页选了什么，出来的是「每页单看都合理、
// 整份翻下来极其单调」的 deck —— 而那种 deck 的每一页都挑不出错，用户只会觉得
// 「生成的东西没什么设计感」，无从下手。
//
// 这一步只挑版式、不写 HTML（HTML 是下一步，只带那一条的 buildText）。

import { jsonGateway, jsonFailMessage, parseJsonArrayItems } from '../../core/llm/parseJson.js';
import {
  layouts,
  layoutById,
  PAGE_ROLES,
  type PageRole,
  type PptLayout,
} from './layoutLibrary.js';
// 停用的那几条**只在「给模型挑的清单」这一层过滤掉**（`layoutById` 照旧认它们，
// 否则老稿子里用过停用版式的那几页重新生成会直接 400）。见 layoutState.ts 文件头。
import { disabledLayoutIds, enabledLayouts, enabledLayoutsForRole } from './layoutState.js';
import { normalizeImageSpecs, IMAGE_RATIOS, MAX_SLOTS_PER_PAGE, type PlannedImage } from './imageSpec.js';
import { outlineFitProblem, longformLayouts } from './outlineFit.js';
import { IMAGE_MODES } from './styleLibrary.js';

/** 提纲上限。只拒不截 —— 截掉后半截的话用户以为整份都规划过了。 */
export const MAX_OUTLINE_CHARS = 12000;
/** 一份 deck 的页数上限。同上，超了明确拒绝。 */
export const MAX_PAGES = 45;

// 一页的 JSON 约 150-250 字符（≈200 token），45 页就是 9000 token 上下。**这个数和
// `MAX_PAGES` 是一对**：只把页数放开、不放这个预算的话，那种四十几页的提纲每次都断在
// 第三十几页（`finish_reason=length`，会喊出来但不重试 —— 同一个 body 断在同一处），
// 于是「上限 45 页」在实际里根本到不了，而报错说的是「把提纲拆短」。
// 这个数是留给**思维链**的空间（硬规则 2）：`noThinking: true` 之后它才真的全给 JSON。
// 调大不花钱（按实际用量计费），调小只是把偶发的长思维链变成确定性截断。
const MAX_PLAN_TOKENS = 10000;

/**
 * 一页最多留几条备选版式。多于这个数等于把整份清单又抄了一遍，「排在最前面的是规划挑的」
 * 就不再是信息了 —— 而下拉看起来完全正常。
 */
const MAX_ALTS = 3;

export interface PlannedPage {
  /** 页码由**代码**按数组顺序给（硬规则 3：会算错的格式不交给模型）。 */
  page: number;
  /** 所属模块（进 `.slide-header .kicker`），模型给的 */
  section: string;
  /**
   * 这一页是什么页（封面 / 目录 / 章节 / 内容 / 结尾），模型给的。
   *
   * **只用来核对版式挑得对不对**（`kindWarnings`），不参与生成 —— 有了它，「标成章节扉页
   * 却挑了四栏矩阵」才有得可查：不核的话那一页会排成一页正文，每一页单看都合法、
   * 整份就是少了过渡感，而没有一处会说。认不出来的词按「没标」处理（不猜）。
   */
  kind: PageRole | '';
  title: string;
  points: string[];
  /** 版式 id，必须是库里那 22 条之一 */
  layoutId: string;
  /** 挑它的理由 —— 用户核「挑得准不准」只能靠这句话 */
  why: string;
  /**
   * 2-3 条备选版式 id（生成前那个对话框里排在下拉最前面）。**代码校验过**：不在库里的
   * 丢掉、和 `layoutId` 重复的丢掉、最多 `MAX_ALTS` 条 —— 一个编出来的编号留在下拉里，
   * 他挑中之后是一句 400，而他会以为「这个版式坏了」。老 deck 的 plan_json 里没有这个
   * 字段（前端那边是可选的，缺了就只有全部 22 条）。
   */
  alts: string[];
  /**
   * 这一页要几张图。**由 `imageSpecs.length` 算出来**（模型给的那个数字只在它没给规格
   * 时才用）—— 两个数各自存的话，「规划要 2 张」和下面列出来的 3 张规格会对不上，
   * 而界面上两处都读起来正常。
   */
  images: number;
  /**
   * 每张图画什么。**这一步就要定下来**，不然配图那一步唯一的输入是生成 HTML 那一次
   * 写出来的 `data-img-prompt` —— 也就是必须先出 HTML 才知道要画什么，于是页面第一次
   * 显示出来必然是缺图的占位版，而「重新生成这一页」会把图连带清掉、要再花一遍钱。
   *
   * 空数组有两种含义，要靠 `images` 区分：`images === 0` = 这一页真的不配图；
   * `images > 0` = 模型只给了张数没说画什么（那时 problems 里有一条）。
   */
  imageSpecs: PlannedImage[];
  /**
   * 这一页对应的**提纲原文**（逐字），由**代码**按 `outlineRange` 从提纲里切出来（硬规则 3）。
   *
   * 为什么要有它：`points` 是模型在一次调用里给 30 多页一起写的**摘要**，一页只摊到几十个
   * token —— 提纲里「1.1 那六行地产数据 + 一句结论」必然被压成一句话。而生成 HTML 那一步
   * 从头到尾只拿到 `title` + `points`，原文一个字都没进过它的 prompt，所以丢掉的细节
   * **不可能**在后面补回来：界面上表现成「这一页本来就这么短」，一处都不报错。
   *
   * 让模型把原文抄进 JSON 是不行的（抄的过程就是又一次压缩，而且 token 直接翻倍），
   * 所以模型只给行号，切的动作在代码里。
   */
  outlineText: string;
  /**
   * 这一页认领的提纲行号区间（含两端，1 起）。`null` = 模型没给/给的越界 —— 那一页只能
   * 靠 `points` 生成，problems 里会点名（不点名的话那几页和「原文本来就这么短」一样）。
   */
  outlineRange: [number, number] | null;
  /** 版式名 / 中文标题 / 是否全幅，从库里补上（模型不许自己说这些） */
  layoutName: string;
  layoutTitle: string;
  fullbleed: boolean;
  demoUrl: string;
}

export interface PlanResult {
  pages: PlannedPage[];
  /**
   * 每一处「结果能用但有话要说」。**必须显示出来**：这一步的失败形态全是
   * 「一份看起来完整的规划」——编出来的版式名、被截断只规划了一半、连续五页同版式。
   */
  problems: string[];
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

export class PlanError extends Error {}

export async function planDeck(outline: string, userId: string): Promise<PlanResult> {
  const text = outline.trim();
  if (!text) throw new PlanError('提纲是空的，没有可以规划的内容。');
  if (text.length > MAX_OUTLINE_CHARS) {
    throw new PlanError(
      `提纲 ${text.length} 字，超过 ${MAX_OUTLINE_CHARS} 字上限。请拆成两份分别规划 —— 截掉后半截的话你会以为整份都规划过了。`
    );
  }

  const lib = enabledLayouts();
  // 行号是**代码**编的，切原文也在代码里 —— prompt 里那份带号提纲和这里切的是同一个数组。
  const outlineLines = text.split('\n');
  const prompt = buildPrompt(outlineLines, lib);

  const { parsed, raw, finish, reasoningTokens, usage, noThinkingRequested } = await jsonGateway<any[]>(
    () => ({ messages: [{ role: 'user', content: prompt }], temperature: 0.3, max_tokens: MAX_PLAN_TOKENS }),
    // 不指定 tier（走 default）：平台渠道可能压根没有 strong 那一档（回落 default），
    // 指定它只是让人以为「换成强模型了」；这次也不发 response_format，格式靠 prompt + jsonGateway。
    { userId, source: 'ppt', operation: 'plan-deck', noThinking: true },
    { mode: 'array', attempts: 2 }
  );

  const truncated = finish === 'length';
  // 截断时数组没闭合，但断点之前那几页是完整的 —— 救回来并**说出来**（整份丢掉的话
  // 表现是「规划失败」，而用户其实只差最后几页）。只在 length 这一种情况下救：
  // 正常路径下接受半截数组等于把模型胡说也当结果。
  const rows: any[] = parsed ?? (truncated ? parseJsonArrayItems(raw) : []);
  if (!rows.length) {
    throw new PlanError(
      jsonFailMessage('排版规划', { raw, finish, reasoningTokens, budget: MAX_PLAN_TOKENS, noThinkingRequested })
    );
  }
  if (rows.length > MAX_PAGES) {
    throw new PlanError(`模型规划出 ${rows.length} 页，超过 ${MAX_PAGES} 页上限。请把提纲拆开 —— 截到 ${MAX_PAGES} 页的话后面那些页你看不到，而界面上是一份「完整」的规划。`);
  }

  const problems: string[] = [];
  const off = disabledLayoutIds();
  if (truncated) {
    problems.push(
      `模型返回被截断（finish_reason=length${reasoningTokens ? `，思维链占 ${reasoningTokens} token` : ''}），` +
        `只规划到第 ${rows.length} 页。后面的页没有规划 —— 把提纲拆短一点再来一次。`
    );
  }

  const pages: PlannedPage[] = [];
  const badAlts: string[] = [];
  /** 页码 → 行号区间为什么用不了。汇总进 `coverageWarnings` 那一条。 */
  const badRanges = new Map<number, string>();
  rows.forEach((row, i) => {
    const rawId = String(row?.layoutId ?? row?.layout ?? '').trim().toUpperCase();
    const layout = layoutById(rawId);
    const title = clean(row?.title) || `（第 ${i + 1} 页没给标题）`;
    if (!layout) {
      // 编一个不存在的版式名读起来完全正常（`L23` / `hero-split` 都很像真的）。
      // **不静默替换成某一条**：替换之后这一页排出来也好看，只是不是任何一个
      // 经过验证的版式，而用户以为是模型挑的。
      problems.push(`第 ${i + 1} 页「${title}」：模型给的版式 ${rawId || '(空)'} 不在案例库里，这一页没有版式。`);
      return;
    }
    const page = pages.length + 1;
    const img = normalizeImageSpecs(row?.images, `第 ${page} 页「${title}」`);
    problems.push(...img.problems);
    if (off.has(layout.id)) {
      // 清单里压根没有它（`buildPrompt` 只给启用的那几条），模型是从别处抄来的 ——
      // 不静默替换（替换之后这一页也好看，只是不是他挑的），照旧用它并说一句。
      problems.push(
        `第 ${pages.length + 1} 页「${title}」用的 ${layout.id} 是**已停用**的版式（给模型的清单里没有它）——` +
          '这一页照旧按它排。要换掉就在这一页上换版式，或者在版式案例库里把它重新启用。'
      );
    }
    const alt = normalizeAlts(row?.alts ?? row?.alternatives, layout.id, off);
    badAlts.push(...alt.bad);
    const src = normalizeSourceLines(row?.lines ?? row?.outlineLines ?? row?.sourceLines, outlineLines.length);
    // 逐页刷一条的话，模型压根没给 `lines` 时是 30 条一模一样的警告，把真正要看的那几条
    // （漏了哪几段）全冲下去 —— 汇总成一条，但**按成因分组**（没给 / 越界 / 不是数字 三种
    // 解法完全不同，合成一句「行号有问题」等于指错方向，硬规则 1）。
    if (src.reason) badRanges.set(page, src.reason);
    pages.push({
      page,
      section: clean(row?.section) || clean(row?.kicker),
      kind: normalizeKind(row?.kind),
      title,
      points: Array.isArray(row?.points) ? row.points.map((p: any) => clean(p)).filter(Boolean) : [],
      layoutId: layout.id,
      why: clean(row?.why) || clean(row?.reason),
      alts: alt.ids,
      images: img.count,
      imageSpecs: img.specs,
      // 逐字切，**不用**模型回传的任何文本：让它把原文写进 JSON 的话，抄的过程就是又一次
      // 悄悄的压缩（数字被改、六行合成两行），而那一段读起来完全通顺。
      outlineText: src.range ? outlineLines.slice(src.range[0] - 1, src.range[1]).join('\n').trim() : '',
      outlineRange: src.range,
      layoutName: layout.name,
      layoutTitle: layout.title,
      fullbleed: layout.fullbleed,
      demoUrl: layout.demoUrl,
    });
  });

  if (!pages.length) {
    throw new PlanError(`模型规划的 ${rows.length} 页全都用了案例库里没有的版式（${problems.join('；')}）。`);
  }

  problems.push(
    ...coverageWarnings(pages, outlineLines, badRanges),
    ...fitWarnings(pages),
    ...repeatWarnings(pages),
    ...kindWarnings(pages),
    ...missingWhy(pages),
    ...altWarnings(pages, badAlts)
  );
  return { pages, problems, usage };
}

/** 重排一页图位的 token 预算（6 条规格 ≈ 600 字符）。同上是留给思维链的空间（硬规则 2）。 */
const MAX_REPLAN_TOKENS = 2000;

export interface ReplanImagesInput {
  page: number;
  section?: string;
  title: string;
  points: string[];
  /** 他现在挑的那条版式（`setup_layout_id` → 规划那条）。认不出一律抛错。 */
  layoutId: string;
  notes?: string;
  deckNotes?: string;
}

/**
 * 按**这一页的真实内容 + 他现在挑的那条版式**重排图位（`imageSpecs`）。
 *
 * 为什么要有这一步：图位清单是整份规划那一次定的，而版式是他后来在生成前那个对话框里换的
 * —— 两者从此对不上，且**一处都不报错**：备图面板照旧列着规划那 1 格（他换到 L11 那种三图
 * 版式之后还是只备 1 张），生成时 prompt 里「正好 1 个图位」又压着案例里的三个图位，
 * 出来是一页排得下但空了两格的幻灯片，读起来就像「这个版式本来就这样」。
 *
 * 两条规则和 `planDeck` 里那条**故意不一样**（案例只是参考，不是模子）：
 * ① **张数按内容定**：内容是 4 块分类就 4 张，哪怕案例里画的是 3 张。照案例的张数配的话，
 *    第 4 块要么没有图、要么和第 3 块挤在一格，而每一版单看都是一页正常的幻灯片。
 * ② **比例按版式那个位置的形状定**（竖槽位配 16:9 会被裁掉两边，图本身没问题、只是构图缺一块）。
 */
export async function replanPageImages(
  input: ReplanImagesInput,
  userId: string
): Promise<{ specs: PlannedImage[]; layoutId: string; problems: string[]; usage?: PlanResult['usage'] }> {
  const layout = layoutById(input.layoutId.trim().toUpperCase());
  if (!layout) {
    // 静默回落成规划那条的话，重排出来的图位是照另一个版式算的 —— 他换的那个版式一格都没生效。
    throw new PlanError(
      `版式 ${input.layoutId || '(空)'} 不在案例库里，没法按它重排图位（库里有 ${layouts().length} 条）。`
    );
  }
  const prompt = buildReplanPrompt(input, layout);
  const { parsed, raw, finish, reasoningTokens, usage, noThinkingRequested } = await jsonGateway<any[]>(
    () => ({ messages: [{ role: 'user', content: prompt }], temperature: 0.3, max_tokens: MAX_REPLAN_TOKENS }),
    { userId, source: 'ppt', operation: 'replan-images', noThinking: true },
    { mode: 'array', attempts: 2 }
  );
  // 这里**不救半截数组**（和 planDeck 不同）：一页最多 6 条，断在中间意味着后面几格丢了，
  // 而丢掉的那几格在界面上和「这一页就只要 2 张图」一模一样。
  if (!Array.isArray(parsed)) {
    throw new PlanError(
      jsonFailMessage(`第 ${input.page} 页重排图位`, {
        raw, finish, reasoningTokens, budget: MAX_REPLAN_TOKENS, noThinkingRequested,
      })
    );
  }
  const img = normalizeImageSpecs(parsed, `第 ${input.page} 页「${input.title}」`);
  return { specs: img.specs, layoutId: layout.id, problems: img.problems, usage };
}

function buildReplanPrompt(input: ReplanImagesInput, layout: PptLayout): string {
  const notes = [
    input.deckNotes?.trim() ? `整份统一：${input.deckNotes.trim()}` : '',
    input.notes?.trim() ? `这一页额外（和上一条冲突时按这一条）：${input.notes.trim()}` : '',
  ].filter(Boolean);
  return `你是演示稿的排版设计师。任务：给**这一页**定下要哪几张图（图位清单）。

## 硬规则
1. **张数按这一页的真实内容定，不是照版式案例抄。** 版式里那几个图位只是参考：内容分成 4 块就给 4 张，只有一个主视觉就给 1 张，纯文字页给 \`[]\`。一页最多 ${MAX_SLOTS_PER_PAGE} 张。
2. 顺序 = 图在这一页里从上到下、从左到右出现的顺序（后面按这个序号把图贴进去，顺序换了就会贴到讲别的事情的那一格）。
3. 每张写清三样：
   - \`subject\`：**画什么**，一句话、具体到能直接照着画（「等距视角的城市算力机房，蓝紫冷色」），不要写「一张配图」「相关插图」这类空话；
   - \`mode\`：\`concept\`（抽象概念插画）/ \`case\`（具体场景、产品、人物）/ \`data\`（信息图、图表感）；
   - \`ratio\`：\`${IMAGE_RATIOS.join('` / `')}\` —— 按这个版式里那个位置的形状选（竖位配横图会被裁掉两边）。
4. 不要写页码、不要写 HTML、不要解释。

## 这一页的内容
所属模块：${input.section || '（无）'}
标题：${input.title}
要点：
${input.points.length ? input.points.map((p) => `- ${p}`).join('\n') : '（没有给要点，按标题判断）'}

## 这一页用的版式（**只作排版参考**：它的图位数量不是硬要求）
${layout.selectText}
${notes.length ? `\n## 额外要求（他自己写的，优先于上面的建议）\n${notes.join('\n')}\n` : ''}
## 输出格式
只输出一个 JSON 数组，不要任何解释文字。每个元素：
{"subject":"画什么，一句话","mode":"${IMAGE_MODES.join(' | ')}","ratio":"${IMAGE_RATIOS.join(' | ')}"}
不要图就输出 \`[]\`。
`;
}

/**
 * 备选版式归一。**不在库里的丢掉、和主版式重复的丢掉**：编出来的编号留在下拉里的话，
 * 他挑中之后是一句 400（读起来像「这个版式坏了」）；和主版式重复的留着的话，前面那组里
 * 「规划挑的」出现两遍，看起来像模型只给了一条备选。
 */
function normalizeAlts(raw: any, mainId: string, off: Set<string>): { ids: string[]; bad: string[] } {
  const ids: string[] = [];
  const bad: string[] = [];
  for (const v of Array.isArray(raw) ? raw : []) {
    const given = String(v ?? '').trim();
    const id = given.toUpperCase();
    if (!id) continue;
    // 停用的当「不在清单里」处理（不进 bad —— 那句话是给他调 prompt 用的，而这条不是模型的错）：
    // 留在下拉里的话他从备选里挑中一条自己关掉的版式，那一页照样排得出来，
    // 而案例库页面上那个开关是关着的。
    if (off.has(id)) continue;
    if (!layoutById(id)) {
      // 报错里放**模型原样给的那个串**（不是大写过的）：调 prompt 时唯一有用的就是它到底写了什么。
      if (!bad.includes(given)) bad.push(given);
      continue;
    }
    if (id === mainId || ids.includes(id)) continue;
    if (ids.length < MAX_ALTS) ids.push(id);
  }
  return { ids, bad };
}

/**
 * 备选少了/没有都要说一句。两种都不报错，而下拉里的表现是「这一页只有一个版式合适」——
 * 他于是照规划那条生成，而备选本来就是给他换的。整份汇总成一条，不逐页刷（40 页会把
 * 真正要看的那几条 problems 冲下去）。
 */
function altWarnings(pages: PlannedPage[], badAlts: string[]): string[] {
  const out: string[] = [];
  if (badAlts.length) {
    out.push(
      `模型给的备选版式里有 ${badAlts.length} 个不在案例库里（${badAlts.slice(0, 6).join(' / ')}），已经丢掉 ——` +
        `那几页的下拉里备选会少几条，不是「只有这一个版式合适」。`
    );
  }
  const n = pages.filter((p) => !p.alts.length).length;
  if (n) out.push(`有 ${n} 页没给备选版式，换版式时只能自己从 ${layouts().length} 条里挑。`);
  return out;
}

function clean(v: any): string {
  return typeof v === 'string' ? v.trim() : '';
}

/**
 * 模型给的提纲行号区间 → `[起, 止]`。给不出来的一律返回 `null` **并且说一句**：
 * 静默当成「这一页没有原文」的话，那一页会退回只靠 `points` 生成（也就是丢细节的老行为），
 * 而界面上看不出任何区别。
 *
 * 几种写法都认（`[12,18]` / `"12-18"` / `{from,to}` / 单个数字）：这不是「宽容」，是模型
 * 换个格式写就等于整份提纲一行都没被认领 —— 那种情况下警告会长到几十条，真正的漏页
 * 反而被冲掉。倒序的自己掉个头（`[18,12]` 显然是笔误），越界的**不夹到边界**（夹了之后
 * 切出来的是别的段落，读起来是正常的一页，只是内容不是这一页的）。
 */
function normalizeSourceLines(raw: any, total: number): { range: [number, number] | null; reason: string } {
  let a: any;
  let b: any;
  if (Array.isArray(raw)) [a, b] = raw;
  else if (raw && typeof raw === 'object') {
    a = (raw as any).from ?? (raw as any).start ?? (raw as any).begin;
    b = (raw as any).to ?? (raw as any).end;
  } else if (typeof raw === 'number') a = b = raw;
  else if (typeof raw === 'string') {
    const m = raw.trim().match(/^(\d+)\s*[-–~,to]+\s*(\d+)$/i) || raw.trim().match(/^(\d+)$/);
    if (m) {
      a = Number(m[1]);
      b = Number(m[2] ?? m[1]);
    }
  }
  if (a === undefined && b === undefined) return { range: null, reason: '压根没给 `lines`' };
  let s = Math.trunc(Number(a));
  let e = Math.trunc(Number(b ?? a));
  if (!Number.isFinite(s) || !Number.isFinite(e)) {
    return { range: null, reason: `\`lines\` 不是行号（${JSON.stringify(raw)}）` };
  }
  if (s > e) [s, e] = [e, s];
  if (s < 1 || e > total) return { range: null, reason: `行号 ${s}–${e} 越界（提纲只有 ${total} 行）` };
  return { range: [s, e], reason: '' };
}

/** 一条覆盖率警告里最多列几段。再多就把别的 problems 全冲下去了。 */
const MAX_LISTED_RANGES = 8;

/**
 * 提纲覆盖率审计：**哪几行没有被任何一页认领**。
 *
 * 这是「提纲上的重要内容在成稿里丢了」的唯一可查点。规划出来的 30 页每一页单看都合理、
 * 页数也对得上，而提纲里那六行地产数据 / 那张喜事日历表整段没有任何一页认领 —— 界面上
 * 和「这几段本来就该合并掉」一模一样，一处都不报错，用户只能等成稿翻到那儿才发现。
 *
 * 只报不改（同 `repeatWarnings`）：自动补一页的话页数凭空变多，而他以为那是模型规划的。
 * 空行不算漏（提纲里的空行没有内容），但**夹在两段漏字之间的空行照旧算进区间**，
 * 否则「42–47 行」会碎成三条。
 */
function coverageWarnings(
  pages: PlannedPage[],
  outlineLines: string[],
  badRanges: Map<number, string>
): string[] {
  const out: string[] = [];
  const total = outlineLines.length;
  const owner: number[] = new Array(total).fill(0);
  const dupes = new Map<string, number>();

  for (const p of pages) {
    if (!p.outlineRange) continue;
    const [s, e] = p.outlineRange;
    for (let i = s; i <= e; i++) {
      const held = owner[i - 1];
      if (held && outlineLines[i - 1].trim()) {
        const key = `第 ${held} 页和第 ${p.page} 页`;
        dupes.set(key, (dupes.get(key) || 0) + 1);
      }
      owner[i - 1] = held || p.page;
    }
  }
  const overlaps = [...dupes.entries()].slice(0, MAX_LISTED_RANGES).map(([k, n]) => `${k}认领了同样的 ${n} 行`);

  if (badRanges.size) {
    const byReason = new Map<string, number[]>();
    for (const [page, reason] of badRanges) byReason.set(reason, [...(byReason.get(reason) || []), page]);
    const parts = [...byReason].map(([reason, ps]) => `第 ${ps.slice(0, 12).join(' / ')} 页 ${reason}`);
    out.push(
      `有 ${badRanges.size} 页没有对应的提纲原文（${parts.join('；')}）——` +
        '那几页只能靠要点生成，提纲里的数字、客户名、具体条款不会出现在页面上（而页面看起来仍然是完整的一页）。'
    );
  }

  // 一页都没给行号时（模型整个忽略了这个字段）就到此为止：再往下走会把整份提纲列成
  // 「没被认领」，几十段警告刷下来，上面那条真正的成因反而看不见了。
  if (!pages.some((p) => p.outlineRange)) return out;

  // 连续的未认领行合成一段（空行不单独成段，但可以夹在中间）
  const ranges: Array<{ s: number; e: number }> = [];
  for (let i = 0; i < total; i++) {
    if (owner[i]) continue;
    if (!outlineLines[i].trim() && !(ranges.length && ranges[ranges.length - 1].e === i)) continue;
    const last = ranges[ranges.length - 1];
    if (last && last.e === i) last.e = i + 1;
    else ranges.push({ s: i, e: i + 1 });
  }
  // 尾部的空行退掉：留着的话行号写成「42–48 行」而第 48 行是空的，他数到那儿会以为报错了
  for (const r of ranges) while (r.e > r.s + 1 && !outlineLines[r.e - 1].trim()) r.e--;
  const missing = ranges
    .map((r) => ({ ...r, text: outlineLines.slice(r.s, r.e).join('\n').trim() }))
    .filter((r) => r.text);

  if (missing.length) {
    const lost = missing.reduce((n, r) => n + r.text.length, 0);
    const list = missing
      .slice(0, MAX_LISTED_RANGES)
      .map((r) => `- 第 ${r.s + 1}${r.e > r.s + 1 ? `–${r.e}` : ''} 行：「${preview(r.text)}」`);
    if (missing.length > MAX_LISTED_RANGES) list.push(`- …另有 ${missing.length - MAX_LISTED_RANGES} 段`);
    out.push(
      `提纲里有 ${missing.length} 段（共 ${lost} 字）**没有被任何一页认领**，这些内容一个字都不会出现在成稿里：\n` +
        `${list.join('\n')}\n` +
        '这几段确实不用就忽略这条；要留的话给对应那一页补上（或者插一页），不然翻到那儿才会发现。'
    );
  }

  if (overlaps.length) {
    out.push(
      `${overlaps.join('；')} —— 这几页会写同一段提纲，成稿里读起来像重复说了两遍（每一页单看都正常）。`
    );
  }
  return out;
}

/**
 * 哪几页的原文装不进它挑的版式。**在这里报（规划刚出来、还没花生成的钱那一刻）**：
 * 等生成完再说的话，那一页已经是模型压缩过的成品，他看到的是一页完整通顺的幻灯片
 * 加一句「内容偏多」，而压掉的那几行要逐字对提纲才发现。只喊不改，见 outlineFit 文件头。
 */
function fitWarnings(pages: PlannedPage[]): string[] {
  const long = longformLayouts(enabledLayouts());
  const out: string[] = [];
  for (const p of pages) {
    if (!p.outlineText) continue;
    const layout = layoutById(p.layoutId);
    if (!layout) continue;
    const said = outlineFitProblem(layout, p.outlineText, `第 ${p.page} 页「${p.title}」`, long);
    if (said) out.push(said);
  }
  return out;
}

/** 报错里露出原文的头一截：只给行号的话他得回去数行，而数错一次就以为没漏。 */
function preview(text: string): string {
  const one = text.replace(/\s+/g, ' ').trim();
  return one.length > 42 ? `${one.slice(0, 42)}…` : one;
}

/**
 * 连续 3 页以上同版式。**只报不改** —— 自动打散的话用户看到的是一份「模型挑的」规划，
 * 而实际上是代码挑的，下次同样的提纲又是这个结果，他永远不知道要去改提纲还是改 prompt。
 */
function repeatWarnings(pages: PlannedPage[]): string[] {
  const out: string[] = [];
  let run = 1;
  for (let i = 1; i <= pages.length; i++) {
    if (i < pages.length && pages[i].layoutId === pages[i - 1].layoutId) {
      run++;
      continue;
    }
    if (run >= 3) {
      out.push(`第 ${i - run + 1}–${i} 页连续 ${run} 页都是 ${pages[i - 1].layoutId}（规范是连续 ≤2 页），翻起来会很单调。`);
    }
    run = 1;
  }
  return out;
}

/** 模型给的 `kind` → 页型。认不出来的（「过渡页」「尾页」）当没标，**不猜**：猜错之后
 *  下面那条核对会拿错的页型去比，报出来的是一条假警告，比不报更糟。 */
function normalizeKind(v: any): PageRole | '' {
  const s = clean(v);
  return PAGE_ROLES.find((r) => r === s) || '';
}

/**
 * 页型和版式归属对不对得上（库文件里每条那行 `归属`）。
 *
 * **只报不改**：静默换一条的话，界面上是一份「模型挑的」规划而实际是代码挑的，
 * 下次同样的提纲又是这个结果，他不知道该改提纲还是改 prompt（同 `repeatWarnings`）。
 *
 * 三条各治一种「翻起来完全正常」的失败：
 * ① **标了章节扉页却挑了内容版式** —— 那一页会排成一页正文，每页单看都合法，整份就是
 *    少了过渡感，而 `layoutId` 校验一路放行（编号确实在库里）。
 * ② **第 1 页不是封面版式** —— 翻开第一页是一页四栏矩阵，读起来像漏了封面。
 * ③ **压根没标页型** —— 上面两条于是一句话都不会说；不汇总一句的话「没核对」和
 *    「核对通过」在界面上一模一样（problems 里都是空的）。
 */
function kindWarnings(pages: PlannedPage[]): string[] {
  const out: string[] = [];
  const ids = (role: PageRole) => enabledLayoutsForRole(role).map((l) => l.id).join(' / ');

  for (const p of pages) {
    if (!p.kind) continue;
    const layout = layoutById(p.layoutId);
    if (!layout || layout.roles.includes(p.kind)) continue;
    out.push(
      `第 ${p.page} 页「${p.title}」标的是${p.kind}页，但 ${layout.id} 的归属是「${layout.roles.join(' / ')}」——` +
        `这一页会排成一页${layout.roles[0]}页（不报错，只是整份少了这一处该有的节奏）。${p.kind}页可用的是 ${ids(p.kind)}。`
    );
  }

  const first = pages[0] && layoutById(pages[0].layoutId);
  if (first && !first.roles.includes('封面')) {
    out.push(
      `第 1 页用的是 ${first.id}（归属：${first.roles.join(' / ')}），整份第一页应该是封面 —— ` +
        `现在翻开第一页就是一页${first.roles[0]}页。封面可用的是 ${ids('封面')}。`
    );
  }

  const n = pages.filter((p) => !p.kind).length;
  if (n) {
    out.push(
      `有 ${n} 页没标页型（封面 / 目录 / 章节 / 内容 / 结尾），那几页的版式**没有核对过** ——` +
        '「标成章节扉页却挑了内容版式」这种就查不出来了（每一页单看都合法）。'
    );
  }
  return out;
}

/** 没给理由的页。理由是这一步唯一能核对的东西，缺了就只剩一个版式名。 */
function missingWhy(pages: PlannedPage[]): string[] {
  const n = pages.filter((p) => !p.why).length;
  return n ? [`有 ${n} 页没给挑版式的理由 —— 那几页只能靠 demo 自己判断挑得对不对。`] : [];
}

/**
 * 「页型 → 可用版式」那几行，**在代码里按库文件的 `归属` 算**（硬规则 3）。
 *
 * 让模型自己想「哪些版式能当封面」的话，它会挑一条读起来很像封面的内容版式（L16 那种
 * 四栏矩阵在名字上一点也不像内容页）—— 编号合法、校验放行，翻开第一页就是一页正文。
 * 同一份分组也是 `kindWarnings` 核对用的那一份，两边不会漂开。
 */
function roleBlock(): string {
  return PAGE_ROLES.map((role) => {
    const ids = enabledLayoutsForRole(role).map((l) => `${l.id}（形状：${l.shape}）`);
    return `- ${role}：${ids.join(' / ')}`;
  }).join('\n');
}

function buildPrompt(outlineLines: string[], lib: PptLayout[]): string {
  // 行号由代码编（硬规则 3）：让模型自己数行的话它会数偏两三行，而切出来的那一段
  // 读起来仍然通顺 —— 只是讲的是上一节的事。
  const numbered = outlineLines.map((l, i) => `${i + 1}| ${l}`).join('\n');
  return `你是演示稿的排版设计师。任务：把下面这份提纲拆成逐页，并**从给定的版式清单里**给每页挑一个版式。

## 硬规则（违反其中任何一条，这次规划就是废的）
1. \`layoutId\` **只能**是清单里出现过的编号（只有 ${lib.map((l) => l.id).join(' / ')} 这几个，停用的已经不在里面），**原样照抄**。清单里没有的版式一律不许用，也不要自己发明版式或写 CSS。
2. 相邻页不要撞版式：**连续最多 2 页**用同一个版式。整份用到的版式种类越丰富越好，但每页仍要选最贴合内容的那个。
3. 每页都要给 \`kind\`（这一页是什么页）：\`${PAGE_ROLES.join('\` / \`')}\`。**第 1 页固定是 \`封面\`**；每个章节开头是 \`章节\`；最后一页通常是 \`结尾\`。
4. \`layoutId\` **只能从下面「页型 → 可用版式」里这一页页型那一行挑**。标了 \`章节\` 却挑一条只归 \`内容\` 的版式，那一页会排成一页正文 —— 每一页单看都合法，整份就是少了过渡感。
5. \`内容\` 页按这一页内容的**形状**挑（清单里每条都写了 \`形状：…\`）：3–4 个同构小块 → \`并列\`；两块对立 → \`对比\`；大数字 / 指标 → \`数据\`；阶段推进 / 时间线 → \`时序\`；图文各占一半 → \`分屏\`；单一主角（金句 / 人物 / 产品） → \`聚焦\`。
6. 每页只有一个视觉主角：图多的版式不要配大段文字，文字密的版式不要塞满图。
7. \`why\` 要写出**为什么这一页配这个版式**（这一页的内容结构是什么、版式的哪一处正好装得下），一句话，不要复述版式描述。
8. 不要输出页码 —— 顺序就是页码，由程序自己算。
9. \`images\` 是**这一页要哪几张图**的清单（不配图就给 \`[]\`）。每张写清三样：
   - \`subject\`：**画什么**，一句话、具体到能直接照着画（「等距视角的城市算力机房，蓝紫冷色」），不要写「一张配图」「相关插图」这类空话；
   - \`mode\`：\`concept\`（抽象概念插画）/ \`case\`（具体场景、产品、人物）/ \`data\`（信息图、图表感）；
   - \`ratio\`：\`16:9\`（横幅、全幅背景）/ \`1:1\`（方块图标位）/ \`3:4\`（竖图、人物卡）—— 按你挑的那个版式里图位的形状选，选错的图会被裁掉两边。
   张数要和版式装得下的图位数一致，一页最多 ${MAX_SLOTS_PER_PAGE} 张。
10. \`lines\` 是这一页对应**提纲原文的行号区间** \`[起始行, 结束行]\`（含两端，就是「## 提纲」里每行开头那个数字）：
   - **提纲的每一行都要被某一页认领**：整份下来 \`lines\` 要连成 \`[1,x] [x+1,y] …\` 一直到最后一行，不许跳过、不许两页认领同一行。
   - 后面写这一页的时候，程序会按这个区间把**提纲原文逐字**交给它 —— 所以区间给漏了，那几行内容一个字都不会出现在成稿里（而页面看起来仍然是完整的一页）。
   - 一节内容太多装不进一页时，**拆成两页各认领一半**，不要把整节压给一页。
   - \`points\` 照旧要给（它是这一页的骨架），但不要因为写了 points 就少认领行 —— points 是摘要，原文才是内容。
11. \`alts\` 是这一页的**备选版式**：从清单里再挑 2-3 个也装得下这一页内容的编号（**同样要在这一页页型那一行里**），按「越合适排越前」的顺序给。不许重复 \`layoutId\`、不许给清单里没有的编号（清单里没有的会被丢掉）。

## 页型 → 可用版式（\`layoutId\` 和 \`alts\` 只能从这一页页型对应的那一行里挑）
${roleBlock()}

## 版式清单（${lib.length} 个）
${lib.map((l) => l.selectText).join('\n\n')}

## 提纲（每行开头的数字是行号，\`lines\` 要用它）
${numbered}

## 输出格式
只输出一个 JSON 数组，不要任何解释文字。每个元素：
{"kind":"内容","section":"所属模块名（如「第二部分 · 落地路径」，封面页可留空）","title":"这一页的标题","lines":[12,18],"points":["要点1","要点2"],"layoutId":"L7","alts":["L3","L9"],"why":"挑它的理由（一句话）","images":[{"subject":"画什么，一句话","mode":"${IMAGE_MODES.join(' | ')}","ratio":"${IMAGE_RATIOS.join(' | ')}"}]}
`;
}
