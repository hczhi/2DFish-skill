function noise(t: number, seed: number): number {
  return Math.sin(t * 1.1 + seed) * 0.4
    + Math.sin(t * 2.3 + seed * 1.7) * 0.35
    + Math.sin(t * 4.1 + seed * 3.3) * 0.25
}

interface FgBubble {
  x: number
  y: number
  r: number
  speed: number
  opacity: number
}

interface FloatingDebris {
  x: number
  y: number
  size: number
  rotation: number
  rotSpeed: number
  speedX: number
  speedY: number
  opacity: number
  seed: number
  type: 'fiber' | 'dot' | 'flake'
}

interface WaterSurfaceRipple {
  phase: number
  amplitude: number
  frequency: number
  speed: number
}

export class ForegroundEffects {
  private w: number
  private h: number
  private startTime: number

  private fgBubbles: FgBubble[] = []
  private nextBubbleTime = 0
  private debris: FloatingDebris[] = []
  private ripples: WaterSurfaceRipple[] = []
  private vignetteGrad: CanvasGradient | null = null

  constructor(w: number, h: number) {
    this.w = w
    this.h = h
    this.startTime = performance.now() * 0.001

    this.initDebris()
    this.initRipples()
  }

  resize(w: number, h: number) {
    this.w = w
    this.h = h
    this.vignetteGrad = null
  }

  private initDebris() {
    for (let i = 0; i < 10; i++) {
      this.debris.push({
        x: Math.random() * this.w,
        y: Math.random() * this.h,
        size: 2 + Math.random() * 4,
        rotation: Math.random() * Math.PI * 2,
        rotSpeed: (Math.random() - 0.5) * 0.15,
        speedX: (Math.random() - 0.5) * 3,
        speedY: -(1 + Math.random() * 2.5),
        opacity: 0.04 + Math.random() * 0.08,
        seed: Math.random() * 1000,
        type: ['fiber', 'dot', 'flake'][Math.floor(Math.random() * 3)] as FloatingDebris['type'],
      })
    }
  }

  private initRipples() {
    for (let i = 0; i < 3; i++) {
      this.ripples.push({
        phase: Math.random() * Math.PI * 2,
        amplitude: 2 + Math.random() * 3,
        frequency: 0.005 + Math.random() * 0.008,
        speed: 0.3 + Math.random() * 0.5,
      })
    }
  }

  update(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const t = performance.now() * 0.001 - this.startTime
    const dt = 1 / 60

    this.updateAndDrawDebris(ctx, w, h, t, dt)
    this.updateAndDrawFgBubbles(ctx, w, h, t, dt)
    this.drawWaterSurface(ctx, w, t)
    this.drawGodRays(ctx, w, h, t)
    this.drawVignette(ctx, w, h)
    this.drawLensFlare(ctx, w, h, t)
  }

  private updateAndDrawFgBubbles(ctx: CanvasRenderingContext2D, w: number, h: number, t: number, dt: number) {
    this.nextBubbleTime -= dt
    if (this.nextBubbleTime <= 0 && this.fgBubbles.length < 5) {
      this.fgBubbles.push({
        x: Math.random() * w,
        y: h + 30,
        r: 6 + Math.random() * 16,
        speed: 18 + Math.random() * 25,
        opacity: 0.05 + Math.random() * 0.07,
      })
      this.nextBubbleTime = 4 + Math.random() * 10
    }

    this.fgBubbles = this.fgBubbles.filter(b => {
      b.y -= b.speed * dt
      b.x += Math.sin(t * 0.5 + b.r) * 0.4

      if (b.y < -b.r * 2) return false

      ctx.save()
      ctx.globalAlpha = b.opacity

      // Bubble ring
      ctx.beginPath()
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2)
      ctx.strokeStyle = 'rgba(180, 220, 255, 0.5)'
      ctx.lineWidth = 1.5
      ctx.stroke()

      // Highlight
      ctx.beginPath()
      ctx.arc(b.x - b.r * 0.25, b.y - b.r * 0.3, b.r * 0.35, 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(255, 255, 255, 0.3)'
      ctx.fill()

      ctx.restore()
      return true
    })
  }

  private updateAndDrawDebris(ctx: CanvasRenderingContext2D, w: number, h: number, t: number, dt: number) {
    this.debris.forEach(d => {
      d.x += d.speedX * dt + noise(t * 0.3, d.seed) * 0.4
      d.y += d.speedY * dt
      d.rotation += d.rotSpeed * dt

      if (d.y < -20) { d.y = h + 20; d.x = Math.random() * w }
      if (d.x < -20) d.x = w + 20
      if (d.x > w + 20) d.x = -20

      ctx.save()
      ctx.translate(d.x, d.y)
      ctx.rotate(d.rotation)
      ctx.globalAlpha = d.opacity

      switch (d.type) {
        case 'fiber':
          ctx.beginPath()
          ctx.moveTo(-d.size, 0)
          ctx.quadraticCurveTo(0, d.size * 0.3, d.size, 0)
          ctx.strokeStyle = 'rgba(200, 220, 200, 0.7)'
          ctx.lineWidth = 0.7
          ctx.stroke()
          break
        case 'dot':
          ctx.beginPath()
          ctx.arc(0, 0, d.size * 0.35, 0, Math.PI * 2)
          ctx.fillStyle = 'rgba(220, 240, 220, 0.6)'
          ctx.fill()
          break
        case 'flake':
          ctx.beginPath()
          ctx.ellipse(0, 0, d.size, d.size * 0.3, 0, 0, Math.PI * 2)
          ctx.fillStyle = 'rgba(200, 230, 210, 0.5)'
          ctx.fill()
          break
      }

      ctx.restore()
    })
  }

