/**
 * FishDrawingAPI — 独立的 2.5D 鱼类绘制 API
 *
 * 使用方式:
 *   const fish = new FishDrawer({ species: 'xijing', primaryColor: { h: 320, s: 80, l: 55 } })
 *   // 在 requestAnimationFrame 循环中:
 *   fish.update(dt)
 *   fish.draw(ctx)
 *
 * 这个文件是完全独立的，不依赖其他模块，可直接复制到任何项目中使用。
 */

// ============ 类型定义 ============

export interface FishColor {
  h: number  // 色相 0~360
  s: number  // 饱和度 0~100
  l: number  // 明度 0~100
}

export type BodyShape = 'oval' | 'slim' | 'round' | 'angular'
export type TailShape = 'forked' | 'fan' | 'pointed'
export type FinShape = 'flowing' | 'sharp' | 'round'
export type PatternType = 'none' | 'stripes' | 'spots' | 'gradient'

export interface FishConfig {
  /** 体长(px)，默认 38 */
  bodyLength?: number
  /** 体宽比(相对体长)，默认 0.5 */
  bodyWidth?: number
  /** 体型 */
  bodyShape?: BodyShape
  /** 主色 */
  primaryColor?: FishColor
  /** 副色（默认自动从主色派生） */
  secondaryColor?: FishColor
  /** 尾巴形状 */
  tailShape?: TailShape
  /** 鳍形状 */
  finShape?: FinShape
  /** 鳍大小 0.5~2.2，默认 1.0 */
  finSize?: number
  /** 花纹 */
  pattern?: PatternType
  /** 花纹密度 2~5 */
  patternDensity?: number
  /** 眼睛大小 0.1~0.2，默认 0.14 */
  eyeSize?: number
  /** 游泳速度倍率，默认 1 */
  speedMultiplier?: number
  /** 是否吐泡泡，默认 true */
  bubbles?: boolean
  /** 预设种类（覆盖上面的外观参数） */
  species?: 'moyu' | 'juanwang' | 'sheniu' | 'xianyu' | 'xijing'
}

export interface FishState {
  x: number
  y: number
  z: number
}

// ============ 种类预设 ============

const SPECIES_PRESETS: Record<string, Partial<FishConfig>> = {
  moyu: {
    bodyLength: 38, bodyWidth: 0.68, bodyShape: 'round',
    primaryColor: { h: 30, s: 70, l: 60 },
    tailShape: 'forked', finShape: 'round', finSize: 0.95,
    pattern: 'gradient', patternDensity: 2, eyeSize: 0.18,
  },
  juanwang: {
    bodyLength: 44, bodyWidth: 0.4, bodyShape: 'slim',
    primaryColor: { h: 220, s: 70, l: 42 },
    tailShape: 'pointed', finShape: 'sharp', finSize: 0.85,
    pattern: 'stripes', patternDensity: 4, eyeSize: 0.11,
  },
  sheniu: {
    bodyLength: 35, bodyWidth: 0.5, bodyShape: 'oval',
    primaryColor: { h: 40, s: 85, l: 58 },
    tailShape: 'forked', finShape: 'flowing', finSize: 1.2,
    pattern: 'spots', patternDensity: 4, eyeSize: 0.15,
  },
  xianyu: {
    bodyLength: 40, bodyWidth: 0.8, bodyShape: 'angular',
    primaryColor: { h: 100, s: 25, l: 65 },
    tailShape: 'pointed', finShape: 'round', finSize: 0.6,
    pattern: 'none', patternDensity: 1, eyeSize: 0.13,
  },
  xijing: {
    bodyLength: 36, bodyWidth: 0.55, bodyShape: 'oval',
    primaryColor: { h: 330, s: 85, l: 55 },
    tailShape: 'fan', finShape: 'flowing', finSize: 1.9,
    pattern: 'stripes', patternDensity: 3, eyeSize: 0.17,
  },
}

// ============ 辅助函数 ============

