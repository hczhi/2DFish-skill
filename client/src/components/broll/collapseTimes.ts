// 一句话坍缩成一个词的节奏（CollapseCard 和 templates.ts 共用）。
export const CL_IN = 0.1
/** 整句沸腾（字抖 + 选区框）多久 */
export const CL_BOIL = 0.5
/** 颗粒向中心坍缩多久 */
export const CL_SUCK = 0.5
export const clRead = (s: string) => Math.min(2.4, Math.max(1, 0.8 + [...(s || '')].length * 0.1))
/** 开始沸腾的时刻：整句读完 */
export const clBoilAt = (d: { sentence?: string }) => CL_IN + 0.5 + clRead(d.sentence || '')
/** 那个词落定的时刻 */
export const clWordAt = (d: { sentence?: string }) => clBoilAt(d) + CL_BOIL + CL_SUCK - 0.05
export const clMin = (d: { sentence?: string; word?: string }) => clWordAt(d) + 1.6 + 0.5
