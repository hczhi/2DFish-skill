<template>
  <div class="game-container" @click="handleClick"
    @mousedown="handleMouseDown" @mouseup="handleMouseUp" @mouseleave="handleMouseUp"
    @touchstart.prevent="handleTouchStart" @touchend="handleTouchEnd" @touchcancel="handleTouchEnd">
    <!-- 背景 -->
    <div class="bg-layer bg-fallback" />

    <!-- 鱼 + 食物 + 环境效果 -->
    <canvas ref="canvasRef" class="canvas-layer" />

    <!-- 点击粒子层 -->
    <canvas ref="fxCanvasRef" class="fx-layer" />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import type { Fish, Food, PhysicalBubble, PlayerControlState, Shockwave } from '../game/types'
import type { BossEntity } from '../game/StoryEventEngine'
import { FishRenderer } from '../game/FishRenderer'
import { AmbientEffects } from '../game/AmbientEffects'
import { ForegroundEffects } from '../game/ForegroundEffects'

const props = defineProps<{
  fishes: Fish[]
  foods: Food[]
  physicalBubbles?: PhysicalBubble[]
  shockwaves?: Shockwave[]
  boss?: BossEntity | null
  playerControl?: PlayerControlState | null
}>()

const emit = defineEmits<{
  feed: [e: MouseEvent]
  pet: [x: number, y: number]
  playerPressStart: [fishId: string]
  playerPressEnd: []
}>()

const canvasRef = ref<HTMLCanvasElement | null>(null)
const fxCanvasRef = ref<HTMLCanvasElement | null>(null)

let ctx: CanvasRenderingContext2D | null = null
let fxCtx: CanvasRenderingContext2D | null = null
let animId = 0
let lastFrameTime = 0
let fishRenderer: FishRenderer
let ambientEffects: AmbientEffects
let foregroundEffects: ForegroundEffects

interface ClickParticle {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  maxLife: number
  size: number
  hue: number
}

let clickParticles: ClickParticle[] = []
let longPressTimer: ReturnType<typeof setTimeout> | null = null
let isLongPress = false
let pressX = 0
let pressY = 0

function resize() {
  const canvas = canvasRef.value
  const fxCanvas = fxCanvasRef.value
  if (!canvas || !fxCanvas) return
  const w = window.innerWidth
  const h = window.innerHeight
  canvas.width = w
  canvas.height = h
  fxCanvas.width = w
  fxCanvas.height = h
  ambientEffects?.resize(w, h)
  foregroundEffects?.resize(w, h)
}

function getCanvasPos(e: MouseEvent | Touch) {
  const canvas = canvasRef.value
  if (!canvas) return { x: 0, y: 0 }
  const rect = canvas.getBoundingClientRect()
  return { x: e.clientX - rect.left, y: e.clientY - rect.top }
}

function findFishAt(x: number, y: number): Fish | undefined {
  return props.fishes.find(fish => {
    const dx = x - fish.x
    const dy = y - fish.y
    return Math.sqrt(dx * dx + dy * dy) < fish.appearance.bodyLength * 0.8
  })
}

function handleMouseDown(e: MouseEvent) {
  const { x, y } = getCanvasPos(e)
  pressX = x
  pressY = y
  isLongPress = false

  const hitFish = findFishAt(x, y)
  if (hitFish && !hitFish.isDead) {
    if (props.playerControl?.active) return

    // 300ms 后判定为长按，开始进度计时
    longPressTimer = setTimeout(() => {
      isLongPress = true
      emit('playerPressStart', hitFish.id)
    }, 300)
  }
}

function handleMouseUp(_e: MouseEvent) {
  if (longPressTimer) {
    clearTimeout(longPressTimer)
    longPressTimer = null
  }
  if (isLongPress) {
    emit('playerPressEnd')
    isLongPress = false
  }
}

