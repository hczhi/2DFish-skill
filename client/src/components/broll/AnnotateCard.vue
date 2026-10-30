<script setup lang="ts">
import { computed } from 'vue'
import { easeInOutCubic, easeOutBack, easeOutCubic, lerp, progress } from './timeline'
import { useCardBase } from './cardBase'

// 「画面标注」卡：直接标在口播画面上的东西（他手里举的产品、身后屏幕上的一行字）。没有底板，拖到目标上就行。
// 四种（data.shape）：
//   circle   手绘圈 —— 一笔逆时针画出一个略歪的椭圆，收笔越过起点一点，画完静置；
//   arrows   双箭头 —— 两支手绘箭头从对角几乎同时画向目标，箭尖留白不戳到目标；
//   reticle  准星咬合 —— 四个 L 角从画外扑向目标，先比目标大一圈、收过头再回弹钉死，咬合那一下闪一次，标签弹出；
//   callout  引出线 —— 目标上一个圆点亮起，折线向外生长，线端文字标签揭示（三拍严格串行）。
// 目标区域是 w × h（画布像素，s = 1 时）；卡片比目标四周多留 PAD 给箭头 / 角框。只能手动加（位置只有他知道）。
// SVG 里的旋转缩放一律用 SVG 属性算好坐标，不用 CSS transform（无头浏览器里 SVG 的 CSS 变换原点不一致）。

export interface AnnotateData {
  shape: 'circle' | 'arrows' | 'reticle' | 'callout'
  w: string
  h: string
  text: string
  side: 'right' | 'left'
  accent: string
  duration: number
}

const props = defineProps<{ data: AnnotateData; t: number }>()
const emit = defineEmits<{ size: [{ w: number; h: number }] }>()
const { root, rootStyle } = useCardBase(props, emit, { out: 0.35, exit: 'none' })

const num = (v: string, fb: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Number(v) || fb))
const TW = computed(() => num(props.data.w, 420, 60, 1800))
const TH = computed(() => num(props.data.h, 260, 40, 1000))
const PAD = computed(() => (props.data.shape === 'arrows' ? 190 : props.data.shape === 'callout' ? 0 : 40))
const W = computed(() => (props.data.shape === 'callout' ? CALLOUT_W : TW.value + PAD.value * 2))
const H = computed(() => (props.data.shape === 'callout' ? CALLOUT_H : TH.value + PAD.value * 2))
const cx = computed(() => W.value / 2)
const cy = computed(() => H.value / 2)

// ── 手绘圈：参数方程 + 两个固定的正弦扰动（不随机，同一个 t 画出来永远一样） ──
const circlePath = computed(() => {
  const rx = TW.value / 2 + 10, ry = TH.value / 2 + 8
  const pts: string[] = []
  const N = 64
  // 从左上起笔，逆时针多画 0.12 圈（收笔越过起点）
  for (let k = 0; k <= N; k++) {
    const a = -2.3 - (k / N) * Math.PI * 2 * 1.12
    const wob = 1 + 0.035 * Math.sin(a * 3 + 0.7) + 0.02 * Math.sin(a * 5 + 1.9)
    const drift = (k / N) * 14 // 收笔比起笔往外飘一点，像手画的
    const x = cx.value + Math.cos(a) * (rx * wob + drift)
    const y = cy.value + Math.sin(a) * (ry * wob + drift * 0.6) - 0.06 * ry * Math.cos(a)
    pts.push(`${k ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`)
  }
  return pts.join(' ')
})
const circleDraw = computed(() => easeInOutCubic(progress(props.t, 0.15, 0.85)))

