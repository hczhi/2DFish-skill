import { aiGateway, SAMPLING } from '../../core/llm/gateway.js';
import { stages, stageByKey, type StageDef } from './stages.js';
import {
  appendMessage,
  listMessages,
  MAX_CHAT_CHARS,
  type ConsultProject,
  type ConsultEntry,
  type ConsultMessage,
} from './projectStore.js';
import { requireOpenStage, StageError } from './draftService.js';
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
 * 岔路口清单的文字版（`kind='decisions'`，慢车道「先定方向」那一屏）。
 *
 * 序号和 `directionsToText` 同一个理由：用户下一句就是「第 2 个我选 B」，
 * 而模型只看得到这段文字。选项的**代价**也要带上 —— 只带选项名的话，
 * 他说「就按你建议的来」时模型看不到自己建议的那条放弃了什么，答得却很顺。
 */
export function decisionsToText(sheet: {
  points: Array<{ question: string; methodRef?: string; basis?: string; options: Array<{ label: string; detail?: string; cost: string }>; recommend?: string }>;
  noFork?: string;
  missing?: string[];
}): string {
  if (!sheet.points.length) {
    return `我读完资料和上游定稿，这一步没有需要你拍板的取舍：${sheet.noFork || '（模型没说明原因）'}`;
  }
  const lines = sheet.points.map((p, i) => {
    const opts = p.options
      .map((o, j) => `  ${String.fromCharCode(65 + j)}. ${o.label}${o.detail ? ` —— ${o.detail}` : ''}\n     代价：${o.cost}`)
      .join('\n');
    return (
      `## 待定 ${i + 1}：${p.question}${p.methodRef ? `（${p.methodRef}）` : ''}\n` +
      (p.basis ? `依据：${p.basis}\n` : '') +
      `${opts}` +
      (p.recommend ? `\n  🧭 我的建议：${p.recommend}` : '')
    );
  });
  return (
    `这一步动笔之前有 ${sheet.points.length} 处要你（或客户）拍板 —— 这几处按现在的资料都说得通，` +
    `我替你选了也写得出一份读起来很完整的方案，但地基就是我选的：\n\n${lines.join('\n\n')}` +
    (sheet.missing?.length ? `\n\n📋 另外这几件是缺事实、不是取舍，要去问客户：\n${sheet.missing.map((m) => `- ${m}`).join('\n')}` : '')
  );
}

/**
 * 拍板结果的文字版（`kind='decided'`）。
 *
 * 这条记录是「这一步的地基是他定的」在对话里唯一的痕迹，所以**每一处的代价也要写出来**：
 * 只写「他选了 B」的话，过两天回来看不出选 B 放弃了什么，而那正是不可逆的那部分
 * （定稿之后这一步只读）。它和方向卡一样**不进 prompt**（出正文时读的是 payload 里
 * 那份结构化的 `DecidedSheet`）—— 当成聊天记录带回去的话，同一批选择会以
 * 「客户说过的话」的身份再出现一遍，模型把它当成两处独立印证。
 */
