<script setup lang="ts">
import { computed } from 'vue'
import { easeInCubic, easeInOutCubic, easeOutCubic, lerp, progress } from './timeline'
import { useCardBase } from './cardBase'
import { useSceneBox } from './sceneBase'
import SceneBackdrop from './SceneBackdrop.vue'

// 「声波过渡」：段落之间的转场。阶段按总时长 T 的比例排（拉长 = 整体放慢，不是在中间干等）：
//   扫光 0–18%：一道光从左扫到右，留下一条发亮的基线；
//   起波 12–45%：基线炸成声波 —— 主声波柱（上下对称、中间高两边低、像说话的音量在跳）+ 3 条示波器曲线 + 扩散波纹 + 沿波飘的光点；
//   峰值 45–60%：振幅冲顶、中心闪光；遮挡模式下这时从中线往上下铺满整屏（盖住剪辑点），再收回去；
//   衰减 65–90%：声波回落成直线；收束 88–100%：直线收拢成中心一个点、淡出。
// 每根柱子的高度、每条线的起伏都由 t 和固定种子算（不用随机数），导出逐帧截图和预览一致。
export interface SoundwaveData { mode: string; label: string; palette: string; intensity: string; accent: string; panel: boolean; fullscreen: boolean; scene: boolean; duration: number }
const props = defineProps<{ data: SoundwaveData; t: number }>()
const emit = defineEmits<{ size: [{ w: number; h: number }] }>()
const { root, rootStyle, enter } = useCardBase(props, emit, { exit: 'none', out: 0.01 })
const { w, h } = useSceneBox(root)
const uid = `sw${Math.random().toString(36).slice(2, 8)}`

const T = computed(() => Math.max(1.2, props.data.duration))
const at = (f: number) => f * T.value
const cx = computed(() => w.value / 2)
const cy = computed(() => h.value / 2)
const K = computed(() => ({ soft: 0.62, normal: 1, strong: 1.35 })[props.data.intensity as 'soft'] ?? 1)
const HMAX = computed(() => h.value * 0.3 * K.value)

// ── 振幅包络 ──
const bell = (x: number, c: number, s: number) => Math.exp(-(((x - c) / s) ** 2))
const scanP = computed(() => easeInOutCubic(progress(props.t, 0, at(0.18))))
const build = computed(() => easeOutCubic(progress(props.t, at(0.12), at(0.45))))
const decay = computed(() => easeInCubic(progress(props.t, at(0.65), at(0.9))))
const punch = computed(() => 1 + 0.4 * bell(props.t, at(0.52), at(0.05)))
const A = computed(() => build.value * (1 - decay.value) * punch.value)
const collapse = computed(() => easeInOutCubic(progress(props.t, at(0.88), at(1))))
const scanX = computed(() => lerp(0, w.value, scanP.value))

// ── 固定种子的噪声 ──
const hash = (i: number, k: number) => { const x = Math.sin(i * 127.1 + k * 311.7) * 43758.5453; return x - Math.floor(x) }
// 平滑噪声：每秒换 12 次值，两次之间线性过渡（不然柱子一帧一个高度，抖得像坏了）
const smooth = (i: number, t: number) => {
  const f = t * 12, k = Math.floor(f), fr = f - k
  return lerp(hash(i, k), hash(i, k + 1), fr * fr * (3 - 2 * fr))
}

// ── 主声波柱 ──
const BAR_W = 8
const N = computed(() => Math.max(40, Math.round(w.value / 18)))
const winX = (x: number) => 0.18 + 0.82 * bell(x, cx.value, w.value * 0.3)
const bars = computed(() => {
  const n = N.value, out: { x: number; hh: number; o: number }[] = []
  const shrink = 1 - collapse.value
  for (let i = 0; i < n; i++) {
    const x0 = ((i + 0.5) / n) * w.value
    // 收束时所有柱子往中心靠拢
    const x = lerp(cx.value, x0, shrink)
    if (x0 > scanX.value + 2) continue
    const speech = Math.abs(Math.sin(i * 0.37 + props.t * 7.1)) * 0.45 + Math.abs(Math.sin(i * 0.13 - props.t * 4.3 + 1)) * 0.3 + smooth(i, props.t) * 0.45
    const hh = Math.max(2, A.value * winX(x0) * speech * HMAX.value)
    out.push({ x, hh, o: 0.35 + 0.65 * winX(x0) })
  }
  return out
})

