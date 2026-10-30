import { cueAt } from './cues'

// 章节目录高亮的节奏（AgendaCard 和 templates.ts 共用）。
export const AG_START = 0.35
export const AG_STEP = 0.1
/** 不高亮（current = 0，开头报目录）时每条跟着口播一条条出，默认间隔拉长到这个 */
export const AG_STEP_LIST = 0.45
export const agCurrent = (d: { current?: string }) => Math.max(0, Math.min(5, Number(d.current) || 0))
export const agAt = (d: { current?: string; cues?: unknown }, i: number) =>
  agCurrent(d) ? AG_START + i * AG_STEP : cueAt(d.cues, i, AG_START + i * AG_STEP_LIST)
/** 当前那条亮起的时刻：全部滑进来站定之后 */
export const agFocusAt = (d: { current?: string; cues?: unknown; items?: string[] }) => {
  const n = (d.items || []).filter((s) => s?.trim()).length
  return Math.max(0, ...Array.from({ length: n }, (_, i) => agAt(d, i))) + 0.5
}
