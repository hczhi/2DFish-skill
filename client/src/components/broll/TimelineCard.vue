<script setup lang="ts">
import { computed } from 'vue'
import { easeInCubic, easeOutBack, easeOutCubic, lerp, progress, pulse, stagger } from './timeline'
import { useCardSize } from './cardSize'
import CardShell from './CardShell.vue'
import { useThemeMotion } from './themeContext'
import { cueAt } from './cues'

// 「时间线」卡：一条横线依次画过 2–5 个节点，节点上方是年份（等宽、强调色），下方是事件。
// 每一行写「年份 事件」（第一个空格前是年份），摘原话。最后一个节点亮起。
// 每个节点可以单独定出现时间（data.cues[i]，见 cues.ts）：横线一段一段走，走到第 i 个节点正好是它出现的那一刻。
export interface TimelineData { label: string; title: string; events: string[]; cues?: (number | null)[]; accent: string; panel: boolean; duration: number }
const props = defineProps<{ data: TimelineData; t: number }>()
const emit = defineEmits<{ size: [{ w: number; h: number }] }>()
const root = useCardSize(emit)
const { enter } = useThemeMotion()

const AT = 0.55
const STEP = 0.45
const OUT = 0.5
const outP = computed(() => easeInCubic(progress(props.t, props.data.duration - OUT, props.data.duration)))
const rootStyle = computed(() => ({
  opacity: 1 - outP.value, filter: `blur(${outP.value * 8}px)`, transform: `translateY(${-30 * outP.value}px)`,
  ...(props.data.accent ? { '--accent': props.data.accent } : {}),
}))
// 「2019 创立公司」「2019年创立」都拆得开：开头的年份（可带「年」）+ 剩下的
const splitEvent = (s: string) => {
  const m = s.trim().match(/^(\d{2,4}\s*年?|[^\s]+)\s*(.*)$/)
  return m ? { year: m[1].trim(), text: m[2].trim() } : { year: s, text: '' }
}
const events = computed(() => props.data.events.filter((s) => s.trim()).map(splitEvent))
const evAt = (i: number) => cueAt(props.data.cues, i, AT + i * STEP)
// 节点是等宽列，第 i 个的圆心大约在横线 (i + 0.5) / n 处；分段走，每段在下一个节点出现时到位
const lineP = computed(() => {
  const n = events.value.length
  if (!n) return 0
  const pts: [number, number][] = [[evAt(0) - 0.2, 0], ...events.value.map((_, i): [number, number] => [evAt(i), (i + 0.5) / n]), [evAt(n - 1) + STEP, 1]]
  for (let k = 0; k < pts.length - 1; k++) {
    const [t0, v0] = pts[k], [t1, v1] = pts[k + 1]
    if (props.t < t1) return lerp(v0, v1, easeOutCubic(progress(props.t, t0, Math.max(t1, t0 + 0.05))))
  }
  return 1
})
const nodeStyle = (i: number) => {
  const p = progress(props.t, evAt(i), evAt(i) + 0.4)
  return { opacity: easeOutCubic(p), transform: `scale(${lerp(0.3, 1, easeOutBack(p))})` }
}
const textStyle = (i: number) => {
  const p = easeOutCubic(progress(props.t, evAt(i) + 0.12, evAt(i) + 0.52))
  return { opacity: p, transform: `translateY(${lerp(14, 0, p)}px)`, filter: `blur(${lerp(6, 0, p)}px)` }
}
const lit = computed(() => pulse(props.t, 2.2) * progress(props.t, evAt(events.value.length - 1) + STEP, evAt(events.value.length - 1) + STEP + 0.3))
const titleStyle = computed(() => enter(props.t, 0.1))
</script>

<template>
  <div ref="root" class="tl" :style="rootStyle">
    <CardShell v-if="data.panel" :t="t" :duration="data.duration" />
    <div v-if="data.label" class="tl-label"><i class="bx-dot" :style="{ '--pulse': pulse(t) }" />{{ data.label }}</div>
    <div v-if="data.title" class="tl-title" :style="titleStyle">{{ data.title }}</div>
    <div class="tl-track">
      <i class="tl-line"><b :style="{ transform: `scaleX(${lineP})` }" /></i>
      <div v-for="(e, i) in events" :key="i" class="tl-ev">
        <div class="tl-year" :class="{ 'bx-hot': i === events.length - 1 }" :style="textStyle(i)">{{ e.year }}</div>
        <div class="tl-node" :class="{ last: i === events.length - 1 }" :style="[nodeStyle(i), { '--lit': i === events.length - 1 ? lit : 0 }]" />
        <div class="tl-text" :style="textStyle(i)">{{ e.text }}</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tl { position: relative; display: inline-block; padding: 48px 80px 48px 60px; box-sizing: border-box; color: var(--fg); font-family: var(--font-cn); }
.tl-label { position: relative; display: flex; align-items: center; gap: 18px; margin-bottom: 14px; font-family: var(--font-mono); font-size: 38px; font-weight: 600; letter-spacing: 0.3em; text-transform: uppercase; color: var(--accent); white-space: nowrap; }
.tl-title { position: relative; font-size: 80px; font-weight: 700; white-space: nowrap; margin-bottom: 36px; }
.tl-track { position: relative; display: flex; gap: 40px; }
.tl-line { position: absolute; left: 40px; right: 40px; top: 108px; height: 6px; background: var(--track); border-radius: 3px; }
.tl-line b { position: absolute; inset: 0; border-radius: 3px; background: var(--accent); transform-origin: left center; box-shadow: 0 0 12px var(--accent); }
.tl-ev { position: relative; display: flex; flex-direction: column; align-items: center; min-width: 240px; }
.tl-year { font-family: var(--font-mono); font-size: 60px; font-weight: 800; color: var(--accent); height: 84px; white-space: nowrap; }
.tl-node { width: 40px; height: 40px; border-radius: 50%; background: var(--accent); border: 8px solid color-mix(in srgb, var(--accent) 25%, var(--stamp-bg)); box-sizing: border-box; margin: 2px 0 22px; box-shadow: 0 0 calc(var(--lit, 0) * 40px) var(--accent); }
.tl-text { font-size: 44px; font-weight: 600; white-space: nowrap; }
</style>
