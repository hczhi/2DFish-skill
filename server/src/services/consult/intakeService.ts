import { jsonGateway } from '../../core/llm/parseJson.js';
import { SAMPLING } from '../../core/llm/gateway.js';
import { stages } from './stages.js';
import { StageError } from './draftService.js';
import { MAX_BRIEF_CHARS, type ConsultProject } from './projectStore.js';

// 补料问卷。快车道（四看）的结论**全部**来自客户资料那一段，所以「资料里缺什么」
// 决定了整个项目的天花板 —— 而缺料的失败形态是：AI 照常识编出一份读起来完全正常的
// 现状卡。这个 agent 的活就是把「缺什么」变成一份具体的问题清单，让用户去问客户。
//
// 提示词写在代码里（和 draftService 一样），不进 skill 表：它和下面那几个校验是
// 一对的（问题必须带「为什么问」、必须只问资料里没有的），拆开之后改了提示词
// 校验不动，出来的问卷看着一样。

/** 一道题。`why` 是硬要求 —— 不说为什么问，用户就会跳过一半的题。 */
export interface IntakeQuestion {
  id: string;
  /** 归到哪一步（看自己 / 看行业 / 看竞品 / 看用户 …），让用户知道漏了这题会影响什么 */
  section: string;
  question: string;
  why: string;
  placeholder: string;
  /**
   * `'choice'` = 这题能点选（选项在 {@link options} 里）；`'text'` = 只能手填。
   *
   * 这个区分是承重的，见 {@link MAX_OPTIONS} 上面那段：给数字/名单类的题配选项，
   * 等于让模型编几个区间、客户挑最接近的那个 —— 那个数字进了客户资料之后，
   * 和客户亲口说的**一模一样**，后面十四步全按它推，没有一处会报错。
   */
  type: 'choice' | 'text';
  /** 只有 `type==='choice'` 时非空。2-4 条互斥的类型划分；「其他」「说不准」由前端固定补，不占这里的名额。 */
  options: string[];
}

export interface IntakeSheet {
  /** 模型读完资料判断的缺口概述，回显给用户（他要拿着这个去找客户） */
  gaps: string[];
  questions: IntakeQuestion[];
  truncated: boolean;
}

const MAX_TOKENS_INTAKE = 12000;
/**
 * 8 题（原来 14）。两个理由都不是排版：
 * - 这份问卷是**发给客户填**的。十四题带 why 带示例，客户填一半就停，而回来的半份答案
 *   在界面上和填满的一模一样 —— 缺的那几题从此不会再问（下一轮会把已答过的剔掉、
 *   接着问更深的东西）。宁可少而关键。
 * - 题数直接决定这次输出多长。这条调用和四看那几步一样撞着接入点 ~300 秒的时间上限
 *   （见 draftService 的 AI_TIMEOUT_MS），而顶到上限时额度已经扣了、问卷一个字都没有。
 */
const MAX_QUESTIONS = 8;
/**
 * 出问卷的超时，**并且不重试**。默认是 120 秒 + 重试 1 次，于是慢一点的模型会让用户
 * 等满 240 秒然后拿到一句失败 —— 两次都白花（同样的资料、同样的思维链，第二次断在同一
 * 个地方），而第一次其实只要再给它一会儿就写完了。一次给足，不重试。
 */
const AI_TIMEOUT_MS = 240_000;
/**
 * 少于这个数就抛错。**0 题不能当成「资料很齐」**：界面上一份空问卷和
 * 「AI 觉得你的资料没问题」长得一模一样，而真实原因通常是模型没按格式回 ——
 * 用户于是带着一份半截资料去跑四看，出来的结论照样漂亮。
 */
