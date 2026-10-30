<script setup lang="ts">
import { computed } from 'vue'
import { easeOutCubic, progress, pulse } from './timeline'
import { useCardBase } from './cardBase'
import CardShell from './CardShell.vue'
import { ALT_BLOCK, ALT_LAG, altAt } from './altTimes'

// 「对句反色」：两句对仗的话各坐在自己的色块上，块宽贴着各自的字。第一行强调色块、第二行正文色块 —— 同结构反色，对仗关系靠颜色读出来。
// 每行色块从左边展开，字用 clip-path 被块的右缘「刷」出来（滞后 2 帧）。第二行默认晚 0.12 秒，可以按字幕单独定时（cues[1]）。
// 例：「你以为在努力」/「其实在消耗」。两行都摘原话。

export interface AltLinesData { label: string; a: string; b: string; cues?: (number | null)[]; accent: string; panel: boolean; duration: number }
const props = defineProps<{ data: AltLinesData; t: number }>()
const emit = defineEmits<{ size: [{ w: number; h: number }] }>()
const { root, rootStyle } = useCardBase(props, emit)

const lines = computed(() => [props.data.a, props.data.b])
const blockStyle = (i: number) => ({ transform: `scaleX(${easeOutCubic(progress(props.t, altAt(props.data, i), altAt(props.data, i) + ALT_BLOCK))})` })
const textStyle = (i: number) => {
  const a = altAt(props.data, i) + ALT_LAG
  const p = easeOutCubic(progress(props.t, a, a + ALT_BLOCK))
  return { clipPath: `inset(-10% ${100 - p * 100}% -10% 0)` }
}
const labelStyle = computed(() => {
  const p = easeOutCubic(progress(props.t, 0, 0.4))
  return { opacity: p, clipPath: `inset(0 ${100 - p * 100}% 0 0)` }
})
</script>

<template>
  <div ref="root" class="al" :class="{ bare: !data.panel }" :style="rootStyle">
    <CardShell v-if="data.panel" :t="t" :duration="data.duration" />
    <div class="al-body">
      <div v-if="data.label" class="al-label" :style="labelStyle"><i class="bx-dot" :style="{ '--pulse': pulse(t) }" />{{ data.label }}</div>
      <div v-for="(s, i) in lines" :key="i" class="al-row" :class="`r${i}`">
        <span class="al-block" :style="blockStyle(i)" />
        <span class="al-text" :style="textStyle(i)">{{ s }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.al { position: relative; display: inline-block; padding: 56px 72px; box-sizing: border-box; font-family: var(--font-cn); }
.al.bare { padding: 0; }
.al-body { position: relative; display: flex; flex-direction: column; align-items: flex-start; gap: 22px; }
.al-label {
  display: flex; align-items: center; gap: 18px; margin-bottom: 6px; white-space: nowrap;
  font-family: var(--font-mono); font-size: 38px; font-weight: 600; letter-spacing: 0.3em; text-transform: uppercase; color: var(--accent);
}
.al-row { position: relative; display: inline-block; padding: 0.1em 0.42em 0.14em; font-size: 108px; font-weight: 800; line-height: 1.2; white-space: nowrap; }
.al-block { position: absolute; inset: 0; transform-origin: left center; box-shadow: 0 18px 40px -18px var(--shadow-c); }
.al-text { position: relative; display: inline-block; }
/* 第一行强调色块、第二行正文色块；两行的字都用压在强调色上的那个字色 —— 两种主题下它都和 --accent / --fg 对比够 */
.r0 .al-block { background: var(--accent); }
.r1 .al-block { background: var(--fg); }
.al-row .al-text { color: var(--ink-on-accent); }
</style>
