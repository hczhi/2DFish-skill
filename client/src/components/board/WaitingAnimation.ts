import type { BoardConfig, CellInstruction } from './types'
import { DEFAULT_BOARD_CONFIG } from './types'

export type WaitMode = 'welcome' | 'loading' | 'fading'

const CHINESE_PHRASES = ['知行合一', '上善若水', '大道至简', '厚德载物', '道法自然', '无为而治', '静水流深', '天人合一', '虚怀若谷', '大象无形']
const SINGLE_CHARS = '天地人和静悟空道法自然心明见性德仁义礼智信缘善净真如意安宁'
const WELCOME_CHARS = '山水云风月竹松梅兰菊莲荷雪霜露雨泉石溪林鹤鸟花叶'

export class WaitingAnimation {
  private config: BoardConfig
  private timer: ReturnType<typeof setTimeout> | null = null
  private onInstructions: (instructions: CellInstruction[]) => void
  private mode: WaitMode = 'welcome'
  private currentWelcomeText = ''
  private loopDelay = 2000
  private fadeRatio = 0
  private occupied = new Set<string>()
  private welcomePhase: 'flipping' | 'settled' = 'flipping'
  private welcomeElapsed = 0
  private loadingWave = 0

  constructor(
    onInstructions: (instructions: CellInstruction[]) => void,
    config: BoardConfig = DEFAULT_BOARD_CONFIG,
  ) {
    this.onInstructions = onInstructions
    this.config = config
  }

  startWelcome(text: string) {
    this.stop()
    this.mode = 'welcome'
    this.currentWelcomeText = text
    this.loopDelay = 200
    this.occupied.clear()
    this.welcomePhase = 'flipping'
    this.welcomeElapsed = 0
    this.fillWelcomeAll()
    this.scheduleNext()
  }

  startLoading() {
    this.stop()
    this.mode = 'loading'
    this.loopDelay = 600
    this.loadingWave = 0
    this.occupied.clear()
    this.fillLoading()
    this.scheduleNext()
  }

  fadeout(occupied: Set<string>) {
    this.mode = 'fading'
    this.occupied = occupied
    this.fadeRatio = 0
    this.loopDelay = 200
  }

