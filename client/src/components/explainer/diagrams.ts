import { type Pt, arrowHead, circlePts, dashes, line, rectPts } from './geometry'

// 参数化图示：AI 只给数量这类参数（几个圆点、十格框填几格、数轴从几到几），形状、位置、先后顺序全由这里算。
// 坐标在「格子」里（左上角 0,0，宽 W 高 H），scene.ts 再搬到画面上、排时间、写字。
// 画的顺序就是书写顺序：先框后点、先轴后刻度再数字。

export type Diagram =
  | { kind: 'dots'; count: number; groups?: number[]; highlight?: number }
  | { kind: 'tenframe'; filled: number; highlight?: number }
  | { kind: 'equation'; text: string }
  | { kind: 'shape'; shape: 'circle' | 'box' | 'triangle'; text?: string }
  | { kind: 'numberline'; from: number; to: number; marks?: number[]; jumps?: { from: number; to: number }[] }

export type DiagramPart =
  | { s: Pt[]; weight: 'out' | 'det' | 'thin'; accent: boolean }
  | { t: string; x: number; y: number; h: number; align: 'left' | 'center'; maxW?: number; accent: boolean }
export interface DiagramOut { parts: DiagramPart[]; box: { x: number; y: number; w: number; h: number } }

/** 实心圆点：从圆心往外一圈圈的螺旋，一笔画完，马克笔 / 针管笔画出来都是涂满的点 */
function blob(cx: number, cy: number, r: number, accent: boolean): DiagramPart[] {
  const turns = Math.max(2.5, r / 7), n = Math.ceil(turns * 18), pts: Pt[] = []
  for (let k = 0; k <= n; k++) { const u = k / n, a = u * turns * Math.PI * 2 - Math.PI / 2; pts.push([cx + Math.cos(a) * r * u, cy + Math.sin(a) * r * u]) }
  return [{ s: [...pts, ...circlePts(cx, cy, r, -Math.PI / 2 + turns * Math.PI * 2)], weight: 'out', accent }]
}

