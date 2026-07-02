import type {
  BoardConfig,
  BoardLayout,
  CellInstruction,
  CellFlipOptions,
  LayoutElement,
  LayoutElementText,
  LayoutElementBigText,
  LayoutElementPattern,
} from './types'
import { DEFAULT_BOARD_CONFIG } from './types'
import { isChinese } from './Cell'

export interface WisdomLayout {
  type: 'wisdom'
  keyword_color?: [number, number, number]
  sentence_color?: [number, number, number]
}

export interface WisdomData {
  keyword: string
  key_sentence: string
  interpretation?: string
}

export function buildWisdomSequence(
  data: WisdomData,
  layout: WisdomLayout,
  config: BoardConfig = DEFAULT_BOARD_CONFIG
) {
  const { cols, rows } = config
  const occupied = new Set<string>()
  const keywordInst: CellInstruction[] = []
  const sentenceInst: CellInstruction[] = []
  const interpInst: CellInstruction[] = []

  const keywordColor = layout.keyword_color || [140, 34, 28] // 朱砂红
  const sentenceColor = layout.sentence_color || [44, 40, 38] // 墨黑
  const interpretColor = '100,95,90' // 淡墨

  // --- Keyword: 2x2 big char mode ---
  const kwChars = [...data.keyword]
  const kwBlockWidth = kwChars.length * 2
  const kwStartCol = Math.max(0, Math.floor((cols - kwBlockWidth) / 2))
  const kwStartRow = 1

  for (let i = 0; i < kwChars.length; i++) {
    const ch = kwChars[i]
    const baseCol = kwStartCol + i * 2
    const quadrants: Array<{ dr: number; dc: number; q: 'tl' | 'tr' | 'bl' | 'br' }> = [
      { dr: 0, dc: 0, q: 'tl' },
      { dr: 0, dc: 1, q: 'tr' },
      { dr: 1, dc: 0, q: 'bl' },
      { dr: 1, dc: 1, q: 'br' },
    ]
    for (const { dr, dc, q } of quadrants) {
      const r = kwStartRow + dr
      const c = baseCol + dc
      if (r >= rows || c >= cols) continue
      occupied.add(`${r},${c}`)
      keywordInst.push({
        row: r,
        col: c,
        char: ch,
        delay: Math.floor(2 + Math.random() * 3),
        options: {
          textColor: `${keywordColor[0]},${keywordColor[1]},${keywordColor[2]}`,
          bgColor: `rgba(${keywordColor[0]}, ${keywordColor[1]}, ${keywordColor[2]}, 0.06)`,
          ledColor: keywordColor,
          bigChar: q,
        },
      })
    }
  }

  // --- Key sentence: normal text ---
  const sentence = data.key_sentence
  const sentenceRow = 4
  const sentenceLines = wrapText(sentence, cols)

  for (let i = 0; i < sentenceLines.length && sentenceRow + i < rows; i++) {
    const r = sentenceRow + i
    const line = sentenceLines[i]
    const pad = Math.floor((cols - line.length) / 2)

    for (let j = 0; j < line.length; j++) {
      const c = pad + j
      if (c < 0 || c >= cols) continue
      if (line[j] !== ' ') occupied.add(`${r},${c}`)
      sentenceInst.push({
        row: r,
        col: c,
        char: line[j],
        delay: Math.floor(j * 0.4 + Math.random() * 2),
        options: {
          textColor: `${sentenceColor[0]},${sentenceColor[1]},${sentenceColor[2]}`,
          ledColor: sentenceColor,
        },
      })
    }
  }

  // --- Interpretation: normal text ---
  if (data.interpretation) {
    const interpStartRow = 6
    const interpLines = wrapText(data.interpretation, cols)

    for (let i = 0; i < interpLines.length && interpStartRow + i < rows; i++) {
      const r = interpStartRow + i
      const line = interpLines[i]

      for (let j = 0; j < line.length; j++) {
        const c = j
        if (c >= cols) break
        if (line[j] !== ' ') occupied.add(`${r},${c}`)
        interpInst.push({
          row: r,
          col: c,
          char: line[j],
          delay: Math.floor(c * 0.3 + i * 2 + Math.random() * 2),
          options: {
            textColor: interpretColor,
          },
        })
      }
    }
  }

  return { occupied, keywordInst, sentenceInst, interpInst }
}

