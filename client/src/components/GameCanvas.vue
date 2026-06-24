<template>
  <div class="game-container" @click="handleClick">
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
import type { Fish, Food, PhysicalBubble } from '../game/types'
import type { BossEntity } from '../game/StoryEventEngine'
import { FishRenderer } from '../game/FishRenderer'
import { AmbientEffects } from '../game/AmbientEffects'
import { ForegroundEffects } from '../game/ForegroundEffects'

const props = defineProps<{
  fishes: Fish[]
  foods: Food[]
  physicalBubbles?: PhysicalBubble[]
  boss?: BossEntity | null
}>()

const emit = defineEmits<{
  feed: [e: MouseEvent]
  pet: [x: number, y: number]
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

function handleClick(e: MouseEvent) {
  const canvas = canvasRef.value
  if (!canvas) return
  const rect = canvas.getBoundingClientRect()
  const x = e.clientX - rect.left
  const y = e.clientY - rect.top

  // Check if clicking on a fish first
  const hitFish = props.fishes.find(fish => {
    const dx = x - fish.x
    const dy = y - fish.y
    return Math.sqrt(dx * dx + dy * dy) < fish.appearance.bodyLength * 0.8
  })

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

  // Click particles on FX layer
  drawClickParticles(fxCtx, dt)

  animId = requestAnimationFrame(render)
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
