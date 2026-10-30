<script setup lang="ts">
import { computed } from 'vue'
import { easeInOutCubic, easeOutCubic, lerp, progress } from './timeline'
import { useCardBase } from './cardBase'
import { cueAt } from './cues'
import { RF_AT, RF_DUR } from './rackTimes'

// 「两图对焦切换」：两张图前后错开叠放、永远一清一糊 —— 先对焦前面那张，讲到第二张时焦点转过去（前张变糊变暗缩一点，后张反过来）。
// 像镜头在两张素材之间对焦。转焦时刻默认 1.8 秒，可以按字幕对齐（找的是第二张的说明）。两张都按 cover 裁进 16:10 的框，不等图的比例。

export interface RackFocusData { img: string; img2: string; cap: string; cap2: string; cues?: (number | null)[]; accent: string; panel: boolean; duration: number }
const props = defineProps<{ data: RackFocusData; t: number }>()
const emit = defineEmits<{ size: [{ w: number; h: number }] }>()
const { root, rootStyle } = useCardBase(props, emit)

const CW = 820, CH = 512
const at = computed(() => cueAt(props.data.cues, 0, RF_AT))
const f = computed(() => easeInOutCubic(progress(props.t, at.value, at.value + RF_DUR)))
const look = (sharp: number) => ({ filter: `blur(${lerp(8, 0, sharp)}px) brightness(${lerp(0.6, 1, sharp)})`, scale: lerp(0.97, 1.02, sharp) })
const cardStyle = (k: 0 | 1) => {
  const p = easeOutCubic(progress(props.t, 0.1 + k * 0.15, 0.7 + k * 0.15))
  const lk = look(k ? f.value : 1 - f.value)
  return {
    // 清楚的那张始终压在上面（转焦过半时换上下）：不换的话焦点转到第 2 张之后，糊掉的第 1 张还挡着它的一大块
    left: k ? `${CW * 0.42}px` : '0px', top: k ? '0px' : `${CH * 0.34}px`, width: `${CW}px`, height: `${CH}px`, zIndex: (k ? f.value >= 0.5 : f.value < 0.5) ? 2 : 1,
    opacity: p, filter: lk.filter, transform: `translateY(${lerp(40, 0, p)}px) scale(${lk.scale})`,
  }
}
</script>

<template>
  <div ref="root" class="rf" :style="[rootStyle, { width: `${CW * 1.42}px`, height: `${CH * 1.34 + 90}px` }]">
    <div v-for="k in ([1, 0] as const)" :key="k" class="rf-card" :class="{ empty: !(k ? data.img2 : data.img) }" :style="cardStyle(k)">
      <img v-if="k ? data.img2 : data.img" :src="k ? data.img2 : data.img" alt="" />
      <span v-else>待上传第 {{ k + 1 }} 张</span>
      <div v-if="k ? data.cap2 : data.cap" class="rf-cap">{{ k ? data.cap2 : data.cap }}</div>
    </div>
  </div>
</template>

<style scoped>
.rf { position: relative; color: var(--fg); font-family: var(--font-cn); }
.rf-card { position: absolute; border-radius: 20px; overflow: hidden; background: var(--tile); transform-origin: center; box-shadow: 0 40px 90px -20px var(--shadow-c), 0 0 0 6px color-mix(in srgb, var(--fg) 85%, transparent); }
.rf-card img { display: block; width: 100%; height: 100%; object-fit: cover; }
.rf-card.empty { display: grid; place-items: center; background: var(--tile); border: 4px dashed color-mix(in srgb, var(--accent) 70%, transparent); box-sizing: border-box; box-shadow: none; }
.rf-card.empty span { font-size: 40px; color: var(--accent); }
.rf-cap { position: absolute; left: 24px; bottom: 22px; padding: 10px 22px; border-radius: 12px; background: var(--accent); color: var(--ink-on-accent); font-size: 40px; font-weight: 800; white-space: nowrap; }
</style>
