<script setup lang="ts">
import { computed } from 'vue'
import { easeInCubic, easeOutBack, easeOutCubic, lerp, progress, pulse, stagger } from './timeline'
import { useCardSize } from './cardSize'
import CardShell from './CardShell.vue'
import { useThemeMotion } from './themeContext'
import { pgTimes, PG_APPEAR } from './pictogramTimes'

// 「象形图」卡：「10 个人里有 3 个」—— 一排小人依次出现（灰），其中 value 个依次点亮成强调色，旁边一个大分数。
// 总数超过 20（最多 100）换成点阵：10 列小方格从中心一圈圈长出来，再按阅读顺序逐格染色（「每 100 个观众有 37 个划走」）。
// 个数由代码按数画，不是数字或 value > total 时画不出来，由 check 报出来。
// 出现 / 点亮的时刻和 templates.ts 的 pgTimes 一致（调试台关键帧、最短停留都按那边算）。
export interface PictogramData { label: string; title: string; value: string; total: string; caption: string; icon: string; accent: string; panel: boolean; duration: number }
const props = defineProps<{ data: PictogramData; t: number }>()
const emit = defineEmits<{ size: [{ w: number; h: number }] }>()
const root = useCardSize(emit)
const { enter } = useThemeMotion()

const OUT = 0.5
const outP = computed(() => easeInCubic(progress(props.t, props.data.duration - OUT, props.data.duration)))
const rootStyle = computed(() => ({
  opacity: 1 - outP.value, filter: `blur(${outP.value * 8}px)`, transform: `translateY(${-30 * outP.value}px)`,
  ...(props.data.accent ? { '--accent': props.data.accent } : {}),
}))
const n = computed(() => Math.max(0, Math.min(100, Math.round(Number(props.data.total) || 0))))
const v = computed(() => Math.max(0, Math.min(n.value, Math.round(Number(props.data.value) || 0))))
const grid = computed(() => n.value > 20)
const cols = computed(() => (grid.value ? 10 : n.value > 10 ? Math.ceil(n.value / 2) : n.value))
const times = computed(() => pgTimes(n.value, v.value))
// 点阵：第几圈（离中心越近越早），每圈 0.13 秒，只做透明度 + 0.8→1，不位移
const ring = (i: number) => {
  const rows = Math.ceil(n.value / 10)
  const r = Math.floor(i / 10), c = i % 10
  return Math.floor(Math.max(Math.abs(c - 4.5), Math.abs(r - (rows - 1) / 2)))
}
const iconStyle = (i: number) => {
  if (grid.value) {
    const p = easeOutCubic(progress(props.t, PG_APPEAR + ring(i) * 0.13, PG_APPEAR + ring(i) * 0.13 + 0.22))
    return { opacity: p, transform: `scale(${lerp(0.8, 1, p)})` }
  }
  const p = stagger(props.t, PG_APPEAR, 0.05, i, 0.3)
  return { opacity: easeOutCubic(p), transform: `translateY(${lerp(20, 0, easeOutCubic(p))}px) scale(${lerp(0.5, 1, easeOutBack(p))})` }
}
const lit = (i: number) => i < v.value && props.t >= times.value.light + i * times.value.step
const fracStyle = computed(() => enter(props.t, times.value.light + v.value * times.value.step, 0.5))
const titleStyle = computed(() => enter(props.t, 0.1))
// 两种图标：人 / 圆点
const PERSON = 'M12 2.5a3.6 3.6 0 1 1 0 7.2 3.6 3.6 0 0 1 0-7.2zM5.5 21.5v-4.2c0-3 2.6-5.3 6.5-5.3s6.5 2.3 6.5 5.3v4.2z'
</script>

<template>
  <div ref="root" class="pg" :style="rootStyle">
    <CardShell v-if="data.panel" :t="t" :duration="data.duration" />
    <div v-if="data.label" class="pg-label"><i class="bx-dot" :style="{ '--pulse': pulse(t) }" />{{ data.label }}</div>
    <div v-if="data.title" class="pg-title" :style="titleStyle">{{ data.title }}</div>
    <div class="pg-body">
      <div class="pg-grid" :class="{ dense: grid }" :style="{ gridTemplateColumns: `repeat(${cols}, ${grid ? 34 : 72}px)` }">
        <template v-if="grid">
          <i v-for="i in n" :key="`g${i}`" class="pg-cell" :class="{ on: lit(i - 1) }" :style="iconStyle(i - 1)" />
        </template>
        <template v-else>
        <svg v-for="i in n" :key="i" viewBox="0 0 24 24" class="pg-ic" :class="{ on: lit(i - 1) }" :style="iconStyle(i - 1)">
          <path v-if="data.icon !== 'dot'" :d="PERSON" />
          <circle v-else cx="12" cy="12" r="8" />
        </svg>
        </template>
      </div>
      <div class="pg-frac" :style="fracStyle">
        <span class="bx-hot">{{ data.value }}</span><small>/ {{ data.total }}</small>
        <div v-if="data.caption" class="pg-cap">{{ data.caption }}</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pg { position: relative; display: inline-block; padding: 48px 80px 52px 60px; box-sizing: border-box; color: var(--fg); font-family: var(--font-cn); }
.pg-label { position: relative; display: flex; align-items: center; gap: 18px; margin-bottom: 14px; font-family: var(--font-mono); font-size: 38px; font-weight: 600; letter-spacing: 0.3em; text-transform: uppercase; color: var(--accent); white-space: nowrap; }
.pg-title { position: relative; font-size: 76px; font-weight: 700; white-space: nowrap; margin-bottom: 34px; }
.pg-body { position: relative; display: flex; align-items: center; gap: 60px; }
.pg-grid { display: grid; gap: 14px 10px; }
.pg-grid.dense { gap: 8px; }
.pg-cell { display: block; width: 34px; height: 34px; border-radius: 7px; background: var(--track); }
.pg-cell.on { background: var(--accent); box-shadow: 0 0 10px color-mix(in srgb, var(--accent) var(--glow-a, 45%), transparent); }
.pg-ic { width: 72px; height: 72px; fill: var(--track); }
.pg-ic.on { fill: var(--accent); filter: drop-shadow(0 0 10px color-mix(in srgb, var(--accent) var(--glow-a, 45%), transparent)); }
.pg-frac { font-family: var(--font-mono); font-size: 150px; font-weight: 800; line-height: 1; white-space: nowrap; }
.pg-frac small { font-size: 0.4em; color: var(--mute); margin-left: 10px; }
.pg-cap { font-family: var(--font-cn); font-size: 44px; font-weight: 600; color: var(--mute); margin-top: 14px; }
</style>
