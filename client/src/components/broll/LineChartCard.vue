<script setup lang="ts">
import { computed } from 'vue'
import { easeInOutCubic, easeOutBack, easeOutCubic, lerp, progress } from './timeline'
import { useCardBase } from './cardBase'
import CardShell from './CardShell.vue'
import CardHead from './CardHead.vue'

// 「折线趋势」卡：折线从左往右画出来，下面一片渐变面积跟着铺开，每个点依次弹出，最后一个点标出数值并发光。
// 每行「标签 数值」，3–8 个点；点的位置由代码按数算。
export interface LineChartData { label: string; title: string; rows: string[]; unit: string; accent: string; panel: boolean; duration: number }
const props = defineProps<{ data: LineChartData; t: number }>()
const emit = defineEmits<{ size: [{ w: number; h: number }] }>()
const { root, rootStyle } = useCardBase(props, emit)

// SVG 里的 id 是整页共享的：同一页上有几张折线图时（调试台就是），id 一样的话后面几张会用第一张的裁剪区，画到一半的进度对不上
let seq = 0
const uid = `lc${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`
const PW = 1000
const PH = 360
const DRAW_AT = 0.5
const DRAW = 1.4
const pts = computed(() => {
  const rows = props.data.rows.filter((s) => s.trim()).map((s) => {
    const m = s.trim().match(/^(.*?)\s+([\d,.]+)$/)
    return m ? { name: m[1], raw: m[2], v: Number(m[2].replace(/,/g, '')) } : { name: s.trim(), raw: '?', v: 0 }
  })
  const vs = rows.map((r) => r.v)
  const lo = Math.min(...vs, 0), hi = Math.max(...vs, 1)
  return rows.map((r, i) => ({ ...r, x: rows.length > 1 ? (i / (rows.length - 1)) * PW : PW / 2, y: PH - ((r.v - lo) / (hi - lo || 1)) * (PH - 40) - 20 }))
})
const path = computed(() => pts.value.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' '))
const area = computed(() => (pts.value.length ? `${path.value} L${PW} ${PH} L0 ${PH} Z` : ''))
const drawP = computed(() => easeInOutCubic(progress(props.t, DRAW_AT, DRAW_AT + DRAW)))
const dotStyle = (i: number) => {
  const at = DRAW_AT + (pts.value.length > 1 ? i / (pts.value.length - 1) : 0) * DRAW
  const p = progress(props.t, at - 0.05, at + 0.3)
  return { opacity: easeOutCubic(p), transform: `scale(${lerp(0, 1, easeOutBack(p))})` }
}
const lastStyle = computed(() => {
  const p = easeOutCubic(progress(props.t, DRAW_AT + DRAW, DRAW_AT + DRAW + 0.4))
  return { opacity: p, transform: `translateY(${lerp(14, 0, p)}px)` }
})
const last = computed(() => pts.value[pts.value.length - 1])
</script>

<template>
  <div ref="root" class="lc" :style="rootStyle">
    <CardShell v-if="data.panel" :t="t" :duration="data.duration" />
    <CardHead :t="t" :label="data.label" :title="data.title" />
    <div class="lc-plot" :style="{ width: `${PW}px`, height: `${PH}px` }">
      <svg :viewBox="`0 0 ${PW} ${PH}`" :width="PW" :height="PH" overflow="visible">
        <defs>
          <linearGradient :id="`${uid}f`" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="var(--accent)" stop-opacity="0.35" />
            <stop offset="1" stop-color="var(--accent)" stop-opacity="0" />
          </linearGradient>
          <clipPath :id="`${uid}c`"><rect x="0" y="-40" :width="PW * drawP" :height="PH + 80" /></clipPath>
        </defs>
        <path :d="area" :fill="`url(#${uid}f)`" :clip-path="`url(#${uid}c)`" />
        <path class="lc-line" :d="path" :clip-path="`url(#${uid}c)`" />
        <circle v-for="(p, i) in pts" :key="i" class="lc-dot" :class="{ last: i === pts.length - 1 }" :cx="p.x" :cy="p.y" r="12" :style="[dotStyle(i), { transformOrigin: `${p.x}px ${p.y}px` }]" />
      </svg>
      <div v-if="last" class="lc-last" :style="[lastStyle, { left: `${last.x}px`, top: `${last.y - 90}px` }]"><span class="bx-hot">{{ last.raw }}</span><small>{{ data.unit }}</small></div>
    </div>
    <div class="lc-names" :style="{ width: `${PW}px` }">
      <span v-for="(p, i) in pts" :key="i" :style="{ left: `${p.x}px` }">{{ p.name }}</span>
    </div>
  </div>
</template>

<style scoped>
.lc { position: relative; display: inline-block; padding: 48px 110px 70px 80px; box-sizing: border-box; color: var(--fg); font-family: var(--font-cn); }
.lc-plot { position: relative; }
.lc-line { fill: none; stroke: var(--accent); stroke-width: 8; stroke-linecap: round; stroke-linejoin: round; filter: drop-shadow(0 0 10px var(--accent)); }
.lc-dot { fill: var(--tile); stroke: var(--accent); stroke-width: 5; }
.lc-dot.last { fill: var(--accent); }
.lc-last { position: absolute; transform: translateX(-50%); font-family: var(--font-mono); font-size: 64px; font-weight: 800; white-space: nowrap; }
.lc-last small { font-size: 0.5em; color: var(--mute); margin-left: 4px; }
.lc-names { position: relative; height: 60px; margin-top: 20px; }
.lc-names span { position: absolute; transform: translateX(-50%); font-size: 34px; color: var(--mute); white-space: nowrap; }
</style>
