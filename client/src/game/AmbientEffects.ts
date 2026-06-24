function noise(t: number, seed: number): number {
  return Math.sin(t * 1.1 + seed) * 0.4
    + Math.sin(t * 2.3 + seed * 1.7) * 0.35
    + Math.sin(t * 4.1 + seed * 3.3) * 0.25
}

interface Particle {
  x: number
  y: number
  size: number
  speedY: number
  speedX: number
  opacity: number
  seed: number
}

interface LightRay {
  x: number
  width: number
  opacity: number
  speed: number
  seed: number
}

interface SandGrain {
  x: number
  y: number
  size: number
  lightness: number
}

export class AmbientEffects {
  private w: number
  private h: number
  private startTime: number

  private particles: Particle[] = []
  private lightRays: LightRay[] = []
  private sandGrains: SandGrain[] = []
  private causticPhase = 0

  constructor(w: number, h: number) {
    this.w = w
    this.h = h
    this.startTime = performance.now() * 0.001

    this.initParticles()
    this.initLightRays()
    this.initSand()
  }

  resize(w: number, h: number) {
    this.w = w
    this.h = h
    this.sandGrains = []
    this.initSand()
  }

  private initParticles() {
    for (let i = 0; i < 40; i++) {
      this.particles.push({
        x: Math.random() * this.w,
        y: Math.random() * this.h,
        size: 0.5 + Math.random() * 1.5,
        speedY: -(2 + Math.random() * 5),
        speedX: (Math.random() - 0.5) * 1.5,
        opacity: 0.08 + Math.random() * 0.2,
        seed: Math.random() * 1000,
      })
    }
  }

  private initLightRays() {
    for (let i = 0; i < 4; i++) {
      this.lightRays.push({
        x: Math.random() * this.w,
        width: 80 + Math.random() * 150,
        opacity: 0.015 + Math.random() * 0.025,
        speed: 2 + Math.random() * 4,
        seed: Math.random() * 100,
      })
    }
  }

  private initSand() {
    const sandY = this.h - 50
    for (let i = 0; i < 60; i++) {
      this.sandGrains.push({
        x: Math.random() * this.w,
        y: sandY + Math.random() * 50,
        size: 1 + Math.random() * 2.5,
        lightness: 25 + Math.random() * 15,
      })
    }
  }

  update(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const t = performance.now() * 0.001 - this.startTime
    const dt = 1 / 60
    this.causticPhase = t

    this.drawBackground(ctx, w, h)
    this.drawCaustics(ctx, w, h, t)
    this.drawLightRays(ctx, w, h, t)
    this.drawSandFloor(ctx, w, h, t)
    this.updateAndDrawParticles(ctx, w, h, t, dt)
  }

