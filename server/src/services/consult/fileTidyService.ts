import { aiGateway, SAMPLING } from '../../core/llm/gateway.js';
import { StageError } from './draftService.js';
import { MAX_BRIEF_CHARS } from './projectStore.js';

// 把 fileExtract 抠出来的碎文本交给模型**按咨询用得上的口径提炼**：挑出品牌/产品/数据/
// 竞品/用户/问题这些类目下的事实，其余（页码目录、汇报礼节、和业务无关的段落）全部删掉。
// 不是逐字清理 —— 客户的品牌 PPT 提取出来动辄四五万字，而资料框只装 20000 字，
// 「留全文」这个选项在真实文件上压根不存在。
//
// 这一层唯一的危险是「不许编」被破掉：这段文本最终进「客户原始资料」，而那段资料是
// 后面十二步唯一的事实依据。模型顺手补一个客单价、一个年份、一句"行业报告显示"，
// 它就以**客户说的**身份进了全部结论，而它在正文里和客户亲口说的一模一样，
// 没有任何一处会报错（同 intakeService 里「选项不能是数字」那条，也是硬规则 3）。
//
// 所以除了 prompt 里那条硬规则 0，这里还有一道**程序化**的闸门：比对原文和整理后各自
// 出现的数字，整理后多出来的数字逐个点名回给界面。它便宜、直接命中最贵的那种失败，
// 而且不做拦截 —— 中文数字被转成阿拉伯数字这类误报是有的，所以它是「请核对这几个」，
// 不是「拒绝」。

/**
 * 一次上传最多整理这么多字。**超了只拒不截**（砍掉后半段的话，他看到的是一份
 * 「整理好了」的资料，而后面十二步是照着半份资料出结论的）。
 *
 * 这个数比资料框的上限 {@link MAX_BRIEF_CHARS} 大得多，是有意的：客户给的品牌 PPT
 * 提取出来动辄四五万字，而「整理」这一步的活恰恰就是把它删到资料框装得下 ——
 * 卡在 20000 字的话，这个功能对真实文件一次都用不上（用户只能对着一句
 * 「请先删掉 22666 字」自己手删，那正是他想让 AI 干的事）。
 */
export const MAX_TIDY_INPUT_CHARS = 80_000;

/**
 * 一份文件整理出来最多留这么多字。**一次上传最多 5 个文件、5 份都自动带进资料**
 * （见 briefCompose.ts），所以这个数乘 5 必须还装得进资料框的
 * {@link MAX_BRIEF_CHARS}（20000）—— 剩下的空间留给他自己手打的那段。
 *
 * 它是**发给模型的预算**，不是事后截断：截到 3500 字的那一份在界面上和「模型自己压到
 * 3500 字」长得一模一样，而断掉的正好是排在后面的类目（用户与客群 / 当前问题与目标 ——
 * 提炼时越靠后越是结论性的东西）。模型压不下来时走 `overBudget` 出声，由他自己删
 * （卡片里那份是可编辑的），提交那一下再拒一次并点名是哪个文件。
 */
export const TIDY_BUDGET_CHARS = 3_500;

/**
 * 每次调用喂多少字。超过这个数就分几次调用（{@link splitForTidy}）。
 *
 * **分批是要花几次 AI 额度的**（登录用户缺省 10 次/天），所以这件事绝不能悄悄发生：
 * `planTidy` 把要花几次算出来回给界面，由用户点那个写着次数的按钮。
 *
 * 这一步改成「提炼」之后输出很短（12000 字进去常常一两千字出来），所以卡住这个数的
 * **不再是** {@link MAX_TOKENS_TIDY}，而是模型在长输入里的漏读：喂进去两万多字，它会
 * 整页整页地不提，而漏掉的那几页在结果里**没有任何痕迹**（少一节的资料读起来照样完整，
 * 只有他逐页对着原文看才发现）。所以宁可多花一次额度分两段 —— 次数是写在按钮上的，
 * 漏读不是。
 */
const CHUNK_CHARS = 12_000;

