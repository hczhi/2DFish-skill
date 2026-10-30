<script setup lang="ts">
import { computed } from 'vue'
import { depthIn, easeInCubic, easeOutBack, easeOutCubic, focusIn, lerp, progress, pulse, stagger } from './timeline'
import { useCardSize } from './cardSize'
import CardShell from './CardShell.vue'
import { useThemeMotion } from './themeContext'

// 「关键词大字」卡：一行引子（白、小一号）+ 一行重点（橙、大字、逐字砸下来），左侧一条竖线。
// 例：「提示词是改」/「一版又一版」。两行都摘原话。

export interface KeywordData {
  label: string
  lead: string
  key: string
  accent: string
  panel: boolean
  duration: number
}

const props = defineProps<{ data: KeywordData; t: number }>()
const emit = defineEmits<{ size: [{ w: number; h: number }] }>()
const root = useCardSize(emit)

const OUT = 0.5
const outP = computed(() => easeInCubic(progress(props.t, props.data.duration - OUT, props.data.duration)))
const rootStyle = computed(() => ({
  opacity: 1 - outP.value,
  filter: `blur(${outP.value * 8}px)`,
  transform: `translateY(${-30 * outP.value}px)`,
  ...(props.data.accent ? { '--accent': props.data.accent } : {}),
}))

const keyChars = computed(() => [...props.data.key])
// 引子先出，重点的字在引子出完之后逐个砸下来
const keyStart = computed(() => (props.data.lead ? 0.55 : 0.25))
const { depth, enter } = useThemeMotion()
const keyCharStyle = (i: number) => {
  if (depth.value) return depthIn(props.t, keyStart.value + i * 0.08, 0.55, 2.2)
  const p = stagger(props.t, keyStart.value, 0.08, i, 0.4)
  return { opacity: easeOutCubic(p), transform: `scale(${lerp(1.5, 1, easeOutBack(p))})` }
}
const barStyle = computed(() => ({ transform: `scaleY(${easeOutCubic(progress(props.t, 0, 0.45))})` }))
const labelStyle = computed(() => {
  const p = easeOutCubic(progress(props.t, 0.05, 0.5))
  return { opacity: p, clipPath: `inset(0 ${100 - p * 100}% 0 0)` }
})
const leadStyle = computed(() => enter(props.t, 0.15, 0.5))
// 重点砸完之后亮一下
const glowAt = computed(() => keyStart.value + keyChars.value.length * 0.08 + 0.3)
const glow = computed(() => {
  const p = progress(props.t, glowAt.value, glowAt.value + 0.6)
  return Math.sin(p * Math.PI)
})
</script>

<template>
  <div ref="root" class="kw" :style="rootStyle">
    <CardShell v-if="data.panel" :t="t" :duration="data.duration" />
    <div class="kw-bar" :style="barStyle" />
    <div class="kw-body">
      <div v-if="data.label" class="kw-label" :style="labelStyle"><i class="bx-dot" :style="{ '--pulse': pulse(t) }" />{{ data.label }}</div>
      <div v-if="data.lead" class="kw-lead" :style="leadStyle">{{ data.lead }}</div>
      <div class="kw-key" :style="{ filter: `drop-shadow(0 0 ${36 * glow}px var(--accent))` }">
        <span v-for="(ch, i) in keyChars" :key="i" class="kw-ch bx-hot" :style="keyCharStyle(i)">{{ ch }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.kw {
  position: relative; display: inline-flex; gap: 40px; padding: 52px 80px 56px 56px; box-sizing: border-box;
  color: var(--fg); font-family: var(--font-cn);
}
.kw-panel { position: absolute; inset: 0; border-radius: 8px; background: var(--panel); border: 2px solid var(--line); }
.kw-bar { position: relative; width: 8px; background: linear-gradient(180deg, var(--accent), transparent); transform-origin: top center; }
.kw-body { position: relative; }
.kw-label {
  display: flex; align-items: center; gap: 18px; margin-bottom: 20px; white-space: nowrap;
  font-family: var(--font-mono); font-size: 38px; font-weight: 600; letter-spacing: 0.3em; text-transform: uppercase; color: var(--accent);
}
.kw-label b { display: inline-block; width: 48px; height: 4px; background: var(--accent); }
.kw-lead { font-size: 88px; font-weight: 600; white-space: nowrap; line-height: 1.2; }
.kw-key { font-size: 156px; font-weight: 800; color: var(--accent); white-space: nowrap; line-height: 1.15; margin-top: 8px; }
.kw-ch { display: inline-block; white-space: pre; transform-origin: center 70%; }
</style>
