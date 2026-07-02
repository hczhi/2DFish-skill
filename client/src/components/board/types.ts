export interface BoardConfig {
  cols: number
  rows: number
  cellWidth: number
  cellHeight: number
  gap: number
}

export const DEFAULT_BOARD_CONFIG: BoardConfig = {
  cols: 20,
  rows: 12,
  cellWidth: 36,
  cellHeight: 42,
  gap: 2,
}

export type BigCharQuadrant = 'tl' | 'tr' | 'bl' | 'br'

export interface CellFlipOptions {
  bgColor?: string
  textColor?: string
  ledColor?: [number, number, number]
  bigChar?: BigCharQuadrant
}

export interface CellInstruction {
  row: number
  col: number
  char: string
  delay: number
  options?: CellFlipOptions
}

export type LayoutType = 'centered' | 'two-column' | 'bigtext' | 'pattern' | 'mixed'

export interface LayoutElementText {
  type: 'text'
  content: string
  row?: number
  col?: number
  align?: 'left' | 'center' | 'right'
  color?: string
}

export interface LayoutElementBigText {
  type: 'bigtext'
  content: string
  row?: number
  col?: number
  color?: [number, number, number]
}

export interface LayoutElementPattern {
  type: 'pattern'
  name: 'heart' | 'star' | 'circle' | 'diamond'
  color?: [number, number, number]
}

export type LayoutElement = LayoutElementText | LayoutElementBigText | LayoutElementPattern

export interface BoardLayout {
  type: LayoutType
  elements: LayoutElement[]
}

export interface AIResponse {
  answer: string
  layout: BoardLayout
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  layout?: BoardLayout
  keyword?: string
  domain?: string
  timestamp: number
}
