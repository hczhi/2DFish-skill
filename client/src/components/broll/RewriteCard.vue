<script setup lang="ts">
import { computed } from 'vue'
import { easeInOutCubic, easeOutBack, easeOutCubic, lerp, progress } from './timeline'
import { useCardBase } from './cardBase'
import CardShell from './CardShell.vue'
import { retypeTimes, RT_START } from './retypeTimes'

// 「删除线改写」卡：「不是 xx，而是 yy」—— xx 先出来，一道手写感的红线划掉它、变灰，yy 从上方「写」上去（左往右揭开），
// 旁边一个插入记号 ^。比「正误对比」轻：只换一个词，不列两行。前后两个词都摘原话。
// style = 'retype'（打字改口）：同一个位置上先打出 xx、停一拍光标闪两下、退格删掉、再打出 yy。
// 划线是空间上划掉，这个是时间上的改口（口语里「额不对，是……」那种）。节奏在 retypeTimes.ts。
export interface RewriteData { lead: string; from: string; to: string; tail: string; style?: 'strike' | 'retype'; accent: string; panel: boolean; duration: number }
const props = defineProps<{ data: RewriteData; t: number }>()
const emit = defineEmits<{ size: [{ w: number; h: number }] }>()
const { root, rootStyle, enter } = useCardBase(props, emit)

const STRIKE = 0.75
const WRITE = 1.15
const lineStyle = computed(() => enter(props.t, 0.1, 0.5))
const strike = computed(() => easeInOutCubic(progress(props.t, STRIKE, STRIKE + 0.35)))
const fromDim = computed(() => lerp(1, 0.45, strike.value))
const toStyle = computed(() => {
  const p = easeOutCubic(progress(props.t, WRITE, WRITE + 0.55))
  return { clipPath: `inset(-20% ${100 - p * 100}% -20% 0)`, transform: `rotate(-3deg) translateY(${lerp(10, 0, p)}px)` }
})
// ── 打字改口 ──
const retype = computed(() => props.data.style === 'retype')
const rt = computed(() => retypeTimes(props.data.from, props.data.to))
const typedText = computed(() => {
  const f = [...props.data.from], g = [...props.data.to], t = props.t, r = rt.value
  if (t < RT_START) return { text: '', hot: false }
  if (t < r.typed) return { text: f.slice(0, Math.floor((t - RT_START) / 0.09) + 1).join(''), hot: false }
  if (t < r.pauseEnd) return { text: props.data.from, hot: false }
  if (t < r.deleted) return { text: f.slice(0, f.length - Math.floor((t - r.pauseEnd) / 0.04) - 1).join(''), hot: false }
  return { text: g.slice(0, Math.floor((t - r.deleted) / 0.07) + 1).join(''), hot: true }
})
// 光标：打字 / 删字时常亮，只在停顿那一拍闪两下；打完之后再闪一会儿就收掉
const caretOn = computed(() => {
  const t = props.t, r = rt.value
  if (t < 0.3) return false
  if (t >= r.typed && t < r.pauseEnd) return Math.floor((t - r.typed) / 0.125) % 2 === 1
  if (t >= r.done) return t < r.done + 0.8 && Math.floor((t - r.done) / 0.25) % 2 === 0
  return true
})
const caretStyle = computed(() => {
  const p = progress(props.t, WRITE - 0.1, WRITE + 0.2)
  return { opacity: easeOutCubic(p), transform: `translateX(-50%) scale(${lerp(0.3, 1, easeOutBack(p))})` }
})
</script>

<template>
  <div ref="root" class="rw2" :style="rootStyle">
    <CardShell v-if="data.panel" :t="t" :duration="data.duration" />
    <div v-if="retype" class="rw2-line rt" :style="lineStyle">
      <span v-if="data.lead">{{ data.lead }}</span>
      <span class="rt-slot">
        <!-- 占位：两个词叠在同一格撑出最宽的那个（打字中途卡片尺寸不变） -->
        <span class="rt-ghost">{{ data.from }}</span>
        <span class="rt-ghost">{{ data.to }}</span>
        <span class="rt-live" :class="{ 'bx-hot': typedText.hot }">{{ typedText.text }}<i class="rt-caret" :style="{ opacity: caretOn ? 1 : 0 }" /></span>
      </span>
      <span v-if="data.tail">{{ data.tail }}</span>
    </div>
    <div v-else class="rw2-line" :style="lineStyle">
      <span v-if="data.lead">{{ data.lead }}</span>
      <span class="rw2-slot">
        <span class="rw2-to bx-hot" :style="toStyle">{{ data.to }}</span>
        <span class="rw2-from" :style="{ opacity: fromDim }">{{ data.from }}
          <svg class="rw2-strike" viewBox="0 0 100 20" preserveAspectRatio="none"><path d="M2 12 C 25 6, 50 15, 98 8" pathLength="1" :style="{ strokeDashoffset: 1 - strike }" /></svg>
        </span>
        <!-- 不可见的「改成的词」撑出宽度：它比被划掉的词长时卡片宽度按它算，不然上面那个词会伸出底板。
             必须排在被划掉的词后面：网格的基线取第一个格子，它在前面的话整格往下掉一行 -->
        <span class="rw2-ghost">{{ data.to }}</span>
        <i class="rw2-caret" :style="caretStyle">^</i>
      </span>
      <span v-if="data.tail">{{ data.tail }}</span>
    </div>
  </div>
</template>

<style scoped>
.rw2 { position: relative; display: inline-block; padding: 170px 80px 60px 70px; box-sizing: border-box; color: var(--fg); font-family: var(--font-cn); }
.rw2-line { position: relative; display: flex; align-items: baseline; gap: 22px; font-size: 84px; font-weight: 700; white-space: nowrap; }
.rw2-slot { position: relative; display: inline-grid; justify-items: center; }
.rw2-slot > .rw2-ghost, .rw2-slot > .rw2-from { grid-area: 1 / 1; }
.rw2-ghost { visibility: hidden; font-size: 92px; font-weight: 900; height: 0; overflow: hidden; }
.rw2-from { position: relative; color: var(--mute); }
.rw2-strike { position: absolute; left: -8px; right: -8px; top: 30%; width: calc(100% + 16px); height: 40%; overflow: visible; }
.rw2-strike path { fill: none; stroke: #ff4d4f; stroke-width: 9; stroke-linecap: round; stroke-dasharray: 1; vector-effect: non-scaling-stroke; }
.rw2-to { position: absolute; left: 50%; bottom: 100%; margin-bottom: 4px; translate: -50% 0; font-size: 92px; font-weight: 900; white-space: nowrap; transform-origin: left bottom; }
.rw2-line.rt { margin-top: -110px; }
.rt-slot { display: inline-grid; }
.rt-slot > * { grid-area: 1 / 1; }
.rt-ghost { visibility: hidden; font-weight: 900; padding-right: 0.15em; }
.rt-live { font-weight: 900; white-space: nowrap; }
.rt-caret { display: inline-block; width: 0.08em; height: 0.95em; margin-left: 0.05em; vertical-align: -0.1em; background: var(--accent); }
.rw2-caret { position: absolute; left: 50%; bottom: -10px; font-style: normal; font-size: 70px; font-weight: 900; color: var(--accent); }
</style>