// ── 双箭头：左上、右下两支，弧线沿对角线指向目标的两个角，箭尖离目标留 22px ──
const arrow = (from: 'tl' | 'br') => {
  const P = PAD.value, gap = 22
  const tl = from === 'tl'
  // 起点在卡片对角，终点停在目标那个角外面一点（箭尖不戳进目标），沿对角线指进去
  const sx = tl ? 16 : W.value - 16, sy = tl ? 16 : H.value - 16
  const ex = tl ? P - gap : P + TW.value + gap, ey = tl ? P - gap : P + TH.value + gap
  // 控制点：中点往垂直方向鼓出去一点，线是一道弧
  const mxp = (sx + ex) / 2, myp = (sy + ey) / 2
  const len = Math.hypot(ex - sx, ey - sy) || 1
  const nx = -(ey - sy) / len, ny = (ex - sx) / len
  const qx = mxp + nx * len * 0.22, qy = myp + ny * len * 0.22
  const ang = Math.atan2(ey - qy, ex - qx)
  const head = (da: number) => `${(ex - Math.cos(ang + da) * 34).toFixed(1)} ${(ey - Math.sin(ang + da) * 34).toFixed(1)}`
  return { body: `M${sx} ${sy} Q${qx.toFixed(1)} ${qy.toFixed(1)} ${ex} ${ey}`, head: `M${head(0.5)} L${ex} ${ey} L${head(-0.5)}` }
}
const ARROWS = ['tl', 'br'] as const
const arrowDraw = (i: number) => easeInOutCubic(progress(props.t, 0.15 + i * 0.08, 0.6 + i * 0.08))
const headDraw = (i: number) => easeOutCubic(progress(props.t, 0.6 + i * 0.08, 0.78 + i * 0.08))

// ── 准星：四个 L 角 ──
const LOCK = 0.55
const reticleScale = computed(() => {
  const t = props.t
  if (t < LOCK) return 2.2
  // 2.2 → 0.94 → 1
  if (t < LOCK + 0.18) return lerp(2.2, 0.94, easeInOutCubic(progress(t, LOCK, LOCK + 0.18)))
  return lerp(0.94, 1, easeOutCubic(progress(t, LOCK + 0.18, LOCK + 0.36)))
})
const corners = computed(() => {
  const L = Math.min(70, TW.value * 0.3, TH.value * 0.3)
  const s = reticleScale.value
  const hw = (TW.value / 2) * s, hh = (TH.value / 2) * s
  // 飞入：每个角从各自方向 1000px 外扑进来
  const fly = 1 - easeOutCubic(progress(props.t, 0.05, LOCK))
  return ([[-1, -1], [1, -1], [1, 1], [-1, 1]] as const).map(([dx, dy]) => {
    const x = cx.value + dx * (hw + fly * 1000), y = cy.value + dy * (hh + fly * 600)
    // 竖边、横边都朝目标里面伸
    return `M${x} ${y - dy * L} L${x} ${y} L${x - dx * L} ${y}`
  })
})
const lockFlash = computed(() => Math.sin(progress(props.t, LOCK + 0.18, LOCK + 0.45) * Math.PI))
const reticleOn = computed(() => props.t >= 0.05)

// ── 引出线：圆点在左下（side = left 时镜像到右下），折线向斜上再水平 ──
const CALLOUT_W = 760
const CALLOUT_H = 300
const mirror = computed(() => props.data.side === 'left')
const mx = (x: number) => (mirror.value ? CALLOUT_W - x : x)
const DOT = { x: 40, y: 260 }
const ELBOW = { x: 200, y: 110 }
const END = { x: 400, y: 110 }
const dotP = computed(() => easeOutBack(progress(props.t, 0.1, 0.4)))
const line1 = computed(() => easeInOutCubic(progress(props.t, 0.4, 0.7)))
const line2 = computed(() => easeInOutCubic(progress(props.t, 0.7, 0.95)))
const calloutPath = computed(() => {
  const a = line1.value, b = line2.value
  const x1 = lerp(DOT.x, ELBOW.x, a), y1 = lerp(DOT.y, ELBOW.y, a)
  let d = `M${mx(DOT.x)} ${DOT.y} L${mx(x1)} ${y1}`
  if (a >= 1) d += ` L${mx(lerp(ELBOW.x, END.x, b))} ${END.y}`
  return d
})
const labelStyle = computed(() => {
  const p = easeOutCubic(progress(props.t, 0.95, 1.35))
  return {
    left: mirror.value ? undefined : `${END.x + 20}px`,
    right: mirror.value ? `${END.x + 20}px` : undefined,
    top: `${END.y}px`,
    opacity: p,
    clipPath: mirror.value ? `inset(-20% 0 -20% ${100 - p * 100}%)` : `inset(-20% ${100 - p * 100}% -20% 0)`,
  }
})
const reticleLabelStyle = computed(() => {
  const p = progress(props.t, LOCK + 0.18, LOCK + 0.5)
  return { left: `${cx.value + TW.value / 2 + 24}px`, top: `${cy.value - TH.value / 2}px`, opacity: easeOutCubic(p), transform: `scale(${lerp(0.6, 1, easeOutBack(p))})` }
})
</script>

