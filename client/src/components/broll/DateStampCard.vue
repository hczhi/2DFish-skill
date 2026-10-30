<script setup lang="ts">
import { computed } from 'vue'
import { easeOutCubic, lerp, progress } from './timeline'
import { useCardBase } from './cardBase'
import CardShell from './CardShell.vue'
import { dsCharAt, dsLine, dsNoteAt, dsTypedAt } from './stampTimes'

// 「时间地点戳」：讲故事起头那句「2019 年冬，深圳」用等宽字逐字敲出来，速度带一点抖动（像真的在打字），
// 末尾一个方块光标，敲完闪三下，副信息行再跟进来。所有字都摘原话；时间就是原话里的那个，不换算、不补全。

export interface DateStampData { when: string; where: string; note: string; accent: string; panel: boolean; duration: number }
const props = defineProps<{ data: DateStampData; t: number }>()
const emit = defineEmits<{ size: [{ w: number; h: number }] }>()
const { root, rootStyle } = useCardBase(props, emit)

const chars = computed(() => [...dsLine(props.data)])
const shown = computed(() => chars.value.filter((_, k) => props.t >= dsCharAt(k)).length)
const typedAt = computed(() => dsTypedAt(props.data))
// 光标：敲字时常亮，敲完按 0.3 秒一下闪 3 下，之后常亮（一直闪的话停住的那几秒画面在跳）
const cursorOn = computed(() => {
  const d = props.t - typedAt.value
  return d < 0 || d >= 0.9 || Math.floor(d / 0.15) % 2 === 1
})
const barStyle = computed(() => ({ transform: `scaleY(${easeOutCubic(progress(props.t, 0, 0.3))})` }))
const noteStyle = computed(() => {
  const a = dsNoteAt(props.data)
  const p = easeOutCubic(progress(props.t, a, a + 0.45))
  return { opacity: p, transform: `translateY(${lerp(14, 0, p)}px)` }
})
</script>

<template>
  <div ref="root" class="ds" :style="rootStyle">
    <CardShell v-if="data.panel" :t="t" :duration="data.duration" />
    <i class="ds-bar" :style="barStyle" />
    <div class="ds-body">
      <div class="ds-line">
        <!-- 没敲到的字用 visibility 藏着占位：卡片尺寸按终值量，敲的过程中不抖 -->
        <!-- 光标挂在一个零宽锚点上、插在已敲出的最后一个字后面：直接排在行尾的话它停在没敲到的空白后面 -->
        <template v-for="(ch, k) in chars" :key="k"><i v-if="k === shown" class="ds-anchor"><i class="ds-cursor" :style="{ opacity: cursorOn ? 1 : 0 }" /></i><span :class="{ hidden: k >= shown }">{{ ch }}</span></template><i v-if="shown >= chars.length" class="ds-anchor"><i class="ds-cursor" :style="{ opacity: cursorOn ? 1 : 0 }" /></i>
      </div>
      <div v-if="data.note" class="ds-note" :style="noteStyle">{{ data.note }}</div>
    </div>
  </div>
</template>

<style scoped>
.ds { position: relative; display: inline-flex; gap: 34px; padding: 44px 72px 48px 52px; color: var(--fg); font-family: var(--font-cn); }
.ds-bar { position: relative; width: 8px; background: var(--accent); transform-origin: top; }
.ds-body { position: relative; display: flex; flex-direction: column; gap: 18px; padding-right: 50px; }
.ds-line { display: flex; align-items: center; font-family: var(--font-mono), var(--font-cn); font-size: 76px; font-weight: 700; white-space: pre; letter-spacing: 0.04em; line-height: 1.1; }
.ds-line .hidden { visibility: hidden; }
.ds-anchor { position: relative; display: inline-block; width: 0; height: 0.95em; }
.ds-cursor { position: absolute; left: 6px; top: 0; width: 0.55em; height: 100%; background: var(--accent); }
.ds-note { font-size: 44px; font-weight: 600; opacity: 0.8; white-space: nowrap; }
</style>
