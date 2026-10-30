import { cueAt } from './cues'

// 对句反色的节奏（AltLinesCard 和 templates.ts 共用）：第 i 行色块从 altAt(d, i) 开始展开，字滞后 ALT_LAG 被块右缘刷出来。
export const ALT_START = 0.15
export const ALT_STEP = 0.12
export const ALT_BLOCK = 0.26
// 字比块晚 2 帧：同时走的话字和块是一起长出来的一整块，读不出「被刷出来」
export const ALT_LAG = 0.067
export const altAt = (d: { cues?: unknown }, i: number) => cueAt(d.cues, i, ALT_START + i * ALT_STEP)