function handleTouchStart(e: TouchEvent) {
  if (e.touches.length !== 1) return
  const touch = e.touches[0]
  const { x, y } = getCanvasPos(touch)
  pressX = x
  pressY = y
  isLongPress = false

  const hitFish = findFishAt(x, y)
  if (hitFish && !hitFish.isDead) {
    if (props.playerControl?.active) return

    longPressTimer = setTimeout(() => {
      isLongPress = true
      emit('playerPressStart', hitFish.id)
    }, 300)
  }
}

function handleTouchEnd() {
  if (longPressTimer) {
    clearTimeout(longPressTimer)
    longPressTimer = null
  }
  if (isLongPress) {
    emit('playerPressEnd')
    isLongPress = false
  }
}

function handleClick(e: MouseEvent) {
  // 如果是长按触发的，不再处理 click
  if (isLongPress) return

  const canvas = canvasRef.value
  if (!canvas) return
  const rect = canvas.getBoundingClientRect()
  const x = e.clientX - rect.left
  const y = e.clientY - rect.top

  // 控制模式下点击不做pet/feed
  if (props.playerControl?.active) return

  const hitFish = findFishAt(x, y)

  if (hitFish) {
    emit('pet', x, y)
    spawnPetParticles(x, y, hitFish)
  } else {
    emit('feed', e)
  }
}

function spawnPetParticles(x: number, y: number, fish: Fish) {
  const hue = fish.appearance.primaryColor.h
  for (let i = 0; i < 12; i++) {
    const angle = (Math.PI * 2 / 12) * i + (Math.random() - 0.5) * 0.5
    const speed = 1.5 + Math.random() * 3
    clickParticles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 1.5,
      life: 1,
      maxLife: 0.6 + Math.random() * 0.4,
      size: 3 + Math.random() * 4,
      hue: hue + (Math.random() - 0.5) * 30,
    })
  }
  // Hearts for friendly species
  if (fish.species === 'moyu' || fish.species === 'sheniu' || fish.species === 'xijing') {
    for (let i = 0; i < 4; i++) {
      clickParticles.push({
        x: x + (Math.random() - 0.5) * 20,
        y: y - 5,
        vx: (Math.random() - 0.5) * 1.5,
        vy: -(2 + Math.random() * 2),
        life: 1,
        maxLife: 1.0 + Math.random() * 0.4,
        size: 6 + Math.random() * 3,
        hue: 350, // pink hearts
      })
    }
  }
}

function drawClickParticles(ctx: CanvasRenderingContext2D, dt: number) {
  for (let i = clickParticles.length - 1; i >= 0; i--) {
    const p = clickParticles[i]
    p.life -= dt / p.maxLife
    p.x += p.vx
    p.y += p.vy
    p.vy += 2 * dt // gravity
    p.vx *= 0.98

    if (p.life <= 0) {
      clickParticles.splice(i, 1)
      continue
    }

    const alpha = p.life
    const size = p.size * (0.5 + p.life * 0.5)

    if (p.hue >= 340 || p.hue <= 10) {
      // Heart shape
      ctx.save()
      ctx.globalAlpha = alpha * 0.8
      ctx.translate(p.x, p.y)
      ctx.scale(size / 8, size / 8)
      ctx.beginPath()
      ctx.moveTo(0, 2)
      ctx.bezierCurveTo(-4, -2, -6, -5, 0, -7)
      ctx.bezierCurveTo(6, -5, 4, -2, 0, 2)
      ctx.fillStyle = `hsla(${p.hue}, 80%, 65%, 1)`
      ctx.fill()
      ctx.restore()
    } else {
      // Sparkle circle
      ctx.beginPath()
      ctx.arc(p.x, p.y, size, 0, Math.PI * 2)
      ctx.fillStyle = `hsla(${p.hue}, 70%, 65%, ${alpha})`
      ctx.fill()
    }
  }
}

