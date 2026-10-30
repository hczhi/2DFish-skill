<script setup lang="ts">
import { computed } from 'vue'
import { easeInCubic, easeOutBack, easeOutCubic, focusIn, lerp, progress, pulse } from './timeline'
import { useCardSize } from './cardSize'
import CardShell from './CardShell.vue'
import { useThemeMotion } from './themeContext'

// 「正误对比」卡：✕ 错误做法（先出，再被一条线划掉、变灰）→ ✓ 正确做法（橙色）。两句都摘原话；标题允许 AI 概括。

export interface RightWrongData {
  label: string
  title: string
  wrong: string
  right: string
  accent: string
  panel: boolean
  duration: number
}

const props = defineProps<{ data: RightWrongData; t: number }>()
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
const rowIn = (a: number) => {
  const p = easeOutCubic(progress(props.t, a, a + 0.4))
  return { opacity: p, transform: `translateX(${lerp(-40, 0, p)}px)` }
}
const iconIn = (a: number) => {
  const p = progress(props.t, a, a + 0.4)
  return { opacity: easeOutCubic(p), transform: `scale(${lerp(0.3, 1, easeOutBack(p))})` }
}
const WRONG_AT = 0.4
const STRIKE_AT = 1.0
const RIGHT_AT = 1.5
const strike = computed(() => easeOutCubic(progress(props.t, STRIKE_AT, STRIKE_AT + 0.35)))
// 划掉之后错误那行变灰
const wrongDim = computed(() => lerp(1, 0.45, strike.value))
const labelStyle = computed(() => {
  const p = easeOutCubic(progress(props.t, 0, 0.45))
  return { opacity: p, clipPath: `inset(0 ${100 - p * 100}% 0 0)` }
})
const { enter } = useThemeMotion()
const titleStyle = computed(() => enter(props.t, 0.1))
</script>

<template>
  <div ref="root" class="rw" :style="rootStyle">
    <CardShell v-if="data.panel" :t="t" :duration="data.duration" />
    <div v-if="data.label" class="rw-label" :style="labelStyle"><i class="bx-dot" :style="{ '--pulse': pulse(t) }" />{{ data.label }}</div>
    <div v-if="data.title" class="rw-title" :style="titleStyle">{{ data.title }}</div>
    <div class="rw-row wrong" :style="[rowIn(WRONG_AT), { '--dim': wrongDim }]">
      <span class="rw-icon" :style="iconIn(WRONG_AT)">✕</span>
      <span class="rw-text">{{ data.wrong }}<i class="rw-strike" :style="{ transform: `scaleX(${strike})` }" /></span>
    </div>
    <div class="rw-row right" :style="rowIn(RIGHT_AT)">
      <span class="rw-icon" :style="iconIn(RIGHT_AT)">✓</span>
      <span class="rw-text bx-hot">{{ data.right }}</span>
    </div>
  </div>
</template>

<style scoped>
.rw {
  position: relative; display: inline-block; padding: 48px 80px 44px 60px; box-sizing: border-box;
  color: var(--fg); font-family: var(--font-cn);
}
.rw-panel { position: absolute; inset: 0; border-radius: 8px; background: var(--panel); border: 2px solid var(--line); }
.rw-label {
  position: relative; display: flex; align-items: center; gap: 18px; margin-bottom: 16px; white-space: nowrap;
  font-family: var(--font-mono); font-size: 38px; font-weight: 600; letter-spacing: 0.3em; text-transform: uppercase; color: var(--accent);
}
.rw-label b { display: inline-block; width: 48px; height: 4px; background: var(--accent); }
.rw-title { position: relative; font-size: 80px; font-weight: 700; white-space: nowrap; margin-bottom: 36px; }
.rw-row { position: relative; display: flex; align-items: center; gap: 28px; margin-bottom: 28px; white-space: nowrap; }
.rw-icon {
  width: 84px; height: 84px; border-radius: 50%; display: grid; place-items: center; flex: none;
  font-size: 52px; font-weight: 800; line-height: 1;
}
.wrong .rw-icon { border: 4px solid var(--mute); color: var(--mute); }
.right .rw-icon {
  color: var(--ink-on-accent); background: radial-gradient(circle at 35% 30%, color-mix(in srgb, var(--accent) 45%, #fff), var(--accent) 55%, color-mix(in srgb, var(--accent) 75%, #000));
  box-shadow: 0 0 24px color-mix(in srgb, var(--accent) 50%, transparent);
}
.rw-text { position: relative; font-size: 68px; font-weight: 600; }
.wrong .rw-text { opacity: var(--dim, 1); }
.right .rw-text { color: var(--accent); font-weight: 700; }
.rw-strike { position: absolute; left: -6px; right: -6px; top: 52%; height: 6px; background: var(--fg); transform-origin: left center; }
</style>
