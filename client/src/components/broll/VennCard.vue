<script setup lang="ts">
import { computed } from 'vue'
import { easeOutCubic, lerp, progress } from './timeline'
import { useCardBase } from './cardBase'
import CardShell from './CardShell.vue'
import CardHead from './CardHead.vue'

// 「维恩图」卡：两个圆从两边滑到一起、叠出交集，交集那块亮起来写上交集的名字。「既要 A 又要 B」「两者的交集」时用。
export interface VennData { label: string; title: string; a: string; b: string; both: string; accent: string; panel: boolean; duration: number }
const props = defineProps<{ data: VennData; t: number }>()
const emit = defineEmits<{ size: [{ w: number; h: number }] }>()
const { root, rootStyle } = useCardBase(props, emit)

const R = 220
const slide = computed(() => easeOutCubic(progress(props.t, 0.3, 1.1)))
// 两圆圆心最终相距 1.15R：交集够宽写得下字，两边各自也留得出放名字的地方
const off = computed(() => lerp(R * 2.4, R * 1.15, slide.value))
const lit = computed(() => easeOutCubic(progress(props.t, 1.1, 1.5)))
const W = 2 * R + R * 1.15 + 40
// 交集那一块用两个 clipPath 圆相交画（每个实例自己的 id，同页多张时不串）
const uid = `vn${Math.random().toString(36).slice(2, 8)}`
</script>

<template>
  <div ref="root" class="vn" :style="rootStyle">
    <CardShell v-if="data.panel" :t="t" :duration="data.duration" />
    <CardHead :t="t" :label="data.label" :title="data.title" />
    <svg :viewBox="`${-W / 2} ${-R - 20} ${W} ${2 * R + 40}`" :width="W" :height="2 * R + 40" class="vn-svg">
      <defs><clipPath :id="uid"><circle :cx="-off / 2" cy="0" :r="R" /></clipPath></defs>
      <circle class="vn-c" :cx="-off / 2" cy="0" :r="R" />
      <circle class="vn-c" :cx="off / 2" cy="0" :r="R" />
      <circle class="vn-both" :cx="off / 2" cy="0" :r="R" :clip-path="`url(#${uid})`" :style="{ opacity: lit }" />
      <text class="vn-t" :x="-off / 2 - R * 0.35" y="14">{{ data.a }}</text>
      <text class="vn-t" :x="off / 2 + R * 0.35" y="14">{{ data.b }}</text>
      <text class="vn-t both" x="0" y="14" :style="{ opacity: lit }">{{ data.both }}</text>
    </svg>
  </div>
</template>

<style scoped>
.vn { position: relative; display: inline-flex; flex-direction: column; align-items: center; padding: 48px 70px 50px; box-sizing: border-box; color: var(--fg); font-family: var(--font-cn); }
.vn-c { fill: color-mix(in srgb, var(--accent) 10%, transparent); stroke: color-mix(in srgb, var(--accent) 60%, transparent); stroke-width: 4; }
.vn-both { fill: var(--accent); filter: drop-shadow(0 0 20px var(--accent)); }
.vn-t { fill: var(--fg); font-size: 42px; font-weight: 700; text-anchor: middle; }
.vn-t.both { fill: var(--ink-on-accent); font-size: 40px; }
</style>