function drawFoods(ctx: CanvasRenderingContext2D, foods: Food[]) {
  foods.forEach(food => {
    ctx.save()
    ctx.globalAlpha = food.opacity

    const wobble = Math.sin(performance.now() * 0.003 + food.x * 0.1) * 1.5
    const drawX = food.x + wobble
    const drawY = food.y
    const size = food.size

    const glowGrad = ctx.createRadialGradient(drawX, drawY, 0, drawX, drawY, size * 2.5)
    glowGrad.addColorStop(0, 'rgba(243, 156, 18, 0.25)')
    glowGrad.addColorStop(1, 'rgba(243, 156, 18, 0)')
    ctx.fillStyle = glowGrad
    ctx.beginPath()
    ctx.arc(drawX, drawY, size * 2.5, 0, Math.PI * 2)
    ctx.fill()

    ctx.beginPath()
    ctx.ellipse(drawX, drawY, size, size * 0.75, wobble * 0.05, 0, Math.PI * 2)
    const pelletGrad = ctx.createRadialGradient(drawX - size * 0.2, drawY - size * 0.2, 0, drawX, drawY, size)
    pelletGrad.addColorStop(0, '#ffc947')
    pelletGrad.addColorStop(0.7, '#f39c12')
    pelletGrad.addColorStop(1, '#d68910')
    ctx.fillStyle = pelletGrad
    ctx.fill()

    ctx.beginPath()
    ctx.arc(drawX - size * 0.25, drawY - size * 0.25, size * 0.3, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)'
    ctx.fill()

    ctx.restore()
  })
}

function drawBoss(ctx: CanvasRenderingContext2D, boss: BossEntity) {
  ctx.save()
  ctx.translate(boss.x, boss.y)

  const flashAlpha = boss.hitFlash > 0 ? 0.6 : 0
  const wobble = Math.sin(boss.animTime * 3) * 3
  ctx.translate(0, wobble)
  ctx.scale(boss.angle === Math.PI ? -1 : 1, 1)

  const size = boss.appearance.size

  // Body glow
  const glowGrad = ctx.createRadialGradient(0, 0, size * 0.3, 0, 0, size * 1.5)
  glowGrad.addColorStop(0, boss.appearance.color)
  glowGrad.addColorStop(1, 'transparent')
  ctx.globalAlpha = 0.3
  ctx.fillStyle = glowGrad
  ctx.beginPath()
  ctx.arc(0, 0, size * 1.5, 0, Math.PI * 2)
  ctx.fill()
  ctx.globalAlpha = 1

  // Main body
  ctx.beginPath()
  ctx.ellipse(0, 0, size, size * 0.6, 0, 0, Math.PI * 2)
  const bodyGrad = ctx.createRadialGradient(-size * 0.2, -size * 0.1, 0, 0, 0, size)
  bodyGrad.addColorStop(0, boss.appearance.color)
  bodyGrad.addColorStop(1, 'rgba(20, 10, 30, 0.8)')
  ctx.fillStyle = bodyGrad
  ctx.fill()

  // Eye
  ctx.beginPath()
  ctx.arc(size * 0.4, -size * 0.15, size * 0.15, 0, Math.PI * 2)
  ctx.fillStyle = '#ff3333'
  ctx.fill()
  ctx.beginPath()
  ctx.arc(size * 0.42, -size * 0.17, size * 0.06, 0, Math.PI * 2)
  ctx.fillStyle = '#fff'
  ctx.fill()

  // Tail fin
  ctx.beginPath()
  ctx.moveTo(-size * 0.9, 0)
  ctx.lineTo(-size * 1.4, -size * 0.4)
  ctx.lineTo(-size * 1.4, size * 0.4)
  ctx.closePath()
  ctx.fillStyle = boss.appearance.color
  ctx.globalAlpha = 0.7
  ctx.fill()
  ctx.globalAlpha = 1

  // Hit flash overlay
  if (flashAlpha > 0) {
    ctx.beginPath()
    ctx.ellipse(0, 0, size, size * 0.6, 0, 0, Math.PI * 2)
    ctx.fillStyle = `rgba(255, 255, 255, ${flashAlpha})`
    ctx.fill()
  }

  ctx.restore()
}