/**
 * 整理这一步的 `max_tokens`。**这是留给思维链的空间，不是正文长度**（硬规则 2）——
 * 所以配套的是 `noThinking: true`，把这笔额度真的全给正文。
 *
 * 给得比输入宽：这一步的活是删，输出**应该**比原文短，顶到上限基本意味着模型开始
 * 自己发挥了（那种情况由 `truncated` 和数字比对一起报出来）。
 */
const MAX_TOKENS_TIDY = 16000;

/**
 * 一次给足 240 秒且**不重试**（同 intakeService 的 AI_TIMEOUT_MS）。两万字的输入 +
 * 上万字的输出，默认 120 秒 + 重试一次 = 用户等满 240 秒拿一句失败，两次断在同一个
 * 地方（同样的原文、同样的思维链），额度扣两遍而整理结果一个字都没有。
 */
const AI_TIMEOUT_MS = 240_000;

/** 最多点名几个「多出来的数字」。全列出来的话一屏警告没人读，反而把真的那个埋掉了。 */
const MAX_REPORTED_NUMBERS = 12;

export interface TidyResult {
  text: string;
  chars: number;
  /** 原文字数，界面上和 chars 并排显示 —— 「删掉了多少」是他判断这次整理靠不靠谱的第一眼。 */
  rawChars: number;
  /**
   * `finish_reason === 'length'`。断在半句话上的资料和写完的**长得一模一样**，
   * 所以这一位必须回给界面并显眼提示（同 xhs 全文改写那条）。
   */
  truncated: boolean;
  /** 关思维链没生效时它是正数 —— 报错/提示里要带上（硬规则 2）。 */
  reasoningTokens: number;
  /** 整理后出现、而原文里没有的数字。非空 = 模型很可能编了东西。 */
  addedNumbers: string[];
  /** 其它「成功了但要你看一眼」的话。 */
  notes: string[];
  /** 真的花了几次 AI 调用（= 扣了几次额度）。界面上要显示：他有权知道这一下花了多少。 */
  calls: number;
  /**
   * 有几段是**原文照搬**的（那一段整理失败了）。非 0 时下面那份文字是「部分整理」——
   * 不报出来的话它和整理干净的一份长得一模一样，而中间夹着一整段没删过的页码目录。
   */
  fallbackChunks: number;
  /** 这份文件的字数预算（{@link TIDY_BUDGET_CHARS}）。界面上和 chars 并排显示。 */
  budgetChars: number;
  /**
   * 没压进预算。**这里不截**（截掉的是排在后面的类目，而那一份读起来照样完整），
   * 所以这一位要显眼地回给界面：他得自己在卡片里删到预算以内，否则提交那一下会被拒。
   */
  overBudget: boolean;
}

/**
 * 提炼出来的那几个 `## 小标题`，以及每一节装什么。
 *
 * **图片识别那条路复用同一份**（`imageExtractService.ts`）—— 各写一份的话，图片提出来的
 * 那几节和文件提出来的小标题不一样（"## 用户画像" vs "## 用户与客群"），而它们最后拼进
 * **同一段**客户资料里：后面十二步于是要同时认两套标题，认漏的那一套就成了「客户没提过
 * 这一类」，而每一步的正文读起来完全正常。改这里等于同时改两条路，这是有意的。
 */
export const CATEGORY_LIST = `   - \`## 品牌与公司\`：是谁、做什么的、成立时间、规模、发展阶段、现有的定位表述 / slogan /
     品牌主张 / 品牌故事
   - \`## 产品与服务\`：产品线、卖点、成分 / 技术 / 工艺、规格、价格带、适用场景
   - \`## 经营与销量数据\`：营收、销量、增长、门店 / 客户 / 网点 / 会员数、市占率、客单价、
     复购、渠道占比 —— **数字一个都不要动**
   - \`## 行业与市场\`：市场规模、趋势、政策、行业痛点、机会点（只写原文的说法）
   - \`## 竞品\`：原文提到的每一个竞争对手，以及关于它的说法（谁、什么打法、和我们的差别）
   - \`## 优势与差异点\`：品牌优势、产品优势、供应链 / 渠道 / 团队 / 资源优势、专利、
     资质、背书、代言
   - \`## 用户与客群\`：人群、画像、地域、使用与购买场景、需求与痛点、购买者和使用者
   - \`## 渠道与传播\`：线上线下渠道、平台、投放、内容打法、活动、合作
   - \`## 当前问题与目标\`：客户自己说的困难、瓶颈、这次想解决什么、目标与规划
   - \`## 其它可能有用的\`：拿不准算哪一类、但和这个品牌的业务有关的事实`;

