// 「生成提纲」那个对话页的后端：他和模型来回聊，模型觉得问清楚了就把**整份提纲**
// 写在一对标记之间，代码把那一块原样抠出来回给前端（他点「用这份提纲」才带回输入框）。
//
// 为什么用一对标记、而不是让它「回一份 JSON」或者「整段就是提纲」：
// ① 整段当提纲的话，它那几句「好的，我按招标场合写了一份：」会跟着被带进提纲输入框，
//    然后被分页那一步当成第一页的要点逐字排上去（页面上多一条寒暄，读起来像是他写的）；
// ② 回 JSON 的话提纲里的换行/层级要经过一次转义，而这条路的正文是一大段多行纯文本 ——
//    偶发的反斜杠会让整次对话变成一句「解析失败」，而他要的只是聊天。
//
// 这条路唯一会伪装成成功的地方：**标记只开了没关**（思维链把 max_tokens 花光、
// 或者它写到一半停了）。把后半截当提纲的话，回来那份提纲读起来完整（提纲天生就是
// 「写到哪算哪」的东西），他点确认带走一份缺了后面三章的提纲，规划出来的稿子也完整 ——
// 一处都不报错。所以下面 `pickOutline` 在这种情况下**不给提纲**，并说出真实成因。

import fs from 'node:fs';
import path from 'node:path';
import { aiGateway } from '../../core/llm/gateway.js';
import { libraryRoot } from './layoutLibrary.js';
import { getSkillForSlot } from '../skillRegistryService.js';
import { explainEmpty, type OutInfo } from './promptCraftService.js';
import { MAX_OUTLINE_CHARS } from './planService.js';
import { attachmentBlock, parseAttachments } from '../consult/briefCompose.js';
import { StageError } from '../consult/draftService.js';

export class OutlineChatError extends Error {}

/** 后台可绑 skill 的那个锚点（`KNOWN_SLOTS` 里登记着同一个字符串）。 */
export const OUTLINE_SKILL_SLOT = 'ppt-outline';

/**
 * 提纲正文的那对标记。**由代码写进 prompt、也由代码抠出来**（硬规则 3）：
 * 两边各写一份的话，改了一边之后每次对话都「聊得很好但一直不出提纲」，而模型每轮
 * 都老老实实把提纲写在它那份标记里 —— 界面上看不出任何异常。
 */
export const OUTLINE_OPEN = '===提纲开始===';
export const OUTLINE_CLOSE = '===提纲结束===';

/** 一轮回复 ≈ 一份 12000 字提纲的 token 数 + 留给思维链的空间（硬规则 2）。 */
const MAX_CHAT_TOKENS = 8000;

/** 他一条消息最多多少字（只拒不截：截一半发出去的话模型是照着半句需求写的）。 */
export const MAX_MESSAGE_CHARS = 4000;

/** 一次对话最多几轮（再长下去每轮都把整段历史重发一遍，而他只看到「越来越慢」）。 */
export const MAX_TURNS = 40;

/** 上传资料整段最多多少字（和咨询那边的 brief 上限同一个量级，只拒不截）。 */
export const MAX_MATERIAL_CHARS = 20000;

/**
 * 上传的那几份资料 → 随每轮带上的那一段。**合成在服务端**（同 `briefCompose` 那条）：
 * 前端自己拼一段回传的话，「第 3 份静默没进去」在界面上完全看不出来 —— 卡片还在，
 * 而模型是照着少一份的资料出提纲的，那份提纲读起来完全正常。
 *
 * 复用咨询那份的 `parseAttachments`（份数/空文件那两条校验和分节标注全在里面），
 * 但**不套单份字数上限**（传 `null`）：这条路上一份七千字的产品资料是常事，按 3500 拒掉之后
 * 他唯一的出路是自己进卡片删掉一半，而删掉的正是排在后面那几节。拦人的只有下面那条合计上限，
 * 它只拒不截并点名是哪几份。它抛的是 `StageError`，在这里**翻成 `OutlineChatError`**：
 * 不翻的话 `sendPptError` 认不出它是 400，「这份文件超长了」会变成一句 500「服务器出错」，
 * 而他会以为是我们坏了、一路重传同一份。
 */