function render(now: number = 0) {
  if (!ctx || !fxCtx || !canvasRef.value || !fxCanvasRef.value) return
  const dt = Math.min((now - lastFrameTime) / 1000, 0.1)
  lastFrameTime = now

  const w = canvasRef.value.width
  const h = canvasRef.value.height

  ctx.clearRect(0, 0, w, h)
  fxCtx.clearRect(0, 0, w, h)

  ambientEffects.update(ctx, w, h)
  drawFoods(ctx, props.foods)

  // Relationship indicators behind fish
  fishRenderer.drawRelationships(ctx, props.fishes)

  // Sort by z-depth: far fish (small z) drawn first, near fish (large z) drawn on top
  const sortedFishes = [...props.fishes].sort((a, b) => (a.z ?? 0.5) - (b.z ?? 0.5))
  sortedFishes.forEach(fish => {
    fishRenderer.draw(ctx!, fish, dt)
  })

  // Boss entity (disabled)
  // if (props.boss) {
  //   drawBoss(ctx, props.boss)
  // }

  // Foreground effects on top of fish
  foregroundEffects.update(ctx, w, h)

  // Physical breathing bubbles
  fishRenderer.drawPhysicalBubbles(ctx, props.physicalBubbles)

  // Shockwaves
  drawShockwaves(ctx)

  // Player control UI overlays
  drawPlayerControlUI(ctx, dt)

  // Click particles on FX layer
  drawClickParticles(fxCtx, dt)

  animId = requestAnimationFrame(render)
}

function drawPlayerControlUI(ctx: CanvasRenderingContext2D, dt: number) {
  const pc = props.playerControl
  if (!pc) return

  // 长按进度条（未确认时显示）
  if (!pc.confirmed && pc.pressProgress > 0 && pc.fishId) {
    const fish = props.fishes.find(f => f.id === pc.fishId)
    if (fish) {
      drawProgressRing(ctx, fish.x, fish.y - fish.appearance.bodyLength * 0.8 - 20, 22, pc.pressProgress)
    }
  }

  // 控制模式激活后的指示器
  if (pc.active && pc.fishId) {
    const fish = props.fishes.find(f => f.id === pc.fishId)
    if (fish) {
      drawControlIndicator(ctx, fish)

      // S键蓄力条
      if (pc.sCharging && pc.sChargeTime > 0) {
        drawChargeBar(ctx, fish, pc)
      }

      // 冷却指示
      if (pc.sCooldown > 0 && !pc.sCharging) {
        drawCooldownIndicator(ctx, fish, pc.sCooldown)
      }
    }

    // 攻击目标锁定高亮
    if (pc.targetLockMode && pc.targetLockFishId) {
      const target = props.fishes.find(f => f.id === pc.targetLockFishId)
      if (target) {
        drawTargetLock(ctx, target)
      }
    }

    // 候选目标微弱指示
    if (pc.targetLockMode) {
      pc.targetCandidates.forEach(candidateId => {
        if (candidateId === pc.targetLockFishId) return
        const candidate = props.fishes.find(f => f.id === candidateId)
        if (candidate) {
          drawTargetCandidate(ctx, candidate)
        }
      })
    }
  }
}

function drawProgressRing(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, progress: number) {
  ctx.save()

  // 背景圆环
  ctx.beginPath()
  ctx.arc(x, y, radius, 0, Math.PI * 2)
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)'
  ctx.lineWidth = 4
  ctx.stroke()

  // 进度弧
  ctx.beginPath()
  ctx.arc(x, y, radius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress)
  const grad = ctx.createLinearGradient(x - radius, y, x + radius, y)
  grad.addColorStop(0, '#4fc3f7')
  grad.addColorStop(1, '#00e676')
  ctx.strokeStyle = grad
  ctx.lineWidth = 4
  ctx.lineCap = 'round'
  ctx.stroke()

  // 中心百分比文字
  ctx.fillStyle = 'rgba(255, 255, 255, 0.9)'
  ctx.font = 'bold 10px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(`${Math.floor(progress * 100)}%`, x, y)

  ctx.restore()
}

