import { aiGateway, SAMPLING } from '../../core/llm/gateway.js';
import { STAGES, type StageDef } from './stages.js';
import {
  appendMessage,
  listMessages,
  MAX_CHAT_CHARS,
  type ConsultProject,
  type ConsultEntry,
  type ConsultMessage,
} from './projectStore.js';
import { requireStage, StageError } from './draftService.js';
import { listSources, sourcesBlock } from './sourceStore.js';

// 阶段内对话。一个阶段一段对话：在这一步里继续追问、让 AI 换个角度、
// 挑某个方向往深挖，聊定了再走定稿。
//
// 出草稿 / 出方向是「一问一答」的独立调用，这里是「带着上下文接着聊」——
// 两者写进同一张 consult_messages，因为用户的下一句经常指着上一次的输出说
// （「第 2 个方向」「把结论里那句改成…」）。

/** 思维链的方差留在这里，不是正文长度。见 draftService 里同一个常量的注释。 */
const MAX_TOKENS_CHAT = 12000;

/**
 * 进 prompt 的历史轮数上限。**超出的部分要说出来** ——
 * 悄悄丢掉前面几轮之后，AI 会把二十轮前已经排除掉的方向重新提一遍，
 * 语气上完全像是新建议，用户没法看出它其实是忘了。
 */
const MAX_HISTORY_MESSAGES = 24;

export interface ChatTurn {
  user: ConsultMessage;
  reply: ConsultMessage;
  /** 这次没能进 prompt 的历史条数（0 表示全带上了） */
  dropped: number;
  truncated: boolean;
}

/**
 * 方向卡 / 草稿的文字版：进 prompt 的是这一段，卡片本身存在 payload 里。
 *
 * 序号必须写进文字里（「方向 2：…」）：用户下一句就是「第 2 个再往深挖」，
 * 而模型只看得到这段文字 —— 序号丢了它就只能猜，猜错之后照样答得很顺。
 */
export function directionsToText(out: {
  directions: Array<{ title: string; tagline: string; identity?: string; markdown?: string }>;
  verdict?: string;
}): string {
  // 每个方向的三件套整段带上（markdown）：用户下一句往往是「第 2 个方向的第 3 条动作
  // 换成别的」，只带标题和定位语的话模型看不到那张表，只能顺着话编一条出来。
  // markdown 开头那两行就是定位语和一句话身份，所以只在它缺失时才单独补
  const lines = out.directions.map(
    (d, i) => `## 方向 ${i + 1}：${d.title}\n${d.markdown || `定位语：${d.tagline}`}`
  );
  return `我按现在的资料出了 ${out.directions.length} 个互斥方向：\n\n${lines.join('\n\n')}${
    out.verdict ? `\n\n🧭 方向研判：${out.verdict}` : ''
  }`;
}

/**
 * 草稿的文字版。**正文要整段带上**（不截断）：用户在这一步说的话十句有八句指着正文里
 * 某一节（「痛点矩阵那条改成 P0」），只带一句话总结的话 AI 看不到那张表，
 * 只能顺着他的话往下编 —— 改出来的东西格式完全正常，改的是它自己想象的那张表。
 */
export function draftToText(draft: {
  conclusion: string;
  body?: string;
  confidence: string;
  aiOpportunities?: string[];
  gaps: string[];
}): string {
  return (
    `我出了一版草稿（置信度 ${draft.confidence}）。一句话总结：${draft.conclusion}` +
    (draft.body ? `\n\n正文：\n${draft.body}` : '') +
    // AI 机会带进对话：它不在正文里（单独存一列），不带的话用户说
    // 「AI 机会那条换一个」时模型看不到它，只会顺着话另编一条出来
    (draft.aiOpportunities?.length
      ? `\n\n本步的 AI 赋能机会：${draft.aiOpportunities.join('；')}`
      : '') +
    (draft.gaps.length ? `\n\n资料里还缺：${draft.gaps.join('；')}` : '')
  );
}

/**
 * 知识库块。和 draftService 里那份同格式 —— 对话里的判断也只能依据已定稿结论。
 *
 * 只有**本阶段自己**那条带正文：用户在这一步聊的十句里有八句是指着正文里某张表说的
 * （「痛点矩阵里第二条」），不带正文 AI 只能顺着话往下编。其余阶段只带一句话总结 ——
 * 对话是每句都要发一次的，全带正文的话聊到第十句 prompt 里全是表格，客户资料被挤到
 * 最后面，回答依然通顺但和这家企业无关。
 */
function knowledgeBlock(entries: ConsultEntry[], bodyFor: string): string {
  const byKey = new Map(entries.map((e) => [e.stage_key, e]));
  const lines: string[] = [];
  for (const s of STAGES) {
    const e = byKey.get(s.key);
    if (!e) continue;
    let block =
      `### ${s.label}（${e.stale ? '⚠ 上游已变，谨慎引用' : `置信度 ${e.confidence}`}）\n` +
      `一句话总结：${e.conclusion}`;
    if (s.key === bodyFor && e.body.trim()) block += `\n\n${e.body.trim()}`;
    lines.push(block);
  }
  return lines.length ? lines.join('\n\n') : '（还没有已定稿的结论）';
}

