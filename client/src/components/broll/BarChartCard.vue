<script setup lang="ts">
import { computed } from 'vue'
import { easeOutCubic, lerp, progress, stagger } from './timeline'
import { useCardBase } from './cardBase'
import CardShell from './CardShell.vue'
import CardHead from './CardHead.vue'
import { cueAt } from './cues'

// 「柱状图」卡：3–6 根竖柱依次长出来，柱顶的数字跟着跳，最高的那根（或指定的）用强调色。
// 每行「名字 数值」；柱高由代码按比例算，模型 / 用户只填数。数值不是数字时那根画不出来，由 check 报。
// 每根柱子可以单独定开始长的时刻（data.cues[i]，见 cues.ts）。
export interface BarChartData { label: string; title: string; rows: string[]; cues?: (number | null)[]; unit: string; accent: string; panel: boolean; duration: number }
const props = defineProps<{ data: BarChartData; t: number }>()
const emit = defineEmits<{ size: [{ w: number; h: number }] }>()
const { root, rootStyle } = useCardBase(props, emit)

const H = 380
const AT = 0.5
const STEP = 0.18
const bars = computed(() => {
  const rows = props.data.rows.filter((s) => s.trim()).map((s) => {
    const m = s.trim().match(/^(.*?)\s+([\d,.]+)$/)
    return m ? { name: m[1], raw: m[2], v: Number(m[2].replace(/,/g, '')) } : { name: s.trim(), raw: '?', v: 0 }
  })
  const max = Math.max(1, ...rows.map((r) => r.v))
  const top = rows.findIndex((r) => r.v === max)
  return rows.map((r, i) => ({ ...r, h: (r.v / max) * H, top: i === top }))
})
const barAt = (i: number) => cueAt(props.data.cues, i, AT + i * STEP)
const grow = (i: number) => easeOutCubic(progress(props.t, barAt(i), barAt(i) + 0.8))
const valText = (b: { raw: string; v: number }, i: number) => {
  if (b.raw === '?') return '?'
  const d = (b.raw.replace(/,/g, '').split('.')[1] || '').length
  return (b.v * grow(i)).toFixed(d)
}
const axisStyle = computed(() => ({ transform: `scaleX(${easeOutCubic(progress(props.t, 0.2, 0.7))})` }))
const nameStyle = (i: number) => ({ opacity: easeOutCubic(progress(props.t, barAt(i), barAt(i) + 0.4)) })
</script>

<template>
  <div ref="root" class="bc" :style="rootStyle">
    <CardShell v-if="data.panel" :t="t" :duration="data.duration" />
    <CardHead :t="t" :label="data.label" :title="data.title" />
    <div class="bc-plot" :style="{ height: `${H + 80}px` }">
      <div v-for="(b, i) in bars" :key="i" class="bc-col" :class="{ top: b.top }">
        <span class="bc-val" :class="{ 'bx-hot': b.top }" :style="{ bottom: `${b.h * grow(i) + 14}px`, ...nameStyle(i) }">{{ valText(b, i) }}<small>{{ data.unit }}</small></span>
        <i class="bc-bar" :style="{ height: `${b.h}px`, transform: `scaleY(${grow(i)})` }" />
      </div>
      <i class="bc-axis" :style="axisStyle" />
    </div>
    <div class="bc-names">
      <span v-for="(b, i) in bars" :key="i" :style="nameStyle(i)">{{ b.name }}</span>
    </div>
  </div>
</template>

<style scoped>
.bc { position: relative; display: inline-block; padding: 48px 70px 44px 60px; box-sizing: border-box; color: var(--fg); font-family: var(--font-cn); }
.bc-plot { position: relative; display: flex; align-items: flex-end; gap: 44px; padding: 0 20px; }
.bc-col { position: relative; width: 130px; height: 100%; display: flex; align-items: flex-end; justify-content: center; }
.bc-bar { width: 100%; border-radius: 14px 14px 4px 4px; background: var(--track); transform-origin: bottom center; }
.bc-col.top .bc-bar { background: linear-gradient(180deg, color-mix(in srgb, var(--accent) 45%, #fff), var(--accent) 45%, color-mix(in srgb, var(--accent) 70%, #000)); box-shadow: 0 0 34px color-mix(in srgb, var(--accent) var(--glow-a, 45%), transparent); }
.bc-val { position: absolute; left: 50%; transform: translateX(-50%); font-family: var(--font-mono); font-size: 46px; font-weight: 800; white-space: nowrap; color: var(--mute); }
.bc-val small { font-size: 0.55em; margin-left: 2px; }
.bc-axis { position: absolute; left: 0; right: 0; bottom: 0; height: 3px; background: var(--line); transform-origin: left center; }
.bc-names { position: relative; display: flex; gap: 44px; padding: 18px 20px 0; }
.bc-names span { width: 130px; text-align: center; font-size: 38px; font-weight: 600; white-space: nowrap; }
</style>
