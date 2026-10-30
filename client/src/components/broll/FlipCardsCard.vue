<script setup lang="ts">
import { computed } from 'vue'
import { easeInOutCubic, easeOutCubic, lerp, progress, pulse } from './timeline'
import { useCardBase } from './cardBase'
import CardShell from './CardShell.vue'
import { parseRows } from './rows'
import { FL_DUR, flAt } from './flipTimes'

// 「功能卡翻面出数字」：一排卡正面写做了什么，逐张沿竖轴翻 180°，背面是那一项的结论数字。
// 翻到侧棱最薄的那一刻（90°）卡面掠过一道随角度移动的受光 —— 没有这道光的话翻面读起来像两张图在切换。
// 例：「做选题 30」「改封面 120」「换开头 45」，单位 %。名字和数字都摘原话。每张什么时候翻可以按字幕对齐（找的是卡的名字）。
// 3D 只用来摆两面（rotateY + backface-visibility），角度本身按 t 算。

export interface FlipCardsData { label: string; title: string; rows: string[]; unit: string; prefix: string; cues?: (number | null)[]; accent: string; panel: boolean; duration: number }
const props = defineProps<{ data: FlipCardsData; t: number }>()
const emit = defineEmits<{ size: [{ w: number; h: number }] }>()
const { root, rootStyle, enter } = useCardBase(props, emit)

const rows = computed(() => parseRows(props.data.rows).slice(0, 4))
const angle = (i: number) => 180 * easeInOutCubic(progress(props.t, flAt(props.data, i), flAt(props.data, i) + FL_DUR))
const cardStyle = (i: number) => {
  const p = easeOutCubic(progress(props.t, 0.1 + i * 0.08, 0.6 + i * 0.08))
  return { opacity: p, transform: `translateY(${lerp(60, 0, p)}px)` }
}
const innerStyle = (i: number) => ({ transform: `rotateY(${angle(i)}deg)` })
// 受光：角度越接近 90° 越亮，光带位置随角度从左扫到右
const sheenStyle = (i: number) => {
  const a = angle(i)
  const k = 1 - Math.min(1, Math.abs(a - 90) / 70)
  return { opacity: k * 0.9, backgroundPositionX: `${lerp(-60, 160, a / 180)}%` }
}
// 背面数字按字数缩：「1,280万」按 128px 排会撑出 380 宽的卡
const valSize = (r: { raw: string }) => {
  const n = [...`${props.data.prefix || ''}${r.raw}`].length + [...(props.data.unit || '')].length * 0.5
  return `${Math.min(128, Math.floor(300 / (0.6 * Math.max(1, n))))}px`
}
const headStyle = computed(() => enter(props.t, 0, 0.45))
</script>

<template>
  <div ref="root" class="fc" :class="{ boxed: data.panel }" :style="rootStyle">
    <CardShell v-if="data.panel" :t="t" :duration="data.duration" />
    <div v-if="data.label || data.title" class="fc-head" :style="headStyle">
      <span v-if="data.label" class="fc-label"><i class="bx-dot" :style="{ '--pulse': pulse(t) }" />{{ data.label }}</span>
      <span v-if="data.title" class="fc-title">{{ data.title }}</span>
    </div>
    <div class="fc-row">
      <div v-for="(r, i) in rows" :key="i" class="fc-card" :style="cardStyle(i)">
        <div class="fc-inner" :style="innerStyle(i)">
          <div class="fc-face fc-front">
            <span class="fc-no">{{ String(i + 1).padStart(2, '0') }}</span>
            <span class="fc-name">{{ r.name }}</span>
            <i class="fc-sheen" :style="sheenStyle(i)" />
          </div>
          <div class="fc-face fc-back">
            <span class="fc-val bx-hot" :style="{ fontSize: valSize(r) }">{{ data.prefix }}{{ Number.isNaN(r.v) ? '?' : r.raw }}<small>{{ data.unit }}</small></span>
            <span class="fc-sub">{{ r.name }}</span>
            <i class="fc-sheen" :style="sheenStyle(i)" />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.fc { position: relative; display: inline-flex; flex-direction: column; gap: 36px; padding: 20px; color: var(--fg); font-family: var(--font-cn); }
.fc.boxed { padding: 56px 64px; }
.fc-head { position: relative; display: flex; flex-direction: column; gap: 12px; }
.fc-label { display: flex; align-items: center; gap: 18px; font-family: var(--font-mono); font-size: 34px; font-weight: 600; letter-spacing: 0.3em; text-transform: uppercase; color: var(--accent); white-space: nowrap; }
.fc-title { font-size: 60px; font-weight: 800; white-space: nowrap; }
.fc-row { position: relative; display: flex; gap: 34px; perspective: 1800px; }
.fc-card { width: 380px; height: 440px; }
.fc-inner { position: relative; width: 100%; height: 100%; transform-style: preserve-3d; }
.fc-face {
  position: absolute; inset: 0; border-radius: 26px; overflow: hidden; backface-visibility: hidden; -webkit-backface-visibility: hidden;
  display: flex; flex-direction: column; justify-content: center; align-items: center; gap: 22px; padding: 30px; box-sizing: border-box; text-align: center;
  background: var(--panel); box-shadow: 0 30px 70px -24px var(--shadow-c), inset 0 0 0 2px var(--line);
}
.fc-back { transform: rotateY(180deg); box-shadow: 0 30px 70px -24px var(--shadow-c), inset 0 0 0 3px var(--accent); }
.fc-no { font-family: var(--font-mono); font-size: 34px; color: var(--accent); letter-spacing: 0.1em; }
.fc-name { font-size: 64px; font-weight: 800; line-height: 1.2; }
.fc-val { font-size: 128px; font-weight: 900; line-height: 1; white-space: nowrap; }
.fc-val small { font-size: 0.42em; margin-left: 6px; }
.fc-sub { font-size: 40px; font-weight: 600; opacity: 0.75; }
.fc-sheen { position: absolute; inset: 0; pointer-events: none; background: linear-gradient(100deg, transparent 35%, var(--hi) 50%, transparent 65%); background-size: 220% 100%; }
</style>
