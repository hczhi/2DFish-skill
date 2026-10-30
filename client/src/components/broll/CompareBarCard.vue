<script setup lang="ts">
import { computed } from 'vue'
import { easeInCubic, easeOutCubic, focusIn, lerp, progress, pulse, stagger } from './timeline'
import { useCardSize } from './cardSize'
import CardShell from './CardShell.vue'
import { useThemeMotion } from './themeContext'

// 「对比条」卡：两个数比大小（「同行 20%，我们 300%」）。柱长由代码按两个数的比例算，模型 / 用户只填数。
// 数不是数字时柱长没法算 —— 那一根画成 0 并由 templates.ts 的 check 报出来，不悄悄画一个随便的长度。

export interface CompareBarData {
  label: string
  title: string
  aName: string
  aValue: string
  bName: string
  bValue: string
  unit: string
  highlight: 'a' | 'b'
  accent: string
  panel: boolean
  duration: number
}

const props = defineProps<{ data: CompareBarData; t: number }>()
const emit = defineEmits<{ size: [{ w: number; h: number }] }>()
const root = useCardSize(emit)

const BAR_MAX = 900
const BAR_MIN = 24 // 小的那根太短会看不见，留个最小长度（只影响视觉，数字照实显示）

const num = (s: string) => {
  const n = Number(String(s).replace(/,/g, ''))
  return Number.isFinite(n) && String(s).trim() !== '' ? n : null
}
const decimals = (s: string) => (String(s).replace(/,/g, '').split('.')[1] || '').length
const rows = computed(() => {
  const a = num(props.data.aValue), b = num(props.data.bValue)
  const max = Math.max(Math.abs(a ?? 0), Math.abs(b ?? 0)) || 1
  const len = (v: number | null) => (v === null ? 0 : Math.max(BAR_MIN, (Math.abs(v) / max) * BAR_MAX))
  return [
    { key: 'a', name: props.data.aName, raw: props.data.aValue, v: a, len: len(a) },
    { key: 'b', name: props.data.bName, raw: props.data.bValue, v: b, len: len(b) },
  ]
})

const OUT = 0.5
const outP = computed(() => easeInCubic(progress(props.t, props.data.duration - OUT, props.data.duration)))
const rootStyle = computed(() => ({
  opacity: 1 - outP.value,
  filter: `blur(${outP.value * 8}px)`,
  transform: `translateY(${-30 * outP.value}px)`,
  ...(props.data.accent ? { '--accent': props.data.accent } : {}),
}))

const grow = (i: number) => easeOutCubic(stagger(props.t, 0.5, 0.35, i, 1))
const shown = (r: { raw: string; v: number | null }, i: number) => {
  if (r.v === null) return r.raw
  const cur = r.v * grow(i)
  const d = decimals(r.raw)
  return String(r.raw).includes(',')
    ? cur.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })
    : cur.toFixed(d)
}
const rowStyle = (i: number) => {
  const p = easeOutCubic(stagger(props.t, 0.3, 0.35, i, 0.4))
  return { opacity: p, transform: `translateX(${lerp(-30, 0, p)}px)` }
}
const labelStyle = computed(() => {
  const p = easeOutCubic(progress(props.t, 0, 0.45))
  return { opacity: p, clipPath: `inset(0 ${100 - p * 100}% 0 0)` }
})
const { enter } = useThemeMotion()
const titleStyle = computed(() => enter(props.t, 0.1))
</script>

<template>
  <div ref="root" class="cb" :style="rootStyle">
    <CardShell v-if="data.panel" :t="t" :duration="data.duration" />
    <div v-if="data.label" class="cb-label" :style="labelStyle"><i class="bx-dot" :style="{ '--pulse': pulse(t) }" />{{ data.label }}</div>
    <div v-if="data.title" class="cb-title" :style="titleStyle">{{ data.title }}</div>
    <div v-for="(r, i) in rows" :key="r.key" class="cb-row" :class="{ hi: data.highlight === r.key }" :style="rowStyle(i)">
      <div class="cb-name">{{ r.name }}</div>
      <div class="cb-track" :style="{ width: `${BAR_MAX}px` }">
        <div class="cb-bar" :style="{ width: `${r.len}px`, transform: `scaleX(${grow(i)})` }" />
      </div>
      <div class="cb-val">
        <!-- 终值占位撑宽，跳数时不抖 -->
        <span class="cb-ghost">{{ r.raw }}{{ data.unit }}</span>
        <span class="cb-live" :class="{ 'bx-hot': data.highlight === r.key }">{{ shown(r, i) }}<small>{{ data.unit }}</small></span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.cb {
  position: relative; display: inline-block; padding: 48px 72px 40px 60px; box-sizing: border-box;
  color: var(--fg); font-family: var(--font-cn);
}
.cb-panel { position: absolute; inset: 0; border-radius: 8px; background: var(--panel); border: 2px solid var(--line); }
.cb-label {
  position: relative; display: flex; align-items: center; gap: 18px; margin-bottom: 16px; white-space: nowrap;
  font-family: var(--font-mono); font-size: 38px; font-weight: 600; letter-spacing: 0.3em; text-transform: uppercase; color: var(--accent);
}
.cb-label b { display: inline-block; width: 48px; height: 4px; background: var(--accent); }
.cb-title { position: relative; font-size: 80px; font-weight: 700; white-space: nowrap; margin-bottom: 36px; }
.cb-row { position: relative; display: grid; grid-template-columns: auto auto auto; align-items: center; column-gap: 28px; margin-bottom: 32px; }
.cb-name { font-size: 52px; font-weight: 600; color: var(--mute); white-space: nowrap; min-width: 160px; }
.cb-row.hi .cb-name { color: var(--fg); }
.cb-track { height: 56px; display: flex; align-items: center; }
.cb-bar { height: 40px; border-radius: 4px; background: var(--mute); opacity: 0.5; transform-origin: left center; }
.cb-row.hi .cb-bar {
  height: 56px; opacity: 1;
  background: linear-gradient(90deg, color-mix(in srgb, var(--accent) 75%, #000), var(--accent) 60%, color-mix(in srgb, var(--accent) 45%, #fff));
  box-shadow: 0 0 32px color-mix(in srgb, var(--accent) 45%, transparent), inset 0 1px 0 rgba(255, 255, 255, 0.35);
}
.cb-val { display: inline-grid; font-family: var(--font-mono); font-size: 72px; font-weight: 800; white-space: nowrap; color: var(--mute); }
.cb-row.hi .cb-val { color: var(--accent); }
.cb-ghost, .cb-live { grid-area: 1 / 1; }
.cb-ghost { visibility: hidden; }
.cb-val small { font-size: 0.6em; margin-left: 6px; }
</style>
