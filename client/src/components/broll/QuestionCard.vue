<script setup lang="ts">
import { computed } from 'vue'
import { depthIn, easeInCubic, easeOutBack, easeOutCubic, focusIn, lerp, progress, pulse, stagger } from './timeline'
import { useCardSize } from './cardSize'
import CardShell from './CardShell.vue'
import { useThemeMotion } from './themeContext'

// 「提问卡」：一个大问号转着落下 + 问题逐字打出来 + 可选一行小字提示。问题允许 AI 概括。

export interface QuestionData {
  label: string
  question: string
  hint: string
  accent: string
  panel: boolean
  duration: number
}

const props = defineProps<{ data: QuestionData; t: number }>()
const emit = defineEmits<{ size: [{ w: number; h: number }] }>()
const root = useCardSize(emit)

const CHAR_AT = 0.45
const CHAR_STEP = 0.06

const OUT = 0.5
const outP = computed(() => easeInCubic(progress(props.t, props.data.duration - OUT, props.data.duration)))
const rootStyle = computed(() => ({
  opacity: 1 - outP.value,
  filter: `blur(${outP.value * 8}px)`,
  transform: `translateY(${-30 * outP.value}px)`,
  ...(props.data.accent ? { '--accent': props.data.accent } : {}),
}))
const markStyle = computed(() => {
  const p = progress(props.t, 0, 0.6)
  // 落定之后轻轻晃一下
  const wobble = Math.sin(progress(props.t, 0.6, 1.4) * Math.PI * 2) * 6 * (1 - progress(props.t, 0.6, 1.4))
  return {
    opacity: easeOutCubic(p),
    transform: `translateY(${lerp(-80, 0, easeOutBack(p))}px) rotate(${lerp(-30, 0, easeOutCubic(p)) + wobble}deg)`,
  }
})
const chars = computed(() => [...props.data.question])
// 逐字打出：没轮到的字占位不显示（宽度从第一帧起就是最终宽度）
const charOn = (i: number) => stagger(props.t, CHAR_AT, CHAR_STEP, i, 0.01) >= 1
const { depth } = useThemeMotion()
const caretOn = computed(() => {
  if (depth.value) return false // 景深主题下字是落下来的，不是打出来的，不要光标
  const end = CHAR_AT + chars.value.length * CHAR_STEP
  return props.t < end + 0.6 && Math.floor(props.t * 4) % 2 === 0
})
const caretAt = computed(() => Math.min(chars.value.length, Math.max(0, Math.floor((props.t - CHAR_AT) / CHAR_STEP) + 1)))
const hintStyle = computed(() => {
  const a = CHAR_AT + chars.value.length * CHAR_STEP + 0.2
  const p = easeOutCubic(progress(props.t, a, a + 0.4))
  return { opacity: p, transform: `translateY(${lerp(16, 0, p)}px)` }
})
const labelStyle = computed(() => {
  const p = easeOutCubic(progress(props.t, 0.15, 0.6))
  return { opacity: p, clipPath: `inset(0 ${100 - p * 100}% 0 0)` }
})
</script>

<template>
  <div ref="root" class="qs" :style="rootStyle">
    <CardShell v-if="data.panel" :t="t" :duration="data.duration" />
    <div class="qs-mark bx-hot" :style="markStyle">?</div>
    <div class="qs-body">
      <div v-if="data.label" class="qs-label" :style="labelStyle"><i class="bx-dot" :style="{ '--pulse': pulse(t) }" />{{ data.label }}</div>
      <div class="qs-q">
        <template v-for="(ch, i) in chars" :key="i">
          <i v-if="caretOn && caretAt === i" class="qs-caret" />
          <span :style="depth ? depthIn(t, CHAR_AT + i * CHAR_STEP, 0.45, 1.8) : { visibility: charOn(i) ? 'visible' : 'hidden' }">{{ ch }}</span>
        </template>
        <i v-if="caretOn && caretAt >= chars.length" class="qs-caret" />
      </div>
      <div v-if="data.hint" class="qs-hint" :style="hintStyle">{{ data.hint }}</div>
    </div>
  </div>
</template>

<style scoped>
.qs {
  position: relative; display: inline-flex; align-items: center; gap: 44px; padding: 44px 80px 44px 56px; box-sizing: border-box;
  color: var(--fg); font-family: var(--font-cn);
}
.qs-panel { position: absolute; inset: 0; border-radius: 8px; background: var(--panel); border: 2px solid var(--line); }
.qs-mark {
  position: relative; font-family: var(--font-mono); font-size: 260px; line-height: 1; font-weight: 800; color: var(--accent);
  transform-origin: center 80%;
}
.qs-body { position: relative; }
.qs-label {
  display: flex; align-items: center; gap: 18px; margin-bottom: 16px; white-space: nowrap;
  font-family: var(--font-mono); font-size: 38px; font-weight: 600; letter-spacing: 0.3em; text-transform: uppercase; color: var(--accent);
}
.qs-label b { display: inline-block; width: 48px; height: 4px; background: var(--accent); }
.qs-q { position: relative; font-size: 96px; font-weight: 700; white-space: nowrap; line-height: 1.2; }
.qs-q span { white-space: pre; display: inline-block; }
.qs-caret { display: inline-block; width: 0; position: relative; }
.qs-caret::after { content: ''; position: absolute; left: 2px; top: 10px; width: 6px; height: 96px; background: var(--accent); }
.qs-hint { margin-top: 18px; font-size: 52px; color: var(--mute); white-space: nowrap; }
</style>
