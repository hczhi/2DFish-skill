<script setup lang="ts">
import { computed } from 'vue'
import { easeInOutCubic, easeOutCubic, lerp, progress } from './timeline'
import { useCardBase } from './cardBase'

// 「标题降格成标签」卡：小节标题先在画面正中对焦显影、站稳，然后一次补间缩到 0.4 倍飞进角落，变成小节标签常驻到卡片结束。
// 用在教程 / 方法论的「第 N 点」：讲这一点的整段时间里，角落一直挂着「02 · 先定选题」。
// 它铺满画布（data.scene，位置按 --cw / --ch 算），但除了那行字是透明的 —— 所以 data.seeThrough，不算「盖住下层的全屏画面」。

export interface TitleDemoteData {
  index: string
  label: string
  title: string
  corner: 'tl' | 'tr'
  accent: string
  duration: number
}

const props = defineProps<{ data: TitleDemoteData; t: number }>()
const emit = defineEmits<{ size: [{ w: number; h: number }] }>()
const { root, rootStyle } = useCardBase(props, emit, { out: 0.4, exit: 'none' })

const DEMOTE_AT = 1.3
const DEMOTE = 0.66
const MARGIN = 64
// 正中（偏上一点，给字幕区让位）→ 角落
const p = computed(() => easeInOutCubic(progress(props.t, DEMOTE_AT, DEMOTE_AT + DEMOTE)))
const right = computed(() => props.data.corner === 'tr')
const boxStyle = computed(() => {
  const k = p.value
  const ax = right.value ? lerp(0.5, 1, k) : lerp(0.5, 0, k)
  const mx = right.value ? -MARGIN * k : MARGIN * k
  const tx = right.value ? lerp(-50, -100, k) : lerp(-50, 0, k)
  return {
    left: `calc(var(--cw) * ${ax} + ${mx}px)`,
    top: `calc(var(--ch) * ${lerp(0.42, 0, k)} + ${MARGIN * 0.8 * k}px)`,
    // 原点在左上、先缩放再位移：位移按缩放后的尺寸生效，锚点（正中 / 左上角 / 右上角）才钉得住
    transform: `scale(${lerp(1, 0.4, k)}) translate(${tx}%, ${lerp(-50, 0, k)}%)`,
  }
})
// 显影：模糊 → 清楚
const showStyle = computed(() => {
  const s = easeOutCubic(progress(props.t, 0, 0.55))
  return { opacity: s, filter: `blur(${lerp(14, 0, s)}px)` }
})
// 降格之后底下垫一块实底（压在口播画面上也看得清），强调色竖条从上往下长出来
const chipStyle = computed(() => ({ opacity: p.value }))
const barStyle = computed(() => ({ transform: `scaleY(${easeOutCubic(progress(props.t, DEMOTE_AT + DEMOTE * 0.6, DEMOTE_AT + DEMOTE + 0.25))})` }))
const labelStyle = computed(() => ({ opacity: easeOutCubic(progress(props.t, 0.2, 0.6)) * (1 - p.value) }))
</script>

<template>
  <div ref="root" class="td" :style="rootStyle">
    <div class="td-box" :style="boxStyle">
      <div class="td-chip" :style="chipStyle" />
      <div class="td-bar" :style="barStyle" />
      <div class="td-inner" :style="showStyle">
        <div v-if="data.label" class="td-label" :style="labelStyle">{{ data.label }}</div>
        <div class="td-line">
          <span v-if="data.index" class="td-index bx-hot">{{ data.index }}</span>
          <span class="td-title">{{ data.title }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.td { position: relative; width: var(--cw); height: var(--ch); pointer-events: none; color: var(--fg); font-family: var(--font-cn); }
.td-box { position: absolute; padding: 28px 56px 32px; white-space: nowrap; transform-origin: 0 0; }
.td-chip { position: absolute; inset: 0; border-radius: 22px; background: var(--panel); box-shadow: 0 30px 70px -20px var(--shadow-c); }
.td-bar { position: absolute; left: 0; top: 18%; bottom: 18%; width: 14px; border-radius: 7px; background: var(--accent); transform-origin: top center; }
.td-inner { position: relative; }
.td-label {
  position: absolute; left: 0; right: 0; bottom: calc(100% + 4px);
  font-family: var(--font-mono); font-size: 40px; font-weight: 600; letter-spacing: 0.3em; text-transform: uppercase;
  color: var(--accent); text-align: center;
}
.td-line { display: flex; align-items: baseline; gap: 36px; }
.td-index { font-family: var(--font-mono); font-size: 128px; font-weight: 800; line-height: 1; }
.td-title { font-size: 128px; font-weight: 800; line-height: 1.15; }
</style>
