<script setup lang="ts">
import { computed } from 'vue'
import { easeOutBack, easeOutCubic, lerp, progress } from './timeline'
import { useCardBase } from './cardBase'
import CardShell from './CardShell.vue'
import CardHead from './CardHead.vue'

// 「价格对比」卡：原价先出 → 一道斜线划掉、变灰 → 现价从放大状态砸下来 → 旁边弹一个「立省 xx」标签（差价由代码算，不让模型算）。
export interface PriceData { label: string; title: string; currency: string; oldPrice: string; newPrice: string; tag: string; accent: string; panel: boolean; duration: number }
const props = defineProps<{ data: PriceData; t: number }>()
const emit = defineEmits<{ size: [{ w: number; h: number }] }>()
const { root, rootStyle } = useCardBase(props, emit)

const num = (s: string) => Number(String(s).replace(/,/g, ''))
const saved = computed(() => {
  const a = num(props.data.oldPrice), b = num(props.data.newPrice)
  if (!Number.isFinite(a) || !Number.isFinite(b) || a <= b) return ''
  const d = a - b
  return `立省 ${props.data.currency}${Number.isInteger(d) ? d : d.toFixed(2)}`
})
const STRIKE = 0.75
const NEW_AT = 1.1
const oldStyle = computed(() => {
  const p = easeOutCubic(progress(props.t, 0.25, 0.6))
  return { opacity: p * lerp(1, 0.5, progress(props.t, STRIKE, STRIKE + 0.3)), transform: `translateY(${lerp(20, 0, p)}px)` }
})
const strike = computed(() => easeOutCubic(progress(props.t, STRIKE, STRIKE + 0.3)))
const newStyle = computed(() => {
  const p = progress(props.t, NEW_AT, NEW_AT + 0.4)
  return { opacity: Math.min(1, p * 3), transform: `scale(${p < 1 ? lerp(2, 0.94, p * p) : 1})` }
})
const settle = computed(() => (props.t > NEW_AT + 0.4 ? easeOutBack(progress(props.t, NEW_AT + 0.4, NEW_AT + 0.7)) : 0))
const tagStyle = computed(() => {
  const p = progress(props.t, NEW_AT + 0.5, NEW_AT + 0.85)
  return { opacity: easeOutCubic(p), transform: `rotate(-6deg) scale(${lerp(0.3, 1, easeOutBack(p))})` }
})
</script>

<template>
  <div ref="root" class="pc" :style="rootStyle">
    <CardShell v-if="data.panel" :t="t" :duration="data.duration" />
    <CardHead :t="t" :label="data.label" :title="data.title" />
    <div class="pc-row">
      <div class="pc-old" :style="oldStyle">
        <span>{{ data.currency }}{{ data.oldPrice }}</span>
        <i class="pc-strike" :style="{ transform: `rotate(-8deg) scaleX(${strike})` }" />
      </div>
      <div class="pc-new" :style="[newStyle, { '--settle': settle }]"><small>{{ data.currency }}</small><span class="bx-hot">{{ data.newPrice }}</span></div>
      <div v-if="data.tag || saved" class="pc-tag" :style="tagStyle">{{ data.tag || saved }}</div>
    </div>
  </div>
</template>

<style scoped>
.pc { position: relative; display: inline-block; padding: 48px 90px 56px 60px; box-sizing: border-box; color: var(--fg); font-family: var(--font-cn); }
.pc-row { position: relative; display: flex; align-items: center; gap: 50px; }
.pc-old { position: relative; font-family: var(--font-mono); font-size: 90px; font-weight: 700; color: var(--mute); white-space: nowrap; }
.pc-strike { position: absolute; left: -10px; right: -10px; top: 50%; height: 8px; border-radius: 4px; background: #ff4d4f; transform-origin: left center; }
.pc-new { display: flex; align-items: baseline; font-family: var(--font-mono); font-size: 200px; font-weight: 800; line-height: 1; white-space: nowrap; }
.pc-new small { font-size: 0.4em; color: var(--accent); margin-right: 6px; }
.pc-tag { padding: 14px 30px; border-radius: 16px; font-size: 44px; font-weight: 800; color: var(--ink-on-accent); background: var(--accent); white-space: nowrap; box-shadow: 0 0 30px color-mix(in srgb, var(--accent) var(--glow-a, 45%), transparent); }
</style>
