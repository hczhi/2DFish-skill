// 「AI 润色」这一格的提示词：**只改「画什么」那一句**，改完由代码把整条重新拼一遍。
//
// 为什么不让模型润色那一整条：整条里承重的几段都是代码算的 —— 留白方向（`imageSpace`）、
// 尺寸（`sizeForRatio`）、要印在图上的那几行原文（`{{SLIDE_TEXT}}`）、写死的禁忌尾巴。
// 把整条交给模型改一遍，它会顺手把「左边 0–50% 留给文字」改成自己想的那个方位、把
// 「16:9」换成别的、把要印的字改写得更顺口 —— 出来的提示词读起来比原来专业，而图回来
// 主体压在标题底下 / 印在图上的是模型编的文案（硬规则 3），一处都不报错，每张都真花钱。
//
// 三条边界：
// ① 润色**不生图、不写库**（和 `/image-prompt` 预览一条路），落地是他点「确定生成」那一下。
// ② 润色前必须把这一格他自己改写的那一整条（`fullPrompt`）**摘掉**再重新渲染，
//    见下面 `polishSpecPrompt` 里那段注释。
// ③ 模型只回了寒暄 / 空串 / 一串方案时**不许当成那一句用**，要说出真实成因（硬规则 1/2）。
//
// 这份文件里还有第二个按钮：「AI 重写整条」（`rewriteSpecPrompt`）—— 那条路是把**一整条**交给
// 模型重写，回来那条存成这一格的自定义（从此不跟画风/模式/配色走）。两者不是同一个按钮的两种
// 说法，界面上必须分开写：以为重写完还跟着画风走的话，他换完画风回来发现这一格纹丝不动，
// 而一处都不报错。重写那条路上代码算的那几段（尾巴/比例/要印的字/留白方向）**核对后少了就接回去
// 并出声**（`pinRequired`）—— 不核的话那一整条读起来比原来专业，而图回来主体压在标题底下。

import fs from 'node:fs';
import path from 'node:path';
import { aiGateway } from '../../core/llm/gateway.js';
import { libraryRoot } from './layoutLibrary.js';
import { previewSpecPrompt, specPromptParts, modeCn, type SpecImageContext } from './imageService.js';
import { MAX_SUBJECT_CHARS, MAX_FULL_PROMPT_CHARS, type PlannedImage } from './imageSpec.js';
import { leftoverPlaceholders, isPageMode, type ImageMode, type RequiredPromptPart } from './styleLibrary.js';

export class PromptCraftError extends Error {}

/**
 * 一句话 300 字上限 ≈ 200 token，剩下的全是留给思维链的空间（硬规则 2）。
 * 调低不省钱（按实际用量计费），只是把偶发的长思维链变成确定性的「模型一个字都没返回」。
 */
const MAX_CRAFT_TOKENS = 2400;

/**
 * 那两步的指令原文（`library/image-prompt-craft.md`）。
 *
 * **读不到必须抛**：回空串的话发出去的是一条没有任何创作规范的请求，模型照自己的均值改写
 * 一句 —— 回来的那句读起来通顺、界面上一切正常，而润色这个按钮的全部意义（更细致、
 * 不许写字、不许写留白方向）一条都没生效。
 */
function craftMd(): string {
  const p = path.join(libraryRoot(), 'image-prompt-craft.md');
  const raw = fs.existsSync(p) ? fs.readFileSync(p, 'utf-8').trim() : '';
  if (raw.length < 200) {
    throw new PromptCraftError(
      `生图提示词创作规范读不到（${p}）—— 那份 md 是润色/重写这两步唯一的指令来源，缺了它模型按自己的均值改（读起来通顺，而「不许写字」「不许写留白方向」这些规则一条都没生效）。`
    );
  }
  return raw;
}

/**
 * 那份 md 按这一行切成两半：上半是润色（只回一句），下半是重写整条（回一整条）。
 *
 * **不许合着发**：两半的「输出格式」是相反的，合在一起模型自己挑一边 —— 润色回来一整条被
 * 存成「画什么」那一句（画风模板套在一整条提示词外面），或者重写回来一句话把整条顶掉
 * （画风/比例/尾巴全没了），两种都 200 而框里那段读起来都很正常。
 */
