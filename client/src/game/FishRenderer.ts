import type { Fish } from './types'

function hsl(color: { h: number; s: number; l: number }, alpha = 1): string {
  return `hsla(${color.h}, ${color.s}%, ${color.l}%, ${alpha})`
}

interface TrailPoint { x: number; y: number; age: number }

export class FishRenderer {
  private trails = new Map<string, TrailPoint[]>()

  draw(ctx: CanvasRenderingContext2D, fish: Fish, dt: number) {
    this.updateFacing(fish, dt)
    this.updateMouth(fish, dt)
    this.updateTrail(fish, dt)
    
    // Accumulate wave phase using dt to avoid teleporting/jitter when speed changes
    const speed = Math.sqrt(fish.vx * fish.vx + fish.vy * fish.vy)
    const waveFreq = 1.0 + speed * 0.03
    ;(fish as any)._accumulatedWavePhase = ((fish as any)._accumulatedWavePhase || 0) + waveFreq * 3 * dt

    this.drawDepthShadow(ctx, fish)
    this.drawTrail(ctx, fish)
    this.drawFish(ctx, fish)
    this.drawEmotionEffects(ctx, fish)
    this.drawHealthBar(ctx, fish)
    this.drawNameTag(ctx, fish)
    this.drawBubble(ctx, fish)
  }

  drawPhysicalBubbles(ctx: CanvasRenderingContext2D, bubbles: import('./types').PhysicalBubble[] | undefined) {
    if (!bubbles) return
    ctx.save()
    bubbles.forEach(b => {
      const alpha = Math.min(1, (b.maxLife - b.life) * 2)
      ctx.beginPath()
      ctx.arc(b.x, b.y, b.size, 0, Math.PI * 2)
      ctx.fillStyle = `rgba(255, 255, 255, ${alpha * 0.4})`
      ctx.fill()
      ctx.strokeStyle = `rgba(255, 255, 255, ${alpha * 0.8})`
      ctx.lineWidth = 0.5
      ctx.stroke()
      
      // Specular highlight on bubble
      ctx.beginPath()
      ctx.arc(b.x - b.size * 0.3, b.y - b.size * 0.3, b.size * 0.2, 0, Math.PI * 2)
      ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`
      ctx.fill()
    })
    ctx.restore()
  }

  private drawDepthShadow(ctx: CanvasRenderingContext2D, fish: Fish) {
    const z = fish.z ?? 0.5
    const app = fish.appearance

    // z=1 (near glass): shadow directly below, large, opaque
    // z=0 (far back wall): shadow offset, smaller, very faint
    const shadowY = fish.y + app.bodyLength * (0.7 + (1 - z) * 0.8)
    const shadowX = fish.x + (1 - z) * 10
    const shadowW = app.bodyLength * (0.4 + z * 0.4)
    const shadowH = shadowW * 0.2
    const shadowAlpha = 0.04 + z * 0.16

    ctx.save()
    ctx.globalAlpha = shadowAlpha
    ctx.beginPath()
    ctx.ellipse(shadowX, shadowY, shadowW, shadowH, 0, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(0, 10, 20, 1)'
    ctx.fill()
    ctx.restore()
  }

  drawRelationships(ctx: CanvasRenderingContext2D, fishes: Fish[]) {
    // Draw fight effects first (behind relationship indicators)
    for (const fish of fishes) {
      if (fish.currentAction !== 'fight' || !fish.actionTarget) continue
      const opponent = fishes.find(f => f.id === fish.actionTarget)
      if (!opponent) continue
      if (fish.id > opponent.id) continue // avoid drawing twice

      const midX = (fish.x + opponent.x) / 2
      const midY = (fish.y + opponent.y) / 2
      const dist = Math.sqrt((fish.x - opponent.x) ** 2 + (fish.y - opponent.y) ** 2)
      const t = performance.now() * 0.001

      // Clash sparks when close
      if (dist < 60) {
        ctx.save()
        ctx.translate(midX, midY)
        const sparkCount = 6
        for (let i = 0; i < sparkCount; i++) {
          const angle = (Math.PI * 2 / sparkCount) * i + t * 8
          const r = 8 + Math.sin(t * 12 + i * 2) * 5
          const sx = Math.cos(angle) * r
          const sy = Math.sin(angle) * r
          ctx.beginPath()
          ctx.moveTo(0, 0)
          ctx.lineTo(sx, sy)
          ctx.strokeStyle = `hsla(${40 + i * 10}, 100%, 70%, ${0.6 + Math.sin(t * 15 + i) * 0.3})`
          ctx.lineWidth = 1.5
          ctx.stroke()
        }
        // Impact flash
        const flashAlpha = 0.3 + Math.sin(t * 20) * 0.2
        ctx.beginPath()
        ctx.arc(0, 0, 12, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(255, 220, 80, ${flashAlpha})`
        ctx.fill()
        ctx.restore()
      }

      // Angry aura lines around fighters
      ctx.save()
      ctx.globalAlpha = 0.5
      const auraSize = 15
      // Fish A
      for (let i = 0; i < 3; i++) {
        const angle = t * 4 + i * (Math.PI * 2 / 3)
        const ax = fish.x + Math.cos(angle) * auraSize
        const ay = fish.y + Math.sin(angle) * auraSize
        ctx.beginPath()
        ctx.moveTo(ax, ay)
        ctx.lineTo(ax + Math.cos(angle) * 5, ay + Math.sin(angle) * 5)
        ctx.strokeStyle = 'rgba(255, 80, 80, 0.7)'
        ctx.lineWidth = 2
        ctx.lineCap = 'round'
        ctx.stroke()
      }
      // Fish B
      for (let i = 0; i < 3; i++) {
        const angle = -t * 4 + i * (Math.PI * 2 / 3)
        const ax = opponent.x + Math.cos(angle) * auraSize
        const ay = opponent.y + Math.sin(angle) * auraSize
        ctx.beginPath()
        ctx.moveTo(ax, ay)
        ctx.lineTo(ax + Math.cos(angle) * 5, ay + Math.sin(angle) * 5)
        ctx.strokeStyle = 'rgba(255, 80, 80, 0.7)'
        ctx.lineWidth = 2
        ctx.lineCap = 'round'
        ctx.stroke()
      }
      ctx.restore()
    }

    for (const fish of fishes) {
      for (const rel of fish.relationships) {
        if (rel.affinity < 15 && rel.affinity > -15) continue
        const other = fishes.find(f => f.id === rel.fishId)
        if (!other) continue
        // Only draw from the fish with the smaller ID to avoid duplicates
        if (fish.id > other.id) continue

        const dist = Math.sqrt((fish.x - other.x) ** 2 + (fish.y - other.y) ** 2)
        if (dist > 200) continue

        const midX = (fish.x + other.x) / 2
        const midY = (fish.y + other.y) / 2

        if (rel.affinity > 15) {
          // Friend indicator: small heart at midpoint
          const alpha = Math.min(0.5, (rel.affinity - 15) / 100) * (1 - dist / 200)
          if (alpha < 0.05) continue
          const pulse = 0.8 + Math.sin(performance.now() * 0.003 + fish.x) * 0.2
          ctx.save()
          ctx.globalAlpha = alpha * pulse
          ctx.translate(midX, midY - 5)
          ctx.scale(0.6, 0.6)
          ctx.beginPath()
          ctx.moveTo(0, 2)
          ctx.bezierCurveTo(-4, -1, -6, -5, 0, -7)
          ctx.bezierCurveTo(6, -5, 4, -1, 0, 2)
          ctx.fillStyle = 'rgba(255, 130, 160, 0.9)'
          ctx.fill()
          ctx.restore()
        } else if (rel.affinity < -15) {
          // Enemy indicator: small lightning at midpoint
          const alpha = Math.min(0.4, (-rel.affinity - 15) / 100) * (1 - dist / 200)
          if (alpha < 0.05) continue
          ctx.save()
          ctx.globalAlpha = alpha
          ctx.translate(midX, midY - 5)
          ctx.beginPath()
          ctx.moveTo(-2, -5)
          ctx.lineTo(1, -1)
          ctx.lineTo(-1, -1)
          ctx.lineTo(2, 5)
          ctx.lineTo(-1, 1)
          ctx.lineTo(1, 1)
          ctx.closePath()
          ctx.fillStyle = 'rgba(255, 200, 50, 0.9)'
          ctx.fill()
          ctx.restore()
        }
      }
    }
  }

