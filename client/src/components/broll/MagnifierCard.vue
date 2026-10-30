<script setup lang="ts">
import { computed, toRef } from 'vue'
import { easeInOutCubic, easeOutBack, easeOutCubic, lerp, progress } from './timeline'
import { useCardBase } from './cardBase'
import { useImageAspect, pointsOf } from './imageSize'

// 「局部放大镜」卡：截图先落位，目标处亮起一个小圈，本体压暗；一个圆形放大镜从目标处弹到旁边空白区，
// 镜子里是目标那一块放大 zoom 倍，一根连线指回出处 —— 一次回答「在哪」和「是什么」。
// 目标位置在编辑面板里点截图定（data.point[0]，占图宽高的百分比），不让人手填坐标。截图必须上传（导出在服务器上渲染）。

export interface MagnifierData { img: string; point: { x: number; y: number }[]; zoom: string; text: string; side: 'right' | 'left'; accent: string; panel: boolean; duration: number }
const props = defineProps<{ data: MagnifierData; t: number }>()
const emit = defineEmits<{ size: [{ w: number; h: number }] }>()
const { root, rootStyle } = useCardBase(props, emit)
const { el: imgEl, aspect, onLoad } = useImageAspect(toRef(() => props.data.img))

// 截图放进 BOX_W × BOX_H 里（等比，不裁）
const BOX_W = 1000
const BOX_H = 640
const LENS = 400
const GAP = 90
const size = computed(() => {
  const a = aspect.value || BOX_W / BOX_H
  return a >= BOX_W / BOX_H ? { w: BOX_W, h: BOX_W / a } : { w: BOX_H * a, h: BOX_H }
})
const pt = computed(() => pointsOf(props.data.point)[0] || { x: 50, y: 50 })
const zoom = computed(() => Math.max(1.5, Math.min(5, Number(props.data.zoom) || 3)))
const left = computed(() => props.data.side === 'left')
// 目标在图里的像素位置
const tx = computed(() => (pt.value.x / 100) * size.value.w)
const ty = computed(() => (pt.value.y / 100) * size.value.h)
// 卡片坐标：放大镜那一栏在图的左边还是右边
const imgX = computed(() => (left.value ? LENS + GAP : 0))
const lensCx = computed(() => (left.value ? LENS / 2 : size.value.w + GAP + LENS / 2))
const H = computed(() => Math.max(size.value.h, LENS + 80))
const imgY = computed(() => (H.value - size.value.h) / 2)
const lensCy = computed(() => Math.max(LENS / 2, Math.min(H.value - LENS / 2 - 70, imgY.value + ty.value)))

const RING_AT = 0.7
const LENS_AT = 1.0
const shotStyle = computed(() => {
  const p = easeOutCubic(progress(props.t, 0, 0.6))
  const dim = lerp(1, 0.55, easeOutCubic(progress(props.t, RING_AT, RING_AT + 0.4)))
  return { left: `${imgX.value}px`, top: `${imgY.value}px`, width: `${size.value.w}px`, height: `${size.value.h}px`, opacity: p, filter: `brightness(${dim})`, transform: `scale(${lerp(0.94, 1, p)})` }
})
const ringR = computed(() => LENS / 2 / zoom.value)
const ringStyle = computed(() => ({ opacity: easeOutCubic(progress(props.t, RING_AT, RING_AT + 0.3)) }))
// 放大镜：从目标处飞到旁边（位置 + 缩放一起走）
const lensP = computed(() => progress(props.t, LENS_AT, LENS_AT + 0.55))
const lensStyle = computed(() => {
  const p = easeInOutCubic(lensP.value)
  const fx = imgX.value + tx.value, fy = imgY.value + ty.value
  const x = lerp(fx, lensCx.value, p), y = lerp(fy, lensCy.value, p)
  return {
    left: `${x - LENS / 2}px`, top: `${y - LENS / 2}px`, width: `${LENS}px`, height: `${LENS}px`,
    opacity: lensP.value > 0 ? 1 : 0, transform: `scale(${lerp(2 * ringR.value / LENS, 1, easeOutBack(lensP.value))})`,
  }
})
const lensImgStyle = computed(() => ({
  width: `${size.value.w * zoom.value}px`, height: `${size.value.h * zoom.value}px`,
  left: `${LENS / 2 - tx.value * zoom.value}px`, top: `${LENS / 2 - ty.value * zoom.value}px`,
}))
// 连线：从目标小圈的边到放大镜的边，放大镜到位之后画
const linkP = computed(() => easeOutCubic(progress(props.t, LENS_AT + 0.45, LENS_AT + 0.8)))
const link = computed(() => {
  const ax = imgX.value + tx.value, ay = imgY.value + ty.value
  const bx = lensCx.value, by = lensCy.value
  const d = Math.hypot(bx - ax, by - ay) || 1
  const ux = (bx - ax) / d, uy = (by - ay) / d
  const s = { x: ax + ux * ringR.value, y: ay + uy * ringR.value }
  const e = { x: bx - ux * (LENS / 2), y: by - uy * (LENS / 2) }
  return { x1: s.x, y1: s.y, x2: lerp(s.x, e.x, linkP.value), y2: lerp(s.y, e.y, linkP.value) }
})
const textStyle = computed(() => {
  const p = easeOutCubic(progress(props.t, LENS_AT + 0.6, LENS_AT + 1.0))
  return { left: `${lensCx.value}px`, top: `${lensCy.value + LENS / 2 + 18}px`, opacity: p, transform: `translate(-50%, ${lerp(12, 0, p)}px)` }
})
</script>