export function layoutToInstructions(layout: BoardLayout, config: BoardConfig = DEFAULT_BOARD_CONFIG): CellInstruction[] {
  switch (layout.type) {
    case 'centered':
      return centeredLayout(layout.elements, config)
    case 'two-column':
      return twoColumnLayout(layout.elements, config)
    case 'bigtext':
      return bigTextLayout(layout.elements, config)
    case 'pattern':
      return patternLayout(layout.elements, config)
    case 'mixed':
      return mixedLayout(layout.elements, config)
    default:
      return centeredLayout(layout.elements, config)
  }
}

export function textToInstructions(text: string, config: BoardConfig = DEFAULT_BOARD_CONFIG): CellInstruction[] {
  const layout: BoardLayout = {
    type: 'centered',
    elements: [{ type: 'text', content: text }],
  }
  return layoutToInstructions(layout, config)
}

function centeredLayout(elements: LayoutElement[], config: BoardConfig): CellInstruction[] {
  const textEl = elements.find(e => e.type === 'text') as LayoutElementText | undefined
  if (!textEl) return []

  const { cols, rows } = config
  const text = textEl.content
  const color = textEl.color

  const lines = wrapText(text, cols)
  const displayLines = lines.slice(0, rows)
  const startRow = Math.max(0, Math.floor((rows - displayLines.length) / 2))

  const instructions: CellInstruction[] = []

  for (let r = 0; r < rows; r++) {
    const lineIdx = r - startRow
    const line = (lineIdx >= 0 && lineIdx < displayLines.length) ? displayLines[lineIdx] : ''
    const pad = Math.floor((cols - line.length) / 2)

    for (let c = 0; c < cols; c++) {
      const charIdx = c - pad
      const ch = (charIdx >= 0 && charIdx < line.length) ? line[charIdx] : ' '
      const processed = isChinese(ch) ? ch : ch.toUpperCase()
      const delay = Math.floor(c * 0.8 + r * 2 + Math.random() * 3)
      const options: CellFlipOptions | undefined = color ? { textColor: color } : undefined
      instructions.push({ row: r, col: c, char: processed, delay, options })
    }
  }

  return instructions
}

function twoColumnLayout(elements: LayoutElement[], config: BoardConfig): CellInstruction[] {
  const { cols, rows } = config
  const textElements = elements.filter(e => e.type === 'text') as LayoutElementText[]
  const leftEl = textElements[0]
  const rightEl = textElements[1]

  const halfCols = Math.floor(cols / 2) - 1
  const instructions: CellInstruction[] = []

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      instructions.push({ row: r, col: c, char: ' ', delay: Math.floor(c * 0.5 + r) })
    }
  }

  if (leftEl) {
    const lines = wrapText(leftEl.content, halfCols)
    const displayLines = lines.slice(0, rows)
    const startRow = Math.max(0, Math.floor((rows - displayLines.length) / 2))
    for (let i = 0; i < displayLines.length; i++) {
      const r = startRow + i
      if (r >= rows) break
      const line = displayLines[i]
      for (let j = 0; j < line.length && j < halfCols; j++) {
        const ch = isChinese(line[j]) ? line[j] : line[j].toUpperCase()
        const delay = Math.floor(j * 2 + r * 4 + Math.random() * 5)
        const options: CellFlipOptions | undefined = leftEl.color ? { textColor: leftEl.color } : undefined
        instructions.push({ row: r, col: j, char: ch, delay, options })
      }
    }
  }

  if (rightEl) {
    const startCol = Math.floor(cols / 2) + 1
    const lines = wrapText(rightEl.content, halfCols)
    const displayLines = lines.slice(0, rows)
    const startRow = Math.max(0, Math.floor((rows - displayLines.length) / 2))
    for (let i = 0; i < displayLines.length; i++) {
      const r = startRow + i
      if (r >= rows) break
      const line = displayLines[i]
      for (let j = 0; j < line.length && j < halfCols; j++) {
        const ch = isChinese(line[j]) ? line[j] : line[j].toUpperCase()
        const delay = Math.floor((j + startCol) * 0.8 + r * 2 + Math.random() * 3)
        const options: CellFlipOptions | undefined = rightEl.color ? { textColor: rightEl.color } : undefined
        instructions.push({ row: r, col: startCol + j, char: ch, delay, options })
      }
    }
  }

  const divCol = Math.floor(cols / 2)
  for (let r = 0; r < rows; r++) {
    instructions.push({ row: r, col: divCol, char: '|', delay: Math.floor(r * 1.5) })
  }

  return instructions
}

