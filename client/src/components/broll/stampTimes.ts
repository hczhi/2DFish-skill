import { hash } from './rows'

// 时间地点戳的节奏（DateStampCard 和 templates.ts 共用）：逐字敲出，每个字的间隔带一点抖动（固定种子，导出一致）。
export const DS_AT = 0.3
export const dsLine = (d: { when?: string; where?: string }) => [d.when, d.where].filter((s) => s?.trim()).join(' · ')
/** 第 k 个字出现的时刻 */
export const dsCharAt = (k: number) => {
  let t = DS_AT
  for (let j = 0; j < k; j++) t += 0.07 + hash(j, 11) * 0.06
  return t
}
export const dsTypedAt = (d: { when?: string; where?: string }) => dsCharAt([...dsLine(d)].length)
/** 敲完之后光标闪 3 下（每下 0.3 秒）再出副信息行 */
export const dsNoteAt = (d: { when?: string; where?: string }) => dsTypedAt(d) + 0.9 + 0.4
export const dsMin = (d: { when?: string; where?: string; note?: string }) => (d.note?.trim() ? dsNoteAt(d) + 1.6 : dsTypedAt(d) + 1.6) + 0.5
