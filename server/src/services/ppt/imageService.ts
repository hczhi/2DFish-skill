// 给已生成的那一页真的配图：扫出所有 `data-img-prompt` 的槽位，逐个生图，把
// 占位图的地址换成转存后的永久地址。
//
// 生图走 `core/image/imageGateway.ts`（kind='image' 的接入点，后台可配），这一层管的是
// 「哪几个槽位、用什么提示词、图贴回哪里、以及每一种部分失败怎么说出来」。
//
// 四件事是承重的，少一件都是「看起来正常」的失败：
// ① **整页只解析一次接入点、只取一次画风，并把两样都绑死**（`providerId` / `styleId`）。
//    按 kind 解析时同 kind 有第二条会挑「最近更新的那条」，于是一页里的几张图可能出自
//    两个模型 —— 每张单看都不错，翻下来笔触不统一，而没有一处报错。画风同理：一份 deck
//    只能一个 styleId（见 styleLibrary.ts），而**换了画风之后已经配好的那几页不会自动
//    重做**，所以返回里必须带上这次用的 styleId 让界面能对出差异。
// ② **失败的槽位保留占位图**，绝不把 src 换成一个坏地址：破图和「这一格本来是空的」
//    在屏幕上长得一样，而占位图明显是「还没配图」。
// ③ **额度按张扣**（应用额度 + 总额，顺序和 aiGateway 一致），撞墙时**不回滚已经生成的**
//    那几张 —— 那几张的钱已经花了，抛掉整个结果等于让用户再花一遍。
// ④ **`storage='local'` 必须出声**：图落在本机磁盘上，换机器/多实例部署之后那几张就是
//    404，而生成那一刻预览里一切正常。

import { checkAndDeductAppQuota, checkAndDeductQuota, QuotaExceededError } from '../../core/llm/gateway.js';
import { logAIUsage } from '../../core/llm/client.js';
import { generateImage } from '../../core/image/imageGateway.js';
import { resolveImageProvider } from '../../services/aiProviderService.js';
import { assembleDeck, type DeckMeta } from './deckShell.js';
import { PLACEHOLDERS } from './pageService.js';
import {
  styles, styleById, defaultStyleId, renderStylePrompt, leftoverPlaceholders,
  IMAGE_MODES, type ImageMode, type PptStyle,
} from './styleLibrary.js';

/** 一次请求最多给一页配几张。超了只拒不截 —— 悄悄只做前几张的话剩下几格还是占位图。 */
export const MAX_SLOTS_PER_PAGE = 6;

/** 单张生图的上限。缺省 180 秒 × 6 张 = 一个能把反代拖到超时的请求。 */
const IMAGE_TIMEOUT_MS = 120_000;

export class PptImageError extends Error {}

export interface ImageSlot {
  index: number;
  prompt: string;
  /** 这一格要哪一路模板（页面上的 `data-img-mode`，没写按 concept 算） */
  mode: ImageMode;
  /** 槽位现在的地址（占位图或上一次生成的图） */
  src: string;
  /** 图贴在哪：`src` 属性还是 style 里的 `background-image: url(...)` */
  via: 'src' | 'bg' | 'none';
  ratio: string;
  /** 整个开标签的原文（替换时按它找回来） */
  tag: string;
  at: number;
}

export interface FilledImage {
  index: number;
  prompt: string;
  mode: ImageMode;
  ratio: string;
  url?: string;
  error?: string;
  skipped?: boolean;
  storage?: 'cos' | 'local';
  model?: string;
}

export interface FillImagesResult {
  html: string;
  previewHtml: string;
  images: FilledImage[];
  problems: string[];
  /** 撞额度了：前端要显眼提示，而不是当成「有几张失败」 */
  quotaExceeded: boolean;
  provider: { id: string; model: string };
  /** 这一页的图是用哪套画风生的（换了画风之后旧的那几页不会自动重做，界面要对得出来） */
  style: { id: string; name: string };
}

export interface FillImagesContext {
  userId: string;
  title: string;
  section?: string;
  topic?: string;
  /** true = 已经生成过的那几张也重做（缺省跳过，不重复花钱） */
  force?: boolean;
  /** 画风（S-A ~ S-F）。不给按 md 里标了「（默认）」的那一套算 */
  styleId?: string;
  meta: DeckMeta;
}

/**
 * 扫出这一页的图槽位。认的是 `data-img-prompt`（`pageService` 的 prompt 要求每个图元素
 * 都带它）—— 那也是这一步唯一的输入。
 */
