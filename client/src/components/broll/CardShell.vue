<script setup lang="ts">
import { computed } from 'vue'
import { progress, easeOutCubic, easeInCubic, lerp } from './timeline'
import './material.css'

// 所有卡共用的底板材质：毛玻璃底 + 颗粒噪点 + 淡点阵 + 角落一团主题色光 + 顶边高光 + 投影，
// 四角刻度、右下角一条按停留时间走的细进度线，入场后每隔几秒一道扫光（停住时画面不是死的）。
// 铺在卡片最底层（absolute inset 0），卡片内容自己排在上面。全部按 t 算，不用 CSS 动画（导出逐帧截图要一致）。

const props = defineProps<{ t: number; duration: number }>()

const IN = 0.5
const OUT = 0.45
const SWEEP_FIRST = 0.7 // 第一道扫光在入场后不久
const SWEEP_EVERY = 3.4
const SWEEP_LEN = 0.9

const inP = computed(() => easeOutCubic(progress(props.t, 0, IN)))
const outP = computed(() => easeInCubic(progress(props.t, props.duration - OUT, props.duration)))
const shellStyle = computed(() => ({
  opacity: inP.value * (1 - outP.value),
  transform: `scale(${lerp(0.965, 1, inP.value) - outP.value * 0.02})`,
  filter: `blur(${lerp(10, 0, inP.value) + outP.value * 8}px)`,
}))

// 扫光：第 k 道从 SWEEP_FIRST + k*SWEEP_EVERY 开始，横扫 SWEEP_LEN 秒；出场前 1 秒不再起新的
const sweepX = computed(() => {
  const t = props.t - SWEEP_FIRST
  if (t < 0 || props.t > props.duration - 1) return -1
  const local = t % SWEEP_EVERY
  return local > SWEEP_LEN ? -1 : easeOutCubic(local / SWEEP_LEN)
})
const sheenStyle = computed(() => ({
  opacity: sweepX.value < 0 ? 0 : 1,
  transform: `translateX(${lerp(-120, 120, Math.max(0, sweepX.value))}%)`,
}))
// 光晕随时间缓慢呼吸
const glowStyle = computed(() => ({ opacity: 0.55 + 0.25 * Math.sin(props.t * 1.4) }))
const ticksStyle = computed(() => {
  const p = easeOutCubic(progress(props.t, 0.15, 0.6))
  return { opacity: p * 0.9, '--tk': `${lerp(0, 28, p)}px` }
})
// 漂浮符号（纸感主题才显示，由 --glyph-a 控制）：位置 / 景深 / 漂移速度都由固定种子算，画面只由 t 决定
const hash = (i: number, k: number) => { const x = Math.sin(i * 127.1 + k * 311.7) * 43758.5453; return x - Math.floor(x) }
const GLYPHS = ['#', '*', '[ ]', '~', '·', '{ }', '+', '/', '##', '*']
// 只放在底板四周（压在字上会干扰阅读）：横向落在底板范围内的，纵向就放到上方或下方那一圈
const ring = (i: number) => {
  const x = -16 + hash(i, 1) * 132
  const inside = x > 2 && x < 98
  const y = inside ? (hash(i, 2) < 0.5 ? -34 + hash(i, 7) * 26 : 108 + hash(i, 7) * 26) : -30 + hash(i, 2) * 160
  return { x, y }
}
const glyphs = Array.from({ length: 18 }, (_, i) => ({
  ch: GLYPHS[i % GLYPHS.length],
  ...ring(i), // %，飘在底板外面一圈
  z: hash(i, 3), // 0 远 → 1 近
  ph: hash(i, 4) * Math.PI * 2,
  accent: hash(i, 5) > 0.78,
}))
const glyphStyle = (g: (typeof glyphs)[number], k: number) => {
  const appear = easeOutCubic(progress(props.t, 0.2 + hash(k, 6) * 0.6, 0.8 + hash(k, 6) * 0.6))
  const size = 28 + g.z * 46
  return {
    left: `${g.x}%`, top: `${g.y}%`, fontSize: `${size}px`,
    color: g.accent ? 'var(--accent)' : 'var(--mute)',
    opacity: appear * (0.25 + g.z * 0.55) * (1 - outP.value),
    filter: `blur(${(1 - g.z) * 3.5}px)`,
    transform: `translate(${Math.sin(props.t * 0.5 + g.ph) * 18 * (0.4 + g.z)}px, ${-props.t * (6 + g.z * 14) + Math.cos(props.t * 0.6 + g.ph) * 8}px) rotate(${Math.sin(props.t * 0.3 + g.ph) * 20}deg)`,
  }
}
const progressW = computed(() => `${Math.min(1, Math.max(0, props.t / Math.max(0.1, props.duration))) * 100}%`)
</script>