const REWRITE_HEADING = '## 重写整条';
/** 只认**行首**那一行：md 的前言里也提了这个标题（「按「## 重写整条」那一行切成两半」），
 *  按 `indexOf` 找的话切点落在前言里 —— 润色那半份只剩几十个字（会被下面那条长度判据拦住，
 *  但拦住之后两个按钮一起报错，而 md 明明是全的）。 */
const REWRITE_AT = /^## 重写整条/m;

/** 润色那一步的指令（md 的上半）。 */
export function craftRules(): string {
  const raw = craftMd();
  const at = raw.search(REWRITE_AT);
  const part = (at === -1 ? raw : raw.slice(0, at)).trim();
  if (part.length < 200) {
    throw new PromptCraftError(
      `生图提示词创作规范的「润色」那一半只剩 ${part.length} 字（image-prompt-craft.md 里「${REWRITE_HEADING}」之前的部分）—— 那是润色唯一的指令来源。`
    );
  }
  return part;
}

/**
 * 重写那一节末尾的三小节，**由代码按这一格现在是哪一路挑一节发出去**（`slot` = 版式里那一格
 * 的三路，`backdrop` / `poster` = 整页那两路）。
 *
 * 三节的要求是**互相冲突**的：普通图「一个字都不许有」对上单图「那几行字要印在画面里」、
 * 普通图「主体离四边留一点」对上背景图「四边直接出血」。三节一起发（或者挑错一节）的话，
 * 模型自己挑一边，回来那一整条读起来更专业 —— 而背景图缩在中间围一圈白边 / 单图里一个字都没印 /
 * 普通图里多出一堆乱码假字，接口 200、缩略图也好看，每张都真花了钱。
 */
const REWRITE_MODE_HEADS = /^### (slot|backdrop|poster) 重写要求[^\n]*$/gm;

/**
 * 重写整条那一步的指令（md 的下半：公共那几节 + **这一路那一节**）。
 *
 * 缺了必须抛：**退回用上半那份的话**发出去的规范写着「只回一句话」，模型回来一句话被当成整条
 * 提示词存进这一格 —— 画风、比例、禁忌尾巴一句不剩，而框里那句读起来完全正常，图回来只是
 * 「怎么又不是这个画风了」。这一路那一节缺了同理**不许拿公共那几节凑**：那几节里没有
 * 「背景图不许有边框/暗角」「单图那几行字要印在画面里」这些互斥的要求，少了它们回来那条
 * 读起来照样专业（见 `REWRITE_MODE_HEADS`）。
 */
export function rewriteRules(mode: ImageMode): string {
  const raw = craftMd();
  const at = raw.search(REWRITE_AT);
  const body = at === -1 ? '' : raw.slice(at).trim();
  const key = isPageMode(mode) ? mode : 'slot';
  const heads = [...body.matchAll(REWRITE_MODE_HEADS)];
  const common = (heads.length ? body.slice(0, heads[0].index!) : body).trim();
  if (common.length < 200) {
    throw new PromptCraftError(
      `生图提示词创作规范里找不到「${REWRITE_HEADING}」那一节（image-prompt-craft.md，公共那几节只解析出 ${common.length} 字）—— 那一节是「AI 重写整条」唯一的指令来源，缺了它这个按钮只能整条拒掉，不能拿润色那半份凑（那半份写的是「只回一句话」）。`
    );
  }
  const mine = heads.find((h) => h[1] === key);
  if (!mine) {
    throw new PromptCraftError(
      `生图提示词创作规范里找不到「### ${key} 重写要求」那一节（image-prompt-craft.md 末尾那三节，现在有 ${heads.map((h) => h[1]).join(' / ') || '零'} 节）—— ` +
        '这一格是这一路，而三路的要求是互相冲突的（普通图「一个字都不许有」对上单图「那几行字要印在画面里」、普通图「主体离四边留一点」对上背景图「四边出血」）。' +
        '拿公共那几节凑的话回来那条读起来照样专业，而背景图缩在中间围一圈白边 / 单图里一个字都没印，一处都不报错。'
    );
  }
  const after = heads.filter((h) => h.index! > mine.index!).map((h) => h.index!);
  const block = body.slice(mine.index!, after.length ? after[0] : body.length).trim();
  if (block.length < 120) {
    throw new PromptCraftError(
      `生图提示词创作规范里「### ${key} 重写要求」那一节只剩 ${block.length} 字（image-prompt-craft.md）—— 这一路的要求就写在那一节里，空着的话发出去的规范对这一路等于没说。`
    );
  }
  return `${common}\n\n${block}`;
}

