import { type Pt, clamp, handEase, lengths, lerp, rng, smooth, circlePts, arrowHead, catmull } from './geometry'
import { type Plan, type PlanStroke, type Tone, HAND_FONT, cameraAt } from './scene'

// 白板讲解的渲染器：一块大白板，马克笔一笔一笔写，没有手，笔悬浮着带投影；墨水正片叠底、干笔斑点、旧字迹、反光随镜头慢移。
// 画面只由 t 决定（预览和导出逐帧截图一致）。

// aside（补充说明）在白板上和 signal 同一支蓝笔
const INK: Record<Tone, string> = { ink: '#23262c', signal: '#2a5cb3', accent: '#d97757', aside: '#2a5cb3' }
const PARK: Record<Tone, Pt> = { ink: [2250, 980], signal: [2250, 120], accent: [-330, 1000], aside: [2250, 120] }
const WIDTH = { out: 10, det: 8, thin: 6.5, hair: 5 }
const W = 1920, H = 1080
const shade = (hex: string, k: number) => { const n = parseInt(hex.slice(1), 16); return `rgb(${[n >> 16, (n >> 8) & 255, n & 255].map((v) => Math.round(v * k))})` }

class Stroke {
  p: Pt[]; cum: number[]; L: number; wd: number[]; w: number; color: string; dark: string; alpha: number; dot: boolean; box: [number, number, number, number]
  constructor(pts: Pt[], o: { w: number; color: string; wob: [number, number, number, number]; alpha?: number; seed: number }) {
    const R = rng(o.seed)
    this.w = o.w; this.color = o.color; this.dark = shade(o.color, 0.8); this.alpha = o.alpha ?? 1
    // 重新采样后沿法线叠加低频手抖 + 细颤
    const base: Pt[] = [pts[0]]
    const step = Math.max(1.2, 0.6 * o.w)
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1], [bx, by] = pts[i], d = Math.hypot(bx - ax, by - ay)
      for (let s = step; s < d; s += step) base.push([ax + ((bx - ax) * s) / d, ay + ((by - ay) * s) / d])
      base.push(pts[i])
    }
    const ph1 = R() * 6.283, ph2 = R() * 6.283
    let s = 0
    this.p = base.map((pt, i) => {
      const a = base[Math.max(0, i - 1)], b = base[Math.min(base.length - 1, i + 1)]
      let nx = -(b[1] - a[1]), ny = b[0] - a[0]; const nl = Math.hypot(nx, ny) || 1; nx /= nl; ny /= nl
      if (i) s += Math.hypot(pt[0] - base[i - 1][0], pt[1] - base[i - 1][1])
      const off = o.wob[0] * Math.sin((2 * Math.PI * s) / o.wob[1] + ph1) + o.wob[2] * Math.sin((2 * Math.PI * s) / o.wob[3] + ph2)
      return [pt[0] + nx * off, pt[1] + ny * off] as Pt
    })
    this.cum = lengths(this.p); this.L = this.cum[this.cum.length - 1]; this.dot = this.L < o.w * 1.2
    // 斜切笔头随方向变粗细，起笔压力渐强，收笔变细
    this.wd = this.p.map((_, i) => {
      const q = this.p[Math.min(this.p.length - 1, i + 1)], r = this.p[Math.max(0, i - 1)]
      const ang = Math.atan2(q[1] - r[1], q[0] - r[0]), u = this.L ? this.cum[i] / this.L : 0
      return o.w * (0.8 + 0.2 * Math.abs(Math.sin(ang - Math.PI / 4))) * (u < 0.1 ? 0.72 + (0.28 * u) / 0.1 : 1) * (u > 0.88 ? 1 - ((u - 0.88) / 0.12) * 0.4 : 1)
    })
    const xs = this.p.map((v) => v[0]), ys = this.p.map((v) => v[1])
    this.box = [Math.min(...xs) - o.w, Math.min(...ys) - o.w, Math.max(...xs) + o.w, Math.max(...ys) + o.w]
  }
  at(len: number): Pt {
    len = clamp(len, 0, this.L); let i = 1
    while (i < this.cum.length - 1 && this.cum[i] < len) i++
    const a = this.p[i - 1], b = this.p[i] || a, d = this.cum[i] - this.cum[i - 1] || 1, u = (len - this.cum[i - 1]) / d
    return [lerp(a[0], b[0], u), lerp(a[1], b[1], u)]
  }
  draw(ctx: OffscreenCanvasRenderingContext2D, len: number) {
    if (len <= 0) return
    ctx.globalAlpha = this.alpha
    if (this.dot) { ctx.fillStyle = this.color; ctx.beginPath(); ctx.arc(this.p[0][0], this.p[0][1], this.w * 0.62, 0, 7); ctx.fill(); ctx.globalAlpha = 1; return }
    ctx.strokeStyle = this.color; ctx.lineCap = 'round'; ctx.lineJoin = 'round'
    let i = 0
    while (i < this.p.length - 1 && this.cum[i] < len) {
      const w = Math.round(this.wd[i] * 2) / 2
      ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(this.p[i][0], this.p[i][1])
      while (i < this.p.length - 1 && this.cum[i] < len && Math.round(this.wd[i] * 2) / 2 === w) {
        if (this.cum[i + 1] <= len) ctx.lineTo(this.p[i + 1][0], this.p[i + 1][1])
        else { const e = this.at(len); ctx.lineTo(e[0], e[1]) }
        i++
      }
      ctx.stroke()
    }
    // 墨水在起笔处积一点，点在笔画里面（大了会在每个字周围留一圈灰晕）
    if (this.L > this.w * 4) { const k = this.at(this.w * 0.7); ctx.fillStyle = this.dark; ctx.beginPath(); ctx.arc(k[0], k[1], this.w * 0.36, 0, 7); ctx.fill() }
    ctx.globalAlpha = 1
  }
}

