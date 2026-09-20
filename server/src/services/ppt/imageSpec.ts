// 「这一页要哪几张图」这件事的唯一定义处：规划那一步（planService）产出它，
// 备图/生图那两步（imageService 和后面的「先备图再生成页面」）照它办事。
//
// 为什么放在一个单独的文件里：planService 需要这几个常量去校验模型给的规格，而
// imageService 拖着生图网关 + COS + 上传路由那一整串 import —— 让规划那一步 import 它
// 等于把生图的依赖链拉进规划的路径里。两边各写一份数字/枚举的话，改了一边另一边照旧，
// 而症状是「规划里说 3:4、生成出来的图是 16:9」，两边都不报错。

import { PER_STYLE_MODES, type ImageMode } from './styleLibrary.js';

/** 一次请求最多给一页配几张。超了只拒不截 —— 悄悄只做前几张的话剩下几格还是占位图。 */
export const MAX_SLOTS_PER_PAGE = 6;

/**
 * 用户自己改写的那句提示词的上限。**只拒不截**：截掉后半句照样能生出一张图，
 * 而他写在后面的那几个条件（「不要出现文字」「俯视角」）一处都没生效，图看起来只是「不太对」。
 */
export const MAX_SUBJECT_CHARS = 300;

/**
 * 他**自己改写的那一整条**提示词的上限（`PlannedImage.fullPrompt`）。比 subject 大得多是因为
 * 自动拼出来的那条本身就有八九百字（画风模板 + 配色 + 留白 + 尾巴），按 300 卡的话他一打开
 * 那个框、什么都没改就点确定，直接被 400 顶回来。同样**只拒不截**。
 */
export const MAX_FULL_PROMPT_CHARS = 4000;

/**
 * 允许的比例。就这三种，因为生成阶段的占位图只有 `ph-16x9` / `ph-1x1` / `ph-3x4`
 * 三个（`ratioOf` 按文件名认比例）—— 规划里写一个第四种比例的话，那一格最后仍然按
 * 16:9 生图，而规划面板上写着 3:4，没有一处报错。
 */
export const IMAGE_RATIOS = ['16:9', '1:1', '3:4'] as const;
export type ImageRatio = (typeof IMAGE_RATIOS)[number];

/**
 * 一张**已经存在**的图（用户上传的）该按哪一档比例记进素材库。图不会被重裁，
 * 所以这里只是在这三档里挑最接近的一档 —— 而这一档是「贴进这一格会被裁掉两边」
 * 那句提醒的唯一依据：一律记成 16:9 的话，一张竖图贴进 16:9 的槽里照样是一页完整的
 * 幻灯片，只是主体被裁掉，接口全程 200。
 *
 * 按对数距离挑，因为比例是乘法量（0.75 → 1 和 1 → 1.33 是同样大小的一步）；
 * 用差值的话三档之间的分界会偏向竖的那一侧。
 */
export function nearestRatio(width: number, height: number): ImageRatio {
  const r = width / height;
  let best: ImageRatio = '16:9';
  let bestGap = Infinity;
  for (const cand of IMAGE_RATIOS) {
    const [a, b] = cand.split(':').map(Number);
    const gap = Math.abs(Math.log(r / (a / b)));
    if (gap < bestGap) {
      bestGap = gap;
      best = cand;
    }
  }
  return best;
}

/**
 * 这一档比例**真正发给上游的那个 `size`**。
 *
 * 不发 size 的话每家按自己的默认出（多半是 1024×1024 方图）：方图贴进 16:9 的图槽会被
 * `object-fit:cover` 裁掉上下两条，画面上是「主体被切了一半」，而接口一路 200、面板上写着
 * 「已生成」—— 他唯一的出路是一张张重生，而重生出来还是方的。
 *
 * 三档都用 1024 那一边，因为这是各家生图模型共同支持的一档；换成 2048 的话部分接入点直接
 * 400（那时是整页配图失败，而不是「图小了一点」）。
 */
export function sizeForRatio(ratio: string): string {
  const r = ratio.trim();
  if (r.startsWith('1:1') || /square/i.test(r)) return '1024x1024';
  if (r.startsWith('3:4') || /portrait/i.test(r)) return '1024x1536';
  return '1536x1024';
}

/** `1536x1024` → 1.5（认不出回 null）。 */
function aspectOf(size: string): number | null {
  const m = /^(\d+)\s*[x*×]\s*(\d+)$/.exec(size.trim());
  if (!m) return null;
  const w = Number(m[1]);
  const h = Number(m[2]);
  return w > 0 && h > 0 ? w / h : null;
}