interface CraftInput {
  /** 他现在那句「画什么」 */
  subject: string;
  /** 这一格是哪一路（由代码从这一页的 html 现算，不是规划里那个字段） */
  mode: string;
  /** 主题 · 章节 · 页标题 */
  theme: string;
  /** 这一格会套的那套画风的名字（只作上下文，模板那几句由代码拼） */
  styleName: string;
}

function buildCraftPrompt(input: CraftInput): string {
  return [
    craftRules(),
    '',
    '---',
    '',
    `这一页：${input.theme || '（没给主题）'}`,
    `这一格是：${input.mode}`,
    `这一格会套的画风：${input.styleName}（画风、机位、留白、尺寸那几段由代码拼，你不要写）`,
    '',
    '他现在写的「画什么」：',
    input.subject,
    '',
    '按上面的规范把这一句改写得更具体、更有设计感。只回改写后的那一句。',
  ].join('\n');
}

export interface OutInfo {
  finish?: string;
  reasoningTokens?: number;
  noThinkingRequested?: boolean;
  noThinkingRefused?: boolean;
}

/**
 * 「模型一个字都没返回」时那半句「怎么办」。**润色 / 重写 / 生成提纲那几条路共用这一份**（同 `jsonFailMessage` 的
 * 理由）：各写一份的话改了一边另一边照旧，而两边是同一个模型的同一个毛病 ——
 * 「关思维链被上游拒了」尤其：那个勾选框在这条接入点上是死路，话术里不说的话他会反复回去核它。
 */
export function explainEmpty(info: OutInfo, budget: number): string {
  if (info.noThinkingRefused) {
    return '这条接入点的模型**关不掉思维链**（上游明确拒了），这次是退到最低档跑的 —— 后台那个「关思维链」勾选框对它没用，只能换一个不带思维链的模型';
  }
  if (info.noThinkingRequested && (info.reasoningTokens ?? 0) > 0) {
    return `这次已经把「不使用深度思考」发给上游了，但它照样想了 ${info.reasoningTokens} token —— 这个开关对这条接入点无效，后台再勾一遍没有用，只能换一个不带思维链的模型`;
  }
  if ((info.reasoningTokens ?? 0) >= budget * 0.9) {
    return `这次 ${budget} token 基本全花在思维链上了，正文没开始写。再点一次通常就好`;
  }
  return '再点一次，或者去「专属 AI / 系统配置」换一条接入点';
}

/**
 * 从返回文本里取出那一句。
 *
 * 这条路不吐 JSON，所以不用 `jsonFailMessage`（那句话会写成「没按 JSON 返回」，把人往格式上指），
 * 但三种成因照它的口径分开说：空返回 / 截断 / 回了一堆别的。
 */
