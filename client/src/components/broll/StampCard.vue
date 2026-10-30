<script setup lang="ts">
import { computed } from 'vue'
import { easeInCubic, easeOutBack, easeOutCubic, focusIn, lerp, progress, pulse } from './timeline'
import { useCardSize } from './cardSize'
import './material.css'

// 「印章」卡：斜着的一枚章（粗外框 + 内圈虚线 + 半透明底），「啪」一下从放大状态砸下来，
// 落地那一刻一圈冲击波、几道火花、画面轻震，然后弹回原尺寸；下面可选一行拉开字距的小字。
// 本身就是个醒目的物件，不套底板。

export interface StampData {
  text: string
  sub: string
  tilt: string
  accent: string
  panel: boolean
  duration: number
}

const props = defineProps<{ data: StampData; t: number }>()
const emit = defineEmits<{ size: [{ w: number; h: number }] }>()
const root = useCardSize(emit)

const HIT = 0.32 // 砸到的时刻
const OUT = 0.45

const outP = computed(() => easeInCubic(progress(props.t, props.data.duration - OUT, props.data.duration)))
const rootStyle = computed(() => ({
  opacity: 1 - outP.value,
  filter: `blur(${outP.value * 8}px)`,
  ...(props.data.accent ? { '--accent': props.data.accent } : {}),
}))
const tilt = computed(() => Number(props.data.tilt) || 0)

// 砸下：HIT 之前从 2.4 倍快速缩到 0.9，之后弹回 1；落地后 0.3 秒内轻震
const stampStyle = computed(() => {
  const t = props.t
  const fall = progress(t, 0, HIT)
  const settle = progress(t, HIT, HIT + 0.45)
  const s = t < HIT ? lerp(2.4, 0.9, fall * fall) : lerp(0.9, 1, easeOutBack(settle))
  const shake = (1 - progress(t, HIT, HIT + 0.3)) * (t >= HIT ? 1 : 0)
  const dx = Math.sin(t * 90) * 6 * shake
  const dy = Math.cos(t * 77) * 4 * shake
  const out = outP.value
  return {
    opacity: Math.min(1, fall * 3),
    transform: `translate(${dx}px, ${dy}px) rotate(${tilt.value + lerp(-6, 0, Math.min(1, fall * 1.4))}deg) scale(${s * (1 - out * 0.15)})`,
    filter: t < HIT ? `blur(${lerp(14, 0, fall)}px)` : 'none',
    '--g': pulse(t, 2),
  }
})
// 冲击波：一圈外框从章的大小往外扩、变淡
const waveStyle = computed(() => {
  const p = progress(props.t, HIT, HIT + 0.55)
  return { opacity: p > 0 && p < 1 ? (1 - p) * 0.8 : 0, transform: `rotate(${tilt.value}deg) scale(${lerp(1, 1.45, easeOutCubic(p))})` }
})
// 火花：8 道短线从中心向外射
const SPARKS = Array.from({ length: 8 }, (_, i) => (i / 8) * Math.PI * 2 + 0.3)
const sparkStyle = (a: number) => {
  const p = progress(props.t, HIT, HIT + 0.4)
  const r = lerp(0.52, 0.85, easeOutCubic(p))
  return {
    opacity: p > 0 && p < 1 ? 1 - p : 0,
    transform: `translate(-50%, -50%) rotate(${a}rad) translateX(calc(var(--r) * ${r})) scaleX(${lerp(1, 0.2, p)})`,
  }
}
const subStyle = computed(() => {
  const s = focusIn(props.t, HIT + 0.3, 0.5, 18)
  const p = easeOutCubic(progress(props.t, HIT + 0.3, HIT + 0.8))
  return { ...s, letterSpacing: `${lerp(0.7, 0.35, p)}em` }
})
</script>

<template>
  <div ref="root" class="sp" :style="rootStyle">
    <div class="sp-wrap">
      <div class="sp-wave" :style="waveStyle" />
      <i v-for="(a, k) in SPARKS" :key="k" class="sp-spark" :style="sparkStyle(a)" />
      <div class="sp-stamp" :style="stampStyle">
        <div class="sp-inner"><span class="bx-hot">{{ data.text }}</span></div>
      </div>
    </div>
    <div v-if="data.sub" class="sp-sub" :style="subStyle">{{ data.sub }}</div>
  </div>
</template>

<style scoped>
.sp { position: relative; display: inline-flex; flex-direction: column; align-items: center; padding: 70px 90px 50px; color: var(--fg); font-family: var(--font-cn); }
.sp-wrap { position: relative; --r: 520px; }
.sp-stamp {
  position: relative; padding: 18px; border-radius: 46px;
  border: 12px solid var(--accent);
  background: color-mix(in srgb, var(--accent) 16%, var(--stamp-bg));
  box-shadow:
    0 0 calc(24px + var(--g, 0) * 30px) color-mix(in srgb, var(--accent) var(--glow-a, 45%), transparent),
    inset 0 0 30px color-mix(in srgb, var(--accent) 25%, transparent),
    0 24px 60px var(--shadow-c);
}
.sp-inner {
  padding: 26px 70px; border-radius: 30px; border: 6px dotted color-mix(in srgb, var(--accent) 85%, transparent);
  font-size: 190px; font-weight: 800; line-height: 1.05; white-space: nowrap; letter-spacing: 0.02em;
}
.sp-wave { position: absolute; inset: 0; border-radius: 46px; border: 8px solid var(--accent); pointer-events: none; }
.sp-spark {
  position: absolute; left: 50%; top: 50%; width: 70px; height: 8px; border-radius: 4px; background: var(--accent);
  box-shadow: 0 0 12px var(--accent); transform-origin: left center;
}
.sp-sub { margin-top: 40px; font-size: 56px; font-weight: 600; white-space: nowrap; text-shadow: var(--text-shadow); }
</style>
