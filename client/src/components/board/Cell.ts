import type { CellFlipOptions, BigCharQuadrant } from './types'

export const CHARSET_EN = ' ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,!?:;\'-/&@#$%'

// 主题相关过渡字 — 东方智慧意境
const TRANSITION_CHARS = '道德仁义礼智信静悟明空心禅定慧觉缘善净真如意和安宁'

function isChinese(ch: string): boolean {
  const code = ch.charCodeAt(0)
  // CJK Unified Ideographs: U+4E00-U+9FFF
  if (code >= 0x4E00 && code <= 0x9FFF) return true
  // CJK Extension A: U+3400-U+4DBF
  if (code >= 0x3400 && code <= 0x4DBF) return true
  // CJK Compatibility Ideographs: U+F900-U+FAFF
  if (code >= 0xF900 && code <= 0xFAFF) return true
  // CJK Punctuation: U+3000-U+303F (includes Chinese punctuation like 、。「」)
  if (code >= 0x3000 && code <= 0x303F) return true
  // Fullwidth forms: U+FF00-U+FFEF (includes ，。！？：；)
  if (code >= 0xFF00 && code <= 0xFFEF) return true
  // CJK Symbols: U+2E80-U+2FFF
  if (code >= 0x2E80 && code <= 0x2FFF) return true
  // Block Elements: U+2580-U+259F (█▓▒░)
  if (code >= 0x2580 && code <= 0x259F) return true
  // Any char not in basic ASCII printable range — treat as "non-English"
  if (code > 0x7F) return true
  return false
}

export { isChinese }

export class Cell {
  row: number
  col: number
  currentChar = ' '
  targetChar = ' '
  flipProgress = 0
  isFlipping = false
  flipSpeed = 0
  charIndex = 0
  flipDelay = 0
  flipsRemaining = 0
  isChinese = true // 全部当作中文处理，不再使用英文字母表轮转

  bgColor: string | null = null
  textColor: string | null = null
  ledColor: [number, number, number] | null = null
  bigChar: BigCharQuadrant | null = null

  constructor(row: number, col: number) {
    this.row = row
    this.col = col
  }

  startFlip(target: string, delay: number, options?: CellFlipOptions) {
    this.targetChar = target
    this.isChinese = true
    this.flipDelay = delay
    this.isFlipping = true
    this.flipProgress = 0
    this.flipSpeed = 0.06 + Math.random() * 0.18
    this.bgColor = options?.bgColor ?? null
    this.textColor = options?.textColor ?? null
    this.ledColor = options?.ledColor ?? null
    this.bigChar = options?.bigChar ?? null

    if (target === ' ') {
      this.flipsRemaining = 1 + Math.floor(Math.random() * 2)
    } else {
      this.flipsRemaining = 2 + Math.floor(Math.random() * 4)
    }
  }

  update() {
    if (!this.isFlipping) return
    if (this.flipDelay > 0) {
      this.flipDelay--
      return
    }

    this.flipProgress += this.flipSpeed
    if (this.flipProgress >= 1) {
      this.flipProgress = 0
      
      this.flipsRemaining--
      if (this.flipsRemaining <= 0) {
        this.currentChar = this.targetChar
        this.isFlipping = false
      } else {
        this.currentChar = TRANSITION_CHARS[Math.floor(Math.random() * TRANSITION_CHARS.length)]
      }
    }
  }
}