function pickOneLine(raw: string, info: OutInfo): { subject: string; problems: string[] } {
  const problems: string[] = [];
  const cot = info.reasoningTokens ? `，其中思维链占 ${info.reasoningTokens} token` : '';
  if (!raw.trim()) {
    throw new PromptCraftError(
      `模型一个字都没返回（finish_reason=${info.finish || '未知'}${cot}），这一句没改成。${explainEmpty(info, MAX_CRAFT_TOKENS)}（这次的 AI 额度已经扣了）`
    );
  }
  const lines = raw
    .replace(/```[a-z]*/gi, '')
    .split('\n')
    .map((l) =>
      l
        .trim()
        .replace(/^[-*>\d.、)\s]+/, '')
        .replace(/^(主体|画什么|润色后的?那?一?句?|改写后的?那?一?句?|输出)\s*[:：]\s*/, '')
        .replace(/^[「『“"']+/, '')
        .replace(/[」』”"']+$/, '')
        .trim()
    )
    .filter(Boolean);
  if (!lines.length) {
    throw new PromptCraftError(
      `模型回的是一段没有内容的文字（finish_reason=${info.finish || '未知'}${cot}），这一句没改成。再点一次（这次的 AI 额度已经扣了）。`
    );
  }
  // 它有时会回「好的，这是润色后的提示词：」+ 那一句，或者干脆列三个方案 —— 取最长的那一行
  // （那一行才是画面描述），但**必须说出来**：静默只取一行的话，他以为润色只出了这一句，
  // 而另外两个方案连存在过都不知道。
  const best = lines.reduce((a, b) => (b.length > a.length ? b : a));
  if (lines.length > 1) {
    problems.push(
      `模型回了 ${lines.length} 段，这里只采用了最长的那一段（其余是它的说明或别的方案，已经丢掉）。不满意就再点一次润色，或者直接在框里改。`
    );
  }
  if (info.finish === 'length') {
    problems.push(
      `这一句被截断了（finish_reason=length${cot}）：句子末尾可能是半截的。` +
        '截断的半句照样能生出一张图，而你写在后面的条件一个都没生效 —— 再点一次润色，或者在框里把它补完。'
    );
  }
  return { subject: best, problems };
}

/** 润色回来那句里写了「代码负责的那几样」时要喊的话（不改它，只出声）。 */
function crossChecks(subject: string): string[] {
  const out: string[] = [];
  const space = subject.match(/留白|左侧|右侧|画面左|画面右|居中|中间空|页眉|页脚|16:9|9:16|竖构图|横构图|比例/);
  if (space) {
    out.push(
      `润色回来那句里自己写了构图位置/尺寸（「${space[0]}」）—— 代码算的那一句（这一页文字真正压住的那一块）紧接在它后面，两句说的不是同一块时模型自己挑一边，回来的图可能正好把主体放在标题底下。要么在框里把那半句删掉，要么再点一次润色。`
    );
  }
  const text = subject.match(/文字|字母|数字|标签|图注|标题|logo|LOGO|水印|界面|按钮/);
  if (text) {
    out.push(
      `润色回来那句里要了画面上的字（「${text[0]}」）—— 提示词尾巴写死了「不许出现任何文字」，两句冲突时模型自己挑一边，挑了写字那边回来就是一张带乱码假字的图（而它会被当成正常结果贴进这一页）。建议在框里把那半句删掉。`
    );
  }
  const left = leftoverPlaceholders(subject);
  if (left.length) {
    out.push(`润色回来那句里有 ${left.join(' / ')} —— 这几个字会原样发给模型（代码只替换模板里的占位符，不替换这一句里的）。`);
  }
  return out;
}

/**
 * 润色这一格的「画什么」，并把**整条**重新拼一遍回去（不生图、不扣图额度、不写库）。
 *
 * 返回的 `subject` 要一起存进这一格的规格（调用方负责），否则他点「确定生成」之后库里那句
 * 还是旧的 —— 下次打开这个框，框里又是没润色过的那条，而界面上一处都不说。
 */
export async function polishSpecPrompt(
  spec: PlannedImage,
  ctx: SpecImageContext,
  userId: string
): Promise<{
  subject: string;
  before: string;
  prompt: string;
  styleId: string;
  styleName: string;
  mode: string;
  ratio: string;
  size: string;
  problems: string[];
  usage: { input_tokens: number; output_tokens: number; total_tokens: number };
}> {
  const before = spec.subject.trim();
  if (!before) {
    throw new PromptCraftError(
      `第 ${ctx.index} 格还没写「画什么」，没有可以润色的那一句（润色只改这一句 —— 画风、留白、尺寸那几段是代码拼的）。`
    );
  }
  // 现在这一格是哪一路 / 什么画风，一律按代码那条路算出来的为准（模式是从这一页的 html 现算的，
  // 规划里那个字段可能还写着 concept）—— 传错的话润色出来的是给概念插画写的那句，而这一页
  // 是整页背景图，两段中文读起来都很正常。
  const now = previewSpecPrompt({ ...spec, fullPrompt: undefined }, ctx);
  const theme = [ctx.topic, ctx.section, ctx.title].filter(Boolean).join(' · ');

  const { response, usage, noThinking, noThinkingRefused } = await aiGateway(
    {
      messages: [
        { role: 'user', content: buildCraftPrompt({ subject: before, mode: modeCn(now.mode), theme, styleName: now.styleName }) },
      ],
      temperature: 0.9,
      max_tokens: MAX_CRAFT_TOKENS,
    },
    // 不指定 tier（走 default）：平台渠道可能压根没有 strong 那一档。
    { userId, source: 'ppt', operation: 'craft-image-prompt', noThinking: true }
  );

  const { subject, problems } = pickOneLine(response.choices[0]?.message?.content || '', {
    finish: response.choices[0]?.finish_reason,
    reasoningTokens: (response.usage as any)?.completion_tokens_details?.reasoning_tokens,
    noThinkingRequested: noThinking,
    noThinkingRefused,
  });
  if (subject.length > MAX_SUBJECT_CHARS) {
    // 只拒不截（同 `MAX_SUBJECT_CHARS` 那条）：截一半照样能生图，而他以为润色成功了。
    throw new PromptCraftError(
      `润色回来那句有 ${subject.length} 字，超过 ${MAX_SUBJECT_CHARS} 字上限，没有采用（框里还是原来那条）。再点一次通常就短了（这次的 AI 额度已经扣了）。`
    );
  }

  // **`fullPrompt` 必须摘掉再渲染**：不摘的话 `buildImagePrompt` 在最前面就把他改写的那一整条
  // 原样返回了 —— 按钮转完一圈、额度扣了一次，而框里那一大段一个字都没变，他只会再点几次
  // （每次都真扣一次），而两处都不报错。
  const after = previewSpecPrompt({ ...spec, subject, fullPrompt: undefined }, ctx);
  return {
    subject,
    before,
    prompt: after.prompt,
    styleId: after.styleId,
    styleName: after.styleName,
    mode: after.mode,
    ratio: after.ratio,
    size: after.size,
    problems: [...problems, ...crossChecks(subject), ...after.problems],
    usage,
  };
}

/**
 * 「AI 重写整条」的 token 上限。比润色那条大一截（要回的是一整条 ≈ 600 字），
 * 剩下的照旧是留给思维链的空间（硬规则 2）—— 调低不省钱，只是把偶发的长思维链变成
 * 确定性的「模型一个字都没返回」。
 */
const MAX_REWRITE_TOKENS = 4000;

/**
 * 重写回来那一整条的清洗。**和 `pickOneLine` 的差别是「多行是正常的」** ——
 * 那边取最长的一行（整条里的换行会被它当成几个方案），这里只砍开场白，其余合成一段。
 */
function pickWholePrompt(raw: string, info: OutInfo): { prompt: string; problems: string[] } {
  const problems: string[] = [];
  const cot = info.reasoningTokens ? `，其中思维链占 ${info.reasoningTokens} token` : '';
  if (!raw.trim()) {
    throw new PromptCraftError(
      `模型一个字都没返回（finish_reason=${info.finish || '未知'}${cot}），这一条没重写成。${explainEmpty(info, MAX_REWRITE_TOKENS)}（这次的 AI 额度已经扣了）`
    );
  }
  const lines = raw
    .replace(/```[a-z]*/gi, '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  // 「好的，以下是重写后的提示词：」那一行。**只砍开头、只砍冒号结尾的短句**：整条提示词里
  // 没有这种行，而多砍一行的话砍掉的是画面描述（他不会发现少了一句，图回来只是「差点意思」）。
  while (lines.length > 1 && /^[^。；]{0,40}[:：]$/.test(lines[0]) && /^(好的|没问题|以下是|这是|下面|重写|最终|输出|提示词)/.test(lines[0])) {
    lines.shift();
  }
  if (!lines.length) {
    throw new PromptCraftError(
      `模型回的是一段没有内容的文字（finish_reason=${info.finish || '未知'}${cot}），这一条没重写成。再点一次（这次的 AI 额度已经扣了）。`
    );
  }
  lines[0] = lines[0].replace(/^(重写后的?那?一?条?|重写结果|最终提示词|提示词|输出)\s*[:：]\s*/, '');
  // 一行行合成一段，和代码拼那条一样（`renderStylePrompt` 末尾也把换行压成空格）——
  // 留着换行的话他在框里看到的分段和真发出去的不一样。
  const prompt = lines
    .join(' ')
    .replace(/^[「『“"']+/, '')
    .replace(/[」』”"']+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  // 它有时会回「方案一 / 方案二」。这里**不替他挑**（整条提示词没法像一句话那样取最长的），
  // 只喊出来：静默发出去的话两套画面描述叠在一条里，模型自己拼一张，而那一整条读起来很正常。
  if (/方案[一二三1２3]|版本[一二三]|Option\s*[12]/i.test(prompt)) {
    problems.push(
      '重写回来那条里像是给了好几个方案（出现了「方案一 / 版本二」这种字样）—— 整条会被原样发给生图模型，' +
        '两套画面描述叠在一起时它自己拼一张。请在框里只留下你要的那一段，或者再点一次重写。'
    );
  }
  if (info.finish === 'length') {
    problems.push(
      `这一条被截断了（finish_reason=length${cot}）：末尾多半是半截的句子。` +
        '截断的半句照样能生出一张图，而写在后面的条件一个都没生效 —— 再点一次重写，或者在框里把它补完。'
    );
  }
  return { prompt, problems };
}

/**
 * 代码算的那几段少了就**接回去并出声**（`requiredPromptParts`）。
 *
 * 这是重写这条路上最容易骗人的地方：模型把「左边 0–50% 留给文字」「16:9 横构图」「文字内容：…」
 * 改写得更顺口、或者干脆删掉，回来那一整条读起来比原来专业 —— 而图回来主体压在标题底下、
 * 比例不对被裁掉一半、印在图上的是它编的文案（硬规则 3），接口 200、缩略图也好看。
 * 接回去之后**必须说是哪几段**：不说的话他以为模型照他的要求写全了，下次还这么用。
 */
function pinRequired(prompt: string, parts: RequiredPromptPart[]): { prompt: string; problems: string[] } {
  const missing = parts.filter((p) => !p.probes.every((q) => prompt.includes(q)));
  if (!missing.length) return { prompt, problems: [] };
  return {
    prompt: `${prompt} ${missing.map((p) => p.text).join(' ')}`.trim(),
    problems: [
      `重写回来那条里少了（或被改写了）${missing.map((p) => p.label).join('、')} —— 已经把代码算的那几句原样接在末尾了。` +
        '它自己改写的那半句还留在前面：两句说的不是同一块（留白方向、比例、要印的字）时模型自己挑一边，' +
        '在框里把它改写的那半句删掉最稳。',
    ],
  };
}

function buildRewritePrompt(input: {
  base: string;
  theme: string;
  /** 这一路（`slot` 三路 / `backdrop` / `poster`）：**规范挑哪一节由它决定** */
  mode: ImageMode;
  modeCn: string;
  styleName: string;
  parts: RequiredPromptPart[];
}): string {
  return [
    rewriteRules(input.mode),
    '',
    '---',
    '',
    `这一页：${input.theme || '（没给主题）'}`,
    `这一格是：${input.modeCn}`,
    `这一格现在套的画风：${input.styleName}`,
    '',
    '必须原样保留的那几句（一个字都不要改，照原样留在末尾）：',
    ...input.parts.map((p) => `- ${p.text}`),
    '',
    '现在这一整条：',
    input.base,
    '',
    '按上面的规范把这一整条重写一遍，只回重写后的那一整条。',
  ].join('\n');
}

/**
 * 「AI 重写整条」：让模型重写**会原样发出去的那一整条**（不生图、不写库）。
 *
 * 和润色是两件事，界面上必须分开说：润色改的是「画什么」那一句、整条照旧由代码拼（换画风
 * 还跟着走）；重写回来那条会被存成这一格的**自定义整条**（`fullPrompt`）—— 从此换画风、
 * 切背景图/单图、改配色、改「画什么」都不再影响它。两个按钮做同一件事的话他会以为重写完
 * 还跟着画风走，换完画风回来发现这一格纹丝不动，而一处都不报错。
 *
 * 基线用**他框里那一条**（`draft`）：拿库里/现拼的那条重写的话，他刚在框里逐句调好的几句
 * 全被丢掉，而回来那条读起来更专业 —— 他要的那几句连丢在哪一步都看不出来。
 */
export async function rewriteSpecPrompt(
  spec: PlannedImage,
  ctx: SpecImageContext,
  userId: string,
  draft?: string
): Promise<{
  prompt: string;
  before: string;
  styleId: string;
  styleName: string;
  mode: string;
  ratio: string;
  size: string;
  problems: string[];
  usage: { input_tokens: number; output_tokens: number; total_tokens: number };
}> {
  // 框里那一条（自定义就是自定义那条）；框里是空的才退到代码现拼的那条。
  const shown = previewSpecPrompt(spec, ctx);
  const base = (draft || '').trim() || shown.prompt;
  if (base.length > MAX_FULL_PROMPT_CHARS) {
    throw new PromptCraftError(
      `框里这一条有 ${base.length} 字，超过 ${MAX_FULL_PROMPT_CHARS} 字上限，没有发出去（这次没扣额度）。先改短一点。`
    );
  }
  // 模式/比例/画风一律按代码那条路算出来的为准（模式是从这一页 html 现算的，规划里那个字段
  // 可能还写着 concept）—— 传错的话重写出来那条是给概念插画写的，而这一页是整页背景图。
  const auto = previewSpecPrompt({ ...spec, fullPrompt: undefined }, ctx);
  const parts = specPromptParts({ ...spec, fullPrompt: undefined }, ctx);
  const theme = [ctx.topic, ctx.section, ctx.title].filter(Boolean).join(' · ');

  const { response, usage, noThinking, noThinkingRefused } = await aiGateway(
    {
      messages: [
        {
          role: 'user',
          // `auto.mode` 是**从这一页 html 现算**的那一路（规划里那个字段可能还写着 concept）——
          // 规范挑哪一节全靠它：传规划那份的话他切成背景图/单图之后，重写用的还是普通图那一节
          // （「一个字都不许有」「主体离四边留一点」），回来那条读起来照样专业。
          content: buildRewritePrompt({ base, theme, mode: auto.mode, modeCn: modeCn(auto.mode), styleName: auto.styleName, parts }),
        },
      ],
      temperature: 0.9,
      max_tokens: MAX_REWRITE_TOKENS,
    },
    // 不指定 tier（走 default）：平台渠道可能压根没有 strong 那一档。
    { userId, source: 'ppt', operation: 'rewrite-image-prompt', noThinking: true }
  );

  const out = pickWholePrompt(response.choices[0]?.message?.content || '', {
    finish: response.choices[0]?.finish_reason,
    reasoningTokens: (response.usage as any)?.completion_tokens_details?.reasoning_tokens,
    noThinkingRequested: noThinking,
    noThinkingRefused,
  });
  const problems = [...out.problems];
  // 只回了一小段：画风、机位、光线那几段多半被压掉了（尾巴/比例/要印的字下面会接回去，
  // 那几段接不回来）。不喊的话他以为「重写」把整条写全了，而发出去的是一句话。
  if (out.prompt.length < base.length * 0.5) {
    problems.push(
      `重写回来那条只有 ${out.prompt.length} 字，原来那条 ${base.length} 字 —— 画风、机位、光线那几段多半被压掉了（那几段接不回来）。` +
        '照这条发出去的图会明显换个路子：要么再点一次重写，要么点「恢复成自动拼的那条」重来。'
    );
  }
  const pinned = pinRequired(out.prompt, parts);
  problems.push(...pinned.problems);
  if (pinned.prompt.length > MAX_FULL_PROMPT_CHARS) {
    // 只拒不截（同 `MAX_FULL_PROMPT_CHARS` 那条）：截一半照样能生图，而他以为重写成功了。
    throw new PromptCraftError(
      `重写回来那条有 ${pinned.prompt.length} 字，超过 ${MAX_FULL_PROMPT_CHARS} 字上限，没有采用（框里还是原来那条）。再点一次通常就短了（这次的 AI 额度已经扣了）。`
    );
  }
  const left = leftoverPlaceholders(pinned.prompt);
  if (left.length) {
    problems.push(
      `重写回来那条里有 ${left.join(' / ')} —— 这几个字会原样发给模型（自定义那条代码不再替换占位符）。`
    );
  }
  return {
    prompt: pinned.prompt,
    before: base,
    styleId: auto.styleId,
    styleName: auto.styleName,
    mode: auto.mode,
    ratio: auto.ratio,
    size: auto.size,
    problems,
    usage,
  };
}
