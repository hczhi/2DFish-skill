<script setup lang="ts">
import { computed } from 'vue'
import { easeInCubic, easeInOutCubic, easeOutCubic, lerp, progress } from './timeline'
import { useCardBase } from './cardBase'
import { useSceneBox } from './sceneBase'
import { TURN_A_IN, TURN_FLIP, TURN_TEXT_IN, turnAt, turnBIn } from './turnTimes'

// 「叙事转折」：整屏场景。前一句压在反色底上（主题正文色当底），底部升起一团强调色柔光；
// 翻色那一拍底色在 0.36 秒里压回主题底、柔光压扁成一道余晖，前一句糊掉退场，留一小段空白后一句才对焦出来 ——
// 不做交叉淡化：两句叠在一起的那几帧读起来像字幕串了。
// 例：「多年以来大家都以为流量最重要」→「但真正留下来的是信任」。两句都摘原话。
// 底色只拿 --fg / --full-bg 翻（两种主题下正好一深一浅），柔光由 --accent 推出来，不写死颜色。
// 透明底（bg = 'clear'，默认）：没有底色可翻，转折靠「柔光压成余晖 + 后一句换成强调色」读出来；字后面垫一层淡暗晕，压在口播画面上也读得清。

export interface TurnData { before: string; after: string; bg: 'clear' | 'full'; cues?: (number | null)[]; accent: string; scene: boolean; duration: number }
const props = defineProps<{ data: TurnData; t: number }>()
const emit = defineEmits<{ size: [{ w: number; h: number }] }>()
const { root, rootStyle } = useCardBase(props, emit, { exit: 'none' })
const { w, h } = useSceneBox(root)

const clear = computed(() => props.data.bg !== 'full')
const flipAt = computed(() => turnAt(props.data))
const bAt = computed(() => turnBIn(props.data))
const flipP = computed(() => easeInOutCubic(progress(props.t, flipAt.value, flipAt.value + TURN_FLIP)))
const topBg = computed(() => ({ opacity: 1 - flipP.value }))

// 字号按两句里长的那句算，整句一行放得下；竖屏也不换行（换行的话前后两句排法不同，翻的那一下字的位置会跳）
const fontSize = computed(() => {
  const n = Math.max(4, [...(props.data.before || '')].length, [...(props.data.after || '')].length)
  return Math.round(Math.min(w.value * 0.07, (w.value * 0.84) / n))
})

// 透明底时字的阴影并进同一条 filter：写在 class 上会被内联的 blur() 整条盖掉，阴影悄悄没了
const shadow = computed(() => (clear.value ? ' drop-shadow(0 4px 18px var(--shadow-c))' : ''))
const blurIn = (a: number) => {
  const p = easeOutCubic(progress(props.t, a, a + TURN_TEXT_IN))
  return { opacity: p, filter: `blur(${lerp(14, 0, p)}px)${shadow.value}`, transform: `translateY(${lerp(18, 0, p)}px)` }
}
const aStyle = computed(() => {
  const o = easeInCubic(progress(props.t, flipAt.value - 0.25, flipAt.value + 0.05))
  const i = blurIn(TURN_A_IN)
  return { ...i, opacity: i.opacity * (1 - o), filter: `blur(${lerp(14, 0, i.opacity) + o * 16}px)${shadow.value}`, transform: `translateY(${lerp(18, 0, i.opacity) - o * 14}px)` }
})
const bStyle = computed(() => blurIn(bAt.value))

// 柔光：前半段从底边升起、缓慢呼吸；翻色时压扁成贴着底边的一道余晖
const rise = computed(() => easeOutCubic(progress(props.t, 0, 1.6)))
const blob = (k: number) => {
  const size = w.value * (k ? 0.55 : 0.75)
  const drift = Math.sin(props.t * 0.8 + k * 2.1) * w.value * 0.03
  const y = lerp(h.value * 0.98, h.value * (k ? 0.66 : 0.6), rise.value)
  const yAfter = h.value * 0.98
  const cx = w.value * (k ? 0.62 : 0.42) + drift
  const cy = lerp(y, yAfter, flipP.value)
  return {
    width: `${size}px`, height: `${size}px`,
    transform: `translate(${cx - size / 2}px, ${cy - size / 2}px) scale(${lerp(1, 1.5, flipP.value)}, ${lerp(1, 0.32, flipP.value)})`,
    // 透明底下柔光压低：压满的话口播画面下半截整个被染成强调色
    opacity: lerp(0.9, 0.5, flipP.value) * rise.value * (clear.value ? 0.6 : 1),
  }
}
</script>

<template>
  <div ref="root" class="tn" :style="rootStyle">
    <template v-if="!clear">
      <div class="tn-bg tn-bg-base" />
      <div class="tn-bg tn-bg-top" :style="topBg" />
    </template>
    <div v-else class="tn-bg tn-scrim" :style="{ opacity: rise }" />
    <div v-for="k in 2" :key="k" class="tn-blob" :class="`k${k}`" :style="blob(k - 1)" />
    <div class="tn-line tn-a" :class="{ clear }" :style="{ ...aStyle, fontSize: `${fontSize}px` }">{{ data.before }}</div>
    <div class="tn-line tn-b" :class="{ clear }" :style="{ ...bStyle, fontSize: `${fontSize}px` }"><span :class="{ 'bx-hot': clear }">{{ data.after }}</span></div>
  </div>
</template>

<style scoped>
.tn { position: relative; width: var(--cw); height: var(--ch); overflow: hidden; pointer-events: none; font-family: var(--font-cn); }
.tn-bg { position: absolute; inset: 0; }
.tn-bg-base { background: var(--full-bg); }
.tn-bg-top { background: var(--fg); }
.tn-blob { position: absolute; left: 0; top: 0; border-radius: 50%; filter: blur(60px); transform-origin: center; }
.tn-blob.k1 { background: radial-gradient(circle, var(--accent) 0%, color-mix(in srgb, var(--accent) 40%, transparent) 45%, transparent 70%); }
.tn-blob.k2 { background: radial-gradient(circle, color-mix(in srgb, var(--accent) 60%, var(--fg)) 0%, transparent 68%); }
.tn-line {
  position: absolute; left: 0; right: 0; top: 50%; margin-top: -0.65em; text-align: center;
  font-weight: 800; line-height: 1.3; white-space: nowrap; letter-spacing: 0.02em;
}
.tn-a { color: var(--ink-on-accent); }
.tn-b { color: var(--fg); }
/* 透明底：前一句正文色、后一句强调色渐变（.bx-hot 不能叠 text-shadow，阴影走 filter 里的 drop-shadow） */
.tn-scrim { background: radial-gradient(ellipse 62% 34% at 50% 50%, var(--shadow-c), transparent 72%); }
.tn-a.clear { color: var(--fg); }
</style>
