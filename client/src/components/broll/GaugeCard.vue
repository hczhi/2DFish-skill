<script setup lang="ts">
import { computed } from 'vue'
import { easeOutBack, easeOutCubic, lerp, progress } from './timeline'
import { useCardBase } from './cardBase'
import CardShell from './CardShell.vue'
import CardHead from './CardHead.vue'

// 「评分仪表盘」卡：半圆表盘，弧线走到 分数 / 满分，指针转过去（轻微过冲再回来），中间数字跟着跳。
// 「我给它打 8.5 分」「满分 10 分」。分数不在 0~满分之间时画不出来，由 check 报。
export interface GaugeData { label: string; title: string; score: string; max: string; caption: string; accent: string; panel: boolean; duration: number }
const props = defineProps<{ data: GaugeData; t: number }>()
const emit = defineEmits<{ size: [{ w: number; h: number }] }>()
const { root, rootStyle } = useCardBase(props, emit)

const R = 230
const ratio = computed(() => { const s = Number(props.data.score), m = Number(props.data.max) || 10; return Number.isFinite(s) ? Math.max(0, Math.min(1, s / m)) : 0 })
const sweep = computed(() => easeOutBack(progress(props.t, 0.5, 1.8)) * ratio.value)
const arcLen = Math.PI * R
const dec = computed(() => (String(props.data.score).split('.')[1] || '').length)
const shown = computed(() => (Number(props.data.max || 10) * Math.min(sweep.value, ratio.value)).toFixed(dec.value))
const needle = computed(() => lerp(-90, 90, Math.min(1.04, sweep.value)))
const ringIn = computed(() => ({ opacity: easeOutCubic(progress(props.t, 0, 0.4)) }))
const ticks = Array.from({ length: 11 }, (_, i) => -90 + i * 18)
</script>

<template>
  <div ref="root" class="gg" :style="rootStyle">
    <CardShell v-if="data.panel" :t="t" :duration="data.duration" />
    <CardHead :t="t" :label="data.label" :title="data.title" />
    <div class="gg-dial" :style="ringIn">
      <svg :viewBox="`0 0 ${2 * R + 60} ${R + 60}`" :width="2 * R + 60" :height="R + 60">
        <g :transform="`translate(${R + 30} ${R + 30})`">
          <path class="gg-track" :d="`M${-R} 0 A${R} ${R} 0 0 1 ${R} 0`" />
          <path class="gg-arc" :d="`M${-R} 0 A${R} ${R} 0 0 1 ${R} 0`" :stroke-dasharray="arcLen" :stroke-dashoffset="arcLen * (1 - Math.min(1, sweep))" />
          <line v-for="a in ticks" :key="a" class="gg-tick" x1="0" :y1="-R + 40" x2="0" :y2="-R + 58" :transform="`rotate(${a})`" />
          <g :transform="`rotate(${needle})`"><path class="gg-needle" :d="`M-10 0 L0 ${-R + 70} L10 0 Z`" /></g>
          <circle class="gg-hub" r="22" />
        </g>
      </svg>
      <div class="gg-num"><span class="bx-hot">{{ shown }}</span><small>/ {{ data.max || 10 }}</small></div>
    </div>
    <div v-if="data.caption" class="gg-cap">{{ data.caption }}</div>
  </div>
</template>

<style scoped>
.gg { position: relative; display: inline-flex; flex-direction: column; align-items: center; padding: 48px 70px 50px; box-sizing: border-box; color: var(--fg); font-family: var(--font-cn); }
.gg-dial { position: relative; }
.gg-track { fill: none; stroke: var(--track); stroke-width: 34; stroke-linecap: round; }
.gg-arc { fill: none; stroke: var(--accent); stroke-width: 34; stroke-linecap: round; filter: drop-shadow(0 0 14px color-mix(in srgb, var(--accent) 70%, transparent)); }
.gg-tick { stroke: var(--mute); stroke-width: 4; }
.gg-needle { fill: var(--fg); }
.gg-hub { fill: var(--accent); }
.gg-num { position: relative; margin-top: 6px; text-align: center; font-family: var(--font-mono); font-size: 110px; font-weight: 800; line-height: 1; }
.gg-num small { font-size: 0.36em; color: var(--mute); margin-left: 8px; }
.gg-cap { margin-top: 30px; font-size: 46px; font-weight: 600; color: var(--mute); white-space: nowrap; }
</style>
