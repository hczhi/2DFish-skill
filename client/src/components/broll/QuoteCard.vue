<script setup lang="ts">
import { computed } from 'vue'
import { easeInCubic, easeOutBack, easeOutCubic, lerp, progress } from './timeline'
import { useCardSize } from './cardSize'
import CardShell from './CardShell.vue'
import { useThemeMotion } from './themeContext'

// 「引用卡」：大引号落下 + 引文（可以折成两三行）+ 右下「—— 出处」。引文和出处都摘原话。
export interface QuoteData { quote: string; source: string; accent: string; panel: boolean; duration: number }
const props = defineProps<{ data: QuoteData; t: number }>()
const emit = defineEmits<{ size: [{ w: number; h: number }] }>()
const root = useCardSize(emit)
const { enter } = useThemeMotion()

const OUT = 0.5
const outP = computed(() => easeInCubic(progress(props.t, props.data.duration - OUT, props.data.duration)))
const rootStyle = computed(() => ({
  opacity: 1 - outP.value, filter: `blur(${outP.value * 8}px)`, transform: `translateY(${-30 * outP.value}px)`,
  ...(props.data.accent ? { '--accent': props.data.accent } : {}),
}))
const markStyle = computed(() => {
  const p = progress(props.t, 0, 0.55)
  return { opacity: easeOutCubic(p), transform: `translateY(${lerp(-60, 0, easeOutBack(p))}px) scale(${lerp(1.4, 1, easeOutCubic(p))})` }
})
const quoteStyle = computed(() => enter(props.t, 0.35, 0.7))
const sourceStyle = computed(() => {
  const p = easeOutCubic(progress(props.t, 1.1, 1.6))
  return { opacity: p, transform: `translateX(${lerp(30, 0, p)}px)` }
})
// 出处前面那道线就是破折号，他自己写的「——」去掉（不去的话显示成「—— —— 巴菲特」）
const source = computed(() => props.data.source.replace(/^[\s\-—–]+/, ''))
const ruleStyle = computed(() => ({ transform: `scaleX(${easeOutCubic(progress(props.t, 1.0, 1.5))})` }))
</script>

<template>
  <div ref="root" class="qt" :style="rootStyle">
    <CardShell v-if="data.panel" :t="t" :duration="data.duration" />
    <div class="qt-mark bx-hot" :style="markStyle">“</div>
    <div class="qt-text" :style="quoteStyle">{{ data.quote }}</div>
    <div v-if="source" class="qt-src" :style="sourceStyle"><i :style="ruleStyle" />{{ source }}</div>
  </div>
</template>

<style scoped>
.qt { position: relative; display: inline-block; max-width: 1400px; padding: 40px 90px 56px 80px; box-sizing: border-box; color: var(--fg); font-family: var(--font-cn); }
.qt-mark { position: relative; height: 150px; font-family: Georgia, var(--font-cn), serif; font-size: 300px; line-height: 1; font-weight: 800; margin-left: -20px; }
.qt-text { position: relative; font-size: 76px; font-weight: 700; line-height: 1.35; max-width: 1200px; }
.qt-src { position: relative; display: flex; align-items: center; justify-content: flex-end; gap: 20px; margin-top: 30px; font-size: 44px; color: var(--mute); white-space: nowrap; }
.qt-src i { display: inline-block; width: 80px; height: 3px; background: var(--accent); transform-origin: right center; }
</style>
