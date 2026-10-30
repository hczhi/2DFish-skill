// 前后滑动分屏的分割线关键帧（SliderCompareCard 和 templates.ts 共用：最短停留、调试台关键帧按它算）。
// x = 分割线在宽度的百分之几（100 = 全是「之前」，0 = 全是「之后」）。
export const SLIDER_KEYS = [
  { t: 0.5, x: 100 },
  { t: 1.9, x: 50 }, // 滑到中线
  { t: 2.5, x: 50 }, // 停
  { t: 2.7, x: 56 }, // 轻推一下
  { t: 2.9, x: 50 },
  { t: 3.8, x: 8 }, // 几乎全露「之后」
  { t: 4.6, x: 8 }, // 停
  { t: 5.3, x: 50 }, // 回中线
]
export const SLIDER_END = SLIDER_KEYS[SLIDER_KEYS.length - 1].t