const MIN_QUESTIONS = 3;
/**
 * 一道选择题最多几个选项。**选项只能是「类型/模式」划分，绝不能是数字、金额、数量、
 * 名单、日期** —— 那类题一律 `type:'text'`。
 *
 * 理由是这条链路上最贵的一种静默失败：客单价这种题给出 A/B/C 三个区间，客户挑一个
 * 最接近的，那个**模型编出来的数字**就进了客户资料，而它在正文里和客户亲口说的
 * 一模一样（`applyAnswers` 只写「问 X 答 Y」，不记 Y 是选的还是填的），
 * 后面十四步全按它推。类型划分不吃这个亏：「直营 / 加盟 / 经销」穷尽得起来，
 * 模型不需要知道这家公司就能列全，客户点一个不会引入任何假数字。
 *
 * 少于 2 条的**降级成 text 而不是丢题**：一个只有一个选项的单选在界面上就是个死按钮，
 * 而丢掉那题的话界面上和「AI 觉得这件事不用问」一模一样。
 */
const MAX_OPTIONS = 4;

/** 比题面用的规范化：去掉所有空白（中文空格可有可无）。只去空白 —— 放宽成模糊匹配会把
 *  「车场数量」和「车位数量」判成同一题，那题从此再也问不出来，而界面上看不出少了一题。 */
const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase();

function buildMessages(project: ConsultProject, answered: string[]) {
  const fastStages = stages().filter((s) => s.lane === 'fast');
  const stageList = fastStages
    .map((s) => `- ${s.label}：${s.question}\n  要产出：${s.deliverables.join('；')}`)
    .join('\n');

  const system = `你是品牌占位咨询团队「背景梳理」环节的资料补全分析师。你服务的对象是
公司内部顾问（员工），他手上只有下面这一份客户资料，接下来要靠它做完「四看」：

${stageList}

你的任务**不是分析**，而是读完这份资料后，列出「还必须向客户问清楚什么」，
并把它写成一份能直接发给客户填的问卷。

硬规则：
1. **只问资料里没有的。** 资料里已经写了的（哪怕只写了一句），不要再问 ——
   用户会以为你没读他贴的东西，而且填一遍重复的信息只会让资料更长、更难读。
2. **每一题都要说清「为什么问」**（\`why\`）：这题的答案会影响四看里哪一步的哪个判断。
   不写的话用户会跳过一半的题，而跳过之后 AI 照常识补出来的结论读起来完全正常。
3. **只问客户自己答得出来的事实**：业务数据、组织现状、客户名单、价格带、渠道占比、
   历史沿革、他们自己觉得的优势和痛点。**不要**问「你觉得应该怎么定位」——
   那是后面十二步要一起做的判断，不是资料。
4. 也**不要**问公开可查的行业数据（市场规模、竞品融资额这类）：那些走联网检索，
   不该占用客户的时间。
5. **最多 ${MAX_QUESTIONS} 题**（少于 ${MIN_QUESTIONS} 题不算一份问卷），按对结论影响的大小
   从大到小排。这份问卷要发给客户本人填，题一多他填一半就停 ——
   所以只留「不知道就没法往下判断」的那几题，一题都不要凑数。
   **一题只问一件事**：把「你们的价格带、渠道占比和主要客户是谁」拆开问，
   合成一句的话客户只会答其中一个，而那一行读起来是答过了的。
6. \`why\` 一句话说清影响四看里哪一步的哪个判断（30 字内），
   \`placeholder\` 给一个具体的填写示例（含单位/量级），让客户知道要答到多细。两个都要短 ——
   这两段越长，这次输出越容易顶到时间上限，而顶到时额度已经扣了、问卷一个字都没有。
7. **能点选的题给选项，不能点选的绝不给。** 客户面对一屏空白输入框会直接放弃，
   所以凡是答案空间**你不需要认识这家公司就能列全**的题，给 2-${MAX_OPTIONS} 个互斥选项
   （\`type:"choice"\`）：经营模式（直营/加盟/经销）、客户是企业还是个人、
   决策里谁掏钱、主要走线上还是线下、目前处在哪个阶段 —— 这类是**类型划分**。
   反过来，答案是**数字、金额、数量、比例、名单、年份**的题一律 \`type:"text"\`，
   一个选项都不要给：你编的区间客户会挑一个最接近的，那个数字从此就以「客户说的」
   身份进了资料，后面每一步都按它推，而没有任何一处会报错。
   不确定属于哪一类就给 \`text\`。
   选项要短（12 字内）、彼此不重叠、覆盖常见情况；**不要**自己加「其他」「不确定」
   这类兜底项，那两个由系统固定补在后面。

只输出 JSON，不要任何解释文字：
{
  "gaps": ["这份资料目前最要紧的缺口，3-6 条，一条一句话"],
  "questions": [
    { "section": "看自己", "question": "…", "why": "…", "type": "text", "placeholder": "例：…", "options": [] },
    { "section": "看自己", "question": "…", "why": "…", "type": "choice", "placeholder": "例：…", "options": ["直营", "加盟", "直营+加盟"] }
  ]
}`;

  // 已经问过并且答过的题要写进 prompt。光靠下面那段代码过滤也能挡住重复，
  // 但那样模型出的 12 题会被砍到 3 题 —— 告诉它，它才会去问下一层的东西。
  const askedBlock = answered.length
    ? `\n\n【已经问过并且客户答过的题（答案就在上面那份资料的「补充问答」里）】
${answered.map((q) => `- ${q}`).join('\n')}
这些**不要再问**。要问的是在这些答案基础上还缺的下一层。`
    : '';

  const user = `【品牌 / 客户】${project.brand_name}

【客户资料（这就是全部，没有别的附件）】
${project.brief.trim() || '（用户还没贴任何资料 —— 那就从最基础的问起）'}${askedBlock}`;

  return [
    { role: 'system' as const, content: system },
    { role: 'user' as const, content: user },
  ];
}

