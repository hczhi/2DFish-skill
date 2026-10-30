<script setup lang="ts">
import { computed, toRef } from 'vue'
import { easeInOutCubic, easeOutCubic, lerp, progress } from './timeline'
import { useCardBase } from './cardBase'
import { useImageAspect, pointsOf } from './imageSize'
import { cueAt } from './cues'
import { stAt, ST_HOLD } from './scrollTimes'

// 「长截图慢滚」卡：一张长截图在窗口里往上滚，讲到关键处减速停住、那一行被荧光笔扫一道，停一会儿再接着滚 —— 滚速就是讲述节奏。
// 停靠处在编辑面板里点截图定（data.stops，占图高的百分比）；每一处什么时候停可以单独定时（cues[i]，按字幕对齐 / 播放头）。
// 没标停靠处的话从头到尾匀速滚一遍。截图必须上传（导出在服务器上渲染）。

export interface ScrollTourData { img: string; stops: { x: number; y: number }[]; cues?: (number | null)[]; accent: string; panel: boolean; duration: number }
const props = defineProps<{ data: ScrollTourData; t: number }>()
const emit = defineEmits<{ size: [{ w: number; h: number }] }>()
const { root, rootStyle } = useCardBase(props, emit)
const { el: imgEl, aspect, onLoad } = useImageAspect(toRef(() => props.data.img))

const VW = 960
const VH = 640
const imgH = computed(() => (aspect.value ? VW / aspect.value : VH))
const maxOff = computed(() => Math.max(0, imgH.value - VH))
// 停靠处按从上到下排好（往回滚读起来很怪）
const stops = computed(() => pointsOf(props.data.stops).sort((a, b) => a.y - b.y))
const offFor = (y: number) => Math.max(0, Math.min(maxOff.value, (y / 100) * imgH.value - VH / 2))
const arrive = (i: number) => cueAt(props.data.cues, i, stAt(i))

// 关键帧：0.6 秒时在顶部，第 i 处在 arrive(i) 到位、停 ST_HOLD 秒；两处之间缓入缓出地滚过去
const offset = computed(() => {
  const t = props.t
  if (!stops.value.length) {
    // 没有停靠处：匀速滚完（留 0.6 秒入场、1 秒停在底部）
    return maxOff.value * progress(t, 0.6, Math.max(1.2, props.data.duration - 1))
  }
  let prevT = 0.6, prevOff = 0
  for (let i = 0; i < stops.value.length; i++) {
    const a = arrive(i), o = offFor(stops.value[i].y)
    if (t < a) return lerp(prevOff, o, easeInOutCubic(progress(t, prevT, a)))
    if (t < a + ST_HOLD) return o
    prevT = a + ST_HOLD
    prevOff = o
  }
  return prevOff
})
// 停在第几处（荧光笔扫哪一行）
const holding = computed(() => stops.value.findIndex((_, i) => props.t >= arrive(i) && props.t < arrive(i) + ST_HOLD + 0.3))
const markStyle = computed(() => {
  const i = holding.value
  if (i < 0) return { opacity: 0 }
  const p = easeOutCubic(progress(props.t, arrive(i) + 0.05, arrive(i) + 0.45))
  const fade = 1 - progress(props.t, arrive(i) + ST_HOLD, arrive(i) + ST_HOLD + 0.3)
  return { top: `${(stops.value[i].y / 100) * imgH.value - 34}px`, transform: `scaleX(${p})`, opacity: fade }
})
const winStyle = computed(() => {
  const p = easeOutCubic(progress(props.t, 0, 0.6))
  return { opacity: p, transform: `translateY(${lerp(40, 0, p)}px)` }
})
</script>

<template>
  <div ref="root" class="st" :style="rootStyle">
    <div class="st-win" :class="{ empty: !data.img }" :style="[winStyle, { width: `${VW}px`, height: `${VH}px` }]">
      <template v-if="data.img">
        <div class="st-page" :style="{ transform: `translateY(${-offset}px)` }">
          <img ref="imgEl" :src="data.img" alt="" :style="{ width: `${VW}px` }" @load="onLoad" />
          <i class="st-mark" :style="markStyle" />
        </div>
        <!-- 上下两道渐隐：读出「这一页还很长」 -->
        <i class="st-fade top" :style="{ opacity: offset > 4 ? 1 : 0 }" />
        <i class="st-fade bottom" :style="{ opacity: offset < maxOff - 4 ? 1 : 0 }" />
        <!-- 滚动条：在哪一段 -->
        <i v-if="maxOff > 0" class="st-bar" :style="{ height: `${(VH / imgH) * 100}%`, top: `${(offset / imgH) * 100}%` }" />
      </template>
      <span v-else>待上传长截图</span>
    </div>
  </div>
</template>

<style scoped>
.st { position: relative; display: inline-block; padding: 30px; }
.st-win {
  position: relative; overflow: hidden; border-radius: 20px; background: var(--tile);
  box-shadow: 0 40px 90px -20px var(--shadow-c), inset 0 0 0 1.5px var(--track);
}
.st-win.empty { display: grid; place-items: center; background: transparent; border: 4px dashed color-mix(in srgb, var(--accent) 70%, transparent); box-sizing: border-box; }
.st-win.empty span { font-size: 40px; color: var(--accent); font-family: var(--font-cn); }
.st-page { position: absolute; left: 0; top: 0; }
.st-page img { display: block; }
.st-mark {
  position: absolute; left: 24px; right: 24px; height: 68px; border-radius: 10px; transform-origin: left center;
  background: color-mix(in srgb, var(--accent) 32%, transparent); box-shadow: inset 0 0 0 3px color-mix(in srgb, var(--accent) 70%, transparent);
}
.st-fade { position: absolute; left: 0; right: 0; height: 90px; pointer-events: none; }
.st-fade.top { top: 0; background: linear-gradient(var(--tile), transparent); }
.st-fade.bottom { bottom: 0; background: linear-gradient(transparent, var(--tile)); }
.st-bar { position: absolute; right: 8px; width: 8px; border-radius: 4px; background: var(--accent); opacity: 0.7; }
</style>
