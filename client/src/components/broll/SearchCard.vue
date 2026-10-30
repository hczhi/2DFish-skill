<script setup lang="ts">
import { computed } from 'vue'
import { easeOutBack, easeOutCubic, lerp, progress, stagger } from './timeline'
import { useCardBase } from './cardBase'
import CardShell from './CardShell.vue'

// 「搜索框」卡：搜索框弹出 → 关键词逐字打进去（光标闪）→ 按一下搜索 → 下面几条结果依次滑出（可没有）。
// 关键词摘原话（「搜转场」→ 转场）；结果只写原话里说了的，没说就不放 —— 编出来的搜索结果读起来像真的。
export interface SearchData { query: string; results: string[]; hint: string; accent: string; panel: boolean; duration: number }
const props = defineProps<{ data: SearchData; t: number }>()
const emit = defineEmits<{ size: [{ w: number; h: number }] }>()
const { root, rootStyle } = useCardBase(props, emit)

const TYPE_AT = 0.5
const TYPE_STEP = 0.11
const chars = computed(() => [...props.data.query])
const typed = computed(() => Math.max(0, Math.min(chars.value.length, Math.floor((props.t - TYPE_AT) / TYPE_STEP) + 1)))
const PRESS = computed(() => TYPE_AT + chars.value.length * TYPE_STEP + 0.25)
const boxStyle = computed(() => {
  const p = progress(props.t, 0, 0.45)
  return { opacity: easeOutCubic(p), transform: `scale(${lerp(0.85, 1, easeOutBack(p))})` }
})
const btnStyle = computed(() => {
  const p = progress(props.t, PRESS.value, PRESS.value + 0.25)
  return { transform: `scale(${1 - Math.sin(p * Math.PI) * 0.12})` }
})
const caretOn = computed(() => props.t < PRESS.value + 0.2 && Math.floor(props.t * 3) % 2 === 0)
const results = computed(() => props.data.results.filter((s) => s.trim()))
const resultStyle = (i: number) => {
  const p = easeOutCubic(stagger(props.t, PRESS.value + 0.3, 0.22, i, 0.4))
  return { opacity: p, transform: `translateY(${lerp(20, 0, p)}px)`, filter: `blur(${lerp(6, 0, p)}px)` }
}
const hintStyle = computed(() => ({ opacity: easeOutCubic(progress(props.t, 0.2, 0.6)) }))
</script>

<template>
  <div ref="root" class="sr" :style="rootStyle">
    <CardShell v-if="data.panel" :t="t" :duration="data.duration" />
    <div v-if="data.hint" class="sr-hint" :style="hintStyle">{{ data.hint }}</div>
    <div class="sr-box" :style="boxStyle">
      <svg class="sr-ic" viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5" /><path d="M15.5 15.5 L21 21" /></svg>
      <span class="sr-q">
        <span class="sr-ghost">{{ data.query }}</span>
        <span class="sr-typed">{{ chars.slice(0, typed).join('') }}<i v-if="caretOn" class="sr-caret" /></span>
      </span>
      <span class="sr-btn" :style="btnStyle">搜索</span>
    </div>
    <div v-for="(r, i) in results" :key="i" class="sr-res" :style="resultStyle(i)">
      <i class="sr-dot" />{{ r }}
    </div>
  </div>
</template>

<style scoped>
.sr { position: relative; display: inline-block; padding: 48px 70px 52px 60px; box-sizing: border-box; color: var(--fg); font-family: var(--font-cn); }
.sr-hint { position: relative; font-size: 40px; color: var(--mute); margin-bottom: 20px; white-space: nowrap; }
.sr-box {
  position: relative; display: flex; align-items: center; gap: 26px; min-width: 900px; padding: 22px 22px 22px 36px; border-radius: 999px;
  background: var(--tile); box-shadow: inset 0 0 0 3px color-mix(in srgb, var(--accent) 70%, transparent), 0 0 32px color-mix(in srgb, var(--accent) var(--glow-a, 45%), transparent), 0 20px 40px var(--shadow-c);
}
.sr-ic { width: 56px; height: 56px; flex: none; fill: none; stroke: var(--accent); stroke-width: 2.6; stroke-linecap: round; }
.sr-q { display: inline-grid; flex: 1; font-size: 64px; font-weight: 700; white-space: nowrap; }
.sr-ghost, .sr-typed { grid-area: 1 / 1; }
.sr-ghost { visibility: hidden; }
.sr-caret { display: inline-block; width: 5px; height: 64px; margin-left: 4px; vertical-align: -10px; background: var(--accent); }
.sr-btn { flex: none; padding: 16px 40px; border-radius: 999px; font-size: 40px; font-weight: 700; color: var(--ink-on-accent); background: var(--accent); }
.sr-res { position: relative; display: flex; align-items: center; gap: 18px; margin: 22px 0 0 40px; font-size: 46px; white-space: nowrap; }
.sr-dot { width: 12px; height: 12px; border-radius: 50%; background: var(--accent); flex: none; }
</style>
