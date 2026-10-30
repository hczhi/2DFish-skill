import { cueAt } from './cues'

// 叙事转折的节奏（TurnCard 和 templates.ts 共用）：前一句读完 → 翻底色 → 后一句。
// 两边各写一份的话改了卡片里的节奏、templates.ts 没跟着改，「停住」那一格拍到的还在翻，最短停留也短了，后一句一闪就出场。
export const TURN_A_IN = 0.2
export const TURN_TEXT_IN = 0.6
/** 翻色用多久 */
export const TURN_FLIP = 0.36
/** 翻完色到后一句开始对焦的空档：没有空档的话两句挨着，读起来像字幕串了 */
export const TURN_GAP = 0.12
export const TURN_OUT = 0.5
// 读完一句要的时间：按字数，太短的句子也给够 1.2 秒
export const turnRead = (s: string) => Math.min(3.2, Math.max(1.2, 0.9 + [...(s || '')].length * 0.12))
/** 后一句出现的时刻：默认前一句读完、翻完色；cues[0] 可以对到字幕里转折后那句开口的时刻（「但」那一下） */
export const turnBIn = (d: { before?: string; cues?: unknown }) =>
  cueAt(d.cues, 0, TURN_A_IN + TURN_TEXT_IN + turnRead(d.before || '') + TURN_FLIP + TURN_GAP)
/** 翻色时刻 = 后一句前面留出翻色 + 空档；cue 设得太早时至少让前一句先出来 */
export const turnAt = (d: { before?: string; cues?: unknown }) => Math.max(TURN_A_IN + TURN_TEXT_IN, turnBIn(d) - TURN_FLIP - TURN_GAP)
export const turnMin = (d: { before?: string; after?: string; cues?: unknown }) => turnBIn(d) + TURN_TEXT_IN + turnRead(d.after || '') + TURN_OUT
