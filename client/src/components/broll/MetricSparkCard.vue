<script setup lang="ts">
import { computed } from 'vue'
import { easeInOutCubic, easeOutBack, easeOutCubic, lerp, progress } from './timeline'
import { useCardBase } from './cardBase'
import CardShell from './CardShell.vue'
import CardHead from './CardHead.vue'

// 「数字带趋势」卡：一个大数字 + 下面一条小折线，同时起跑 —— 数字从第一个点的值滚到最后一个点的值，
// 线画到哪个点、那个点弹到哪；数字停住那一刻单位和涨跌箭头才出来。「一个数 + 它怎么来的」。
// 每行「标签 数值」，3–8 个点；大数字就是最后一个点（代码取，不另填），涨跌方向也由代码按首尾比。

export interface MetricSparkData { label: string; title: string; rows: string[]; unit: string; accent: string; panel: boolean; duration: number }
const props = defineProps<{ data: MetricSparkData; t: number }>()
const emit = defineEmits<{ size: [{ w: number; h: number }] }>()
const { root, rootStyle } = useCardBase(props, emit)

// 和 templates.ts 的 metricKeys 一致
const RUN_AT = 0.5
const RUN = 1.5
const PW = 640
const PH = 150

const rows = computed(() => props.data.rows.filter((s) => s.trim()).map((s) => {
  const m = s.trim().match(/^(.*?)\s+([\d,.]+)$/)
  return m ? { name: m[1], raw: m[2], v: Number(m[2].replace(/,/g, '')) } : { name: s.trim(), raw: '?', v: 0 }
}))
const pts = computed(() => {
  const vs = rows.value.map((r) => r.v)
  const lo = Math.min(...vs), hi = Math.max(...vs)
  const n = rows.value.length
  return rows.value.map((r, i) => ({ ...r, x: n > 1 ? (i / (n - 1)) * PW : PW / 2, y: PH - 14 - ((r.v - lo) / (hi - lo || 1)) * (PH - 28) }))
})
const first = computed(() => rows.value[0])
const last = computed(() => rows.value[rows.value.length - 1])
const runP = computed(() => easeInOutCubic(progress(props.t, RUN_AT, RUN_AT + RUN)))

// 小数位数、千分位都照最后那个数的原样写法
const decimals = computed(() => (last.value?.raw.split('.')[1] || '').length)
const comma = computed(() => !!last.value?.raw.includes(','))
const fmt = (v: number) => {
  const s = v.toFixed(decimals.value)
  if (!comma.value) return s
  const [a, b] = s.split('.')
  return a.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (b ? `.${b}` : '')
}
const shown = computed(() => {
  if (!first.value || !last.value) return ''
  if (runP.value >= 1) return last.value.raw
  return fmt(lerp(first.value.v, last.value.v, runP.value))
})
const up = computed(() => (last.value?.v ?? 0) >= (first.value?.v ?? 0))
const doneAt = RUN_AT + RUN
const tailStyle = computed(() => {
  const p = easeOutCubic(progress(props.t, doneAt, doneAt + 0.35))
  return { opacity: p, transform: `translateY(${lerp(16, 0, p)}px)` }
})
const numStyle = computed(() => ({ opacity: easeOutCubic(progress(props.t, RUN_AT - 0.2, RUN_AT + 0.2)) }))

let seq = 0
const uid = `ms${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`
const path = computed(() => pts.value.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' '))
const dotStyle = (i: number) => {
  const at = RUN_AT + (pts.value.length > 1 ? i / (pts.value.length - 1) : 0) * RUN
  const p = progress(props.t, at - 0.05, at + 0.3)
  return { opacity: easeOutCubic(p), transform: `scale(${lerp(0, 1, easeOutBack(p))})` }
}
</script>

<template>
  <div ref="root" class="ms" :style="rootStyle">
    <CardShell v-if="data.panel" :t="t" :duration="data.duration" />
    <CardHead :t="t" :label="data.label" :title="data.title" />
    <div class="ms-num" :style="numStyle">
      <span class="ms-val">
        <!-- 占位：首尾两个数叠在同一格撑宽度（数在滚的时候不忽宽忽窄，尺寸按最宽的量） -->
        <span class="ms-ghost">{{ first?.raw }}</span>
        <span class="ms-ghost">{{ last?.raw }}</span>
        <span class="ms-live bx-hot">{{ shown }}</span>
      </span>
      <span class="ms-tail" :style="tailStyle">
        <small v-if="data.unit">{{ data.unit }}</small>
        <svg class="ms-arrow" :class="{ down: !up }" viewBox="0 0 40 40"><path d="M20 6 L34 26 H24 V34 H16 V26 H6 Z" /></svg>
      </span>
    </div>
    <div class="ms-plot" :style="{ width: `${PW}px`, height: `${PH}px` }">
      <svg :viewBox="`0 0 ${PW} ${PH}`" :width="PW" :height="PH" overflow="visible">
        <defs><clipPath :id="`${uid}c`"><rect x="-20" y="-30" :width="PW * runP + 20" :height="PH + 60" /></clipPath></defs>
        <path class="ms-line" :d="path" :clip-path="`url(#${uid}c)`" />
        <circle
          v-for="(p, i) in pts" :key="i" class="ms-dot" :class="{ last: i === pts.length - 1 }" :cx="p.x" :cy="p.y" r="9"
          :style="[dotStyle(i), { transformOrigin: `${p.x}px ${p.y}px` }]"
        />
      </svg>
    </div>
    <div class="ms-names" :style="{ width: `${PW}px` }">
      <span>{{ first?.name }}</span><span>{{ last?.name }}</span>
    </div>
  </div>
</template>

<style scoped>
.ms { position: relative; display: inline-block; padding: 48px 80px 52px 64px; box-sizing: border-box; color: var(--fg); font-family: var(--font-cn); }
.ms-num { position: relative; display: flex; align-items: baseline; gap: 18px; margin-bottom: 26px; white-space: nowrap; }
.ms-val { display: inline-grid; font-family: var(--font-mono); font-size: 200px; font-weight: 800; line-height: 1; letter-spacing: -5px; }
.ms-val > * { grid-area: 1 / 1; }
.ms-ghost { visibility: hidden; }
.ms-tail { display: inline-flex; align-items: center; gap: 14px; }
.ms-tail small { font-size: 64px; font-weight: 700; color: var(--mute); }
.ms-arrow { width: 64px; height: 64px; fill: var(--accent); filter: drop-shadow(0 0 12px var(--accent)); }
.ms-arrow.down { transform: rotate(180deg); }
.ms-plot { position: relative; }
.ms-line { fill: none; stroke: var(--accent); stroke-width: 7; stroke-linecap: round; stroke-linejoin: round; filter: drop-shadow(0 0 8px var(--accent)); }
.ms-dot { fill: var(--tile); stroke: var(--accent); stroke-width: 4; }
.ms-dot.last { fill: var(--accent); }
.ms-names { position: relative; display: flex; justify-content: space-between; margin-top: 12px; font-size: 32px; color: var(--mute); white-space: nowrap; }
</style>