// ── 示波器曲线 ──
const LINES = [
  { amp: 0.55, f: 0.0062, sp: 3.1, ph: 0, sw: 4.5, op: 0.95, key: 'c1' },
  { amp: 0.38, f: 0.0105, sp: -4.4, ph: 1.7, sw: 2.6, op: 0.6, key: 'c2' },
  { amp: 0.25, f: 0.017, sp: 6.2, ph: 3.1, sw: 1.6, op: 0.45, key: 'c1' },
]
const linePath = (l: (typeof LINES)[number]) => {
  const pts: string[] = []
  const end = Math.min(w.value, scanX.value)
  const steps = 160
  for (let k = 0; k <= steps; k++) {
    const x0 = (k / steps) * end
    const x = lerp(cx.value, x0, 1 - collapse.value)
    const y = cy.value + A.value * l.amp * HMAX.value * bell(x0, cx.value, w.value * 0.34) * Math.sin(x0 * l.f + props.t * l.sp + l.ph)
    pts.push(`${k ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`)
  }
  return pts.join(' ')
}

// ── 扩散波纹（峰值前后三圈）──
const ripples = computed(() => [0.42, 0.5, 0.58].map((f) => {
  const p = progress(props.t, at(f), at(f) + 0.7)
  return { p, rx: lerp(40, w.value * 0.62, easeOutCubic(p)), op: p > 0 && p < 1 ? (1 - p) * 0.7 : 0, sw: lerp(4, 0.6, p) }
}))
const flash = computed(() => bell(props.t, at(0.52), at(0.06)) * K.value)

// ── 沿主曲线飘的光点 ──
const motes = Array.from({ length: 28 }, (_, i) => ({ s: 2.5 + hash(i, 2) * 4, sp: 0.06 + hash(i, 3) * 0.12, ph: hash(i, 4) }))
const moteXY = (m: (typeof motes)[number]) => {
  const x0 = ((m.ph + props.t * m.sp) % 1) * w.value
  if (x0 > scanX.value) return null
  const l = LINES[0]
  const y = cy.value + A.value * l.amp * HMAX.value * bell(x0, cx.value, w.value * 0.34) * Math.sin(x0 * l.f + props.t * l.sp + l.ph)
  return { x: lerp(cx.value, x0, 1 - collapse.value), y, o: A.value * (0.4 + 0.6 * bell(x0, cx.value, w.value * 0.3)) }
}

// ── 遮挡转场：峰值时从中线往上下铺满整屏，再收回去 ──
const cover = computed(() => {
  if (props.data.mode !== 'wipe') return 0
  const open = easeInOutCubic(progress(props.t, at(0.4), at(0.5)))
  const close = easeInOutCubic(progress(props.t, at(0.58), at(0.7)))
  return open * (1 - close)
})

// ── 颜色 ──
const PAL: Record<string, { c1: string; c2: string; multi?: string[] }> = {
  accent: { c1: 'var(--accent)', c2: 'color-mix(in srgb, var(--accent) 30%, #fff)' },
  cyan: { c1: '#2B8CFF', c2: '#9FF4FF' },
  multi: { c1: '#FF5E7E', c2: '#FFF3D6', multi: ['#FF5E7E', '#FFB547', '#3EE6FF', '#8A6BFF'] },
}
const pal = computed(() => PAL[props.data.palette] || PAL.accent)