export function composeMaterials(rawAttachments: unknown): string | undefined {
  let list;
  try {
    list = parseAttachments(rawAttachments, null);
  } catch (e) {
    if (e instanceof StageError) throw new OutlineChatError(e.message);
    throw e;
  }
  if (!list.length) return undefined;
  const text = list.map(attachmentBlock).join('\n\n');
  // 单份不限之后，**这是这条路上唯一拦人的那道闸门**（`parseAttachments` 传了 null）。
  // 只拒不截：截掉的正好是排在后面的那几份，而提纲照样出得来、读起来完全正常。
  if (text.length > MAX_MATERIAL_CHARS) {
    const breakdown = list.map((a) => `${a.filename} ${attachmentBlock(a).length} 字`).join('、');
    throw new OutlineChatError(
      `带上来的资料合计 ${text.length} 字，超过 ${MAX_MATERIAL_CHARS} 字上限（超出 ${text.length - MAX_MATERIAL_CHARS} 字）。其中：${breakdown}。`
        + '请删掉一份或者删减其中的内容。没有自动截断：截掉的正好是排在后面的那几份，而剩下那份读起来照样完整，提纲就照着半份资料写。'
    );
  }
  return text;
}

export interface OutlineTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface OutlineChatResult {
  /** 聊天气泡里显示的那段话（**已经把提纲那一整块摘掉**）。 */
  reply: string;
  /** 这一轮他给出的整份提纲；没出提纲就是 null（不许拿半截的凑）。 */
  outline: string | null;
  /** 每一处「能用但有话要说」。 */
  problems: string[];
  usage: { input_tokens: number; output_tokens: number; total_tokens: number };
}

/**
 * 基础规范（`library/outline-craft.md`）。
 *
 * **读不到必须抛**：空着发出去的话模型按自己的均值聊几句，回来那份提纲读起来通顺，
 * 而「先问听众/场合」「不许编数字」「一页 3-5 条」这些规则一条都没生效 —— 后面照着它
 * 排出来的十几页每一页都是真花钱生成的。
 */
export function craftRules(): string {
  const p = path.join(libraryRoot(), 'outline-craft.md');
  const raw = fs.existsSync(p) ? fs.readFileSync(p, 'utf-8').trim() : '';
  if (raw.length < 200) {
    throw new OutlineChatError(
      `展示稿提纲规范读不到（${p}）—— 那份 md 是「生成提纲」唯一的基础规范，缺了它模型按自己的均值写（读起来通顺，而「不许编数字」「先问听众和场合」这些规则一条都没生效）。`
    );
  }
  return raw;
}

/**
 * 发出去的那份系统提示：基础规范 + 后台绑的 skill（**追加，不覆盖**）+ 标记那条格式要求。
 *
 * skill 绑了也要留着基础规范：换掉的话「不许编数字」「提纲是纯文本行」这两条要看他写的
 * skill 里有没有 —— 没有的时候提纲里会出现编的数字和 markdown 表格，而它们会被逐字排上页面。
 */
function buildSystem(materials?: string): string {
  const skill = (getSkillForSlot(OUTLINE_SKILL_SLOT) || '').trim();
  const parts = [craftRules()];
  if (skill) {
    parts.push(
      `## 本账号的补充规范\n\n${skill}\n\n上面这一节只用来补充风格和行业习惯；和前面的规范冲突时，**一律以前面的为准**。`
    );
  }
  parts.push(
    [
      '## 输出格式（每一轮都照这个来）',
      '',
      '- 还在问清楚阶段：**只说话，不要写提纲**，也不要出现下面那对标记。',
      '- 要交提纲了：先用一两句话说这份是按什么假设写的，然后把**整份提纲**放在这对标记之间：',
      '',
      OUTLINE_OPEN,
      '（提纲正文，纯文本，一行一条）',
      OUTLINE_CLOSE,
      '',
      `- 标记之间只放提纲本身，不要解释、不要 markdown 代码块。一次只给一份完整提纲（改也是整份重给）。`,
      '- 提纲没写完就不要贴出开始标记 —— 只开不关的那种会被整条丢掉（代码认这对标记）。',
    ].join('\n')
  );
  if (materials) {
    parts.push(
      `## 他上传的资料（原文，按文件分段）\n\n${materials}\n\n资料里没有的数字、客户名、时间一个都不许编。`
    );
  }
  return parts.join('\n\n---\n\n');
}

