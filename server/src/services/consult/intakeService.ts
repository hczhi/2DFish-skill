import { jsonGateway } from '../../core/llm/parseJson.js';
import { SAMPLING } from '../../core/llm/gateway.js';
import { STAGES } from './stages.js';
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
}

export interface IntakeSheet {
  /** 模型读完资料判断的缺口概述，回显给用户（他要拿着这个去找客户） */
  gaps: string[];
  questions: IntakeQuestion[];
  truncated: boolean;
}

const MAX_TOKENS_INTAKE = 12000;
const MAX_QUESTIONS = 14;
/**
 * 少于这个数就抛错。**0 题不能当成「资料很齐」**：界面上一份空问卷和
 * 「AI 觉得你的资料没问题」长得一模一样，而真实原因通常是模型没按格式回 ——
 * 用户于是带着一份半截资料去跑四看，出来的结论照样漂亮。
 */
const MIN_QUESTIONS = 3;

/** 比题面用的规范化：去掉所有空白（中文空格可有可无）。只去空白 —— 放宽成模糊匹配会把
 *  「车场数量」和「车位数量」判成同一题，那题从此再也问不出来，而界面上看不出少了一题。 */
const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase();

function buildMessages(project: ConsultProject, answered: string[]) {
  const fastStages = STAGES.filter((s) => s.lane === 'fast');
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
5. ${MIN_QUESTIONS}–${MAX_QUESTIONS} 题，按对结论影响的大小从大到小排。
   宁可少而关键，不要凑数 —— 一份 30 题的问卷客户不会填。
6. \`placeholder\` 给一个具体的填写示例（含单位/量级），让客户知道要答到多细。

只输出 JSON，不要任何解释文字：
{
  "gaps": ["这份资料目前最要紧的缺口，3-6 条，一条一句话"],
  "questions": [
    { "section": "看自己", "question": "…", "why": "…", "placeholder": "例：…" }
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
      requestSummary: `${project.brand_name} · 补料问卷`,
    }
  );

  const rawList = Array.isArray(parsed?.questions) ? parsed.questions : [];
  const questions: IntakeQuestion[] = [];
  for (const q of rawList) {
    const question = String(q?.question || '').trim();
    if (!question) continue;
    questions.push({
      id: `q${questions.length + 1}`,
      section: String(q?.section || '').trim(),
      question,
      why: String(q?.why || '').trim(),
      placeholder: String(q?.placeholder || '').trim(),
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