<template>
  <div ref="root" class="an" :style="[rootStyle, { width: `${W}px`, height: `${H}px` }]">
    <svg class="an-svg" :width="W" :height="H" :viewBox="`0 0 ${W} ${H}`" overflow="visible">
      <path v-if="data.shape === 'circle'" class="an-ink" :d="circlePath" pathLength="1" :style="{ strokeDashoffset: 1 - circleDraw, opacity: t >= 0.15 ? 1 : 0 }" />

      <template v-else-if="data.shape === 'arrows'">
        <template v-for="(k, i) in ARROWS" :key="k">
          <path class="an-ink" :d="arrow(k).body" pathLength="1" :style="{ strokeDashoffset: 1 - arrowDraw(i), opacity: arrowDraw(i) > 0 ? 1 : 0 }" />
          <path class="an-ink" :d="arrow(k).head" pathLength="1" :style="{ strokeDashoffset: 1 - headDraw(i), opacity: headDraw(i) > 0 ? 1 : 0 }" />
        </template>
      </template>

      <template v-else-if="data.shape === 'reticle'">
        <path v-for="(d, i) in corners" :key="i" class="an-ink an-sharp" :d="d" :style="{ opacity: reticleOn ? 1 : 0 }" />
        <rect
          :x="cx - TW / 2" :y="cy - TH / 2" :width="TW" :height="TH" rx="8" class="an-flash" :style="{ opacity: 0.28 * lockFlash }"
        />
      </template>

      <template v-else>
        <circle class="an-dot" :cx="mx(DOT.x)" :cy="DOT.y" :r="16 * dotP" />
        <circle class="an-ring" :cx="mx(DOT.x)" :cy="DOT.y" :r="16 + 22 * dotP" :style="{ opacity: 0.5 * (1 - progress(t, 0.3, 0.9)) }" />
        <path class="an-ink an-sharp" :d="calloutPath" :style="{ opacity: line1 > 0 ? 1 : 0 }" />
      </template>
    </svg>
    <div v-if="data.shape === 'callout' && data.text" class="an-label" :style="labelStyle">{{ data.text }}</div>
    <div v-if="data.shape === 'reticle' && data.text" class="an-label an-tag" :style="reticleLabelStyle">{{ data.text }}</div>
  </div>
</template>

<style scoped>
.an { position: relative; color: var(--fg); font-family: var(--font-cn); }
.an-svg { position: absolute; left: 0; top: 0; overflow: visible; }
/* 压在口播画面上：粗一点 + 一圈暗色投影，浅色背景上也看得清 */
.an-ink {
  fill: none; stroke: var(--accent); stroke-width: 11; stroke-linecap: round; stroke-linejoin: round; stroke-dasharray: 1;
  filter: drop-shadow(0 3px 6px var(--shadow-c));
}
.an-sharp { stroke-dasharray: none; stroke-width: 9; }
.an-flash { fill: var(--accent); }
.an-dot { fill: var(--accent); filter: drop-shadow(0 0 10px var(--accent)); }
.an-ring { fill: none; stroke: var(--accent); stroke-width: 4; }
.an-label {
  position: absolute; translate: 0 -50%; padding: 14px 30px; border-radius: 14px; white-space: nowrap;
  background: var(--panel); border: 3px solid var(--accent); font-size: 52px; font-weight: 800;
  box-shadow: 0 20px 40px -14px var(--shadow-c);
}
.an-tag { translate: 0 0; transform-origin: left top; font-size: 44px; padding: 10px 24px; }
</style>
