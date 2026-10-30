<script setup lang="ts">
import { computed } from 'vue'
import { easeOutBack, easeOutCubic, lerp, progress, pulse } from './timeline'
import CardShell from './CardShell.vue'
import { useCardBase } from './cardBase'

// 「开场承诺条数」卡：「今天讲 3 个方法」—— 数字先单独砸到位、落定那一下换成强调色，
// 量词（「个方法」）被它从右边推出来，第二行副标题再跟上。数字是主语，靠先后不靠砸。
// 和「数字冲击」的区别：那张讲增长 / 金额这种量级，这张的数是「接下来讲几条」。数字、量词摘原话。

export interface CountBadgeData {
  label: string
  lead: string
  value: string
  unit: string
  title: string
  accent: string
  panel: boolean
  duration: number
}

const props = defineProps<{ data: CountBadgeData; t: number }>()
const emit = defineEmits<{ size: [{ w: number; h: number }] }>()
const { root, rootStyle, enter } = useCardBase(props, emit)

const NUM_AT = 0.2
const LAND = 0.65
const labelStyle = computed(() => {
  const p = easeOutCubic(progress(props.t, 0, 0.45))
  return { opacity: p, clipPath: `inset(0 ${100 - p * 100}% 0 0)` }
})
const leadStyle = computed(() => enter(props.t, 0.05, 0.4))
// 数字：从 1.6 倍缩到位，落定前是正文色，落定那一刻换成强调色（亮一下）
const numP = computed(() => progress(props.t, NUM_AT, LAND))
const numStyle = computed(() => ({
  opacity: easeOutCubic(Math.min(1, numP.value * 2)),
  transform: `scale(${lerp(1.6, 1, easeOutBack(numP.value))})`,
}))
const landed = computed(() => props.t >= LAND)
const flash = computed(() => Math.sin(progress(props.t, LAND, LAND + 0.5) * Math.PI))
// 量词从数字右缘推出来
const unitStyle = computed(() => {
  const p = easeOutCubic(progress(props.t, LAND + 0.05, LAND + 0.45))
  return { opacity: p, transform: `translateX(${lerp(-60, 0, p)}px)`, clipPath: `inset(0 ${100 - p * 100}% 0 0)` }
})
const titleStyle = computed(() => enter(props.t, LAND + 0.4))
</script>

<template>
  <div ref="root" class="cb" :style="rootStyle">
    <CardShell v-if="data.panel" :t="t" :duration="data.duration" />
    <div v-if="data.label" class="cb-label" :style="labelStyle"><i class="bx-dot" :style="{ '--pulse': pulse(t) }" />{{ data.label }}</div>
    <div class="cb-line">
      <span v-if="data.lead" class="cb-lead" :style="leadStyle">{{ data.lead }}</span>
      <span
        class="cb-num" :class="{ 'bx-hot': landed }" :style="{ ...numStyle, filter: `drop-shadow(0 0 ${40 * flash}px var(--accent))` }"
      >{{ data.value }}</span>
      <span v-if="data.unit" class="cb-unit" :style="unitStyle">{{ data.unit }}</span>
    </div>
    <div v-if="data.title" class="cb-title" :style="titleStyle">{{ data.title }}</div>
  </div>
</template>

<style scoped>
.cb {
  position: relative; display: inline-block; padding: 44px 80px 52px 60px; box-sizing: border-box;
  color: var(--fg); font-family: var(--font-cn);
}
.cb-label {
  position: relative; display: flex; align-items: center; gap: 18px; margin-bottom: 10px; white-space: nowrap;
  font-family: var(--font-mono); font-size: 38px; font-weight: 600; letter-spacing: 0.3em; text-transform: uppercase; color: var(--accent);
}
.cb-line { position: relative; display: flex; align-items: baseline; gap: 18px; white-space: nowrap; }
.cb-lead { font-size: 76px; font-weight: 600; }
.cb-num { display: inline-block; font-family: var(--font-mono); font-size: 240px; font-weight: 800; line-height: 1; letter-spacing: -6px; transform-origin: center 70%; }
.cb-unit { font-size: 96px; font-weight: 800; }
.cb-title { position: relative; margin-top: 18px; font-size: 64px; font-weight: 600; white-space: nowrap; color: var(--fg); opacity: 0.9; }
</style>