  stop() {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  private scheduleNext() {
    this.timer = setTimeout(() => {
      if (this.mode === 'welcome') {
        this.welcomeElapsed += this.loopDelay
        if (this.welcomePhase === 'flipping') {
          this.flipWelcomeAll()
          if (this.welcomeElapsed >= 2000) {
            this.welcomePhase = 'settled'
            this.settleWelcome()
            this.loopDelay = 2000
          }
        } else {
          this.flipWelcomeIdle()
        }
      } else if (this.mode === 'loading') {
        this.flipLoading()
      } else if (this.mode === 'fading') {
        this.flipFading()
        this.loopDelay = Math.min(2000, this.loopDelay + 150)
        this.fadeRatio += 0.08
      }

      if (this.mode !== 'fading' || this.fadeRatio <= 1.5) {
        this.scheduleNext()
      }
    }, this.loopDelay)
  }

  // --- Welcome Mode ---
  private fillWelcomeAll() {
    const { cols, rows } = this.config
    const instructions: CellInstruction[] = []

    const welcomeLines = this.currentWelcomeText ? this.currentWelcomeText.split('\n') : []
    const welcomeStartRow = Math.max(0, Math.floor((rows - welcomeLines.length) / 2))

    for (let i = 0; i < welcomeLines.length; i++) {
      const line = welcomeLines[i]
      const r = welcomeStartRow + i
      const pad = Math.floor((cols - line.length) / 2)
      for (let j = 0; j < line.length; j++) {
        const c = pad + j
        if (c >= 0 && c < cols && line[j] !== ' ') {
          this.occupied.add(`${r},${c}`)
        }
      }
    }

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (Math.random() < 0.35) {
          instructions.push({ row: r, col: c, char: ' ', delay: Math.floor(Math.random() * 10) })
        } else {
          const char = WELCOME_CHARS[Math.floor(Math.random() * WELCOME_CHARS.length)]
          instructions.push({ row: r, col: c, char, delay: Math.floor(Math.random() * 15), options: { textColor: '160,155,145' } })
        }
      }
    }
    this.onInstructions(instructions)
  }

  private flipWelcomeAll() {
    const { cols, rows } = this.config
    const instructions: CellInstruction[] = []
    const totalCells = cols * rows
    const count = Math.floor(totalCells * 0.2) + Math.floor(Math.random() * Math.floor(totalCells * 0.1))
    for (let i = 0; i < count; i++) {
      const r = Math.floor(Math.random() * rows)
      const c = Math.floor(Math.random() * cols)
      const char = Math.random() < 0.3 ? ' ' : WELCOME_CHARS[Math.floor(Math.random() * WELCOME_CHARS.length)]
      instructions.push({ row: r, col: c, char, delay: Math.floor(Math.random() * 12), options: { textColor: '160,155,145' } })
    }
    if (instructions.length > 0) this.onInstructions(instructions)
  }

  private settleWelcome() {
    const { cols, rows } = this.config
    const instructions: CellInstruction[] = []

    const welcomeLines = this.currentWelcomeText ? this.currentWelcomeText.split('\n') : []
    const welcomeStartRow = Math.max(0, Math.floor((rows - welcomeLines.length) / 2))
    const centerR = rows / 2
    const centerC = cols / 2

    // 先让其他格子从中心向外扩散消失
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (this.occupied.has(`${r},${c}`)) continue
        const dist = Math.abs(r - centerR) + Math.abs(c - centerC)
        instructions.push({ row: r, col: c, char: ' ', delay: Math.floor(dist * 1.2 + Math.random() * 4) })
      }
    }

    // 欢迎文字稍后出现，让消失动画先开始
    for (let i = 0; i < welcomeLines.length; i++) {
      const line = welcomeLines[i]
      const r = welcomeStartRow + i
      const pad = Math.floor((cols - line.length) / 2)
      for (let j = 0; j < line.length; j++) {
        const c = pad + j
        if (c >= 0 && c < cols && line[j] !== ' ') {
          instructions.push({
            row: r, col: c, char: line[j],
            delay: Math.floor(5 + j * 1.2 + Math.random() * 2),
            options: { textColor: '20,20,19' },
          })
        }
      }
    }

    this.onInstructions(instructions)
  }

  private flipWelcomeIdle() {
    // settled后偶尔翻动一两个字，保持微动感
  }

  // --- Loading Mode ---
  private fillLoading() {
    const { cols, rows } = this.config
    const instructions: CellInstruction[] = []
    for (let r = 0; r < rows; r++) {
      let c = 0
      while (c < cols) {
        if (Math.random() < 0.3) {
          instructions.push({ row: r, col: c, char: ' ', delay: Math.floor(r * 1.5 + c * 0.5 + Math.random() * 5) })
          c++
        } else if (Math.random() < 0.4) {
          const phrase = CHINESE_PHRASES[Math.floor(Math.random() * CHINESE_PHRASES.length)]
          for (let i = 0; i < phrase.length && c < cols; i++, c++) {
            instructions.push({ row: r, col: c, char: phrase[i], delay: Math.floor(r * 1.5 + c * 0.5 + Math.random() * 5), options: { textColor: '140,135,125' } })
          }
        } else {
          const char = SINGLE_CHARS[Math.floor(Math.random() * SINGLE_CHARS.length)]
          instructions.push({ row: r, col: c, char, delay: Math.floor(r * 1.5 + c * 0.5 + Math.random() * 5), options: { textColor: '140,135,125' } })
          c++
        }
      }
    }
    this.onInstructions(instructions)
  }

  private flipLoading() {
    const { cols, rows } = this.config
    const instructions: CellInstruction[] = []
    this.loadingWave++

    const pattern = this.loadingWave % 4
    if (pattern === 0) {
      // 横向波浪：翻转2-3行
      const startRow = Math.floor(Math.random() * (rows - 2))
      const rowCount = 2 + Math.floor(Math.random() * 2)
      for (let r = startRow; r < startRow + rowCount && r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const char = this.randomLoadingChar()
          instructions.push({ row: r, col: c, char, delay: Math.floor(c * 1.5 + Math.random() * 3), options: { textColor: '140,135,125' } })
        }
      }
    } else if (pattern === 1) {
      // 纵向波浪：翻转3-4列
      const startCol = Math.floor(Math.random() * (cols - 3))
      const colCount = 3 + Math.floor(Math.random() * 2)
      for (let c = startCol; c < startCol + colCount && c < cols; c++) {
        for (let r = 0; r < rows; r++) {
          const char = this.randomLoadingChar()
          instructions.push({ row: r, col: c, char, delay: Math.floor(r * 2 + Math.random() * 3), options: { textColor: '140,135,125' } })
        }
      }
    } else if (pattern === 2) {
      // 对角线波浪
      const offset = Math.floor(Math.random() * (rows + cols))
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const diag = r + c
          if (Math.abs(diag - offset) <= 1) {
            const char = this.randomLoadingChar()
            instructions.push({ row: r, col: c, char, delay: Math.floor(diag * 1.2 + Math.random() * 2), options: { textColor: '140,135,125' } })
          }
        }
      }
    } else {
      // 散落式：少量随机格子翻动
      const count = 8 + Math.floor(Math.random() * 10)
      for (let i = 0; i < count; i++) {
        const r = Math.floor(Math.random() * rows)
        const c = Math.floor(Math.random() * cols)
        const char = this.randomLoadingChar()
        instructions.push({ row: r, col: c, char, delay: Math.floor(Math.random() * 8), options: { textColor: '140,135,125' } })
      }
    }

    if (instructions.length > 0) this.onInstructions(instructions)
  }

  private randomLoadingChar(): string {
    if (Math.random() < 0.25) return ' '
    if (Math.random() < 0.4) {
      const phrase = CHINESE_PHRASES[Math.floor(Math.random() * CHINESE_PHRASES.length)]
      return phrase[Math.floor(Math.random() * phrase.length)]
    }
    return SINGLE_CHARS[Math.floor(Math.random() * SINGLE_CHARS.length)]
  }

  // --- Fading Mode ---
  private flipFading() {
    const { cols, rows } = this.config
    const instructions: CellInstruction[] = []
    const totalCells = cols * rows
    const baseCount = Math.floor(totalCells * 0.2)
    const count = Math.max(3, Math.floor(baseCount * (1 - this.fadeRatio * 0.6)))
    const colorVal = Math.floor(160 + this.fadeRatio * 60)
    const textColor = `${colorVal},${colorVal - 5},${colorVal - 15}`

    for (let i = 0; i < count; i++) {
      const r = Math.floor(Math.random() * rows)
      const c = Math.floor(Math.random() * cols)
      if (this.occupied.has(`${r},${c}`)) continue
      const char = Math.random() < this.fadeRatio ? ' ' : SINGLE_CHARS[Math.floor(Math.random() * SINGLE_CHARS.length)]
      instructions.push({ row: r, col: c, char, delay: Math.floor(Math.random() * 2), options: { textColor } })
    }
    if (instructions.length > 0) this.onInstructions(instructions)
  }
}
