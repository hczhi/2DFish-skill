<script setup lang="ts">
import { computed } from 'vue'
import { easeOutBack, easeOutCubic, lerp, progress, stagger } from './timeline'
import { useCardBase } from './cardBase'
import CardShell from './CardShell.vue'
import CardHead from './CardHead.vue'
import { cueAt } from './cues'

// 「两栏对比」卡：左右两栏（各自一个栏名 + 2–4 条），中间一个 VS。tone=proscons 时左栏 ✕ 灰、右栏 ✓ 强调色（缺点 / 优点），
// neutral 时两边同等对待（方案 A / 方案 B）。条目摘原话。
// 每一条可以单独定出现时间：data.cues 先排左栏、再排右栏（和默认的出场顺序一致）。
export interface TwoColumnData { label: string; title: string; leftTitle: string; left: string[]; rightTitle: string; right: string[]; cues?: (number | null)[]; tone: string; accent: string; panel: boolean; duration: number }
const props = defineProps<{ data: TwoColumnData; t: number }>()
const emit = defineEmits<{ size: [{ w: number; h: number }] }>()
const { root, rootStyle } = useCardBase(props, emit)

const AT = 0.55
const STEP = 0.28
const left = computed(() => props.data.left.filter((s) => s.trim()))
const right = computed(() => props.data.right.filter((s) => s.trim()))
// 左栏先逐条出完，右栏再逐条出
const itemStyle = (side: 'l' | 'r', i: number) => {
  const k = side === 'l' ? i : left.value.length + i
  const at = cueAt(props.data.cues, k, AT + k * STEP)
  const p = easeOutCubic(progress(props.t, at, at + 0.4))
  return { opacity: p, transform: `translateX(${lerp(side === 'l' ? -30 : 30, 0, p)}px)` }
}
const colStyle = (side: 'l' | 'r') => {
  const p = easeOutCubic(progress(props.t, side === 'l' ? 0.2 : 0.35, side === 'l' ? 0.6 : 0.75))
  return { opacity: p, transform: `translateY(${lerp(30, 0, p)}px)` }
}
const vsStyle = computed(() => {
  const p = progress(props.t, 0.4, 0.8)
  return { opacity: easeOutCubic(p), transform: `scale(${lerp(0.3, 1, easeOutBack(p))}) rotate(${lerp(-30, 0, easeOutCubic(p))}deg)` }
})
const pc = computed(() => props.data.tone === 'proscons')
</script>

<template>
  <div ref="root" class="tc" :style="rootStyle">
    <CardShell v-if="data.panel" :t="t" :duration="data.duration" />
    <CardHead :t="t" :label="data.label" :title="data.title" />
    <div class="tc-cols">
      <div class="tc-col" :class="{ dim: pc }" :style="colStyle('l')">
        <div class="tc-h">{{ data.leftTitle }}</div>
        <div v-for="(it, i) in left" :key="i" class="tc-item" :style="itemStyle('l', i)"><i>{{ pc ? '✕' : '•' }}</i>{{ it }}</div>
      </div>
      <div class="tc-vs bx-hot" :style="vsStyle">VS</div>
      <div class="tc-col hi" :style="colStyle('r')">
        <div class="tc-h">{{ data.rightTitle }}</div>
        <div v-for="(it, i) in right" :key="i" class="tc-item" :style="itemStyle('r', i)"><i>{{ pc ? '✓' : '•' }}</i>{{ it }}</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tc { position: relative; display: inline-block; padding: 48px 70px 50px 60px; box-sizing: border-box; color: var(--fg); font-family: var(--font-cn); }
.tc-cols { position: relative; display: flex; align-items: stretch; gap: 40px; }
.tc-col { min-width: 440px; padding: 30px 36px; border-radius: 22px; background: var(--track); }
.tc-col.hi { background: color-mix(in srgb, var(--accent) 12%, transparent); box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--accent) 55%, transparent); }
.tc-h { font-size: 52px; font-weight: 800; margin-bottom: 22px; white-space: nowrap; }
.tc-col.hi .tc-h { color: var(--accent); }
.tc-col.dim .tc-h { color: var(--mute); }
.tc-item { display: flex; align-items: baseline; gap: 16px; font-size: 44px; margin-bottom: 16px; white-space: nowrap; }
.tc-item i { font-style: normal; font-weight: 800; color: var(--mute); }
.tc-col.hi .tc-item i { color: var(--accent); }
.tc-col.dim .tc-item { color: var(--mute); }
.tc-vs { align-self: center; font-family: var(--font-mono); font-size: 80px; font-weight: 900; font-style: italic; }
</style>