/**
 * 把提纲那一块从回复里抠出来。
 *
 * 三种情形，**必须分开说**（合成一句「没取到提纲」的话他只会一直重说「出提纲」）：
 * ① 一对标记都在 → 提纲 = 之间那一块，`reply` = 外面剩下的话；
 * ② 只开没关 → **不给提纲**并说出成因（截断 / 思维链花光），那半截提纲读起来是完整的；
 * ③ 只关没开 → 同样不给（前半截被当成聊天贴出来，他能看见，但不会被带进输入框）。
 */
function pickOutline(raw: string, info: OutInfo): { reply: string; outline: string | null; problems: string[] } {
  const problems: string[] = [];
  const cot = info.reasoningTokens ? `，其中思维链占 ${info.reasoningTokens} token` : '';
  const open = raw.indexOf(OUTLINE_OPEN);
  const close = raw.indexOf(OUTLINE_CLOSE, open >= 0 ? open + OUTLINE_OPEN.length : 0);

  if (open >= 0 && close > open) {
    const outline = raw.slice(open + OUTLINE_OPEN.length, close).replace(/^```[a-z]*\n?|```$/gi, '').trim();
    const reply = `${raw.slice(0, open)}\n${raw.slice(close + OUTLINE_CLOSE.length)}`.trim();
    if (!outline) {
      problems.push('这一轮那对「提纲」标记之间是空的 —— 没有提纲可以带回去。再说一句「出提纲」试试。');
      return { reply: reply || '（模型这一轮只给了一对空标记）', outline: null, problems };
    }
    if (outline.length > MAX_OUTLINE_CHARS) {
      // 只拒不截（同 `MAX_OUTLINE_CHARS` 那条）：截掉后半截的话他带回去的是一份
      // 「看起来完整」的提纲，而后面那几章压根不在里面。
      problems.push(
        `这一轮的提纲有 ${outline.length} 字，超过 ${MAX_OUTLINE_CHARS} 字上限，没法直接带回输入框（那边也只拒不截）。` +
          '让它按章节拆成两份分别生成，或者让它压到这个字数以内。'
      );
      return { reply: reply || '（模型这一轮给的提纲太长了）', outline: null, problems };
    }
    return { reply: reply || '（提纲已经生成，见下面那一块）', outline, problems };
  }

  if (open >= 0) {
    problems.push(
      `这一轮的提纲**只写了一半**就断了（贴出了开始标记但没有结束标记，finish_reason=${info.finish || '未知'}${cot}）—— ` +
        '没有把它带回输入框：那半截提纲读起来是完整的（提纲本来就是写到哪算哪），带回去之后排出来的稿子里少了后面几章，' +
        `而一处都不报错。${info.finish === 'length' ? '让它少写几页、或者按章节分两次给。' : explainEmpty(info, MAX_CHAT_TOKENS) + '。'}`
    );
    return { reply: raw.slice(0, open).trim() || '（模型这一轮的提纲写到一半断了）', outline: null, problems };
  }
  if (close >= 0) {
    problems.push(
      '这一轮只有提纲的结束标记、没有开始标记 —— 没法确定从哪儿算提纲，这一轮没有可带回去的提纲。再说一句「重新给一份完整提纲」。'
    );
  }
  if (info.finish === 'length') {
    problems.push(
      `这一轮的回复被截断了（finish_reason=length${cot}）：末尾多半是半句话。` +
        '再说一次「出提纲」，或者让它先只给章节。'
    );
  }
  return { reply: raw.trim(), outline: null, problems };
}

