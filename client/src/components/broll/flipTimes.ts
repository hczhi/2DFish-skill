import { cueAt } from './cues'

// 功能卡翻面的节奏（FlipCardsCard 和 templates.ts 共用）：第 i 张从 flAt(d, i) 开始翻，FL_DUR 秒翻完。
export const FL_AT = 0.9
export const FL_STEP = 0.35
export const FL_DUR = 0.6
export const flAt = (d: { cues?: unknown }, i: number) => cueAt(d.cues, i, FL_AT + i * FL_STEP)
