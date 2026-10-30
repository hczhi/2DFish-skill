<script setup lang="ts">
import { computed } from 'vue'
import { easeOutCubic, lerp, progress, stagger } from './timeline'
import { useCardBase } from './cardBase'
import CardShell from './CardShell.vue'
import CardHead from './CardHead.vue'

// 「四象限」卡：坐标轴先画出来（横轴 / 纵轴各一个名字），四个格子依次出现，指定的那一格最后点亮。
// 格子顺序：右上 → 左上 → 左下 → 右下（数学里的一二三四象限）。
export interface QuadrantData { label: string; title: string; xLabel: string; yLabel: string; q1: string; q2: string; q3: string; q4: string; highlight: string; accent: string; panel: boolean; duration: number }
const props = defineProps<{ data: QuadrantData; t: number }>()
const emit = defineEmits<{ size: [{ w: number; h: number }] }>()
const { root, rootStyle } = useCardBase(props, emit)

const S = 300
const axis = computed(() => easeOutCubic(progress(props.t, 0.3, 0.8)))
// 网格位置：q2 左上、q1 右上、q3 左下、q4 右下
const cells = computed(() => [
  { k: '2', text: props.data.q2, x: 0, y: 0 }, { k: '1', text: props.data.q1, x: 1, y: 0 },
  { k: '3', text: props.data.q3, x: 0, y: 1 }, { k: '4', text: props.data.q4, x: 1, y: 1 },
])
const ORDER: Record<string, number> = { '1': 0, '2': 1, '3': 2, '4': 3 }
const cellStyle = (k: string) => {
  const p = easeOutCubic(stagger(props.t, 0.75, 0.22, ORDER[k], 0.4))
  return { opacity: p, transform: `scale(${lerp(0.85, 1, p)})` }
}
const lit = computed(() => props.t >= 0.75 + 4 * 0.22 + 0.2)
</script>

<template>
  <div ref="root" class="qd" :style="rootStyle">
    <CardShell v-if="data.panel" :t="t" :duration="data.duration" />
    <CardHead :t="t" :label="data.label" :title="data.title" />
    <div class="qd-plot" :style="{ width: `${2 * S + 20}px`, height: `${2 * S + 20}px` }">
      <div v-for="c in cells" :key="c.k" class="qd-cell" :class="{ hi: lit && data.highlight === c.k }"
        :style="[cellStyle(c.k), { left: `${c.x * (S + 20)}px`, top: `${c.y * (S + 20)}px`, width: `${S}px`, height: `${S}px` }]">
        {{ c.text }}
      </div>
      <i class="qd-ax x" :style="{ transform: `scaleX(${axis})` }" />
      <i class="qd-ax y" :style="{ transform: `scaleY(${axis})` }" />
      <span class="qd-lab x" :style="{ opacity: axis }">{{ data.xLabel }} →</span>
      <span class="qd-lab y" :style="{ opacity: axis }">↑ {{ data.yLabel }}</span>
    </div>
  </div>
</template>

<style scoped>
.qd { position: relative; display: inline-block; padding: 48px 120px 90px 120px; box-sizing: border-box; color: var(--fg); font-family: var(--font-cn); }
.qd-plot { position: relative; }
.qd-cell {
  position: absolute; display: grid; place-items: center; padding: 20px; box-sizing: border-box; border-radius: 20px; text-align: center;
  font-size: 46px; font-weight: 700; line-height: 1.3; background: var(--track); color: var(--mute);
}
.qd-cell.hi { color: var(--ink-on-accent); background: var(--accent); box-shadow: 0 0 40px color-mix(in srgb, var(--accent) var(--glow-a, 45%), transparent); }
.qd-ax { position: absolute; background: var(--fg); opacity: 0.8; }
.qd-ax.x { left: -20px; right: -20px; top: 50%; height: 4px; margin-top: -2px; transform-origin: left center; }
.qd-ax.y { top: -20px; bottom: -20px; left: 50%; width: 4px; margin-left: -2px; transform-origin: center bottom; }
.qd-lab { position: absolute; font-size: 36px; color: var(--accent); font-weight: 700; white-space: nowrap; }
.qd-lab.x { right: -20px; bottom: -60px; }
.qd-lab.y { left: 50%; top: -60px; transform: translateX(-50%); }
</style>
