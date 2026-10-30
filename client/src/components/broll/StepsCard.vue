<script setup lang="ts">
import { computed } from 'vue'
import { easeInCubic, easeOutBack, easeOutCubic, focusIn, lerp, progress, pulse, stagger } from './timeline'
import { useCardSize } from './cardSize'
import CardShell from './CardShell.vue'
import { useThemeMotion } from './themeContext'
import { cueAt } from './cues'

// 「步骤流程」卡：2–5 个节点横排，圆里是这一步的第一个字（「提」→「输」），下面是这一步的名字，
// 节点之间一条虚线依次画过去。步骤名摘原话；标题允许 AI 概括。
// 每一步可以单独定出现时间（data.cues[i]，见 cues.ts），连线跟着画到下一步出现的那一刻。

export interface StepsData {
  label: string
  title: string
  steps: string[]
  cues?: (number | null)[]
  accent: string
  panel: boolean
  duration: number
}

const props = defineProps<{ data: StepsData; t: number }>()
const emit = defineEmits<{ size: [{ w: number; h: number }] }>()
const root = useCardSize(emit)

const STEP_START = 0.5
const STEP_GAP = 0.45

const steps = computed(() => props.data.steps.filter((s) => s.trim()))
const stepAt = (i: number) => cueAt(props.data.cues, i, STEP_START + i * STEP_GAP)
// 圆里放第一个字；英文开头的取首字母大写（取第一个字符的话 "AI 生成" 只剩一个 A，也行，但小写更难看）
const glyph = (s: string) => [...s.trim()][0]?.toUpperCase() || ''

const OUT = 0.5
const outP = computed(() => easeInCubic(progress(props.t, props.data.duration - OUT, props.data.duration)))
const rootStyle = computed(() => ({
  opacity: 1 - outP.value,
  filter: `blur(${outP.value * 8}px)`,
  transform: `translateY(${-30 * outP.value}px)`,
  ...(props.data.accent ? { '--accent': props.data.accent } : {}),
}))
const nodeStyle = (i: number) => {
  const p = progress(props.t, stepAt(i), stepAt(i) + 0.4)
  return { opacity: easeOutCubic(p), transform: `scale(${lerp(0.4, 1, easeOutBack(p))})` }
}
const nameStyle = (i: number) => {
  const p = easeOutCubic(progress(props.t, stepAt(i) + 0.15, stepAt(i) + 0.5))
  return { opacity: p, transform: `translateY(${lerp(16, 0, p)}px)` }
}
// 第 i 段连线在第 i 个节点出来之后、第 i+1 个出来之前画完
const linkStyle = (i: number) => ({ transform: `scaleX(${easeOutCubic(progress(props.t, stepAt(i) + 0.2, Math.max(stepAt(i) + 0.4, stepAt(i + 1) + 0.2)))})` })
const labelStyle = computed(() => {
  const p = easeOutCubic(progress(props.t, 0, 0.45))
  return { opacity: p, clipPath: `inset(0 ${100 - p * 100}% 0 0)` }
})
const { enter } = useThemeMotion()
const titleStyle = computed(() => enter(props.t, 0.1))
// 最后一个节点亮起：流程走到头
const lastAt = computed(() => stepAt(steps.value.length - 1) + STEP_GAP)
const lastLit = computed(() => progress(props.t, lastAt.value, lastAt.value + 0.3))
</script>

<template>
  <div ref="root" class="st" :style="rootStyle">
    <CardShell v-if="data.panel" :t="t" :duration="data.duration" />
    <div v-if="data.label" class="st-label" :style="labelStyle"><i class="bx-dot" :style="{ '--pulse': pulse(t) }" />{{ data.label }}</div>
    <div v-if="data.title" class="st-title" :style="titleStyle">{{ data.title }}</div>
    <div class="st-flow">
      <template v-for="(s, i) in steps" :key="i">
        <div class="st-step">
          <div class="st-node" :class="{ last: i === steps.length - 1 }" :style="[nodeStyle(i), i === steps.length - 1 ? { '--lit': lastLit } : {}]">
            {{ glyph(s) }}
          </div>
          <div class="st-name" :style="nameStyle(i)">{{ s }}</div>
        </div>
        <div v-if="i < steps.length - 1" class="st-link"><i :style="linkStyle(i)" /></div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.st {
  position: relative; display: inline-block; padding: 48px 72px 44px 60px; box-sizing: border-box;
  color: var(--fg); font-family: var(--font-cn);
}
.st-panel { position: absolute; inset: 0; border-radius: 8px; background: var(--panel); border: 2px solid var(--line); }
.st-label {
  position: relative; display: flex; align-items: center; gap: 18px; margin-bottom: 16px; white-space: nowrap;
  font-family: var(--font-mono); font-size: 38px; font-weight: 600; letter-spacing: 0.3em; text-transform: uppercase; color: var(--accent);
}
.st-label b { display: inline-block; width: 48px; height: 4px; background: var(--accent); }
.st-title { position: relative; font-size: 80px; font-weight: 700; white-space: nowrap; margin-bottom: 40px; }
.st-flow { position: relative; display: flex; align-items: flex-start; }
.st-step { display: flex; flex-direction: column; align-items: center; gap: 18px; min-width: 150px; }
.st-node {
  width: 128px; height: 128px; border-radius: 50%; display: grid; place-items: center;
  font-size: 60px; font-weight: 800; color: var(--ink-on-accent);
  background: radial-gradient(circle at 35% 30%, color-mix(in srgb, var(--accent) 45%, #fff), var(--accent) 55%, color-mix(in srgb, var(--accent) 75%, #000));
  box-shadow: 0 0 0 7px color-mix(in srgb, var(--accent) 16%, transparent), 0 14px 30px var(--shadow-c);
}
.st-node.last { box-shadow: 0 0 0 7px color-mix(in srgb, var(--accent) 16%, transparent), 0 0 calc(var(--lit, 0) * 56px) var(--accent); }
.st-name { font-size: 48px; font-weight: 600; white-space: nowrap; }
.st-link { width: 140px; height: 128px; display: flex; align-items: center; margin: 0 -6px; }
.st-link i {
  display: block; width: 100%; height: 6px; transform-origin: left center;
  background: repeating-linear-gradient(90deg, var(--accent) 0 18px, transparent 18px 30px);
}
</style>
