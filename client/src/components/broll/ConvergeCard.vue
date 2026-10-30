<script setup lang="ts">
import { computed } from 'vue'
import { easeInOutCubic, easeOutBack, easeOutCubic, lerp, progress } from './timeline'
import { useCardBase } from './cardBase'
import CardShell from './CardShell.vue'
import CardHead from './CardHead.vue'
import { cueAt } from './cues'

// 「多源汇聚」卡：左边几个来源（纯文字，不套框）依次出现，各自牵出一条曲线汇到右边一点；每条线画完，一颗强调色光点沿线滑过去，
// 最后一颗到达时汇聚点脉冲一下、结果胶囊弹出来，来源压暗。讲「几样东西最后都落到一个结果上」（多对一，不是先后链条）。
// 来源、结果都摘原话。cues[0..n-1] 是各来源出现的时刻，cues[n] 是结果出现的时刻。

export interface ConvergeData { label: string; title: string; sources: string[]; result: string; cues?: (number | null)[]; accent: string; panel: boolean; duration: number }
const props = defineProps<{ data: ConvergeData; t: number }>()
const emit = defineEmits<{ size: [{ w: number; h: number }] }>()
const { root, rootStyle } = useCardBase(props, emit)

// 和 templates.ts 的 cvSrcAt / cvResultAt 一致
const ROW = 118
const CW = 340
const sources = computed(() => props.data.sources.filter((s) => s.trim()))
const n = computed(() => sources.value.length)
const srcAt = (i: number) => cueAt(props.data.cues, i, 0.4 + i * 0.25)
const resultAt = computed(() => cueAt(props.data.cues, n.value, Math.max(0, ...sources.value.map((_, i) => srcAt(i))) + 1.25))
const H = computed(() => Math.max(1, n.value) * ROW)
const ym = computed(() => H.value / 2)
const yi = (i: number) => ROW / 2 + i * ROW

// 三次贝塞尔：(0,yi) → (CW,ym)，控制点水平拉出去，线是 S 形
const bez = (i: number, s: number) => {
  const y0 = yi(i), y1 = ym.value, u = 1 - s
  const x = 3 * u * u * s * (CW * 0.5) + 3 * u * s * s * (CW * 0.5) + s * s * s * CW
  const y = u * u * u * y0 + 3 * u * u * s * y0 + 3 * u * s * s * y1 + s * s * s * y1
  return { x, y }
}
const curve = (i: number) => `M0 ${yi(i)} C ${CW * 0.5} ${yi(i)}, ${CW * 0.5} ${ym.value}, ${CW} ${ym.value}`
const drawP = (i: number) => easeInOutCubic(progress(props.t, srcAt(i) + 0.2, srcAt(i) + 0.7))
const packet = (i: number) => {
  const p = progress(props.t, srcAt(i) + 0.7, Math.min(resultAt.value, srcAt(i) + 1.25))
  if (p <= 0 || p >= 1) return null
  return bez(i, easeInOutCubic(p))
}
const merged = computed(() => props.t >= resultAt.value)
const srcStyle = (i: number) => {
  const p = easeOutCubic(progress(props.t, srcAt(i), srcAt(i) + 0.35))
  const dim = lerp(1, 0.5, easeOutCubic(progress(props.t, resultAt.value, resultAt.value + 0.4)))
  return { opacity: p * dim, transform: `translateX(${lerp(-30, 0, p)}px)` }
}
const hubPulse = computed(() => Math.sin(progress(props.t, resultAt.value, resultAt.value + 0.5) * Math.PI))
const resultStyle = computed(() => {
  const p = progress(props.t, resultAt.value + 0.05, resultAt.value + 0.5)
  return { opacity: easeOutCubic(p), transform: `scale(${lerp(0.6, 1, easeOutBack(p))})` }
})
</script>

<template>
  <div ref="root" class="cv" :style="rootStyle">
    <CardShell v-if="data.panel" :t="t" :duration="data.duration" />
    <CardHead :t="t" :label="data.label" :title="data.title" />
    <div class="cv-body">
      <div class="cv-srcs">
        <div v-for="(s, i) in sources" :key="i" class="cv-src" :style="[srcStyle(i), { height: `${ROW}px` }]"><span>{{ s }}</span></div>
      </div>
      <svg class="cv-svg" :width="CW" :height="H" :viewBox="`0 0 ${CW} ${H}`" overflow="visible">
        <path v-for="(_, i) in sources" :key="i" class="cv-line" :d="curve(i)" pathLength="1" :style="{ strokeDashoffset: 1 - drawP(i) }" />
        <template v-for="(_, i) in sources" :key="`p${i}`">
          <circle v-if="packet(i)" class="cv-packet" :cx="packet(i)!.x" :cy="packet(i)!.y" r="11" />
        </template>
        <circle class="cv-hub" :cx="CW" :cy="ym" :r="14 + 16 * hubPulse" :style="{ opacity: merged ? 0.35 + 0.65 * hubPulse : 0 }" />
      </svg>
      <div class="cv-result" :style="resultStyle">
        <span class="bx-hot">{{ data.result }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.cv { position: relative; display: inline-block; padding: 44px 80px 48px 64px; box-sizing: border-box; color: var(--fg); font-family: var(--font-cn); }
.cv-body { position: relative; display: flex; align-items: center; }
.cv-srcs { display: flex; flex-direction: column; align-items: flex-end; }
.cv-src { display: flex; align-items: center; }
.cv-src span { padding-right: 24px; font-size: 54px; font-weight: 700; white-space: nowrap; }
.cv-svg { flex: none; }
.cv-line { fill: none; stroke: var(--accent); stroke-width: 5; stroke-linecap: round; stroke-dasharray: 1; opacity: 0.75; }
.cv-packet { fill: var(--accent); filter: drop-shadow(0 0 10px var(--accent)); }
.cv-hub { fill: var(--accent); filter: drop-shadow(0 0 18px var(--accent)); }
.cv-result {
  margin-left: 26px; padding: 22px 44px; border-radius: 26px; border: 4px solid var(--accent); background: var(--panel);
  font-size: 76px; font-weight: 800; white-space: nowrap;
  box-shadow: 0 0 50px color-mix(in srgb, var(--accent) var(--glow-a), transparent);
}
</style>
