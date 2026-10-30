<script setup lang="ts">
import { computed } from 'vue'
import { easeInCubic, easeOutBack, easeOutCubic, lerp, progress } from './timeline'
import { useCardBase } from './cardBase'
import CardShell from './CardShell.vue'
import { hash } from './rows'
import { CL_BOIL, CL_IN, CL_SUCK, clBoilAt, clWordAt } from './collapseTimes'

// 「一句话坍缩成一个词」：整句先在，读完之后字开始沸腾（越抖越厉害）、外面套上一个虚线选区框（「正在选中提取」），
// 然后整句碎成颗粒、颗粒加速吸向中心，凝成一个更大更亮的词 —— 读出来是「这一切归结为它」。
// 例：「说白了做内容拼到最后拼的就是」→「真诚」。两处都摘原话。颗粒位置用固定种子的 hash，不用 Math.random。

export interface CollapseData { sentence: string; word: string; accent: string; panel: boolean; duration: number }
const props = defineProps<{ data: CollapseData; t: number }>()
const emit = defineEmits<{ size: [{ w: number; h: number }] }>()
const { root, rootStyle, enter } = useCardBase(props, emit)

const FS = 80
const chars = computed(() => [...(props.data.sentence || '')])
// 卡片尺寸按整句和那个词里宽的那个定（尺寸按终值量，不随动画变）
const SW = computed(() => Math.max(4, chars.value.length) * FS)
const W = computed(() => Math.max(1000, SW.value + 200, [...(props.data.word || '')].length * 230 + 200))
const H = 460

const boilAt = computed(() => clBoilAt(props.data))
const suckAt = computed(() => boilAt.value + CL_BOIL)
const wordAt = computed(() => clWordAt(props.data))
const boil = computed(() => progress(props.t, boilAt.value, suckAt.value))
const gone = computed(() => easeOutCubic(progress(props.t, suckAt.value, suckAt.value + 0.2)))
const sentenceStyle = computed(() => ({ ...enter(props.t, CL_IN, 0.5), width: `${SW.value}px` }))
const charStyle = (i: number) => {
  const a = boil.value * boil.value * 9
  const ph = props.t * 38 + i * 1.7
  return { transform: `translate(${Math.sin(ph) * a * (hash(i, 3) - 0.3)}px, ${Math.cos(ph * 1.3) * a * (hash(i, 4) - 0.3)}px)`, opacity: 1 - gone.value }
}
const boxStyle = computed(() => {
  const p = easeOutCubic(progress(props.t, boilAt.value, boilAt.value + 0.25))
  const o = 1 - progress(props.t, suckAt.value + 0.1, suckAt.value + 0.35)
  return { width: `${SW.value + 60}px`, opacity: p * o, transform: `translate(-50%, -50%) scale(${lerp(1.08, 1, p)})`, backgroundPositionX: `${props.t * 60}px` }
})

const N = 90
const sucking = computed(() => easeInCubic(progress(props.t, suckAt.value, suckAt.value + CL_SUCK)))
const parts = computed(() => {
  if (props.t < suckAt.value || props.t > wordAt.value + 0.4) return []
  const fade = 1 - progress(props.t, wordAt.value, wordAt.value + 0.35)
  return Array.from({ length: N }, (_, k) => {
    const x0 = (hash(k, 1) - 0.5) * SW.value, y0 = (hash(k, 2) - 0.5) * FS
    // 被吸进去的时候带一点旋涡：越靠近中心转得越多
    const ang = sucking.value * (1.2 + hash(k, 5)) * (hash(k, 6) < 0.5 ? 1 : -1)
    const r = 1 - sucking.value
    const x = (x0 * Math.cos(ang) - y0 * Math.sin(ang)) * r, y = (x0 * Math.sin(ang) + y0 * Math.cos(ang)) * r
    const s = 4 + hash(k, 7) * 8
    return { left: `${W.value / 2 + x - s / 2}px`, top: `${H / 2 + y - s / 2}px`, width: `${s}px`, height: `${s}px`, opacity: Math.min(1, gone.value * 1.5) * fade, hot: hash(k, 8) < 0.55 }
  })
})
const wordStyle = computed(() => {
  const p = progress(props.t, wordAt.value, wordAt.value + 0.45)
  const flash = Math.sin(progress(props.t, wordAt.value, wordAt.value + 0.6) * Math.PI)
  return { opacity: easeOutCubic(Math.min(1, p * 2)), transform: `translate(-50%, -50%) scale(${lerp(0.4, 1, easeOutBack(p))})`, filter: `drop-shadow(0 0 ${10 + 50 * flash}px var(--accent))` }
})
</script>

<template>
  <div ref="root" class="cl" :style="[rootStyle, { width: `${W}px`, height: `${H}px` }]">
    <CardShell v-if="data.panel" :t="t" :duration="data.duration" />
    <div class="cl-box" :style="boxStyle" />
    <div class="cl-center">
      <div class="cl-sentence" :style="sentenceStyle">
        <span v-for="(ch, i) in chars" :key="i" class="cl-ch" :style="charStyle(i)">{{ ch }}</span>
      </div>
    </div>
    <i v-for="(p, k) in parts" :key="k" class="cl-p" :class="{ hot: p.hot }" :style="p" />
    <div class="cl-word bx-hot" :style="wordStyle">{{ data.word }}</div>
  </div>
</template>

<style scoped>
.cl { position: relative; font-family: var(--font-cn); color: var(--fg); }
.cl-center { position: absolute; inset: 0; display: grid; place-items: center; }
.cl-sentence { display: flex; justify-content: center; font-size: 80px; font-weight: 700; white-space: nowrap; line-height: 1; }
.cl-ch { display: inline-block; white-space: pre; }
.cl-box {
  position: absolute; left: 50%; top: 50%; height: 140px; box-sizing: border-box;
  border: 3px dashed var(--accent);
  background: repeating-linear-gradient(135deg, color-mix(in srgb, var(--accent) 16%, transparent) 0 10px, transparent 10px 22px);
}
.cl-p { position: absolute; border-radius: 50%; background: var(--fg); }
.cl-p.hot { background: var(--accent); box-shadow: 0 0 10px var(--accent); }
.cl-word { position: absolute; left: 50%; top: 50%; font-size: 220px; font-weight: 900; white-space: nowrap; line-height: 1; }
</style>
