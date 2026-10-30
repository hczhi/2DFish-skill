import type { IconNode } from 'lucide'
import { ICONS } from '../broll/iconLibrary'

// 代码动画的共用几何：所有风格画的是同一份折线（按书写顺序），白板 / 蓝图只决定「怎么画」。
// 带随机感的东西一律用固定种子（同一个 t 每次画出来必须一样，导出逐帧截图才不会跳）。

export type Pt = [number, number]

export function rng(seed: number) {
  let s = seed >>> 0 || 1
  return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296 }
}
export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))
export const lerp = (a: number, b: number, u: number) => a + (b - a) * u
export const smooth = (u: number) => u * u * (3 - 2 * u)
export const easeIO = (u: number) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2)
/** 手写速度：落笔慢、中段快、收笔慢 */
export const handEase = (u: number) => u - (Math.sin(2 * Math.PI * u) / (2 * Math.PI)) * 0.8

export function lengths(pts: Pt[]) {
  const c = [0]
  for (let i = 1; i < pts.length; i++) c.push(c[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]))
  return c
}

export function catmull(pts: Pt[], sub = 6): Pt[] {
  if (pts.length < 3) return pts
  const out: Pt[] = []
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)]
    for (let k = 0; k < sub; k++) {
      const t = k / sub, t2 = t * t, t3 = t2 * t
      const f = (j: 0 | 1) => 0.5 * (2 * p1[j] + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3)
      out.push([f(0), f(1)])
    }
  }
  out.push(pts[pts.length - 1])
  return out
}

// ——— 基础图形（折线） ———
export const line = (x1: number, y1: number, x2: number, y2: number): Pt[] => [[x1, y1], [x2, y2]]
export function circlePts(cx: number, cy: number, r: number, a0 = -Math.PI / 2, ry = r): Pt[] {
  const n = Math.max(40, Math.round(r / 4))
  return Array.from({ length: n + 1 }, (_, k) => [cx + Math.cos(a0 + (2 * Math.PI * k) / n) * r, cy + Math.sin(a0 + (2 * Math.PI * k) / n) * ry] as Pt)
}
export function rectPts(x: number, y: number, w: number, h: number): Pt[][] {
  return [line(x, y, x + w, y), line(x + w, y, x + w, y + h), line(x + w, y + h, x, y + h), line(x, y + h, x, y)]
}
export function arrowHead(x: number, y: number, ang: number, size: number): Pt[] {
  return [[x + Math.cos(ang + Math.PI - 0.45) * size, y + Math.sin(ang + Math.PI - 0.45) * size], [x, y], [x + Math.cos(ang + Math.PI + 0.45) * size, y + Math.sin(ang + Math.PI + 0.45) * size]]
}
export function dashes(x1: number, y1: number, x2: number, y2: number, dash = 30, gap = 22): Pt[][] {
  const len = Math.hypot(x2 - x1, y2 - y1), ux = (x2 - x1) / len, uy = (y2 - y1) / len, out: Pt[][] = []
  for (let s = 0; s < len - dash * 0.4; s += dash + gap) { const e = Math.min(len, s + dash); out.push(line(x1 + ux * s, y1 + uy * s, x1 + ux * e, y1 + uy * e)) }
  return out
}

// ——— 图标：Lucide 的 SVG 图元用浏览器自己的几何（getPointAtLength）采成折线，按 SVG 里的先后顺序就是书写顺序 ———
let host: SVGSVGElement | null = null
const iconCache = new Map<string, Pt[][]>()
function sampleNode(node: IconNode): Pt[][] {
  if (!host) {
    host = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    host.setAttribute('style', 'position:absolute;width:0;height:0;overflow:hidden')
    document.body.appendChild(host)
  }
  const out: Pt[][] = []
  for (const [tag, attrs] of node) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag) as unknown as SVGGeometryElement
    for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, String(v))
    host.appendChild(el)
    const L = el.getTotalLength()
    const n = Math.max(2, Math.ceil(L / 0.3))
    let cur: Pt[] = []
    let prev: Pt | null = null
    for (let i = 0; i <= n; i++) {
      const p = el.getPointAtLength((L * i) / n), q: Pt = [p.x, p.y]
      // 一条 path 里有好几段（M … M …）时 getPointAtLength 会直接跳过去：跳的地方断开，不然两段之间多出一条线
      if (prev && Math.hypot(q[0] - prev[0], q[1] - prev[1]) > 1) { out.push(cur); cur = [] }
      cur.push(q); prev = q
    }
    out.push(cur)
    host.removeChild(el)
  }
  return out.filter((s) => s.length)
}

