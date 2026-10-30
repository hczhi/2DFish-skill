<script setup lang="ts">
import { computed } from 'vue'
import { easeOutBack, easeOutCubic, lerp, progress } from './timeline'
import { useCardBase } from './cardBase'

// 「表情贴纸」卡：一个大表情「啵」地弹出（过冲 + 一圈小圆点炸开），停住时左右轻晃，旁边可选一行字。
// 表情是系统 emoji 字体画的 —— 服务器上没装彩色 emoji 字体时导出会变成方框或黑白，导出的字体提示会报出来。
export interface EmojiData { emoji: string; text: string; accent: string; panel: boolean; duration: number }
const props = defineProps<{ data: EmojiData; t: number }>()
const emit = defineEmits<{ size: [{ w: number; h: number }] }>()
const { root, rootStyle } = useCardBase(props, emit, { out: 0.35 })

const popStyle = computed(() => {
  const p = progress(props.t, 0, 0.5)
  const wob = Math.sin(Math.max(0, props.t - 0.5) * 3.2) * 6
  return { opacity: Math.min(1, p * 3), transform: `scale(${lerp(0.2, 1, easeOutBack(p))}) rotate(${lerp(-25, 0, easeOutCubic(p)) + wob}deg)` }
})
const BURST = Array.from({ length: 10 }, (_, i) => (i / 10) * Math.PI * 2)
const burstStyle = (a: number, k: number) => {
  const p = progress(props.t, 0.15, 0.7)
  const r = lerp(60, 230 + (k % 3) * 30, easeOutCubic(p))
  return { opacity: p > 0 && p < 1 ? 1 - p : 0, transform: `translate(${Math.cos(a) * r}px, ${Math.sin(a) * r}px) scale(${1 - p * 0.6})` }
}
const textStyle = computed(() => {
  const p = easeOutCubic(progress(props.t, 0.35, 0.75))
  return { opacity: p, transform: `translateX(${lerp(-24, 0, p)}px)` }
})
</script>

<template>
  <div ref="root" class="em" :style="rootStyle">
    <div class="em-wrap">
      <i v-for="(a, k) in BURST" :key="k" class="em-dot" :style="burstStyle(a, k)" />
      <span class="em-face" :style="popStyle">{{ data.emoji }}</span>
    </div>
    <span v-if="data.text" class="em-text" :style="textStyle">{{ data.text }}</span>
  </div>
</template>

<style scoped>
.em { position: relative; display: inline-flex; align-items: center; gap: 30px; padding: 60px; font-family: var(--font-cn); }
.em-wrap { position: relative; width: 300px; height: 300px; display: grid; place-items: center; }
.em-face { font-size: 240px; line-height: 1; font-family: "Apple Color Emoji", "Noto Color Emoji", "Segoe UI Emoji", sans-serif; filter: drop-shadow(0 16px 30px rgba(0, 0, 0, 0.35)); }
.em-dot { position: absolute; left: 50%; top: 50%; width: 26px; height: 26px; margin: -13px; border-radius: 50%; background: var(--accent); }
.em-dot:nth-child(even) { background: var(--fg); width: 16px; height: 16px; margin: -8px; }
.em-text { font-size: 80px; font-weight: 900; color: var(--fg); white-space: nowrap; text-shadow: var(--text-shadow); }
</style>