function drawControlIndicator(ctx: CanvasRenderingContext2D, fish: Fish) {
  ctx.save()
  const time = performance.now() / 1000
  const pulseScale = 1 + Math.sin(time * 3) * 0.1
  const radius = fish.appearance.bodyLength * 0.9 * pulseScale

  // 旋转光环
  ctx.beginPath()
  ctx.arc(fish.x, fish.y, radius, time * 2, time * 2 + Math.PI * 1.5)
  ctx.strokeStyle = 'rgba(79, 195, 247, 0.6)'
  ctx.lineWidth = 2
  ctx.lineCap = 'round'
  ctx.stroke()

  // 第二个旋转弧
  ctx.beginPath()
  ctx.arc(fish.x, fish.y, radius, time * 2 + Math.PI, time * 2 + Math.PI + Math.PI * 0.5)
  ctx.strokeStyle = 'rgba(0, 230, 118, 0.5)'
  ctx.lineWidth = 2
  ctx.lineCap = 'round'
  ctx.stroke()

  // "CTRL" 标识
  ctx.fillStyle = 'rgba(79, 195, 247, 0.8)'
  ctx.font = 'bold 9px monospace'
  ctx.textAlign = 'center'
  ctx.fillText('CTRL', fish.x, fish.y - radius - 8)

  ctx.restore()
}

function drawTargetLock(ctx: CanvasRenderingContext2D, target: Fish) {
  ctx.save()
  const time = performance.now() / 1000
  const radius = target.appearance.bodyLength * 0.9
  const rot = time * 1.5

  // 四角瞄准框
  ctx.strokeStyle = 'rgba(255, 82, 82, 0.9)'
  ctx.lineWidth = 2
  const corners = [
    { angle: rot, dx: -1, dy: -1 },
    { angle: rot, dx: 1, dy: -1 },
    { angle: rot, dx: 1, dy: 1 },
    { angle: rot, dx: -1, dy: 1 },
  ]
  const cornerLen = radius * 0.4
  corners.forEach(c => {
    const cx = target.x + c.dx * radius * 0.7
    const cy = target.y + c.dy * radius * 0.7
    ctx.beginPath()
    ctx.moveTo(cx, cy + c.dy * -cornerLen)
    ctx.lineTo(cx, cy)
    ctx.lineTo(cx + c.dx * -cornerLen, cy)
    ctx.stroke()
  })

  // 中心十字
  const crossSize = 6
  ctx.beginPath()
  ctx.moveTo(target.x - crossSize, target.y)
  ctx.lineTo(target.x + crossSize, target.y)
  ctx.moveTo(target.x, target.y - crossSize)
  ctx.lineTo(target.x, target.y + crossSize)
  ctx.strokeStyle = 'rgba(255, 82, 82, 0.7)'
  ctx.lineWidth = 1.5
  ctx.stroke()

  // 名称标签
  ctx.fillStyle = 'rgba(255, 82, 82, 0.9)'
  ctx.font = 'bold 10px sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText(target.name, target.x, target.y + radius + 14)

  ctx.restore()
}

function drawTargetCandidate(ctx: CanvasRenderingContext2D, fish: Fish) {
  ctx.save()
  ctx.beginPath()
  ctx.arc(fish.x, fish.y, fish.appearance.bodyLength * 0.7, 0, Math.PI * 2)
  ctx.strokeStyle = 'rgba(255, 152, 0, 0.3)'
  ctx.lineWidth = 1
  ctx.setLineDash([4, 4])
  ctx.stroke()
  ctx.restore()
}