<template>
  <div ref="root" class="mg" :style="[rootStyle, { width: `${size.w + GAP + LENS}px`, height: `${H}px` }]">
    <div class="mg-shot" :class="{ empty: !data.img }" :style="shotStyle">
      <img v-if="data.img" ref="imgEl" :src="data.img" alt="" @load="onLoad" />
      <span v-else>待上传截图</span>
    </div>
    <svg class="mg-svg" :width="size.w + GAP + LENS" :height="H" overflow="visible">
      <circle class="mg-ring" :cx="imgX + tx" :cy="imgY + ty" :r="ringR" :style="ringStyle" />
      <line v-if="linkP > 0" class="mg-link" :x1="link.x1" :y1="link.y1" :x2="link.x2" :y2="link.y2" />
    </svg>
    <div class="mg-lens" :style="lensStyle">
      <img v-if="data.img" :src="data.img" alt="" class="mg-lens-img" :style="lensImgStyle" />
    </div>
    <div v-if="data.text" class="mg-text" :style="textStyle">{{ data.text }}</div>
  </div>
</template>

<style scoped>
.mg { position: relative; color: var(--fg); font-family: var(--font-cn); }
.mg-shot { position: absolute; border-radius: 18px; overflow: hidden; background: var(--tile); box-shadow: 0 40px 90px -20px var(--shadow-c), inset 0 0 0 1.5px var(--track); }
.mg-shot img { display: block; width: 100%; height: 100%; }
.mg-shot.empty { display: grid; place-items: center; background: transparent; border: 4px dashed color-mix(in srgb, var(--accent) 70%, transparent); box-sizing: border-box; }
.mg-shot.empty span { font-size: 40px; color: var(--accent); }
.mg-svg { position: absolute; left: 0; top: 0; pointer-events: none; }
.mg-ring { fill: none; stroke: var(--accent); stroke-width: 6; filter: drop-shadow(0 0 10px var(--accent)); }
.mg-link { stroke: var(--accent); stroke-width: 5; stroke-linecap: round; }
.mg-lens {
  position: absolute; border-radius: 50%; overflow: hidden; background: var(--tile);
  box-shadow: 0 30px 70px -10px var(--shadow-c), 0 0 50px color-mix(in srgb, var(--accent) var(--glow-a), transparent);
}
.mg-lens-img { position: absolute; max-width: none; }
/* 镜框画在最上面一层（用 border 的话里面的图整体偏 8px，镜子中心对不上目标） */
.mg-lens::after { content: ''; position: absolute; inset: 0; border-radius: 50%; box-shadow: inset 0 0 0 8px var(--accent); }
.mg-text {
  position: absolute; padding: 12px 28px; border-radius: 14px; white-space: nowrap;
  background: var(--panel); font-size: 48px; font-weight: 800; box-shadow: 0 20px 40px -14px var(--shadow-c);
}
</style>