  private drawBackground(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const grad = ctx.createLinearGradient(0, 0, 0, h)
    grad.addColorStop(0, 'rgb(20, 72, 108)')
    grad.addColorStop(0.2, 'rgb(24, 90, 125)')
    grad.addColorStop(0.5, 'rgb(18, 65, 95)')
    grad.addColorStop(0.8, 'rgb(14, 50, 74)')
    grad.addColorStop(1, 'rgb(12, 38, 58)')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, w, h)
  }

  private drawCaustics(ctx: CanvasRenderingContext2D, w: number, h: number, t: number) {
    ctx.save()
    ctx.globalCompositeOperation = 'screen'
    ctx.globalAlpha = 0.04

    const cellSize = 60
    const cols = Math.ceil(w / cellSize) + 1
    const rows = Math.ceil(h / cellSize) + 1

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const baseX = col * cellSize
        const baseY = row * cellSize

        const offsetX = Math.sin(t * 0.5 + col * 0.8 + row * 0.3) * 12
        const offsetY = Math.cos(t * 0.4 + row * 0.9 + col * 0.5) * 10
        const cx = baseX + offsetX
        const cy = baseY + offsetY

        const brightness = (Math.sin(t * 0.7 + col * 1.2 + row * 0.8) + 1) * 0.5
        if (brightness < 0.3) continue

        const size = cellSize * 0.4 * brightness

        ctx.beginPath()
        ctx.ellipse(cx, cy, size, size * 0.7, t * 0.1 + col, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(150, 220, 255, ${brightness * 0.6})`
        ctx.fill()
      }
    }
    ctx.restore()
  }

  private drawLightRays(ctx: CanvasRenderingContext2D, w: number, h: number, t: number) {
    this.lightRays.forEach(ray => {
      ray.x += ray.speed * (1 / 60)
      if (ray.x > w + ray.width) ray.x = -ray.width

      const pulse = ray.opacity * (0.7 + Math.sin(t * 0.3 + ray.seed) * 0.3)

      ctx.save()
      ctx.globalAlpha = pulse
      ctx.globalCompositeOperation = 'screen'
      const rayGrad = ctx.createLinearGradient(ray.x, 0, ray.x + ray.width * 0.5, h * 0.85)
      rayGrad.addColorStop(0, 'rgba(255, 255, 220, 0.6)')
      rayGrad.addColorStop(0.3, 'rgba(255, 255, 200, 0.2)')
      rayGrad.addColorStop(0.7, 'rgba(200, 240, 255, 0.05)')
      rayGrad.addColorStop(1, 'rgba(200, 240, 255, 0)')
      ctx.fillStyle = rayGrad

      const wobble1 = Math.sin(t * 0.4 + ray.seed) * 10
      const wobble2 = Math.sin(t * 0.6 + ray.seed * 2) * 15
      ctx.beginPath()
      ctx.moveTo(ray.x + wobble1, 0)
      ctx.lineTo(ray.x + ray.width * 0.5 + wobble1, 0)
      ctx.lineTo(ray.x + ray.width * 0.8 + wobble2, h * 0.9)
      ctx.lineTo(ray.x + ray.width * 0.3 + wobble2, h * 0.9)
      ctx.closePath()
      ctx.fill()
      ctx.restore()
    })
  }

  private drawSandFloor(ctx: CanvasRenderingContext2D, w: number, h: number, t: number) {
    const sandTop = h - 55

    // Sand gradient base
    const sandGrad = ctx.createLinearGradient(0, sandTop, 0, h)
    sandGrad.addColorStop(0, 'rgba(60, 50, 35, 0)')
    sandGrad.addColorStop(0.15, 'rgba(60, 50, 35, 0.4)')
    sandGrad.addColorStop(0.5, 'rgba(55, 45, 30, 0.7)')
    sandGrad.addColorStop(1, 'rgba(40, 32, 22, 0.9)')
    ctx.fillStyle = sandGrad
    ctx.fillRect(0, sandTop, w, h - sandTop)

    // Sand texture grains
    this.sandGrains.forEach(g => {
      const flicker = 0.4 + Math.sin(t * 0.2 + g.x * 0.01) * 0.1
      ctx.beginPath()
      ctx.arc(g.x, g.y, g.size, 0, Math.PI * 2)
      ctx.fillStyle = `hsla(35, 30%, ${g.lightness}%, ${flicker})`
      ctx.fill()
    })

    // Sand ripple lines
    ctx.save()
    ctx.globalAlpha = 0.08
    for (let i = 0; i < 5; i++) {
      const ry = sandTop + 15 + i * 10
      ctx.beginPath()
      for (let x = 0; x <= w; x += 6) {
        const y = ry + Math.sin(x * 0.02 + t * 0.3 + i * 2) * 2
        if (x === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.strokeStyle = 'rgba(180, 160, 120, 0.5)'
      ctx.lineWidth = 0.8
      ctx.stroke()
    }
    ctx.restore()
  }

  private updateAndDrawParticles(ctx: CanvasRenderingContext2D, w: number, h: number, t: number, dt: number) {
    this.particles.forEach(p => {
      p.x += p.speedX * dt + noise(t * 0.5 + p.seed, p.seed) * 0.2
      p.y += p.speedY * dt

      if (p.y < -20) { p.y = h + 20; p.x = Math.random() * w }
      if (p.x < -20) p.x = w + 20
      if (p.x > w + 20) p.x = -20

      const twinkle = p.opacity * (0.5 + Math.sin(t * 1.5 + p.seed) * 0.3 + Math.sin(t * 2.7 + p.seed * 2) * 0.2)

      ctx.beginPath()
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2)
      ctx.fillStyle = `rgba(220, 240, 255, ${twinkle})`
      ctx.fill()
    })
  }
}