export function findImageSlots(html: string): ImageSlot[] {
  const out: ImageSlot[] = [];
  // 开标签里不会出现裸 `>`（属性值都在引号里），所以按标签切就够。
  for (const m of html.matchAll(/<[a-zA-Z][^>]*\sdata-img-prompt="([^"]*)"[^>]*>/g)) {
    const tag = m[0];
    const src = tag.match(/\ssrc="([^"]*)"/)?.[1];
    const bg = tag.match(/url\(\s*['"]?([^'")\s]+)/)?.[1];
    const rawMode = tag.match(/\sdata-img-mode="([^"]*)"/)?.[1]?.trim().toLowerCase();
    out.push({
      index: out.length + 1,
      prompt: m[1].trim(),
      // 认不出的 mode 按 concept 算（模板缺一路的话这一格会静默换成另一路的画法）。
      mode: (IMAGE_MODES as string[]).includes(rawMode || '') ? (rawMode as ImageMode) : 'concept',
      src: src ?? bg ?? '',
      via: src !== undefined ? 'src' : bg !== undefined ? 'bg' : 'none',
      ratio: ratioOf(src ?? bg ?? ''),
      tag,
      at: m.index ?? 0,
    });
  }
  return out;
}

function ratioOf(url: string): string {
  if (url.includes('ph-16x9')) return '16:9 landscape';
  if (url.includes('ph-1x1')) return '1:1 square';
  if (url.includes('ph-3x4')) return '3:4 portrait';
  return '16:9 landscape';
}

function isPlaceholder(url: string): boolean {
  return PLACEHOLDERS.includes(url);
}

export async function fillPageImages(html: string, ctx: FillImagesContext): Promise<FillImagesResult> {
  const slots = findImageSlots(html);
  if (!slots.length) {
    // 回一个「成功、0 张」的话界面上和「配好图了」分不开，而这一页一张图都没换。
    throw new PptImageError(
      '这一页没有图槽位（没有带 data-img-prompt 的元素），没有可以生成的图。' +
        '想配图就换一个带图的版式再重新生成这一页。'
    );
  }
  if (slots.length > MAX_SLOTS_PER_PAGE) {
    throw new PptImageError(
      `这一页有 ${slots.length} 个图槽位，超过一次 ${MAX_SLOTS_PER_PAGE} 张的上限（一张图几十秒，再多这个请求会被反代掐断）。` +
        '换一个图少一点的版式，或者把这一页拆成两页。'
    );
  }

  // 画风也整页取一次（见文件头 ①）。**认不出的 styleId 一律拒**，不回落成默认那套：
  // 悄悄回落的话用户选了「国风水墨」拿到的是等距 SaaS 插画，每张单看都不错、没有一处
  // 报错，他只会以为这个模型画不了水墨。
  const styleId = (ctx.styleId || defaultStyleId()).trim().toUpperCase();
  const style = styleById(styleId);
  if (!style) {
    throw new PptImageError(
      `没有画风 ${styleId} —— 现有的是 ${styles().map((s) => `${s.id} ${s.name}`).join(' / ')}。`
    );
  }

  // 整页绑死同一条接入点（见文件头 ①）。这里解析一次，顺便知道钱是谁付的。
  const provider = resolveImageProvider(ctx.userId);
  if (!provider) {
    throw new PptImageError('未配置生图接入点：请在后台「AI 模型 Provider」里加一条 kind=image 的记录。');
  }
  const owner: 'platform' | 'dedicated' = provider.owner_user_id ? 'dedicated' : 'platform';

  const problems: string[] = [];
  const images: FilledImage[] = [];
  const newUrl = new Map<number, string>();
  let quotaExceeded = false;
  let localCount = 0;

  for (const slot of slots) {
    if (slot.via === 'none') {
      // 生成了也贴不上去 —— 那就是白花一次钱，而回复里会写「已生成」。
      problems.push(`第 ${slot.index} 个图槽位既没有 src 也没有 background-image url()，图贴不上去，这一格跳过了。`);
      images.push({ index: slot.index, prompt: slot.prompt, mode: slot.mode, ratio: slot.ratio, error: '没有可以写回的图片地址' });
      continue;
    }
    if (!slot.prompt) {
      problems.push(`第 ${slot.index} 个图槽位的 data-img-prompt 是空的（模型没写要什么图），这一格跳过了。`);
      images.push({ index: slot.index, prompt: '', mode: slot.mode, ratio: slot.ratio, error: 'data-img-prompt 为空' });
      continue;
    }
    if (!ctx.force && !isPlaceholder(slot.src)) {
      // 已经是生成过的图了。默认不重做 —— 重做一次是一次真实花费。
      images.push({ index: slot.index, prompt: slot.prompt, mode: slot.mode, ratio: slot.ratio, url: slot.src, skipped: true });
      continue;
    }

    try {
      // 额度按张扣，顺序和 aiGateway 一致（应用额度先扣，专属渠道烧自己的 key 不占总额）。
      checkAndDeductAppQuota(ctx.userId, 'ppt');
      if (owner !== 'dedicated') checkAndDeductQuota(ctx.userId);

      const t0 = Date.now();
      const prompt = buildImagePrompt(slot, ctx, style);
      // 模板里的 `<…>` / `{{…}}` 是给人看的填空说明，漏换的那几个会原样发给模型
      // （它会照着「本页主题，1句」画），而回来的图看着就是「这张不太对」。
      const left = leftoverPlaceholders(prompt);
      if (left.length) {
        problems.push(`第 ${slot.index} 张的提示词里还剩没换掉的占位符 ${left.join(' / ')} —— 这几个字会原样发给模型（画风模板改过？）。`);
      }
      const [img] = await generateImage(prompt, {
        userId: ctx.userId,
        providerId: provider.id,
        n: 1,
        timeoutMs: IMAGE_TIMEOUT_MS,
      });
      if (!img?.url) throw new Error('生图接口没有返回图片地址');

      // 生图原来完全不进 ai_logs —— 那意味着这笔钱在后台一处都看不见。
      logAIUsage(
        'ppt', 'gen-image', img.model, 0, 0, Date.now() - t0,
        `图槽位#${slot.index} ${slot.ratio} ${style.id}/${slot.mode}`, ctx.userId, prompt, img.url, img.provider, owner
      );

      newUrl.set(slot.index, img.url);
      if (img.storage === 'local') localCount++;
      images.push({
        index: slot.index, prompt: slot.prompt, mode: slot.mode, ratio: slot.ratio,
        url: img.url, storage: img.storage, model: img.model,
      });
    } catch (e: any) {
      if (e instanceof QuotaExceededError) {
        // 已经生成的那几张不回滚（钱花了），停在这里并说清楚 —— 接着往下跑只会拿到
        // 一串一样的错误，而中间夹着刚才那几张的成功。
        quotaExceeded = true;
        problems.push(
          `AI 额度用完了（${e.dailyLimit ? `上限 ${e.dailyLimit} 次/天` : ''}），第 ${slot.index} 张起没再生成。` +
            '已经生成的那几张已经贴上去了，明天 0 点重置后接着点「补齐这一页的图」。'
        );
        images.push({ index: slot.index, prompt: slot.prompt, mode: slot.mode, ratio: slot.ratio, error: '额度已用完' });
        break;
      }
      // 每种失败（模型名不对 / 余额不足 / 配的是视频模型 / 回了 200 但没有图）解法完全
      // 不同，所以带上游原文，不合成一句「生图失败」。
      const msg = e?.message || String(e);
      problems.push(`第 ${slot.index} 张没生成出来（这一格还是占位图）：${msg}`);
      images.push({ index: slot.index, prompt: slot.prompt, mode: slot.mode, ratio: slot.ratio, error: msg });
    }
  }

  if (localCount) {
    problems.push(
      `有 ${localCount} 张图存在本机磁盘上（COS 没配好，落在 /uploads 下）。` +
        '换机器或者多实例部署之后这几张会 404，而现在预览里一切正常 —— 要长期用请在后台把 COS 配好再重新生图。'
    );
  }

  const filled = replaceSlotUrls(html, slots, newUrl);
  return {
    html: filled,
    previewHtml: assembleDeck([filled], ctx.meta),
    images,
    problems,
    quotaExceeded,
    provider: { id: provider.id, model: provider.model },
    style: { id: style.id, name: style.name },
  };
}

