<script setup lang="ts">
import { computed } from 'vue'
import { easeInCubic, easeOutBack, easeOutCubic, lerp, progress, pulse } from './timeline'
import { useCardSize } from './cardSize'
import CardShell from './CardShell.vue'
import { useThemeMotion } from './themeContext'

// 「前后变化」卡：以前的数（灰）→ 箭头画过去 → 现在的数（大、渐变），现在那个数从「以前」跳到「现在」。
// 例：「团队从 12 个人扩到了 86 个人」。两个数都摘原话；不是数字的话不跳、原样显示。
export interface BeforeAfterData {
  label: string; title: string; before: string; after: string; unit: string
  beforeLabel: string; afterLabel: string; accent: string; panel: boolean; duration: number
}
const props = defineProps<{ data: BeforeAfterData; t: number }>()
const emit = defineEmits<{ size: [{ w: number; h: number }] }>()
const root = useCardSize(emit)
const { enter } = useThemeMotion()

const OUT = 0.5
const outP = computed(() => easeInCubic(progress(props.t, props.data.duration - OUT, props.data.duration)))
const rootStyle = computed(() => ({
  opacity: 1 - outP.value, filter: `blur(${outP.value * 8}px)`, transform: `translateY(${-30 * outP.value}px)`,
  ...(props.data.accent ? { '--accent': props.data.accent } : {}),
}))
const num = (s: string) => { const v = Number(String(s).replace(/,/g, '')); return String(s).trim() !== '' && Number.isFinite(v) ? v : null }
const dec = (s: string) => (String(s).replace(/,/g, '').split('.')[1] || '').length
const ARROW_AT = 0.7
const AFTER_AT = 1.05
const afterText = computed(() => {
  const a = num(props.data.before), b = num(props.data.after)
  if (a === null || b === null) return props.data.after
  const p = easeOutCubic(progress(props.t, AFTER_AT, AFTER_AT + 1))
  const v = lerp(a, b, p)
  return String(props.data.after).includes(',') ? v.toLocaleString('en-US', { maximumFractionDigits: dec(props.data.after), minimumFractionDigits: dec(props.data.after) }) : v.toFixed(dec(props.data.after))
})
const beforeStyle = computed(() => enter(props.t, 0.3, 0.45))
const arrowP = computed(() => easeOutCubic(progress(props.t, ARROW_AT, ARROW_AT + 0.4)))
const afterStyle = computed(() => {
  const p = progress(props.t, AFTER_AT, AFTER_AT + 0.5)
  return { opacity: easeOutCubic(p), transform: `scale(${lerp(0.7, 1, easeOutBack(p))})` }
})
const titleStyle = computed(() => enter(props.t, 0.1))
</script>

<template>
  <div ref="root" class="ba" :style="rootStyle">
    <CardShell v-if="data.panel" :t="t" :duration="data.duration" />
    <div v-if="data.label" class="ba-label"><i class="bx-dot" :style="{ '--pulse': pulse(t) }" />{{ data.label }}</div>
    <div v-if="data.title" class="ba-title" :style="titleStyle">{{ data.title }}</div>
    <div class="ba-row">
      <div class="ba-col" :style="beforeStyle">
        <div class="ba-num before">{{ data.before }}<small>{{ data.unit }}</small></div>
        <div class="ba-cap">{{ data.beforeLabel }}</div>
      </div>
      <svg class="ba-arrow" viewBox="0 0 220 60"><path d="M10 30 H190 M165 8 L200 30 L165 52" pathLength="1" :style="{ strokeDashoffset: 1 - arrowP }" /></svg>
      <div class="ba-col" :style="afterStyle">
        <div class="ba-num">
          <span class="ba-ghost">{{ data.after }}</span>
          <span class="ba-live bx-hot">{{ afterText }}<small>{{ data.unit }}</small></span>
        </div>
        <div class="ba-cap on">{{ data.afterLabel }}</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ba { position: relative; display: inline-block; padding: 48px 80px 52px 60px; box-sizing: border-box; color: var(--fg); font-family: var(--font-cn); }
.ba-label { position: relative; display: flex; align-items: center; gap: 18px; margin-bottom: 14px; font-family: var(--font-mono); font-size: 38px; font-weight: 600; letter-spacing: 0.3em; text-transform: uppercase; color: var(--accent); white-space: nowrap; }
.ba-title { position: relative; font-size: 76px; font-weight: 700; white-space: nowrap; margin-bottom: 30px; }
.ba-row { position: relative; display: flex; align-items: center; gap: 30px; }
.ba-col { display: flex; flex-direction: column; align-items: center; gap: 10px; }
.ba-num { display: inline-grid; font-family: var(--font-mono); font-weight: 800; font-size: 200px; line-height: 1; white-space: nowrap; }
.ba-num.before { display: inline-flex; align-items: baseline; font-size: 120px; color: var(--mute); }
.ba-num small { font-size: 0.4em; margin-left: 8px; font-family: var(--font-cn); }
.ba-ghost, .ba-live { grid-area: 1 / 1; }
.ba-ghost { visibility: hidden; }
.ba-cap { font-size: 40px; color: var(--mute); white-space: nowrap; }
.ba-cap.on { color: var(--accent); font-weight: 700; }
.ba-arrow { width: 220px; height: 60px; flex: none; }
.ba-arrow path { fill: none; stroke: var(--accent); stroke-width: 8; stroke-linecap: round; stroke-linejoin: round; stroke-dasharray: 1; filter: drop-shadow(0 0 8px var(--accent)); }
</style>
