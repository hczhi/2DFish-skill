// 斜切色块标题的节奏（SlabCard 和 templates.ts 共用）：色块什么时候到位、重点字在那一帧才出现。
export const SLAB_AT = 0.25
/** punch：块从中心撑开 */
export const SLAB_OPEN = 0.22
/** speed：块从左边画外冲进来 */
export const SLAB_RUSH = 0.28
export const slabLand = (style: string) => SLAB_AT + (style === 'speed' ? SLAB_RUSH : SLAB_OPEN)
