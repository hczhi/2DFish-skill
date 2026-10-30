<script setup lang="ts">
import { computed } from 'vue'
import { depthIn, easeInCubic, easeOutCubic, focusIn, lerp, progress, pulse, stagger } from './timeline'
import { useCardSize } from './cardSize'
import CardShell from './CardShell.vue'
import { useThemeMotion } from './themeContext'

// 「章节标题」卡：大编号 02 + 英文小标签 + 标题（其中一段高亮）。标题允许 AI 概括。
// 高亮词必须是标题里的一段 —— 不是的话这里不高亮，编辑面板会提示（不悄悄忽略）。

export interface ChapterTitleData {
  index: string
  label: string
  title: string
  highlight: string
  accent: string
  panel: boolean
  duration: number
}

const props = defineProps<{ data: ChapterTitleData; t: number }>()
const emit = defineEmits<{ size: [{ w: number; h: number }] }>()
const root = useCardSize(emit)

const OUT = 0.5
const outP = computed(() => easeInCubic(progress(props.t, props.data.duration - OUT, props.data.duration)))
const rootStyle = computed(() => ({
  opacity: 1 - outP.value,
  filter: `blur(${outP.value * 8}px)`,
  transform: `translateX(${-40 * outP.value}px)`,
  ...(props.data.accent ? { '--accent': props.data.accent } : {}),
}))

// 标题拆成 高亮前 / 高亮 / 高亮后 三段，每段里的字逐个出现（i 是全局序号，决定出场先后）
const segs = computed(() => {
  const { title, highlight } = props.data
  const at = highlight ? title.indexOf(highlight) : -1
  const parts = at < 0 ? [{ text: title, hi: false }] : [
    { text: title.slice(0, at), hi: false },
    { text: highlight, hi: true },
    { text: title.slice(at + highlight.length), hi: false },
  ]
  let n = 0
  return parts.filter((p) => p.text).map((p) => ({ hi: p.hi, chars: [...p.text].map((ch) => ({ ch, i: n++ })) }))
})
const charCount = computed(() => segs.value.reduce((n, s) => n + s.chars.length, 0))
const { depth, enter } = useThemeMotion()
const charStyle = (i: number) => {
  if (depth.value) return depthIn(props.t, 0.45 + i * 0.05, 0.5)
  const p = easeOutCubic(stagger(props.t, 0.45, 0.05, i, 0.35))
  return { opacity: p, transform: `translateY(${lerp(36, 0, p)}px)` }
}
const indexStyle = computed(() => {
  const p = easeOutCubic(progress(props.t, 0, 0.5))
  return { opacity: p, transform: `translateY(${lerp(60, 0, p)}px)` }
})
const barStyle = computed(() => ({ transform: `scaleY(${easeOutCubic(progress(props.t, 0.1, 0.6))})` }))
const labelStyle = computed(() => {
  const p = easeOutCubic(progress(props.t, 0.25, 0.75))
  return { opacity: p, clipPath: `inset(0 ${100 - p * 100}% 0 0)` }
})
// 标题打完后，高亮段下面扫一条线
const hiLineAt = computed(() => 0.45 + charCount.value * 0.05 + 0.2)
const hiLine = computed(() => easeOutCubic(progress(props.t, hiLineAt.value, hiLineAt.value + 0.45)))
const underStyle = computed(() => ({ transform: `scaleX(${easeOutCubic(progress(props.t, 0.5, 1.3))})` }))
</script>

<template>
  <div ref="root" class="ct" :style="rootStyle">
    <CardShell v-if="data.panel" :t="t" :duration="data.duration" />
    <div v-if="data.index" class="ct-index bx-hot" :style="indexStyle">{{ data.index }}</div>
    <div class="ct-bar bx-glow-box" :style="barStyle" />
    <div class="ct-body">
      <div v-if="data.label" class="ct-label" :style="labelStyle"><i class="bx-dot" :style="{ '--pulse': pulse(t) }" />{{ data.label }}</div>
      <div class="ct-title">
        <span v-for="(sg, k) in segs" :key="k" class="ct-seg" :class="{ hi: sg.hi }">
          <span v-for="c in sg.chars" :key="c.i" :class="['ct-ch', { 'bx-hot': sg.hi }]" :style="charStyle(c.i)">{{ c.ch }}</span>
          <i v-if="sg.hi" class="ct-hiline" :style="{ transform: `scaleX(${hiLine})` }" />
        </span>
      </div>
      <div class="ct-under" :style="underStyle" />
    </div>
  </div>
</template>

<style scoped>
.ct {
  position: relative; display: inline-flex; align-items: center; gap: 36px; padding: 48px 72px 48px 56px; box-sizing: border-box;
  color: var(--fg); font-family: var(--font-cn);
}
.ct-panel { position: absolute; inset: 0; border-radius: 8px; background: var(--panel); border: 2px solid var(--line); }
.ct-index {
  position: relative; font-family: var(--font-mono); font-size: 180px; line-height: 1; font-weight: 800; font-style: italic;
  color: var(--accent); letter-spacing: -6px;
}
.ct-bar { position: relative; align-self: stretch; width: 6px; background: var(--accent); transform-origin: top center; }
.ct-body { position: relative; }
.ct-label {
  display: flex; align-items: center; gap: 18px; margin-bottom: 18px; white-space: nowrap;
  font-family: var(--font-mono); font-size: 38px; font-weight: 600; letter-spacing: 0.3em; text-transform: uppercase; color: var(--accent);
}
.ct-label b { display: inline-block; width: 48px; height: 4px; background: var(--accent); }
.ct-title { position: relative; font-size: 104px; font-weight: 700; line-height: 1.15; white-space: nowrap; }
.ct-ch { display: inline-block; white-space: pre; }
.ct-seg { position: relative; }
.ct-seg.hi { color: var(--accent); }
.ct-hiline { position: absolute; left: 0; right: 0; bottom: -4px; height: 8px; background: var(--accent); opacity: 0.35; transform-origin: left center; }
.ct-under { height: 3px; margin-top: 22px; background: linear-gradient(90deg, var(--line), transparent); transform-origin: left center; }
</style>