function bigTextLayout(elements: LayoutElement[], config: BoardConfig): CellInstruction[] {
  const el = elements.find(e => e.type === 'bigtext') as LayoutElementBigText | undefined
  if (!el) return []

  const { cols, rows } = config
  const grid = textToPixelGrid(el.content, cols, rows)
  const fillChars = '█▓▒░#@&%$*'
  const defaultColors: [number, number, number][] = [
    [0, 255, 120], [50, 220, 255], [255, 200, 0], [255, 100, 50], [200, 100, 255],
  ]

  const instructions: CellInstruction[] = []

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const delay = Math.floor(c * 0.6 + r * 1.5 + Math.random() * 2)
      if (grid[r][c]) {
        const ch = fillChars[Math.floor(Math.random() * fillChars.length)]
        const color = el.color || defaultColors[Math.floor(Math.random() * defaultColors.length)]
        instructions.push({
          row: r,
          col: c,
          char: ch,
          delay,
          options: {
            bgColor: `rgba(${color[0]}, ${color[1]}, ${color[2]}, 0.15)`,
            textColor: `${color[0]},${color[1]},${color[2]}`,
            ledColor: color,
          },
        })
      } else {
        instructions.push({ row: r, col: c, char: ' ', delay })
      }
    }
  }

  return instructions
}

function patternLayout(elements: LayoutElement[], config: BoardConfig): CellInstruction[] {
  const el = elements.find(e => e.type === 'pattern') as LayoutElementPattern | undefined
  if (!el) return []

  const { cols, rows } = config
  const grid = patternToGrid(el.name, cols, rows)
  const fillChars = '█▓▒#*+'
  const defaultColors: Record<string, [number, number, number][]> = {
    heart: [[255, 60, 80], [255, 100, 120], [255, 40, 60]],
    star: [[255, 220, 50], [255, 180, 0], [255, 200, 80]],
    circle: [[0, 200, 255], [50, 150, 255], [100, 220, 255]],
    diamond: [[180, 100, 255], [140, 80, 220], [200, 130, 255]],
  }
  const colors = el.color ? [el.color] : (defaultColors[el.name] || defaultColors.heart)

  const instructions: CellInstruction[] = []

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const delay = Math.floor(Math.abs(c - cols / 2) * 0.8 + Math.abs(r - rows / 2) * 1.5 + Math.random() * 2)
      if (grid[r][c]) {
        const ch = fillChars[Math.floor(Math.random() * fillChars.length)]
        const color = colors[Math.floor(Math.random() * colors.length)]
        instructions.push({
          row: r,
          col: c,
          char: ch,
          delay,
          options: {
            bgColor: `rgba(${color[0]}, ${color[1]}, ${color[2]}, 0.2)`,
            textColor: `${color[0]},${color[1]},${color[2]}`,
            ledColor: color,
          },
        })
      } else {
        instructions.push({ row: r, col: c, char: ' ', delay })
      }
    }
  }

  return instructions
}

function mixedLayout(elements: LayoutElement[], config: BoardConfig): CellInstruction[] {
  const { cols, rows } = config
  const instructions: CellInstruction[] = []

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      instructions.push({ row: r, col: c, char: ' ', delay: Math.floor(c * 0.5 + r) })
    }
  }

  for (const el of elements) {
    if (el.type === 'text') {
      const textEl = el as LayoutElementText
      const startRow = textEl.row ?? 0
      const startCol = textEl.col ?? 0
      const maxWidth = cols - startCol
      const lines = wrapText(textEl.content, maxWidth)

      for (let i = 0; i < lines.length; i++) {
        const r = startRow + i
        if (r >= rows) break
        const line = lines[i]
        let colOffset = startCol
        if (textEl.align === 'center') {
          colOffset = startCol + Math.floor((maxWidth - line.length) / 2)
        } else if (textEl.align === 'right') {
          colOffset = startCol + maxWidth - line.length
        }
        for (let j = 0; j < line.length; j++) {
          const c = colOffset + j
          if (c >= cols) break
          const ch = isChinese(line[j]) ? line[j] : line[j].toUpperCase()
          const delay = Math.floor(c * 0.8 + r * 2 + Math.random() * 3)
          const options: CellFlipOptions | undefined = textEl.color ? { textColor: textEl.color } : undefined
          instructions.push({ row: r, col: c, char: ch, delay, options })
        }
      }
    } else if (el.type === 'bigtext') {
      const bigEl = el as LayoutElementBigText
      const subInstructions = bigTextLayout([bigEl], config)
      instructions.push(...subInstructions)
    } else if (el.type === 'pattern') {
      const patEl = el as LayoutElementPattern
      const subInstructions = patternLayout([patEl], config)
      instructions.push(...subInstructions)
    }
  }

  return instructions
}

// --- Helpers ---