function drawShockwaves(ctx: CanvasRenderingContext2D) {
  const waves = props.shockwaves
  if (!waves || waves.length === 0) return

  waves.forEach(sw => {
    ctx.save()
    ctx.translate(sw.x, sw.y)
    ctx.rotate(sw.angle)
    
    // 恢复为普通叠加模式，保留泡泡原本的水体透明感
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = sw.opacity

    const r = sw.radius
    const time = performance.now() / 1000

    // --- 泡泡基础形态 ---
    // 为了表现速度感，泡泡依然受到拉伸形变
    const stretch = 1.2
    const flatten = 0.85
    
    ctx.save()
    // 旋转是为了让拉伸方向和运动方向（X轴正向）一致
    // 注意：外层已经做了 rotate(sw.angle)，所以现在的运动方向就是本地坐标的X轴正向
    
    // 1. 泡泡主体的微弱背景色 (水体质感)
    ctx.beginPath()
    ctx.ellipse(0, 0, r * stretch, r * flatten, 0, 0, Math.PI * 2)
    ctx.fillStyle = `rgba(200, 240, 255, ${sw.opacity * 0.15})`
    ctx.fill()

    // 2. 泡泡边缘高亮轮廓 (参考鱼吐出的泡泡画法)
    ctx.beginPath()
    ctx.ellipse(0, 0, r * stretch, r * flatten, 0, 0, Math.PI * 2)
    ctx.strokeStyle = `rgba(255, 255, 255, ${sw.opacity * 0.7})`
    ctx.lineWidth = r * 0.05 // 线条稍微粗一点以匹配巨大的体积
    ctx.stroke()

    // 3. 泡泡表面的弧形高光点 (Specular highlight)
    // 这是让圆圈看起来像立体水泡的灵魂
    ctx.beginPath()
    // 在左上角画一个稍微倾斜的椭圆高光
    const hlX = -r * stretch * 0.4
    const hlY = -r * flatten * 0.4
    const hlW = r * stretch * 0.3
    const hlH = r * flatten * 0.15
    ctx.ellipse(hlX, hlY, hlW, hlH, -Math.PI / 6, 0, Math.PI * 2)
    ctx.fillStyle = `rgba(255, 255, 255, ${sw.opacity * 0.8})`
    ctx.fill()

    // 在右下角加一个微弱的反光（背光面反射）
    ctx.beginPath()
    ctx.ellipse(r * stretch * 0.5, r * flatten * 0.4, r * stretch * 0.15, r * flatten * 0.08, -Math.PI / 6, 0, Math.PI * 2)
    ctx.fillStyle = `rgba(255, 255, 255, ${sw.opacity * 0.3})`
    ctx.fill()
    ctx.restore()

    // --- 周围伴随的小气泡 ---
    // 巨大的主泡泡在运动时会带起一串小泡泡
    for (let i = 0; i < 5; i++) {
      // 在主泡泡后方和侧面生成小泡泡
      const pX = -r * 0.5 - Math.random() * r * 1.5
      const pY = (Math.random() - 0.5) * r * 1.2
      const pSize = r * (0.05 + Math.random() * 0.1)
      
      const pAlpha = sw.opacity * (1 - Math.abs(pX) / (r * 2)) // 越靠后越透明
      if (pAlpha <= 0) continue

      ctx.beginPath()
      ctx.arc(pX, pY, pSize, 0, Math.PI * 2)
      ctx.fillStyle = `rgba(200, 240, 255, ${pAlpha * 0.3})`
      ctx.fill()
      ctx.strokeStyle = `rgba(255, 255, 255, ${pAlpha * 0.8})`
      ctx.lineWidth = Math.max(1, pSize * 0.1)
      ctx.stroke()
      
      // 小气泡上的微型高光
      ctx.beginPath()
      ctx.arc(pX - pSize * 0.3, pY - pSize * 0.3, pSize * 0.2, 0, Math.PI * 2)
      ctx.fillStyle = `rgba(255, 255, 255, ${pAlpha})`
      ctx.fill()
    }

    // --- 前端挤压的水波纹 ---
    // 表现泡泡高速推开海水的力量感
    ctx.beginPath()
    ctx.arc(r * stretch * 0.8, 0, r * 0.8, -Math.PI * 0.25, Math.PI * 0.25)
    ctx.strokeStyle = `rgba(255, 255, 255, ${sw.opacity * 0.4})`
    ctx.lineWidth = r * 0.04
    ctx.lineCap = 'round'
    ctx.stroke()

    ctx.restore()
  })
}

