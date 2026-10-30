// 象形图的节奏（卡片和 templates.ts 共用一份：调试台关键帧、最短停留都按它算，两边各写一份的话「停住」那一格拍到的还没点亮完）。
export const PG_APPEAR = 0.35
/** n 个里点亮 v 个：light = 开始点亮的时刻，step = 每格间隔（点阵格子多，整段点亮压在 1.4 秒内） */
export function pgTimes(n: number, v: number) {
  if (n > 20) {
    const rings = 5
    return { light: PG_APPEAR + rings * 0.13 + 0.35, step: Math.min(0.12, 1.4 / Math.max(1, v)) }
  }
  return { light: PG_APPEAR + n * 0.05 + 0.25, step: 0.12 }
}
