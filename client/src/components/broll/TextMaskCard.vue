<script setup lang="ts">
import { computed } from 'vue'
import { easeInCubic, easeOutCubic, lerp, progress } from './timeline'
import { useCardBase } from './cardBase'
import { useSceneBox } from './sceneBase'

// 「字里透图」：整屏场景。超粗的几个大字里透出一张图（图在字里缓慢平移），结尾字猛地冲大、同一张图淡入铺满全屏接管画面 ——
// 字是门、图在门里。适合当章节卡：「第二部分 · 案例」字里透出案例截图。
// 图在字里是 background-clip: text 画的，那条 background-image 导出渲染页等不到它加载完 —— 所以同一张图另挂一个 <img>（铺满层用的就是它），
// 渲染页靠 querySelectorAll('img') 等它；只用背景图的话导出第一帧字里是空的，而预览一切正常。

export interface TextMaskData { img: string; text: string; bg: 'clear' | 'full'; accent: string; scene: boolean; duration: number }
const props = defineProps<{ data: TextMaskData; t: number }>()
const emit = defineEmits<{ size: [{ w: number; h: number }] }>()
const { root, rootStyle } = useCardBase(props, emit, { exit: 'none' })
const { w, h } = useSceneBox(root)

const T = computed(() => Math.max(2.5, props.data.duration))
// 冲大在结尾前 1.6 秒开始
const zoomAt = computed(() => T.value - 1.6)
const fontSize = computed(() => Math.round(Math.min((w.value * 0.86) / Math.max(1, [...(props.data.text || '')].length), h.value * 0.62)))
const pan = computed(() => progress(props.t, 0, T.value))
const textStyle = computed(() => {
  const i = easeOutCubic(progress(props.t, 0.1, 0.8))
  const z = easeInCubic(progress(props.t, zoomAt.value, zoomAt.value + 0.9))
  return {
    fontSize: `${fontSize.value}px`,
    backgroundImage: props.data.img ? `url("${props.data.img}")` : 'none',
    backgroundPosition: `${lerp(30, 70, pan.value)}% 50%`,
    opacity: i * (1 - progress(props.t, zoomAt.value + 0.6, zoomAt.value + 0.9)),
    transform: `scale(${lerp(1.08, 1, i) * Math.pow(18, z)})`,
  }
})
const fillStyle = computed(() => {
  const p = easeOutCubic(progress(props.t, zoomAt.value + 0.3, zoomAt.value + 0.8))
  return { opacity: props.data.img ? p : 0, transform: `scale(${lerp(1.15, 1, p)})`, objectPosition: `${lerp(30, 70, pan.value)}% 50%` }
})
</script>

<template>
  <div ref="root" class="tm" :class="{ full: data.bg === 'full' }" :style="rootStyle">
    <div class="tm-center"><div class="tm-text" :class="{ empty: !data.img }" :style="textStyle">{{ data.text }}</div></div>
    <img v-if="data.img" class="tm-fill" :src="data.img" alt="" :style="fillStyle" />
  </div>
</template>

<style scoped>
.tm { position: relative; width: var(--cw); height: var(--ch); overflow: hidden; pointer-events: none; font-family: var(--font-cn); }
.tm.full { background: var(--full-bg); }
.tm-center { position: absolute; inset: 0; display: grid; place-items: center; }
.tm-text {
  font-weight: 900; line-height: 1; white-space: nowrap; letter-spacing: -0.02em;
  background-size: cover; -webkit-background-clip: text; background-clip: text; color: transparent;
  -webkit-text-stroke: 3px var(--accent); filter: drop-shadow(0 10px 40px var(--shadow-c));
}
/* 没上传图时字是空心描边 + 由 check 报「还没上传图片」，不画成看不见的透明字 */
.tm-text.empty { -webkit-text-stroke: 4px var(--accent); }
.tm-fill { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
</style>
