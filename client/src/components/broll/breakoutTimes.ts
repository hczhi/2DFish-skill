// 增长爆框的节奏（BreakoutCard 和 templates.ts 共用）：前几根柱按旧刻度长好 → 最后一根冲出框 → 纵轴重标、所有柱子缩回框里。
export const BO_AT = 0.5
export const BO_STEP = 0.15
export const BO_GROW = 0.6
/** 冲出框用多久 */
export const BO_SHOOT = 0.45
/** 冲出去之后停多久才重标（让人看清「装不下了」） */
export const BO_HOLD = 0.45
export const BO_RESCALE = 0.7
export const boShootAt = (n: number) => BO_AT + Math.max(0, n - 2) * BO_STEP + BO_GROW + 0.35
export const boRescaleAt = (n: number) => boShootAt(n) + BO_SHOOT + BO_HOLD
