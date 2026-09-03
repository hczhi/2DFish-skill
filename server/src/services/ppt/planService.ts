// 排版规划：一份提纲 → 每页挑一个版式。**整份一次调用**，不逐页问。
//
// 为什么一次给全部页：相邻页去重（连续 ≤2 页同版式）、封面/章节页走全幅、整份的节奏
// 都是**跨页**约束。逐页问的话模型看不到上一页选了什么，出来的是「每页单看都合理、
// 整份翻下来极其单调」的 deck —— 而那种 deck 的每一页都挑不出错，用户只会觉得
// 「生成的东西没什么设计感」，无从下手。
//
// 这一步只挑版式、不写 HTML（HTML 是下一步，只带那一条的 buildText）。

import { jsonGateway, jsonFailMessage, parseJsonArrayItems } from '../../core/llm/parseJson.js';
import { layouts, layoutById, type PptLayout } from './layoutLibrary.js';
import { normalizeImageSpecs, IMAGE_RATIOS, MAX_SLOTS_PER_PAGE, type PlannedImage } from './imageSpec.js';
import { IMAGE_MODES } from './styleLibrary.js';

/** 提纲上限。只拒不截 —— 截掉后半截的话用户以为整份都规划过了。 */
export const MAX_OUTLINE_CHARS = 12000;
/** 一份 deck 的页数上限。同上，超了明确拒绝。 */
export const MAX_PAGES = 40;

// 一页的 JSON 约 150-250 字符，30 页就是 6000+ 字符。这个数是留给**思维链**的空间
// （硬规则 2）：`noThinking: true` 之后它才真的全给 JSON。调小不省钱，只是把偶发的
// 长思维链变成确定性截断。
const MAX_PLAN_TOKENS = 8000;

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

  const lib = layouts();
  const prompt = buildPrompt(text, lib);

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
  if (truncated) {
    problems.push(
      `模型返回被截断（finish_reason=length${reasoningTokens ? `，思维链占 ${reasoningTokens} token` : ''}），` +
        `只规划到第 ${rows.length} 页。后面的页没有规划 —— 把提纲拆短一点再来一次。`
    );
  }

  const pages: PlannedPage[] = [];
  const badAlts: string[] = [];
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
    const alt = normalizeAlts(row?.alts ?? row?.alternatives, layout.id);
    badAlts.push(...alt.bad);
    pages.push({
      page,
      section: clean(row?.section) || clean(row?.kicker),
      title,
      points: Array.isArray(row?.points) ? row.points.map((p: any) => clean(p)).filter(Boolean) : [],
      layoutId: layout.id,
      why: clean(row?.why) || clean(row?.reason),
      alts: alt.ids,
      images: img.count,
      imageSpecs: img.specs,
      layoutName: layout.name,
      layoutTitle: layout.title,
      fullbleed: layout.fullbleed,
      demoUrl: layout.demoUrl,
    });
  });

  if (!pages.length) {
    throw new PlanError(`模型规划的 ${rows.length} 页全都用了案例库里没有的版式（${problems.join('；')}）。`);
  }

  problems.push(...repeatWarnings(pages), ...missingWhy(pages), ...altWarnings(pages, badAlts));
  return { pages, problems, usage };
}

/**
 * 备选版式归一。**不在库里的丢掉、和主版式重复的丢掉**：编出来的编号留在下拉里的话，
 * 他挑中之后是一句 400（读起来像「这个版式坏了」）；和主版式重复的留着的话，前面那组里
 * 「规划挑的」出现两遍，看起来像模型只给了一条备选。
 */
function normalizeAlts(raw: any, mainId: string): { ids: string[]; bad: string[] } {
  const ids: string[] = [];
  const bad: string[] = [];
  for (const v of Array.isArray(raw) ? raw : []) {
    const given = String(v ?? '').trim();
    const id = given.toUpperCase();
    if (!id) continue;
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

/** 没给理由的页。理由是这一步唯一能核对的东西，缺了就只剩一个版式名。 */
function missingWhy(pages: PlannedPage[]): string[] {
  const n = pages.filter((p) => !p.why).length;
  return n ? [`有 ${n} 页没给挑版式的理由 —— 那几页只能靠 demo 自己判断挑得对不对。`] : [];
}

function buildPrompt(outline: string, lib: PptLayout[]): string {
  return `你是演示稿的排版设计师。任务：把下面这份提纲拆成逐页，并**从给定的版式清单里**给每页挑一个版式。

## 硬规则（违反其中任何一条，这次规划就是废的）
1. \`layoutId\` **只能**是清单里出现过的编号（L1…L${lib.length}），**原样照抄**。清单里没有的版式一律不许用，也不要自己发明版式或写 CSS。
2. 相邻页不要撞版式：**连续最多 2 页**用同一个版式。整份用到的版式种类越丰富越好，但每页仍要选最贴合内容的那个。
3. 封面、章节过渡页、总结页优先用全幅版式（清单里 \`fullbleed：是\` 的那些）；正文页按内容结构挑（对比 / 数据 / 三栏并列 / 四栏矩阵 / 时间线…）。
4. 每页只有一个视觉主角：图多的版式不要配大段文字，文字密的版式不要塞满图。
5. \`why\` 要写出**为什么这一页配这个版式**（这一页的内容结构是什么、版式的哪一处正好装得下），一句话，不要复述版式描述。
6. 不要输出页码 —— 顺序就是页码，由程序自己算。
7. \`images\` 是**这一页要哪几张图**的清单（不配图就给 \`[]\`）。每张写清三样：
   - \`subject\`：**画什么**，一句话、具体到能直接照着画（「等距视角的城市算力机房，蓝紫冷色」），不要写「一张配图」「相关插图」这类空话；
   - \`mode\`：\`concept\`（抽象概念插画）/ \`case\`（具体场景、产品、人物）/ \`data\`（信息图、图表感）；
   - \`ratio\`：\`16:9\`（横幅、全幅背景）/ \`1:1\`（方块图标位）/ \`3:4\`（竖图、人物卡）—— 按你挑的那个版式里图位的形状选，选错的图会被裁掉两边。
   张数要和版式装得下的图位数一致，一页最多 ${MAX_SLOTS_PER_PAGE} 张。
8. \`alts\` 是这一页的**备选版式**：从清单里再挑 2-3 个也装得下这一页内容的编号，按「越合适排越前」的顺序给。不许重复 \`layoutId\`、不许给清单里没有的编号（清单里没有的会被丢掉）。

## 版式清单（${lib.length} 个）
${lib.map((l) => l.selectText).join('\n\n')}

## 提纲
${outline}

## 输出格式
只输出一个 JSON 数组，不要任何解释文字。每个元素：
{"section":"所属模块名（如「第二部分 · 落地路径」，封面页可留空）","title":"这一页的标题","points":["要点1","要点2"],"layoutId":"L7","alts":["L3","L9"],"why":"挑它的理由（一句话）","images":[{"subject":"画什么，一句话","mode":"${IMAGE_MODES.join(' | ')}","ratio":"${IMAGE_RATIOS.join(' | ')}"}]}
`;
}
