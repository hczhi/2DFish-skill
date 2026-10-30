<script setup lang="ts">
import { computed } from 'vue'
import { easeOutCubic, lerp, progress } from './timeline'
import { useCardBase } from './cardBase'
import { useSceneBox } from './sceneBase'

// 「竖屏素材装卡」：整屏场景。横屏视频里放一张竖图（抖音截图、手机录屏）：同一张图放大 + 模糊 + 压暗铺满当底床（缓慢推近），
// 竖卡落在一侧、带细边和投影，另一侧标题和来源逐行升入，竖卡落位后极缓推近。
// 竖卡固定 9:16、图按 cover 裁（不按图的比例算坐标，所以不用等图加载出比例）。竖屏画布时竖卡在上、字在下。

export interface PortraitData { img: string; title: string; source: string; side: 'right' | 'center'; accent: string; scene: boolean; duration: number }
const props = defineProps<{ data: PortraitData; t: number }>()
const emit = defineEmits<{ size: [{ w: number; h: number }] }>()
const { root, rootStyle } = useCardBase(props, emit, { exit: 'none' })
const { w, h } = useSceneBox(root)

const portraitCanvas = computed(() => h.value > w.value)
const T = computed(() => Math.max(2, props.data.duration))
const cardH = computed(() => (portraitCanvas.value ? h.value * 0.56 : h.value * 0.8))
const cardW = computed(() => (cardH.value * 9) / 16)
const center = computed(() => props.data.side === 'center' || portraitCanvas.value)
const bedStyle = computed(() => ({ transform: `scale(${lerp(1.25, 1.32, progress(props.t, 0, T.value))})`, opacity: easeOutCubic(progress(props.t, 0, 0.5)) }))
const cardStyle = computed(() => {
  const p = easeOutCubic(progress(props.t, 0.15, 0.8))
  const push = lerp(1, 1.03, progress(props.t, 0.8, T.value))
  const x = center.value ? (w.value - cardW.value) / 2 : w.value * 0.9 - cardW.value
  const y = portraitCanvas.value ? h.value * 0.08 : (h.value - cardH.value) / 2
  return { left: `${x}px`, top: `${y}px`, width: `${cardW.value}px`, height: `${cardH.value}px`, opacity: p, transform: `translateY(${lerp(60, 0, p)}px) scale(${push})` }
})
const textBox = computed(() => {
  if (portraitCanvas.value) return { left: `${w.value * 0.08}px`, right: `${w.value * 0.08}px`, top: `${h.value * 0.08 + cardH.value + 60}px`, alignItems: 'center', textAlign: 'center' as const }
  if (center.value) return { left: `${w.value * 0.06}px`, width: `${(w.value - cardW.value) / 2 - w.value * 0.1}px`, top: '50%', transform: 'translateY(-50%)' }
  return { left: `${w.value * 0.08}px`, width: `${w.value * 0.9 - cardW.value - w.value * 0.16}px`, top: '50%', transform: 'translateY(-50%)' }
})
const rise = (a: number) => {
  const p = easeOutCubic(progress(props.t, a, a + 0.5))
  return { opacity: p, transform: `translateY(${lerp(24, 0, p)}px)` }
}
const sources = computed(() => (props.data.source || '').split(/\n|\s{2,}/).filter((s) => s.trim()).slice(0, 2))
</script>

<template>
  <div ref="root" class="pt" :style="rootStyle">
    <div class="pt-bed-wrap"><img v-if="data.img" class="pt-bed" :src="data.img" alt="" :style="bedStyle" /></div>
    <div class="pt-card" :class="{ empty: !data.img }" :style="cardStyle">
      <img v-if="data.img" :src="data.img" alt="" />
      <span v-else>待上传竖图</span>
    </div>
    <div class="pt-text" :style="textBox">
      <div v-if="data.title" class="pt-title" :style="rise(0.5)">{{ data.title }}</div>
      <div v-for="(s, i) in sources" :key="i" class="pt-src" :style="rise(0.75 + i * 0.12)">{{ s }}</div>
    </div>
  </div>
</template>

<style scoped>
.pt { position: relative; width: var(--cw); height: var(--ch); overflow: hidden; pointer-events: none; font-family: var(--font-cn); color: var(--fg); background: var(--full-bg); }
.pt-bed-wrap { position: absolute; inset: 0; overflow: hidden; }
/* 底床压暗用 brightness，不叠写死的黑色蒙层 */
.pt-bed { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; filter: blur(26px) brightness(0.45) saturate(0.8); }
.pt-card { position: absolute; border-radius: 22px; overflow: hidden; background: var(--tile); box-shadow: 0 50px 100px -24px var(--shadow-c), 0 0 0 8px color-mix(in srgb, var(--fg) 85%, transparent); }
.pt-card img { display: block; width: 100%; height: 100%; object-fit: cover; }
.pt-card.empty { display: grid; place-items: center; background: transparent; border: 4px dashed color-mix(in srgb, var(--accent) 70%, transparent); box-shadow: none; }
.pt-card.empty span { font-size: 40px; color: var(--accent); }
.pt-text { position: absolute; display: flex; flex-direction: column; gap: 18px; }
.pt-title { font-size: 76px; font-weight: 900; line-height: 1.2; text-shadow: 0 4px 24px var(--shadow-c); }
.pt-src { font-size: 36px; font-weight: 600; opacity: 0.8; }
.pt-src:first-of-type { color: var(--accent); opacity: 1; }
</style>
