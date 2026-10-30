<script setup lang="ts">
import { computed } from 'vue'
import { easeInOutCubic, easeOutCubic, progress } from './timeline'
import { useCardBase } from './cardBase'
import CardShell from './CardShell.vue'

// 「荧光笔」卡：整句话先出来，然后句子里的重点词被一支马克笔依次涂上（稍微歪一点、边缘不齐，像真的手涂）。
// 重点词要是句子里的连续几个字，多个用「、」隔开；对不上的词不涂，由 check 报出来。整句摘原话。
export interface MarkerData { sentence: string; marks: string; accent: string; panel: boolean; duration: number }
const props = defineProps<{ data: MarkerData; t: number }>()
const emit = defineEmits<{ size: [{ w: number; h: number }] }>()
const { root, rootStyle, enter } = useCardBase(props, emit)

const MARK_AT = 0.7
const MARK = 0.45
// 句子切成 普通 / 重点 交替的几段，重点段带上自己是第几个涂的
const segs = computed(() => {
  const s = props.data.sentence
  const words = props.data.marks.split(/[、,，\s]+/).filter((w) => w && s.includes(w))
  const hits: { at: number; len: number }[] = []
  for (const w of words) { const at = s.indexOf(w); if (!hits.some((h) => at < h.at + h.len && h.at < at + w.length)) hits.push({ at, len: w.length }) }
  hits.sort((a, b) => a.at - b.at)
  const out: { text: string; k: number }[] = []
  let pos = 0
  hits.forEach((h, k) => { if (h.at > pos) out.push({ text: s.slice(pos, h.at), k: -1 }); out.push({ text: s.slice(h.at, h.at + h.len), k }); pos = h.at + h.len })
  if (pos < s.length) out.push({ text: s.slice(pos), k: -1 })
  return out
})
const swipe = (k: number) => easeInOutCubic(progress(props.t, MARK_AT + k * (MARK + 0.15), MARK_AT + k * (MARK + 0.15) + MARK))
const textStyle = computed(() => enter(props.t, 0.1, 0.5))
const markIn = (k: number) => ({ opacity: easeOutCubic(progress(props.t, MARK_AT + k * (MARK + 0.15) - 0.05, MARK_AT + k * (MARK + 0.15) + 0.1)) })
</script>

<template>
  <div ref="root" class="mk" :style="rootStyle">
    <CardShell v-if="data.panel" :t="t" :duration="data.duration" />
    <div class="mk-text" :style="textStyle">
      <span v-for="(sg, i) in segs" :key="i" :class="{ hit: sg.k >= 0 }">
        <i v-if="sg.k >= 0" class="mk-ink" :style="[markIn(sg.k), { clipPath: `inset(0 ${100 - swipe(sg.k) * 100}% 0 0)` }]" />
        <b>{{ sg.text }}</b>
      </span>
    </div>
  </div>
</template>

<style scoped>
.mk { position: relative; display: inline-block; max-width: 1500px; padding: 54px 80px 60px 70px; box-sizing: border-box; color: var(--fg); font-family: var(--font-cn); }
.mk-text { position: relative; font-size: 80px; font-weight: 700; line-height: 1.5; }
.mk-text span { position: relative; white-space: pre-wrap; }
.mk-text b { position: relative; font-weight: inherit; }
.mk-text .hit b { font-weight: 900; }
/* 马克笔：偏下半截、稍微歪、两头不齐 */
.mk-ink {
  position: absolute; left: -6px; right: -6px; top: 48%; bottom: 2%; transform: rotate(-1.2deg);
  border-radius: 10px 30px 14px 26px / 18px 10px 24px 12px;
  background: color-mix(in srgb, var(--accent) 55%, transparent);
}
</style>
