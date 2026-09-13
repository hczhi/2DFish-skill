// 提纲清洗：把提纲里的无效信息（给自己的备注、待办、口头语、文件路径、元信息）挑出来，
// **整理成一份干净提纲之后再分页**。规划那一步的每一行都会被某一页认领、逐字进 prompt，
// 所以留在提纲里的备注最后会以某种形式排到页面上（模型会认真地把「这里要补一张图」
// 排成一条要点），而那一页看起来完全正常。
//
// 这一步最要紧的一条：**模型只输出行号，删的动作在代码里**（硬规则 3）。让它回一份
// 「整理好的提纲全文」的话，那份文本读起来更顺、层级更整齐 —— 而中间某个数字被改了、
// 两行被合成一行、一句结论被换了说法，一处都对不出来（原文和它给的文本没有任何可校验的
// 对应关系）。只回行号的话，留下来的每一行都是逐字的，被删掉的每一行都能原样列给他核。

import { jsonGateway, jsonFailMessage, parseJsonArrayItems } from '../../core/llm/parseJson.js';
import { MAX_OUTLINE_CHARS } from './planService.js';

/** 一行 JSON 约 40 字符，删几十行也就一千多 token。同样是留给思维链的空间（硬规则 2）。 */
const MAX_CLEAN_TOKENS = 3000;

/** 删掉的字数占了多少就要喊一句。清洗是「去备注」，不是「精简提纲」。 */
const LOUD_DROP_RATIO = 0.3;

/** 一条警告里最多列几行原文，再多就把别的话冲下去了。 */
const MAX_LISTED = 12;

export interface RemovedLine {
  /** 原提纲里的行号（1 起）。前端要显示它 —— 只给文本的话他没法回去核那一段。 */
  line: number;
  /** 被删掉那一行的**原文**（逐字）。 */
  text: string;
  /** 模型说它为什么是无效信息。 */
  why: string;
}

