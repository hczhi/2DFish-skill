<script setup lang="ts">
import { computed } from 'vue'
import { easeOutBack, easeOutCubic, lerp, progress } from './timeline'
import { useCardBase } from './cardBase'

// 「警告牌」卡：黄黑警示条边框（条纹一直在走）+ 三角感叹号（落地后抖两下）+ 标题（如「注意」「千万别」）+ 一行说明。
// 颜色固定用警示黄，不跟主题强调色 —— 警示牌换成主题色就不像警示了。说明摘原话。
export interface WarningData { title: string; text: string; accent: string; panel: boolean; duration: number }
const props = defineProps<{ data: WarningData; t: number }>()
const emit = defineEmits<{ size: [{ w: number; h: number }] }>()
const { root, rootStyle } = useCardBase(props, emit)

const boardStyle = computed(() => {
  const p = progress(props.t, 0, 0.45)
  return { opacity: easeOutCubic(p), transform: `scale(${lerp(0.7, 1, easeOutBack(p))})` }
})
// 感叹号落地后左右抖两下
const iconStyle = computed(() => {
  const p = progress(props.t, 0.4, 1.0)
  return { transform: `rotate(${Math.sin(p * Math.PI * 4) * 12 * (1 - p)}deg)` }
})
const stripe = computed(() => `${(props.t * 60) % 56}px`)
const textStyle = computed(() => {
  const p = easeOutCubic(progress(props.t, 0.45, 0.9))
  return { opacity: p, transform: `translateX(${lerp(-20, 0, p)}px)` }
})
</script>

<template>
  <div ref="root" class="wa" :style="rootStyle">
    <div class="wa-board" :style="[boardStyle, { '--off': stripe }]">
      <div class="wa-inner">
        <svg class="wa-icon" viewBox="0 0 24 24" :style="iconStyle"><path d="M12 2.5 L23 21.5 H1 Z" /><path class="ex" d="M12 9 V14.5 M12 17.5 V18" /></svg>
        <div class="wa-texts" :style="textStyle">
          <div class="wa-title">{{ data.title }}</div>
          <div v-if="data.text" class="wa-text">{{ data.text }}</div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.wa { position: relative; display: inline-block; padding: 20px; font-family: var(--font-cn); }
.wa-board {
  padding: 18px; border-radius: 28px;
  background: repeating-linear-gradient(-45deg, #FFC400 0 28px, #1a1a1a 28px 56px);
  background-position: var(--off) 0;
  box-shadow: 0 30px 60px rgba(0, 0, 0, 0.45), 0 0 40px rgba(255, 196, 0, 0.35);
}
.wa-inner { display: flex; align-items: center; gap: 40px; padding: 40px 60px; border-radius: 16px; background: #141414; color: #fff; }
.wa-icon { width: 170px; height: 170px; flex: none; transform-origin: center 85%; }
.wa-icon path { fill: #FFC400; stroke: #FFC400; stroke-width: 1.2; stroke-linejoin: round; }
.wa-icon path.ex { fill: none; stroke: #141414; stroke-width: 2.4; stroke-linecap: round; }
.wa-title { font-size: 104px; font-weight: 900; color: #FFC400; line-height: 1.1; white-space: nowrap; }
.wa-text { margin-top: 10px; font-size: 50px; font-weight: 600; white-space: nowrap; }
</style>
