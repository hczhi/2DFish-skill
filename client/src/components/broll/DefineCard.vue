<script setup lang="ts">
import { computed } from 'vue'
import { easeInCubic, easeOutCubic, lerp, progress, pulse } from './timeline'
import { useCardSize } from './cardSize'
import CardShell from './CardShell.vue'
import { useThemeMotion } from './themeContext'

// 「名词解释」卡：词典条目的样子 —— 术语（大）+ 英文 / 拼音小字 + 「名词」小标签 + 一道线 + 解释（可折行）。
// 解释必须摘原话（说话人自己怎么解释的），不许模型自己补定义 —— 补出来的定义读起来很权威，错了没人看得出来。
export interface DefineData { term: string; en: string; definition: string; accent: string; panel: boolean; duration: number }
const props = defineProps<{ data: DefineData; t: number }>()
const emit = defineEmits<{ size: [{ w: number; h: number }] }>()
const root = useCardSize(emit)
const { enter } = useThemeMotion()

const OUT = 0.5
const outP = computed(() => easeInCubic(progress(props.t, props.data.duration - OUT, props.data.duration)))
const rootStyle = computed(() => ({
  opacity: 1 - outP.value, filter: `blur(${outP.value * 8}px)`, transform: `translateY(${-30 * outP.value}px)`,
  ...(props.data.accent ? { '--accent': props.data.accent } : {}),
}))
const termStyle = computed(() => enter(props.t, 0.1, 0.55))
const enStyle = computed(() => {
  const p = easeOutCubic(progress(props.t, 0.45, 0.9))
  return { opacity: p, letterSpacing: `${lerp(0.5, 0.2, p)}em` }
})
const ruleStyle = computed(() => ({ transform: `scaleX(${easeOutCubic(progress(props.t, 0.6, 1.1))})` }))
const defStyle = computed(() => enter(props.t, 0.85, 0.6, 18))
</script>

<template>
  <div ref="root" class="df" :style="rootStyle">
    <CardShell v-if="data.panel" :t="t" :duration="data.duration" />
    <div class="df-head">
      <span class="df-term" :style="termStyle">{{ data.term }}</span>
      <span class="df-tag"><i class="bx-dot" :style="{ '--pulse': pulse(t) }" />名词</span>
    </div>
    <div v-if="data.en" class="df-en" :style="enStyle">{{ data.en }}</div>
    <i class="df-rule" :style="ruleStyle" />
    <div class="df-def" :style="defStyle">{{ data.definition }}</div>
  </div>
</template>

<style scoped>
.df { position: relative; display: inline-block; max-width: 1300px; padding: 50px 90px 56px 70px; box-sizing: border-box; color: var(--fg); font-family: var(--font-cn); }
.df-head { position: relative; display: flex; align-items: baseline; gap: 26px; }
.df-term { font-size: 120px; font-weight: 800; white-space: nowrap; }
.df-tag { display: inline-flex; align-items: center; gap: 10px; padding: 6px 18px; border-radius: 999px; font-size: 32px; color: var(--accent); border: 2px solid color-mix(in srgb, var(--accent) 60%, transparent); white-space: nowrap; }
.df-en { position: relative; margin-top: 8px; font-family: var(--font-mono); font-size: 36px; color: var(--mute); text-transform: uppercase; white-space: nowrap; }
.df-rule { position: relative; display: block; height: 4px; margin: 28px 0; background: linear-gradient(90deg, var(--accent), transparent); transform-origin: left center; }
.df-def { position: relative; font-size: 56px; line-height: 1.45; max-width: 1100px; }
</style>