const SYSTEM = `你是品牌咨询项目的资料整理员。用户上传了一份文件（PPT / Word），程序已经把里面的
文字**原样**抠出来交给你。它是碎的：页码页脚混在正文里、同一句话被拆成好几行、目录页和
模板装饰词（CONTENTS / Company profile / Thanks）当成了正文、同一个主题散在很多页。

你的任务：**把对品牌咨询有用的事实挑出来，按下面的类目归好，其余全部删掉。**
不要保留全文，也不是逐字清理 —— 这是给咨询顾问用的资料底稿，不是这份文件的副本。
一句话原则：**一条信息，后面做定位/竞品/用户/内容方案时用不上，就不要出现在结果里。**

硬规则 0（最重要，其它规则都在它之下）：**可以删、可以并，绝不能编。**
提炼是把原文散落的说法合到一起，不是重新写一遍。禁止出现任何原文里没有的信息 ——
尤其是数字、金额、比例、增长率、日期、年份、人名、品牌名、地名、产品名、渠道名、
奖项资质。数字、价格、定位语/slogan、产品名、成分、专业名词、资质名称一律**原样照抄**：
不许取整、不许换单位、不许把两个数字加起来算总数、不许把"三万"改写成"30000"。
原文没写的就是没写：不要补、不要推算、不要"合理估计"、不要写"据行业数据"。
这份资料是后面十二步分析**唯一**的事实依据，你补的一个数字会以「客户说的」身份进入
全部结论，而它在正文里和客户亲口说的一模一样，没有任何一处会报错。

1. **要留的**，用下面这些 \`## 小标题\`（原文里没有对应内容的那一节**直接不要出现**，
   不要写"暂无"）：
${CATEGORY_LIST}
2. **要删的**：页码、页眉页脚、目录页、"--- 第 N 页 ---" 这类分页标记、CONTENTS / THANKS /
   Company Profile 这类模板装饰词、重复出现的章节标题、纯排版装饰、汇报礼节话（"感谢聆听"）、
   和这个品牌的业务无关的内容（会议安排、内部流程、人员名单）、空洞的通用口号
   （"以客户为中心""追求卓越"）—— 但如果那句话是这个品牌自己的定位表述或 slogan，那就要留。
   同一件事在多页重复出现时，只留信息最全的那一次。
3. **拿不准这条事实有没有用 → 放进 \`## 其它可能有用的\`，不要删掉。**
   删错了它从此不在资料里、用户不知道有过这条；留错了他自己划过去就完了。两种代价不对称。
   要删的只是上面第 2 条那些确定没用的东西。
4. **不做分析、不给建议、不下结论、不打分。** 不要"综上所述"、不要"建议聚焦"、
   不要判断谁强谁弱（除非原文自己这么说 —— 那就照抄，并保持它是原文的说法）。
   这是资料，不是方案。
5. 每一节内部用 \`- \` 要点，一条一个事实，短句，别写长段落。定位语、slogan、客户原话
   照抄原文（不要把口语改成书面语，不要把"我们"改成"该公司"）。看不懂的行业黑话照抄，
   那是这个行业的说法，不是错字。
6. **直接输出正文，第一个字就是 \`##\`。** 不要写"以下是整理后的资料"、不要写收尾的说明。`;

/**
 * 单段（一次调用装得下）时追加的最后一节。**分段时故意不发这条** ——
 * 每一段各自报一次"这份文件里没有"，而那一段里没有的东西很可能就在下一段里，
 * 拼起来是一份自相矛盾的缺料清单（用户会照着它去问客户已经给过的资料）。
 */