/**
 * 要的尺寸和**真回来的像素**对不上时那一句话（对得上、或者读不出像素时回 null）。
 *
 * 这一条必须出声：`size` 是个建议，认的照办、不认的悄悄按自己的默认出、键名拼错的直接忽略
 * —— 三种都回 200 带一张漂亮的图。裁掉的那一块在页面上看起来像「模型构图没构好」，
 * 他会一张张重生（每张都是一次真实花费），而重生出来的还是同一个尺寸。
 * 话里必须同时带**要的**和**回来的**两个尺寸：只说「尺寸不对」的话他改不了任何东西
 * （真正的动作是去后台给这条接入点补 size 参数、或者换一条）。
 */
export function sizeMismatchNote(
  requested: string,
  got: { width: number; height: number } | null,
  label: string
): string | null {
  const want = aspectOf(requested);
  if (!got || !want) return null;
  const real = got.width / got.height;
  // 按对数距离比（比例是乘法量）。8% 以内算同一档 —— 有些接入点会把 1536×1024 对齐成
  // 1520×1024 之类的数，那不是「忽略了 size」，报出来只会把真正那一句冲掉。
  if (Math.abs(Math.log(real / want)) <= 0.08) return null;
  return (
    `${label}要的是 ${requested}，上游回来的是 ${got.width}×${got.height}（${nearestRatio(got.width, got.height)}）——` +
    '这条接入点没按 size 出图，贴进图槽会被裁掉两边（画面上看起来像模型构图没构好，重生一次还是同一个尺寸）。' +
    '要真按尺寸出，得在后台给这条生图接入点换一条支持 size 的模型/网关。'
  );
}

/** 规划里的一张图：画什么 + 哪一路画法 + 什么比例。 */
export interface PlannedImage {
  /** 画什么（一句话）。它就是最后写进 `data-img-prompt` 的那句话。 */
  subject: string;
  /** concept / case / data —— 填错的话数据页会拿到一张漂亮的概念插画（不报错）。 */
  mode: ImageMode;
  ratio: ImageRatio;
  /**
   * 他在「编辑这一格的提示词」里**自己改写的那一整条**（有值就**原样发出去**，画风模板、配色、
   * 留白方向、尾巴一概不再拼）。
   *
   * 两件事必须跟着：① 有它的时候「换画风 / 改成背景图 / 改配色 / 改上面那句 subject」**对这一格
   * 全都不起作用** —— 所以每次生成都要出声，界面上那一格也要标出来，否则他改了画风看到图没变，
   * 只会一张张重生（每张真花钱）；② 它必须两条路共用（备图 `specJob` 和「换一批图」
   * `fillPageImages`），只接一条的话同一格两条路发出去的是两条不同的提示词，而两边都 200。
   */
  fullPrompt?: string;
}

/**
 * 一张**备好的**图（091 `ppt_deck_pages.pending_images_json` 里的一项）。
 *
 * `index` 对齐规划里 `imageSpecs` 的位置（从 1 起），**不是数组下标** —— 只存下标的话
 * 「第 2 格清掉了」之后剩下那张会顶上去，回填时贴到第 1 格，图文不符而页面渲染正常。
 *
 * `from` 要存：素材库挑来的那张可能是别的画风/比例（不花钱），AI 现生的那张一定是当前
 * 画风。不分的话「这一页笔触为什么不统一」在界面上没有任何线索。
 * `ratio`/`styleId` 同理是「贴进去会不会看出破绽」的唯一依据。
 */
export interface PreparedImage {
  index: number;
  url: string;
  /** 生成时用的那句话（素材库挑的就是那张图当初的 `data-img-prompt`）。 */
  prompt: string;
  mode: ImageMode;
  ratio: string;
  styleId?: string;
  model?: string;
  storage?: string;
  from: 'ai' | 'library';
  at: string;
}

/**
 * 重排图位之后，**落在新清单外面的那几张备好的图**要点名说出来。
 *
 * 那几张是花过钱的（或者他挑过的），而新清单里已经没有那一格了：备图面板按新清单画，
 * 于是它们从界面上**消失**，而 `pending_images_json` 里还留着 —— 下一次生成这一页时
 * `applyPreparedImages` 报的是「第 N 格备好的图没地方贴」，那句话出现在别的操作之后，
 * 他对不回「是那次重排图位弄的」。所以这一句要在重排当场说。
 *
 * **不删那几条**：删了那张图就只剩素材库里那一份，而他以为的是「图还备着」。
 */
