// 动效卡的时间工具。卡片的每一帧都只由 t（秒）算出来，不用 CSS 动画 / requestAnimationFrame
// 自己推进 —— 这样「跳到第 t 秒」就是改一个数，导出时逐帧截图画出来的和预览完全一致。
// 用了 CSS transition/animation 的话，截图那一刻动画走到哪取决于机器快慢，出片会抖、会缺帧。

export const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v))

/** t 在 [start, end] 里走到了几成（0~1），之前为 0、之后为 1。 */
export const progress = (t: number, start: number, end: number) =>
  end <= start ? (t >= end ? 1 : 0) : clamp((t - start) / (end - start))

export const easeOutCubic = (p: number) => 1 - Math.pow(1 - p, 3)
export const easeInCubic = (p: number) => p * p * p
export const easeOutBack = (p: number) => {
  const c1 = 1.70158, c3 = c1 + 1
  return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2)
}
export const lerp = (a: number, b: number, p: number) => a + (b - a) * p

/** 第 i 个元素依次出场：从 start + i*step 开始，用 dur 秒走完。 */
export const stagger = (t: number, start: number, step: number, i: number, dur: number) =>
  progress(t, start + i * step, start + i * step + dur)

/** 「模糊到清晰」入场：透明度 + 上移 + 模糊同时收拢。比单纯淡入有景深感。 */
export const focusIn = (t: number, a: number, d = 0.5, dy = 24) => {
  const p = easeOutCubic(progress(t, a, a + d))
  return { opacity: p, transform: `translateY(${lerp(dy, 0, p)}px)`, filter: `blur(${lerp(10, 0, p)}px)` }
}

/** 0~1 来回呼吸（停住时那些小点、光晕用） */
export const pulse = (t: number, speed = 2.4) => 0.5 + 0.5 * Math.sin(t * speed)

/** 「景深」入场：从镜头前大而虚的地方落到位（放大 + 模糊 + 上方 → 原位）。scale0 是起始放大倍数。 */
export const depthIn = (t: number, a: number, d = 0.55, scale0 = 1.9) => {
  const p = easeOutCubic(progress(t, a, a + d))
  return {
    opacity: Math.min(1, p * 1.6),
    transform: `translateY(${lerp(-50, 0, p)}px) scale(${lerp(scale0, 1, p)})`,
    filter: `blur(${lerp(16, 0, p)}px)`,
  }
}

export const easeInOutCubic = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2)