  private updateFacing(fish: Fish, dt: number) {
    const cosAngle = Math.cos(fish.angle)
    if (Math.abs(cosAngle) > 0.1) {
      fish.facingDir = cosAngle >= 0 ? 1 : -1
    }

    if (fish.facingTransition === undefined) {
      fish.facingTransition = fish.facingDir
    }

    const diff = fish.facingDir - fish.facingTransition
    if (Math.abs(diff) > 0.01) {
      fish.facingTransition += diff * dt * 10
    } else {
      fish.facingTransition = fish.facingDir
    }

    // Yaw incorporates both left/right facing AND z-axis movement
    // Base yaw: 0 facing right, PI facing left
    let targetYaw = fish.facingDir >= 0 ? 0 : Math.PI

    // vz influence: strong vz overrides yaw to face toward/away from viewer
    // vz>0 = swimming toward screen = yaw goes to PI/2 (face viewer)
    // vz<0 = swimming into screen = yaw goes to -PI/2 (show back)
    const vz = fish.vz || 0
    const vzInfluence = Math.min(1, Math.abs(vz) * 5)
    if (vzInfluence > 0.15) {
      const faceAngle = vz > 0 ? Math.PI / 2 : -Math.PI / 2
      targetYaw = targetYaw * (1 - vzInfluence) + faceAngle * vzInfluence
    }

    if (fish.yaw === undefined) fish.yaw = targetYaw

    // Smooth yaw interpolation — always rotate through the shortest arc
    let yawDiff = targetYaw - fish.yaw
    if (yawDiff > Math.PI) yawDiff -= Math.PI * 2
    if (yawDiff < -Math.PI) yawDiff += Math.PI * 2
    
    // Increased turning speed back up slightly to balance the 3D turn and responsiveness
    fish.yaw += yawDiff * dt * 5.0;

    // --- NEW: Tail Yaw Easing ---
    if ((fish as any).tailYaw === undefined) {
      (fish as any).tailYaw = fish.yaw;
    }
    let tailYawDiff = fish.yaw - (fish as any).tailYaw;
    if (tailYawDiff > Math.PI) tailYawDiff -= Math.PI * 2;
    if (tailYawDiff < -Math.PI) tailYawDiff += Math.PI * 2;
    
    // Tail interpolates towards the body's yaw, creating a realistic 3D drag/lag effect
    (fish as any).tailYaw += tailYawDiff * dt * 2.0;
  }

  private updateMouth(fish: Fish, dt: number) {
    const targetMouth = fish.currentAction === 'eat' ? 0.7 :
      fish.currentAction === 'attack' || fish.currentAction === 'hunt' ? 0.5 :
      Math.sin(fish.animTime * 2.5) * 0.12 + 0.12
    fish.mouthOpen += (targetMouth - fish.mouthOpen) * dt * 6
  }

  private updateTrail(fish: Fish, dt: number) {
    const speed = Math.sqrt(fish.vx * fish.vx + fish.vy * fish.vy)
    let trail = this.trails.get(fish.id)
    if (!trail) {
      trail = []
      this.trails.set(fish.id, trail)
    }

    // Only emit trail when moving fast
    if (speed > 2.5) {
      trail.push({ x: fish.x, y: fish.y, age: 0 })
    }

    // Age and prune
    for (let i = trail.length - 1; i >= 0; i--) {
      trail[i].age += dt
      if (trail[i].age > 0.4) trail.splice(i, 1)
    }

    if (trail.length > 12) trail.splice(0, trail.length - 12)
  }

  private drawTrail(ctx: CanvasRenderingContext2D, fish: Fish) {
    const trail = this.trails.get(fish.id)
    if (!trail || trail.length < 2) return

    const app = fish.appearance
    ctx.save()
    for (let i = 0; i < trail.length; i++) {
      const p = trail[i]
      const alpha = (1 - p.age / 0.4) * 0.2
      const size = (1 - p.age / 0.4) * app.bodyLength * 0.15
      ctx.beginPath()
      ctx.arc(p.x, p.y, size, 0, Math.PI * 2)
      ctx.fillStyle = hsl(app.primaryColor, alpha)
      ctx.fill()
    }
    ctx.restore()
  }

  private getSpineOffset(t: number, wavePhase: number, waveAmp: number, bend: number) {
    // Phase shifts continuously along the body for a fluid S-curve
    const phase = wavePhase - (1 - t) * 3.5
    
    // Amplitude envelope: pivot point around the neck/chest (t=0.75)
    // Head (t > 0.75) moves slightly in opposition to the body to balance the swimming force
    // Tail (t < 0.75) moves with exponentially increasing amplitude
    let envelope = 0
    if (t > 0.75) {
      envelope = (t - 0.75) * 1.2 // Head counter-wag
    } else {
      envelope = Math.pow((0.75 - t) / 0.75, 1.3) * 2.8 // Tail main wag
    }
    
    const wag = Math.sin(phase) * waveAmp * envelope
    const turn = bend * Math.pow(1 - t, 1.5)
    return wag + turn
  }

