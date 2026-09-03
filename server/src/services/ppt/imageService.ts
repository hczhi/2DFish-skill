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
import { rememberAsset } from './assetStore.js';
import { MAX_SLOTS_PER_PAGE, type PlannedImage, type PreparedImage } from './imageSpec.js';
import { PLACEHOLDERS } from './pageService.js';
import {
  styles, styleById, defaultStyleId, renderStylePrompt, leftoverPlaceholders,
  IMAGE_MODES, type ImageMode, type PptStyle,
} from './styleLibrary.js';

// 一页最多几张图定义在 `imageSpec.ts`：规划那一步也要按同一个数出规格，
// 各写一份的话规划会备出 8 张而这里只肯配 6 张，多出来那两张的钱已经花了。
export { MAX_SLOTS_PER_PAGE } from './imageSpec.js';

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
  /** 出处（写进素材库那一行）。不给也照样进库，只是列表上看不出这张是哪份稿子的。 */
  deckId?: string;
  page?: number;
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

/**
 * 规划里的 `16:9` / `1:1` / `3:4` 写成提示词里那句话，和 `ratioOf`（按占位图文件名认）
 * 落在同一套字面上。两条路各写一份的话，同一句 subject 先备图和后配图生出来的图不是一个
 * 构图（一张横的一张方的），而两边都不报错。
 */
export function ratioText(ratio: string): string {
  if (ratio.startsWith('1:1')) return '1:1 square';
  if (ratio.startsWith('3:4')) return '3:4 portrait';
  return '16:9 landscape';
}

/**
 * 画风。**认不出的 styleId 一律拒**，不回落成默认那套（见文件头 ①）：悄悄回落的话用户
 * 选了「国风水墨」拿到的是等距 SaaS 插画，每张单看都不错、没有一处报错。
 */
function resolveStyle(styleId?: string): PptStyle {
  const id = (styleId || defaultStyleId()).trim().toUpperCase();
  const style = styleById(id);
  if (!style) {
    throw new PptImageError(
      `没有画风 ${id} —— 现有的是 ${styles().map((s) => `${s.id} ${s.name}`).join(' / ')}。`
    );
  }
  return style;
}

/** 生图接入点。一次调用只解析一次并按 id 绑死（见文件头 ①）。 */
function resolveProvider(userId: string) {
  const provider = resolveImageProvider(userId);
  if (!provider) {
    throw new PptImageError('未配置生图接入点：请在后台「AI 模型 Provider」里加一条 kind=image 的记录。');
  }
  return { provider, owner: (provider.owner_user_id ? 'dedicated' : 'platform') as 'platform' | 'dedicated' };
}

/**
 * 真的生一张图：扣额度 → 按画风模板渲染提示词 → 生图 → 写 `ai_logs` → 进素材库。
 *
 * 「先备图」和「照槽位配图」两条路共用这一份。各写一份的话其中一条早晚会漏掉扣额度、
 * 漏掉 `ai_logs`（这笔钱在后台一处都看不见）或者漏掉素材库（下次重用时再花一次钱）——
 * 三样漏掉都不报错，那条路看起来完全正常。
 */
async function runOneImage(
  job: { subject: string; mode: ImageMode; ratio: string; label: string },
  ctx: { userId: string; title: string; section?: string; topic?: string; deckId?: string; page?: number },
  style: PptStyle,
  provider: { id: string; model: string },
  owner: 'platform' | 'dedicated'
): Promise<{ url: string; model?: string; storage?: 'cos' | 'local'; problems: string[] }> {
  const problems: string[] = [];
  // 额度按张扣，顺序和 aiGateway 一致（应用额度先扣，专属渠道烧自己的 key 不占总额）。
  checkAndDeductAppQuota(ctx.userId, 'ppt');
  if (owner !== 'dedicated') checkAndDeductQuota(ctx.userId);

  const t0 = Date.now();
  const theme = [ctx.topic, ctx.section, ctx.title].filter(Boolean).join(' · ');
  const prompt = renderStylePrompt(style, job.mode, {
    theme,
    scene: `${job.subject}. Single focal subject, safe margins.`,
    ratio: job.ratio,
  });
  // 模板里的 `<…>` / `{{…}}` 是给人看的填空说明，漏换的那几个会原样发给模型
  // （它会照着「本页主题，1句」画），而回来的图看着就是「这张不太对」。
  const left = leftoverPlaceholders(prompt);
  if (left.length) {
    problems.push(`${job.label}的提示词里还剩没换掉的占位符 ${left.join(' / ')} —— 这几个字会原样发给模型（画风模板改过？）。`);
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
    `${job.label} ${job.ratio} ${style.id}/${job.mode}`, ctx.userId, prompt, img.url, img.provider, owner
  );

  // 进素材库（migration 090）。**逐张写**：写在 api 层的话撞额度中断时前面那几张成功的图
  // 进不了库，而它们是真花过钱的。写不进去不能让这一步报错（图已经生成了），但**必须出声**
  // —— 静默的话素材库里少了几张，他只会以为「本来就这样」，下次重用时再花一次钱。
  try {
    rememberAsset(ctx.userId, {
      url: img.url,
      prompt: job.subject,
      mode: job.mode,
      styleId: style.id,
      ratio: job.ratio,
      model: img.model,
      storage: img.storage,
      deckId: ctx.deckId,
      page: ctx.page,
    });
  } catch (e: any) {
    problems.push(
      `${job.label}生成好了，但没进素材库：${e?.message || e}。` +
        '素材库里找不到它，以后想在别的页里重用只能重新生成一次（那是一次真实花费）。'
    );
  }
  return { url: img.url, model: img.model, storage: img.storage, problems };
}

