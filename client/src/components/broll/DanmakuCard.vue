<script setup lang="ts">
import { computed } from 'vue'
import { easeOutCubic, progress } from './timeline'
import { useCardBase } from './cardBase'

// 「弹幕」卡：几条评论从右往左飘过，分几行、速度各不相同。**只能手动填、AI 不配**：AI 编的评论和真观众说的一模一样，
// 观众会当成真实反馈。右上角一个「示意」小标默认开着（拿真实评论时可以关）。位置 / 速度由固定种子算，画面只由 t 决定。
export interface DanmakuData { items: string[]; mock: boolean; accent: string; panel: boolean; duration: number }
const props = defineProps<{ data: DanmakuData; t: number }>()
const emit = defineEmits<{ size: [{ w: number; h: number }] }>()
const { root, rootStyle } = useCardBase(props, emit, { exit: 'none' })

const W = 1500
const ROWS = 4
const hash = (i: number, k: number) => { const x = Math.sin(i * 127.1 + k * 311.7) * 43758.5453; return x - Math.floor(x) }
const items = computed(() => props.data.items.filter((s) => s.trim()))
// 第 i 条：第几行、什么时候出发、多快（每秒多少像素）
const flyStyle = (i: number) => {
  const start = 0.15 + i * 0.45 + hash(i, 1) * 0.2
  const speed = 520 + hash(i, 2) * 260
  const x = W - (props.t - start) * speed
  return { top: `${(i % ROWS) * 86}px`, transform: `translateX(${x}px)`, opacity: props.t < start ? 0 : 1, '--hi': i % 3 === 0 ? 1 : 0 }
}
const tagStyle = computed(() => ({ opacity: easeOutCubic(progress(props.t, 0.2, 0.5)) }))
</script>

<template>
  <div ref="root" class="dm" :style="rootStyle">
    <div class="dm-lane">
      <span v-for="(it, i) in items" :key="i" class="dm-item" :class="{ hi: i % 3 === 0 }" :style="flyStyle(i)">{{ it }}</span>
    </div>
    <span v-if="data.mock" class="dm-tag" :style="tagStyle">示意</span>
  </div>
</template>

<style scoped>
.dm { position: relative; display: inline-block; width: 1500px; height: 360px; font-family: var(--font-cn); }
.dm-lane { position: absolute; inset: 0; overflow: hidden; }
.dm-item {
  position: absolute; left: 0; white-space: nowrap; font-size: 50px; font-weight: 700; color: #fff;
  text-shadow: 0 2px 6px rgba(0, 0, 0, 0.8), 0 0 2px rgba(0, 0, 0, 0.9);
}
.dm-item.hi { color: var(--accent); }
.dm-tag { position: absolute; right: 0; top: -54px; padding: 4px 16px; border-radius: 8px; font-size: 26px; color: var(--fg); background: rgba(0, 0, 0, 0.45); }
</style>
