<script setup lang="ts">
import { computed, toRef } from 'vue'
import { easeInOutCubic, easeOutCubic, lerp, progress } from './timeline'
import { useCardBase } from './cardBase'
import { useImageAspect, pointsOf } from './imageSize'
import { cueAt } from './cues'
import { NEWS_LINE_AT, NEWS_SECOND_AT } from './newsTimes'

// 「新闻卡上桌」卡：新闻截图包成白色圆角卡片歪着滑上桌，念到关键句时一道红色下划线扫过那一句；可选第二张压叠上来。
// 整张桌面全程极缓推近（Ken Burns）。下划线的起点、终点在编辑面板里点截图定（data.line 两个点）；
// 下划线什么时候扫、第二张什么时候上来可以单独定时（cues[0] / cues[1]）。截图必须上传（导出在服务器上渲染）。

export interface NewsDeskData { img: string; img2: string; line: { x: number; y: number }[]; source: string; cues?: (number | null)[]; accent: string; panel: boolean; duration: number }
const props = defineProps<{ data: NewsDeskData; t: number }>()
const emit = defineEmits<{ size: [{ w: number; h: number }] }>()
const { root, rootStyle } = useCardBase(props, emit)
const a1 = useImageAspect(toRef(() => props.data.img))
const a2 = useImageAspect(toRef(() => props.data.img2))

const DESK_W = 1320
const DESK_H = 800
const C1_W = 820
const C2_W = 640
const h1 = computed(() => Math.min(640, C1_W / (a1.aspect.value || 1.6)))
const h2 = computed(() => Math.min(520, C2_W / (a2.aspect.value || 1.6)))
const lineAt = computed(() => cueAt(props.data.cues, 0, NEWS_LINE_AT))
const secondAt = computed(() => cueAt(props.data.cues, 1, NEWS_SECOND_AT))

const desk = computed(() => ({ transform: `scale(${1 + Math.min(props.t, props.data.duration) * 0.008})` }))
const card1 = computed(() => {
  const p = easeOutCubic(progress(props.t, 0, 0.7))
  return { left: '120px', top: '70px', width: `${C1_W}px`, opacity: Math.min(1, p * 2), transform: `translate(${lerp(-260, 0, p)}px, ${lerp(220, 0, p)}px) rotate(${lerp(-12, -3.5, p)}deg)` }
})
const card2 = computed(() => {
  const p = easeOutCubic(progress(props.t, secondAt.value, secondAt.value + 0.6))
  return { left: `${DESK_W - C2_W - 60}px`, top: '230px', width: `${C2_W}px`, opacity: Math.min(1, p * 2), transform: `translate(${lerp(320, 0, p)}px, ${lerp(120, 0, p)}px) rotate(${lerp(14, 4, p)}deg)` }
})
// 下划线：两个点（占图宽高的百分比），不够两个点就不画
const pts = computed(() => pointsOf(props.data.line))
const lineP = computed(() => easeInOutCubic(progress(props.t, lineAt.value, lineAt.value + 0.55)))
const under = computed(() => {
  if (pts.value.length < 2) return null
  const [a, b] = pts.value
  const x1 = (a.x / 100) * C1_W, y1 = (a.y / 100) * h1.value, x2 = (b.x / 100) * C1_W, y2 = (b.y / 100) * h1.value
  return { x1, y1, x2: lerp(x1, x2, lineP.value), y2: lerp(y1, y2, lineP.value) }
})
const sourceStyle = computed(() => {
  const p = easeOutCubic(progress(props.t, 0.6, 1.0))
  return { opacity: p, transform: `translateY(${lerp(14, 0, p)}px)` }
})
</script>

<template>
  <div ref="root" class="nd" :style="[rootStyle, { width: `${DESK_W}px`, height: `${DESK_H}px` }]">
    <div class="nd-desk" :style="desk">
      <div class="nd-card" :style="card1">
        <div class="nd-shot" :class="{ empty: !data.img }" :style="{ height: `${h1}px` }">
          <img v-if="data.img" :ref="(el) => (a1.el.value = el as HTMLImageElement)" :src="data.img" alt="" @load="a1.onLoad" />
          <span v-else>待上传新闻截图</span>
          <svg v-if="under && lineP > 0" class="nd-svg" :width="C1_W" :height="h1" overflow="visible">
            <line class="nd-under" :x1="under.x1" :y1="under.y1" :x2="under.x2" :y2="under.y2" />
          </svg>
        </div>
      </div>
      <div v-if="data.img2" class="nd-card" :style="card2">
        <div class="nd-shot" :style="{ height: `${h2}px` }">
          <img :ref="(el) => (a2.el.value = el as HTMLImageElement)" :src="data.img2" alt="" @load="a2.onLoad" />
        </div>
      </div>
    </div>
    <div v-if="data.source" class="nd-source" :style="sourceStyle">{{ data.source }}</div>
  </div>
</template>

<style scoped>
.nd { position: relative; color: var(--fg); font-family: var(--font-cn); }
.nd-desk { position: absolute; inset: 0; transform-origin: 40% 50%; }
.nd-card {
  position: absolute; padding: 18px; border-radius: 22px; background: #fff; box-sizing: content-box;
  box-shadow: 0 40px 80px -20px var(--shadow-c), 0 2px 0 rgba(255, 255, 255, 0.6) inset;
}
.nd-shot { position: relative; border-radius: 10px; overflow: hidden; background: #f2f3f5; }
.nd-shot img { display: block; width: 100%; height: 100%; object-fit: cover; object-position: top; }
.nd-shot.empty { display: grid; place-items: center; border: 4px dashed color-mix(in srgb, var(--accent) 70%, transparent); box-sizing: border-box; background: transparent; }
.nd-shot.empty span { font-size: 38px; color: var(--accent); }
.nd-svg { position: absolute; left: 0; top: 0; }
/* 红线是语义色（划重点），不跟主题强调色走 */
.nd-under { stroke: #ff3b30; stroke-width: 9; stroke-linecap: round; opacity: 0.9; }
.nd-source {
  position: absolute; left: 140px; bottom: 10px; padding: 10px 26px; border-radius: 12px; white-space: nowrap;
  background: var(--panel); font-size: 40px; font-weight: 700; box-shadow: 0 16px 34px -12px var(--shadow-c);
}
</style>