function systemPrompt(project: ConsultProject, stage: StageDef, entries: ConsultEntry[]): string {
  // 三条车道三句话。plan 漏掉这一句的话它会走到 else 分支去，被当成「做判断」——
  // 于是聊内容营销时模型反复让客户在两个定位之间选，而定位早就定稿了，
  // 那几句选择题读起来还挺专业。
  const laneNote =
    stage.lane === 'fast'
      ? `这一步属于「四看」，是**找事实**：把客户资料里已经存在的东西梳理清楚，不要发挥。`
      : stage.lane === 'plan'
        ? `这一步属于「${stage.group}」，是**把已定稿的占位结论翻译成能上手做的方案**：定位 / 价值 / 信任 / 关系已经定了，不要再回去让客户重选；这里要落到具体平台、具体动作、具体节奏上，并且每条建议都指回它承接的那条结论。客户团队做不动的事就直说做不动。`
        : `这一步属于「${stage.group}」，是**做判断**：判断取决于客户的取舍，所以遇到需要拍板的地方，给他 2-3 个互斥的选择加上各自的代价，让他选，不要替他定。`;

  return `你是品牌占位系统的资深咨询顾问，正在和客户讨论「${stage.label}」这一步。
${laneNote}

硬规则：
1. 只能依据【联网资料】【客户资料】【已定稿结论】这三样。三样里都没有的事实不要当成事实说；
   缺料就直接指出缺什么，让他补（可以让他用界面上的「联网查资料」去搜）。
   引用时说清出处：联网资料标「（联网·域名·年份）」，客户资料标「（客户资料）」，
   靠常识的说「这是我按常识推的，只能给区间」—— 把推测说成查到的，读起来和真的一模一样。
2. 不要跑题到别的阶段去。客户问的是别的阶段的事，就提醒他去那一步聊 —— 这一步的对话只会作为这一步的依据。
3. 回答短一点：3-6 句，或者一个不超过 5 条的清单。这是对话不是报告，长篇大论他不会看。
4. 不要每次都复述一遍已定稿结论，客户界面上看得到。
5. 客户说「第 N 个方向」「上面那条」时，指的是本次对话里出现过的那个，照着它接着说。
6. 直接输出正文，不要 JSON，不要标题党式的分节。

【品牌 / 客户】${project.brand_name}

【当前这一步】${stage.group} · ${stage.label}
要回答的问题：${stage.question}

【本步应产出的东西（客户界面上也看得到这份清单，他会照着它问「第 N 项呢」）】
${stage.deliverables.map((d, i) => `${i + 1}. ${d}`).join('\n')}

【已定稿结论（企业知识库）】
${knowledgeBlock(entries, stage.key)}

【联网资料（L1）】
${sourcesBlock(listSources(project.id))}

【客户资料（L2）】
${project.brief || '（客户还没贴任何资料）'}`;
}

/** 历史转成 LLM 消息。方向卡 / 草稿用它们的文字版（content），payload 不进 prompt。 */
function historyMessages(msgs: ConsultMessage[]) {
  return msgs
    .filter((m) => m.content.trim())
    .map((m) => ({ role: m.role === 'user' ? ('user' as const) : ('assistant' as const), content: m.content }));
}

/**
 * 聊一轮。
 *
 * 两条消息**都在拿到回复之后才落库**，而且要一起落：先存用户那句再调模型的话，
 * 模型报错时对话里留下一句没人答的话，下一轮它会带着这句话进 prompt 当成上下文，
 * 而用户以为那次发送失败了、又问了一遍 —— AI 于是在回答一个被问了两遍的问题。
 * 他打的字留在输入框里（前端出错不清空），不需要靠库来保。
 */
export async function chatInStage(
  userId: string,
  project: ConsultProject,
  stageKey: string,
  text: string
): Promise<ChatTurn> {
  const { stage, entries } = requireStage(project.id, stageKey);
  const clean = text.trim();
  if (!clean) throw new StageError('说点什么再发', 400);
  if (clean.length > MAX_CHAT_CHARS) {
    throw new StageError(
      `一次最多 ${MAX_CHAT_CHARS} 字，当前 ${clean.length} 字。长资料请贴到上面的「客户资料」里（不会自动截断，避免 AI 照着半句话回答）`,
      400
    );
  }

  const all = listMessages(project.id, stageKey);
  // -1：这一轮自己那句话要占一个位置
  const kept = all.slice(-(MAX_HISTORY_MESSAGES - 1));
  const dropped = all.length - kept.length;

  const { response } = await aiGateway(
    {
      messages: [
        { role: 'system' as const, content: systemPrompt(project, stage, entries) },
        ...historyMessages(kept),
        { role: 'user' as const, content: clean },
      ],
      ...SAMPLING.analytic,
      max_tokens: MAX_TOKENS_CHAT,
    },
    {
      userId,
      source: 'consult',
      operation: `chat:${stage.key}`,
      tier: 'default',
      requestSummary: `${project.brand_name} · ${stage.label}`,
    }
  );

  const raw = (response.choices[0]?.message?.content || '').trim();
  const finish = response.choices[0]?.finish_reason;
  if (!raw) {
    // 空返回不落一条空气泡：空气泡在界面上和「AI 没什么可说的」长得一样。
    // 思维链 token 数必须带上，否则用户只会怀疑自己问得不好。
    const cot = (response.usage as any)?.completion_tokens_details?.reasoning_tokens;
    throw new StageError(
      `模型没有返回内容（finish_reason=${finish || '未知'}${cot ? `，其中思维链占 ${cot} token` : ''}）。` +
        `再问一次，或者换个不带思维链的模型（这次的 AI 额度已经扣了）`,
      502
    );
  }

  const user = appendMessage(project.id, stageKey, { role: 'user', content: clean });
  const reply = appendMessage(project.id, stageKey, { role: 'assistant', content: raw });
  return { user, reply, dropped, truncated: finish === 'length' };
}
