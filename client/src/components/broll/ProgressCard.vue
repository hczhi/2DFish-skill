<script setup lang="ts">
import { computed } from 'vue'
import { easeOutCubic, lerp, progress } from './timeline'
import { useCardBase } from './cardBase'
import CardShell from './CardShell.vue'
import CardHead from './CardHead.vue'

// 「进度条」卡：「目标 100 万，已经完成 70 万」—— 进度条走到 当前 / 目标，百分比由代码算、跟着跳，终点立一面小旗写目标值。
// 当前 > 目标时进度条走满并标「已超额」（不画到框外面去）。
export interface ProgressData { label: string; title: string; current: string; target: string; unit: string; accent: string; panel: boolean; duration: number }
const props = defineProps<{ data: ProgressData; t: number }>()
const emit = defineEmits<{ size: [{ w: number; h: number }] }>()
const { root, rootStyle } = useCardBase(props, emit)

const num = (s: string) => Number(String(s).replace(/,/g, ''))
const ratio = computed(() => { const c = num(props.data.current), g = num(props.data.target); return g > 0 && Number.isFinite(c) ? c / g : 0 })
const fill = computed(() => Math.min(1, ratio.value) * easeOutCubic(progress(props.t, 0.6, 2)))
const pct = computed(() => Math.round(ratio.value * 100 * easeOutCubic(progress(props.t, 0.6, 2))))
const over = computed(() => ratio.value > 1 && props.t > 2)
const barIn = computed(() => ({ opacity: easeOutCubic(progress(props.t, 0.2, 0.5)) }))
const flagStyle = computed(() => {
  const p = easeOutCubic(progress(props.t, 0.4, 0.8))
  return { opacity: p, transform: `translateY(${lerp(-20, 0, p)}px)` }
})
</script>

<template>
  <div ref="root" class="pr" :style="rootStyle">
    <CardShell v-if="data.panel" :t="t" :duration="data.duration" />
    <CardHead :t="t" :label="data.label" :title="data.title" />
    <div class="pr-nums">
      <span class="pr-pct bx-hot">{{ pct }}<small>%</small></span>
      <span class="pr-cur">{{ data.current }}{{ data.unit }} / {{ data.target }}{{ data.unit }}</span>
      <span v-if="over" class="pr-over">已超额</span>
    </div>
    <div class="pr-bar" :style="barIn">
      <i class="pr-fill" :style="{ transform: `scaleX(${fill})` }"><b /></i>
      <span class="pr-flag" :style="flagStyle">🏁 {{ data.target }}{{ data.unit }}</span>
    </div>
  </div>
</template>

<style scoped>
.pr { position: relative; display: inline-block; min-width: 1100px; padding: 48px 80px 80px 60px; box-sizing: border-box; color: var(--fg); font-family: var(--font-cn); }
.pr-nums { position: relative; display: flex; align-items: baseline; gap: 30px; margin-bottom: 26px; }
.pr-pct { font-family: var(--font-mono); font-size: 160px; font-weight: 800; line-height: 1; }
.pr-pct small { font-size: 0.45em; }
.pr-cur { font-size: 46px; color: var(--mute); white-space: nowrap; }
.pr-over { padding: 6px 18px; border-radius: 10px; font-size: 34px; font-weight: 700; color: var(--ink-on-accent); background: var(--accent); }
.pr-bar { position: relative; height: 44px; border-radius: 22px; background: var(--track); }
.pr-fill { position: absolute; inset: 0; border-radius: 22px; overflow: hidden; transform-origin: left center; background: linear-gradient(90deg, color-mix(in srgb, var(--accent) 70%, #000), var(--accent)); box-shadow: 0 0 30px color-mix(in srgb, var(--accent) var(--glow-a, 45%), transparent); }
.pr-fill b { position: absolute; inset: 0; background: repeating-linear-gradient(120deg, rgba(255, 255, 255, 0.16) 0 18px, transparent 18px 36px); }
.pr-flag { position: absolute; right: 0; top: 58px; font-size: 34px; color: var(--mute); white-space: nowrap; }
</style>
