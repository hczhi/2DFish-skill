import { type Pt, clamp, handEase, lengths, lerp, rng } from './geometry'
import { type Plan, type PlanStroke, type Tone, HAND_FONT, cameraAt } from './scene'

// 白纸手绘的渲染器：纯白纸、细黑线带一点手抖，红 / 橙 / 蓝三色批注（红 = 重点和问题、橙 = 流向、蓝 = 补充说明）。
// 没有笔、没有纸纹 / 阴影 / 渐变（这个风格的要求就是干净），一镜一张图，镜头只在镜与镜之间硬切、结尾拉远看全部。
// 画面只由 t 决定（预览和导出逐帧截图一致），手抖用固定种子。

const INK: Record<Tone, string> = { ink: '#151515', accent: '#e0473c', signal: '#ee7a2a', aside: '#2f6fdf' }
const WIDTH = { out: 4.4, det: 3.8, thin: 3.2, hair: 2.6 }
const W = 1920, H = 1080

class Line {
  p: Pt[]; cum: number[]; L: number; w: number; color: string; box: [number, number, number, number]
  constructor(pts: Pt[], w: number, color: string, wob: [number, number, number, number], seed: number) {
    const R = rng(seed)
    this.w = w; this.color = color
    const base: Pt[] = [pts[0]]
    const step = 3
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1], [bx, by] = pts[i], d = Math.hypot(bx - ax, by - ay)
      for (let s = step; s < d; s += step) base.push([ax + ((bx - ax) * s) / d, ay + ((by - ay) * s) / d])
      base.push(pts[i])
    }
    // 沿法线叠一层低频的「手没那么稳」+ 一层很细的颤
    const ph1 = R() * 6.283, ph2 = R() * 6.283
    let s = 0
    this.p = base.map((pt, i) => {
      const a = base[Math.max(0, i - 1)], b = base[Math.min(base.length - 1, i + 1)]
      let nx = -(b[1] - a[1]), ny = b[0] - a[0]; const nl = Math.hypot(nx, ny) || 1; nx /= nl; ny /= nl
      if (i) s += Math.hypot(pt[0] - base[i - 1][0], pt[1] - base[i - 1][1])
      const off = wob[0] * Math.sin((2 * Math.PI * s) / wob[1] + ph1) + wob[2] * Math.sin((2 * Math.PI * s) / wob[3] + ph2)
      return [pt[0] + nx * off, pt[1] + ny * off] as Pt
    })
    this.cum = lengths(this.p); this.L = this.cum[this.cum.length - 1]
    const xs = this.p.map((v) => v[0]), ys = this.p.map((v) => v[1])
    this.box = [Math.min(...xs) - w, Math.min(...ys) - w, Math.max(...xs) + w, Math.max(...ys) + w]
  }
  draw(ctx: CanvasRenderingContext2D, len: number) {
    if (len <= 0) return
    ctx.strokeStyle = this.color; ctx.fillStyle = this.color; ctx.lineCap = 'round'; ctx.lineJoin = 'round'
    if (this.L < this.w * 1.5) { ctx.beginPath(); ctx.arc(this.p[0][0], this.p[0][1], this.w * 0.6, 0, 7); ctx.fill(); return }
    ctx.lineWidth = this.w
    ctx.beginPath(); ctx.moveTo(this.p[0][0], this.p[0][1])
    for (let i = 1; i < this.p.length; i++) {
      if (this.cum[i] <= len) { ctx.lineTo(this.p[i][0], this.p[i][1]); continue }
      const a = this.p[i - 1], b = this.p[i], u = (len - this.cum[i - 1]) / (this.cum[i] - this.cum[i - 1] || 1)
      ctx.lineTo(lerp(a[0], b[0], u), lerp(a[1], b[1], u)); break
    }
    ctx.stroke()
  }
}

export function createSketch(canvas: HTMLCanvasElement, plan: Plan) {
  const ctx = canvas.getContext('2d')!
  const lines = plan.strokes.map((s: PlanStroke, i) => {
    let w = s.letterH ? Math.max(2.4, s.letterH * 0.07) : WIDTH[s.weight]
    // 图示里的实心点是一条螺旋（白板靠马克笔够粗把它涂满）：细线画出来是一盘蚊香 —— 认出「小范围里绕了很多圈」的笔画，按涂满的粗细画
    if (!s.letterH) {
      const xs = s.pts.map((p) => p[0]), bw = Math.max(...xs) - Math.min(...xs), L = lengths(s.pts).at(-1) || 0
      if (bw > 0 && bw < 140 && L > 2.2 * Math.PI * bw) w = 10
    }
    const wob: [number, number, number, number] = s.letterH ? [s.letterH * 0.006, s.letterH * 1.1, s.letterH * 0.002, s.letterH * 0.2] : [1.7, 170, 0.55, 23]
    return { src: s, ln: new Line(s.pts, w, INK[s.tone], wob, 3000 + i) }
  })

  function render(t: number) {
    const c = cameraAt(plan.camera, t), z = c.z, m: [number, number, number, number, number, number] = [z, 0, 0, z, W / 2 - c.x * z, H / 2 - c.y * z]
    const view = [-m[4] / z, -m[5] / z, (W - m[4]) / z, (H - m[5]) / z]
    const visible = (b: number[]) => !(b[2] < view[0] || b[0] > view[2] || b[3] < view[1] || b[1] > view[3])
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H)
    ctx.setTransform(...m)
    // 拉远看全部时才看得出一张张纸：每张一圈很淡的细边（一镜里镜头正好框住一张，看不见它）
    if (z < 0.9) {
      ctx.strokeStyle = `rgba(0,0,0,${0.16 * clamp((0.9 - z) / 0.4, 0, 1)})`; ctx.lineWidth = 2 / z
      for (const r of plan.regions) ctx.strokeRect(r.x, r.y, r.w, r.h)
    }
    for (const { src, ln } of lines) if (t > src.t0 && visible(ln.box)) ln.draw(ctx, t >= src.t1 ? ln.L : ln.L * handEase((t - src.t0) / (src.t1 - src.t0)))
    for (const x of plan.texts) {
      if (t <= x.t0) continue
      const u = clamp((t - x.t0) / (x.t1 - x.t0), 0, 1), w = measure(x.text, x.size)
      ctx.save(); if (u < 1) { ctx.beginPath(); ctx.rect(x.x - 4, x.y - x.size * 1.2, (w + 8) * u, x.size * 1.6); ctx.clip() }
      ctx.font = `${x.size}px ${HAND_FONT}`; ctx.fillStyle = INK[x.tone]; ctx.fillText(x.text, x.x, x.y); ctx.restore()
    }
  }
  return { render, dispose() {} }
}

let mctx: CanvasRenderingContext2D | null = null
function measure(text: string, size: number) { mctx ??= document.createElement('canvas').getContext('2d')!; mctx.font = `${size}px ${HAND_FONT}`; return mctx.measureText(text).width }
