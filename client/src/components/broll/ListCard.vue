<script setup lang="ts">
import { computed } from 'vue'
import { easeInCubic, easeOutCubic, focusIn, lerp, progress, pulse, stagger } from './timeline'
import { useCardSize } from './cardSize'
import CardShell from './CardShell.vue'
import { useThemeMotion } from './themeContext'
import { cueAt } from './cues'

// 「要点清单」卡：英文小标签 + 标题 + 2–5 条（编号 01/02… 逐条滑入，文字下划线扫过）+ 可选一行 ✓ 结论。
// 条目摘原话；标题允许 AI 概括。条目多了要的时间长（见 templates.ts 的 minDuration）。
// 每一条 / 结论可以单独定出现时间（data.cues，见 cues.ts）：cues[0..n-1] 是条目，cues[n] 是结论。

export interface ListData {
  label: string
  title: string
  items: string[]
  conclusion: string
  cues?: (number | null)[]
  accent: string
  panel: boolean
  duration: number
}

const props = defineProps<{ data: ListData; t: number }>()
const emit = defineEmits<{ size: [{ w: number; h: number }] }>()
const root = useCardSize(emit)

const ITEM_START = 0.55
const ITEM_STEP = 0.35

const OUT = 0.5
const outP = computed(() => easeInCubic(progress(props.t, props.data.duration - OUT, props.data.duration)))
const rootStyle = computed(() => ({
  opacity: 1 - outP.value,
  filter: `blur(${outP.value * 8}px)`,
  transform: `translateX(${-40 * outP.value}px)`,
  ...(props.data.accent ? { '--accent': props.data.accent } : {}),
}))

const items = computed(() => props.data.items.filter((s) => s.trim()))
// 第 i 条什么时候出现：设了 cue 用 cue，没设按默认节奏
const itemAt = (i: number) => cueAt(props.data.cues, i, ITEM_START + i * ITEM_STEP)
const itemStyle = (i: number) => {
  const p = easeOutCubic(progress(props.t, itemAt(i), itemAt(i) + 0.4))
  return { opacity: p, transform: `translateX(${lerp(-50, 0, p)}px)` }
}
const underStyle = (i: number) => ({ transform: `scaleX(${easeOutCubic(progress(props.t, itemAt(i) + 0.2, itemAt(i) + 0.65))})` })
const conclusionAt = computed(() => cueAt(props.data.cues, items.value.length, ITEM_START + items.value.length * ITEM_STEP + 0.2))
const conclusionStyle = computed(() => {
  const p = easeOutCubic(progress(props.t, conclusionAt.value, conclusionAt.value + 0.4))
  return { opacity: p, transform: `translateY(${lerp(20, 0, p)}px)` }
})
const checkStyle = computed(() => ({ strokeDashoffset: 30 * (1 - easeOutCubic(progress(props.t, conclusionAt.value + 0.15, conclusionAt.value + 0.55))) }))
const labelStyle = computed(() => {
  const p = easeOutCubic(progress(props.t, 0, 0.45))
  return { opacity: p, clipPath: `inset(0 ${100 - p * 100}% 0 0)` }
})
const { enter } = useThemeMotion()
const titleStyle = computed(() => enter(props.t, 0.1))
// 左边那条竖线跟着最后一条走到底
const railStyle = computed(() => ({ transform: `scaleY(${easeOutCubic(progress(props.t, 0.3, Math.max(0.6, itemAt(items.value.length - 1) + 0.3)))})` }))
const num = (i: number) => String(i + 1).padStart(2, '0')
</script>

<template>
  <div ref="root" class="ls" :style="rootStyle">
    <CardShell v-if="data.panel" :t="t" :duration="data.duration" />
    <div v-if="data.label" class="ls-label" :style="labelStyle"><i class="bx-dot" :style="{ '--pulse': pulse(t) }" />{{ data.label }}</div>
    <div v-if="data.title" class="ls-title" :style="titleStyle">{{ data.title }}</div>
    <div class="ls-items">
      <div class="ls-rail" :style="railStyle" />
      <div v-for="(it, i) in items" :key="i" class="ls-item" :style="itemStyle(i)">
        <span class="ls-dot" />
        <span class="ls-num bx-hot">{{ num(i) }}</span>
        <span class="ls-text">{{ it }}<i class="ls-under" :style="underStyle(i)" /></span>
      </div>
    </div>
    <div v-if="data.conclusion" class="ls-conc" :style="conclusionStyle">
      <svg viewBox="0 0 48 48" class="ls-check">
        <circle cx="24" cy="24" r="20" />
        <path d="M15 24.5l6 6 12-13" :style="checkStyle" />
      </svg>
      {{ data.conclusion }}
    </div>
  </div>
</template>

<style scoped>
.ls {
  position: relative; display: inline-block; padding: 44px 72px 44px 60px; box-sizing: border-box;
  color: var(--fg); font-family: var(--font-cn);
}
.ls-panel { position: absolute; inset: 0; border-radius: 8px; background: var(--panel); border: 2px solid var(--line); }
.ls-label {
  position: relative; display: flex; align-items: center; gap: 18px; margin-bottom: 16px; white-space: nowrap;
  font-family: var(--font-mono); font-size: 38px; font-weight: 600; letter-spacing: 0.3em; text-transform: uppercase; color: var(--accent);
}
.ls-label b { display: inline-block; width: 48px; height: 4px; background: var(--accent); }
.ls-title { position: relative; font-size: 80px; font-weight: 700; white-space: nowrap; margin-bottom: 30px; }
.ls-items { position: relative; padding-left: 8px; }
.ls-rail { position: absolute; left: 13px; top: 20px; bottom: 20px; width: 2px; background: var(--line); transform-origin: top center; }
.ls-item { position: relative; display: flex; align-items: baseline; gap: 22px; margin: 0 0 20px; white-space: nowrap; }
.ls-dot { position: relative; top: -10px; width: 12px; height: 12px; border-radius: 50%; background: var(--accent); flex: none; box-shadow: 0 0 14px var(--accent); }
.ls-num { font-family: var(--font-mono); font-size: 34px; font-weight: 700; color: var(--accent); }
.ls-text { position: relative; font-size: 60px; font-weight: 600; line-height: 1.25; }
.ls-under { position: absolute; left: 0; right: 0; bottom: -6px; height: 6px; background: var(--accent); opacity: 0.4; transform-origin: left center; }
.ls-conc { position: relative; display: flex; align-items: center; gap: 20px; margin-top: 12px; font-size: 56px; font-weight: 600; white-space: nowrap; }
.ls-check { width: 60px; height: 60px; flex: none; }
.ls-check { filter: drop-shadow(0 0 10px color-mix(in srgb, var(--accent) 60%, transparent)); }
.ls-check circle { fill: none; stroke: var(--accent); stroke-width: 3; }
.ls-check path { fill: none; stroke: var(--accent); stroke-width: 4; stroke-linecap: round; stroke-linejoin: round; stroke-dasharray: 30; }
</style>
