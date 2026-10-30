<script setup lang="ts">
import { computed } from 'vue'
import { easeInCubic, easeOutCubic, lerp, progress, pulse, stagger } from './timeline'
import { useCardSize } from './cardSize'
import CardShell from './CardShell.vue'
import { useThemeMotion } from './themeContext'
import { cueAt } from './cues'

// 「排行榜」卡：2–5 名，从最后一名往第一名依次揭晓（留悬念），第一名（或指定的那一名）最后出、最醒目。条目摘原话。
// 每一名可以单独定出现时间：**data.cues[k] 是第 k 个揭晓的**（k=0 是最后一名），和揭晓顺序一致，按字幕对齐时也按这个顺序往后找。
export interface RankingData { label: string; title: string; items: string[]; cues?: (number | null)[]; highlight: string; accent: string; panel: boolean; duration: number }
const props = defineProps<{ data: RankingData; t: number }>()
const emit = defineEmits<{ size: [{ w: number; h: number }] }>()
const root = useCardSize(emit)
const { enter } = useThemeMotion()

const STEP = 0.4
const OUT = 0.5
const outP = computed(() => easeInCubic(progress(props.t, props.data.duration - OUT, props.data.duration)))
const rootStyle = computed(() => ({
  opacity: 1 - outP.value, filter: `blur(${outP.value * 8}px)`, transform: `translateX(${-40 * outP.value}px)`,
  ...(props.data.accent ? { '--accent': props.data.accent } : {}),
}))
const items = computed(() => props.data.items.filter((s) => s.trim()))
const hi = computed(() => Number(props.data.highlight) || 1)
// 揭晓顺序：最后一名先出
const rowStyle = (i: number) => {
  const order = items.value.length - 1 - i
  const at = cueAt(props.data.cues, order, 0.5 + order * STEP)
  const p = easeOutCubic(progress(props.t, at, at + 0.45))
  return { opacity: p, transform: `translateX(${lerp(-60, 0, p)}px)`, filter: `blur(${lerp(8, 0, p)}px)` }
}
const barW = (i: number) => `${100 - i * 12}%`
const titleStyle = computed(() => enter(props.t, 0.1))
</script>

<template>
  <div ref="root" class="rk" :style="rootStyle">
    <CardShell v-if="data.panel" :t="t" :duration="data.duration" />
    <div v-if="data.label" class="rk-label"><i class="bx-dot" :style="{ '--pulse': pulse(t) }" />{{ data.label }}</div>
    <div v-if="data.title" class="rk-title" :style="titleStyle">{{ data.title }}</div>
    <div v-for="(it, i) in items" :key="i" class="rk-row" :class="{ hi: i + 1 === hi }" :style="rowStyle(i)">
      <span class="rk-no" :class="{ 'bx-hot': i + 1 === hi }">{{ i + 1 }}</span>
      <span class="rk-bar"><i :style="{ width: barW(i) }" /></span>
      <span class="rk-text">{{ it }}</span>
    </div>
  </div>
</template>

<style scoped>
.rk { position: relative; display: inline-block; padding: 48px 80px 40px 60px; box-sizing: border-box; color: var(--fg); font-family: var(--font-cn); }
.rk-label { position: relative; display: flex; align-items: center; gap: 18px; margin-bottom: 14px; font-family: var(--font-mono); font-size: 38px; font-weight: 600; letter-spacing: 0.3em; text-transform: uppercase; color: var(--accent); white-space: nowrap; }
.rk-title { position: relative; font-size: 80px; font-weight: 700; white-space: nowrap; margin-bottom: 30px; }
.rk-row { position: relative; display: grid; grid-template-columns: 90px 1fr; align-items: center; margin-bottom: 18px; min-width: 760px; }
.rk-no { font-family: var(--font-mono); font-size: 70px; font-weight: 800; color: var(--mute); text-align: center; }
.rk-bar { position: absolute; left: 100px; right: 0; top: 8px; bottom: 8px; }
.rk-bar i { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 10px; background: var(--track); }
.rk-row.hi .rk-bar i { background: linear-gradient(90deg, color-mix(in srgb, var(--accent) 45%, transparent), color-mix(in srgb, var(--accent) 12%, transparent)); box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--accent) 60%, transparent); }
.rk-text { position: relative; padding: 18px 30px; font-size: 56px; font-weight: 600; white-space: nowrap; }
.rk-row.hi .rk-text { font-weight: 800; }
</style>