interface Move { t0: number; t1: number; start: Pt; end: Pt; at: (u: number) => Pt }

export function createWhiteboard(canvas: HTMLCanvasElement, plan: Plan) {
  const ctx = canvas.getContext('2d')!
  const ink = new OffscreenCanvas(W, H), ic = ink.getContext('2d')!
  const strokes = plan.strokes.map((s: PlanStroke, i) => {
    const w = s.letterH ? s.letterH * 0.085 : WIDTH[s.weight]
    const wob: [number, number, number, number] = s.letterH ? [s.letterH * 0.009, s.letterH * 1.3, s.letterH * 0.003, s.letterH * 0.22] : [2.6, 220, 0.7, 37]
    return { src: s, st: new Stroke(s.pts, { w, color: INK[s.tone], wob, seed: 1000 + i }) }
  })
  // 每支笔要走的路：笔画（按手写速度）+ 字体文字（沿基线匀速）
  const moves: Record<Tone, Move[]> = { ink: [], signal: [], accent: [], aside: [] }
  for (const { src, st } of strokes) moves[src.tone].push({ t0: src.t0, t1: src.t1, start: st.p[0], end: st.p[st.p.length - 1], at: (u) => st.at(st.L * handEase(u)) })
  for (const x of plan.texts) {
    const w = measure(x.text, x.size), y = x.y - x.size * 0.35
    moves[x.tone].push({ t0: x.t0, t1: x.t1, start: [x.x, y], end: [x.x + w, y], at: (u) => [x.x + w * u, y + Math.sin(u * 40) * x.size * 0.18] })
  }
  for (const k of Object.keys(moves) as Tone[]) moves[k].sort((a, b) => a.t0 - b.t0)

  // 旧字迹（擦不干净的旧课）、干笔纹理、划痕
  const R = rng(20261029), ghosts: Stroke[] = []
  for (let i = 0; i < Math.round((plan.width * plan.height) / 360000); i++) {
    const x = 200 + R() * (plan.width - 400), y = 200 + R() * (plan.height - 400), color = i % 2 ? '#8aa0c8' : '#9aa0a8', alpha = 0.03 + R() * 0.035, k = R()
    const pts: Pt[][] = k < 0.55 ? [circlePts(x, y, 50 + R() * 140, R() * 6.28)] : (() => { const a = R() * 6.28, l = 150 + R() * 250, ex = x + Math.cos(a) * l, ey = y + Math.sin(a) * l; return [[[x, y], [ex, ey]] as Pt[], arrowHead(ex, ey, a, 40)] })()
    for (const p of pts) ghosts.push(new Stroke(k < 0.55 ? p : catmull(p, 2), { w: 8, color, wob: [2.6, 220, 0.7, 37], alpha, seed: 9000 + i }))
  }
  const T = rng(99), tile = new OffscreenCanvas(512, 512), tc = tile.getContext('2d')!
  for (let i = 0; i < 2600; i++) { tc.fillStyle = `rgba(0,0,0,${0.25 + T() * 0.6})`; tc.beginPath(); tc.arc(T() * 512, T() * 512, 0.4 + T() * 1.3, 0, 7); tc.fill() }
  for (let i = 0; i < 180; i++) { const x = T() * 512, y = T() * 512, a = -0.5 + T() * 0.3, l = 6 + T() * 22; tc.strokeStyle = `rgba(0,0,0,${0.3 + T() * 0.5})`; tc.lineWidth = 0.6 + T(); tc.beginPath(); tc.moveTo(x, y); tc.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); tc.stroke() }
  const dry = ic.createPattern(tile, 'repeat')!
  const sc = new OffscreenCanvas(512, 512), sx = sc.getContext('2d')!, U = rng(5)
  for (let i = 0; i < 140; i++) { const x = U() * 512, y = U() * 512, a = U() * 6.28, l = 10 + U() * 60; sx.strokeStyle = `rgba(120,120,115,${0.04 + U() * 0.06})`; sx.lineWidth = 0.6; sx.beginPath(); sx.moveTo(x, y); sx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); sx.stroke() }
  const scuff = ctx.createPattern(sc, 'repeat')!

  function penPose(tone: Tone, t: number, toS: (p: Pt) => Pt) {
    const M = moves[tone]; if (!M.length) return null
    const park = { x: PARK[tone][0], y: PARK[tone][1], lift: 0.6, drawing: false }
    const S = (p: Pt) => { const q = toS(p); return { x: q[0], y: q[1] } }
    const fly = (a: { x: number; y: number }, b: { x: number; y: number }, u: number, la: number, lb: number) => { const e = smooth(clamp(u, 0, 1)); return { x: lerp(a.x, b.x, e), y: lerp(a.y, b.y, e), lift: lerp(la, lb, e) + Math.sin(Math.PI * e) * 0.15, drawing: false } }
    let prev: Move | null = null, next: Move | null = null
    for (const m of M) {
      if (t >= m.t0 && t <= m.t1) { const q = S(m.at((t - m.t0) / (m.t1 - m.t0 || 1))); return { ...q, lift: 0, drawing: true } }
      if (m.t1 < t) prev = m; else if (!next && m.t0 > t) next = m
    }
    if (!prev) { const leave = next!.t0 - 0.42; return t < leave ? park : fly(park, S(next!.start), (t - leave) / 0.42, 0.6, 0) }
    if (!next) return t - prev.t1 > 0.45 ? park : fly(S(prev.end), park, (t - prev.t1) / 0.45, 0, 0.6)
    const gap = next.t0 - prev.t1
    if (gap > 0.75) {
      if (t < prev.t1 + 0.35) return fly(S(prev.end), park, (t - prev.t1) / 0.35, 0, 0.6)
      if (t > next.t0 - 0.42) return fly(park, S(next.start), (t - next.t0 + 0.42) / 0.42, 0.6, 0)
      return park
    }
    const a = S(prev.end), b = S(next.start), u = (t - prev.t1) / gap, e = smooth(u)
    return { x: lerp(a.x, b.x, e), y: lerp(a.y, b.y, e), lift: Math.min(0.35, Math.hypot(b.x - a.x, b.y - a.y) / 1400 + 0.06) * Math.sin(Math.PI * u), drawing: false }
  }
  function drawMarker(color: string, pose: { x: number; y: number; lift: number; drawing: boolean } | null, z: number) {
    if (!pose) return
    const s = clamp(z, 0.45, 1.35) * (1 + pose.lift * 0.12), ang = -0.95 + (pose.drawing ? 0 : pose.lift * 0.2)
    const body = () => { ctx.beginPath(); ctx.moveTo(0, -3 * s); ctx.lineTo(24 * s, -9 * s); ctx.lineTo(24 * s, 9 * s); ctx.lineTo(0, 3 * s); ctx.closePath(); ctx.rect(24 * s, -15 * s, 18 * s, 30 * s); ctx.roundRect(40 * s, -20 * s, 190 * s, 40 * s, 8 * s); ctx.roundRect(212 * s, -23 * s, 76 * s, 46 * s, 10 * s) }
    ctx.save(); ctx.translate(pose.x + (14 + pose.lift * 70) * s, pose.y + (18 + pose.lift * 90) * s); ctx.rotate(ang)
    ctx.filter = `blur(${(3 + pose.lift * 10) * s}px)`; ctx.fillStyle = `rgba(30,30,40,${0.2 - pose.lift * 0.08})`; body(); ctx.fill(); ctx.restore()
    ctx.save(); ctx.translate(pose.x, pose.y); ctx.rotate(ang)
    ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(0, -3 * s); ctx.lineTo(24 * s, -9 * s); ctx.lineTo(24 * s, 9 * s); ctx.lineTo(0, 3 * s); ctx.closePath(); ctx.fill()
    ctx.fillStyle = '#c9cdd2'; ctx.fillRect(24 * s, -15 * s, 18 * s, 30 * s)
    const g = ctx.createLinearGradient(0, -20 * s, 0, 20 * s); g.addColorStop(0, '#ffffff'); g.addColorStop(0.55, '#f1f1ee'); g.addColorStop(1, '#cfd0cc')
    ctx.fillStyle = g; ctx.beginPath(); ctx.roundRect(40 * s, -20 * s, 190 * s, 40 * s, 8 * s); ctx.fill(); ctx.strokeStyle = 'rgba(0,0,0,0.14)'; ctx.lineWidth = 1.2; ctx.stroke()
    ctx.fillStyle = color; ctx.fillRect(150 * s, -20 * s, 22 * s, 40 * s)
    const c = ctx.createLinearGradient(0, -23 * s, 0, 23 * s); c.addColorStop(0, shade(color, 1.25)); c.addColorStop(0.5, color); c.addColorStop(1, shade(color, 0.7))
    ctx.fillStyle = c; ctx.beginPath(); ctx.roundRect(212 * s, -23 * s, 76 * s, 46 * s, 10 * s); ctx.fill()
    ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillRect(222 * s, -17 * s, 56 * s, 6 * s)
    ctx.restore()
  }

  function render(t: number) {
    const c = cameraAt(plan.camera, t), z = c.z, m: [number, number, number, number, number, number] = [z, 0, 0, z, W / 2 - c.x * z, H / 2 - c.y * z]
    const toS = (p: Pt): Pt => [p[0] * z + m[4], p[1] * z + m[5]]
    const view = [-m[4] / z, -m[5] / z, (W - m[4]) / z, (H - m[5]) / z]
    const visible = (b: number[]) => !(b[2] < view[0] || b[0] > view[2] || b[3] < view[1] || b[1] > view[3])
    const BW = plan.width, BH = plan.height
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.filter = 'none'; ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'
    const wall = ctx.createLinearGradient(0, 0, 0, H); wall.addColorStop(0, '#ddd8cf'); wall.addColorStop(1, '#cdc7bc'); ctx.fillStyle = wall; ctx.fillRect(0, 0, W, H)
    ctx.setTransform(...m)
    // 拉远到白板外时才看得见铝框和笔槽
    if (view[0] < 0 || view[1] < 0 || view[2] > BW || view[3] > BH) {
      ctx.fillStyle = 'rgba(60,50,40,0.25)'; ctx.filter = 'blur(18px)'; ctx.fillRect(-30, 0, BW + 90, BH + 160); ctx.filter = 'none'
      const f = ctx.createLinearGradient(0, -50, 0, BH + 50); f.addColorStop(0, '#e3e5e8'); f.addColorStop(0.5, '#a9aeb4'); f.addColorStop(1, '#d4d7db')
      ctx.fillStyle = f; ctx.beginPath(); ctx.roundRect(-46, -46, BW + 92, BH + 92, 18); ctx.fill()
      const tg = ctx.createLinearGradient(0, BH + 40, 0, BH + 120); tg.addColorStop(0, '#c5c9ce'); tg.addColorStop(1, '#8e949b')
      ctx.fillStyle = tg; ctx.beginPath(); ctx.roundRect(BW * 0.15, BH + 30, BW * 0.7, 80, 12); ctx.fill()
    }
    const bg = ctx.createLinearGradient(0, 0, BW, BH); bg.addColorStop(0, '#fbfbf9'); bg.addColorStop(1, '#eeede9'); ctx.fillStyle = bg; ctx.fillRect(0, 0, BW, BH)
    ctx.fillStyle = scuff; ctx.fillRect(Math.max(0, view[0]), Math.max(0, view[1]), Math.min(BW, view[2]) - Math.max(0, view[0]), Math.min(BH, view[3]) - Math.max(0, view[1]))
    for (const g of ghosts) if (visible(g.box)) g.draw(ctx as unknown as OffscreenCanvasRenderingContext2D, g.L)
    // 墨水层：写到 t 为止的所有笔画 + 字体文字，扣掉干笔纹理，再正片叠底到白板上
    ic.setTransform(1, 0, 0, 1, 0, 0); ic.clearRect(0, 0, W, H); ic.setTransform(...m)
    for (const { src, st } of strokes) if (t > src.t0 && visible(st.box)) st.draw(ic, t >= src.t1 ? st.L : st.L * handEase((t - src.t0) / (src.t1 - src.t0)))
    for (const x of plan.texts) {
      if (t <= x.t0) continue
      const u = clamp((t - x.t0) / (x.t1 - x.t0), 0, 1), w = measure(x.text, x.size)
      ic.save(); if (u < 1) { ic.beginPath(); ic.rect(x.x - 4, x.y - x.size * 1.2, (w + 8) * u, x.size * 1.6); ic.clip() }
      ic.font = `${x.size}px ${HAND_FONT}`; ic.fillStyle = INK[x.tone]; ic.fillText(x.text, x.x, x.y); ic.restore()
    }
    const dryAmt = 0.5 * clamp((z - 0.35) / 0.5, 0, 1)
    if (dryAmt > 0) { ic.globalCompositeOperation = 'destination-out'; ic.globalAlpha = dryAmt; ic.fillStyle = dry; ic.fillRect(view[0], view[1], view[2] - view[0], view[3] - view[1]); ic.globalAlpha = 1; ic.globalCompositeOperation = 'source-over' }
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalCompositeOperation = 'multiply'; ctx.globalAlpha = 0.94; ctx.drawImage(ink, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'
    // 窗户反光：以镜头 0.35 倍的速度移动，「亮面白板」全靠这一下
    ctx.save(); ctx.beginPath(); ctx.rect(m[4], m[5], BW * z, BH * z); ctx.clip()
    const shift = (((-c.x * z * 0.35) % 3200) + 3200) % 3200 - 600
    for (const [off, wd, a] of [[0, 520, 0.13], [380, 140, 0.09]]) {
      const cx = shift + off, sh = ctx.createLinearGradient(cx - wd, 0, cx + wd, 0)
      sh.addColorStop(0, 'rgba(255,255,255,0)'); sh.addColorStop(0.5, `rgba(255,255,255,${a})`); sh.addColorStop(1, 'rgba(255,255,255,0)')
      ctx.save(); ctx.translate(960, 540); ctx.transform(1, 0, -0.55, 1, 0, 0); ctx.translate(-960, -540); ctx.fillStyle = sh; ctx.fillRect(cx - wd - 1200, -200, wd * 2 + 2400, 1480); ctx.restore()
    }
    ctx.restore()
    for (const tone of ['ink', 'signal', 'accent'] as Tone[]) drawMarker(INK[tone], penPose(tone, t, toS), z)
    const v = ctx.createRadialGradient(960, 540, 500, 960, 540, 1150); v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(40,30,20,0.12)'); ctx.fillStyle = v; ctx.fillRect(0, 0, W, H)
  }
  return { render, dispose() {} }
}

let mctx: CanvasRenderingContext2D | null = null
function measure(text: string, size: number) { mctx ??= document.createElement('canvas').getContext('2d')!; mctx.font = `${size}px ${HAND_FONT}`; return mctx.measureText(text).width }