const MISSING_SECTION_RULE = `
7. 最后固定加一节 \`## 这份文件里没有的\`：把第 1 条那几个类目里、**这份文件完全没提到**的
   列出来（例如"没有销量数据、没有竞品信息、没有用户画像"）。这一节不许省 ——
   缺哪几类决定了后面要向客户补问什么；省掉之后 AI 会照常识把这些补齐，
   而补出来的东西读起来和真资料一模一样。`;

/**
 * 字数预算那一条。图片识别那条路也用它（同一个预算、同一套压缩纪律，`no` 只是条目编号）。
 *
 * **必须连「压缩时不许做什么」一起写**：只说「控制在 N 字以内」的话，
 * 模型压缩的第一招就是把三个客户名字并成「多家头部客户」、把两个数字并成一个总数 ——
 * 那句话读起来比原文还顺，而那三个名字和那两个数字从此不在资料里，后面十二步谁都不知道
 * 有过它们（同硬规则 3：会算错的东西不交给 LLM）。
 */
export function budgetRule(budget: number, no = 8): string {
  return `
${no}. **这一段的输出控制在 ${budget} 字以内**（含小标题和符号）。装不下时按这个优先级砍：
   数字 / 定位语 slogan / 竞品名 / 用户与客群 / 当前问题与目标 一律留到最后；先删描述性的
   形容词、重复的表述、能从别的事实推出来的话。
   **压缩不许改写事实**：不许把几个具体名字并成"多家客户""若干竞品"，不许把两个数字加成
   一个总数，不许把一条带数字的事实概括成"增长明显"。删掉一条，好过把它改成一句
   读起来更顺、但已经不是原文说法的概括。`;
}

/** 分段时追加：说清这是第几段，并且**不要**报缺料清单（理由见 MISSING_SECTION_RULE）。 */
function chunkRule(index: number, total: number): string {
  return `
7. 这是这份文件的第 ${index + 1} 段（共 ${total} 段）。只整理这一段：不要写开头的总起、
   不要写结尾的小结、不要提"本段""上一部分"，直接从 \`##\` 开始。
   **不要**写"这份文件里没有…"这类缺料清单 —— 这一段里没有的内容可能在别的段里。`;
}

/**
 * 整理这份文字要花几次 AI 调用。**由服务端算并回给界面**（`/extract-file` 的
 * `tidyPlan`）—— 前端自己按字数除一下的话，这个数会和真实调用次数漂开，而界面上
 * 写着「1 次」实际扣掉 4 次，他只会以为额度算错了。
 */
export function planTidy(raw: string): { calls: number; chunkChars: number; maxChars: number } {
  const text = raw.trim();
  return {
    calls: text ? splitForTidy(text).length : 0,
    chunkChars: CHUNK_CHARS,
    maxChars: MAX_TIDY_INPUT_CHARS,
  };
}

/**
 * 按行切成几段，**尽量切在分页标记上**。
 *
 * 切在一页中间的后果不报错：同一张表/同一段话的上下半截落进两次独立调用，
 * 两次各自补一个小标题、各自把半截内容当完整的一节整理，拼起来读得通但是重复的。
 */
function splitForTidy(text: string, chunkChars = CHUNK_CHARS): string[] {
  const chunks: string[] = [];
  let cur = '';
  const push = () => {
    if (cur.trim()) chunks.push(cur.trim());
    cur = '';
  };
  for (const line of text.split('\n')) {
    const isPageStart = /^---\s*第\s*\d+\s*页/.test(line.trim());
    // 已经装到六成以上又碰到一个分页标记，就在这里断 —— 宁可段短一点，也别切在页中间。
    if (cur && (cur.length + line.length + 1 > chunkChars || (isPageStart && cur.length > chunkChars * 0.6))) {
      push();
    }
    // 一整页文字挤成一行（有些 PPT 就是这样）时只能硬切：不切的话这一段会超出
    // chunkChars 好几倍，而超出的那部分是被模型静默丢掉还是顶到 token 上限截断，
    // 两种都读起来正常。
    if (line.length > chunkChars) {
      push();
      for (let i = 0; i < line.length; i += chunkChars) chunks.push(line.slice(i, i + chunkChars));
      continue;
    }
    cur += (cur ? '\n' : '') + line;
  }
  push();
  return chunks.length ? chunks : [text];
}