export interface CleanOutlineResult {
  /** 整理后的提纲：原提纲**逐字**去掉 `removed` 那几行，其余一个字都没动。 */
  cleaned: string;
  removed: RemovedLine[];
  /** 每一处「能用但有话要说」。删错一行是这一步唯一的事故形态，全在这里。 */
  problems: string[];
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

export class OutlineCleanError extends Error {}

export async function cleanOutline(outline: string, userId: string): Promise<CleanOutlineResult> {
  const text = outline.trim();
  if (!text) throw new OutlineCleanError('提纲是空的，没有可以整理的内容。');
  if (text.length > MAX_OUTLINE_CHARS) {
    throw new OutlineCleanError(
      `提纲 ${text.length} 字，超过 ${MAX_OUTLINE_CHARS} 字上限。请拆成两份分别整理 —— 截掉后半截的话你会以为整份都整理过了。`
    );
  }

  const lines = text.split('\n');
  const { parsed, raw, finish, reasoningTokens, usage, noThinkingRequested } = await jsonGateway<any[]>(
    () => ({ messages: [{ role: 'user', content: buildPrompt(lines) }], temperature: 0.2, max_tokens: MAX_CLEAN_TOKENS }),
    { userId, source: 'ppt', operation: 'clean-outline', noThinking: true },
    { mode: 'array', attempts: 2 }
  );

  const truncated = finish === 'length';
  // 截断时救回断点之前那几条。这个方向是安全的（少删几行 = 提纲里多留几句备注），
  // 但照旧要说：不说的话他以为整理完了，而后半截的备注一条都没动。
  const rows: any[] = parsed ?? (truncated ? parseJsonArrayItems(raw) : []);
  if (!Array.isArray(parsed) && !rows.length && !truncated) {
    throw new OutlineCleanError(
      jsonFailMessage('提纲整理', { raw, finish, reasoningTokens, budget: MAX_CLEAN_TOKENS, noThinkingRequested })
    );
  }

  const problems: string[] = [];
  if (truncated) {
    problems.push(
      `模型返回被截断（finish_reason=length${reasoningTokens ? `，思维链占 ${reasoningTokens} token` : ''}），` +
        `只整理到前面一部分。后面那些行没有看过 —— 备注可能还留在里面，翻一遍再规划。`
    );
  }

  const removed: RemovedLine[] = [];
  const seen = new Set<number>();
  const badRefs: string[] = [];
  for (const row of rows) {
    const n = Math.trunc(Number(row?.line ?? row?.lineNo ?? row));
    if (!Number.isFinite(n) || n < 1 || n > lines.length) {
      // **不夹到边界、不猜**：夹一下就删掉了别的一行，而整理后的提纲读起来完全正常。
      badRefs.push(JSON.stringify(row?.line ?? row));
      continue;
    }
    if (seen.has(n)) continue;
    // 空行不算删（没有内容会丢），也不列给他看 —— 列出来只会把真正要核的那几行冲下去。
    if (!lines[n - 1].trim()) continue;
    seen.add(n);
    removed.push({ line: n, text: lines[n - 1], why: clean(row?.why) || clean(row?.reason) || '（模型没说为什么）' });
  }
  removed.sort((a, b) => a.line - b.line);

  if (badRefs.length) {
    problems.push(
      `模型给的行号里有 ${badRefs.length} 个用不了（${badRefs.slice(0, 8).join(' / ')}；提纲一共 ${lines.length} 行），` +
        '这几条已经忽略 —— 它想删的那几行还留在提纲里。'
    );
  }

  const cleaned = lines.filter((_, i) => !seen.has(i + 1)).join('\n').trim();
  if (!cleaned) {
    // 全删光了照旧回 200 的话，界面上是一个空提纲框加一句「整理好了」，
    // 而他刚粘进去的那几千字看起来是被自己弄丢的。
    throw new OutlineCleanError(
      `模型把提纲里 ${lines.length} 行全都当成了无效信息，整理后是空的 —— 这次没有改动你的提纲。` +
        '这多半是提纲的格式让它误判了（比如整份是会议记录体），直接规划就行，不用整理。'
    );
  }

  problems.push(...digitWarnings(removed), ...dropWarnings(removed, text));
  return { cleaned, removed, problems, usage };
}

/**
 * 删掉的行里带数字的要单独点名。
 *
 * 这是这一步唯一真正会造成损失的事故：模型把「营收 12.4 亿，同比 +8%」判成备注删掉，
 * 整理后的提纲读起来通顺、层级更整齐，而那一页最后排出来只是「少了一组数据」——
 * 他要逐字对原文才发现。所以带数字的行必须逐行列出来让他核（不是汇总成一句「删了 N 行」）。
 */
function digitWarnings(removed: RemovedLine[]): string[] {
  const withNum = removed.filter((r) => /\d/.test(r.text));
  if (!withNum.length) return [];
  const list = withNum.slice(0, MAX_LISTED).map((r) => `- 第 ${r.line} 行：「${preview(r.text)}」（它说：${r.why}）`);
  if (withNum.length > MAX_LISTED) list.push(`- …另有 ${withNum.length - MAX_LISTED} 行`);
  return [
    `删掉的行里有 ${withNum.length} 行**带数字**，逐行核一遍它们真的是备注：\n${list.join('\n')}\n` +
      '删错的话那组数字再也不会出现在成稿里，而整理后的提纲读起来完全通顺。',
  ];
}

/** 删得太多要喊。清洗是「去备注」，不是「精简提纲」—— 精简掉的那部分不会有任何地方报错。 */
function dropWarnings(removed: RemovedLine[], text: string): string[] {
  if (!removed.length) return [];
  const lost = removed.reduce((n, r) => n + r.text.trim().length, 0);
  const ratio = lost / text.length;
  if (ratio < LOUD_DROP_RATIO) return [];
  return [
    `这次整理删掉了 ${removed.length} 行、共 ${lost} 字，占提纲的 ${Math.round(ratio * 100)}% ——` +
      '这个比例更像是「精简」而不是「去备注」。下面每一行都核一遍，觉得删多了就撤销整理，直接规划。',
  ];
}

function clean(v: any): string {
  return typeof v === 'string' ? v.trim() : '';
}

function preview(text: string): string {
  const one = text.replace(/\s+/g, ' ').trim();
  return one.length > 60 ? `${one.slice(0, 60)}…` : one;
}

function buildPrompt(lines: string[]): string {
  // 行号由代码编（硬规则 3）：让模型自己数行的话它会数偏两三行，而删掉的那一行
  // 读起来也像备注 —— 对不出来。
  const numbered = lines.map((l, i) => `${i + 1}| ${l}`).join('\n');
  return `你在帮人整理一份演示稿提纲。任务：**只找出哪几行是无效信息**，把它们的行号列出来。

无效信息指的是：他写给自己的备注和待办（「这里要补一张图」「记得改数字」「TODO」）、
会议记录里的口头语和寒暄、文件名／路径／链接堆、重复的标题行、「以下内容来自 XX 文档」
这类元信息、纯装饰的分隔符。

## 硬规则（违反其中任何一条，这次整理就是废的）
1. 你**只输出行号**，删除的动作由程序做。不许改写、合并、润色、重排、补写任何一行 ——
   留下来的每一行都会逐字进入成稿。
2. **宁可少删。** 一行里有任何实质信息就绝对不许列：数字、金额、比例、日期、人名、
   机构名、产品名、条款、要点、结论都算实质信息。删错一行的后果是那句话再也不会出现在
   成稿里，而整理后的提纲读起来完全通顺，没有人看得出少了什么。
3. 一整段都是备注时，把那几行**逐行**列出来（不认区间写法）。
4. 空行不用管，程序自己处理。
5. \`why\` 要具体到能核对（「他自己的待办：这里要补一张图」），不许写「无关内容」这种话。
6. 一行都不用删就输出 \`[]\`。

## 提纲（每行开头的数字是行号，只用它）
${numbered}

## 输出格式
只输出一个 JSON 数组，不要任何解释文字。每个元素：
{"line":12,"why":"为什么这一行是无效信息"}
`;
}
