<script setup lang="ts">
import { computed, toRef } from 'vue'
import { easeInOutCubic, easeOutCubic, lerp, progress } from './timeline'
import { useCardBase } from './cardBase'
import { useImageAspect } from './imageSize'
import { SLIDER_KEYS } from './sliderTimes'

// 「前后滑动分屏」卡：两张同构图叠放（改造前 / 改造后、旧版 / 新版），一根分割线和裁切同一个进度：
// 先从右边滑到中线 → 停 → 轻推一下强调 → 滑到 8% 几乎全露「之后」→ 停 → 回到中线。分割线左边是「之前」，右边是「之后」。
// 两张图必须上传；尺寸按「之前」那张的比例画，「之后」那张按同样的框裁（两张构图不一样的话分割线两边对不上，check 提醒不了，挑图时注意）。

export interface SliderCompareData { before: string; after: string; beforeLabel: string; afterLabel: string; accent: string; panel: boolean; duration: number }
const props = defineProps<{ data: SliderCompareData; t: number }>()
const emit = defineEmits<{ size: [{ w: number; h: number }] }>()
const { root, rootStyle } = useCardBase(props, emit)
const b = useImageAspect(toRef(() => props.data.before))
const a = useImageAspect(toRef(() => props.data.after))

const FW = 1100
const FH = computed(() => Math.max(420, Math.min(700, FW / (b.aspect.value || 16 / 9))))
// 分割线位置（占宽度的百分比）：关键帧表在 sliderTimes.ts
const pos = computed(() => {
  const t = props.t
  let prev = SLIDER_KEYS[0]
  for (const k of SLIDER_KEYS) {
    if (t < k.t) return lerp(prev.x, k.x, easeInOutCubic(progress(t, prev.t, k.t)))
    prev = k
  }
  return prev.x
})
const frameStyle = computed(() => {
  const p = easeOutCubic(progress(props.t, 0, 0.5))
  return { width: `${FW}px`, height: `${FH.value}px`, opacity: p, transform: `scale(${lerp(0.95, 1, p)})` }
})
const beforeClip = computed(() => ({ clipPath: `inset(0 ${100 - pos.value}% 0 0)` }))
const handleOn = computed(() => (props.t >= SLIDER_KEYS[0].t ? 1 : 0))
// 标签：哪一边露得多哪一边的标签亮
const labelA = computed(() => ({ opacity: easeOutCubic(progress(props.t, 0.3, 0.7)) * (pos.value > 18 ? 1 : 0.25) }))
const labelB = computed(() => ({ opacity: easeOutCubic(progress(props.t, 0.6, 1.0)) * (pos.value < 82 ? 1 : 0.25) }))
</script>

<template>
  <div ref="root" class="sl" :style="rootStyle">
    <div class="sl-frame" :class="{ empty: !data.before || !data.after }" :style="frameStyle">
      <template v-if="data.before && data.after">
        <img :ref="(el) => (a.el.value = el as HTMLImageElement)" class="sl-img" :src="data.after" alt="" @load="a.onLoad" />
        <img :ref="(el) => (b.el.value = el as HTMLImageElement)" class="sl-img" :src="data.before" alt="" :style="beforeClip" @load="b.onLoad" />
        <div class="sl-line" :style="{ left: `${pos}%`, opacity: handleOn }">
          <i class="sl-knob"><b>‹</b><b>›</b></i>
        </div>
        <span class="sl-tag l" :style="labelA">{{ data.beforeLabel || '之前' }}</span>
        <span class="sl-tag r" :style="labelB">{{ data.afterLabel || '之后' }}</span>
      </template>
      <span v-else class="sl-empty">{{ !data.before && !data.after ? '待上传两张图' : !data.before ? '待上传「之前」' : '待上传「之后」' }}</span>
    </div>
  </div>
</template>

<style scoped>
.sl { position: relative; display: inline-block; padding: 30px; font-family: var(--font-cn); color: var(--fg); }
.sl-frame { position: relative; overflow: hidden; border-radius: 22px; background: var(--tile); box-shadow: 0 40px 90px -20px var(--shadow-c), inset 0 0 0 1.5px var(--track); }
.sl-frame.empty { display: grid; place-items: center; background: transparent; border: 4px dashed color-mix(in srgb, var(--accent) 70%, transparent); box-sizing: border-box; }
.sl-empty { font-size: 40px; color: var(--accent); }
.sl-img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.sl-line { position: absolute; top: 0; bottom: 0; width: 6px; margin-left: -3px; background: #fff; box-shadow: 0 0 16px rgba(255, 255, 255, 0.6); }
.sl-knob {
  position: absolute; left: 50%; top: 50%; width: 84px; height: 84px; margin: -42px 0 0 -42px; border-radius: 50%;
  background: var(--accent); color: var(--ink-on-accent); display: flex; align-items: center; justify-content: center; gap: 10px;
  font-style: normal; font-size: 40px; font-weight: 900; box-shadow: 0 10px 30px var(--shadow-c);
}
.sl-tag {
  position: absolute; top: 24px; padding: 10px 26px; border-radius: 12px; font-size: 40px; font-weight: 800; white-space: nowrap;
  background: var(--panel); box-shadow: 0 10px 24px -8px var(--shadow-c);
}
.sl-tag.l { left: 24px; }
.sl-tag.r { right: 24px; color: var(--accent); }
</style>