export function decidedToText(sheet: {
  picks: Array<{
    question: string;
    methodRef?: string;
    label: string;
    cost: string;
    note?: string;
    /** 见 decisionService.DecisionBy。空 = 他自己点的（老记录没有这一列） */
    by?: string;
  }>;
  noFork?: string;
}): string {
  if (!sheet.picks.length) {
    return `✅ 已确认：这一步没有需要拍板的取舍（${sheet.noFork || '未说明原因'}），按现有资料直接出正文。`;
  }
  const lines = sheet.picks.map(
    (p, i) =>
      `${i + 1}. ${p.question}${p.methodRef ? `（${p.methodRef}）` : ''}\n` +
      // 一处一处标出来是谁定的：只在开头写一句「这几处是 AI 定的」的话，
      // 混着的那种（他定了两处、AI 补了两处）看不出哪两处要复核。
      `   → **${p.label}**（放弃：${p.cost}）` +
      (p.by === 'ai-recommend'
        ? '　⚠ AI 按它自己的建议定的'
        : p.by === 'ai-fallback'
          ? '　⚠ AI 连建议都没给准，这一处用的是第一个选项'
          : '') +
      (p.note ? `\n   → 补充：${p.note}` : '')
  );
  // 全自动跑报告时这几处是 AI 定的，**开头那句必须跟着换**：照旧写「已经由你定了」的话，
  // 他过两天回来看这条记录会以为这几处自己拍过板，于是最该复核的那几处再没人看第二眼。
  const aiCount = sheet.picks.filter((p) => p.by === 'ai-recommend' || p.by === 'ai-fallback').length;
  const head = !aiCount
    ? `✅ 这一步的 ${sheet.picks.length} 处取舍已经由你定了，正文会照这几条写：`
    : `⚠ 这一步的 ${sheet.picks.length} 处取舍里有 ${aiCount} 处是 **AI 替你定的**（你还没核过），正文会照这几条写：`;
  return (
    `${head}\n\n${lines.join('\n')}\n\n` +
    `这几条会写进正文开头的「方法论速览」—— 那是整份方案里唯一能看出地基是谁定的地方。` +
    (aiCount ? '不同意哪一处就改那一处，然后重跑这一步（下游那几步也要跟着重跑）。' : '')
  );
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
 * 从正文里切出某一节（`## N. 标题` 开头，到下一个 `##` 之前）。找不到返回空串。
 *
 * 按标题**包含关键词**认，不按序号：序号是模型自己编的（漏一项就整体前移一位），
 * 按序号取会静默取到隔壁那一节 —— 气泡里于是挂着一张标题对不上的表，
 * 而它看起来完全正常。标题行本身也带回去，不然摘出来的表没有名字。
 */
function sectionOf(body: string, keyword: string): string {
  const lines = (body || '').split('\n');
  const start = lines.findIndex((l) => /^#{2,3}\s/.test(l) && l.includes(keyword));
  if (start === -1) return '';
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^#{2,3}\s/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join('\n').trim();
}

/**
 * 定稿的文字版，作为一条 `kind='entry'` 的消息进这一步的对话记录。
 *
 * 定稿以前在对话里没有任何痕迹：右栏换成只读的「已定稿」视图，而对话最后一条还是
 * 「已生成草稿」那张卡片 —— 过两天回到这一步，从对话上完全看不出自己定的是哪一版
 * （点那张卡片打开的是当时那版草稿，和最终定稿可能已经不是一回事）。
 *
 * **kind 故意不是 'text'。** 'text' 会被 `discussionBlock` 当成「客户/顾问在这一步说过的话」
 * 带进下一次 prompt，而这段内容本来就以定稿的身份进下游 prompt（`knowledgeBlock`）——
 * 同一段东西在上下文里出现两遍，模型会把它当成两处独立印证（「多处资料都指向…」），
 * 而那句话读起来完全正常。
 *
 * 正文**整份**不写进这段文字：正文在 `consult_entries.body` 里，右栏显示的是那一份。
 * 抄一份到消息里的话，重新定稿之后两份就不一样了，而对话里那份看起来才像「最终版」。
 * 只有 `StageDef.highlight` 指定的那一节例外（见下面）—— 摘一节的代价是重新定稿后
 * 旧气泡里那张表是旧的，但它头上写着「第 N 版」，说得清是哪一版。
 *
 * **rationale / evidence 不摊在这里。** 那两段是推导过程（几百字的因果链 + 客户资料
 * 原文摘录），写给模型和事后追查用的，顾问真正要看的是正文里那几张表 ——
 * 摊在气泡里的后果是：气泡长得要滚两屏，而那张表反而还得再点一次才看得到，
 * 读起来像「定稿定的就是这两段话」。两段仍然存在 `consult_entries` 里，右栏能看。
 */
export function entryToText(entry: {
  stage_key: string;
  conclusion: string;
  body: string;
  confidence: string;
  source_level: string;
  version: number;
  ai_opportunities?: string[];
}, staledLabels: string[] = []): string {
  const head =
    `✅ **已定稿**（第 ${entry.version} 版 · 置信度 ${entry.confidence} · 证据级别 ${entry.source_level}）`;
  const parts = [head, `**结论**：${entry.conclusion}`];
  const highlight = stageByKey(entry.stage_key)?.highlight;
  if (highlight) {
    // 小节标题降到 h4：气泡只有几百像素宽，h2 带一条下边框，在这里读起来像
    // 「这条消息到此为止」，后面那张表看着是另一条消息。
    const section = sectionOf(entry.body, highlight).replace(/^#{2,3}\s+/, '#### ');
    // 找不到也要出声：静默省掉的话气泡读起来是「这一版没有这张表」，
    // 而真实原因是模型没按清单命名那一节（那才是该回去重出一版的信号）。
    parts.push(
      section ||
        `**${highlight}**：这一版正文里没找到这一节（模型没按输出物清单命名小节）——点下面「在右侧查看完整正文」核一眼，缺了就重出一版。`
    );
  }
  if (entry.ai_opportunities?.length) {
    parts.push(`**AI 赋能机会**：${entry.ai_opportunities.join('；')}`);
  }
  // 被标成待重跑的下游也写进这条记录：接口返回的那句提示是一次性的（切个阶段就没了），
  // 而「这一步的改动动了哪几步」是后面回头看时唯一能对上的线索。
  if (staledLabels.length) {
    parts.push(`⚠ 这次定稿把下游 ${staledLabels.length} 条标成待重跑：${staledLabels.join('、')}`);
  }
  return parts.join('\n\n');
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
  for (const s of stages()) {
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
   缺料就直接指出缺什么，让他补。
   引用时说清出处：客户资料标「（客户资料）」，
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

【联网资料】
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
  // 定稿之后这一步只读（见 requireOpenStage）：这里最要紧 —— 定稿后再聊，模型照样
  // 一句一句认真回，而那几句既进不了任何 prompt，也改不动已经定下的结论。
  const { stage, entries } = requireOpenStage(project.id, stageKey);
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
      // 这里要的是「3-6 句」，而实测思维链会为这 3-6 句想上 1500 token / 三十多秒 ——
      // 对话是一句一句来的，等三十秒和等三秒是两个产品。见 GatewayOptions.noThinking。
      noThinking: true,
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
