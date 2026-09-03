// 「这一页要哪几张图」这件事的唯一定义处：规划那一步（planService）产出它，
// 备图/生图那两步（imageService 和后面的「先备图再生成页面」）照它办事。
//
// 为什么放在一个单独的文件里：planService 需要这几个常量去校验模型给的规格，而
// imageService 拖着生图网关 + COS + 上传路由那一整串 import —— 让规划那一步 import 它
// 等于把生图的依赖链拉进规划的路径里。两边各写一份数字/枚举的话，改了一边另一边照旧，
// 而症状是「规划里说 3:4、生成出来的图是 16:9」，两边都不报错。

import { IMAGE_MODES, type ImageMode } from './styleLibrary.js';

/** 一次请求最多给一页配几张。超了只拒不截 —— 悄悄只做前几张的话剩下几格还是占位图。 */
export const MAX_SLOTS_PER_PAGE = 6;

/**
 * 用户自己改写的那句提示词的上限。**只拒不截**：截掉后半句照样能生出一张图，
 * 而他写在后面的那几个条件（「不要出现文字」「俯视角」）一处都没生效，图看起来只是「不太对」。
 */
export const MAX_SUBJECT_CHARS = 300;

/**
 * 允许的比例。就这三种，因为生成阶段的占位图只有 `ph-16x9` / `ph-1x1` / `ph-3x4`
 * 三个（`ratioOf` 按文件名认比例）—— 规划里写一个第四种比例的话，那一格最后仍然按
 * 16:9 生图，而规划面板上写着 3:4，没有一处报错。
 */
export const IMAGE_RATIOS = ['16:9', '1:1', '3:4'] as const;
export type ImageRatio = (typeof IMAGE_RATIOS)[number];

/** 规划里的一张图：画什么 + 哪一路画法 + 什么比例。 */
export interface PlannedImage {
  /** 画什么（一句话）。它就是最后写进 `data-img-prompt` 的那句话。 */
  subject: string;
  /** concept / case / data —— 填错的话数据页会拿到一张漂亮的概念插画（不报错）。 */
  mode: ImageMode;
  ratio: ImageRatio;
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
    const mode: ImageMode = (IMAGE_MODES as string[]).includes(rawMode) ? (rawMode as ImageMode) : 'concept';
    if (rawMode && mode !== rawMode) {
      problems.push(
        `${label}：「${subject}」的画法 ${rawMode} 不认识（只有 ${IMAGE_MODES.join(' / ')}），按 concept 画 ——` +
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
