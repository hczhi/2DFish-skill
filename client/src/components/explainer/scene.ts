import { apiGet } from '../../lib/api'
import { type Pt, arrowHead, catmull, circlePts, clamp, dashes, iconStrokes, lengths, line, missingIcon, rectPts } from './geometry'
import { type Diagram, layoutDiagram } from './diagrams'

// 场景 JSON（风格无关）→ 编译成「带时间的笔画 + 镜头」（Plan），白板 / 蓝图两个渲染器读同一份 Plan。
//
// **坐标、时间、镜头、排版全在这里由代码算，场景里一个都没有。** AI 只写「这一镜讲什么、画哪几个图标、谁指向谁」
// 和每镜的大致秒数（只当比例用，总和按 duration 归一）。让模型给坐标的话它会编一组看起来合理的数，
// 字压在线上、出画面，而且不报错；给时间戳的话各镜加起来对不上总时长。

export type StyleId = 'whiteboard' | 'blueprint' | 'sketch'
export const STYLES: { id: StyleId; name: string }[] = [
  { id: 'whiteboard', name: '白板讲解' },
  { id: 'blueprint', name: '蓝图 / 工程制图' },
  { id: 'sketch', name: '白纸手绘' },
]

export type Item =
  | { id: string; type: 'icon'; icon: string; label?: string; accent?: boolean }
  | { id: string; type: 'text'; text: string; accent?: boolean }
  | { id: string; type: 'list'; items: string[] }
  /** 参数化图示（圆点组 / 十格框 / 算式 / 形状 / 数轴），见 diagrams.ts */
  | ({ id: string; type: 'diagram'; label?: string; accent?: boolean } & Diagram)
export interface Arrow { from: string; to: string; label?: string; dashed?: boolean }
/**
 * 版式：这一镜的东西怎么摆。grid 平均分格；hero 第一个放大当主角、其余排右边；reveal 第一个特大（大数字 / 结论）、其余排下面；
 * compare 左右两栏中间虚线（前一半在左）；flow 一排自动连箭头；hub 第一个在中间、其余围一圈连线；timeline 一条横线、元素上下交替挂在线上。
 */
export const LAYOUTS = ['grid', 'hero', 'reveal', 'compare', 'flow', 'hub', 'timeline'] as const
export type Layout = (typeof LAYOUTS)[number]
/** 讲解动作：元素都画完之后，按顺序对某个元素做 —— 圈出来 / 划下划线 / 打叉 / 打勾 / 框住 / 镜头推近 */
export const BEATS = ['circle', 'underline', 'cross', 'check', 'box', 'zoom'] as const
export interface Beat { do: (typeof BEATS)[number]; target: string }
export interface Shot {
  /** 只当比例：几镜的 seconds 加起来按 Scene.duration 归一 */
  seconds?: number
  heading?: string
  items: Item[]
  arrows?: Arrow[]
  note?: string
  layout?: Layout
  beats?: Beat[]
}
export interface Scene { version: 1; title: string; duration: number; shots: Shot[] }

/** aside = 补充说明（白纸手绘里是蓝色批注；另两种风格按 signal 画） */
export type Tone = 'ink' | 'signal' | 'accent' | 'aside'
export type Weight = 'out' | 'det' | 'thin' | 'hair'
export interface PlanStroke { pts: Pt[]; t0: number; t1: number; weight: Weight; tone: Tone; letterH?: number; dash?: 'centre'; shot: number }
/** 没有笔顺数据的字（字母、数字、标点、库里没有的汉字）：用手写体字体从左往右写出来 */
export interface PlanText { text: string; x: number; y: number; size: number; t0: number; t1: number; tone: Tone; shot: number }
export interface CamKey { t: number; x: number; y: number; z: number; ease: 'io' | 'l' | 'cut' }
export interface Region { x: number; y: number; w: number; h: number; shot: number; start: number; end: number }
export interface Plan {
  style: StyleId; title: string; width: number; height: number; duration: number
  strokes: PlanStroke[]; texts: PlanText[]; camera: CamKey[]; regions: Region[]
  /** 编出来但有问题的地方（缺图标、字缩小了、没有笔顺的字……），页面上要显示 */
  notes: string[]
}

// 字母 / 数字用内置的 Architects Daughter（OFL，client/public/fonts/explainer），预览和服务器导出是同一个字体；
// 中文标点按笔画写（SYM），不靠中文字体。后面那串中文字体只给「笔顺库里没有的生僻字」兜底。
export const HAND_FONT = '"ExplainerHand", "PingFang SC", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif'
const FONT_URL = '/fonts/explainer/ArchitectsDaughter-Regular.ttf'
export const RW = 1920, RH = 1080
/** 蓝图标题栏（图纸右下角）的尺寸，编译（填字）和渲染器（画框）共用 */
export const TB_W = 1300, TB_H = 300
const HAN = /\p{Script=Han}/u

// ——— 手写字体：加载后用「量宽度」确认真的生效（document.fonts.check 对没有的字体也回 true）———
let fontReady: Promise<string> | null = null
export function loadHandFont(): Promise<string> {
  fontReady ??= (async () => {
    try {
      const face = new FontFace('ExplainerHand', `url(${FONT_URL})`)
      await face.load()
      document.fonts.add(face)
    } catch (e: any) {
      fontReady = null
      return `手写字体没加载上（${e?.message || e}），字母和数字换成了系统字体，导出和预览可能不一样`
    }
    const c = document.createElement('canvas').getContext('2d')!
    c.font = '40px monospace'; const base = c.measureText('Rpm 0123 Torque').width
    c.font = '40px "ExplainerHand", monospace'
    return Math.abs(c.measureText('Rpm 0123 Torque').width - base) < 0.5 ? '手写字体加载了但没生效，字母和数字换成了系统字体' : ''
  })()
  return fontReady
}

