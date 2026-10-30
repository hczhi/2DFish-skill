// 长截图慢滚的节奏（ScrollTourCard 和 templates.ts 共用：默认停靠时刻、最短停留、调试台关键帧都按它算）。
/** 每处停多久 */
export const ST_HOLD = 1.4
/** 第 i 处默认在什么时候到位（没设 cue 时）：先滚 1.2 秒到第一处，之后每处间隔 = 停 + 滚 1 秒 */
export const stAt = (i: number) => 1.8 + i * (ST_HOLD + 1.0)