// ——— 自定义组件（Lucide 没有、讲解里常用的），坐标在 24 见方里，和 Lucide 一致 ———
function satellite(): Pt[][] {
  const r = (x: number, y: number, w: number, h: number) => rectPts(x, y, w, h)
  return [...r(9.6, 9.4, 4.8, 4.2), line(9.6, 11.5, 7.8, 11.5), ...r(1.5, 9.8, 6.3, 3.4), line(3.6, 9.8, 3.6, 13.2), line(5.7, 9.8, 5.7, 13.2),
    line(14.4, 11.5, 16.2, 11.5), ...r(16.2, 9.8, 6.3, 3.4), line(18.3, 9.8, 18.3, 13.2), line(20.4, 9.8, 20.4, 13.2), line(12, 13.6, 12, 15.4), circlePts(12, 16.2, 0.8)]
}
function gear(N = 14): Pt[][] {
  const P = (2 * Math.PI) / N, rf = 8.2, ra = 10.6, r = 9.4, out: Pt[] = []
  for (let i = 0; i < N; i++) {
    const a = i * P - Math.PI / 2
    for (const [rr, k] of [[rf, -0.3], [r, -0.24], [ra, -0.14], [ra, 0.14], [r, 0.24], [rf, 0.3], [rf, 0.5], [rf, 0.7]] as const) out.push([12 + Math.cos(a + k * P) * rr, 12 + Math.sin(a + k * P) * rr])
  }
  out.push(out[0])
  return [out, circlePts(12, 12, 4.2), circlePts(12, 12, 1.8)]
}
interface PropDef { id: string; tags: string[]; draw: () => Pt[][] }
const PROPS: PropDef[] = [
  { id: 'satellite', tags: ['卫星', '人造卫星', '太空', '信号塔'], draw: satellite },
  { id: 'gear', tags: ['齿轮', '机械', '传动', '机构'], draw: () => gear() },
]

/** AI / 场景里能写的图标名：自定义组件 + Lucide 那批（id 或中文关键词）。服务端以后用同一份表核。 */
export function iconCatalog() {
  return [...PROPS.map((p) => ({ id: p.id, tags: p.tags })), ...ICONS.map((i) => ({ id: i.id, tags: i.tags }))]
}

/** 按名字找图标，返回 24 见方里的折线；找不到返回 null（调用方画一个虚线问号并报出来）。 */
export function iconStrokes(name: string): Pt[][] | null {
  const key = name.trim()
  if (iconCache.has(key)) return iconCache.get(key)!
  const lower = key.toLowerCase()
  const prop = PROPS.find((p) => p.id === lower || p.tags.includes(key))
  let out: Pt[][] | null = null
  if (prop) out = prop.draw()
  else {
    const ic = ICONS.find((i) => i.id.toLowerCase() === lower) || ICONS.find((i) => i.tags.includes(key))
    if (ic) out = sampleNode(ic.node)
  }
  if (out) iconCache.set(key, out)
  return out
}

/** 缺图标时的占位：虚线方框 + 问号 */
export function missingIcon(): Pt[][] {
  return [...dashes(2, 2, 22, 2, 3, 2), ...dashes(22, 2, 22, 22, 3, 2), ...dashes(22, 22, 2, 22, 3, 2), ...dashes(2, 22, 2, 2, 3, 2),
    catmull([[8.5, 9], [9.5, 6.5], [12, 6], [14.5, 7], [14.6, 9.4], [12.2, 11.2], [12, 13.8]]), [[12, 17.2], [12.05, 17.25]]]
}
