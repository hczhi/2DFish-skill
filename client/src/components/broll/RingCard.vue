<script setup lang="ts">
import { computed } from 'vue'
import { easeInCubic, easeOutCubic, focusIn, lerp, progress, pulse } from './timeline'
import { useCardSize } from './cardSize'
import CardShell from './CardShell.vue'

// 「占比环」卡：一个 0–100 的占比画成圆环，中间数字跟着跳。弧长由代码按数值算。
// 数值不在 0–100 或不是数字时环画不出来 —— 画成空环并由 templates.ts 的 check 报出来。

export interface RingData {
  label: string
  value: string
  title: string
  sub: string
  accent: string
  panel: boolean
  duration: number
}

const props = defineProps<{ data: RingData; t: number }>()
const emit = defineEmits<{ size: [{ w: number; h: number }] }>()
const root = useCardSize(emit)

const R = 150
const C = 2 * Math.PI * R

const target = computed(() => {
  const n = Number(String(props.data.value).trim())
  return Number.isFinite(n) && n >= 0 && n <= 100 && String(props.data.value).trim() !== '' ? n : null
})
const decimals = computed(() => (String(props.data.value).split('.')[1] || '').length)
const fill = computed(() => easeOutCubic(progress(props.t, 0.35, 1.6)))
const shown = computed(() => (target.value === null ? props.data.value : (target.value * fill.value).toFixed(decimals.value)))
// 环内直径约 270px：「87.5%」「100%」用 96px 会顶到环上，按字数缩字号
const numSize = computed(() => {
  const n = String(props.data.value).trim().length
  return n <= 2 ? 96 : n === 3 ? 80 : 64
})
const dash = computed(() => C * (1 - ((target.value ?? 0) / 100) * fill.value))

const OUT = 0.5
const outP = computed(() => easeInCubic(progress(props.t, props.data.duration - OUT, props.data.duration)))
const rootStyle = computed(() => ({
  opacity: 1 - outP.value,
  filter: `blur(${outP.value * 8}px)`,
  transform: `translateY(${-30 * outP.value}px)`,
  ...(props.data.accent ? { '--accent': props.data.accent } : {}),
}))
const ringStyle = computed(() => {
  const p = easeOutCubic(progress(props.t, 0, 0.5))
  return { opacity: p, transform: `scale(${lerp(0.7, 1, p)}) rotate(${lerp(-60, 0, p)}deg)` }
})
const textStyle = (a: number) => {
  const p = easeOutCubic(progress(props.t, a, a + 0.45))
  return { opacity: p, transform: `translateX(${lerp(-30, 0, p)}px)` }
}
const labelStyle = computed(() => {
  const p = easeOutCubic(progress(props.t, 0.2, 0.65))
  return { opacity: p, clipPath: `inset(0 ${100 - p * 100}% 0 0)` }
})
</script>

<template>
  <div ref="root" class="rg" :style="rootStyle">
    <CardShell v-if="data.panel" :t="t" :duration="data.duration" />
    <div class="rg-ring" :style="ringStyle">
      <svg :width="2 * R + 40" :height="2 * R + 40" :viewBox="`0 0 ${2 * R + 40} ${2 * R + 40}`">
        <circle class="rg-track" :cx="R + 20" :cy="R + 20" :r="R" />
        <circle
          class="rg-arc" :cx="R + 20" :cy="R + 20" :r="R"
          :stroke-dasharray="C" :stroke-dashoffset="dash" :transform="`rotate(-90 ${R + 20} ${R + 20})`"
        />
      </svg>
      <div class="rg-num" :style="{ fontSize: `${numSize}px` }">
        <span class="bx-hot">{{ shown }}</span>
        <small>%</small>
      </div>
    </div>
    <div class="rg-text">
      <div v-if="data.label" class="rg-label" :style="labelStyle"><i class="bx-dot" :style="{ '--pulse': pulse(t) }" />{{ data.label }}</div>
      <div v-if="data.title" class="rg-title" :style="textStyle(0.4)">{{ data.title }}</div>
      <div v-if="data.sub" class="rg-sub" :style="textStyle(0.7)">{{ data.sub }}</div>
    </div>
  </div>
</template>

<style scoped>
.rg {
  position: relative; display: inline-flex; align-items: center; gap: 56px; padding: 48px 80px 48px 56px; box-sizing: border-box;
  color: var(--fg); font-family: var(--font-cn);
}
.rg-panel { position: absolute; inset: 0; border-radius: 8px; background: var(--panel); border: 2px solid var(--line); }
.rg-ring { position: relative; display: grid; place-items: center; }
.rg-ring svg { display: block; }
.rg-track { fill: none; stroke: var(--line); stroke-width: 26; }
.rg-arc { fill: none; stroke: var(--accent); stroke-width: 26; stroke-linecap: round; filter: drop-shadow(0 0 14px color-mix(in srgb, var(--accent) 70%, transparent)); }
.rg-num {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-variant-numeric: tabular-nums;
  font-family: var(--font-mono); font-weight: 800; color: var(--accent);
}
.rg-num small { font-size: 0.5em; margin-left: 4px; align-self: center; padding-top: 24px; }
.rg-text { position: relative; }
.rg-label {
  display: flex; align-items: center; gap: 18px; margin-bottom: 16px; white-space: nowrap;
  font-family: var(--font-mono); font-size: 38px; font-weight: 600; letter-spacing: 0.3em; text-transform: uppercase; color: var(--accent);
}
.rg-label b { display: inline-block; width: 48px; height: 4px; background: var(--accent); }
.rg-title { font-size: 84px; font-weight: 700; white-space: nowrap; }
.rg-sub { margin-top: 16px; font-size: 52px; color: var(--mute); white-space: nowrap; }
</style>
