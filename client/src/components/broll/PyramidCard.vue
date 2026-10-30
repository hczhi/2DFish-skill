<script setup lang="ts">
import { computed } from 'vue'
import { easeOutCubic, lerp, stagger } from './timeline'
import { useCardBase } from './cardBase'
import CardShell from './CardShell.vue'
import CardHead from './CardHead.vue'

// 「金字塔」卡：2–5 层，从最底层往上一层层搭起来，塔尖那层用强调色。第一行是塔尖（最高一层），最后一行是底层。
export interface PyramidData { label: string; title: string; levels: string[]; accent: string; panel: boolean; duration: number }
const props = defineProps<{ data: PyramidData; t: number }>()
const emit = defineEmits<{ size: [{ w: number; h: number }] }>()
const { root, rootStyle } = useCardBase(props, emit)

const BASE = 1000
const LH = 120
const levels = computed(() => props.data.levels.filter((s) => s.trim()))
const n = computed(() => levels.value.length)
// 第 i 层（0 = 塔尖）的上下边宽度：整体是一个三角形切成 n 段
const shape = (i: number) => {
  const top = (i / n.value) * BASE, bot = ((i + 1) / n.value) * BASE
  const inset = (BASE - top) / 2, insetB = (BASE - bot) / 2
  return `polygon(${inset}px 0, ${BASE - inset}px 0, ${BASE - insetB}px 100%, ${insetB}px 100%)`
}
// 从底层往上搭
const levelStyle = (i: number) => {
  const order = n.value - 1 - i
  const p = easeOutCubic(stagger(props.t, 0.4, 0.32, order, 0.45))
  return { opacity: p, transform: `translateY(${lerp(40, 0, p)}px)`, clipPath: shape(i) }
}
</script>

<template>
  <div ref="root" class="pm" :style="rootStyle">
    <CardShell v-if="data.panel" :t="t" :duration="data.duration" />
    <CardHead :t="t" :label="data.label" :title="data.title" />
    <div class="pm-stack" :style="{ width: `${BASE}px` }">
      <div v-for="(lv, i) in levels" :key="i" class="pm-level" :class="{ top: i === 0 }" :style="[levelStyle(i), { height: `${LH}px` }]">
        <span>{{ lv }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pm { position: relative; display: inline-block; padding: 48px 70px 50px 60px; box-sizing: border-box; color: var(--fg); font-family: var(--font-cn); }
.pm-stack { position: relative; display: flex; flex-direction: column; gap: 8px; }
.pm-level { display: grid; place-items: center; background: color-mix(in srgb, var(--accent) 16%, var(--track)); }
.pm-level:nth-child(even) { background: color-mix(in srgb, var(--accent) 8%, var(--track)); }
.pm-level.top { background: linear-gradient(180deg, color-mix(in srgb, var(--accent) 45%, #fff), var(--accent)); }
.pm-level span { font-size: 46px; font-weight: 700; white-space: nowrap; }
.pm-level.top span { color: var(--ink-on-accent); font-size: 40px; }
</style>