/** 画之前要准备好的：手写字体 + 用到的汉字笔顺。回准备阶段的问题（字体没加载上之类），并进编译提示。 */
export async function prepare(scene: Scene): Promise<string[]> {
  const [font] = await Promise.all([loadHandFont(), loadGlyphs(scene)])
  return font ? [font] : []
}

// ——— 汉字笔顺：按需从服务端取，缓存在页面里 ———
const glyphs = new Map<string, number[][][] | null>()
export async function loadGlyphs(scene: Scene): Promise<string[]> {
  const all = new Set<string>()
  const add = (s?: string) => { for (const c of s || '') if (HAN.test(c) && !glyphs.has(c)) all.add(c) }
  add(scene.title); add('图名图号')
  for (const sh of scene.shots) {
    add(sh.heading); add(sh.note)
    for (const it of sh.items) {
      if (it.type === 'icon') add(it.label); if (it.type === 'text') add(it.text); if (it.type === 'list') it.items.forEach(add)
      if (it.type === 'diagram') { add(it.label); if (it.kind === 'equation') add(it.text); if (it.kind === 'shape') add(it.text) }
    }
    sh.arrows?.forEach((a) => add(a.label))
  }
  const chars = [...all]
  for (let i = 0; i < chars.length; i += 300) {
    const part = chars.slice(i, i + 300)
    const r = await apiGet<{ strokes: Record<string, number[][][]>; missing: string[] }>('/api/explainer/strokes', { chars: part.join('') })
    for (const c of part) glyphs.set(c, r.strokes[c] || null)
  }
  return [...glyphs.entries()].filter(([, v]) => !v).map(([k]) => k)
}

let measureCtx: CanvasRenderingContext2D | null = null
function measure(text: string, size: number) {
  measureCtx ??= document.createElement('canvas').getContext('2d')!
  measureCtx.font = `${size}px ${HAND_FONT}`
  return measureCtx.measureText(text).width
}

// ——— 中文标点和几个符号按笔画写（坐标在 1 见方、y 朝下，和汉字同一个格子），adv = 占几个字宽 ———
const dot = (x: number, y: number): Pt[] => [[x, y], [x + 0.004, y + 0.004]]
const arc = (cx: number, cy: number, r: number, a0: number, a1: number, ry = r): Pt[] => Array.from({ length: 13 }, (_, k) => [cx + Math.cos(a0 + ((a1 - a0) * k) / 12) * r, cy + Math.sin(a0 + ((a1 - a0) * k) / 12) * ry] as Pt)
const SYM: Record<string, { adv: number; s: Pt[][] }> = {
  '，': { adv: 0.55, s: [[[0.2, 0.8], [0.25, 0.85], [0.17, 0.97]]] },
  '。': { adv: 0.55, s: [arc(0.24, 0.86, 0.07, 0, Math.PI * 2.1)] },
  '、': { adv: 0.55, s: [[[0.16, 0.76], [0.3, 0.9]]] },
  '？': { adv: 0.72, s: [catmull([[0.24, 0.26], [0.32, 0.1], [0.52, 0.05], [0.66, 0.18], [0.62, 0.36], [0.46, 0.48], [0.45, 0.66]]), dot(0.45, 0.86)] },
  '！': { adv: 0.5, s: [[[0.25, 0.1], [0.25, 0.66]], dot(0.25, 0.86)] },
  '：': { adv: 0.5, s: [dot(0.24, 0.42), dot(0.24, 0.82)] },
  '；': { adv: 0.5, s: [dot(0.24, 0.42), [[0.24, 0.8], [0.27, 0.85], [0.2, 0.97]]] },
  '（': { adv: 0.5, s: [arc(0.62, 0.5, 0.36, Math.PI * 0.65, Math.PI * 1.35, 0.55)] },
  '）': { adv: 0.5, s: [arc(-0.12, 0.5, 0.36, -Math.PI * 0.35, Math.PI * 0.35, 0.55)] },
  '“': { adv: 0.5, s: [[[0.2, 0.1], [0.14, 0.26]], [[0.34, 0.1], [0.28, 0.26]]] },
  '”': { adv: 0.5, s: [[[0.2, 0.1], [0.14, 0.26]], [[0.34, 0.1], [0.28, 0.26]]] },
  '「': { adv: 0.5, s: [[[0.42, 0.1], [0.2, 0.1], [0.2, 0.5]]] },
  '」': { adv: 0.5, s: [[[0.1, 0.5], [0.1, 0.9], [-0.12, 0.9]]] },
  '《': { adv: 0.6, s: [[[0.36, 0.2], [0.12, 0.5], [0.36, 0.8]], [[0.52, 0.2], [0.28, 0.5], [0.52, 0.8]]] },
  '》': { adv: 0.6, s: [[[0.08, 0.2], [0.32, 0.5], [0.08, 0.8]], [[0.24, 0.2], [0.48, 0.5], [0.24, 0.8]]] },
  '—': { adv: 1, s: [[[0.04, 0.52], [0.96, 0.51]]] },
  '…': { adv: 1, s: [dot(0.18, 0.55), dot(0.5, 0.55), dot(0.82, 0.55)] },
  '·': { adv: 0.4, s: [dot(0.2, 0.52)] },
  '×': { adv: 0.8, s: [[[0.18, 0.32], [0.62, 0.78]], [[0.62, 0.32], [0.18, 0.78]]] },
  '÷': { adv: 0.8, s: [[[0.12, 0.55], [0.68, 0.55]], dot(0.4, 0.34), dot(0.4, 0.76)] },
  '→': { adv: 1, s: [[[0.06, 0.56], [0.92, 0.55]], [[0.7, 0.38], [0.92, 0.55], [0.7, 0.72]]] },
  '←': { adv: 1, s: [[[0.94, 0.56], [0.08, 0.55]], [[0.3, 0.38], [0.08, 0.55], [0.3, 0.72]]] },
  '≈': { adv: 0.8, s: [catmull([[0.12, 0.46], [0.28, 0.4], [0.5, 0.48], [0.68, 0.42]]), catmull([[0.12, 0.66], [0.28, 0.6], [0.5, 0.68], [0.68, 0.62]])] },
}