/** 一段的整理结果。失败不抛（多段时要退回原文并说出来），成因原样带出来。 */
interface ChunkOutcome {
  out: string;
  truncated: boolean;
  reasoningTokens: number;
  /** 非空 = 这一段没整理成，`out` 是空的。 */
  failure?: { message: string; error: unknown; emptyReturn: boolean };
}

async function tidyOneChunk(
  userId: string,
  filename: string,
  chunk: string,
  index: number,
  total: number,
  chunkBudget: number
): Promise<ChunkOutcome> {
  const where = total > 1 ? `（第 ${index + 1}/${total} 段）` : '';
  try {
    const { response, usage, duration_ms } = await aiGateway(
      {
        ...SAMPLING.analytic, // 低温：这一步要的是照抄和删，不是发挥
        messages: [
          // 第 7 条按「一次装得下 / 分了几段」二选一：分段时报缺料清单是错的，
          // 而单段时省掉它，缺哪几类资料就再也没有地方会说出来。
          {
            role: 'system',
            content:
              SYSTEM
              + (total > 1 ? chunkRule(index, total) : MISSING_SECTION_RULE)
              + budgetRule(chunkBudget),
          },
          {
            role: 'user',
            content: `文件名：${filename}\n\n以下是程序从这个文件里抠出来的原始文字：\n\n${chunk}`,
          },
        ],
        max_tokens: MAX_TOKENS_TIDY,
      },
      {
        userId,
        source: 'consult',
        operation: 'consult:tidy-file',
        requestSummary: `整理上传资料：${filename}${where}（${chunk.length} 字）`,
        // 有人在屏幕前等着，而且这条路上关它治的是截断（硬规则 2）：思维链算进
        // max_tokens 却不进 content，上万字的输入很容易把 16000 全想掉，
        // 而症状只是「整理结果断在半句话上」。
        noThinking: true,
        timeoutMs: AI_TIMEOUT_MS,
        maxRetries: 0,
        // `maxRetries: 0` 关掉的是「重试超时」，可上游回一句 `503 system cpu overloaded`
        // 也被一起关掉了 —— 那种重发一次基本就过，而不重发的表现是这一段退回原文
        // （页码目录全在），他只会以为是自己的文件不行。重发在同一次调用里，额度不多扣。
        retryOnBusy: true,
        tier: 'fast', // 输出是大段散文，不是 JSON
      }
    );

    const choice = response.choices?.[0];
    const out = (choice?.message?.content || '').trim();
    const reasoningTokens = (response.usage as any)?.completion_tokens_details?.reasoning_tokens || 0;
    if (!out) {
      // 空返回的成因要说清（硬规则 2）——「空返回 / 截断 / 没按要求回」三种解法完全不同。
      return {
        out: '',
        truncated: false,
        reasoningTokens,
        failure: {
          message:
            `模型一个字都没返回（用了 ${usage.output_tokens} 输出 token，其中 ${reasoningTokens} 花在思维链上，`
            + `耗时 ${(duration_ms / 1000).toFixed(1)} 秒）。`
            + (reasoningTokens > 0
              ? '思维链没关掉 —— 它算进 max_tokens 却不出现在正文里，所以额度全被想掉了。'
                + '去「AI 模型 Provider」把这条接入点的「关思维链」勾上，或者换一个支持关的模型。'
              : '这多半是上游抖动，重试一次通常就好了。'),
          error: null,
          emptyReturn: true,
        },
      };
    }
    return { out, truncated: choice?.finish_reason === 'length', reasoningTokens };
  } catch (e: any) {
    return {
      out: '',
      truncated: false,
      reasoningTokens: 0,
      failure: { message: e?.message || '未知错误', error: e, emptyReturn: false },
    };
  }
}