  private drawWaterSurface(ctx: CanvasRenderingContext2D, w: number, t: number) {
    const surfaceH = 35

    ctx.save()

    const grad = ctx.createLinearGradient(0, 0, 0, surfaceH)
    grad.addColorStop(0, 'rgba(160, 210, 255, 0.1)')
    grad.addColorStop(0.4, 'rgba(160, 210, 255, 0.03)')
    grad.addColorStop(1, 'rgba(160, 210, 255, 0)')

    ctx.fillStyle = grad
    ctx.beginPath()
    ctx.moveTo(0, 0)

    for (let x = 0; x <= w; x += 6) {
      let y = 0
      this.ripples.forEach(r => {
        y += Math.sin(x * r.frequency + t * r.speed + r.phase) * r.amplitude
      })
      ctx.lineTo(x, y + surfaceH * 0.5)
    }
    ctx.lineTo(w, 0)
    ctx.closePath()
    ctx.fill()

    // Surface line shimmer
    ctx.beginPath()
    ctx.moveTo(0, 3)
    for (let x = 0; x <= w; x += 4) {
      let y = 3
      this.ripples.forEach(r => {
        y += Math.sin(x * r.frequency + t * r.speed + r.phase) * r.amplitude * 0.25
      })
      ctx.lineTo(x, y)
    }
    ctx.strokeStyle = 'rgba(220, 240, 255, 0.06)'
    ctx.lineWidth = 1.5
    ctx.stroke()

    ctx.restore()
  }

  private drawGodRays(ctx: CanvasRenderingContext2D, w: number, h: number, t: number) {
    ctx.save()
    ctx.globalCompositeOperation = 'screen'
    ctx.globalAlpha = 0.025

    // Animated volumetric light shafts
    for (let i = 0; i < 3; i++) {
      const phase = t * 0.15 + i * 2.1
      const cx = w * (0.2 + i * 0.3) + Math.sin(phase) * 80
      const spread = 50 + Math.sin(t * 0.2 + i) * 20

      const grad = ctx.createLinearGradient(cx, 0, cx + spread, h * 0.7)
      grad.addColorStop(0, 'rgba(255, 250, 200, 0.8)')
      grad.addColorStop(0.5, 'rgba(200, 230, 255, 0.3)')
      grad.addColorStop(1, 'rgba(200, 230, 255, 0)')

      ctx.beginPath()
      ctx.moveTo(cx - 30, 0)
      ctx.lineTo(cx + 30, 0)
      ctx.lineTo(cx + spread + 60, h * 0.7)
      ctx.lineTo(cx + spread - 20, h * 0.7)
      ctx.closePath()
      ctx.fillStyle = grad
      ctx.fill()
    }

    ctx.restore()
  }

  private drawVignette(ctx: CanvasRenderingContext2D, w: number, h: number) {
    if (!this.vignetteGrad || this.w !== w || this.h !== h) {
      const cx = w / 2
      const cy = h / 2
      const radius = Math.max(w, h) * 0.7
      this.vignetteGrad = ctx.createRadialGradient(cx, cy, radius * 0.4, cx, cy, radius)
      this.vignetteGrad.addColorStop(0, 'rgba(0, 0, 0, 0)')
      this.vignetteGrad.addColorStop(0.6, 'rgba(0, 8, 16, 0)')
      this.vignetteGrad.addColorStop(1, 'rgba(0, 8, 16, 0.35)')
    }

    ctx.fillStyle = this.vignetteGrad
    ctx.fillRect(0, 0, w, h)
  }

  private drawLensFlare(ctx: CanvasRenderingContext2D, w: number, h: number, t: number) {
    // Subtle bokeh circles that drift very slowly
    const bokehCount = 5
    for (let i = 0; i < bokehCount; i++) {
      const seed = i * 137.5
      const angle = t * 0.03 + seed
      const dist = Math.max(w, h) * 0.35 + Math.sin(t * 0.08 + i) * 60

      const bx = w / 2 + Math.cos(angle) * dist
      const by = h / 2 + Math.sin(angle) * dist
      const br = 25 + Math.sin(t * 0.2 + i * 2) * 12
      const bOpacity = 0.012 + Math.sin(t * 0.15 + i) * 0.005

      if (bOpacity < 0.005) continue

      ctx.save()
      ctx.globalAlpha = bOpacity
      ctx.beginPath()
      ctx.arc(bx, by, br, 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(170, 210, 255, 0.4)'
      ctx.fill()
      ctx.restore()
    }
  }
}
