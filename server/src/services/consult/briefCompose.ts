// 新建项目时把「他手打的那段」和「上传的几个文件整理出来的几份」合成一份客户资料。
//
// **合成在服务端，前端只回传每份文字**（同 `/intake/apply` 那条「不收整份 brief」）：
// 前端自己拼好整份回传的话，「第 3 个文件静默没进去」这件事在界面上完全看不出来 ——
// 资料框里少一节，而剩下的读起来照样是一份完整的资料，后面十二步就照着少一份的资料推。
// 合成规则（分节标题、来源标注、上限）也只有这一份，两边各拼一次必然漂。
//
// 这里的每一种拒绝都是「只拒不截」（同 projectStore 那条）：文件内容是**自动带上**的，
// 用户不再逐份点「插入」，所以静默截掉/丢掉一份的后果比以前更隐蔽 —— 他连那份东西
// 进没进去都不会去核。

import { StageError } from './draftService.js';
import { MAX_BRIEF_CHARS } from './projectStore.js';
import { TIDY_BUDGET_CHARS } from './fileTidyService.js';

/**
 * 一次最多带几个文件。这个数和 {@link TIDY_BUDGET_CHARS} 是一对：
 * 5 × 3500 = 17500，加上手打的那段还得装进 {@link MAX_BRIEF_CHARS}（20000）。
 * 放开它就要同时动那两个数，否则表现是「传满 5 个之后创建项目一直被拒」。
 */
export const MAX_ATTACHMENTS = 5;

export interface BriefAttachment {
  filename: string;
  text: string;
  /** 带进去的是整理稿还是原文 —— 只影响那行分节标注（见 attachmentBlock）。 */
  variant: 'tidy' | 'raw';
}

/**
 * 一个文件在资料里的那一节。**必须标出来源和它是原文还是整理过的**：混进正文的话，
 * 过两天分不清哪句是客户自己写的、哪句是从 PPT 里抠的、哪句是 AI 重新组织过的 ——
 * 而后面十二步对这三种的可信度完全不同（AI 整理过的那份可能已经把一条事实说法改了）。
 */
export function attachmentBlock(a: BriefAttachment): string {
  return `【上传文件：${a.filename}（${a.variant === 'tidy' ? 'AI 整理' : '原文'}）】\n${a.text.trim()}`;
}

/**
 * 合成最终的 brief。**前端 `ConsultCreate.vue` 里那个「合计 N 字」是同一口径的第二份**
 * （提前告诉他超没超上限），改这里的拼法必须改那边 —— 两边不一致时界面上看不出来，
 * 表现是「显示 19800 字，点创建被拒 20300 字」。
 */
export function composeBrief(typed: string, list: BriefAttachment[]): string {
  return [typed.trim(), ...list.map(attachmentBlock)].filter((s) => s.trim()).join('\n\n');
}

/**
 * 收前端传来的 attachments 并逐条校验。失败一律 StageError(400) 并**点名是哪个文件**：
 * 合成一句「资料超长」的话他不知道该去删哪一份，而这五份在界面上是五张一样的卡片。
 */
export function parseAttachments(raw: unknown): BriefAttachment[] {
  if (raw == null) return [];
  if (!Array.isArray(raw)) throw new StageError('attachments 要是一个数组。', 400);
  if (raw.length > MAX_ATTACHMENTS) {
    throw new StageError(
      `一次最多带 ${MAX_ATTACHMENTS} 个文件的内容，这次给了 ${raw.length} 个。`
        + '（多出来的不会被悄悄丢掉 —— 丢掉那一份在资料里就是少一节，而剩下的读起来完全正常。）',
      400
    );
  }

  const list: BriefAttachment[] = [];
  raw.forEach((item, i) => {
    const o = (item ?? {}) as Record<string, unknown>;
    const filename = String(o.filename || '').trim().slice(0, 200) || `未命名文件 ${i + 1}`;
    const text = String(o.text ?? '').trim();
    // 空的那一份**报错而不是跳过**：跳过的话资料里少一节，他以为那个文件带进去了。
    if (!text) {
      throw new StageError(
        `「${filename}」这一份是空的（一个字都没有）。请把它删掉，或者切到「原文」那一栏再提交 ——`
          + '空的那份不会被悄悄跳过：跳过之后资料里少一整节，而剩下的读起来完全正常。',
        400
      );
    }
    if (text.length > TIDY_BUDGET_CHARS) {
      throw new StageError(
        `「${filename}」有 ${text.length} 字，超过单个文件的上限 ${TIDY_BUDGET_CHARS} 字`
          + `（超出 ${text.length - TIDY_BUDGET_CHARS} 字）。请在那张卡片里自己删减，或者重新整理一次。\n`
          + '不自动截断是有意的：截掉的正好是排在后面的那几节（用户与客群、当前问题与目标），'
          + '而剩下那份读起来照样完整，后面十二步就照着它推。',
        400
      );
    }
    // 字段名叫 variant 而不是 source：`source: '…'` 在这个仓库里是 gateway 的应用名，
    // 有一条测试扫全库的那个字面量（src/test/aiAppRegistry.test.ts）—— 借用它会把那道
    // 闸门的报错变成噪音，而它守的是「按应用配 token/配额静默失效」。
    list.push({ filename, text, variant: o.variant === 'raw' ? 'raw' : 'tidy' });
  });
  return list;
}

/**
 * 合成 + 查总长。超了**只拒不截**，并把每一份各占多少字列出来 —— 只说「超了 3000 字」
 * 的话他得自己一份份数，而这五张卡片长得一模一样。
 */
export function buildBrief(typed: string, rawAttachments: unknown): string {
  const list = parseAttachments(rawAttachments);
  const brief = composeBrief(typed, list);
  if (brief.length > MAX_BRIEF_CHARS) {
    const breakdown = [
      `你手打的 ${typed.trim().length} 字`,
      ...list.map((a) => `${a.filename} ${attachmentBlock(a).length} 字`),
    ].join('、');
    throw new StageError(
      `资料合计 ${brief.length} 字，超过上限 ${MAX_BRIEF_CHARS} 字（超出 ${brief.length - MAX_BRIEF_CHARS} 字）。`
        + `其中：${breakdown}。请删掉一个文件或者删减其中的内容再提交。\n`
        + '不会自动截断：这段资料是后面十二步唯一的事实依据，砍掉后半段的话 AI 是照着半份资料'
        + '出结论的，而每一步的正文读起来完全正常。',
      400
    );
  }
  return brief;
}
