import { Cell, CHARSET_EN, isChinese } from './Cell'
import type { BoardConfig, CellInstruction } from './types'
import { DEFAULT_BOARD_CONFIG } from './types'

// 禅意风格 — 宣纸/竹简色系
const WOOD_COLORS: [number, number, number][] = [
  [220, 207, 184],
  [212, 197, 171],
  [228, 215, 195],
  [204, 188, 160],
  [216, 202, 178],
]

export class BoardRenderer {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private config: BoardConfig
  private cells: Cell[][]
  private animId: number | null = null
  private boardWidth: number
  private boardHeight: number

  constructor(canvas: HTMLCanvasElement, config: BoardConfig = DEFAULT_BOARD_CONFIG) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')!
    this.config = config

    const { cols, rows, cellWidth, cellHeight, gap } = config
    this.boardWidth = cols * (cellWidth + gap) + gap
    this.boardHeight = rows * (cellHeight + gap) + gap

    canvas.width = this.boardWidth * 2
    canvas.height = this.boardHeight * 2
    canvas.style.width = this.boardWidth + 'px'
    canvas.style.height = this.boardHeight + 'px'
    this.ctx.scale(2, 2)

    this.cells = []
    for (let r = 0; r < rows; r++) {
      this.cells[r] = []
      for (let c = 0; c < cols; c++) {
        this.cells[r][c] = new Cell(r, c)
      }
    }
  }

  start() {
    const loop = () => {
      this.render()
      this.animId = requestAnimationFrame(loop)
    }
    this.animId = requestAnimationFrame(loop)
  }

  stop() {
    if (this.animId !== null) {
      cancelAnimationFrame(this.animId)
      this.animId = null
    }
  }

  applyInstructions(instructions: CellInstruction[]) {
    for (const inst of instructions) {
      const { row, col, char, delay, options } = inst
      if (row >= 0 && row < this.config.rows && col >= 0 && col < this.config.cols) {
        this.cells[row][col].startFlip(char, delay, options)
      }
    }
  }

  clear() {
    const { rows, cols } = this.config
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const delay = Math.floor(c * 0.3 + r * 0.5 + Math.random() * 2)
        this.cells[r][c].startFlip(' ', delay)
      }
    }
  }

  getConfig(): BoardConfig {
    return this.config
  }

  private render() {
    const { boardWidth, boardHeight, ctx, config } = this
    const { rows, cols } = config

    // 彻底扁平化，不绘制背景，直接透过全局的 body 背景 (#f5f4ed)
    ctx.clearRect(0, 0, boardWidth, boardHeight)

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        this.cells[r][c].update()
        this.drawCell(this.cells[r][c])
      }
    }
  }

  private drawCell(cell: Cell) {
    const { cellWidth: CELL_W, cellHeight: CELL_H, gap: GAP } = this.config
    const ctx = this.ctx
    const x = GAP + cell.col * (CELL_W + GAP)
    const y = GAP + cell.row * (CELL_H + GAP)
    const halfH = CELL_H / 2

    // --- Flat Tile Background ---
    // 完全透明，透出页面纸张颜色
    
    // Subtle, flat grid border (像信笺纸的网格线)
    ctx.strokeStyle = '#e8e6dc'
    ctx.lineWidth = 1
    ctx.strokeRect(x, y, CELL_W, CELL_H)

    // Flat crease line
    ctx.fillStyle = '#e8e6dc'
    ctx.fillRect(x, y + halfH, CELL_W, 1)

    // --- Top edge highlight (3D depth) ---
    ctx.fillStyle = 'rgba(255,255,255,0.4)'
    ctx.fillRect(x + 1, y + 1, CELL_W - 2, 1)

    // --- Bottom edge shadow ---
    ctx.fillStyle = 'rgba(100,80,60,0.1)'
    ctx.fillRect(x + 1, y + CELL_H - 1, CELL_W - 2, 1)

    // --- Character rendering ---
    let displayChar = cell.currentChar
    let charAlpha = 1
    let yOffset = 0

    if (cell.isFlipping && cell.flipDelay <= 0) {
      const p = cell.flipProgress
      if (p < 0.5) {
        const scale = Math.cos(p * Math.PI)
        yOffset = (1 - scale) * 3
        charAlpha = 0.5 + scale * 0.5
      } else {
        // 翻牌过程中的模糊字迹全部使用中文
        displayChar = '天地人和静悟空'[Math.floor(Math.random() * 7)]
        
        const scale = Math.cos((1 - p) * Math.PI)
        yOffset = -(1 - scale) * 3
        charAlpha = 0.5 + scale * 0.5
      }
    }

    if (displayChar && displayChar !== ' ') {
      ctx.save()
      const color = cell.textColor || '20,20,19'
      ctx.globalCompositeOperation = 'multiply' // 维持墨水质感
      ctx.fillStyle = `rgba(${color}, ${charAlpha})`

      if (cell.bigChar) {
        // Big char mode: render at 2x size, clip to show only one quadrant
        const bigFontSize = CELL_H * 1.1
        ctx.font = `bold ${bigFontSize}px "TsangerJinKai02", "Source Han Serif SC", serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'

        let textX = x + CELL_W / 2
        let textY = y + CELL_H / 2 + yOffset
        if (cell.bigChar === 'tl') { textX += CELL_W / 2; textY += CELL_H / 2 }
        else if (cell.bigChar === 'tr') { textX -= CELL_W / 2; textY += CELL_H / 2 }
        else if (cell.bigChar === 'bl') { textX += CELL_W / 2; textY -= CELL_H / 2 }
        else if (cell.bigChar === 'br') { textX -= CELL_W / 2; textY -= CELL_H / 2 }

        ctx.beginPath()
        ctx.rect(x, y, CELL_W, CELL_H)
        ctx.clip()
        ctx.fillText(displayChar, textX, textY)
      } else {
        const fontSize = CELL_H * 0.52
        ctx.font = `bold ${fontSize}px "TsangerJinKai02", "Source Han Serif SC", serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(displayChar, x + CELL_W / 2, y + CELL_H / 2 + yOffset)
      }
      ctx.restore()
    }

    // 翻牌时轻微阴影，仅在翻转中间阶段显示
    if (cell.isFlipping && cell.flipDelay <= 0) {
      const shadowAlpha = Math.sin(cell.flipProgress * Math.PI) * 0.04
      if (shadowAlpha > 0.005) {
        ctx.fillStyle = `rgba(0,0,0,${shadowAlpha})`
        ctx.fillRect(x + 1, y + 1, CELL_W - 2, CELL_H - 2)
      }
    }
  }

  private drawLedStrips() {
    // 移除LED灯带渲染，以符合竹简/宣纸的自然禅意风格
  }
}