// 基线（扫光留下的那条）+ 扫光头
const baseline = computed(() => {
  const x1 = lerp(cx.value, 0, 1 - collapse.value), x2 = lerp(cx.value, scanX.value, 1 - collapse.value)
  return { x1, x2 }
})
const headOn = computed(() => props.t < at(0.2) && scanP.value > 0 && scanP.value < 1)
const dotOp = computed(() => collapse.value > 0 ? (1 - easeInCubic(progress(props.t, at(0.95), at(1)))) : 0)
const labelStyle = computed(() => {
  const s = enter(props.t, at(0.5), Math.max(0.3, at(0.14)), 24)
  return { ...s, opacity: Number(s.opacity) * (1 - decay.value) }
})
const fade = computed(() => easeOutCubic(progress(props.t, 0, 0.12)))
</script>

<template>
  <div ref="root" class="swc" :style="[rootStyle, { '--glowc': pal.c1 }]">
    <!-- 全屏背景里那几团光也跟着所选配色（不然青蓝声波配一屏橙光） -->
    <div v-if="data.mode === 'full'" class="swc-bg" :style="data.palette === 'accent' ? {} : { '--accent': pal.c1 }">
      <SceneBackdrop :t="t" :duration="data.duration" />
    </div>
    <svg class="swc-svg" :viewBox="`0 0 ${w} ${h}`" :width="w" :height="h" :opacity="fade">
      <defs>
        <linearGradient :id="`${uid}bar`" gradientUnits="userSpaceOnUse" x1="0" :y1="cy - HMAX" x2="0" :y2="cy + HMAX">
          <stop offset="0" :stop-color="pal.c1" />
          <stop offset="0.5" :stop-color="pal.c2" />
          <stop offset="1" :stop-color="pal.c1" />
        </linearGradient>
        <linearGradient v-if="pal.multi" :id="`${uid}mx`" gradientUnits="userSpaceOnUse" x1="0" y1="0" :x2="w" y2="0">
          <stop v-for="(c, k) in pal.multi" :key="k" :offset="k / (pal.multi.length - 1)" :stop-color="c" />
        </linearGradient>
        <radialGradient :id="`${uid}flash`"><stop offset="0" :stop-color="pal.c2" stop-opacity="0.9" /><stop offset="0.4" :stop-color="pal.c1" stop-opacity="0.35" /><stop offset="1" :stop-color="pal.c1" stop-opacity="0" /></radialGradient>
        <linearGradient :id="`${uid}cover`" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" :stop-color="pal.c1" stop-opacity="0.75" />
          <stop offset="0.18" stop-color="#0B0C10" />
          <stop offset="0.82" stop-color="#0B0C10" />
          <stop offset="1" :stop-color="pal.c1" stop-opacity="0.75" />
        </linearGradient>
      </defs>

      <!-- 遮挡转场：从中线往上下铺开的整屏底（上下两道边是亮的） -->
      <g v-if="cover > 0">
        <rect x="0" :y="cy - (h / 2) * cover" :width="w" :height="h * cover" :fill="`url(#${uid}cover)`" />
        <rect x="0" :y="cy - (h / 2) * cover - 3" :width="w" height="6" :fill="pal.c2" :opacity="0.8 * (1 - cover * 0.6)" />
        <rect x="0" :y="cy + (h / 2) * cover - 3" :width="w" height="6" :fill="pal.c2" :opacity="0.8 * (1 - cover * 0.6)" />
      </g>

      <!-- 中心闪光 -->
      <ellipse :cx="cx" :cy="cy" :rx="w * 0.32" :ry="h * 0.42" :fill="`url(#${uid}flash)`" :opacity="flash" />

      <!-- 扩散波纹 -->
      <ellipse v-for="(r, k) in ripples" :key="'r' + k" :cx="cx" :cy="cy" :rx="r.rx" :ry="r.rx * 0.34" fill="none" :stroke="pal.c2" :stroke-width="r.sw" :opacity="r.op" />

      <!-- 基线 -->
      <line :x1="baseline.x1" :y1="cy" :x2="baseline.x2" :y2="cy" :stroke="pal.c2" stroke-width="2.5" :opacity="0.5 + 0.5 * (1 - A)" class="swc-glow" />

      <!-- 主声波柱 -->
      <g class="swc-glow">
        <rect
          v-for="(b, k) in bars" :key="'b' + k" :x="b.x - BAR_W / 2" :y="cy - b.hh" :width="BAR_W" :height="b.hh * 2" :rx="BAR_W / 2"
          :fill="pal.multi ? `url(#${uid}mx)` : `url(#${uid}bar)`" :opacity="b.o"
        />
      </g>

      <!-- 示波器曲线 -->
      <g class="swc-glow">
        <path v-for="(l, k) in LINES" :key="'l' + k" :d="linePath(l)" fill="none" :stroke="pal.multi ? `url(#${uid}mx)` : l.key === 'c1' ? pal.c1 : pal.c2" :stroke-width="l.sw" :opacity="l.op * Math.min(1, A * 2 + 0.2)" stroke-linecap="round" stroke-linejoin="round" />
      </g>

      <!-- 光点 -->
      <template v-for="(m, k) in motes" :key="'m' + k">
        <circle v-if="moteXY(m)" :cx="moteXY(m)!.x" :cy="moteXY(m)!.y" :r="m.s" :fill="pal.c2" :opacity="moteXY(m)!.o" />
      </template>

      <!-- 扫光头 -->
      <g v-if="headOn" :transform="`translate(${scanX.toFixed(1)} ${cy.toFixed(1)})`">
        <ellipse rx="140" ry="6" :fill="pal.c2" opacity="0.55" class="swc-glow" />
        <circle r="9" fill="#fff" class="swc-glow" />
      </g>

      <!-- 收束：中心一个点 -->
      <circle :cx="cx" :cy="cy" :r="lerp(3, 12, collapse)" fill="#fff" :opacity="dotOp" class="swc-glow" />
    </svg>
    <div v-if="data.label" class="swc-lwrap" :style="{ top: `${data.mode === 'wipe' ? cy - 60 : cy + HMAX + 30}px` }">
      <div class="swc-label" :style="labelStyle">{{ data.label }}</div>
    </div>
  </div>