/**
 * 聊一轮（**一次真实 AI 调用**，前端必须把这件事写在界面上）。
 *
 * `turns` 由前端带全（服务端不存这段对话）：漏带历史的话模型每一轮都从头问一遍
 * 听众和场合，而界面上只是「它怎么老在问同样的问题」。
 */
export async function chatOutline(
  turns: OutlineTurn[],
  userId: string,
  opts: { materials?: string; currentOutline?: string } = {}
): Promise<OutlineChatResult> {
  const list = (turns || []).filter((t) => t && typeof t.content === 'string' && t.content.trim());
  if (!list.length) throw new OutlineChatError('这次请求里没有任何对话内容。');
  if (list.length > MAX_TURNS) {
    throw new OutlineChatError(
      `这轮对话已经 ${list.length} 条，超过 ${MAX_TURNS} 条上限 —— 每一轮都要把整段历史重发一遍，再聊下去只会越来越慢。让它先出一份提纲带回输入框，再开一次新的对话接着改。`
    );
  }
  const tooLong = list.find((t) => t.content.length > MAX_MESSAGE_CHARS);
  if (tooLong) {
    throw new OutlineChatError(
      `有一条消息 ${tooLong.content.length} 字，超过 ${MAX_MESSAGE_CHARS} 字上限（没有截断发出去 —— 截一半的话它是照着半句需求写的）。长资料请用上传功能。`
    );
  }
  const materials = (opts.materials || '').trim();
  if (materials.length > MAX_MATERIAL_CHARS) {
    throw new OutlineChatError(
      `带上来的资料 ${materials.length} 字，超过 ${MAX_MATERIAL_CHARS} 字上限（只拒不截）。请先删掉几份，或者只留要紧的那几段。`
    );
  }

  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: buildSystem(materials || undefined) },
  ];
  const current = (opts.currentOutline || '').trim();
  if (current) {
    // 他在新建页框里已经有一份提纲时要带上：不带的话它写的是另一份，而他按「用这份提纲」
    // 之后框里原来那份被整份换掉（换掉这件事界面上会说，但那份新的和他手里那份毫无关系）。
    messages.push({
      role: 'system',
      content: `他在提纲输入框里已经有这样一份（${current.length} 字），这次是要在它基础上改：\n\n${current.slice(0, MAX_OUTLINE_CHARS)}`,
    });
  }
  for (const t of list) messages.push({ role: t.role, content: t.content });

  const { response, usage, noThinking, noThinkingRefused } = await aiGateway(
    { messages, temperature: 0.7, max_tokens: MAX_CHAT_TOKENS },
    // 不指定 tier（走 default）：平台渠道可能压根没有 strong 那一档。
    // 不关思维链：这一步要它想清楚结构，而它的输出不是 JSON（截断的风险由上面那条
    // 「只开不关的标记」兜住并明说）。
    { userId, source: 'ppt', operation: 'outline-chat' }
  );

  const raw = response.choices[0]?.message?.content || '';
  const info: OutInfo = {
    finish: response.choices[0]?.finish_reason,
    reasoningTokens: (response.usage as any)?.completion_tokens_details?.reasoning_tokens,
    noThinkingRequested: noThinking,
    noThinkingRefused,
  };
  if (!raw.trim()) {
    throw new OutlineChatError(
      `模型这一轮一个字都没返回（finish_reason=${info.finish || '未知'}${
        info.reasoningTokens ? `，其中思维链占 ${info.reasoningTokens} token` : ''
      }）。${explainEmpty(info, MAX_CHAT_TOKENS)}（这次的 AI 额度已经扣了）`
    );
  }
  const picked = pickOutline(raw, info);
  return { ...picked, usage };
}
