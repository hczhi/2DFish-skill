<script setup lang="ts">
import { computed } from 'vue'
import { easeInOutCubic, easeOutCubic, lerp, progress, pulse } from './timeline'
import { useCardBase } from './cardBase'
import CardShell from './CardShell.vue'
import { fmtLike, parseRows } from './rows'
import { BO_AT, BO_GROW, BO_RESCALE, BO_SHOOT, BO_STEP, boRescaleAt, boShootAt } from './breakoutTimes'

// 「增长爆框」：前面几根柱按「前面这些数」定的刻度长好，最后一根一冲冲出图框顶边（框抖一下），停一拍，
// 然后纵轴重新标刻度、所有柱子一起缩回框里 —— 读出来是「增长大到原来的图装不下」。
// 最后一项必须是明显最大的那个（由模版 check 报），不然冲不出去，读起来就是一张普通柱状图。
// 名字和数值都摘原话；刻度由代码按数值取整，不交给模型。

export interface BreakoutData { label: string; title: string; rows: string[]; unit: string; accent: string; panel: boolean; duration: number }
const props = defineProps<{ data: BreakoutData; t: number }>()
const emit = defineEmits<{ size: [{ w: number; h: number }] }>()
const { root, rootStyle, enter } = useCardBase(props, emit)

const PW = 1080, PH = 440
// 冲出框最多冲到框高的这么多倍（再高就出卡片了），框上面留出这段空间
const OVER = 0.45
const rows = computed(() => parseRows(props.data.rows).slice(0, 6).map((r) => ({ ...r, v: Number.isNaN(r.v) ? 0 : r.v })))
const n = computed(() => rows.value.length)
// 取整刻度：1 / 2 / 5 × 10^k 里刚好盖住的那个
const nice = (v: number) => {
  if (v <= 0) return 1
  const e = Math.pow(10, Math.floor(Math.log10(v)))
  return ([1, 2, 2.5, 5, 10].find((m) => m * e >= v) || 10) * e
}
const oldMax = computed(() => nice(Math.max(0, ...rows.value.slice(0, -1).map((r) => r.v))))
const newMax = computed(() => nice(Math.max(0, ...rows.value.map((r) => r.v))))
const shootAt = computed(() => boShootAt(n.value))
const rescaleAt = computed(() => boRescaleAt(n.value))
const rescale = computed(() => easeInOutCubic(progress(props.t, rescaleAt.value, rescaleAt.value + BO_RESCALE)))
const axisMax = computed(() => lerp(oldMax.value, newMax.value, rescale.value))
const barW = computed(() => Math.min(130, (PW - 80) / Math.max(1, n.value) - 40))
const bars = computed(() => rows.value.map((r, i) => {
  const last = i === n.value - 1
  const g = last ? easeOutCubic(progress(props.t, shootAt.value, shootAt.value + BO_SHOOT)) : easeOutCubic(progress(props.t, BO_AT + i * BO_STEP, BO_AT + i * BO_STEP + BO_GROW))
  const full = (r.v / axisMax.value) * PH
  const h = Math.min(full, PH * (1 + OVER)) * g
  return { ...r, h, last, val: fmtLike(r.raw, r.v * g), x: 40 + i * ((PW - 80) / n.value) + ((PW - 80) / n.value - barW.value) / 2 }
}))
// 冲破那一下：框整体抖 0.2 秒，顶边闪一下
const breachAt = computed(() => shootAt.value + BO_SHOOT * 0.35)
const shake = computed(() => {
  const p = progress(props.t, breachAt.value, breachAt.value + 0.22)
  return p > 0 && p < 1 ? Math.sin(p * 40) * 9 * (1 - p) : 0
})
const flash = computed(() => Math.sin(progress(props.t, breachAt.value, breachAt.value + 0.35) * Math.PI))
// 刻度在重标时跟着连续变（能看见数字在往上跑）；10 以下留一位小数
const tickText = (v: number) => (axisMax.value >= 10 ? String(Math.round(v)) : v.toFixed(1))
const ticks = computed(() => [0, 0.5, 1].map((k) => ({ y: PH - k * PH, text: tickText(axisMax.value * k) })))
const frameStyle = computed(() => ({ transform: `translateX(${shake.value}px)` }))
const headStyle = computed(() => enter(props.t, 0, 0.45))
</script>