function drawChargeBar(ctx: CanvasRenderingContext2D, fish: Fish, pc: PlayerControlState) {
  const chargeTime = pc.sChargeTime
  const minCharge = 5
  const maxCharge = 10
  const time = performance.now() / 1000

  const progress = Math.min(1, chargeTime / maxCharge)
  const ready = chargeTime >= minCharge
  const overchargeRatio = ready ? (chargeTime - minCharge) / (maxCharge - minCharge) : 0

  ctx.save()

  // Circular charge indicator around the fish
  const ringRadius = fish.appearance.bodyLength * 1.1
  const startAngle = -Math.PI / 2
  const endAngle = startAngle + Math.PI * 2 * progress

  // Background ring
  ctx.beginPath()
  ctx.arc(fish.x, fish.y, ringRadius, 0, Math.PI * 2)
  ctx.strokeStyle = 'rgba(40, 80, 120, 0.4)'
  ctx.lineWidth = 5
  ctx.stroke()

  // Progress ring
  const ringGrad = ctx.createConicGradient(startAngle, fish.x, fish.y)
  if (ready) {
    ringGrad.addColorStop(0, 'rgba(100, 220, 255, 1)')
    ringGrad.addColorStop(progress * 0.7, 'rgba(50, 180, 255, 0.9)')
    ringGrad.addColorStop(progress, 'rgba(200, 240, 255, 1)')
    ringGrad.addColorStop(Math.min(1, progress + 0.01), 'transparent')
    ringGrad.addColorStop(1, 'transparent')
  } else {
    ringGrad.addColorStop(0, 'rgba(80, 140, 180, 0.8)')
    ringGrad.addColorStop(progress, 'rgba(120, 180, 200, 0.6)')
    ringGrad.addColorStop(Math.min(1, progress + 0.01), 'transparent')
    ringGrad.addColorStop(1, 'transparent')
  }
  ctx.beginPath()
  ctx.arc(fish.x, fish.y, ringRadius, startAngle, endAngle)
  ctx.strokeStyle = ringGrad
  ctx.lineWidth = 5
  ctx.lineCap = 'round'
  ctx.stroke()

  // Energy particles orbiting when charging
  if (ready) {
    const particleCount = 3 + Math.floor(overchargeRatio * 4)
    for (let i = 0; i < particleCount; i++) {
      const angle = time * (2 + i * 0.3) + (i * Math.PI * 2) / particleCount
      const dist = ringRadius + Math.sin(time * 4 + i) * 5
      const px = fish.x + Math.cos(angle) * dist
      const py = fish.y + Math.sin(angle) * dist
      const size = 2 + overchargeRatio * 2
      ctx.beginPath()
      ctx.arc(px, py, size, 0, Math.PI * 2)
      ctx.fillStyle = `rgba(180, 230, 255, ${0.6 + Math.sin(time * 6 + i) * 0.3})`
      ctx.fill()
    }
  }

  // Mouth direction indicator (shows where the shockwave will go)
  if (ready) {
    const dirLen = ringRadius + 15 + Math.sin(time * 4) * 5
    const tipX = fish.x + Math.cos(fish.angle) * dirLen
    const tipY = fish.y + Math.sin(fish.angle) * dirLen
    const arrowSize = 6
    ctx.beginPath()
    ctx.moveTo(tipX + Math.cos(fish.angle) * arrowSize, tipY + Math.sin(fish.angle) * arrowSize)
    ctx.lineTo(tipX + Math.cos(fish.angle + 2.5) * arrowSize, tipY + Math.sin(fish.angle + 2.5) * arrowSize)
    ctx.lineTo(tipX + Math.cos(fish.angle - 2.5) * arrowSize, tipY + Math.sin(fish.angle - 2.5) * arrowSize)
    ctx.closePath()
    ctx.fillStyle = `rgba(100, 220, 255, ${0.7 + Math.sin(time * 5) * 0.2})`
    ctx.fill()
  }

  // Text label
  ctx.fillStyle = ready ? 'rgba(150, 230, 255, 0.95)' : 'rgba(200, 200, 200, 0.7)'
  ctx.font = 'bold 10px sans-serif'
  ctx.textAlign = 'center'
  const labelY = fish.y - ringRadius - 12
  if (ready) {
    ctx.fillText(`松开释放 (${Math.floor(overchargeRatio * 100)}%威力)`, fish.x, labelY)
  } else {
    ctx.fillText(`蓄力 ${chargeTime.toFixed(1)}s / ${minCharge}s`, fish.x, labelY)
  }

  // Inner glow pulse when ready
  if (ready) {
    const pulse = 0.2 + overchargeRatio * 0.3 + Math.sin(time * 3) * 0.1
    const innerGlow = ctx.createRadialGradient(fish.x, fish.y, 0, fish.x, fish.y, ringRadius * 0.8)
    innerGlow.addColorStop(0, `rgba(80, 180, 255, ${pulse * 0.3})`)
    innerGlow.addColorStop(1, 'rgba(80, 180, 255, 0)')
    ctx.beginPath()
    ctx.arc(fish.x, fish.y, ringRadius * 0.8, 0, Math.PI * 2)
    ctx.fillStyle = innerGlow
    ctx.fill()
  }

  ctx.restore()
}

