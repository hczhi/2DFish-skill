<script setup lang="ts">
import { computed } from 'vue'
import { easeOutBack, easeOutCubic, lerp, progress, pulse } from './timeline'
import { useCardBase } from './cardBase'
import CardShell from './CardShell.vue'
import { agAt, agCurrent, agFocusAt } from './agendaTimes'

// 「章节目录高亮」：几条章节从右侧错峰滑进来，全部站定之后**只有当前那一条**换成强调色、左边弹出一枚圆点、整行往前一步，
// 其余压暗；同一刻四角角框往里收一下把这一幕封住。「今天讲 4 件事，现在讲第 2 件」用。
// current = 0 是开头报目录：不高亮，每条跟着口播一条条出（可按字幕对齐）。「现在第几条」由他在面板里选，不交给模型 —— 模型数错的话亮的是另一条，读起来完全正常。

export interface AgendaData { label: string; title: string; items: string[]; current: string; cues?: (number | null)[]; accent: string; panel: boolean; duration: number }
const props = defineProps<{ data: AgendaData; t: number }>()
const emit = defineEmits<{ size: [{ w: number; h: number }] }>()
const { root, rootStyle, enter } = useCardBase(props, emit)

const items = computed(() => (props.data.items || []).filter((s) => s?.trim()))
const cur = computed(() => agCurrent(props.data))
const focusAt = computed(() => agFocusAt(props.data))
const focusP = computed(() => (cur.value ? easeOutCubic(progress(props.t, focusAt.value, focusAt.value + 0.35)) : 0))
const rowStyle = (i: number) => {
  const p = easeOutCubic(progress(props.t, agAt(props.data, i), agAt(props.data, i) + 0.45))
  const on = cur.value === i + 1
  const step = on ? 28 * focusP.value : 0
  const dim = cur.value && !on ? lerp(1, 0.4, focusP.value) : 1
  return { opacity: p * dim, transform: `translateX(${lerp(90, 0, p) + step}px)` }
}
const dotStyle = (i: number) => {
  const p = cur.value === i + 1 ? progress(props.t, focusAt.value, focusAt.value + 0.35) : 0
  return { transform: `scale(${easeOutBack(p)})` }
}
const cornerP = computed(() => easeOutCubic(progress(props.t, cur.value ? focusAt.value : focusAt.value - 0.3, (cur.value ? focusAt.value : focusAt.value - 0.3) + 0.4)))
const cornerStyle = (k: number) => {
  const d = lerp(10, 0, cornerP.value)
  const sx = k % 2 ? 1 : -1, sy = k < 2 ? -1 : 1
  return { opacity: cornerP.value, transform: `translate(${sx * d}px, ${sy * d}px)` }
}
const titleStyle = computed(() => enter(props.t, 0.05, 0.45))
</script>

<template>
  <div ref="root" class="ag" :style="rootStyle">
    <CardShell v-if="data.panel" :t="t" :duration="data.duration" />
    <i v-for="k in 4" :key="k" class="ag-corner" :class="`c${k - 1}`" :style="cornerStyle(k - 1)" />
    <div class="ag-body">
      <div v-if="data.label || data.title" class="ag-head" :style="titleStyle">
        <span v-if="data.label" class="ag-label"><i class="bx-dot" :style="{ '--pulse': pulse(t) }" />{{ data.label }}</span>
        <span v-if="data.title" class="ag-title">{{ data.title }}</span>
      </div>
      <div v-for="(s, i) in items" :key="i" class="ag-row" :class="{ on: cur === i + 1 && focusP > 0.5 }" :style="rowStyle(i)">
        <span class="ag-dot" :style="dotStyle(i)" />
        <span class="ag-no">{{ String(i + 1).padStart(2, '0') }}</span>
        <span class="ag-text">{{ s }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ag { position: relative; display: inline-block; padding: 64px 110px 64px 84px; box-sizing: border-box; color: var(--fg); font-family: var(--font-cn); }
.ag-body { position: relative; display: flex; flex-direction: column; gap: 26px; }
.ag-head { display: flex; flex-direction: column; gap: 14px; margin-bottom: 12px; }
.ag-label { display: flex; align-items: center; gap: 18px; font-family: var(--font-mono); font-size: 34px; font-weight: 600; letter-spacing: 0.3em; text-transform: uppercase; color: var(--accent); white-space: nowrap; }
.ag-title { font-size: 56px; font-weight: 700; white-space: nowrap; }
.ag-row { position: relative; display: flex; align-items: baseline; gap: 30px; font-size: 72px; font-weight: 800; line-height: 1.15; white-space: nowrap; }
.ag-no { font-family: var(--font-mono); font-size: 40px; font-weight: 600; color: var(--fg); opacity: 0.6; }
.ag-row.on, .ag-row.on .ag-no { color: var(--accent); opacity: 1; }
.ag-dot { position: absolute; left: -46px; top: 50%; width: 22px; height: 22px; margin-top: -11px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 16px var(--accent); }
.ag-corner { position: absolute; width: 46px; height: 46px; border: 0 solid var(--accent); }
.ag-corner.c0 { left: 22px; top: 22px; border-left-width: 5px; border-top-width: 5px; }
.ag-corner.c1 { right: 22px; top: 22px; border-right-width: 5px; border-top-width: 5px; }
.ag-corner.c2 { left: 22px; bottom: 22px; border-left-width: 5px; border-bottom-width: 5px; }
.ag-corner.c3 { right: 22px; bottom: 22px; border-right-width: 5px; border-bottom-width: 5px; }
</style>