/**
 * 按规划里那一条规格现生一张图，**存在那一页上但不进 html**（先备图，HTML 还没生成）。
 *
 * 和「照槽位配图」共用 `runOneImage`（额度 / ai_logs / 素材库都在那里），差别只有一处：
 * 这里没有槽位，所以比例来自规划（`spec.ratio`）而不是占位图的文件名。
 */
export async function generateSpecImage(
  spec: PlannedImage,
  ctx: {
    userId: string;
    index: number;
    title: string;
    section?: string;
    topic?: string;
    styleId?: string;
    deckId?: string;
    page?: number;
  }
): Promise<{ image: PreparedImage; problems: string[] }> {
  if (!spec.subject.trim()) {
    // 生了也不知道画的是什么（提示词里只剩画风模板），那是一次白花的钱。
    throw new PptImageError(`第 ${ctx.index} 格的规划里没写画什么，没法备图 —— 重新规划一次才会有这句话。`);
  }
  const style = resolveStyle(ctx.styleId);
  const { provider, owner } = resolveProvider(ctx.userId);
  const ratio = ratioText(spec.ratio);
  const r = await runOneImage(
    { subject: spec.subject, mode: spec.mode, ratio, label: `第 ${ctx.page || '?'} 页第 ${ctx.index} 格` },
    ctx,
    style,
    provider,
    owner
  );
  const problems = [...r.problems];
  if (r.storage === 'local') {
    problems.push(
      '这张图存在本机磁盘上（COS 没配好，落在 /uploads 下）。换机器或者多实例部署之后它是 404，' +
        '而现在预览里一切正常 —— 要长期用请在后台把 COS 配好再重新生成。'
    );
  }
  return {
    image: {
      index: ctx.index,
      url: r.url,
      prompt: spec.subject,
      mode: spec.mode,
      ratio: spec.ratio,
      styleId: style.id,
      model: r.model,
      storage: r.storage,
      from: 'ai',
      at: new Date().toISOString(),
    },
    problems,
  };
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

  // 画风和接入点都整页取一次、按 id 绑死（见文件头 ①）。
  const style = resolveStyle(ctx.styleId);
  const { provider, owner } = resolveProvider(ctx.userId);

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
      const r = await runOneImage(
        { subject: slot.prompt, mode: slot.mode, ratio: slot.ratio, label: `第 ${slot.index} 张` },
        ctx,
        style,
        provider,
        owner
      );
      problems.push(...r.problems);
      newUrl.set(slot.index, r.url);
      if (r.storage === 'local') localCount++;
      images.push({
        index: slot.index, prompt: slot.prompt, mode: slot.mode, ratio: slot.ratio,
        url: r.url, storage: r.storage, model: r.model,
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
    // 单页预览不带页脚（同 pageService）。
    previewHtml: assembleDeck([filled], ctx.meta, { footer: false }),
    images,
    problems,
    quotaExceeded,
    provider: { id: provider.id, model: provider.model },
    style: { id: style.id, name: style.name },
  };
}

/**
 * 把**备好的**图贴进刚生成的这一页（`index` 第 n 张 → 第 n 个图位）。不调 AI、不花钱。
 *
 * 五件事是承重的：
 * ① **地址由代码写回**，从头到尾不经过模型（硬规则 3）—— 让模型照抄 url 的话它会漏字符、
 *    改域名、或者复用上一页那张，而页面上是一张正常的图（或一个破图，和「这一格空着」
 *    长得一样）。
 * ② **按序号贴**，不按「哪一格还空着」找 —— 空格子优先的话，第 2 张会掉进第 1 格
 *    （图文不符，而页面渲染完全正常）。
 * ③ **多出来的那几张要点名说没地方贴**（模型少写了图位）：静默丢的话那几张的钱没有一处会说，
 *    而他只看到这一页图少了。
 * ④ **贴不上的（没有 src / 没有 background-image url）也要说** —— 那一格会停在占位图上。
 * ⑤ **比例不一致不进 problems**（改由那一格的标签一直显示，见下面那段注释）。
 */
export function applyPreparedImages(
  html: string,
  prepared: PreparedImage[]
): { html: string; used: FilledImage[]; problems: string[] } {
  const problems: string[] = [];
  const used: FilledImage[] = [];
  if (!prepared.length) return { html, used, problems };

  const slots = findImageSlots(html);
  const newUrl = new Map<number, string>();
  for (const img of [...prepared].sort((a, b) => a.index - b.index)) {
    const slot = slots[img.index - 1];
    if (!slot) {
      problems.push(
        `第 ${img.index} 格备好的图没地方贴（这一页只排出了 ${slots.length} 个图位）—— 那张图还在素材库里（/ppt/assets），` +
          '重新生成这一页、或者把它挪到别的页上再用。'
      );
      continue;
    }
    if (slot.via === 'none') {
      problems.push(`第 ${img.index} 个图位既没有 src 也没有 background-image url()，备好的图贴不上去，这一格还是占位图。`);
      continue;
    }
    // 比例对不上（3:4 的格子贴进一张 16:9）**不进 problems**：那是他自己在挑图那一刻
    // 看着「素材库挑的 · 16:9 landscape」点下去的，报成「要注意」的话每挑一张都多一条，
    // 真正要看的那几条（版式塌了 / 没地方贴 / 还是占位图）会被冲下去。这件事改由那一格
    // 的标签一直显示（`PptPlan.vue` 的 `spec-meta` / `prep-meta`：格子的比例和这张图的
    // 比例并排写着，不一致时跟一句「会被裁掉一块」）—— 完全不显示的话构图缺一块看起来
    // 像模型画得不好。
    newUrl.set(slot.index, img.url);
    used.push({
      index: slot.index,
      prompt: img.prompt,
      mode: img.mode,
      ratio: slot.ratio,
      url: img.url,
      storage: img.storage as 'cos' | 'local' | undefined,
      model: img.model,
    });
  }

  // 没贴上图的图位要报出来：占位图在预览里就是「这一页设计得比较空」，
  // 而他以为备过图的这一页已经齐了，直接去拼整份/导出。
  // **只数还是占位图的那几格**：这个函数也用在「改一张图就当场贴进已经生成好的那一页」
  // 那条路上（`prepare-images`），那里别的格子可能早就配过真图了 —— 一并说成「还是占位图」
  // 的话他会去点「补齐这一页的图」，那是白花一次钱。
  const left = slots
    .filter((s) => !newUrl.has(s.index) && PLACEHOLDERS.includes(s.src))
    .map((s) => s.index);
  if (left.length) {
    problems.push(
      `第 ${left.join(' / ')} 个图位还是占位图（那几格没有备好的图）—— 点「补齐这一页的图」会现生（每张一次真实花费）。`
    );
  }
  return { html: replaceSlotUrls(html, slots, newUrl), used, problems };
}

/**
 * 把备好的图贴进**已经生成好的那一页**（换/备一张图当场生效，不用重新生成 —— 那是一次
 * 真实调用，还会连版式和文案一起重排）。纯函数：算出新 html 和新的 `images_json`，
 * 落库由调用方做（`api/ppt.ts` 的 `pastePrepared`）。
 *
 * 三件事是承重的：
 * ① 贴上去的那几格**只覆盖同序号那条配图记录，别的格子留着** —— 整份覆盖的话，之前
 *    `POST /images` 真花钱配的那几张在界面上凭空变成「没配图」，他会再点一次「换一批图」，
 *    那是重花一遍。
 * ② **清掉的那张还留在画面里要说一句**：清掉的只是「备着的图」，缩略图那一格已经变成
 *    「未备」而画面里那一张还在 —— 两处对不上，一处都不报错。
 * ③ 「哪几格还是占位图」由 `applyPreparedImages` 报，它只数**真的**还是占位图的格子
 *    （这里别的格子往往已经配过真图了）。
 */
export function pasteIntoBuiltPage(
  html: string,
  prepared: PreparedImage[],
  current: { images: FilledImage[]; droppedUrl?: string }
): { html: string; images: FilledImage[]; used: FilledImage[]; problems: string[] } {
  const fill = applyPreparedImages(html, prepared);
  const problems = [...fill.problems];
  if (current.droppedUrl && fill.html.includes(current.droppedUrl)) {
    problems.push(
      '清掉的只是「备着的图」—— 画面里那一格还是刚才那张。要换掉就在这一格挑一张/生一张，或者重新生成这一页。'
    );
  }
  const kept = (current.images || []).filter(
    (x) => !fill.used.some((u) => u.index === Number(x?.index))
  );
  return {
    html: fill.html,
    images: [...kept, ...fill.used].sort((a, b) => Number(a.index) - Number(b.index)),
    used: fill.used,
    problems,
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

// 提示词照**画风模板**渲染（`runOneImage` 里的 `renderStylePrompt`），不在这里拼一段自己的
// 画风描述：拼一份的话「换画风」这个下拉换的是别的东西 —— 图的笔触压根不跟着变，
// 而每张图单看都不错、没有一处报错。