function hsl(color: FishColor, alpha = 1): string {
  return `hsla(${color.h}, ${color.s}%, ${color.l}%, ${alpha})`
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

// ============ FishDrawer 主类 ============

interface Bubble {
  x: number
  y: number
  size: number
  vx: number
  vy: number
  life: number
  maxLife: number
}

export class FishDrawer {
  // 外观参数（创建后不变）
  private bodyLength: number
  private bodyWidth: number
  private bodyShape: BodyShape
  private primaryColor: FishColor
  private secondaryColor: FishColor
  private tailShape: TailShape
  private finShape: FinShape
  private finSize: number
  private pattern: PatternType
  private patternDensity: number
  private eyeSize: number
  private speedMultiplier: number
  private bubblesEnabled: boolean

  // 运动状态
  x = 0
  y = 0
  z = 0.6
  private vx = 0
  private vy = 0
  private vz = 0
  private angle = 0
  private angularVelocity = 0
  private facingDir = 1
  private yaw = 0
  private tailYaw = 0
  private targetX = 0
  private targetY = 0
  private targetZ = 0.6
  private animTime = 0
  private accumulatedWavePhase = 0
  private mouthOpen = 0.12

  // 泡泡
  private bubbleList: Bubble[] = []

  // 边界
  private tankWidth = 800
  private tankHeight = 600

  constructor(config: FishConfig = {}) {
    // 应用种类预设
    const preset = config.species ? SPECIES_PRESETS[config.species] || {} : {}
    const merged = { ...preset, ...config }

    this.bodyLength = merged.bodyLength ?? 38
    this.bodyWidth = merged.bodyWidth ?? 0.5
    this.bodyShape = merged.bodyShape ?? 'oval'
    this.primaryColor = merged.primaryColor ?? { h: 200, s: 70, l: 50 }
    this.secondaryColor = merged.secondaryColor ?? {
      h: this.primaryColor.h + rand(-15, 15),
      s: Math.max(20, this.primaryColor.s - 10),
      l: Math.min(85, this.primaryColor.l + 10),
    }
    this.tailShape = merged.tailShape ?? 'forked'
    this.finShape = merged.finShape ?? 'flowing'
    this.finSize = merged.finSize ?? 1.0
    this.pattern = merged.pattern ?? 'none'
    this.patternDensity = merged.patternDensity ?? 3
    this.eyeSize = merged.eyeSize ?? 0.14
    this.speedMultiplier = merged.speedMultiplier ?? 1
    this.bubblesEnabled = merged.bubbles !== false

    this.animTime = Math.random() * 100
    this.angle = Math.random() * Math.PI * 2
    this.facingDir = Math.cos(this.angle) >= 0 ? 1 : -1
    this.yaw = this.facingDir >= 0 ? 0 : Math.PI
    this.tailYaw = this.yaw
  }

  /** 设置鱼缸尺寸（必须在 update 前调用） */
  setTankSize(width: number, height: number) {
    this.tankWidth = width
    this.tankHeight = height
  }

  /** 设置鱼的位置 */
  setPosition(x: number, y: number, z?: number) {
    this.x = x
    this.y = y
    if (z !== undefined) this.z = z
    this.targetX = x
    this.targetY = y
  }

  /** 获取当前状态（位置、速度等） */
  getState(): FishState {
    return { x: this.x, y: this.y, z: this.z }
  }

  /** 每帧调用，更新运动和动画状态。dt 为秒。 */
  update(dt: number) {
    dt = Math.min(dt, 0.1)
    this.animTime += dt

    // 游动逻辑
    this.updateWander(dt)
    this.updateDepth(dt)
    this.updateFacing(dt)

    // 波形相位累积（防止速度变化时跳帧）
    const speed = Math.sqrt(this.vx * this.vx + this.vy * this.vy)
    const waveFreq = 1.0 + speed * 0.03
    this.accumulatedWavePhase += waveFreq * 3 * dt

    // 嘴巴
    this.mouthOpen = Math.sin(this.animTime * 2.5) * 0.12 + 0.12

    // 泡泡
    if (this.bubblesEnabled) {
      this.updateBubbles(dt)
    }
  }

  /** 绘制鱼到指定 canvas context */
  draw(ctx: CanvasRenderingContext2D) {
    const speed = Math.sqrt(this.vx * this.vx + this.vy * this.vy)

    // 深度阴影
    this.drawDepthShadow(ctx)

    ctx.save()
    ctx.translate(this.x, this.y)

    // 深度缩放
    const zScale = 0.45 + this.z * 0.7
    const depthAlpha = 0.45 + this.z * 0.55
    ctx.globalAlpha = depthAlpha
    ctx.scale(zScale, zScale)

    // 游泳俯仰
    let swimPitch = 0
    if (speed > 0.2) {
      swimPitch = Math.atan2(this.vy, Math.abs(this.vx))
    }
    ctx.rotate(clamp(swimPitch, -Math.PI / 4, Math.PI / 4) * 0.6)

    // Yaw 透视
    const cosYaw = Math.cos(this.yaw)
    let xScale = cosYaw
    if (Math.abs(xScale) < 0.01) xScale = Math.sign(xScale) * 0.01 || 0.01
    const yBulge = 1 + (1 - Math.abs(cosYaw)) * 0.2
    ctx.scale(xScale, yBulge)

    // 呼吸
    const breathe = 1 + Math.sin(this.animTime * 1.5) * 0.01
    ctx.scale(breathe, breathe)

    // 速度拉伸
    const stretch = 1 + speed * 0.01
    ctx.scale(stretch, 1 / Math.sqrt(stretch))

    // 波形参数
    const wavePhase = this.accumulatedWavePhase
    const waveAmp = 0.35 + speed * 0.015
    const maxBend = this.bodyLength * 0.35
    const bend = clamp(this.angularVelocity * this.facingDir * 3, -maxBend, maxBend)

    // 按层绘制
    this.drawTail(ctx, wavePhase, waveAmp, bend, speed)
    this.drawDorsalFin(ctx, wavePhase, waveAmp, bend, speed)
    this.drawPectoralFins(ctx, bend, speed, true)
    this.drawBody(ctx, wavePhase, waveAmp, bend, speed)
    this.drawScales(ctx, wavePhase, waveAmp, bend, speed)
    this.drawPattern(ctx, wavePhase, waveAmp, bend, speed)
    this.drawPectoralFins(ctx, bend, speed, false)
    this.drawEye(ctx, wavePhase, waveAmp, bend, speed)
    this.drawMouth(ctx, wavePhase, waveAmp, bend)

    // 深度蓝色调
    if (this.z < 0.5) {
      ctx.globalCompositeOperation = 'source-atop'
      ctx.fillStyle = `rgba(20, 60, 100, ${((0.5 - this.z) / 0.5) * 0.35})`
      ctx.fillRect(-this.bodyLength * 2, -this.bodyLength * 2, this.bodyLength * 4, this.bodyLength * 4)
    }

    ctx.restore()

    // 泡泡绘制在鱼的变换之外（世界坐标）
    if (this.bubblesEnabled) {
      this.drawBubbles(ctx)
    }
  }

  // ============ 泡泡系统 ============

  private updateBubbles(dt: number) {
    // 随机从嘴部发射泡泡
    if (Math.random() < dt * 0.8) {
      const mouthX = this.x + Math.cos(this.angle) * this.bodyLength * 0.45
      const mouthY = this.y + Math.sin(this.angle) * this.bodyLength * 0.45
      this.bubbleList.push({
        x: mouthX,
        y: mouthY,
        size: 1 + Math.random() * 2,
        vx: (Math.random() - 0.5) * 0.5 + this.vx * 0.2,
        vy: -1 - Math.random() * 1.5,
        life: 0,
        maxLife: 2 + Math.random() * 2,
      })
    }

    // 更新泡泡状态
    for (let i = this.bubbleList.length - 1; i >= 0; i--) {
      const b = this.bubbleList[i]
      b.life += dt
      b.x += b.vx * dt * 60
      b.y += b.vy * dt * 60
      b.vx += (Math.random() - 0.5) * 0.1
      b.size += dt * 0.5

      if (b.life >= b.maxLife || b.y < -20) {
        this.bubbleList.splice(i, 1)
      }
    }
  }

  private drawBubbles(ctx: CanvasRenderingContext2D) {
    ctx.save()
    for (const b of this.bubbleList) {
      const alpha = Math.min(1, (b.maxLife - b.life) * 2)

      // 泡泡主体
      ctx.beginPath()
      ctx.arc(b.x, b.y, b.size, 0, Math.PI * 2)
      ctx.fillStyle = `rgba(255, 255, 255, ${alpha * 0.4})`
      ctx.fill()
      ctx.strokeStyle = `rgba(255, 255, 255, ${alpha * 0.8})`
      ctx.lineWidth = 0.5
      ctx.stroke()

      // 高光点
      ctx.beginPath()
      ctx.arc(b.x - b.size * 0.3, b.y - b.size * 0.3, b.size * 0.2, 0, Math.PI * 2)
      ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`
      ctx.fill()
    }
    ctx.restore()
  }

  // ============ 运动更新 ============

  private updateWander(dt: number) {
    const speed = 1.2 * this.speedMultiplier
    const dx = this.targetX - this.x
    const dy = this.targetY - this.y
    const dist = Math.sqrt(dx * dx + dy * dy)

    if (dist < 60 || (this.targetX === 0 && this.targetY === 0)) {
      this.pickWanderTarget()
      return
    }

    const targetAngle = Math.atan2(dy, dx)
    let angleDiff = targetAngle - this.angle
    while (angleDiff > Math.PI) angleDiff -= Math.PI * 2
    while (angleDiff < -Math.PI) angleDiff += Math.PI * 2

    const oldAngle = this.angle
    this.angle += angleDiff * 0.06

    const swimSpeed = speed * 0.6
    this.vx = Math.cos(this.angle) * swimSpeed
    this.vy = Math.sin(this.angle) * swimSpeed

    this.x += this.vx * dt * 60
    this.y += this.vy * dt * 60

    // 阻尼
    this.vx *= 0.97
    this.vy *= 0.97

    // 边界
    const margin = 50
    if (this.x < margin) { this.x = margin; this.vx = Math.abs(this.vx) * 0.3 }
    if (this.x > this.tankWidth - margin) { this.x = this.tankWidth - margin; this.vx = -Math.abs(this.vx) * 0.3 }
    if (this.y < margin) { this.y = margin; this.vy = Math.abs(this.vy) * 0.3 }
    if (this.y > this.tankHeight - margin) { this.y = this.tankHeight - margin; this.vy = -Math.abs(this.vy) * 0.3 }

    // 角速度（用于身体弯曲）
    let aD = this.angle - oldAngle
    while (aD > Math.PI) aD -= Math.PI * 2
    while (aD < -Math.PI) aD += Math.PI * 2
    const targetAngVel = clamp(aD / dt, -0.12, 0.12)
    this.angularVelocity += (targetAngVel - this.angularVelocity) * 0.1
  }

  private pickWanderTarget() {
    const margin = 100
    const w = this.tankWidth
    const h = this.tankHeight

    if (this.x > w - margin * 1.5) {
      this.targetX = margin + Math.random() * (w * 0.3)
    } else if (this.x < margin * 1.5) {
      this.targetX = w - margin - Math.random() * (w * 0.3)
    } else {
      this.targetX = this.vx >= 0
        ? w - margin - Math.random() * (w * 0.3)
        : margin + Math.random() * (w * 0.3)
    }
    this.targetY = clamp(this.y + (Math.random() - 0.5) * (h * 0.3), margin, h - margin)
    this.targetZ = 0.4 + Math.random() * 0.5
  }

  private updateDepth(dt: number) {
    const zDiff = this.targetZ - this.z
    this.vz += zDiff * 0.03
    this.vz *= 0.95
    this.z += this.vz * dt * 2
    if (this.z < 0.3) { this.z = 0.3; this.vz = Math.abs(this.vz) * 0.3 }
    if (this.z > 0.95) { this.z = 0.95; this.vz = -Math.abs(this.vz) * 0.3 }
  }

  private updateFacing(dt: number) {
    const cosAngle = Math.cos(this.angle)
    if (Math.abs(cosAngle) > 0.1) {
      this.facingDir = cosAngle >= 0 ? 1 : -1
    }

    let targetYaw = this.facingDir >= 0 ? 0 : Math.PI
    let yawDiff = targetYaw - this.yaw
    if (yawDiff > Math.PI) yawDiff -= Math.PI * 2
    if (yawDiff < -Math.PI) yawDiff += Math.PI * 2
    this.yaw += yawDiff * dt * 5.0

    // 尾巴 yaw 滞后
    let tailYawDiff = this.yaw - this.tailYaw
    if (tailYawDiff > Math.PI) tailYawDiff -= Math.PI * 2
    if (tailYawDiff < -Math.PI) tailYawDiff += Math.PI * 2
    this.tailYaw += tailYawDiff * dt * 2.0
  }

  // ============ 绘制方法 ============

  private getSpineOffset(t: number, wavePhase: number, waveAmp: number, bend: number): number {
    const phase = wavePhase - (1 - t) * 3.5
    let envelope = 0
    if (t > 0.75) {
      envelope = (t - 0.75) * 1.2
    } else {
      envelope = Math.pow((0.75 - t) / 0.75, 1.3) * 2.8
    }
    const wag = Math.sin(phase) * waveAmp * envelope
    const turn = bend * Math.pow(1 - t, 1.5)
    return wag + turn
  }

  private traceDynamicBody(ctx: CanvasRenderingContext2D, wavePhase: number, waveAmp: number, bend: number, speed: number) {
    const w = this.bodyLength
    const h = w * this.bodyWidth
    const headX = w * 0.5
    const tailX = -w * 0.5
    const steps = 24
    const yaw = this.yaw
    const turnBulge = (1 - Math.abs(Math.cos(yaw))) * 0.4

    const getThickness = (t: number) => {
      const baseH = h * 1.5 * (1 + turnBulge)
      switch (this.bodyShape) {
        case 'oval': return Math.sin(t * Math.PI) * baseH * 0.6
        case 'slim': return (Math.sin(t * Math.PI) * 0.6 + Math.sin(t * Math.PI * 0.5) * 0.4) * baseH * 0.5
        case 'round': return Math.sin(Math.pow(t, 0.6) * Math.PI) * baseH * 0.8
        case 'angular': return (t < 0.6 ? (t / 0.6) : (1 - t) / 0.4) * baseH * 0.6
        default: return Math.sin(t * Math.PI) * baseH * 0.6
      }
    }

    const getZScale = (t: number) => {
      const localPhase = wavePhase - (1 - t) * 3.5
      const rawWag = Math.sin(localPhase)
      let envelope = t > 0.75 ? (t - 0.75) * 0.8 : Math.pow((0.75 - t) / 0.75, 1.3)
      const wagAngle = rawWag * (0.6 + speed * 0.3) * envelope
      let zScale = Math.cos(wagAngle)
      if (rawWag > 0) zScale = 1 - (1 - zScale) * 0.15
      return zScale
    }

    const getDynamicThickness = (t: number) => {
      let thickness = getThickness(t)
      const localPhase = wavePhase - (1 - t) * 3.5
      const rawWag = Math.sin(localPhase)
      const env = t > 0.75 ? (t - 0.75) * 0.8 : Math.pow((0.75 - t) / 0.75, 1.3)
      return thickness * (1 + rawWag * env * 0.15)
    }

    ctx.beginPath()
    for (let i = steps; i >= 0; i--) {
      const t = i / steps
      const baseX = tailX + t * (headX - tailX)
      const thickness = getDynamicThickness(t)
      const zs = getZScale(t)
      const x = baseX * zs
      const offset = this.getSpineOffset(t, wavePhase, waveAmp, bend)
      if (i === steps) ctx.moveTo(x, offset - thickness)
      else ctx.lineTo(x, offset - thickness)
    }
    for (let i = 0; i <= steps; i++) {
      const t = i / steps
      const baseX = tailX + t * (headX - tailX)
      const thickness = getDynamicThickness(t)
      const zs = getZScale(t)
      const x = baseX * zs
      const offset = this.getSpineOffset(t, wavePhase, waveAmp, bend)
      ctx.lineTo(x, offset + thickness)
    }
    ctx.closePath()
  }

  private drawDepthShadow(ctx: CanvasRenderingContext2D) {
    const shadowY = this.y + this.bodyLength * (0.7 + (1 - this.z) * 0.8)
    const shadowX = this.x + (1 - this.z) * 10
    const shadowW = this.bodyLength * (0.4 + this.z * 0.4)
    const shadowH = shadowW * 0.2
    const shadowAlpha = 0.04 + this.z * 0.16
    ctx.save()
    ctx.globalAlpha = shadowAlpha
    ctx.beginPath()
    ctx.ellipse(shadowX, shadowY, shadowW, shadowH, 0, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(0, 10, 20, 1)'
    ctx.fill()
    ctx.restore()
  }

  private drawBody(ctx: CanvasRenderingContext2D, wavePhase: number, waveAmp: number, bend: number, speed: number) {
    const w = this.bodyLength
    const h = w * this.bodyWidth
    const sinY = Math.sin(this.yaw)

    this.traceDynamicBody(ctx, wavePhase, waveAmp, bend, speed)

    const grad = ctx.createLinearGradient(0, -h * 1.5, 0, h * 1.5)
    grad.addColorStop(0, hsl({ ...this.primaryColor, l: this.primaryColor.l + 15 }, 0.9))
    grad.addColorStop(0.4, hsl(this.primaryColor, 0.85))
    grad.addColorStop(1, hsl({ ...this.secondaryColor, l: this.secondaryColor.l - 10 }, 0.8))
    ctx.fillStyle = grad
    ctx.fill()

    // 内部光影
    ctx.save()
    this.traceDynamicBody(ctx, wavePhase, waveAmp, bend, speed)
    ctx.clip()

    const highlightShift = sinY * w * 0.15
    const midY = this.getSpineOffset(0.7, wavePhase, waveAmp, bend)

    // 顶部高光
    const gel = ctx.createRadialGradient(highlightShift, midY - h * 0.5, 0, highlightShift, midY - h * 0.3, w * 0.6)
    gel.addColorStop(0, 'rgba(255,255,255,0.55)')
    gel.addColorStop(0.4, 'rgba(255,255,255,0.2)')
    gel.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = gel
    ctx.beginPath()
    ctx.ellipse(highlightShift, midY - h * 0.4, w * 0.6, h * 0.7, 0, 0, Math.PI * 2)
    ctx.fill()

    // Rim light
    ctx.beginPath()
    ctx.ellipse(highlightShift * 1.5, midY - h * 0.6, w * 0.3, h * 0.15, 0, 0, Math.PI * 2)
    ctx.fillStyle = `rgba(255, 255, 255, ${0.08 + Math.abs(sinY) * 0.12})`
    ctx.fill()

    // 3D 轮廓线
    const contourStrength = Math.abs(sinY)
    if (contourStrength > 0.1) {
      const contourY = sinY * h * 0.6
      ctx.beginPath()
      for (let i = 0; i <= 16; i++) {
        const t = i / 16
        const cx = -w * 0.4 + t * w * 0.8
        const spineOff = this.getSpineOffset(t, wavePhase, waveAmp, bend)
        const cy = spineOff + contourY * Math.sin(t * Math.PI) * 0.8
        if (i === 0) ctx.moveTo(cx, cy)
        else ctx.lineTo(cx, cy)
      }
      ctx.strokeStyle = `rgba(0, 15, 30, ${contourStrength * 0.2})`
      ctx.lineWidth = 1
      ctx.stroke()
    }

    ctx.restore()
  }

  private drawScales(ctx: CanvasRenderingContext2D, wavePhase: number, waveAmp: number, bend: number, speed: number) {
    const w = this.bodyLength
    const h = w * this.bodyWidth
    ctx.save()
    this.traceDynamicBody(ctx, wavePhase, waveAmp, bend, speed)
    ctx.clip()
    ctx.globalCompositeOperation = 'overlay'
    for (const t of [0.4, 0.55, 0.7]) {
      const sx = -w * 0.5 + t * w
      const sy = this.getSpineOffset(t, wavePhase, waveAmp, bend) - h * 0.2
      ctx.beginPath()
      ctx.arc(sx, sy, h * 0.35, 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(255, 255, 255, 0.3)'
      ctx.fill()
    }
    ctx.restore()
  }

  private drawPattern(ctx: CanvasRenderingContext2D, wavePhase: number, waveAmp: number, bend: number, speed: number) {
    if (this.pattern === 'none') return
    const w = this.bodyLength
    const h = w * this.bodyWidth

    ctx.save()
    this.traceDynamicBody(ctx, wavePhase, waveAmp, bend, speed)
    ctx.clip()

    switch (this.pattern) {
      case 'stripes':
        ctx.globalCompositeOperation = 'overlay'
        for (let i = 0; i < this.patternDensity; i++) {
          const t = 0.3 + 0.5 * ((i + 0.5) / this.patternDensity)
          const xPos = -w * 0.5 + t * w
          const yPos = this.getSpineOffset(t, wavePhase, waveAmp, bend)
          ctx.beginPath()
          ctx.ellipse(xPos, yPos, Math.max(3, w * 0.08), h * 0.9, 0.08, 0, Math.PI * 2)
          ctx.fillStyle = 'rgba(255, 255, 255, 0.2)'
          ctx.fill()
        }
        break
      case 'spots':
        ctx.globalCompositeOperation = 'overlay'
        for (let i = 0; i < this.patternDensity * 2; i++) {
          const t = 0.3 + 0.5 * (i / (this.patternDensity * 2))
          const sx = -w * 0.5 + t * w + Math.sin(i * 2.5 + 0.3) * w * 0.1
          const sy = this.getSpineOffset(t, wavePhase, waveAmp, bend) + Math.cos(i * 1.7 + 0.5) * h * 0.5
          ctx.beginPath()
          ctx.arc(sx, sy, 3 + Math.abs(Math.sin(i * 5)) * 2, 0, Math.PI * 2)
          ctx.fillStyle = 'rgba(255, 255, 255, 0.25)'
          ctx.fill()
        }
        break
      case 'gradient': {
        const t = 0.8
        const gX = -w * 0.5 + t * w
        const gY = this.getSpineOffset(t, wavePhase, waveAmp, bend)
        const g = ctx.createRadialGradient(gX, gY, 0, gX, gY, w * 0.7)
        g.addColorStop(0, 'rgba(255, 255, 255, 0.25)')
        g.addColorStop(1, 'transparent')
        ctx.fillStyle = g
        ctx.fillRect(-w, -h * 2, w * 2, h * 4)
        break
      }
    }
    ctx.restore()
  }

  private drawEye(ctx: CanvasRenderingContext2D, wavePhase: number, waveAmp: number, bend: number, speed: number) {
    const w = this.bodyLength
    const h = w * this.bodyWidth
    const t = 0.82
    const cosYaw = Math.cos(this.yaw)
    const sinYaw = Math.sin(this.yaw)
    let currentXScale = cosYaw
    if (Math.abs(currentXScale) < 0.01) currentXScale = Math.sign(currentXScale) * 0.01 || 0.01

    const eyeShiftY = sinYaw * h * 0.08
    const worldEyeShiftX = sinYaw * h * 0.35
    const localEyeShiftX = worldEyeShiftX / currentXScale

    const eyeX = -w * 0.5 + t * w + localEyeShiftX
    const eyeY = this.getSpineOffset(t, wavePhase, waveAmp, bend) - h * 0.12 + eyeShiftY
    const eyeR = w * this.eyeSize * 0.8

    ctx.save()
    ctx.translate(eyeX, eyeY)
    const targetEyeWidth = Math.max(0.4, Math.abs(cosYaw))
    ctx.scale(targetEyeWidth / Math.abs(currentXScale), 1)

    // 第 1 层：巩膜
    const scleraGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, eyeR)
    scleraGrad.addColorStop(0, '#ffffff')
    scleraGrad.addColorStop(1, '#e2e8f0')
    ctx.beginPath()
    ctx.arc(0, 0, eyeR, 0, Math.PI * 2)
    ctx.fillStyle = scleraGrad
    ctx.fill()

    // 第 2 层：虹膜
    const irisR = eyeR * 0.6
    const irisGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, irisR)
    irisGrad.addColorStop(0, hsl({ ...this.primaryColor, l: 20 }))
    irisGrad.addColorStop(1, hsl({ ...this.primaryColor, l: 10 }))
    ctx.beginPath()
    ctx.arc(0, 0, irisR, 0, Math.PI * 2)
    ctx.fillStyle = irisGrad
    ctx.fill()

    // 第 3 层：瞳孔
    const lookX = Math.min(eyeR * 0.15, speed * 0.3)
    ctx.beginPath()
    ctx.arc(lookX, this.vy * 0.15, eyeR * 0.35, 0, Math.PI * 2)
    ctx.fillStyle = '#0f172a'
    ctx.fill()

    // 第 4 层：主高光
    ctx.beginPath()
    ctx.arc(-eyeR * 0.25, -eyeR * 0.25, eyeR * 0.25, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.95)'
    ctx.fill()

    // 第 5 层：副高光
    ctx.beginPath()
    ctx.arc(eyeR * 0.2, eyeR * 0.15, eyeR * 0.1, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)'
    ctx.fill()

    ctx.restore()
  }

  private drawMouth(ctx: CanvasRenderingContext2D, wavePhase: number, waveAmp: number, bend: number) {
    const w = this.bodyLength
    const h = w * this.bodyWidth
    const t = 0.95
    const mouthX = -w * 0.5 + t * w
    const mouthY = this.getSpineOffset(t, wavePhase, waveAmp, bend) + h * 0.1

    ctx.save()
    ctx.translate(mouthX, mouthY)

    const cosYaw = Math.cos(this.yaw)
    let currentXScale = cosYaw
    if (Math.abs(currentXScale) < 0.01) currentXScale = Math.sign(currentXScale) * 0.01 || 0.01
    const targetMouthWidth = Math.max(0.3, Math.abs(cosYaw))
    ctx.scale(targetMouthWidth / Math.abs(currentXScale), 1)

    ctx.beginPath()
    ctx.ellipse(0, 0, 1.5 + this.mouthOpen * 2, 0.8 + this.mouthOpen * 1.5, 0, 0, Math.PI * 2)
    ctx.fillStyle = `rgba(80, 20, 20, ${0.3 + this.mouthOpen * 0.4})`
    ctx.fill()
    ctx.restore()
  }

  private drawTail(ctx: CanvasRenderingContext2D, wavePhase: number, waveAmp: number, bend: number, speed: number) {
    const w = this.bodyLength
    const energy = 0.6
    const amp = 1.5 + energy * 0.5 + speed * 1.5
    const tailPhase = wavePhase - 1.8
    const tailSwing = Math.sin(tailPhase) * amp * 0.25
    const isFan = this.tailShape === 'fan'

    ctx.save()

    // 锚点定位
    const bodyPhaseForTail = wavePhase - 3.5
    const bodyWagForTail = Math.sin(bodyPhaseForTail)
    const wagAngleForTail = bodyWagForTail * (0.6 + speed * 0.3)
    let tailAnchorZScale = Math.cos(wagAngleForTail)
    if (bodyWagForTail > 0) tailAnchorZScale = 1 - (1 - tailAnchorZScale) * 0.15

    const tailY = this.getSpineOffset(0, wavePhase, waveAmp, bend)
    const tailX = (-w * 0.5) * tailAnchorZScale
    ctx.translate(tailX, tailY)

    let tailLen = 26
    if (this.tailShape === 'fan') tailLen = w * 0.8
    else if (this.tailShape === 'forked') tailLen = w * 0.75
    else if (this.tailShape === 'pointed') tailLen = w * 0.55

    const phaseDiv = isFan ? tailLen * 0.6 : 20
    const bodyYaw = this.yaw
    const cosTailYaw = Math.cos(this.tailYaw)
    const sinTailYaw = Math.sin(this.tailYaw)

    let bodyXScale = Math.cos(bodyYaw)
    if (Math.abs(bodyXScale) < 0.01) bodyXScale = Math.sign(bodyXScale) * 0.01 || 0.01
    const invBodyScale = 1 / bodyXScale

    const tx = (d: number, phaseOffset = 0) => {
      const localPhase = tailPhase - (d / phaseDiv) * 1.5 + phaseOffset
      const rawWag = Math.sin(localPhase)
      const wag = rawWag * (1 + 0.3 * rawWag)
      const wagAngle = wag * (0.8 + speed * 0.4)
      let wagZScale = Math.cos(wagAngle)
      if (wag > 0) wagZScale = 1 - (1 - wagZScale) * 0.15
      const projectedLengthX = -d * wagZScale * cosTailYaw
      const curlAmount = Math.abs(sinTailYaw) * d * (isFan ? 0.6 : 0.4)
      const directionalCurl = -sinTailYaw * (isFan ? w * 0.1 : w * 0.05) * Math.pow(d / tailLen, 1.5)
      return (projectedLengthX + curlAmount + directionalCurl) * invBodyScale
    }

    const ty = (d: number, baseY: number, phaseOffset = 0) => {
      const localPhase = tailPhase - (d / phaseDiv) * 1.5 + phaseOffset
      const ripple = Math.sin(localPhase) * amp * (d / tailLen) * (isFan ? 8 : 3)
      const baseSwingLocal = tailSwing * Math.min(1, d / 20)
      const turnCurlY = sinTailYaw * (isFan ? w * 0.15 : w * 0.08) * Math.pow(d / tailLen, 1.5)
      return baseY + ripple + baseSwingLocal + turnCurlY
    }

    // Z 深度效果
    const tipPhase = tailPhase - 1.5
    const zDepth = Math.sin(tipPhase) * (1 + 0.3 * Math.sin(tipPhase))
    ctx.scale(1, 1 + zDepth * 0.35)

    // 渐变
    const lightMod = zDepth > 0 ? zDepth * 15 : zDepth * 10
    const alphaMod = zDepth > 0 ? zDepth * 0.15 : zDepth * 0.05
    const tailGrad = ctx.createLinearGradient(tx(0), 0, tx(tailLen), 0)
    tailGrad.addColorStop(0, hsl({ ...this.primaryColor, l: this.primaryColor.l + lightMod }, 0.85 + alphaMod))
    if (isFan) {
      tailGrad.addColorStop(0.4, hsl({ ...this.primaryColor, l: this.primaryColor.l + 15 + lightMod }, 0.6 + alphaMod))
      tailGrad.addColorStop(1, hsl({ ...this.primaryColor, s: this.primaryColor.s * 0.4, l: 92 + lightMod }, 0.15 + alphaMod))
    } else {
      tailGrad.addColorStop(1, hsl({ ...this.primaryColor, l: this.primaryColor.l + 12 + lightMod, s: this.primaryColor.s - 10 }, 0.1 + alphaMod))
    }

    // 扇尾背景层
    if (isFan) {
      const layers = [
        { pOff: 0.17, alphaMult: 0.55, widthMod: 1.1, lenMod: 0.8 },
        { pOff: 0.09, alphaMult: 0.7, widthMod: 1.0, lenMod: 0.85 },
      ]
      for (const layer of layers) {
        const l3 = tailLen * layer.lenMod
        const l1 = w * 0.5 * layer.lenMod
        const l2 = w * 0.9 * layer.lenMod
        const topY = -w * 0.7 * layer.widthMod
        const botY = w * 0.7 * layer.widthMod
        ctx.beginPath()
        ctx.moveTo(tx(0, layer.pOff), 0)
        ctx.bezierCurveTo(tx(l1, layer.pOff), ty(l1, topY, layer.pOff), tx(l2, layer.pOff), ty(l2, topY * 1.3, layer.pOff), tx(l3, layer.pOff), ty(l3, topY * 0.85, layer.pOff))
        ctx.bezierCurveTo(tx(l3 * 0.8, layer.pOff), ty(l3 * 0.8, 0, layer.pOff), tx(l3 * 1.1, layer.pOff), ty(l3 * 1.1, 0, layer.pOff), tx(l3 * 0.85, layer.pOff), ty(l3 * 0.85, botY * 0.85, layer.pOff))
        ctx.bezierCurveTo(tx(l2, layer.pOff), ty(l2, botY * 1.3, layer.pOff), tx(l1, layer.pOff), ty(l1, botY, layer.pOff), tx(0, layer.pOff), 0)
        const layerGrad = ctx.createLinearGradient(tx(0), 0, tx(tailLen), 0)
        layerGrad.addColorStop(0, hsl({ ...this.primaryColor, l: this.primaryColor.l - 5 }, 0.85 * layer.alphaMult))
        layerGrad.addColorStop(0.4, hsl({ ...this.primaryColor, l: this.primaryColor.l + 10 }, 0.6 * layer.alphaMult))
        layerGrad.addColorStop(1, hsl({ ...this.primaryColor, s: this.primaryColor.s * 0.4, l: 85 }, 0.15 * layer.alphaMult))
        ctx.fillStyle = layerGrad
        ctx.fill()
      }
    }

    // 主尾鳍
    ctx.beginPath()
    switch (this.tailShape) {
      case 'forked': {
        const l = tailLen
        ctx.moveTo(tx(0), 0)
        ctx.bezierCurveTo(tx(l * 0.3), ty(l * 0.3, -w * 0.3), tx(l * 0.6), ty(l * 0.6, -w * 0.6), tx(l), ty(l, -w * 0.8))
        ctx.bezierCurveTo(tx(l * 0.8), ty(l * 0.8, -w * 0.4), tx(l * 0.6), ty(l * 0.6, 0), tx(l * 0.4), ty(l * 0.4, 0))
        ctx.bezierCurveTo(tx(l * 0.6), ty(l * 0.6, 0), tx(l * 0.8), ty(l * 0.8, w * 0.4), tx(l), ty(l, w * 0.8))
        ctx.bezierCurveTo(tx(l * 0.6), ty(l * 0.6, w * 0.6), tx(l * 0.3), ty(l * 0.3, w * 0.3), tx(0), 0)
        break
      }
      case 'fan': {
        const l1 = w * 0.5, l2 = w * 0.9, l3 = tailLen
        ctx.moveTo(tx(0), 0)
        ctx.bezierCurveTo(tx(l1), ty(l1, -w * 0.7), tx(l2), ty(l2, -w * 0.9), tx(l3), ty(l3, -w * 0.6))
        ctx.bezierCurveTo(tx(l3 * 0.8), ty(l3 * 0.8, -w * 0.12), tx(l3 * 1.1), ty(l3 * 1.1, w * 0.12), tx(l3 * 0.85), ty(l3 * 0.85, w * 0.6))
        ctx.bezierCurveTo(tx(l2), ty(l2, w * 0.9), tx(l1), ty(l1, w * 0.7), tx(0), 0)
        break
      }
      case 'pointed': {
        const l = tailLen
        ctx.moveTo(tx(0), 0)
        ctx.bezierCurveTo(tx(l * 0.3), ty(l * 0.3, -w * 0.4), tx(l * 0.6), ty(l * 0.6, -w * 0.2), tx(l), ty(l, 0))
        ctx.bezierCurveTo(tx(l * 0.6), ty(l * 0.6, w * 0.2), tx(l * 0.3), ty(l * 0.3, w * 0.4), tx(0), 0)
        break
      }
    }
    ctx.fillStyle = tailGrad
    ctx.fill()

    // 鳍条
    ctx.save()
    ctx.clip()
    ctx.lineWidth = isFan ? 0.8 : 0.5
    ctx.strokeStyle = `rgba(255, 255, 255, ${isFan ? 0.25 : 0.15})`
    const rayCount = isFan ? 16 : (this.tailShape === 'forked' ? 6 : 4)
    for (let i = 0; i <= rayCount; i++) {
      const rt = i / rayCount
      const angle = -0.5 + rt
      const rLen = isFan ? tailLen * (0.85 + Math.sin(rt * Math.PI) * 0.15) : tailLen
      const angleSpread = angle * (isFan ? w * 1.8 : 15)
      const endSpread = angle * (isFan ? w * 2.5 : 30)
      ctx.beginPath()
      ctx.moveTo(tx(0), 0)
      ctx.quadraticCurveTo(tx(rLen * 0.4), ty(rLen * 0.4, angleSpread), tx(rLen), ty(rLen, endSpread))
      ctx.stroke()
    }
    ctx.restore()

    ctx.restore()
  }

  private drawDorsalFin(ctx: CanvasRenderingContext2D, wavePhase: number, waveAmp: number, bend: number, speed: number) {
    const w = this.bodyLength
    const h = w * this.bodyWidth
    const finH = h * this.finSize * 0.6
    const sway = Math.sin(wavePhase - 0.5) * (0.8 + speed * 0.5) * 0.6

    ctx.save()
    const t = 0.45
    const finX = -w * 0.5 + t * w
    const finY = this.getSpineOffset(t, wavePhase, waveAmp, bend)
    ctx.translate(finX, finY)

    ctx.beginPath()
    ctx.moveTo(-w * 0.15, -h + 2)
    switch (this.finShape) {
      case 'flowing':
        ctx.bezierCurveTo(-w * 0.05, -h - finH * 0.5 + sway, -w * 0.15, -h - finH * 1.2 + sway * 0.7, -w * 0.35, -h * 0.5 + sway * 1.2)
        ctx.quadraticCurveTo(-w * 0.1, -h + 2, 0, -h + 2)
        break
      case 'sharp':
        ctx.lineTo(-w * 0.25, -h - finH + sway)
        ctx.lineTo(w * 0.05, -h + 2)
        break
      case 'round':
        ctx.quadraticCurveTo(-w * 0.2, -h - finH * 1.2 + sway, w * 0.1, -h + 2)
        break
    }

    const finGrad = ctx.createLinearGradient(0, -h + 2, 0, -h - finH)
    finGrad.addColorStop(0, hsl({ ...this.primaryColor, l: this.primaryColor.l + 12 }, 0.6))
    finGrad.addColorStop(1, hsl({ ...this.primaryColor, l: this.primaryColor.l + 20 }, 0.1))
    ctx.fillStyle = finGrad
    ctx.fill()
    ctx.restore()
  }

  private drawPectoralFins(ctx: CanvasRenderingContext2D, bend: number, speed: number, isBack: boolean) {
    const w = this.bodyLength
    const h = w * this.bodyWidth
    const finW = w * 0.18 * this.finSize

    const flapFreq = 1.0 + speed * 0.8
    const baseFlap = Math.sin(this.animTime * flapFreq + (isBack ? Math.PI : 0)) * (0.15 + speed * 0.08)
    const turnBias = this.vy * 0.015

    const sinYaw = Math.sin(this.yaw)
    const turnFactor = Math.abs(sinYaw)
    const finDepthScale = isBack ? Math.max(0.3, 1 - turnFactor * 0.6) : Math.min(1.3, 1 + turnFactor * 0.3)
    const finAlpha = isBack ? Math.max(0.15, 0.3 - turnFactor * 0.2) : Math.min(0.7, 0.5 + turnFactor * 0.2)

    ctx.save()
    const t = 0.7
    const finY = this.getSpineOffset(t, 0, 0, bend)

    if (isBack) {
      ctx.translate(-w * 0.5 + t * w, finY - h * 0.1)
      ctx.scale(0.8 * finDepthScale, 0.8 * finDepthScale)
    } else {
      ctx.translate(-w * 0.5 + t * w, finY + h * 0.25)
      ctx.scale(finDepthScale, finDepthScale)
    }
    ctx.rotate(Math.PI + 0.2 + baseFlap + turnBias)

    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.quadraticCurveTo(finW * 0.5, finW * 0.4, finW, 0)
    ctx.quadraticCurveTo(finW * 0.5, -finW * 0.2, 0, 0)

    ctx.fillStyle = hsl({ ...this.secondaryColor, l: this.secondaryColor.l + (isBack ? -10 : 10) }, finAlpha)
    ctx.fill()
    ctx.restore()
  }
}

// ============ 快捷工厂函数 ============

/**
 * 快速创建一组鱼并启动动画循环
 *
 * 用法:
 *   const canvas = document.getElementById('tank') as HTMLCanvasElement
 *   startFishTank(canvas, [
 *     { species: 'xijing' },
 *     { species: 'moyu', primaryColor: { h: 15, s: 75, l: 60 } },
 *     { primaryColor: { h: 180, s: 60, l: 50 }, tailShape: 'forked' },
 *   ])
 */
export function startFishTank(canvas: HTMLCanvasElement, configs: FishConfig[]): { stop: () => void; fishes: FishDrawer[] } {
  const ctx = canvas.getContext('2d')!
  const fishes: FishDrawer[] = []

  for (const config of configs) {
    const fish = new FishDrawer(config)
    fish.setTankSize(canvas.width, canvas.height)
    fish.setPosition(
      100 + Math.random() * (canvas.width - 200),
      100 + Math.random() * (canvas.height - 200),
      0.4 + Math.random() * 0.4
    )
    fishes.push(fish)
  }

  let lastTime = performance.now()
  let running = true

  function loop() {
    if (!running) return
    const now = performance.now()
    const dt = Math.min((now - lastTime) / 1000, 0.1)
    lastTime = now

    ctx.clearRect(0, 0, canvas.width, canvas.height)

    // 按深度排序
    fishes.sort((a, b) => a.z - b.z)

    for (const fish of fishes) {
      fish.setTankSize(canvas.width, canvas.height)
      fish.update(dt)
      fish.draw(ctx)
    }

    requestAnimationFrame(loop)
  }

  requestAnimationFrame(loop)

  return {
    stop: () => { running = false },
    fishes,
  }
}