export async function tidyExtractedText(
  userId: string,
  filename: string,
  raw: string
): Promise<TidyResult> {
  const text = raw.trim();
  if (!text) throw new StageError('没有内容可以整理。', 400);
  if (text.length > MAX_TIDY_INPUT_CHARS) {
    throw new StageError(
      `这份文件提取出 ${text.length} 字，超过一次能整理的上限 ${MAX_TIDY_INPUT_CHARS} 字，`
        + `请先在「原文」里删掉 ${text.length - MAX_TIDY_INPUT_CHARS} 字再整理。\n`
        + '不自动截断是有意的：砍掉后半段的话，你看到的是一份"整理好了"的资料，'
        + '而后面十二步是照着半份资料出结论的。',
      400
    );
  }

  const chunks = splitForTidy(text);
  // 预算是**整份文件**的，所以分段时要摊到每一段上（每段各给 3500 的话，三段拼起来
  // 一万字 —— 5 个文件全带进资料就直接顶爆 20000 字的上限，而每一段各自看都是合规的）。
  // 下限 600 是为了别让段数一多就把每段压成一句话（那时候丢的是事实，不是废话）。
  const chunkBudget = Math.max(600, Math.floor(TIDY_BUDGET_CHARS / chunks.length));
  const notes: string[] = [];
  const outs: string[] = [];
  let truncated = false;
  let reasoningTokens = 0;
  let calls = 0;
  let fallbackChunks = 0;
  let firstError: unknown = null;
  let firstFailMessage = '';
  let stopped = false; // 额度打满之后别再往下打 —— 后面每一次都是同一句失败，白等

  for (let i = 0; i < chunks.length; i++) {
    const at = chunks.length > 1 ? `第 ${i + 1}/${chunks.length} 段` : '这份文字';
    if (stopped) {
      outs.push(chunks[i]);
      fallbackChunks++;
      continue;
    }
    const r = await tidyOneChunk(userId, filename, chunks[i], i, chunks.length, chunkBudget);
    calls++;
    reasoningTokens += r.reasoningTokens;

    if (r.failure) {
      if (!firstError && !r.failure.emptyReturn) firstError = r.failure.error;
      if (!firstFailMessage) firstFailMessage = r.failure.message;
      // 整理失败的那一段**退回原文**，而不是留个空洞：空洞在界面上看不出来
      // （少一节的资料读起来照样完整），而原文虽然碎，至少内容一个字没少。
      outs.push(chunks[i]);
      fallbackChunks++;
      notes.push(`${at}整理失败，这一段下面用的是**原文**（没删过页码目录）：${r.failure.message}`);
      // 额度是全局的，撞了之后剩下几段必然也撞 —— 继续打只是让他多等几个来回。
      if (isQuotaFailure(r.failure.error)) {
        stopped = true;
        notes.push(`AI 额度已经用完，第 ${i + 1} 段之后全部保留原文。明天 0 点重置。`);
      }
      continue;
    }

    outs.push(r.out);
    if (r.truncated) {
      truncated = true;
      notes.push(
        `${at}被截断了（顶到 ${MAX_TOKENS_TIDY} token`
          + `${r.reasoningTokens > 0 ? `，${r.reasoningTokens} 花在思维链上` : ''}），`
          + '这一段结尾是半截的，请对着「原文」补齐。'
      );
    }
  }

  // 一段都没整理成的时候**不能**把原文当整理结果返回：那份东西在「AI 整理」那一栏里
  // 和真整理过的长得一模一样（他不会逐字对着原文看），而它一个字都没被清理过。
  if (fallbackChunks === chunks.length) {
    if (firstError) throw firstError; // 额度用完 / 上游超时，交给 fail() 说各自那句话
    throw new StageError(
      `这次整理没有成功：${firstFailMessage}\n`
        + '你上传的原文没丢，还在「原文」那一栏里 —— 直接插入原文也能用。',
      502
    );
  }

  const out = outs.join('\n\n').trim();

  // 这一步的活是挑和删，输出**应该明显比原文短**。反而变长了几乎只有一个成因：
  // 模型开始自己写了 —— 而写出来的那几段读起来和客户资料完全一样，没有别的地方会提醒他。
  if (out.length > text.length) {
    notes.push(
      `整理后（${out.length} 字）比原文（${text.length} 字）还长 —— 这一步只该删不该增，`
        + '变长基本意味着模型自己补了内容，请对着「原文」核一遍。'
    );
  }
  // 分段是各段独立提炼的，所以同一个类目的小标题会出现好几次。不说的话他会以为
  // 「AI 把资料重复了一遍」而去删，删的时候很容易连着删掉后面几段里独有的那几条。
  if (chunks.length > 1) {
    notes.push(
      `分了 ${chunks.length} 段整理，同一个小标题（如"## 产品与服务"）会出现好几次 ——`
        + '里面的内容不一样，可以自己并到一起，别整节删掉。'
    );
  }
  // 没压进预算。这份文字是**自动带进资料**的（不用他点插入），所以这里不说的话，
  // 他要到点「创建项目」那一下才撞上一句「超了 4310 字」—— 而那时他已经离开这个面板了。
  const overBudget = out.length > TIDY_BUDGET_CHARS;
  if (overBudget) {
    notes.push(
      `整理后 ${out.length} 字，超过单份上限 ${TIDY_BUDGET_CHARS} 字`
        + `${fallbackChunks > 0 ? '（有几段退回了原文，见上面那条）' : ''}，`
        + `请自己删掉 ${out.length - TIDY_BUDGET_CHARS} 字（这里不替你截，截掉的正好是后面几节）。`
    );
  }
  if (reasoningTokens > 0) {
    // 后台核不到这一条的话，用户只会觉得「整理一次要等三分钟」，日志里一切正常。
    notes.push(`这条接入点没关掉思维链（一共想了 ${reasoningTokens} token），又慢又容易截断 —— 去「AI 模型 Provider」勾上「关思维链」。`);
  }

  return {
    text: out,
    chars: out.length,
    rawChars: text.length,
    truncated,
    reasoningTokens,
    addedNumbers: numbersAddedBy(text, out),
    notes,
    calls,
    fallbackChunks,
    budgetChars: TIDY_BUDGET_CHARS,
    overBudget,
  };
}