export function layoutDiagram(d: Diagram, W: number, H: number): DiagramOut {
  const parts: DiagramPart[] = []
  if (d.kind === 'dots') {
    const groups = d.groups?.length ? d.groups : [d.count]
    const cols = groups.map((g) => Math.min(5, g)), rows = groups.map((g) => Math.ceil(g / 5))
    const GAP = 1.3, units = cols.reduce((a, b) => a + b, 0) + (groups.length - 1) * GAP, maxRows = Math.max(...rows)
    const step = Math.min((W * 0.9) / units, (H * 0.75) / maxRows, 120), r = step * 0.3
    const x0 = (W - units * step) / 2, y0 = (H - maxRows * step) / 2
    let gx = x0, n = 0
    groups.forEach((g, gi) => {
      if (gi > 0) {
        const dx = gx - (GAP * step) / 2
        for (const s of dashes(dx, y0 + step * 0.05, dx, y0 + maxRows * step - step * 0.05, step * 0.28, step * 0.18)) parts.push({ s, weight: 'thin', accent: false })
      }
      for (let i = 0; i < g; i++) parts.push(...blob(gx + (i % 5) * step + step / 2, y0 + Math.floor(i / 5) * step + step / 2, r, n++ < (d.highlight ?? 0)))
      gx += cols[gi] * step + GAP * step
    })
    return { parts, box: { x: x0, y: y0, w: units * step, h: maxRows * step } }
  }
  if (d.kind === 'tenframe') {
    const c = Math.min((W * 0.9) / 5, (H * 0.75) / 2, 130), x0 = (W - 5 * c) / 2, y0 = (H - 2 * c) / 2
    for (const s of rectPts(x0, y0, 5 * c, 2 * c)) parts.push({ s, weight: 'out', accent: false })
    for (let i = 1; i < 5; i++) parts.push({ s: line(x0 + i * c, y0, x0 + i * c, y0 + 2 * c), weight: 'det', accent: false })
    parts.push({ s: line(x0, y0 + c, x0 + 5 * c, y0 + c), weight: 'det', accent: false })
    const hl = d.highlight ?? 0
    for (let i = 0; i < d.filled; i++) parts.push(...blob(x0 + (i % 5) * c + c / 2, y0 + Math.floor(i / 5) * c + c / 2, c * 0.3, i >= d.filled - hl))
    return { parts, box: { x: x0, y: y0, w: 5 * c, h: 2 * c } }
  }
  if (d.kind === 'equation') {
    // 算式就是一行大字：交给 scene.ts 按宽度缩字号（数字、+ − × ÷ = 都有笔画或字体）
    const h = Math.min(150, H * 0.45)
    parts.push({ t: d.text, x: W / 2, y: H / 2 - h / 2, h, align: 'center', maxW: W * 0.92, accent: false })
    return { parts, box: { x: W * 0.04, y: H / 2 - h / 2, w: W * 0.92, h } }
  }
  if (d.kind === 'shape') {
    const s = Math.min(W * 0.62, H * 0.78, 380), x0 = (W - s) / 2, y0 = (H - s) / 2, cx = W / 2, cy = H / 2
    if (d.shape === 'circle') parts.push({ s: circlePts(cx, cy, s / 2, -2.2), weight: 'out', accent: false })
    else if (d.shape === 'triangle') {
      const a: Pt = [cx, y0 + s * 0.04], b: Pt = [x0 + s, y0 + s * 0.9], c: Pt = [x0, y0 + s * 0.9]
      parts.push({ s: [a, b], weight: 'out', accent: false }, { s: [b, c], weight: 'out', accent: false }, { s: [c, a], weight: 'out', accent: false })
    } else for (const p of rectPts(x0, y0 + s * 0.12, s, s * 0.76)) parts.push({ s: p, weight: 'out', accent: false })
    if (d.text) {
      const h = Math.min(72, s * 0.2), ty = d.shape === 'triangle' ? y0 + s * 0.58 - h / 2 : cy - h / 2
      parts.push({ t: d.text, x: cx, y: ty, h, align: 'center', maxW: s * (d.shape === 'triangle' ? 0.5 : 0.72), accent: false })
    }
    return { parts, box: { x: x0, y: y0, w: s, h: s } }
  }
  // 数轴：轴 → 刻度 → 数字 → 标出的点 → 跳跃弧线
  const n = d.to - d.from, L = W * 0.86, x0 = (W - L) / 2, y = H * 0.56
  const X = (v: number) => x0 + ((v - d.from) / n) * L
  parts.push({ s: line(x0 - 24, y, x0 + L + 40, y), weight: 'out', accent: false }, { s: arrowHead(x0 + L + 40, y, 0, 26), weight: 'out', accent: false })
  const every = n > 12 ? 2 : 1
  for (let v = d.from; v <= d.to; v++) {
    parts.push({ s: line(X(v), y - 16, X(v), y + 16), weight: 'det', accent: false })
    if ((v - d.from) % every === 0) parts.push({ t: String(v), x: X(v), y: y + 30, h: 42, align: 'center', accent: false })
  }
  for (const m of d.marks || []) parts.push(...blob(X(m), y, 13, true))
  for (const j of d.jumps || []) {
    const a = X(j.from), b = X(j.to), hh = Math.min(170, Math.abs(b - a) * 0.45), pts: Pt[] = []
    for (let k = 0; k <= 24; k++) { const u = k / 24; pts.push([a + (b - a) * u, y - 26 - Math.sin(Math.PI * u) * hh]) }
    const end = pts[pts.length - 1], prev = pts[pts.length - 3]
    parts.push({ s: pts, weight: 'det', accent: true }, { s: arrowHead(end[0], end[1], Math.atan2(end[1] - prev[1], end[0] - prev[0]), 24), weight: 'det', accent: true })
  }
  return { parts, box: { x: x0 - 24, y: y - 200, w: L + 64, h: 290 } }
}
