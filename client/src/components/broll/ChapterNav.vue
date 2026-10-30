<script setup lang="ts">
import { computed } from 'vue'
import { progress, easeOutCubic, easeInCubic } from './timeline'

// 顶部章节导航条（全程组件，不是单张卡）：按时间轴上的章节卡自动分段，当前章节高亮、下划线随这一章的进度走满，
// 已经过去的章节变暗。整条视频一直在，开头 0.5 秒淡入、结尾 0.5 秒淡出。

export interface NavChapter { index: string; label: string; start: number }
const props = defineProps<{ chapters: NavChapter[]; t: number; total: number; W: number }>()

const segs = computed(() => {
  const list = [...props.chapters].sort((a, b) => a.start - b.start)
  return list.map((c, i) => ({ ...c, end: list[i + 1]?.start ?? props.total }))
})
const activeIdx = computed(() => segs.value.findIndex((s) => props.t >= s.start && props.t < s.end))
const fill = (i: number) => {
  const s = segs.value[i]
  return i < activeIdx.value ? 1 : i === activeIdx.value ? progress(props.t, s.start, s.end) : 0
}
const style = computed(() => ({
  opacity: easeOutCubic(progress(props.t, 0, 0.5)) * (1 - easeInCubic(progress(props.t, props.total - 0.5, props.total))),
  width: `${props.W}px`,
}))
</script>

<template>
  <div class="nv" :style="style">
    <div class="nv-bg" />
    <div v-for="(s, i) in segs" :key="i" class="nv-seg" :class="{ on: i === activeIdx, past: activeIdx >= 0 && i < activeIdx }">
      <span v-if="s.index" class="nv-idx">{{ s.index }}</span>
      <span class="nv-label">{{ s.label }}</span>
      <i class="nv-line"><b :style="{ transform: `scaleX(${fill(i)})` }" /></i>
    </div>
  </div>
</template>

<style scoped>
.nv { position: absolute; left: 0; top: 0; height: 76px; display: flex; color: var(--fg); font-family: var(--font-cn); pointer-events: none; }
.nv-bg {
  position: absolute; inset: 0;
  background: linear-gradient(180deg, var(--shadow-c), transparent);
  border-bottom: 1px solid var(--line);
}
.nv-seg { position: relative; flex: 1; min-width: 0; display: flex; align-items: center; justify-content: center; gap: 12px; padding: 0 16px; }
.nv-idx { font-family: var(--font-mono); font-size: 22px; font-weight: 700; color: var(--mute); }
.nv-label { font-size: 28px; font-weight: 600; color: var(--mute); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.nv-seg.on .nv-idx, .nv-seg.on .nv-label { color: var(--accent); }
.nv-seg.on .nv-label { color: var(--fg); }
.nv-seg.past { opacity: 0.55; }
.nv-line { position: absolute; left: 10px; right: 10px; bottom: 0; height: 4px; background: var(--track); }
.nv-line b { position: absolute; inset: 0; background: var(--accent); transform-origin: left center; box-shadow: 0 0 10px var(--accent); }
.nv-seg + .nv-seg::before { content: ''; position: absolute; left: 0; top: 24px; bottom: 24px; width: 1px; background: var(--line); }
</style>