function drawCooldownIndicator(ctx: CanvasRenderingContext2D, fish: Fish, cooldown: number) {
  ctx.save()
  const maxCooldown = 15
  const progress = cooldown / maxCooldown
  const radius = fish.appearance.bodyLength * 0.6

  // Small cooldown arc
  ctx.beginPath()
  ctx.arc(fish.x, fish.y + fish.appearance.bodyLength + 15, radius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - progress))
  ctx.strokeStyle = 'rgba(100, 150, 200, 0.4)'
  ctx.lineWidth = 2
  ctx.lineCap = 'round'
  ctx.stroke()

  ctx.fillStyle = 'rgba(180, 200, 220, 0.6)'
  ctx.font = '9px sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText(`${Math.ceil(cooldown)}s`, fish.x, fish.y + fish.appearance.bodyLength + 18)
  ctx.restore()
}

onMounted(() => {
  const canvas = canvasRef.value!
  const fxCanvas = fxCanvasRef.value!
  ctx = canvas.getContext('2d')!
  fxCtx = fxCanvas.getContext('2d')!
  fishRenderer = new FishRenderer()
  ambientEffects = new AmbientEffects(window.innerWidth, window.innerHeight)
  foregroundEffects = new ForegroundEffects(window.innerWidth, window.innerHeight)
  resize()
  window.addEventListener('resize', resize)
  render()
})

onUnmounted(() => {
  cancelAnimationFrame(animId)
  window.removeEventListener('resize', resize)
})
</script>

<style scoped>
.game-container {
  position: relative;
  width: 100%;
  height: 100%;
  cursor: pointer;
  overflow: hidden;
}

.bg-layer {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  z-index: 0;
}

.bg-fallback {
  background: linear-gradient(180deg, #1a5276 0%, #1f6f8b 30%, #154360 70%, #0d2f4a 100%);
}

.canvas-layer {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  z-index: 1;
}

.fx-layer {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  z-index: 2;
  pointer-events: none;
}
</style>