</template>

<style scoped>
.swc { position: relative; width: var(--cw); height: var(--ch); overflow: hidden; color: var(--fg); font-family: var(--font-cn); }
.swc-bg { position: absolute; inset: 0; }
.swc-svg { position: absolute; left: 0; top: 0; overflow: visible; }
/* 光晕：用 CSS filter 的 drop-shadow（不用 backdrop-filter，导出时后面没有画面） */
/* 光晕颜色跟着所选配色走（--glowc），写死成主题色的话青蓝声波外面一圈橙光 */
.swc-glow { filter: drop-shadow(0 0 6px rgba(255, 255, 255, 0.35)) drop-shadow(0 0 18px color-mix(in srgb, var(--glowc, var(--accent)) 60%, transparent)); }
/* 遮挡模式：字放在正中（这时整屏是暗底）；其余模式放在声波下方 */
.swc-lwrap { position: absolute; left: 0; right: 0; display: flex; justify-content: center; }
/* 字压在声波上会看不清：给一块实的深色圆角底（不用毛玻璃，导出时后面没有画面） */
.swc-label {
  padding: 14px 44px; border-radius: 18px; white-space: nowrap;
  font-size: 80px; font-weight: 800; letter-spacing: 0.08em; color: #fff; background: rgba(7, 8, 11, 0.82);
  box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--glowc, var(--accent)) 55%, transparent), 0 0 40px color-mix(in srgb, var(--glowc, var(--accent)) 35%, transparent);
}
</style>