// ——— 文字：汉字按笔顺写成笔画，其余用手写体字体，一段一段排 ———
type StrokePart = Omit<PlanStroke, 't0' | 't1' | 'shot'>
type TextPart = Omit<PlanText, 't0' | 't1' | 'shot'>
/** 一个书写任务：笔画和字体文字按书写顺序排在一起 */
interface Task { parts: ({ s: StrokePart } | { x: TextPart })[]; pause?: number; zoom?: Box }
interface Box { x: number; y: number; w: number; h: number }
interface Cell { x: number; y: number; w: number; h: number; scale: number }
const task = (): Task => ({ parts: [] })
const addS = (t: Task, s: StrokePart) => t.parts.push({ s })
const addX = (t: Task, x: TextPart) => t.parts.push({ x })
const ADV = 1.04
function textWidth(str: string, h: number) {
  let w = 0, run = ''
  const flush = () => { if (run) { w += measure(run, h * 0.92); run = '' } }
  for (const c of str) {
    if (SYM[c]) { flush(); w += h * SYM[c].adv * ADV } else if (HAN.test(c) && glyphs.get(c)) { flush(); w += h * ADV } else run += c
  }
  flush()
  return w
}
function writeText(str: string, x: number, y: number, h: number, tone: Tone, missing: Set<string>): Task {
  const out = task()
  let cx = x, run = '', runX = x
  const flush = () => { if (run) { addX(out, { text: run, x: runX, y: y + h * 0.84, size: h * 0.92, tone }); cx = runX + measure(run, h * 0.92); run = '' } }
  for (const c of str) {
    const sym = SYM[c]
    if (sym) {
      flush()
      for (const st of sym.s) addS(out, { pts: st.map(([u, v]) => [cx + u * h, y + v * h] as Pt), weight: 'det', tone, letterH: h })
      cx += h * sym.adv * ADV
      continue
    }
    const med = HAN.test(c) ? glyphs.get(c) : undefined
    if (med) {
      flush()
      for (const m of med) {
        const pts = m.map(([px, py]) => [cx + (px / 1024) * h, y + ((900 - py) / 1024) * h] as Pt)
        addS(out, { pts: catmull(pts, 6), weight: 'det', tone, letterH: h })
      }
      cx += h * ADV
    } else {
      if (HAN.test(c)) missing.add(c)
      if (!run) runX = cx
      run += c
    }
  }
  flush()
  return out
}
/** 按宽度折行（中文逐字可断，英文按空格） */
function wrap(str: string, h: number, maxW: number): string[] {
  const lines: string[] = []
  let cur = ''
  for (const tok of str.match(/[A-Za-z0-9.,%+\-:/']+|\s+|./gu) || []) {
    if (textWidth(cur + tok, h) > maxW && cur.trim()) { lines.push(cur.trim()); cur = tok.trimStart() } else cur += tok
  }
  if (cur.trim()) lines.push(cur.trim())
  return lines
}
/** 一行放不下就缩字号（最多缩到 60%），再放不下才折行；缩了 / 折了都返回说明 */
function fitText(str: string, h: number, maxW: number, maxLines: number) {
  let size = h
  while (textWidth(str, size) > maxW && size > h * 0.6) size *= 0.94
  let lines = [str]
  if (textWidth(str, size) > maxW) { lines = wrap(str, size, maxW); while (lines.length > maxLines && size > h * 0.45) { size *= 0.92; lines = wrap(str, size, maxW) } }
  return { size, lines, shrunk: size < h * 0.98 }
}

/**
 * 每镜的起止秒数：seconds 只当比例，按总时长归一；不止一镜时整条最后留一段拉远看全貌。
 * **剧本页显示的时间和编译画面都用这一个公式** —— 两边各算一遍的话改了一边，剧本上写的「第 2 镜 4.5–9 秒」和画面对不上。
 */
export function shotWindows(duration: number, seconds: (number | undefined)[]) {
  const overview = seconds.length > 1 ? Math.min(2.2, duration * 0.12) : 0
  const w = seconds.map((s) => (s && s > 0 ? s : 1)), sum = w.reduce((a, b) => a + b, 0) || 1
  let at = 0
  const windows = w.map((x) => { const len = ((duration - overview) * x) / sum, r: [number, number] = [at, at + len]; at += len; return r })
  return { windows, overview }
}

// ——— 版式：每个元素一个格子（区域内坐标）+ 缩放；装饰（中线、时间轴）和自动连线另给 ———
const AREA_X = 150, AREA_W = RW - 300
function layoutCells(layout: Layout, n: number, top: number, bottom: number): Cell[] {
  const H = bottom - top, cells: Cell[] = []
  const row = (k: number, y: number, h: number, scale: number, x0 = AREA_X, w0 = AREA_W) => Array.from({ length: k }, (_, i) => ({ x: x0 + (i * w0) / k, y, w: w0 / k, h, scale }))
  if (n <= 0) return cells
  if (layout === 'hero' && n > 1) {
    cells.push({ x: AREA_X, y: top, w: AREA_W * 0.58, h: H, scale: 1.4 })
    const k = n - 1
    for (let i = 0; i < k; i++) cells.push({ x: AREA_X + AREA_W * 0.62, y: top + (i * H) / k, w: AREA_W * 0.38, h: H / k, scale: 0.8 })
    return cells
  }
  if (layout === 'hero' || (layout === 'reveal' && n === 1)) return [{ x: AREA_X, y: top, w: AREA_W, h: H, scale: layout === 'reveal' ? 2 : 1.5 }]
  if (layout === 'reveal') return [{ x: AREA_X, y: top, w: AREA_W, h: H * 0.62, scale: 1.9 }, ...row(n - 1, top + H * 0.62, H * 0.38, 0.75)]
  if (layout === 'compare') {
    const l = Math.ceil(n / 2), r = n - l, cw = AREA_W / 2 - 70, sc = n <= 2 ? 1.25 : 0.9
    for (let i = 0; i < l; i++) cells.push({ x: AREA_X, y: top + (i * H) / l, w: cw, h: H / l, scale: sc })
    for (let i = 0; i < r; i++) cells.push({ x: RW / 2 + 70, y: top + (i * H) / r, w: cw, h: H / r, scale: sc })
    return cells
  }
  if (layout === 'hub' && n > 2) {
    const cx = RW / 2, cy = (top + bottom) / 2, k = n - 1
    // 像思维导图：中间一个大格子，其余分成左右两列竖着排（画面高度放不下上下也各挂一个，挂了就压在中间那个上）
    const sw = 460, l = Math.ceil(k / 2), r = k - l
    cells.push({ x: AREA_X + sw + 20, y: cy - 220, w: AREA_W - 2 * sw - 40, h: 440, scale: 1.15 })
    const side = (count: number, x: number) => { for (let i = 0; i < count; i++) cells.push({ x, y: top + (i * H) / count, w: sw, h: H / count, scale: count > 2 ? 0.75 : 0.9 }) }
    // 先左后右交替编号，连线不交叉：第 1、3 个在左，第 2、4 个在右
    const left: Cell[] = [], right: Cell[] = []
    const keep = cells.length
    side(l, AREA_X); left.push(...cells.splice(keep))
    side(r, AREA_X + AREA_W - sw); right.push(...cells.splice(keep))
    for (let i = 0; i < k; i++) cells.push(i % 2 === 0 ? left[i >> 1] : right[i >> 1])
    return cells
  }
  if (layout === 'timeline') {
    const mid = (top + bottom) / 2, w = AREA_W / n
    for (let i = 0; i < n; i++) cells.push(i % 2 ? { x: AREA_X + i * w, y: mid + 50, w, h: bottom - mid - 50, scale: 0.78 } : { x: AREA_X + i * w, y: top, w, h: mid - top - 50, scale: 0.78 })
    return cells
  }
  // grid / flow（flow 一排放下）
  const rowsN = layout === 'flow' || n <= 4 ? 1 : 2, colsN = Math.ceil(n / rowsN), h = H / rowsN
  for (let r = 0; r < rowsN; r++) cells.push(...row(Math.min(colsN, n - r * colsN), top + r * h, h, rowsN === 1 && n <= 2 ? 1.2 : 1))
  return cells
}

// 两个框之间连线的端点（从框边出发，留一点空）
function edgeTo(b: Box, toward: Pt, pad = 34): Pt {
  const c: Pt = [b.x + b.w / 2, b.y + b.h / 2], dx = toward[0] - c[0], dy = toward[1] - c[1]
  const k = Math.min(Math.abs((b.w / 2 + pad) / (dx || 1e-6)), Math.abs((b.h / 2 + pad) / (dy || 1e-6)))
  return [c[0] + dx * k, c[1] + dy * k]
}
const centerOf = (b: Box): Pt => [b.x + b.w / 2, b.y + b.h / 2]

// ——— 编译 ———
export function compile(scene: Scene, style: StyleId): Plan {
  const notes: string[] = []
  const missing = new Set<string>()
  const n = scene.shots.length
  const cols = n <= 3 ? n : Math.ceil(Math.sqrt(n * 1.7))
  const rows = Math.ceil(n / cols)
  const gap = 280, pad = style === 'blueprint' ? 420 : 380
  const width = pad * 2 + cols * RW + (cols - 1) * gap
  const height = pad * 2 + rows * RH + (rows - 1) * gap + (style === 'blueprint' ? 380 : 0)

  const D = scene.duration
  const { windows, overview } = shotWindows(D, scene.shots.map((s) => s.seconds))
  const regions: Region[] = scene.shots.map((_, i) => {
    const row = Math.floor(i / cols), c = i % cols, col = row % 2 ? cols - 1 - c : c
    return { x: pad + col * (RW + gap), y: pad + row * (RH + gap), w: RW, h: RH, shot: i, start: windows[i][0], end: windows[i][1] }
  })

  const strokes: PlanStroke[] = [], texts: PlanText[] = []
  const camera: CamKey[] = []
  // 白纸手绘：一镜一张图 —— 镜头正好框住这一张（不留白板外沿），画完停住，下一镜硬切；元素往中间收，留出大片空白
  const sketch = style === 'sketch'
  const Z = sketch ? 1 : 0.96
  const push = (k: CamKey) => camera.push(k)
  const cur = () => camera[camera.length - 1]
  const TRAVEL = style === 'whiteboard' ? 0.75 : sketch ? 0 : 0.3

  scene.shots.forEach((shot, si) => {
    const R = regions[si], X = R.x, Y = R.y
    const at = `第 ${si + 1} 镜`
    const tasks: Task[] = []
    const local = (px: number, py: number): Pt => [X + px, Y + py]
    const layout: Layout = shot.layout && (LAYOUTS as readonly string[]).includes(shot.layout) ? shot.layout : 'grid'
    // 标题
    if (shot.heading) {
      const HS = sketch ? 76 : 104
      const f = fitText(shot.heading, HS, RW - 300, 1)
      if (f.shrunk) notes.push(`${at}标题太长，字号缩到 ${Math.round((f.size / HS) * 100)}%`)
      const head = style === 'blueprint' ? `FIG. ${si + 1}  ${f.lines[0]}` : f.lines[0]
      tasks.push(writeText(head, X + 150, Y + (sketch ? 100 : 90), f.size, 'ink', missing))
    }
    const items = shot.items.slice(0, 6)
    if (shot.items.length > 6) notes.push(`${at}元素超过 6 个，只画了前 6 个`)
    const top = shot.heading ? 290 : 170, bottom = shot.note ? 850 : 960
    // 白纸手绘：格子整体往画面中心收 18%（主体只占画面一半左右，剩下的是空白）
    const SK = 0.82
    const cells = layoutCells(layout, items.length, top, bottom).map((c) => (sketch
      ? { x: RW / 2 + (c.x - RW / 2) * SK, y: (top + bottom) / 2 + (c.y - (top + bottom) / 2) * SK, w: c.w * SK, h: c.h * SK, scale: c.scale * 0.88 }
      : c))
    const boxes = new Map<string, Box>()

    // 版式自带的装饰：先画（时间轴的线、对比的中线）
    if (layout === 'compare' && items.length > 1) {
      const tk = task()
      for (const d of dashes(X + RW / 2, Y + top + 10, X + RW / 2, Y + bottom - 10, 34, 24)) addS(tk, { pts: d, weight: 'thin', tone: 'ink' })
      tasks.push(tk)
    }
    if (layout === 'timeline' && items.length) {
      const tk = task(), mid = (top + bottom) / 2
      addS(tk, { pts: line(X + AREA_X - 20, Y + mid, X + AREA_X + AREA_W + 30, Y + mid), weight: 'out', tone: 'ink' })
      addS(tk, { pts: arrowHead(X + AREA_X + AREA_W + 30, Y + mid, 0, 34), weight: 'out', tone: 'ink' })
      tasks.push(tk)
    }

    items.forEach((it, k) => {
      const cell = cells[k], cx0 = cell.x, cy0 = cell.y, cellW = cell.w, cellH = cell.h, sc = cell.scale
      const tone: Tone = 'accent' in it && it.accent ? 'accent' : 'ink'
      const labelBase = Math.min(1.25, Math.max(0.8, sc))
      if (it.type === 'icon') {
        const labelH = it.label ? (sketch ? 54 : 62) * labelBase : 0
        // 白纸手绘的标签是批注：写在图标上方、一根小箭头指下来（另两种风格写在下方）
        const room = labelH * (sketch ? 2.4 : 1.6)
        const s = Math.max(60, Math.min(cellW * 0.62, cellH * 0.8 - room, 440 * sc))
        const ix = cx0 + cellW / 2 - s / 2, iy = cy0 + (cellH - s - room) / 2 + (sketch ? room : 0)
        let raw = iconStrokes(it.icon)
        if (!raw) { notes.push(`${at}图标「${it.icon}」不在图标库里，画成了问号框`); raw = missingIcon() }
        const tk = task()
        if (style === 'blueprint') {
          // 制图顺序：先中心线，再轮廓
          const [mx, my] = local(ix + s / 2, iy + s / 2)
          addS(tk, { pts: [[mx - s * 0.62, my], [mx + s * 0.62, my]], weight: 'hair', tone: 'ink', dash: 'centre' }); addS(tk, { pts: [[mx, my - s * 0.62], [mx, my + s * 0.62]], weight: 'hair', tone: 'ink', dash: 'centre' })
        }
        for (const st of raw) addS(tk, { pts: st.map(([u, v]) => local(ix + (u / 24) * s, iy + (v / 24) * s)), weight: 'out', tone })
        // 白纸手绘：物件脚下几笔断续的地面线，物件才「放」在纸上
        if (sketch) for (let g = 0; g < 4; g++) { const gx = ix + s * (0.08 + g * 0.24), gy = iy + s + 14 + (g % 2) * 4; addS(tk, { pts: line(X + gx, Y + gy, X + gx + s * (g === 1 ? 0.14 : 0.08), Y + gy), weight: 'hair', tone: 'ink' }) }
        tasks.push(tk)
        boxes.set(it.id, { x: X + ix, y: Y + iy, w: s, h: s })
        if (it.label) {
          const f = fitText(it.label, labelH, cellW * 0.9, 1)
          if (f.shrunk) notes.push(`${at}「${it.label}」太长，字号缩到 ${Math.round((f.size / labelH) * 100)}%`)
          const w = textWidth(f.lines[0], f.size)
          if (sketch) {
            const lx = X + cx0 + cellW / 2, ly = Y + iy - room
            const tk2 = writeText(f.lines[0], lx - w / 2, ly, f.size, tone, missing)
            addS(tk2, { pts: [[lx + 3, ly + f.size * 1.25], [lx - 2, Y + iy - 22]], weight: 'hair', tone })
            addS(tk2, { pts: arrowHead(lx - 2, Y + iy - 22, Math.PI / 2, 20), weight: 'hair', tone })
            tasks.push(tk2)
          } else tasks.push(writeText(f.lines[0], X + cx0 + cellW / 2 - w / 2, Y + iy + s + labelH * 0.5, f.size, tone, missing))
        }
      } else if (it.type === 'diagram') {
        const labelH = it.label ? 58 * labelBase : 0
        const dh = cellH - labelH * 1.7
        const out = layoutDiagram(it, cellW, dh)
        const tk = task()
        const base = it.accent ? 'accent' : 'ink'
        for (const p of out.parts) {
          if ('s' in p) { addS(tk, { pts: p.s.map(([u, v]) => local(cx0 + u, cy0 + v)), weight: p.weight, tone: p.accent ? 'accent' : base }); continue }
          const f = fitText(p.t, p.h, p.maxW ?? cellW, 1)
          if (f.shrunk && p.h > 60) notes.push(`${at}「${p.t.slice(0, 12)}」太长，字号缩小了`)
          const w = textWidth(f.lines[0], f.size)
          const t = writeText(f.lines[0], X + cx0 + (p.align === 'center' ? p.x - w / 2 : p.x), Y + cy0 + p.y + (p.h - f.size) / 2, f.size, p.accent ? 'accent' : base, missing)
          tk.parts.push(...t.parts)
        }
        tasks.push(tk)
        boxes.set(it.id, { x: X + cx0 + out.box.x, y: Y + cy0 + out.box.y, w: out.box.w, h: out.box.h })
        if (it.label) {
          const f = fitText(it.label, labelH, cellW * 0.9, 1)
          if (f.shrunk) notes.push(`${at}「${it.label}」太长，字号缩到 ${Math.round((f.size / labelH) * 100)}%`)
          const w = textWidth(f.lines[0], f.size)
          tasks.push(writeText(f.lines[0], X + cx0 + cellW / 2 - w / 2, Y + cy0 + out.box.y + out.box.h + labelH * 0.55, f.size, base, missing))
        }
      } else {
        const lines0 = it.type === 'list' ? it.items : [it.text]
        const h = (it.type === 'list' ? 62 : it.accent ? 100 : 80) * sc
        const maxW = cellW * 0.88
        const laid: { text: string; size: number }[] = []
        for (const [li, raw] of lines0.entries()) {
          const prefix = it.type === 'list' ? `${li + 1}. ` : ''
          const f = fitText(prefix + raw, h, maxW, 3)
          if (f.shrunk && h >= 60) notes.push(`${at}文字「${raw.slice(0, 12)}…」太长，字号缩小了`)
          f.lines.forEach((l) => laid.push({ text: l, size: f.size }))
        }
        const total = laid.reduce((a, l) => a + l.size * 1.45, 0)
        if (total > cellH * 0.95) notes.push(`${at}文字太多，超出了自己的格子`)
        let ly = cy0 + Math.max(0, (cellH - total) / 2)
        const tk = task()
        let maxLine = 0
        for (const l of laid) {
          const w = textWidth(l.text, l.size)
          maxLine = Math.max(maxLine, w)
          const lx = it.type === 'list' ? cx0 + cellW * 0.06 : cx0 + cellW / 2 - w / 2
          tk.parts.push(...writeText(l.text, X + lx, Y + ly, l.size, tone, missing).parts)
          ly += l.size * 1.45
        }
        tasks.push(tk)
        const bx = it.type === 'list' ? cx0 + cellW * 0.06 : cx0 + cellW / 2 - maxLine / 2
        boxes.set(it.id, { x: X + bx, y: Y + cy0 + Math.max(0, (cellH - total) / 2), w: maxLine, h: total })
      }
      // 时间轴：每个元素一根短线连到轴上，轴上一个点
      if (layout === 'timeline') {
        const b = boxes.get(it.id)!, mid = Y + (top + bottom) / 2, cx = b.x + b.w / 2, up = k % 2 === 0
        const tk = task()
        addS(tk, { pts: line(cx, up ? b.y + b.h + 16 : b.y - 16, cx, mid), weight: 'thin', tone: 'ink' })
        addS(tk, { pts: circlePts(cx, mid, 12), weight: 'out', tone })
        tasks.push(tk)
      }
    })

    // 连线：明写的箭头；flow 没写箭头时按顺序自动连；hub 从中间连到每一个
    const arrows: Arrow[] = [...(shot.arrows || [])]
    if (layout === 'flow' && !arrows.length) for (let k = 1; k < items.length; k++) arrows.push({ from: items[k - 1].id, to: items[k].id })
    const spokes = layout === 'hub' && items.length > 2 && !arrows.length ? items.slice(1).map((it) => [items[0].id, it.id]) : []
    for (const [a, b] of spokes) {
      const A = boxes.get(a)!, B = boxes.get(b)!, p = edgeTo(A, centerOf(B), 24), q = edgeTo(B, centerOf(A), 24)
      const tk = task(); addS(tk, { pts: line(p[0], p[1], q[0], q[1]), weight: 'thin', tone: 'signal' }); tasks.push(tk)
    }
    for (const a of arrows) {
      const A = boxes.get(a.from), B = boxes.get(a.to)
      if (!A || !B) { notes.push(`${at}的箭头指向不存在的元素（${a.from} → ${a.to}）`); continue }
      const p = edgeTo(A, centerOf(B)), q = edgeTo(B, centerOf(A)), ang = Math.atan2(q[1] - p[1], q[0] - p[0])
      const tone: Tone = 'signal'
      const tk = task()
      if (a.dashed) dashes(p[0], p[1], q[0], q[1]).forEach((d) => addS(tk, { pts: d, weight: 'thin', tone }))
      else addS(tk, { pts: line(p[0], p[1], q[0], q[1]), weight: 'det', tone })
      addS(tk, { pts: arrowHead(q[0], q[1], ang, 34), weight: 'det', tone })
      if (a.label) {
        const f = fitText(a.label, 50, Math.max(160, Math.hypot(q[0] - p[0], q[1] - p[1]) * 0.9), 1)
        const w = textWidth(f.lines[0], f.size)
        tk.parts.push(...writeText(f.lines[0], (p[0] + q[0]) / 2 - w / 2, (p[1] + q[1]) / 2 - f.size * 1.5, f.size, tone, missing).parts)
      }
      tasks.push(tk)
    }
    // 注释（白板：一行蓝字；蓝图：画一个 NOTE 框）
    if (shot.note && sketch) {
      // 白纸手绘：注释是一条蓝色批注，贴着这一镜的主元素（第一个）写在它右边，一根短弯箭头指回去；右边放不下 / 会压到别的元素时写在它下面，都不行就退到右下角
      const f = fitText(shot.note, 50, RW * 0.36, 2)
      if (f.shrunk) notes.push(`${at}注释太长，字号缩小了`)
      const tk = task()
      const lh = f.size * 1.35, w = Math.max(...f.lines.map((l) => textWidth(l, f.size))), th = f.lines.length * lh
      const main = boxes.get(items[0]?.id ?? '')
      const hits = (x: number, y: number) => [...boxes.values()].some((b) => b !== main && x < b.x + b.w + 20 && x + w > b.x - 20 && y - f.size < b.y + b.h + 20 && y + th > b.y - 20)
      let nx = X + RW - 170 - w, ny = Y + 880, to: Pt | null = null
      if (main) {
        const rx = main.x + main.w + 110, ry = main.y + main.h * 0.25
        const bx = main.x + main.w * 0.5 - w / 2, by = main.y + main.h + 120
        if (rx + w < X + RW - 120 && !hits(rx, ry)) { nx = rx; ny = ry; to = [main.x + main.w + 22, main.y + main.h * 0.4] }
        else if (by + th < Y + RH - 60 && !hits(bx, by)) { nx = Math.max(X + 150, bx); ny = by; to = [main.x + main.w * 0.5, main.y + main.h + 26] }
        // 两边都放不下：写在右下角、不画箭头（硬画的话一根长箭头横穿整张图）
      }
      let ly = ny
      f.lines.forEach((l) => { tk.parts.push(...writeText(l, nx, ly, f.size, 'aside', missing).parts); ly += lh })
      if (to) {
        const from: Pt = to[1] > ny + th ? [nx + w * 0.3, ny + th - lh * 0.4] : [nx - 18, ny + f.size * 0.45]
        const mid: Pt = [(from[0] + to[0]) / 2, Math.min(from[1], to[1]) - 26]
        const curve = catmull([from, mid, to], 8)
        addS(tk, { pts: curve, weight: 'hair', tone: 'aside' })
        const a = curve[curve.length - 2]
        addS(tk, { pts: arrowHead(to[0], to[1], Math.atan2(to[1] - a[1], to[0] - a[0]), 20), weight: 'hair', tone: 'aside' })
      }
      tasks.push(tk)
    } else if (shot.note) {
      const f = fitText(shot.note, 60, RW - 520, 2)
      if (f.shrunk) notes.push(`${at}注释太长，字号缩小了`)
      const tk = task()
      const lh = f.size * 1.4, total = f.lines.length * lh
      let ly = 900 - (f.lines.length - 1) * lh * 0.5 - f.size * 0.5
      if (style === 'blueprint') {
        const w = Math.max(...f.lines.map((l) => textWidth(l, f.size))) + 220
        const bx = RW / 2 - w / 2, by = ly - 30
        for (const s of rectPts(X + bx, Y + by, w, total + 50)) addS(tk, { pts: s, weight: 'thin', tone: 'ink' })
        addS(tk, { pts: line(X + bx + 150, Y + by, X + bx + 150, Y + by + total + 50), weight: 'hair', tone: 'ink' })
        addX(tk, { text: 'NOTE', x: X + bx + 26, y: Y + by + 48, size: 30, tone: 'ink' })
      }
      for (const l of f.lines) {
        const w = textWidth(l, f.size)
        tk.parts.push(...writeText(l, X + RW / 2 - w / 2 + (style === 'blueprint' ? 75 : 0), Y + ly, f.size, 'signal', missing).parts)
        ly += lh
      }
      tasks.push(tk)
    }
    // 讲解动作：都画完之后，按顺序圈 / 划 / 叉 / 勾 / 框 / 推近
    for (const bt of (shot.beats || []).slice(0, 4)) {
      const b = boxes.get(bt.target)
      if (!b) { notes.push(`${at}的讲解动作「${bt.do}」对着一个不存在的元素（${bt.target}），没做`); continue }
      const tk = task()
      if (bt.do === 'circle') addS(tk, { pts: circlePts(b.x + b.w / 2, b.y + b.h / 2, b.w / 2 + 46, -2.3, b.h / 2 + 38).concat(circlePts(b.x + b.w / 2, b.y + b.h / 2, b.w / 2 + 50, -2.3, b.h / 2 + 42).slice(0, 8)), weight: 'out', tone: 'accent' })
      else if (bt.do === 'underline') { addS(tk, { pts: [[b.x - 10, b.y + b.h + 24], [b.x + b.w + 14, b.y + b.h + 18]], weight: 'out', tone: 'accent' }); addS(tk, { pts: [[b.x + b.w * 0.08, b.y + b.h + 40], [b.x + b.w * 0.94, b.y + b.h + 36]], weight: 'det', tone: 'accent' }) }
      else if (bt.do === 'cross') { addS(tk, { pts: [[b.x - 12, b.y - 12], [b.x + b.w + 12, b.y + b.h + 12]], weight: 'out', tone: 'accent' }); addS(tk, { pts: [[b.x + b.w + 12, b.y - 12], [b.x - 12, b.y + b.h + 12]], weight: 'out', tone: 'accent' }) }
      else if (bt.do === 'check') addS(tk, { pts: [[b.x + b.w + 24, b.y + b.h * 0.5], [b.x + b.w + 58, b.y + b.h * 0.82], [b.x + b.w + 128, b.y + b.h * 0.08]], weight: 'out', tone: 'accent' })
      else if (bt.do === 'box') for (const r of rectPts(b.x - 26, b.y - 26, b.w + 52, b.h + 52)) addS(tk, { pts: r, weight: 'det', tone: 'signal' })
      else if (bt.do === 'zoom') { tk.pause = 0.8; tk.zoom = b }
      tasks.push(tk)
    }

    // 进场：白板是镜头平移到这一块（作者定的：不要换镜时画连接线）；蓝图在强拍上硬切
    const t0 = R.start
    if (si === 0) push({ t: 0, x: X + RW / 2, y: Y + RH / 2, z: Z, ease: 'io' })
    else if (style === 'whiteboard') {
      push({ ...cur(), t: t0, ease: 'l' })
      push({ t: t0 + TRAVEL, x: X + RW / 2, y: Y + RH / 2, z: Z, ease: 'io' })
    } else if (sketch) {
      push({ ...cur(), t: t0 - 0.001, ease: 'l' })
      push({ t: t0, x: X + RW / 2, y: Y + RH / 2, z: Z, ease: 'cut' })
    } else {
      const from = cur()
      push({ ...from, t: t0 - 0.001, z: from.z * 1.035, ease: 'l' })
      push({ t: t0, x: X + RW / 2, y: Y + RH / 2, z: Z, ease: 'cut' })
    }

    // 排时间：进场之后开始写，末尾留出看的时间；推近这种动作占固定时长
    // 白纸手绘的「一张图」要停够看：画完留三成时间
    const hold = sketch ? clamp((R.end - R.start) * 0.3, 1, 3) : clamp((R.end - R.start) * 0.22, 0.6, 2.5)
    const w0 = R.start + (si > 0 ? TRAVEL + (sketch ? 0.25 : 0) : 0.3), w1 = Math.max(w0 + 0.5, R.end - hold)
    const partCost = (p: Task['parts'][number]) => ('s' in p ? Math.pow(Math.max(8, lengths(p.s.pts).at(-1)!), 0.62) : Math.pow(measure(p.x.text, p.x.size), 0.62) * 1.4)
    const cost = (t: Task) => t.parts.reduce((a, p) => a + partCost(p), 0)
    const C = tasks.map(cost).reduce((a, b) => a + b, 0) || 1
    const fixed = 0.12 * Math.max(0, tasks.length - 1) + tasks.reduce((a, t) => a + (t.pause || 0), 0)
    const speed = Math.max(0.1, w1 - w0 - fixed) / C
    if ((w1 - w0 - fixed) / C < 0.0018) notes.push(`${at}内容多、时间短，会写得很快 —— 给它多一点时长或删几个元素`)
    let t = w0
    tasks.forEach((tk, ti) => {
      if (tk.zoom) {
        // 推近到这个元素：白板是推镜头，蓝图在这一刻切成特写
        const b = tk.zoom, zz = clamp(Math.min(1920 / (b.w * 2.6), 1080 / (b.h * 2.6)), Z * 1.2, 2.0), [bx, by] = centerOf(b)
        if (style !== 'blueprint') { push({ ...cur(), t, ease: 'l' }); push({ t: t + 0.7, x: bx, y: by, z: zz, ease: 'io' }) }
        else { push({ ...cur(), t: t - 0.001, ease: 'l' }); push({ t, x: bx, y: by, z: zz, ease: 'cut' }) }
      }
      for (const p of tk.parts) {
        const d = partCost(p) * speed
        if ('s' in p) strokes.push({ ...p.s, t0: t, t1: t + d * 0.86, shot: si })
        else texts.push({ ...p.x, t0: t, t1: t + d * 0.9, shot: si })
        t += d
      }
      t += tk.pause || 0
      if (ti < tasks.length - 1) t += 0.12
    })
  })
  // 蓝图的标题栏是「预印 + 早就填好」的：在 0 秒之前写完，开场就在纸上。用笔画写，不靠服务器上有没有中文字体
  if (style === 'blueprint') {
    const bx = width - 90 - TB_W, by = height - 90 - TB_H
    const pre = (tk: Task) => tk.parts.forEach((p) => ('s' in p ? strokes.push({ ...p.s, t0: -2, t1: -1.5, shot: -1 }) : texts.push({ ...p.x, t0: -2, t1: -1.5, shot: -1 })))
    pre(writeText('图名', bx + 50, by + 40, 70, 'ink', missing))
    const f = fitText(scene.title || '未命名', 80, TB_W - 340, 1)
    pre(writeText(f.lines[0], bx + 290, by + 35, f.size, 'ink', missing))
    pre(writeText('图号', bx + 50, by + 190, 70, 'ink', missing))
    pre(writeText('BP-01', bx + 290, by + 190, 70, 'ink', missing))
  }
  if (missing.size) notes.push(`这些字没有笔顺数据，用普通手写字体写：${[...missing].join('')}`)

  // 结尾：拉远看全貌
  const last = regions[regions.length - 1]
  if (last && camera.length) {
    push({ ...cur(), t: last.end, z: style === 'blueprint' ? cur().z * 1.035 : cur().z, ease: 'l' })
    if (overview) {
      const fit = Math.min(1920 / (width * 1.06), 1080 / (height * 1.06))
      push({ t: Math.min(D, last.end + overview * 0.75), x: width / 2, y: height / 2, z: fit, ease: 'io' })
    }
    push({ ...cur(), t: D + 1, ease: 'l' })
  }
  camera.sort((a, b) => a.t - b.t)
  return { style, title: scene.title, width, height, duration: D, strokes, texts, camera, regions, notes }
}

/** 镜头在 t 时刻：z 按 1/z 插值（推拉像移动机位）；'cut' = 到点就跳 */
export function cameraAt(keys: CamKey[], t: number) {
  if (!keys.length) return { x: 0, y: 0, z: 1 }
  if (t <= keys[0].t) return keys[0]
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i], b = keys[i + 1]
    if (t >= b.t) continue
    if (b.ease === 'cut') return a
    const u0 = (t - a.t) / (b.t - a.t), u = b.ease === 'l' ? u0 : u0 < 0.5 ? 4 * u0 ** 3 : 1 - Math.pow(-2 * u0 + 2, 3) / 2
    return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, z: 1 / (1 / a.z + (1 / b.z - 1 / a.z) * u) }
  }
  return keys[keys.length - 1]
}
