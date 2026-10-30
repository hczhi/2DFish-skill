<script setup lang="ts">
import { computed } from 'vue'
import { easeInCubic, easeOutBack, easeOutCubic, lerp, progress, pulse, stagger } from './timeline'
import { useCardSize } from './cardSize'
import CardShell from './CardShell.vue'
import { cueAt } from './cues'

// 「气泡逐条」卡：像聊天消息一样 2–4 条依次弹出，左右交替，每条前面一个编号、后面两个对勾（像「已读」）。条目摘原话。
// 每一条可以单独定出现时间（data.cues[i]，见 cues.ts）。
export interface BubbleData { label: string; items: string[]; cues?: (number | null)[]; accent: string; panel: boolean; duration: number }
const props = defineProps<{ data: BubbleData; t: number }>()
const emit = defineEmits<{ size: [{ w: number; h: number }] }>()
const root = useCardSize(emit)

const AT = 0.4
const STEP = 0.55
const OUT = 0.5
const outP = computed(() => easeInCubic(progress(props.t, props.data.duration - OUT, props.data.duration)))
const rootStyle = computed(() => ({
  opacity: 1 - outP.value, filter: `blur(${outP.value * 8}px)`, transform: `translateY(${-30 * outP.value}px)`,
  ...(props.data.accent ? { '--accent': props.data.accent } : {}),
}))
const items = computed(() => props.data.items.filter((s) => s.trim()))
const itemAt = (i: number) => cueAt(props.data.cues, i, AT + i * STEP)
const bubbleStyle = (i: number) => {
  const p = progress(props.t, itemAt(i), itemAt(i) + 0.45)
  return {
    opacity: easeOutCubic(p),
    transform: `translate(${lerp(i % 2 ? 40 : -40, 0, easeOutCubic(p))}px, ${lerp(20, 0, easeOutCubic(p))}px) scale(${lerp(0.8, 1, easeOutBack(p))})`,
    transformOrigin: i % 2 ? 'right bottom' : 'left bottom',
  }
}
const readStyle = (i: number) => ({ opacity: easeOutCubic(progress(props.t, itemAt(i) + 0.35, itemAt(i) + 0.6)) })
const num = (i: number) => String(i + 1).padStart(2, '0')
</script>

<template>
  <div ref="root" class="bb" :style="rootStyle">
    <CardShell v-if="data.panel" :t="t" :duration="data.duration" />
    <div v-if="data.label" class="bb-label"><i class="bx-dot" :style="{ '--pulse': pulse(t) }" />{{ data.label }}<span class="bb-count">{{ items.length }}/{{ items.length }}</span></div>
    <div v-for="(it, i) in items" :key="i" class="bb-row" :class="{ r: i % 2 === 1 }">
      <div class="bb-bubble" :style="bubbleStyle(i)">
        <span class="bb-no">{{ num(i) }}</span>
        <span class="bb-text">{{ it }}</span>
        <span class="bb-read" :style="readStyle(i)">✓✓</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.bb { position: relative; display: inline-flex; flex-direction: column; padding: 44px 70px 40px 56px; box-sizing: border-box; color: var(--fg); font-family: var(--font-cn); min-width: 900px; }
.bb-label { position: relative; display: flex; align-items: center; gap: 18px; margin-bottom: 26px; font-family: var(--font-mono); font-size: 34px; font-weight: 600; letter-spacing: 0.25em; text-transform: uppercase; color: var(--accent); white-space: nowrap; }
.bb-count { margin-left: auto; color: var(--mute); letter-spacing: 0.1em; }
.bb-row { position: relative; display: flex; margin-bottom: 24px; }
.bb-row.r { justify-content: flex-end; }
.bb-bubble {
  display: inline-flex; align-items: center; gap: 22px; padding: 22px 34px; border-radius: 22px; white-space: nowrap;
  background: color-mix(in srgb, var(--accent) 8%, var(--stamp-bg));
  border-left: 6px solid var(--accent);
  box-shadow: 0 14px 30px var(--shadow-c), inset 0 0 0 1.5px color-mix(in srgb, var(--accent) 30%, transparent);
}
.bb-row.r .bb-bubble { border-left: 0; border-right: 6px solid var(--accent); }
.bb-no { font-family: var(--font-mono); font-size: 30px; font-weight: 700; color: var(--accent); }
.bb-text { font-size: 54px; font-weight: 600; }
.bb-read { font-size: 30px; font-weight: 800; color: var(--accent); letter-spacing: -0.2em; }
</style>