  private traceDynamicBody(ctx: CanvasRenderingContext2D, app: Fish['appearance'], wavePhase: number, waveAmp: number, bend: number, yaw?: number, speed: number = 0) {
    const w = app.bodyLength
    const h = w * app.bodyWidth
    const headX = w * 0.5
    const tailX = -w * 0.5
    const steps = 24

    // During turns, body appears much thicker (viewing the round cross-section)
    const turnBulge = yaw !== undefined ? (1 - Math.abs(Math.cos(yaw))) * 0.4 : 0

    const getThickness = (t: number) => {
      const baseH = h * 1.5 * (1 + turnBulge)
      switch (app.bodyShape) {
        case 'oval': return Math.sin(t * Math.PI) * baseH * 0.6
        case 'slim': return (Math.sin(t * Math.PI) * 0.6 + Math.sin(t * Math.PI * 0.5) * 0.4) * baseH * 0.5
        case 'round': return Math.sin(Math.pow(t, 0.6) * Math.PI) * baseH * 0.8
        case 'angular': return (t < 0.6 ? (t / 0.6) : (1 - t) / 0.4) * baseH * 0.6
        default: return Math.sin(t * Math.PI) * baseH * 0.6
      }
    }

    // Z-axis sway: traveling sine wave creates a true 3D bending effect
    // We use Math.cos to properly foreshorten the body on BOTH swings
    const getZScale = (t: number) => {
      const localPhase = wavePhase - (1 - t) * 3.5
      const rawWag = Math.sin(localPhase)
      
      let envelope = 0
      if (t > 0.75) {
        envelope = (t - 0.75) * 0.8
      } else {
        envelope = Math.pow((0.75 - t) / 0.75, 1.3)
      }
      
      const wagAngle = rawWag * (0.6 + speed * 0.3) * envelope
      let zScale = Math.cos(wagAngle)
      
      // Fake 2.5D: prevent severe X-foreshortening when swinging outward
      // so the tail end doesn't get fully occluded by the main body.
      if (rawWag > 0) {
        zScale = 1 - (1 - zScale) * 0.15
      }
      return zScale
    }

    const getDynamicThickness = (t: number) => {
      let thickness = getThickness(t)
      
      // Y-axis perspective: body parts bulge slightly when bending towards viewer
      const localPhase = wavePhase - (1 - t) * 3.5
      const rawWag = Math.sin(localPhase)
      const envelope = t > 0.75 ? (t - 0.75) * 0.8 : Math.pow((0.75 - t) / 0.75, 1.3)
      // If rawWag > 0 (swinging towards us), increase thickness up to 15%
      const perspectiveY = 1 + rawWag * envelope * 0.15
      
      return thickness * perspectiveY
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

  private drawFish(ctx: CanvasRenderingContext2D, fish: Fish) {
    const { x, y, appearance: app, animTime, personality, z } = fish
    const speed = Math.sqrt(fish.vx * fish.vx + fish.vy * fish.vy)
    const isTough = fish.skills?.includes('Tough' as any)
    const isDead = (fish as any).state === 'dead' || (fish as any).hp <= 0

    ctx.save()
    ctx.translate(x, y)

    // Depth effect — z=0 far (small, dim, blue), z=1 near (big, bright)
    const zVal = z ?? 0.5
    const zScale = 0.45 + zVal * 0.7
    const depthAlpha = 0.45 + zVal * 0.55
    ctx.globalAlpha = depthAlpha
    ctx.scale(zScale, zScale)

    if (zVal < 0.5) {
      (fish as any)._depthBlue = (0.5 - zVal) / 0.5
    } else {
      (fish as any)._depthBlue = 0
    }

    // Pet effect
    if (fish.petEffect > 0) {
      const wiggle = Math.sin(animTime * 12) * fish.petEffect * 3
      ctx.translate(0, wiggle)
      ctx.shadowColor = `hsla(${app.primaryColor.h}, 80%, 70%, ${fish.petEffect * 0.6})`
      ctx.shadowBlur = 15 * fish.petEffect
    }

    // Hit flash
    if (fish.hitFlash > 0) {
      const shake = Math.sin(animTime * 50) * fish.hitFlash * 3
      ctx.translate(shake, shake * 0.5)
    }

    // Swimming direction tilt: nose tilts up/down based on vertical velocity
    const swimSpeed = Math.sqrt(fish.vx * fish.vx + fish.vy * fish.vy)
    let swimPitch = 0
    if (swimSpeed > 0.2) {
      swimPitch = Math.atan2(fish.vy, Math.abs(fish.vx))
    }
    const clampedPitch = Math.max(-Math.PI / 4, Math.min(Math.PI / 4, swimPitch))
    ctx.rotate(clampedPitch * 0.6)

    // 2.5D yaw-based perspective
    const yaw = fish.yaw ?? 0
    const cosYaw = Math.cos(yaw)
    const sinYaw = Math.sin(yaw)
    const absCosFacing = Math.abs(cosYaw) // 1=pure side view, 0=pure front/back view

    // Allow smooth transition through 0 for a true 3D turn without "snapping"
    let xScale = cosYaw
    if (Math.abs(xScale) < 0.01) xScale = Math.sign(xScale) * 0.01 || 0.01
    
    // Body appears taller (thicker) when foreshortened — we're seeing the round cross-section
    const yBulge = 1 + (1 - absCosFacing) * 0.2

    ctx.scale(xScale, yBulge)

    // Remove the early return so the fish doesn't vanish when facing us!
    // We want to render the front/back face instead.

    const nervousness = personality.cowardice * 0.5 + (1 - personality.aggression) * 0.2
    const energy = personality.aggression * 0.3 + personality.curiosity * 0.3 + 0.4

    // Flee: rapid tremor
    if (fish.currentAction === 'flee') {
      const tremor = Math.sin(animTime * 25) * 0.8 * nervousness
      ctx.translate(tremor, tremor * 0.5)
    }

    // Charge lean forward (hunt/attack)
    if (fish.chargeAmount > 0) {
      ctx.rotate(-fish.chargeAmount * 0.08)
    }

    // Breathing
    const breatheRate = 1.2 + nervousness * 0.8
    const breatheAmp = 0.008 + nervousness * 0.005
    const breathe = 1 + Math.sin(animTime * breatheRate) * breatheAmp
    ctx.scale(breathe, breathe)

    // Speed stretch
    const stretch = 1 + speed * 0.01 + fish.chargeAmount * 0.04
    const squishY = 1 / Math.sqrt(stretch)
    ctx.scale(stretch, squishY)

    if (fish.hidden.level >= 10) {
      ctx.shadowColor = hsl(app.primaryColor, 0.4)
      ctx.shadowBlur = 8 + Math.sin(animTime * 2) * 3
    }

    // Note: To avoid jittering from sudden speed changes,
    // we use the dynamically accumulated phase computed in the draw method.
    const bodyWavePhase = (fish as any)._accumulatedWavePhase || 0

    const waveAmp = 0.35 + speed * 0.015 // Further increased base amplitude for more distinct bending

    const maxBend = app.bodyLength * 0.35
    let bend = fish.angularVelocity * fish.facingDir * 3
    bend = Math.max(-maxBend, Math.min(maxBend, bend))

    // Note: We draw back fins first for better layering
    this.drawTail(ctx, fish, bodyWavePhase, waveAmp, energy, bend)
    this.drawDorsalFin(ctx, fish, bodyWavePhase, waveAmp, energy, bend)
    this.drawPectoralFins(ctx, fish, energy, bend, true) // Back fin

    this.drawBody(ctx, app, bodyWavePhase, waveAmp, bend, fish)
    this.drawScales(ctx, app, bodyWavePhase, waveAmp, bend, fish)
    this.drawPattern(ctx, app, bodyWavePhase, waveAmp, bend, fish)
    
    this.drawPectoralFins(ctx, fish, energy, bend, false) // Front fin
    this.drawEye(ctx, app, fish, bodyWavePhase, waveAmp, bend)
    this.drawMouth(ctx, app, fish, bodyWavePhase, waveAmp, bend)
    this.drawSpeciesAccessory(ctx, fish, bodyWavePhase, waveAmp, bend)

    if (fish.hidden.level >= 15) {
      this.drawSparkles(ctx, fish)
    }

    // The "red ball" was caused by trying to draw a forced round cross-section
    // when the fish turned, which clashed with the new U-Turn body bending system.
    // The fish will now rely entirely on the U-Turn bend for its 3D volume during turns.

    // Hit flash overlay
    if (fish.hitFlash > 0) {
      ctx.globalCompositeOperation = 'source-atop'
      ctx.fillStyle = `rgba(255, 50, 50, ${fish.hitFlash * 0.4})`
      ctx.fillRect(-app.bodyLength * 2, -app.bodyLength * 2, app.bodyLength * 4, app.bodyLength * 4)
    }

    // Depth blue tint for far-away fish
    const depthBlue = (fish as any)._depthBlue || 0
    if (depthBlue > 0) {
      ctx.globalCompositeOperation = 'source-atop'
      ctx.fillStyle = `rgba(20, 60, 100, ${depthBlue * 0.35})`
      ctx.fillRect(-app.bodyLength * 2, -app.bodyLength * 2, app.bodyLength * 4, app.bodyLength * 4)
    }

    ctx.restore()
  }

  private drawBody(ctx: CanvasRenderingContext2D, app: Fish['appearance'], wavePhase: number, waveAmp: number, bend: number, fish: Fish) {
    const w = app.bodyLength
    const h = w * app.bodyWidth
    const yaw = fish.yaw ?? 0
    const speed = Math.sqrt(fish.vx * fish.vx + fish.vy * fish.vy)

    // Glow Skill: Bioluminescent Aura
    if (fish.skills?.includes('glow')) {
      ctx.shadowColor = hsl(app.primaryColor, 1)
      ctx.shadowBlur = 20
    } else {
      ctx.shadowColor = 'rgba(0,0,0,0)'
      ctx.shadowBlur = 0
    }

    // Glassmorphism base
    this.traceDynamicBody(ctx, app, wavePhase, waveAmp, bend, yaw, speed)

    const isTough = fish.skills?.includes('tough')
    const isDead = fish.isDead

    let pColor = isTough
      ? { h: 200, s: Math.min(app.primaryColor.s, 20), l: Math.min(app.primaryColor.l + 20, 90) }
      : app.primaryColor
    let sColor = isTough
      ? { h: 200, s: Math.min(app.secondaryColor.s, 20), l: Math.min(app.secondaryColor.l + 20, 90) }
      : app.secondaryColor

    // Darken slightly when foreshortened (turning toward/away from viewer)
    const turnAmount = 1 - Math.abs(Math.cos(yaw))
    const turnDarken = turnAmount * 8
    pColor = { ...pColor, l: Math.max(10, pColor.l - turnDarken) }
    sColor = { ...sColor, l: Math.max(10, sColor.l - turnDarken) }

    // Grayscale if dead
    if (isDead) {
      pColor = { ...pColor, s: 0, l: Math.max(20, pColor.l - 20) }
      sColor = { ...sColor, s: 0, l: Math.max(20, sColor.l - 20) }
    }

    const grad = ctx.createLinearGradient(0, -h * 1.5, 0, h * 1.5)
    grad.addColorStop(0, hsl({ ...pColor, l: pColor.l + 15 }, 0.9))
    grad.addColorStop(0.4, hsl(pColor, 0.85))
    grad.addColorStop(1, hsl({ ...sColor, l: sColor.l - 10 }, 0.8))
    ctx.fillStyle = grad
    ctx.fill()

    ctx.save()
    this.traceDynamicBody(ctx, app, wavePhase, waveAmp, bend, yaw, speed)
    ctx.clip()

    // 2.5D shading — highlight and shadow shift with yaw
    const sinY = Math.sin(yaw)
    const highlightShift = sinY * w * 0.15 // highlight moves to the lit side

    // Top specular highlight — shifts with yaw for 3D roundness
    const midY = this.getSpineOffset(0.7, wavePhase, waveAmp, bend)
    const gel = ctx.createRadialGradient(
      highlightShift, midY - h * 0.5, 0,
      highlightShift, midY - h * 0.3, w * 0.6
    )
    gel.addColorStop(0, 'rgba(255,255,255,0.55)')
    gel.addColorStop(0.4, 'rgba(255,255,255,0.2)')
    gel.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = gel
    ctx.beginPath()
    ctx.ellipse(highlightShift, midY - h * 0.4, w * 0.6, h * 0.7, 0, 0, Math.PI * 2)
    ctx.fill()

    // Belly shadow — dark gradient at the bottom gives 3D volume
    // Removed the stark drop shadow outside the body; keeping only internal volume shading

    // Shadow side — opposite to highlight, simulates cylindrical form with yaw
    // (Kept internal volume shadow, but no external projection)

    // Rim light on the highlight edge — stronger during turn
    const rimX = highlightShift * 1.5
    ctx.beginPath()
    ctx.ellipse(rimX, midY - h * 0.6, w * 0.3, h * 0.15, 0, 0, Math.PI * 2)
    ctx.fillStyle = `rgba(255, 255, 255, ${0.08 + Math.abs(sinY) * 0.12})`
    ctx.fill()

    // Body contour line — a curved line along the body that shifts with yaw
    // This is the key 3D cue: it shows the body is a cylinder, not a flat plane
    const contourStrength = Math.abs(sinY)
    if (contourStrength > 0.1) {
      const contourY = sinY * h * 0.6 // shifts up/down based on viewing angle
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

      // Secondary contour (belly edge) on the opposite side
      ctx.beginPath()
      for (let i = 0; i <= 16; i++) {
        const t = i / 16
        const cx = -w * 0.4 + t * w * 0.8
        const spineOff = this.getSpineOffset(t, wavePhase, waveAmp, bend)
        const thickness = Math.sin(t * Math.PI) * h * 1.2
        const cy = spineOff + thickness * 0.7 * (sinY > 0 ? -1 : 1)
        if (i === 0) ctx.moveTo(cx, cy)
        else ctx.lineTo(cx, cy)
      }
      ctx.strokeStyle = `rgba(0, 15, 30, ${contourStrength * 0.12})`
      ctx.lineWidth = 0.8
      ctx.stroke()
    }

    ctx.restore()
  }

  private drawScales(ctx: CanvasRenderingContext2D, app: Fish['appearance'], wavePhase: number, waveAmp: number, bend: number, fish: Fish) {
    const w = app.bodyLength
    const h = w * app.bodyWidth
    const yaw = fish.yaw ?? 0
    const speed = Math.sqrt(fish.vx * fish.vx + fish.vy * fish.vy)

    ctx.save()
    this.traceDynamicBody(ctx, app, wavePhase, waveAmp, bend, yaw, speed)
    ctx.clip()

    ctx.globalCompositeOperation = 'overlay'
    const scaleColor = 'rgba(255, 255, 255, 0.3)'

    const positions = [0.4, 0.55, 0.7]
    for (let i = 0; i < positions.length; i++) {
      const t = positions[i]
      const x = -w * 0.5 + t * w
      const y = this.getSpineOffset(t, wavePhase, waveAmp, bend) - h * 0.2
      const r = h * 0.35

      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.fillStyle = scaleColor
      ctx.fill()
    }
    ctx.restore()
  }

  private drawPattern(ctx: CanvasRenderingContext2D, app: Fish['appearance'], wavePhase: number, waveAmp: number, bend: number, fish: Fish) {
    const w = app.bodyLength
    const h = w * app.bodyWidth
    const yaw = fish.yaw ?? 0
    const speed = Math.sqrt(fish.vx * fish.vx + fish.vy * fish.vy)

    if (app.pattern === 'none') return

    ctx.save()
    this.traceDynamicBody(ctx, app, wavePhase, waveAmp, bend, yaw, speed)
    ctx.clip()

    switch (app.pattern) {
      case 'stripes':
        ctx.globalCompositeOperation = 'overlay'
        for (let i = 0; i < app.patternDensity; i++) {
          const t = 0.3 + 0.5 * ((i + 0.5) / app.patternDensity)
          const xPos = -w * 0.5 + t * w
          const yPos = this.getSpineOffset(t, wavePhase, waveAmp, bend)
          const stripeW = Math.max(3, w * 0.08)
          ctx.beginPath()
          ctx.ellipse(xPos, yPos, stripeW, h * 0.9, 0.08, 0, Math.PI * 2)
          ctx.fillStyle = 'rgba(255, 255, 255, 0.2)'
          ctx.fill()
        }
        break
      case 'spots':
        ctx.globalCompositeOperation = 'overlay'
        for (let i = 0; i < app.patternDensity * 2; i++) {
          const t = 0.3 + 0.5 * (i / (app.patternDensity * 2))
          const sx = -w * 0.5 + t * w + Math.sin(i * 2.5 + 0.3) * w * 0.1
          const sy = this.getSpineOffset(t, wavePhase, waveAmp, bend) + Math.cos(i * 1.7 + 0.5) * h * 0.5
          const r = 3 + Math.abs(Math.sin(i * 5)) * 2
          ctx.beginPath()
          ctx.arc(sx, sy, r, 0, Math.PI * 2)
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

  private drawTail(ctx: CanvasRenderingContext2D, fish: Fish, wavePhase: number, waveAmp: number, energy: number, bend: number) {
    const app = fish.appearance
    const w = app.bodyLength
    const speed = Math.sqrt(fish.vx * fish.vx + fish.vy * fish.vy)
    const isFan = app.tailShape === 'fan'

    const baseAmp = 1.5 + energy * 0.5
    const speedAmp = speed * 1.5
    const amp = baseAmp + speedAmp

    const tailPhase = wavePhase - 1.8
    const tailSwing = Math.sin(tailPhase) * amp * 0.25

    ctx.save()
    const t = 0 // tail end of spine
    
    // We must calculate the exact same Z-scale that the body uses at t=0
    // so the tail anchor point scales exactly with the body.
    const bodyPhaseForTail = wavePhase - 3.5
    const bodyWagForTail = Math.sin(bodyPhaseForTail)
    const envelopeForTail = Math.pow(0.75 / 0.75, 1.3) // t=0 -> 1.0
    const wagAngleForTail = bodyWagForTail * (0.6 + speed * 0.3) * envelopeForTail
    let tailAnchorZScale = Math.cos(wagAngleForTail)
    if (bodyWagForTail > 0) {
      tailAnchorZScale = 1 - (1 - tailAnchorZScale) * 0.15
    }

    // Now compute the exact pixel coordinates of the tail anchor
    // This calculation MUST perfectly match the tail tip of the body drawn in traceDynamicBody
    const tailY = this.getSpineOffset(t, wavePhase, waveAmp, bend)
    
    // Account for U-Turn bend in the tail anchor as well!
    // The anchor uses the body's yaw, but the rest of the tail uses tailYaw
    const bodyYaw = fish.yaw ?? 0
    const sinBodyYaw = Math.sin(bodyYaw)
    const uTurnBend = Math.abs(sinBodyYaw) * bend * 0.5
    
    const headX = w * 0.5
    const baseTailX = -w * 0.5
    const anchorBaseX = baseTailX + t * (headX - baseTailX) - uTurnBend * (1 - Math.abs(t - 0.5) * 2)

    // In traceDynamicBody at t=0:
    // x = anchorBaseX * zs
    const tailX = anchorBaseX * tailAnchorZScale 
    
    ctx.translate(tailX, tailY)
    
    // Evaluate the tip's swing angle to determine depth and lighting
    const tipPhase = tailPhase - 1.5
    const rawTipWag = Math.sin(tipPhase)
    const tipWag = rawTipWag * (1 + 0.3 * rawTipWag)
    const zDepth = tipWag 

    // Adjust tail length scale to make it elegant but not overly massive
    let baseTailLen = 26
    if (app.tailShape === 'fan') baseTailLen = w * 0.8 
    else if (app.tailShape === 'forked') baseTailLen = w * 0.75
    else if (app.tailShape === 'pointed') baseTailLen = w * 0.55

    const tailLen = baseTailLen
    const phaseDiv = isFan ? tailLen * 0.6 : 20

    // Retrieve the smoothed tailYaw for 3D rotation delay
    const tailYaw = (fish as any).tailYaw ?? bodyYaw
    const cosTailYaw = Math.cos(tailYaw)
    const sinTailYaw = Math.sin(tailYaw)

    // Calculate the inverse scale of the canvas context to perfectly preserve tail volume
    let bodyXScale = Math.cos(bodyYaw)
    if (Math.abs(bodyXScale) < 0.01) bodyXScale = Math.sign(bodyXScale) * 0.01 || 0.01
    const invBodyScale = 1 / bodyXScale

    const tx = (d: number, phaseOffset: number = 0) => {
      // Calculate how far the tail segment is from the anchor
      const localPhase = tailPhase - (d / phaseDiv) * 1.5 + phaseOffset
      const rawWag = Math.sin(localPhase)
      const wag = rawWag * (1 + 0.3 * rawWag)
      const wagAngle = wag * (0.8 + speed * 0.4)
      
      let wagZScale = Math.cos(wagAngle)
      if (wag > 0) wagZScale = 1 - (1 - wagZScale) * 0.15
      
      // 1. Natural 3D projection of the straight tail length
      const projectedLengthX = -d * wagZScale * cosTailYaw
      
      // 2. Physical C-shape curl to give volume during turns.
      // This wraps the tail inward towards the body (positive X direction)
      const curlAmount = Math.abs(sinTailYaw) * d * (isFan ? 0.6 : 0.4)
      
      // 3. Directional sway for organic asymmetry
      const directionalCurl = -sinTailYaw * (isFan ? w * 0.1 : w * 0.05) * Math.pow(d / tailLen, 1.5)

      // Total desired world X coordinate relative to anchor
      const worldX = projectedLengthX + curlAmount + directionalCurl
      
      // Undo the canvas's global body scaling so the tail retains its true 3D shape
      return worldX * invBodyScale
    }

    const ty = (d: number, baseY: number, phaseOffset: number = 0) => {
      const localPhase = tailPhase - (d / phaseDiv) * 1.5 + phaseOffset
      const ripple = Math.sin(localPhase) * amp * (d / tailLen) * (isFan ? 8 : 3)
      const baseSwing = tailSwing * Math.min(1, d / 20)
      
      // Y-axis perspective curl
      const turnCurlY = sinTailYaw * (isFan ? w * 0.15 : w * 0.08) * Math.pow(d / tailLen, 1.5)

      return baseY + ripple + baseSwing + turnCurlY
    }

    const levelBonus = fish.hidden?.level ? Math.min(fish.hidden.level * 0.05, 1.0) : 0
    const tailScale = 1 + levelBonus * 0.5
    const perspectiveY = 1 + zDepth * 0.35

    ctx.scale(tailScale, tailScale * perspectiveY)

    // Dynamic lighting based on depth
    const lightMod = zDepth > 0 ? zDepth * 15 : zDepth * 10 
    const alphaMod = zDepth > 0 ? zDepth * 0.15 : zDepth * 0.05
    
    // Glassy flowing tail gradient
    const tailGrad = ctx.createLinearGradient(tx(0), 0, tx(tailLen), 0)
    const baseColor = app.primaryColor
    tailGrad.addColorStop(0, hsl({ ...baseColor, l: baseColor.l + lightMod }, 0.85 + alphaMod))
    if (isFan) {
      tailGrad.addColorStop(0.4, hsl({ ...baseColor, l: baseColor.l + 15 + lightMod }, 0.6 + alphaMod))
      // The sheer edge is very milky and translucent, almost white/pinkish
      tailGrad.addColorStop(1, hsl({ ...baseColor, h: baseColor.h, s: baseColor.s * 0.4, l: 92 + lightMod }, 0.15 + alphaMod))
    } else {
      tailGrad.addColorStop(1, hsl({ ...baseColor, l: baseColor.l + 12 + lightMod, s: baseColor.s - 10 }, 0.1 + alphaMod))
    }

    // 1. Draw multi-layered folds for fan tail (creates 3D volume/skirt effect)
    let r1 = 0.5, r2 = 0.5, r3 = 0.5, r4 = 0.5
    if (isFan) {
      // Generate a stable pseudo-random number based on fish ID
      let hash = 0
      for (let i = 0; i < fish.id.length; i++) {
        hash = ((hash << 5) - hash) + fish.id.charCodeAt(i)
        hash |= 0
      }
      r1 = Math.abs(hash % 100) / 100
      r2 = Math.abs((hash * 7) % 100) / 100
      r3 = Math.abs((hash * 13) % 100) / 100
      r4 = Math.abs((hash * 17) % 100) / 100

      // We will draw 3 layers in total. We already draw the main one later.
      // Here we draw the 2 background layers with different phase offsets to simulate folds.
      const layers = [
        { 
          pOff: 0.15 + r1 * 0.05, 
          alphaMult: 0.5 + r2 * 0.2, 
          widthMod: 0.9 + r3 * 0.5, 
          lenMod: 0.7 + r4 * 0.3,
          asymTop: 1.0 + (r1 - 0.5) * 0.4, // Make top larger or smaller
          asymBot: 1.0 - (r1 - 0.5) * 0.4  // Inverse for bottom
        },
        { 
          pOff: 0.08 + r2 * 0.04, 
          alphaMult: 0.7 + r3 * 0.2, 
          widthMod: 0.8 + r4 * 0.4, 
          lenMod: 0.8 + r1 * 0.2,
          asymTop: 1.0 + (r3 - 0.5) * 0.4,
          asymBot: 1.0 - (r3 - 0.5) * 0.4
        }
      ]

      for (const layer of layers) {
        ctx.beginPath()
        const l3 = tailLen * layer.lenMod
        const l1 = w * 0.5 * layer.lenMod
        const l2 = w * 0.9 * layer.lenMod
        const pOff = layer.pOff
        
        const topY1 = -w * 0.7 * layer.widthMod * layer.asymTop
        const topY2 = -w * 0.9 * layer.widthMod * layer.asymTop
        const topY3 = -w * 0.6 * layer.widthMod * layer.asymTop
        
        const botY1 = w * 0.7 * layer.widthMod * layer.asymBot
        const botY2 = w * 0.9 * layer.widthMod * layer.asymBot
        const botY3 = w * 0.6 * layer.widthMod * layer.asymBot

        ctx.moveTo(tx(0, pOff), 0)
        // Upper sweeping lobe
        ctx.bezierCurveTo(
          tx(l1, pOff), ty(l1, topY1, pOff), 
          tx(l2, pOff), ty(l2, topY2, pOff), 
          tx(l3, pOff), ty(l3, topY3, pOff)
        )
        // Trailing wavy edge
        ctx.bezierCurveTo(
          tx(l3 * 0.8, pOff), ty(l3 * 0.8, topY3 * 0.2, pOff), 
          tx(l3 * 1.1, pOff), ty(l3 * 1.1, botY3 * 0.2, pOff), 
          tx(l3 * 0.85, pOff), ty(l3 * 0.85, botY3, pOff)
        )
        // Lower sweeping lobe
        ctx.bezierCurveTo(
          tx(l2, pOff), ty(l2, botY2, pOff), 
          tx(l1, pOff), ty(l1, botY1, pOff), 
          tx(0, pOff), 0
        )
        
        // Create a slightly darker, more transparent gradient for background layers
        const layerGrad = ctx.createLinearGradient(tx(0), 0, tx(tailLen), 0)
        layerGrad.addColorStop(0, hsl({ ...baseColor, l: baseColor.l + lightMod - 5 }, (0.85 + alphaMod) * layer.alphaMult))
        layerGrad.addColorStop(0.4, hsl({ ...baseColor, l: baseColor.l + 10 + lightMod }, (0.6 + alphaMod) * layer.alphaMult))
        layerGrad.addColorStop(1, hsl({ ...baseColor, h: baseColor.h, s: baseColor.s * 0.4, l: 85 + lightMod }, (0.15 + alphaMod) * layer.alphaMult))
        
        ctx.fillStyle = layerGrad
        ctx.fill()
      }
    }

    // 2. Draw main tail body
    ctx.beginPath()
    
    // We already moved to (tailX, tailY), and scaling applies from there.
    // The base of the tail is at (0,0) in the current local coordinate system.
    
    switch (app.tailShape) {
      case 'forked': {
        const l = tailLen
        ctx.moveTo(tx(0), 0)
        // Upper fork
        ctx.bezierCurveTo(tx(l*0.3), ty(l*0.3, -w*0.3), tx(l*0.6), ty(l*0.6, -w*0.6), tx(l), ty(l, -w*0.8))
        // Inner notch
        ctx.bezierCurveTo(tx(l*0.8), ty(l*0.8, -w*0.4), tx(l*0.6), ty(l*0.6, 0), tx(l*0.4), ty(l*0.4, 0))
        ctx.bezierCurveTo(tx(l*0.6), ty(l*0.6, 0), tx(l*0.8), ty(l*0.8, w*0.4), tx(l), ty(l, w*0.8))
        // Lower fork
        ctx.bezierCurveTo(tx(l*0.6), ty(l*0.6, w*0.6), tx(l*0.3), ty(l*0.3, w*0.3), tx(0), 0)
        break
      }
      case 'fan': {
        const mainAsymTop = 1.0 + (r2 - 0.5) * 0.3
        const mainAsymBot = 1.0 - (r2 - 0.5) * 0.3
        
        const l1 = w * 0.5, l2 = w * 0.9, l3 = tailLen
        
        const topY1 = -w * 0.7 * mainAsymTop
        const topY2 = -w * 0.9 * mainAsymTop
        const topY3 = -w * 0.6 * mainAsymTop
        
        const botY1 = w * 0.7 * mainAsymBot
        const botY2 = w * 0.9 * mainAsymBot
        const botY3 = w * 0.6 * mainAsymBot

        ctx.moveTo(tx(0), 0)
        // Upper sweeping lobe
        ctx.bezierCurveTo(
          tx(l1), ty(l1, topY1), 
          tx(l2), ty(l2, topY2), 
          tx(l3), ty(l3, topY3)
        )
        // Trailing wavy edge
        ctx.bezierCurveTo(
          tx(l3 * 0.8), ty(l3 * 0.8, topY3 * 0.2), 
          tx(l3 * 1.1), ty(l3 * 1.1, botY3 * 0.2), 
          tx(l3 * 0.85), ty(l3 * 0.85, botY3)
        )
        // Lower sweeping lobe
        ctx.bezierCurveTo(
          tx(l2), ty(l2, botY2), 
          tx(l1), ty(l1, botY1), 
          tx(0), 0
        )
        break
      }
      case 'pointed': {
        const l = tailLen
        ctx.moveTo(tx(0), 0)
        ctx.bezierCurveTo(tx(l*0.3), ty(l*0.3, -w*0.4), tx(l*0.6), ty(l*0.6, -w*0.2), tx(l), ty(l, 0))
        ctx.bezierCurveTo(tx(l*0.6), ty(l*0.6, w*0.2), tx(l*0.3), ty(l*0.3, w*0.4), tx(0), 0)
        break
      }
    }
    
    ctx.fillStyle = tailGrad
    ctx.fill()

    // 3. Add delicate fin rays (spines) to the tail for realism
    ctx.save()
    ctx.clip() 
    ctx.lineWidth = isFan ? 0.8 : 0.5
    
    // Rays have a bright center and soft edges
    ctx.strokeStyle = `rgba(255, 255, 255, ${isFan ? 0.25 + alphaMod : 0.15 + alphaMod * 0.5})`
    
    const rayCount = isFan ? 16 : (app.tailShape === 'forked' ? 6 : 4)
    for (let i = 0; i <= rayCount; i++) {
      const t2 = i / rayCount
      const angle = -0.5 + t2 
      
      ctx.beginPath()
      ctx.moveTo(tx(0), 0)
      
      const rLen = isFan ? tailLen * (0.85 + Math.sin(t2 * Math.PI) * 0.15) : tailLen
      // Adapt ray angles to the asymmetry of the tail
      const asymMult = isFan ? (angle < 0 ? (1.0 + (r2 - 0.5) * 0.3) : (1.0 - (r2 - 0.5) * 0.3)) : 1
      const angleSpread = angle * (isFan ? w * 1.8 * asymMult : 15)
      const endSpread = angle * (isFan ? w * 2.5 * asymMult : 30)

      const cp1x = tx(rLen * 0.4)
      const cp1y = ty(rLen * 0.4, angleSpread)
      
      const endX = tx(rLen)
      const endY = ty(rLen, endSpread)
      
      ctx.quadraticCurveTo(cp1x, cp1y, endX, endY)
      ctx.stroke()
      
      // For fan tails, add a subtle secondary branch to the rays
      if (isFan && i % 2 === 0) {
         ctx.beginPath()
         ctx.moveTo(cp1x, cp1y)
         const branchY = endY + (t2 < 0.5 ? -w*0.15*asymMult : w*0.15*asymMult)
         ctx.quadraticCurveTo(tx(rLen * 0.7), ty(rLen * 0.7, (angleSpread + branchY) / 2), tx(rLen * 0.9), ty(rLen * 0.9, branchY))
         ctx.stroke()
      }
    }
    ctx.restore()
    
    ctx.restore()
  }

  private drawDorsalFin(ctx: CanvasRenderingContext2D, fish: Fish, wavePhase: number, waveAmp: number, energy: number, bend: number) {
    const app = fish.appearance
    const w = app.bodyLength
    const h = w * app.bodyWidth
    const speed = Math.sqrt(fish.vx * fish.vx + fish.vy * fish.vy)
    const finH = h * app.finSize * 0.6
    const sway = Math.sin(wavePhase - 0.5) * (0.8 + speed * 0.5) * energy

    ctx.save()
    const t = 0.45 // Move dorsal fin slightly back
    const finX = -w * 0.5 + t * w
    const finY = this.getSpineOffset(t, wavePhase, waveAmp, bend)
    
    ctx.translate(finX, finY)
    
    ctx.beginPath()
    ctx.moveTo(-w * 0.15, -h + 2) // Base front

    switch (app.finShape) {
      case 'flowing':
        ctx.bezierCurveTo(-w * 0.05, -h - finH * 0.5 + sway, -w * 0.15, -h - finH * 1.2 + sway * 0.7, -w * 0.35, -h * 0.5 + sway * 1.2) // Sweeps back
        ctx.quadraticCurveTo(-w * 0.1, -h + 2, 0, -h + 2) // Base back
        break
      case 'sharp':
        ctx.lineTo(-w * 0.25, -h - finH + sway) // Tip leaning back
        ctx.lineTo(w * 0.05, -h + 2) // Base back
        break
      case 'round':
        ctx.quadraticCurveTo(-w * 0.2, -h - finH * 1.2 + sway, w * 0.1, -h + 2) // Rounded sweep back
        break
    }

    // Glassy flowing dorsal fin
    const finGrad = ctx.createLinearGradient(0, -h + 2, 0, -h - finH)
    finGrad.addColorStop(0, hsl({ ...app.primaryColor, l: app.primaryColor.l + 12 }, 0.6))
    finGrad.addColorStop(1, hsl({ ...app.primaryColor, l: app.primaryColor.l + 20 }, 0.1))
    ctx.fillStyle = finGrad
    ctx.fill()
    ctx.restore()
  }

  private drawPectoralFins(ctx: CanvasRenderingContext2D, fish: Fish, energy: number, bend: number, isBack: boolean) {
    const app = fish.appearance
    const w = app.bodyLength
    const h = w * app.bodyWidth
    const speed = Math.sqrt(fish.vx * fish.vx + fish.vy * fish.vy)
    const finW = w * 0.18 * app.finSize

    const flapFreq = 1.0 + speed * 0.8
    const baseFlap = Math.sin(fish.animTime * flapFreq + (isBack ? Math.PI : 0)) * (0.15 + speed * 0.08)
    const turnBias = fish.vy * 0.015 + fish.angularVelocity * fish.facingDir * 0.3

    // 2.5D: scale fins based on yaw — back fin shrinks during turn, front fin grows
    const yaw = fish.yaw ?? 0
    const sinYaw = Math.sin(yaw)
    const turnFactor = Math.abs(sinYaw)
    const finDepthScale = isBack
      ? Math.max(0.3, 1 - turnFactor * 0.6)
      : Math.min(1.3, 1 + turnFactor * 0.3)
    const finAlpha = isBack
      ? Math.max(0.15, 0.3 - turnFactor * 0.2)
      : Math.min(0.7, 0.5 + turnFactor * 0.2)

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

    ctx.fillStyle = hsl(
      { ...app.secondaryColor, l: app.secondaryColor.l + (isBack ? -10 : 10) },
      finAlpha
    )
    ctx.fill()
    ctx.restore()
  }

  private drawEye(ctx: CanvasRenderingContext2D, app: Fish['appearance'], fish: Fish, wavePhase: number, waveAmp: number, bend: number) {
    const w = app.bodyLength
    const h = w * app.bodyWidth
    const t = 0.82
    // 2.5D: eye shifts vertically during turn to appear on the near side
    const yaw = fish.yaw ?? 0
    const sinYaw = Math.sin(yaw)
    const cosYaw = Math.cos(yaw)
    let currentXScale = cosYaw
    if (Math.abs(currentXScale) < 0.01) currentXScale = Math.sign(currentXScale) * 0.01 || 0.01

    const eyeShiftY = sinYaw * h * 0.08
    
    // CRITICAL 3D FIX: Shift the eye horizontally to the side of the head when facing the camera!
    // In the scaled context, any X offset is squished, so we must divide by currentXScale.
    // The physical 3D offset is proportional to sinYaw and the fish's thickness (h).
    const worldEyeShiftX = sinYaw * h * 0.35
    const localEyeShiftX = worldEyeShiftX / currentXScale
    
    const eyeX = -w * 0.5 + t * w + localEyeShiftX
    const eyeY = this.getSpineOffset(t, wavePhase, waveAmp, bend) - h * 0.12 + eyeShiftY
    const eyeR = w * app.eyeSize * 0.8
    const action = fish.currentAction

    ctx.save()

    // Expression-based eye shape
    let eyeScaleY = 1
    if (action === 'flee' || action === 'hide') eyeScaleY = 1.3
    if (action === 'rest' || (action === 'idle' && fish.actionTimer > 2)) eyeScaleY = 0.6
    if (action === 'play') eyeScaleY = 0.7

    ctx.translate(eyeX, eyeY)
    
    // CRITICAL 3D FIX: Prevent the eye from vanishing when facing the camera
    const targetEyeWidth = Math.max(0.4, Math.abs(cosYaw))
    ctx.scale(targetEyeWidth / Math.abs(currentXScale), eyeScaleY)

    if (fish.isDead) {
      // Dead eyes: X_X
      ctx.beginPath()
      ctx.moveTo(-eyeR, -eyeR)
      ctx.lineTo(eyeR, eyeR)
      ctx.moveTo(eyeR, -eyeR)
      ctx.lineTo(-eyeR, eyeR)
      ctx.strokeStyle = 'rgba(255,255,255,0.8)'
      ctx.lineWidth = 2
      ctx.stroke()
      ctx.restore()
      return
    }

    if (fish.stunTimer > 0) {
      // Stunned eyes: Spirals
      ctx.beginPath()
      for (let i = 0; i < 15; i++) {
        const angle = i * 0.5 + fish.animTime * 10
        const radius = (i / 15) * eyeR
        const x = Math.cos(angle) * radius
        const y = Math.sin(angle) * radius
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.strokeStyle = 'rgba(255,255,255,0.9)'
      ctx.lineWidth = 1.5
      ctx.stroke()
      ctx.restore()
      return
    }

    // Sclera (Eye white) - soft gradient
    const scleraGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, eyeR)
    scleraGrad.addColorStop(0, '#ffffff')
    scleraGrad.addColorStop(1, '#e2e8f0') // slight blue-gray shadow

    ctx.beginPath()
    ctx.arc(0, 0, eyeR, 0, Math.PI * 2)
    ctx.fillStyle = scleraGrad
    ctx.fill()

    // Iris
    const irisR = eyeR * 0.6
    const irisGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, irisR)
    irisGrad.addColorStop(0, hsl({ ...app.primaryColor, l: 20 }))
    irisGrad.addColorStop(1, hsl({ ...app.primaryColor, l: 10 }))
    ctx.beginPath()
    ctx.arc(0, 0, irisR, 0, Math.PI * 2)
    ctx.fillStyle = irisGrad
    ctx.fill()

    // Pupil
    const speed = Math.sqrt(fish.vx * fish.vx + fish.vy * fish.vy)
    const lookX = Math.min(eyeR * 0.15, speed * 0.3)
    const lookY = fish.vy * 0.15

    let pupilSize = eyeR * 0.35
    if (action === 'hunt' || action === 'attack') pupilSize = eyeR * 0.25
    if (action === 'flee') pupilSize = eyeR * 0.42

    ctx.beginPath()
    ctx.arc(lookX, lookY, pupilSize, 0, Math.PI * 2)
    ctx.fillStyle = '#0f172a'
    ctx.fill()

    // Dual Catchlights (Premium Pixar reflection)
    ctx.beginPath()
    ctx.arc(-eyeR * 0.25, -eyeR * 0.25, eyeR * 0.25, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.95)'
    ctx.fill()

    ctx.beginPath()
    ctx.arc(eyeR * 0.2, eyeR * 0.15, eyeR * 0.1, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)'
    ctx.fill()

    // Star eyes when happy/play
    if (action === 'play' && fish.mood === 'happy') {
      ctx.beginPath()
      ctx.arc(-eyeR * 0.05, 0, eyeR * 0.12, 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(255,255,100,0.7)'
      ctx.fill()
    }

    ctx.restore()

    // Eyebrow for angry states
    if (action === 'hunt' || action === 'attack') {
      ctx.beginPath()
      ctx.moveTo(eyeX - eyeR * 0.8, eyeY - eyeR * 1.2)
      ctx.lineTo(eyeX + eyeR * 0.6, eyeY - eyeR * 0.7)
      ctx.strokeStyle = hsl({ ...app.primaryColor, l: app.primaryColor.l - 25 }, 0.7)
      ctx.lineWidth = 1.5
      ctx.lineCap = 'round'
      ctx.stroke()
    }
  }

  private drawMouth(ctx: CanvasRenderingContext2D, app: Fish['appearance'], fish: Fish, wavePhase: number, waveAmp: number, bend: number) {
    const w = app.bodyLength
    const h = w * app.bodyWidth
    const t = 0.95 // near tip
    const mouthX = -w * 0.5 + t * w
    const mouthY = this.getSpineOffset(t, wavePhase, waveAmp, bend) + h * 0.1
    const openAmount = fish.mouthOpen

    ctx.save()
    ctx.translate(mouthX, mouthY)

    // CRITICAL 3D FIX: Prevent the mouth from vanishing when facing the camera
    const yaw = fish.yaw ?? 0
    const cosYaw = Math.cos(yaw)
    let currentXScale = cosYaw
    if (Math.abs(currentXScale) < 0.01) currentXScale = Math.sign(currentXScale) * 0.01 || 0.01
    const targetMouthWidth = Math.max(0.3, Math.abs(cosYaw))
    ctx.scale(targetMouthWidth / Math.abs(currentXScale), 1)

    // Teeth for aggressive species (juanwang)
    if (fish.species === 'juanwang' && openAmount > 0.2) {
      ctx.save()
      ctx.fillStyle = 'rgba(255,255,255,0.9)'
      const teethCount = 3
      for (let i = 0; i < teethCount; i++) {
        const tx = -1 + i * 1.2
        ctx.beginPath()
        ctx.moveTo(tx, -openAmount * 1.2)
        ctx.lineTo(tx + 0.5, 0.5)
        ctx.lineTo(tx - 0.5, 0.5)
        ctx.fill()
      }
      ctx.restore()
    }

    ctx.beginPath()
    ctx.ellipse(0, 0, 1.5 + openAmount * 2, 0.8 + openAmount * 1.5, 0, 0, Math.PI * 2)
    ctx.fillStyle = `rgba(80, 20, 20, ${0.3 + openAmount * 0.4})`
    ctx.fill()

    // Smile curve for happy fish
    if (fish.mood === 'happy' || fish.currentAction === 'play') {
      ctx.beginPath()
      ctx.arc(-2, 1, 3, 0.1, Math.PI - 0.1)
      ctx.strokeStyle = hsl({ ...app.primaryColor, l: app.primaryColor.l - 20 }, 0.4)
      ctx.lineWidth = 0.8
      ctx.stroke()
    }
    
    ctx.restore()
  }

  private drawSpeciesAccessory(ctx: CanvasRenderingContext2D, fish: Fish, wavePhase: number, waveAmp: number, bend: number) {
    const app = fish.appearance
    const w = app.bodyLength
    const h = w * app.bodyWidth

    switch (fish.species) {
      case 'juanwang':
        this.drawGlasses(ctx, w, h, app, wavePhase, waveAmp, bend)
        break
      case 'xianyu':
        this.drawSleepyLid(ctx, fish, w, h, app, wavePhase, waveAmp, bend)
        break
      case 'xijing':
        this.drawBlush(ctx, w, h, wavePhase, waveAmp, bend)
        this.drawCrown(ctx, w, h, fish.animTime, wavePhase, waveAmp, bend)
        break
      case 'moyu':
        this.drawBlush(ctx, w, h, wavePhase, waveAmp, bend)
        break
      case 'sheniu':
        this.drawFaceSparkle(ctx, w, h, fish.animTime, wavePhase, waveAmp, bend)
        break
    }
  }

  private drawGlasses(ctx: CanvasRenderingContext2D, w: number, h: number, app: Fish['appearance'], wavePhase: number, waveAmp: number, bend: number) {
    const t = 0.85
    const eyeX = -w * 0.5 + t * w
    const eyeY = this.getSpineOffset(t, wavePhase, waveAmp, bend) - h * 0.15
    const eyeR = w * app.eyeSize * 1.15

    ctx.strokeStyle = 'rgba(50,50,80,0.6)'
    ctx.lineWidth = 1
    // Lens
    ctx.beginPath()
    ctx.arc(eyeX, eyeY, eyeR * 1.3, 0, Math.PI * 2)
    ctx.stroke()
    // Temple arm
    ctx.beginPath()
    ctx.moveTo(eyeX - eyeR * 1.3, eyeY)
    ctx.lineTo(eyeX - eyeR * 2.5, eyeY - 1)
    ctx.stroke()
  }

  private drawSleepyLid(ctx: CanvasRenderingContext2D, fish: Fish, w: number, h: number, app: Fish['appearance'], wavePhase: number, waveAmp: number, bend: number) {
    if (fish.isDead || fish.stunTimer > 0) return

    const t = 0.85
    const eyeX = -w * 0.5 + t * w
    const eyeY = this.getSpineOffset(t, wavePhase, waveAmp, bend) - h * 0.15
    const eyeR = w * app.eyeSize * 1.15
    
    // Add subtle breathing motion to the eyelid
    const lidWiggle = Math.sin(wavePhase * 0.5) * 0.1

    ctx.beginPath()
    ctx.arc(eyeX, eyeY, eyeR * 1.05, -Math.PI + lidWiggle, lidWiggle)
    ctx.fillStyle = hsl({ ...app.primaryColor, l: app.primaryColor.l - 5 }, 0.8)
    ctx.fill()
  }

  private drawBlush(ctx: CanvasRenderingContext2D, w: number, h: number, wavePhase: number, waveAmp: number, bend: number) {
    const t = 0.8
    const x = -w * 0.5 + t * w
    const y = this.getSpineOffset(t, wavePhase, waveAmp, bend) + h * 0.1
    ctx.beginPath()
    ctx.arc(x, y, 3, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(255, 120, 120, 0.25)'
    ctx.fill()
  }

  private drawCrown(ctx: CanvasRenderingContext2D, w: number, h: number, time: number, wavePhase: number, waveAmp: number, bend: number) {
    const t = 0.85
    const x = -w * 0.5 + t * w
    const y = this.getSpineOffset(t, wavePhase, waveAmp, bend) - h - 4 + Math.sin(time * 2) * 1

    ctx.save()
    ctx.translate(x, y)
    ctx.fillStyle = 'rgba(255, 200, 50, 0.8)'
    ctx.beginPath()
    ctx.moveTo(-4, 2)
    ctx.lineTo(-4, -2)
    ctx.lineTo(-2, 0)
    ctx.lineTo(0, -3)
    ctx.lineTo(2, 0)
    ctx.lineTo(4, -2)
    ctx.lineTo(4, 2)
    ctx.closePath()
    ctx.fill()
    ctx.restore()
  }

  private drawFaceSparkle(ctx: CanvasRenderingContext2D, w: number, h: number, time: number, wavePhase: number, waveAmp: number, bend: number) {
    const t1 = 0.9, t2 = 0.75
    const sparkles = [
      { x: -w * 0.5 + t1 * w, y: this.getSpineOffset(t1, wavePhase, waveAmp, bend) - h * 0.4 },
      { x: -w * 0.5 + t2 * w, y: this.getSpineOffset(t2, wavePhase, waveAmp, bend) - h * 0.6 },
    ]
    for (let i = 0; i < sparkles.length; i++) {
      const s = sparkles[i]
      const alpha = 0.3 + Math.sin(time * 3 + i * 2) * 0.3
      if (alpha < 0.1) continue
      ctx.save()
      ctx.translate(s.x, s.y)
      ctx.rotate(time * 2 + i)
      const size = 1.5
      ctx.fillStyle = `rgba(255, 255, 200, ${alpha})`
      ctx.beginPath()
      ctx.moveTo(0, -size)
      ctx.lineTo(size * 0.3, 0)
      ctx.lineTo(0, size)
      ctx.lineTo(-size * 0.3, 0)
      ctx.closePath()
      ctx.fill()
      ctx.restore()
    }
  }

  private drawEmotionEffects(ctx: CanvasRenderingContext2D, fish: Fish) {
    const { x, y, animTime, appearance: app, currentAction } = fish

    switch (currentAction) {
      case 'hunt':
      case 'attack':
        // Angry steam puffs above head
        this.drawSteam(ctx, x, y - app.bodyLength * 0.6, animTime)
        break
      case 'flee':
      case 'hide':
        // Sweat drops
        this.drawSweat(ctx, x + app.bodyLength * 0.2, y - app.bodyLength * 0.5, animTime)
        break
      case 'play':
        // Small hearts or music notes floating up
        this.drawFloatingHearts(ctx, x, y - app.bodyLength * 0.5, animTime)
        break
      case 'rest':
        // Zzz particles
        this.drawZzz(ctx, x + app.bodyLength * 0.3, y - app.bodyLength * 0.5, animTime)
        break
    }
  }

  private drawSteam(ctx: CanvasRenderingContext2D, x: number, y: number, time: number) {
    for (let i = 0; i < 2; i++) {
      const phase = time * 4 + i * Math.PI
      const py = y - 8 - (phase % 6) * 1.5
      const px = x - 3 + i * 6 + Math.sin(phase * 0.5) * 2
      const alpha = Math.max(0, 0.5 - ((phase % 6) / 6) * 0.5)
      const size = 2 + ((phase % 6) / 6) * 2

      ctx.beginPath()
      ctx.arc(px, py, size, 0, Math.PI * 2)
      ctx.fillStyle = `rgba(200, 80, 60, ${alpha})`
      ctx.fill()
    }
  }

  private drawSweat(ctx: CanvasRenderingContext2D, x: number, y: number, time: number) {
    const dropY = y + (time * 15 % 12)
    const alpha = 1 - (time * 15 % 12) / 12

    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.quadraticCurveTo(x + 2, dropY - 2, x, dropY)
    ctx.quadraticCurveTo(x - 2, dropY - 2, x, y)
    ctx.fillStyle = `rgba(100, 180, 255, ${alpha * 0.6})`
    ctx.fill()
  }

  private drawFloatingHearts(ctx: CanvasRenderingContext2D, x: number, y: number, time: number) {
    for (let i = 0; i < 2; i++) {
      const phase = (time * 1.5 + i * 2) % 4
      const hy = y - phase * 5
      const hx = x + Math.sin(time * 2 + i * 3) * 5 + (i - 0.5) * 8
      const alpha = Math.max(0, 1 - phase / 4)
      const size = 2 + phase * 0.3

      if (alpha < 0.05) continue
      ctx.save()
      ctx.translate(hx, hy)
      ctx.scale(size / 3, size / 3)
      ctx.beginPath()
      ctx.moveTo(0, 1)
      ctx.bezierCurveTo(-2, -1, -3, -3, 0, -4)
      ctx.bezierCurveTo(3, -3, 2, -1, 0, 1)
      ctx.fillStyle = `rgba(255, 100, 130, ${alpha * 0.6})`
      ctx.fill()
      ctx.restore()
    }
  }

  private drawZzz(ctx: CanvasRenderingContext2D, x: number, y: number, time: number) {
    ctx.font = '600 8px -apple-system, sans-serif'
    for (let i = 0; i < 3; i++) {
      const phase = (time * 0.8 + i * 1.2) % 4
      const zy = y - phase * 4 - i * 3
      const zx = x + i * 4 + Math.sin(time + i) * 2
      const alpha = Math.max(0, 0.6 - phase / 5)
      const size = 7 + i * 2

      if (alpha < 0.05) continue
      ctx.fillStyle = `rgba(150, 180, 255, ${alpha})`
      ctx.font = `600 ${size}px -apple-system, sans-serif`
      ctx.fillText('z', zx, zy)
    }
  }

  private drawSparkles(ctx: CanvasRenderingContext2D, fish: Fish) {
    const time = fish.animTime
    for (let i = 0; i < 4; i++) {
      const angle = time * 1.2 + i * (Math.PI * 2 / 4)
      const dist = 18 + Math.sin(time * 2 + i * 1.5) * 5
      const sx = Math.cos(angle) * dist
      const sy = Math.sin(angle) * dist
      const sparkleSize = 1.2 + Math.sin(time * 3.5 + i * 2) * 0.8

      ctx.beginPath()
      for (let p = 0; p < 4; p++) {
        const a = (Math.PI / 2) * p + time * 1.5
        const r = p % 2 === 0 ? sparkleSize : sparkleSize * 0.3
        const px = sx + Math.cos(a) * r
        const py = sy + Math.sin(a) * r
        if (p === 0) ctx.moveTo(px, py)
        else ctx.lineTo(px, py)
      }
      ctx.closePath()
      ctx.fillStyle = `rgba(255, 255, 200, ${0.3 + Math.sin(time * 2.5 + i) * 0.2})`
      ctx.fill()
    }
  }

  private drawHealthBar(ctx: CanvasRenderingContext2D, fish: Fish) {
    if (fish.currentHp >= fish.hidden.hp) return

    const ratio = fish.currentHp / fish.hidden.hp
    const barWidth = 30
    const barHeight = 3
    const x = fish.x - barWidth / 2
    const y = fish.y - fish.appearance.bodyLength * 0.7 - 10

    ctx.fillStyle = 'rgba(0,0,0,0.4)'
    ctx.beginPath()
    ctx.roundRect(x - 1, y - 1, barWidth + 2, barHeight + 2, 2)
    ctx.fill()

    const color = ratio > 0.6 ? '#4caf50' : ratio > 0.3 ? '#ff9800' : '#f44336'
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.roundRect(x, y, barWidth * ratio, barHeight, 2)
    ctx.fill()
  }

  private drawNameTag(ctx: CanvasRenderingContext2D, fish: Fish) {
    const x = fish.x
    const y = fish.y + fish.appearance.bodyLength * 0.6 + 14

    ctx.font = '500 10px -apple-system, "SF Pro Text", sans-serif'
    ctx.textAlign = 'center'

    ctx.fillStyle = 'rgba(0,0,0,0.35)'
    ctx.fillText(`${fish.name} Lv.${fish.hidden.level}`, x, y + 0.8)
    ctx.fillStyle = 'rgba(255,255,255,0.75)'
    ctx.fillText(`${fish.name} Lv.${fish.hidden.level}`, x, y)
  }

  private drawBubble(ctx: CanvasRenderingContext2D, fish: Fish) {
    if (!fish.bubble || fish.bubble.opacity <= 0) return

    const { text, opacity } = fish.bubble
    const bubbleX = fish.x + fish.appearance.bodyLength * 0.4
    const bubbleY = fish.y - fish.appearance.bodyLength * 0.7 - 22

    ctx.save()
    ctx.globalAlpha = opacity

    ctx.font = '600 11px -apple-system, "SF Pro Text", sans-serif'
    ctx.textAlign = 'center'
    const metrics = ctx.measureText(text)
    const textW = metrics.width
    const padX = 8
    const boxW = textW + padX * 2
    const boxH = 20

    // Bubble background with subtle gradient
    const bgGrad = ctx.createLinearGradient(bubbleX, bubbleY - boxH / 2, bubbleX, bubbleY + boxH / 2)
    bgGrad.addColorStop(0, 'rgba(255, 255, 255, 0.95)')
    bgGrad.addColorStop(1, 'rgba(245, 245, 250, 0.92)')
    ctx.fillStyle = bgGrad
    ctx.beginPath()
    ctx.roundRect(bubbleX - boxW / 2, bubbleY - boxH / 2, boxW, boxH, 9)
    ctx.fill()

    // Bubble tail
    ctx.beginPath()
    ctx.moveTo(bubbleX - 4, bubbleY + boxH / 2 - 1)
    ctx.lineTo(bubbleX - 7, bubbleY + boxH / 2 + 5)
    ctx.lineTo(bubbleX + 1, bubbleY + boxH / 2 - 1)
    ctx.fill()

    // Border
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.08)'
    ctx.lineWidth = 0.5
    ctx.beginPath()
    ctx.roundRect(bubbleX - boxW / 2, bubbleY - boxH / 2, boxW, boxH, 9)
    ctx.stroke()

    // Text
    ctx.fillStyle = '#2d3748'
    ctx.fillText(text, bubbleX, bubbleY + 4)

    ctx.restore()
  }
}