export function orphanedPreparedNotes(prepared: Array<{ index?: unknown; url?: unknown }>, specCount: number): string[] {
  const lost = prepared
    .filter((p) => p?.url && Number(p.index) > specCount)
    .map((p) => Number(p.index))
    .sort((a, b) => a - b);
  if (!lost.length) return [];
  return [
    `原来第 ${lost.join(' / ')} 格备好的图落在新清单外面了（现在只有 ${specCount} 格）——` +
      '那几张还在素材库里（/ppt/assets），可以挑回到别的格子上；不挪的话它们既不会显示在这一页的备图里，也贴不进生成出来的页面。',
  ];
}

/**
 * 把模型给的 `images` 字段归一成规格数组。
 *
 * 三种「读起来正常」的输入都要出声，因为它们后面全变成「图不对」而不是「报错」：
 * ① 给了个数字（老格式/模型偷懒）—— 那就只知道要几张、不知道画什么，先备图那一步用不上，
 *    只能退回「先出 HTML 再照槽位配图」的老顺序；不说的话他会以为备图功能坏了。
 * ② 超过一页 6 张 —— 多出来的那几张备了也没有槽位放，等于白花钱。
 * ③ mode / ratio 不在枚举里 —— 静默按 concept / 16:9 处理的话，数据页拿到概念插画、
 *    人物卡拿到横图被裁掉两边，每张单看都不错。
 */
export function normalizeImageSpecs(
  raw: unknown,
  label: string
): { specs: PlannedImage[]; count: number; problems: string[] } {
  const problems: string[] = [];

  if (!Array.isArray(raw)) {
    const n = Number(raw);
    const count = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
    if (count > 0) {
      problems.push(
        `${label}：模型只给了图片张数（${count} 张）没说画什么，这一页没法提前备图 —— ` +
          '只能先生成 HTML、再照它写出来的槽位配图（重新生成这一页会把图换回占位图）。'
      );
    }
    return { specs: [], count, problems };
  }

  const specs: PlannedImage[] = [];
  for (const item of raw) {
    const subject = typeof item === 'string' ? item.trim() : String((item as any)?.subject ?? '').trim();
    if (!subject) {
      // 没有主题的规格生成不出任何东西（生图那一步会跳过它，那一格停在占位图上）。
      problems.push(`${label}：有一张图没写画什么，这一张丢掉了（规划里那一格是空的）。`);
      continue;
    }
    if (specs.length >= MAX_SLOTS_PER_PAGE) {
      problems.push(
        `${label}：规划了超过 ${MAX_SLOTS_PER_PAGE} 张图，多出来的丢掉了 —— ` +
          '一页放不下那么多图槽位，备出来也贴不上去（等于白花钱）。'
      );
      break;
    }
    const rawMode = String((item as any)?.mode ?? '').trim().toLowerCase();
    // **只认版式里那一格的三路**（`PER_STYLE_MODES`），不认整页那两路（backdrop / poster）：
    // 后者是用户在「这一页详情」里点出来的整页模式，放进一格里生成的是一张铺满整幅、
    // 刻意不带主体（backdrop）或者把文字印在图里（poster）的图 —— 贴进那一格照样是一页
    // 正常的幻灯片，只是那一格看起来「空/有重复的字」，一处都不报错。
    const mode: ImageMode = (PER_STYLE_MODES as string[]).includes(rawMode) ? (rawMode as ImageMode) : 'concept';
    if (rawMode && mode !== rawMode) {
      problems.push(
        `${label}：「${subject}」的画法 ${rawMode} 不认识（一格图只有 ${PER_STYLE_MODES.join(' / ')}），按 concept 画 ——` +
          '本来要信息图的那一格会拿到一张概念插画。'
      );
    }
    const rawRatio = String((item as any)?.ratio ?? '').trim();
    const ratio = (IMAGE_RATIOS as readonly string[]).includes(rawRatio) ? (rawRatio as ImageRatio) : '16:9';
    if (rawRatio && ratio !== rawRatio) {
      problems.push(
        `${label}：「${subject}」的比例 ${rawRatio} 不在 ${IMAGE_RATIOS.join(' / ')} 里，按 16:9 备图 ——` +
          '塞进竖槽位会被裁掉上下两头。'
      );
    }
    specs.push({ subject, mode, ratio });
  }

  return { specs, count: specs.length, problems };
}