function wrapText(text: string, maxWidth: number): string[] {
  const lines: string[] = []
  const rawLines = text.split('\n')

  for (const rawLine of rawLines) {
    if (rawLine.length <= maxWidth) {
      lines.push(rawLine)
    } else {
      let remaining = rawLine
      while (remaining.length > maxWidth) {
        let breakAt = remaining.lastIndexOf(' ', maxWidth)
        if (breakAt <= 0) breakAt = maxWidth
        lines.push(remaining.slice(0, breakAt))
        remaining = remaining.slice(breakAt).trimStart()
      }
      if (remaining) lines.push(remaining)
    }
  }

  return lines
}

function textToPixelGrid(text: string, cols: number, rows: number): boolean[][] {
  // Render at higher resolution then downsample for better quality
  const scale = 10
  const hiW = cols * scale
  const hiH = rows * scale

  const tempCanvas = document.createElement('canvas')
  tempCanvas.width = hiW
  tempCanvas.height = hiH
  const tCtx = tempCanvas.getContext('2d')!

  tCtx.fillStyle = '#000'
  tCtx.fillRect(0, 0, hiW, hiH)

  const isCN = [...text].some(isChinese)
  let fontSize = Math.min(hiH * 0.85, hiW / text.length * 1.4)
  if (isCN) fontSize = Math.min(hiH * 0.82, hiW / text.length * 0.92)

  tCtx.font = `bold ${fontSize}px ${isCN ? '"PingFang SC","Microsoft YaHei",sans-serif' : '"Arial Black","Impact",sans-serif'}`
  tCtx.fillStyle = '#fff'
  tCtx.textAlign = 'center'
  tCtx.textBaseline = 'middle'
  tCtx.fillText(text, hiW / 2, hiH / 2)

  const imageData = tCtx.getImageData(0, 0, hiW, hiH)

  // Downsample: for each cell, check if enough pixels in that block are lit
  const grid: boolean[][] = []
  for (let r = 0; r < rows; r++) {
    grid[r] = []
    for (let c = 0; c < cols; c++) {
      let litCount = 0
      const total = scale * scale
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const px = c * scale + dx
          const py = r * scale + dy
          const idx = (py * hiW + px) * 4
          if (imageData.data[idx] > 80) litCount++
        }
      }
      grid[r][c] = litCount > total * 0.25
    }
  }
  return grid
}

function patternToGrid(name: string, cols: number, rows: number): boolean[][] {
  const grid: boolean[][] = []
  for (let r = 0; r < rows; r++) {
    grid[r] = []
    for (let c = 0; c < cols; c++) {
      grid[r][c] = false
    }
  }

  const PATTERNS: Record<string, string[]> = {
    heart: [
      '  ##   ##  ',
      ' #### #### ',
      '###########',
      '###########',
      ' ######### ',
      '  #######  ',
      '   #####   ',
      '    ###    ',
      '     #     ',
    ],
  }

  if (name === 'heart') {
    const pattern = PATTERNS.heart
    const ph = pattern.length
    const pw = pattern[0].length
    const offR = Math.floor((rows - ph) / 2)
    const offC = Math.floor((cols - pw) / 2)
    for (let r = 0; r < ph && r + offR < rows; r++) {
      for (let c = 0; c < pw && c + offC < cols; c++) {
        if (r + offR >= 0 && c + offC >= 0) {
          grid[r + offR][c + offC] = pattern[r][c] === '#'
        }
      }
    }
  } else if (name === 'star') {
    const cx = cols / 2
    const cy = rows / 2
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const dx = (c - cx) / (cols / 2)
        const dy = (r - cy) / (rows / 2)
        const angle = Math.atan2(dy, dx)
        const dist = Math.sqrt(dx * dx + dy * dy)
        const starR = 0.5 + 0.3 * Math.cos(5 * angle)
        grid[r][c] = dist < starR
      }
    }
  } else if (name === 'circle') {
    const cx = cols / 2
    const cy = rows / 2
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const dx = (c - cx + 0.5) / (cols / 2.5)
        const dy = (r - cy + 0.5) / (rows / 2.5)
        const dist = Math.sqrt(dx * dx + dy * dy)
        grid[r][c] = dist < 1 && dist > 0.5
      }
    }
  } else if (name === 'diamond') {
    const cx = cols / 2
    const cy = rows / 2
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const dx = Math.abs(c - cx + 0.5) / (cols / 2)
        const dy = Math.abs(r - cy + 0.5) / (rows / 2)
        grid[r][c] = (dx + dy) < 0.75 && (dx + dy) > 0.3
      }
    }
  }

  return grid
}