/** 从后往前替换（改前面会让后面记下来的位置全部错位）。 */
function replaceSlotUrls(html: string, slots: ImageSlot[], urls: Map<number, string>): string {
  let out = html;
  for (const slot of [...slots].reverse()) {
    const url = urls.get(slot.index);
    if (!url) continue;
    const tag =
      slot.via === 'src'
        ? slot.tag.replace(/(\ssrc=")[^"]*(")/, (_m, a, b) => `${a}${url}${b}`)
        : slot.tag.replace(/url\(\s*['"]?[^'")\s]+['"]?\s*\)/, () => `url(${url})`);
    out = out.slice(0, slot.at) + tag + out.slice(slot.at + slot.tag.length);
  }
  return out;
}

/**
 * 提示词照**画风模板**渲染（`styleLibrary.renderStylePrompt`），不在这里拼一段自己的
 * 画风描述：拼一份的话「换画风」这个下拉换的是别的东西 —— 图的笔触压根不跟着变，
 * 而每张图单看都不错、没有一处报错。
 */
function buildImagePrompt(slot: ImageSlot, ctx: FillImagesContext, style: PptStyle): string {
  const theme = [ctx.topic, ctx.section, ctx.title].filter(Boolean).join(' · ');
  return renderStylePrompt(style, slot.mode, {
    theme,
    scene: `${slot.prompt}. Single focal subject, safe margins.`,
    ratio: slot.ratio,
  });
}
