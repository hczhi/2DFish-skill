<script setup lang="ts">
import { computed } from 'vue'
import { easeInCubic, easeOutCubic, focusIn, lerp, progress, pulse, stagger } from './timeline'
import { useCardSize } from './cardSize'
import CardShell from './CardShell.vue'

// 「词语标注」卡：「博主 【内容创作者】」—— 先出一个普通说法（灰），再在旁边框出一个更准的叫法（白、带角括号）。
// 默认不带底板，像截图里那样直接浮在画面上。两个词都摘原话。

export interface TermTagData {
  from: string
  to: string
  accent: string
  panel: boolean
  duration: number
}

const props = defineProps<{ data: TermTagData; t: number }>()
const emit = defineEmits<{ size: [{ w: number; h: number }] }>()
const root = useCardSize(emit)

const TO_AT = 0.7

const OUT = 0.45
const outP = computed(() => easeInCubic(progress(props.t, props.data.duration - OUT, props.data.duration)))
const rootStyle = computed(() => ({
  opacity: 1 - outP.value,
  filter: `blur(${outP.value * 8}px)`,
  ...(props.data.accent ? { '--accent': props.data.accent } : {}),
}))
const fromStyle = computed(() => {
  const p = easeOutCubic(progress(props.t, 0, 0.45))
  return { opacity: p * 0.6, transform: `translateY(${lerp(20, 0, p)}px)` }
})
// 角括号从中间向两边撑开
const bracket = computed(() => easeOutCubic(progress(props.t, TO_AT - 0.25, TO_AT + 0.2)))
const toChars = computed(() => [...props.data.to])
const toCharStyle = (i: number) => {
  const p = easeOutCubic(stagger(props.t, TO_AT, 0.06, i, 0.3))
  return { opacity: p, filter: `blur(${lerp(8, 0, p)}px)` }
}
</script>

<template>
  <div ref="root" class="tt" :style="rootStyle">
    <CardShell v-if="data.panel" :t="t" :duration="data.duration" />
    <span v-if="data.from" class="tt-from" :style="fromStyle">{{ data.from }}</span>
    <span class="tt-to">
      <i class="tt-br l" :style="{ opacity: bracket, transform: `translateX(${lerp(60, 0, bracket)}px)` }" />
      <span v-for="(ch, i) in toChars" :key="i" class="tt-ch" :style="toCharStyle(i)">{{ ch }}</span>
      <i class="tt-br r" :style="{ opacity: bracket, transform: `translateX(${lerp(-60, 0, bracket)}px)` }" />
    </span>
  </div>
</template>

<style scoped>
.tt {
  position: relative; display: inline-flex; align-items: center; gap: 36px; padding: 36px 56px; box-sizing: border-box;
  color: var(--fg); font-family: var(--font-cn); white-space: nowrap;
  text-shadow: var(--text-shadow);
}
.tt-panel { position: absolute; inset: 0; border-radius: 8px; background: var(--panel); border: 2px solid var(--line); }
.tt-from { position: relative; font-size: 80px; font-weight: 600; color: var(--fg); }
.tt-to { position: relative; display: inline-flex; padding: 14px 36px; font-size: 96px; font-weight: 700; }
.tt-ch { display: inline-block; white-space: pre; }
.tt-br { position: absolute; width: 30px; border: 0 solid var(--accent); filter: drop-shadow(0 0 8px var(--accent)); }
.tt-br.l { left: 0; top: 0; height: 46px; border-left-width: 6px; border-top-width: 6px; }
.tt-br.r { right: 0; bottom: 0; height: 46px; border-right-width: 6px; border-bottom-width: 6px; }
</style>
