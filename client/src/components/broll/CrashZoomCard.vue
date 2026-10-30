<script setup lang="ts">
import { computed, toRef } from 'vue'
import { easeInCubic, easeOutCubic, lerp, progress } from './timeline'
import { useCardBase } from './cardBase'
import { useImageAspect, pointsOf } from './imageSize'
import { cueAt } from './cues'
import { CZ_AT, CZ_IN, CZ_SETTLE } from './crashTimes'

// 「截图急推」：截图全景先静置一拍让人看清整页，然后 0.2 秒急推到点选的目标（过冲 4.5% 再收回），急推那几帧带一记运动模糊，之后画面钉死。
// 「就是这句」那种一次性的重音。目标在编辑面板里点截图定（data.point[0]，占图宽高的百分比）；急推时刻可以对到字幕（cues[0]）。
// 视野中心夹在图里面：目标贴边时不推出图外露出空白。图没加载出来之前不按猜的比例画（同放大镜）。

export interface CrashZoomData { img: string; point: { x: number; y: number }[]; zoom: string; text: string; cues?: (number | null)[]; accent: string; panel: boolean; duration: number }
const props = defineProps<{ data: CrashZoomData; t: number }>()
const emit = defineEmits<{ size: [{ w: number; h: number }] }>()
const { root, rootStyle } = useCardBase(props, emit)
const { el: imgEl, aspect, onLoad } = useImageAspect(toRef(() => props.data.img))

const BOX_W = 1280, BOX_H = 760
const size = computed(() => {
  const a = aspect.value || BOX_W / BOX_H
  return a >= BOX_W / BOX_H ? { w: BOX_W, h: BOX_W / a } : { w: BOX_H * a, h: BOX_H }
})
const pt = computed(() => pointsOf(props.data.point)[0] || { x: 50, y: 50 })
const Z = computed(() => Math.max(1.5, Math.min(4, Number(props.data.zoom) || 2.3)))
const at = computed(() => cueAt(props.data.cues, 0, CZ_AT))
// 急推：0.2 秒 ease-in 冲到 Z × 1.045，再 CZ_SETTLE 秒收回 Z
const scale = computed(() => {
  const a = easeInCubic(progress(props.t, at.value, at.value + CZ_IN))
  const b = easeOutCubic(progress(props.t, at.value + CZ_IN, at.value + CZ_IN + CZ_SETTLE))
  return lerp(1, Z.value * 1.045, a) + (Z.value - Z.value * 1.045) * b
})
const camP = computed(() => easeInCubic(progress(props.t, at.value, at.value + CZ_IN)))
const imgStyle = computed(() => {
  const { w, h } = size.value, s = scale.value
  // 视野中心从图中心走向目标，夹在 [半个视野, 图宽 - 半个视野] 里
  const clampC = (v: number, len: number) => Math.min(len - len / (2 * s), Math.max(len / (2 * s), v))
  const vx = clampC(lerp(w / 2, (pt.value.x / 100) * w, camP.value), w)
  const vy = clampC(lerp(h / 2, (pt.value.y / 100) * h, camP.value), h)
  const blur = Math.sin(progress(props.t, at.value, at.value + CZ_IN + 0.06) * Math.PI) * 7
  return { width: `${w}px`, height: `${h}px`, transform: `translate(${w / 2 - vx * s}px, ${h / 2 - vy * s}px) scale(${s})`, filter: `blur(${blur}px)` }
})
const winStyle = computed(() => {
  const p = easeOutCubic(progress(props.t, 0, 0.5))
  return { width: `${size.value.w}px`, height: `${size.value.h}px`, opacity: p, transform: `scale(${lerp(0.95, 1, p)})` }
})
const textStyle = computed(() => {
  const a = at.value + CZ_IN + 0.15
  const p = easeOutCubic(progress(props.t, a, a + 0.35))
  return { opacity: p, transform: `translate(-50%, ${lerp(20, 0, p)}px)` }
})
</script>

<template>
  <div ref="root" class="cz" :style="rootStyle">
    <div class="cz-win" :class="{ empty: !data.img }" :style="winStyle">
      <img v-if="data.img" ref="imgEl" class="cz-img" :src="data.img" alt="" :style="imgStyle" @load="onLoad" />
      <span v-else>待上传截图</span>
      <div v-if="data.text" class="cz-text" :style="textStyle">{{ data.text }}</div>
    </div>
  </div>
</template>

<style scoped>
.cz { position: relative; color: var(--fg); font-family: var(--font-cn); }
.cz-win { position: relative; border-radius: 18px; overflow: hidden; background: var(--tile); box-shadow: 0 40px 90px -20px var(--shadow-c), inset 0 0 0 1.5px var(--track); }
.cz-win.empty { display: grid; place-items: center; background: transparent; border: 4px dashed color-mix(in srgb, var(--accent) 70%, transparent); box-sizing: border-box; }
.cz-win.empty span { font-size: 40px; color: var(--accent); }
.cz-img { position: absolute; left: 0; top: 0; display: block; max-width: none; transform-origin: 0 0; }
.cz-text {
  position: absolute; left: 50%; bottom: 36px; padding: 14px 32px; border-radius: 14px; white-space: nowrap;
  background: var(--accent); color: var(--ink-on-accent); font-size: 50px; font-weight: 800; box-shadow: 0 20px 40px -14px var(--shadow-c);
}
</style>
