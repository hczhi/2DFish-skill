<script setup lang="ts">
import { computed } from 'vue'
import { easeOutCubic, lerp, progress, stagger } from './timeline'
import { useCardBase } from './cardBase'
import CardShell from './CardShell.vue'
import CardHead from './CardHead.vue'

// 「漏斗」卡：「1000 人看到 → 100 人点进来 → 10 人下单」—— 一层层往下变窄，数字跟着跳，层与层之间标转化率（代码算）。
// 每行「名称 数值」，2–5 层。
export interface FunnelData { label: string; title: string; rows: string[]; unit: string; accent: string; panel: boolean; duration: number }
const props = defineProps<{ data: FunnelData; t: number }>()
const emit = defineEmits<{ size: [{ w: number; h: number }] }>()
const { root, rootStyle } = useCardBase(props, emit)

const MAXW = 900
const AT = 0.5
const STEP = 0.38
const rows = computed(() => props.data.rows.filter((s) => s.trim()).map((s) => {
  const m = s.trim().match(/^(.*?)\s+([\d,.]+)$/)
  return m ? { name: m[1], raw: m[2], v: Number(m[2].replace(/,/g, '')) } : { name: s.trim(), raw: '?', v: 0 }
}))
// 宽度按层数均匀收窄（不按数值比例：1000 → 10 按比例的话最后一层细得看不见）
const width = (i: number) => MAXW * (1 - (i / Math.max(1, rows.value.length)) * 0.62)
const layerStyle = (i: number) => {
  const p = easeOutCubic(stagger(props.t, AT, STEP, i, 0.45))
  return { opacity: p, transform: `translateY(${lerp(-20, 0, p)}px) scaleX(${lerp(0.6, 1, p)})`, width: `${width(i)}px` }
}
const valText = (i: number) => {
  const r = rows.value[i]
  if (r.raw === '?') return '?'
  return Math.round(r.v * easeOutCubic(stagger(props.t, AT, STEP, i, 0.8))).toLocaleString('en-US')
}
const rate = (i: number) => {
  const a = rows.value[i - 1]?.v, b = rows.value[i]?.v
  if (!a || !Number.isFinite(b)) return ''
  const r = (b / a) * 100
  return `${r >= 10 ? Math.round(r) : r.toFixed(1)}%`
}
const rateStyle = (i: number) => ({ opacity: easeOutCubic(stagger(props.t, AT + 0.25, STEP, i, 0.3)) })
</script>

<template>
  <div ref="root" class="fn" :style="rootStyle">
    <CardShell v-if="data.panel" :t="t" :duration="data.duration" />
    <CardHead :t="t" :label="data.label" :title="data.title" />
    <div class="fn-stack">
      <template v-for="(r, i) in rows" :key="i">
        <div v-if="i > 0" class="fn-rate" :style="rateStyle(i)">↓ {{ rate(i) }}</div>
        <div class="fn-layer" :class="{ last: i === rows.length - 1 }" :style="layerStyle(i)">
          <span class="fn-name">{{ r.name }}</span>
          <span class="fn-val" :class="{ 'bx-hot': i === rows.length - 1 }">{{ valText(i) }}<small>{{ data.unit }}</small></span>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.fn { position: relative; display: inline-block; padding: 48px 70px 50px 60px; box-sizing: border-box; color: var(--fg); font-family: var(--font-cn); }
.fn-stack { position: relative; display: flex; flex-direction: column; align-items: center; width: 900px; }
.fn-layer {
  display: flex; align-items: center; justify-content: space-between; padding: 20px 46px; box-sizing: border-box; border-radius: 18px; clip-path: inset(0 round 18px);
  background: color-mix(in srgb, var(--accent) 14%, var(--track)); box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--accent) 30%, transparent);
}
.fn-layer.last { background: color-mix(in srgb, var(--accent) 35%, transparent); box-shadow: inset 0 0 0 3px var(--accent); }
.fn-name { font-size: 44px; font-weight: 600; white-space: nowrap; }
.fn-val { font-family: var(--font-mono); font-size: 56px; font-weight: 800; white-space: nowrap; }
.fn-val small { font-size: 0.55em; margin-left: 4px; }
.fn-rate { margin: 8px 0; font-family: var(--font-mono); font-size: 32px; color: var(--accent); }
</style>