<template>
  <div ref="root" class="bo" :class="{ boxed: data.panel }" :style="rootStyle">
    <CardShell v-if="data.panel" :t="t" :duration="data.duration" />
    <div class="bo-head" :style="headStyle">
      <span v-if="data.label" class="bo-label"><i class="bx-dot" :style="{ '--pulse': pulse(t) }" />{{ data.label }}</span>
      <span v-if="data.title" class="bo-title">{{ data.title }}<small v-if="data.unit">（{{ data.unit }}）</small></span>
    </div>
    <div class="bo-plot" :style="[{ width: `${PW}px`, height: `${PH * (1 + OVER) + 70}px` }, frameStyle]">
      <div class="bo-frame" :style="{ top: `${PH * OVER}px`, height: `${PH}px`, '--flash': flash }" />
      <div v-for="(tk, k) in ticks" :key="k" class="bo-tick" :style="{ top: `${PH * OVER + tk.y}px` }">{{ tk.text }}</div>
      <div v-for="(b, i) in bars" :key="i" class="bo-bar" :class="{ last: b.last }" :style="{ left: `${b.x}px`, width: `${barW}px`, top: `${PH * OVER + PH - b.h}px`, height: `${b.h}px` }">
        <span v-if="b.h > 1" class="bo-val">{{ b.val }}</span>
      </div>
      <div v-for="(b, i) in bars" :key="`n${i}`" class="bo-name" :style="{ left: `${b.x + barW / 2}px`, top: `${PH * OVER + PH + 14}px` }">{{ b.name }}</div>
    </div>
  </div>
</template>

<style scoped>
.bo { position: relative; display: inline-flex; flex-direction: column; gap: 10px; padding: 20px 20px 20px 90px; color: var(--fg); font-family: var(--font-cn); }
.bo.boxed { padding: 56px 64px 56px 120px; }
.bo-head { position: relative; display: flex; flex-direction: column; gap: 10px; }
.bo-label { display: flex; align-items: center; gap: 18px; font-family: var(--font-mono); font-size: 34px; font-weight: 600; letter-spacing: 0.3em; text-transform: uppercase; color: var(--accent); white-space: nowrap; }
.bo-title { font-size: 58px; font-weight: 800; white-space: nowrap; }
.bo-title small { font-size: 0.6em; opacity: 0.7; }
.bo-plot { position: relative; }
.bo-frame {
  position: absolute; left: 0; right: 0; border-left: 3px solid var(--track); border-bottom: 3px solid var(--fg);
  box-shadow: inset 0 3px 0 color-mix(in srgb, var(--accent) calc(var(--flash) * 100%), var(--track));
}
.bo-tick { position: absolute; right: calc(100% + 16px); transform: translateY(-50%); font-family: var(--font-mono); font-size: 30px; opacity: 0.7; white-space: nowrap; }
.bo-bar { position: absolute; border-radius: 10px 10px 0 0; background: color-mix(in srgb, var(--fg) 30%, transparent); }
.bo-bar.last { background: linear-gradient(180deg, color-mix(in srgb, var(--accent) 70%, var(--fg)), var(--accent)); box-shadow: 0 0 40px color-mix(in srgb, var(--accent) var(--glow-a), transparent); }
.bo-val { position: absolute; left: 50%; bottom: calc(100% + 10px); transform: translateX(-50%); font-size: 40px; font-weight: 800; white-space: nowrap; }
.bo-bar.last .bo-val { color: var(--accent); font-size: 56px; }
.bo-name { position: absolute; transform: translateX(-50%); font-size: 36px; font-weight: 600; white-space: nowrap; }
</style>
