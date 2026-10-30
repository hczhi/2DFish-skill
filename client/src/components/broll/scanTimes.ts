// 扫描标注的节奏（ScanMarkCard 和 templates.ts 共用）：扫描线匀速（零缓动）从上扫到下，扫过每个点的那一刻框收拢、标签跟出。
export const SC_AT = 0.6
export const SC_DUR = 2.4
/** 扫描线扫到图高 y%（0–100）的时刻 */
export const scHitAt = (y: number) => SC_AT + (Math.max(0, Math.min(100, y)) / 100) * SC_DUR
export const scEnd = SC_AT + SC_DUR
