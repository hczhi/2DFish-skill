<script setup lang="ts">
import { computed } from 'vue'
import { easeOutCubic, lerp, progress } from './timeline'
import { useCardBase } from './cardBase'
import CardShell from './CardShell.vue'
import { SLAB_AT, SLAB_OPEN, SLAB_RUSH, slabLand } from './slabTimes'

// 「斜切色块标题」：第一行话题整块硬现，第二行重点短语坐在一块斜切的强调色块上。
// punch = 块从中心撑开，**块撑到位那一帧**字才硬切出现并从 1.12 倍砸回原位；
// speed = 块从左边画外冲进来，落位那一帧左缘甩出三道长短不一的速度线，块里的字反向滑一小段（读出惯性）。
// 字一定等块到位才出：块还在长的时候字就在的话，字压在半块色上，前几帧读起来像描边坏了。
// 例：「做内容」/「先做减法」。两行都摘原话。

export interface SlabData { lead: string; key: string; style: 'punch' | 'speed'; accent: string; panel: boolean; duration: number }
const props = defineProps<{ data: SlabData; t: number }>()
const emit = defineEmits<{ size: [{ w: number; h: number }] }>()
const { root, rootStyle } = useCardBase(props, emit)

const speed = computed(() => props.data.style === 'speed')
const land = computed(() => slabLand(props.data.style))
// 第一行 0.18 秒硬现（不做模糊对焦：这张卡的劲在「硬」）
const leadStyle = computed(() => ({ opacity: easeOutCubic(progress(props.t, 0, 0.18)) }))
const power4Out = (p: number) => 1 - Math.pow(1 - p, 4)
const slabStyle = computed(() => {
  if (speed.value) {
    const p = power4Out(progress(props.t, SLAB_AT, SLAB_AT + SLAB_RUSH))
    // 起点在左边画外很远（起始那一帧完全看不见），整块一起冲进来，不缩放
    return { transform: `skewX(-12deg) translateX(${lerp(-1800, 0, p)}px)`, opacity: props.t < SLAB_AT ? 0 : 1 }
  }
  const p = easeOutCubic(progress(props.t, SLAB_AT, SLAB_AT + SLAB_OPEN))
  return { transform: `skewX(-12deg) scaleX(${p})`, opacity: p > 0 ? 1 : 0 }
})
const keyStyle = computed(() => {
  if (props.t < land.value) return { opacity: 0 }
  if (speed.value) {
    const p = easeOutCubic(progress(props.t, land.value, land.value + 0.25))
    return { transform: `translateX(${lerp(40, 0, p)}px)` }
  }
  const p = easeOutCubic(progress(props.t, land.value, land.value + 0.167))
  return { transform: `scale(${lerp(1.12, 1, p)})` }
})
// 速度线：三道，错峰 2 帧，0.2 秒内伸出再淡尽
const LINES = [{ len: 150, y: 28 }, { len: 106, y: 52 }, { len: 76, y: 74 }]
const lineStyle = (i: number) => {
  const a = land.value + i * 0.067
  const p = easeOutCubic(progress(props.t, a, a + 0.12))
  const o = 1 - progress(props.t, a + 0.12, a + 0.32)
  return { top: `${LINES[i].y}%`, width: `${LINES[i].len * p}px`, opacity: p > 0 ? o : 0 }
}
</script>

<template>
  <div ref="root" class="sl" :class="{ bare: !data.panel }" :style="rootStyle">
    <CardShell v-if="data.panel" :t="t" :duration="data.duration" />
    <div class="sl-body">
      <div v-if="data.lead" class="sl-lead" :style="leadStyle">{{ data.lead }}</div>
      <div class="sl-slab-row">
        <span class="sl-slab" :style="slabStyle" />
        <template v-if="speed"><i v-for="(_, i) in LINES" :key="i" class="sl-speed" :style="lineStyle(i)" /></template>
        <span class="sl-key" :style="keyStyle">{{ data.key }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.sl { position: relative; display: inline-block; padding: 56px 88px; box-sizing: border-box; font-family: var(--font-cn); }
.sl.bare { padding: 0 24px; }
.sl-body { position: relative; display: flex; flex-direction: column; align-items: flex-start; gap: 14px; }
.sl-lead { font-size: 92px; font-weight: 700; color: var(--fg); white-space: nowrap; line-height: 1.2; }
.sl-slab-row { position: relative; display: inline-block; padding: 0.06em 0.5em 0.12em; font-size: 148px; font-weight: 900; line-height: 1.15; white-space: nowrap; }
.sl-slab { position: absolute; inset: 0; background: var(--accent); transform-origin: center; box-shadow: 0 22px 48px -20px var(--shadow-c); }
.sl-key { position: relative; display: inline-block; color: var(--ink-on-accent); letter-spacing: 0.02em; transform-origin: center; }
.sl-speed { position: absolute; right: calc(100% + 18px); height: 8px; border-radius: 4px; background: var(--accent); transform: translateY(-50%) skewX(-12deg); }
</style>
