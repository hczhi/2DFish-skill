<script setup lang="ts">
import { computed } from 'vue'
import { depthIn, easeOutCubic, lerp, progress, stagger } from './timeline'
import { useCardBase } from './cardBase'

// 「开场标题」卡：视频开头的片名。小字先出 → 主标题逐字从镜头前落位 → 一道光从标题上扫过 → 两侧细线展开 → 副标题。
// 默认全屏（盖住口播，像片头）；标题允许 AI 概括，但开场卡建议自己写。
export interface OpeningData { kicker: string; title: string; subtitle: string; accent: string; panel: boolean; fullscreen: boolean; duration: number }
const props = defineProps<{ data: OpeningData; t: number }>()
const emit = defineEmits<{ size: [{ w: number; h: number }] }>()
const { root, rootStyle } = useCardBase(props, emit, { out: 0.6, exit: 'none' })

const chars = computed(() => [...props.data.title])
const CH_AT = 0.4
const CH_STEP = 0.07
const done = computed(() => CH_AT + chars.value.length * CH_STEP + 0.4)
const kickerStyle = computed(() => {
  const p = easeOutCubic(progress(props.t, 0.05, 0.5))
  return { opacity: p, letterSpacing: `${lerp(1, 0.5, p)}em` }
})
const sweep = computed(() => progress(props.t, done.value, done.value + 0.8))
const rule = computed(() => easeOutCubic(progress(props.t, done.value - 0.1, done.value + 0.5)))
const subStyle = computed(() => {
  const p = easeOutCubic(progress(props.t, done.value + 0.2, done.value + 0.7))
  return { opacity: p, transform: `translateY(${lerp(16, 0, p)}px)` }
})
</script>

<template>
  <div ref="root" class="op" :style="rootStyle">
    <div v-if="data.kicker" class="op-kicker" :style="kickerStyle">{{ data.kicker }}</div>
    <div class="op-title">
      <span v-for="(c, i) in chars" :key="i" class="op-ch" :style="depthIn(t, CH_AT + i * CH_STEP, 0.6, 2.4)">{{ c }}</span>
      <i class="op-sweep" :style="{ opacity: sweep > 0 && sweep < 1 ? 1 : 0, transform: `translateX(${lerp(-120, 220, sweep)}%) skewX(-20deg)` }" />
    </div>
    <div class="op-rule">
      <i :style="{ transform: `scaleX(${rule})` }" /><b class="bx-dot" /><i :style="{ transform: `scaleX(${rule})` }" />
    </div>
    <div v-if="data.subtitle" class="op-sub" :style="subStyle">{{ data.subtitle }}</div>
  </div>
</template>

<style scoped>
.op { position: relative; display: inline-flex; flex-direction: column; align-items: center; padding: 60px 100px; color: var(--fg); font-family: var(--font-cn); }
.op-kicker { font-family: var(--font-mono); font-size: 40px; font-weight: 600; text-transform: uppercase; color: var(--accent); margin-bottom: 30px; white-space: nowrap; }
.op-title { position: relative; overflow: hidden; padding: 10px 20px; font-size: 180px; font-weight: 900; line-height: 1.1; white-space: nowrap; }
.op-ch { display: inline-block; white-space: pre; }
.op-sweep { position: absolute; top: 0; bottom: 0; left: 0; width: 30%; background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.55), transparent); mix-blend-mode: overlay; }
.op-rule { display: flex; align-items: center; gap: 24px; margin: 30px 0 26px; }
.op-rule i { display: block; width: 260px; height: 3px; background: linear-gradient(90deg, transparent, var(--accent)); }
.op-rule i:last-child { background: linear-gradient(270deg, transparent, var(--accent)); transform-origin: left center; }
.op-rule i:first-child { transform-origin: right center; }
.op-sub { font-size: 54px; font-weight: 600; color: var(--mute); white-space: nowrap; }
</style>
