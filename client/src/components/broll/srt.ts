// SRT 解析。时间错一点的后果是卡片出现在错的那句话上 —— 画面照样好看，看不出来，
// 所以解析不了的块一律计数报出去，不悄悄跳过。

export interface SubLine { id: number; start: number; end: number; text: string }
export interface SrtResult { lines: SubLine[]; skipped: number }

// 00:00:12,300 / 00:00:12.300 / 00:12,300（剪映、Pr、在线工具导出的写法不完全一样）
const TIME = String.raw`(?:(\d{1,2}):)?(\d{1,2}):(\d{1,2})[,.](\d{1,3})`
const ARROW = new RegExp(`${TIME}\\s*-->\\s*${TIME}`)

function toSec(h: string | undefined, m: string, s: string, ms: string) {
  // 毫秒位不足三位按小数补齐：「,5」是 500ms 不是 5ms
  return Number(h || 0) * 3600 + Number(m) * 60 + Number(s) + Number(ms.padEnd(3, '0')) / 1000
}

export function parseSrt(raw: string): SrtResult {
  const blocks = raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split(/\n\s*\n/)
  const lines: SubLine[] = []
  let skipped = 0
  for (const block of blocks) {
    const rows = block.split('\n').map((r) => r.trim()).filter(Boolean)
    if (!rows.length) continue
    const at = rows.findIndex((r) => ARROW.test(r))
    const m = at >= 0 ? rows[at].match(ARROW) : null
    const text = rows.slice(at + 1).join(' ').replace(/<[^>]+>/g, '').trim()
    if (!m || !text) { skipped++; continue }
    const start = toSec(m[1], m[2], m[3], m[4])
    const end = toSec(m[5], m[6], m[7], m[8])
    if (!(end > start)) { skipped++; continue }
    lines.push({ id: 0, start, end, text })
  }
  lines.sort((a, b) => a.start - b.start).forEach((l, i) => { l.id = i + 1 })
  return { lines, skipped }
}

export const fmtTime = (s: number) => {
  const m = Math.floor(s / 60)
  return `${String(m).padStart(2, '0')}:${(s - m * 60).toFixed(1).padStart(4, '0')}`
}
