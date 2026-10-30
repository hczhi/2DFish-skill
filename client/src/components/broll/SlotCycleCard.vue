<script setup lang="ts">
import { computed, ref, watch, nextTick, onMounted } from 'vue'
import { easeInCubic, easeOutBack, easeOutCubic, lerp, progress, pulse } from './timeline'
import CardShell from './CardShell.vue'
import { useCardBase } from './cardBase'
import { cueAt } from './cues'

// 「词槽轮换」卡：句干固定在左边（「它能帮你」），句尾一个强调色胶囊每隔一会儿往上翻一格换一个短语，
// 胶囊宽度跟着词长变；换完之后胶囊上飞，结论落进同一个位置（全卡唯一一次过冲）。
// 用在「它能帮你 A / B / C」这种列举。句干、短语、结论都摘原话。
// 每个短语 / 结论可以单独定出现时间（data.cues）：cues[0..n-1] 是短语，cues[n] 是结论。

export interface SlotCycleData {
  label: string
  stem: string
  items: string[]
  conclusion: string
  cues?: (number | null)[]
  accent: string
  panel: boolean
  duration: number
}

const props = defineProps<{ data: SlotCycleData; t: number }>()
const emit = defineEmits<{ size: [{ w: number; h: number }] }>()
const { root, rootStyle, enter } = useCardBase(props, emit)

const SLOT_START = 0.6
const SLOT_STEP = 0.8
const FLIP = 0.27

const items = computed(() => props.data.items.filter((s) => s.trim()))
const itemAt = (i: number) => cueAt(props.data.cues, i, SLOT_START + i * SLOT_STEP)
const conclusionAt = computed(() => cueAt(props.data.cues, items.value.length, SLOT_START + items.value.length * SLOT_STEP))
const hasConclusion = computed(() => !!props.data.conclusion?.trim())

// 现在轮到第几个（-1 = 第一个还没出来）
const k = computed(() => {
  let r = -1
  items.value.forEach((_, i) => { if (props.t >= itemAt(i)) r = i })
  return r
})
const flipP = computed(() => (k.value < 0 ? 0 : easeOutCubic(progress(props.t, itemAt(k.value), itemAt(k.value) + FLIP))))

// 每个短语的宽度从隐藏占位里量（和字体、字号一致）；卡片自己的尺寸按最长那个撑，跳词时不忽大忽小
const ghosts = ref<HTMLElement[]>([])
const widths = ref<number[]>([])
const measure = () => { widths.value = ghosts.value.map((el) => el?.offsetWidth || 0) }
onMounted(measure)
watch(items, () => nextTick(measure))
const maxW = computed(() => Math.max(0, ...widths.value))
const capsuleW = computed(() => {
  if (k.value < 0) return widths.value[0] || maxW.value
  const cur = widths.value[k.value] || maxW.value
  const prev = k.value > 0 ? widths.value[k.value - 1] || maxW.value : cur
  return lerp(prev, cur, flipP.value)
})

const labelStyle = computed(() => {
  const p = easeOutCubic(progress(props.t, 0, 0.45))
  return { opacity: p, clipPath: `inset(0 ${100 - p * 100}% 0 0)` }
})
const stemStyle = computed(() => enter(props.t, 0.1))
// 胶囊：第一个短语出来时弹出，结论来的时候上飞淡出
const capsuleStyle = computed(() => {
  const inP = easeOutCubic(progress(props.t, itemAt(0) - 0.05, itemAt(0) + 0.3))
  const outP = hasConclusion.value ? easeInCubic(progress(props.t, conclusionAt.value, conclusionAt.value + 0.3)) : 0
  return {
    width: `${capsuleW.value}px`,
    opacity: inP * (1 - outP),
    transform: `translateY(${-120 * outP}px) scale(${lerp(0.7, 1, easeOutBack(inP))})`,
  }
})
const wordStyle = (i: number) => {
  if (i === k.value) return { transform: `translateY(${lerp(100, 0, flipP.value)}%)`, opacity: k.value === 0 ? 1 : flipP.value }
  if (i === k.value - 1) return { transform: `translateY(${lerp(0, -100, flipP.value)}%)`, opacity: 1 - flipP.value }
  return { opacity: 0 }
}
const conclusionStyle = computed(() => {
  const p = progress(props.t, conclusionAt.value + 0.12, conclusionAt.value + 0.62)
  return { opacity: easeOutCubic(p), transform: `translateY(${lerp(-90, 0, easeOutBack(p))}px)` }
})
</script>

<template>
  <div ref="root" class="sc" :style="rootStyle">
    <CardShell v-if="data.panel" :t="t" :duration="data.duration" />
    <div v-if="data.label" class="sc-label" :style="labelStyle"><i class="bx-dot" :style="{ '--pulse': pulse(t) }" />{{ data.label }}</div>
    <div class="sc-line">
      <span v-if="data.stem" class="sc-stem" :style="stemStyle">{{ data.stem }}</span>
      <span class="sc-slot">
        <!-- 占位：所有短语和结论叠在同一格，撑出最长的那个（尺寸按终值量） -->
        <span v-for="(w, i) in items" :key="`g${i}`" :ref="(el) => (ghosts[i] = el as HTMLElement)" class="sc-ghost sc-cap-pad">{{ w }}</span>
        <span v-if="hasConclusion" class="sc-ghost sc-conc-pad">{{ data.conclusion }}</span>
        <span class="sc-capsule" :style="capsuleStyle">
          <span v-for="(w, i) in items" :key="i" class="sc-word" :style="wordStyle(i)">{{ w }}</span>
        </span>
        <span v-if="hasConclusion" class="sc-conc bx-hot" :style="conclusionStyle">{{ data.conclusion }}</span>
      </span>
    </div>
  </div>
</template>

<style scoped>
.sc {
  position: relative; display: inline-block; padding: 48px 72px 52px 60px; box-sizing: border-box;
  color: var(--fg); font-family: var(--font-cn);
}
.sc-label {
  position: relative; display: flex; align-items: center; gap: 18px; margin-bottom: 22px; white-space: nowrap;
  font-family: var(--font-mono); font-size: 38px; font-weight: 600; letter-spacing: 0.3em; text-transform: uppercase; color: var(--accent);
}
.sc-line { position: relative; display: flex; align-items: center; gap: 28px; font-size: 92px; line-height: 1.25; white-space: nowrap; }
.sc-stem { font-weight: 700; }
.sc-slot { position: relative; display: grid; align-items: center; justify-items: start; }
.sc-slot > * { grid-area: 1 / 1; }
.sc-ghost { visibility: hidden; font-weight: 800; }
.sc-cap-pad { padding: 0 0.42em; }
.sc-conc-pad { padding: 0 0.1em; }
.sc-capsule {
  position: relative; height: 1.4em; border-radius: 0.3em; overflow: hidden; box-sizing: border-box;
  background: var(--accent); color: var(--ink-on-accent); font-weight: 800;
  box-shadow: 0 18px 40px -16px var(--shadow-c), 0 0 40px color-mix(in srgb, var(--accent) var(--glow-a), transparent);
}
.sc-word { position: absolute; left: 0; right: 0; top: 0; bottom: 0; display: flex; align-items: center; justify-content: center; }
.sc-conc { font-weight: 800; padding: 0 0.1em; }
</style>