<template>
  <div class="sh" :style="shellStyle">
    <div class="sh-clip">
      <div class="sh-base" />
      <div class="sh-glow" :style="glowStyle" />
      <div class="sh-grid" />
      <div class="sh-grain" />
      <div class="sh-sheen" :style="sheenStyle" />
      <div class="sh-top" />
    </div>
    <div class="sh-glyphs"><span v-for="(g, k) in glyphs" :key="k" :style="glyphStyle(g, k)">{{ g.ch }}</span></div>
    <div class="sh-ticks" :style="ticksStyle"><i class="a" /><i class="b" /><i class="c" /><i class="d" /></div>
    <div class="sh-meta">
      <span class="sh-bar"><i :style="{ width: progressW }" /></span>
    </div>
  </div>
</template>

<style scoped>
.sh { position: absolute; inset: 0; pointer-events: none; }
.sh-clip {
  position: absolute; inset: 0; border-radius: 14px; overflow: hidden;
  box-shadow:
    inset 0 0 0 1.5px color-mix(in srgb, var(--accent) 22%, transparent),
    inset 0 1px 0 var(--hi),
    0 40px 90px -20px var(--shadow-c),
    0 0 0 1px color-mix(in srgb, var(--shadow-c) 60%, transparent);
}
/* 不用 backdrop-filter（毛玻璃）：导出的是透明叠加层，渲染时卡片后面没有口播画面可模糊 —— 预览里后面的人脸被糊掉、字很清楚，
   导出到剪映里人脸是清晰地透出来的，整张卡发虚。底板的不透明度由主题的 --panel 定，预览和导出一样。 */
.sh-base { position: absolute; inset: 0; background: var(--panel); }
/* 左上角一团主题色的光，像有一盏灯从那边打过来 */
.sh-glow {
  position: absolute; left: -20%; top: -45%; width: 85%; height: 120%;
  background: radial-gradient(closest-side, color-mix(in srgb, var(--accent) 26%, transparent), transparent);
}
.sh-grid {
  position: absolute; inset: 0; opacity: 0.12;
  background-image: radial-gradient(var(--dot) 1.2px, transparent 1.4px);
  background-size: 28px 28px;
  -webkit-mask-image: linear-gradient(115deg, transparent 35%, #000 100%);
  mask-image: linear-gradient(115deg, transparent 35%, #000 100%);
}
.sh-grain {
  position: absolute; inset: 0; opacity: 0.14; mix-blend-mode: var(--grain-blend);
  background-image: var(--grain);
}
.sh-sheen {
  position: absolute; top: -10%; bottom: -10%; left: 0; width: 60%;
  background: linear-gradient(100deg, transparent 20%, rgba(255, 255, 255, 0.10) 48%, rgba(255, 240, 220, 0.16) 50%, rgba(255, 255, 255, 0.10) 52%, transparent 80%);
  mix-blend-mode: screen;
}
.sh-top {
  position: absolute; left: 8%; right: 8%; top: 0; height: 1.5px;
  background: linear-gradient(90deg, transparent, var(--hi), transparent);
}
.sh-glyphs { position: absolute; inset: 0; opacity: var(--glyph-a, 0); font-family: var(--font-mono); font-weight: 700; }
.sh-glyphs span { position: absolute; white-space: nowrap; }
.sh-ticks i { position: absolute; width: var(--tk); height: var(--tk); border: 0 solid var(--accent); opacity: 0.85; }
.sh-ticks .a { left: -1px; top: -1px; border-left-width: 3px; border-top-width: 3px; border-top-left-radius: 14px; }
.sh-ticks .b { right: -1px; top: -1px; border-right-width: 3px; border-top-width: 3px; border-top-right-radius: 14px; }
.sh-ticks .c { left: -1px; bottom: -1px; border-left-width: 3px; border-bottom-width: 3px; border-bottom-left-radius: 14px; }
.sh-ticks .d { right: -1px; bottom: -1px; border-right-width: 3px; border-bottom-width: 3px; border-bottom-right-radius: 14px; }
.sh-meta { position: absolute; right: 28px; bottom: 16px; display: flex; align-items: center; gap: 10px; }
.sh-bar { position: relative; display: block; width: 90px; height: 3px; border-radius: 2px; background: var(--track); overflow: hidden; }
.sh-bar i { position: absolute; left: 0; top: 0; bottom: 0; background: var(--accent); }
</style>