/**
 * 出一份补料问卷。**不落库** —— 填完调 `applyAnswers` 才追加进客户资料。
 *
 * 解析失败 / 一题都没有一律抛错：空问卷会被读成「AI 认为资料够了」，
 * 那是这条链路上唯一一种「看起来是成功」的失败。
 */
export async function buildIntake(
  userId: string,
  project: ConsultProject,
  answered: string[] = []
): Promise<IntakeSheet> {
  const { parsed, raw, finish, reasoningTokens } = await jsonGateway<any>(
    () => ({
      messages: buildMessages(project, answered),
      ...SAMPLING.analytic,
      max_tokens: MAX_TOKENS_INTAKE,
      response_format: { type: 'json_object' },
    }),
    {
      userId,
      source: 'consult',
      operation: 'intake',
      tier: 'strong',
      timeoutMs: AI_TIMEOUT_MS,
      maxRetries: 0,
      // 这条路上有人在屏幕前等着（新建项目一律先过一轮问卷），而实测耗时几乎全花在
      // 没人看得见的那段思考上（见 GatewayOptions.noThinking：36.6 秒 → 3.5 秒）。
      // consult 的对话和草稿早就写死关掉了，只有这条漏了 —— 现象就是「出问卷要等两三分钟」，
      // 日志里一切正常，看起来像模型慢。顺带 max_tokens 那 12000 才真的全给正文。
      noThinking: true,
      requestSummary: `${project.brand_name} · 补料问卷`,
    }
  );

  const rawList = Array.isArray(parsed?.questions) ? parsed.questions : [];
  const questions: IntakeQuestion[] = [];
  for (const q of rawList) {
    const question = String(q?.question || '').trim();
    if (!question) continue;
    // 选项去空去重（重复的两个选项在界面上是两个一样的按钮，点哪个都对，
    // 而客户会以为自己看漏了什么）。不足 2 条就当没给，降级成手填 —— 见 MAX_OPTIONS。
    const rawOpts: unknown[] = Array.isArray(q?.options) ? q.options : [];
    const opts = Array.from(
      new Set(rawOpts.map((o) => String(o ?? '').trim()).filter(Boolean))
    ).slice(0, MAX_OPTIONS);
    const choice = q?.type === 'choice' && opts.length >= 2;
    questions.push({
      id: `q${questions.length + 1}`,
      section: String(q?.section || '').trim(),
      question,
      why: String(q?.why || '').trim(),
      placeholder: String(q?.placeholder || '').trim(),
      type: choice ? 'choice' : 'text',
      // text 题一定要清空：留着几个选项在库里，将来前端只看 options 非空就渲染成单选的话，
      // 「营收多少」会变成三个模型编出来的区间，而那正是这一段要挡住的事。
      options: choice ? opts : [],
    });
    if (questions.length >= MAX_QUESTIONS) break;
  }

  if (questions.length < MIN_QUESTIONS) {
    const why = !parsed
      ? !raw.trim()
        ? `模型没有返回内容（finish_reason=${finish || '未知'}${reasoningTokens ? `，其中思维链占 ${reasoningTokens} token` : ''}）`
        : finish === 'length'
          ? '模型返回被截断'
          : '模型没有按 JSON 格式返回'
      : `模型只给出了 ${questions.length} 道题`;
    // 不能回一份空问卷：那读起来就是「你的资料已经够了」
    throw new StageError(
      `${why}，问卷没生成 —— 这不代表你的资料已经齐了。再点一次（这次的 AI 额度已经扣了）`,
      502
    );
  }

  // 剔掉已经问过并且答过的题。prompt 里也说了，但模型照样会重出 ——
  // 重复的题让用户以为 AI 没读他上一轮补的东西，而他真的填第二遍之后，
  // 资料里同一个事实就有两份，AI 会当成两处独立印证。
  const seen = new Set(answered.map(norm));
  const fresh = questions.filter((q) => !seen.has(norm(q.question)));
  if (!fresh.length) {
    // 和「没生成」分开说：这里是真的没有新问题了，不是模型出错
    throw new StageError(
      `这一轮 AI 出的 ${questions.length} 道题全都是之前已经问过并且客户答过的，没有新问题 —— ` +
        `资料现在 ${project.brief.length} 字。要问更深的东西，先把「客户原始资料」里那几段答案补细一点再来。`,
      409
    );
  }
  // 剔重之后重排 id：前端拿 id 当 v-model 的键，断号本身没问题，
  // 但界面上的题号是按数组下标画的，两边对不上时用户报错的「第 3 题」找不到
  fresh.forEach((q, i) => {
    q.id = `q${i + 1}`;
  });

  return {
    gaps: Array.isArray(parsed.gaps)
      ? parsed.gaps.map((g: unknown) => String(g).trim()).filter(Boolean).slice(0, 8)
      : [],
    questions: fresh,
    truncated: finish === 'length',
  };
}

