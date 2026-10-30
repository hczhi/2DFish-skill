<script setup lang="ts">
import { computed } from 'vue'
import { easeOutCubic, lerp, progress } from './timeline'
import { useCardBase } from './cardBase'
import CardShell from './CardShell.vue'

// 「倒计时」卡：「还剩 3 天」「只有 5 个名额」—— 翻页钟样式，数字从 value+3 往下翻到 value（每一下翻页有上下两半的折叠），
// 翻到最后一下停住、强调色闪一下。value 必须是整数，不是的话不翻、原样显示。
export interface CountdownData { lead: string; value: string; unit: string; accent: string; panel: boolean; duration: number }
const props = defineProps<{ data: CountdownData; t: number }>()
const emit = defineEmits<{ size: [{ w: number; h: number }] }>()
const { root, rootStyle } = useCardBase(props, emit)

const FLIPS = 3
const AT = 0.5
const STEP = 0.32
const target = computed(() => (/^\d+$/.test(String(props.data.value).trim()) ? Number(props.data.value) : null))
// 第 k 次翻页：从 target+FLIPS-k 翻到 target+FLIPS-k-1
const k = computed(() => Math.max(0, Math.min(FLIPS, Math.floor((props.t - AT) / STEP) + 1)))
const cur = computed(() => (target.value === null ? props.data.value : String(target.value + FLIPS - k.value)))
const prev = computed(() => (target.value === null ? props.data.value : String(target.value + FLIPS - k.value + 1)))
const flipP = computed(() => (k.value === 0 || target.value === null ? 1 : progress(props.t, AT + (k.value - 1) * STEP, AT + (k.value - 1) * STEP + STEP * 0.8)))
// 上半张翻下来：前半段旧数字的上半往下折，后半段新数字的下半展开
const topFold = computed(() => ({ transform: `rotateX(${-Math.min(90, flipP.value * 180)}deg)` }))
const botFold = computed(() => ({ transform: `rotateX(${Math.max(0, 90 - (flipP.value - 0.5) * 180)}deg)`, opacity: flipP.value >= 0.5 ? 1 : 0 }))
const done = computed(() => k.value >= FLIPS && flipP.value >= 1)
const flash = computed(() => (done.value ? 1 - progress(props.t, AT + FLIPS * STEP, AT + FLIPS * STEP + 0.6) : 0))
const inStyle = computed(() => {
  const p = easeOutCubic(progress(props.t, 0, 0.4))
  return { opacity: p, transform: `translateY(${lerp(30, 0, p)}px)` }
})
</script>

<template>
  <div ref="root" class="cd" :style="rootStyle">
    <CardShell v-if="data.panel" :t="t" :duration="data.duration" />
    <div class="cd-row" :style="inStyle">
      <span v-if="data.lead" class="cd-lead">{{ data.lead }}</span>
      <div class="cd-clock" :class="{ done }" :style="{ '--flash': flash }">
        <div class="cd-half top"><span>{{ cur }}</span></div>
        <div class="cd-half bot"><span>{{ flipP < 0.5 ? prev : cur }}</span></div>
        <div v-if="flipP < 0.5" class="cd-half top fold" :style="topFold"><span>{{ prev }}</span></div>
        <div v-else class="cd-half bot fold" :style="botFold"><span>{{ cur }}</span></div>
        <i class="cd-seam" />
      </div>
      <span v-if="data.unit" class="cd-unit">{{ data.unit }}</span>
    </div>
  </div>
</template>

<style scoped>
.cd { position: relative; display: inline-block; padding: 50px 80px 54px 60px; box-sizing: border-box; color: var(--fg); font-family: var(--font-cn); }
.cd-row { position: relative; display: flex; align-items: center; gap: 36px; }
.cd-lead, .cd-unit { font-size: 80px; font-weight: 700; white-space: nowrap; }
.cd-unit { color: var(--accent); }
.cd-clock {
  position: relative; width: 300px; height: 300px; perspective: 900px; font-family: var(--font-mono); font-size: 230px; font-weight: 800;
  filter: drop-shadow(0 0 calc(var(--flash, 0) * 40px) var(--accent));
}
.cd-half { position: absolute; left: 0; right: 0; height: 50%; overflow: hidden; background: var(--tile); box-shadow: inset 0 0 0 2px var(--track); backface-visibility: hidden; }
.cd-half span { position: absolute; left: 0; right: 0; height: 300px; line-height: 300px; text-align: center; }
.cd-half.top { top: 0; border-radius: 26px 26px 0 0; transform-origin: bottom center; }
.cd-half.bot { bottom: 0; border-radius: 0 0 26px 26px; transform-origin: top center; }
.cd-half.bot span { top: -150px; }
.cd-clock.done .cd-half span { color: var(--accent); }
.cd-seam { position: absolute; left: 0; right: 0; top: 50%; height: 4px; margin-top: -2px; background: var(--shadow-c); }
</style>