/**
 * 额度打满的那种失败。**只认错误的类型 / 机器码，绝不拿文案里有没有「额度」两个字去猜。**
 *
 * 这条链路上几乎每一句失败文案里都带着「这次的 AI 额度已经扣了」/「额度全被想掉了」——
 * 那是在如实交代花掉的钱（硬规则 1）。按 `/额度/` 匹配的话，一次空返回、一次上游超时
 * 就被当成额度打满：后面几段全部保留原文，外加一句「AI 额度已经用完，明天 0 点重置」。
 * 那句话是假的（账号可能压根不限额度），而他照着它等到明天，结果一模一样。
 */
function isQuotaFailure(e: unknown): boolean {
  const err = e as any;
  return err?.name === 'QuotaExceededError' || err?.message === 'quota_exceeded';
}

/**
 * 整理后出现、而原文里没有的数字。这是「只删不编」唯一的**程序化**闸门 ——
 * prompt 里那条硬规则 0 挡不住的时候，界面上没有第二个地方会露馅。
 *
 * 故意宽松（只报不拦）：模型把「三万」写成「30000」、把「26味」拆成「26」这类是误报，
 * 而拦下来的代价是一次白花的额度。所以话术是「请核对这几个」。
 */
function numbersAddedBy(raw: string, tidied: string): string[] {
  const pick = (s: string) =>
    new Set((s.match(/\d+(?:[.,]\d+)*/g) || []).map((n) => n.replace(/,/g, '')));
  const before = pick(raw);
  const added: string[] = [];
  for (const n of pick(tidied)) {
    if (before.has(n)) continue;
    // 一两位的数字满篇都是（列表序号、"3 大优势"），报出来只会淹掉真正要看的那几个。
    if (n.length < 3) continue;
    added.push(n);
    if (added.length >= MAX_REPORTED_NUMBERS) break;
  }
  return added;
}