export interface AnswerInput {
  question: string;
  answer: string;
  section?: string;
}

/**
 * 把填好的答案**追加**进客户资料。
 *
 * 三件事是刻意的：
 * - **只写答了的题。** 空答案连题目一起丢掉，绝不写成「问：… 答：（空）」——
 *   那一行进 prompt 之后模型会当成「客户确认没有这个东西」，反而比缺料更糟。
 * - **追加不是整段替换。** 客户端不回传整份资料：他这边还开着一个 20000 字的输入框，
 *   整段替换会把他刚在别处存的补充吃掉，而两次操作都显示成功。
 * - **超出上限直接抛错，不截断。** 被截掉的正好是刚补进去的答案，而回复是「已补充」。
 */
export function applyAnswers(
  project: ConsultProject,
  answers: AnswerInput[],
  stamp: string
): { brief: string; applied: number } {
  const kept = answers
    .map((a) => ({
      question: String(a?.question || '').trim(),
      answer: String(a?.answer || '').trim(),
      section: String(a?.section || '').trim(),
    }))
    .filter((a) => a.question && a.answer);

  if (!kept.length) {
    throw new StageError('一道题都没填 —— 填几条再补进资料（空着补进去会被 AI 当成「客户说没有」）', 400);
  }

  const block =
    `\n\n## 补充问答（${stamp}）\n` +
    kept
      .map((a) => `- ${a.section ? `[${a.section}] ` : ''}${a.question}\n  答：${a.answer}`)
      .join('\n');

  const brief = (project.brief || '').trimEnd() + block;
  if (brief.length > MAX_BRIEF_CHARS) {
    throw new StageError(
      `补进去会让客户资料到 ${brief.length} 字，超过上限 ${MAX_BRIEF_CHARS}（不会自动截断 —— 被截掉的正好是你刚填的这些）。先去客户资料里删掉用不上的部分。`,
      400
    );
  }
  return { brief, applied: kept.length };
}
