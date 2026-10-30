<script setup lang="ts">
import { computed } from 'vue'
import { easeInOutCubic, easeOutCubic, progress } from './timeline'
import { useCardBase } from './cardBase'
import { useSceneBox } from './sceneBase'

// 「墨渗转场」：一滴墨落在落墨点，带须状毛边、快慢不匀地洇开吃掉整屏；盖满一小段（剪辑点藏在这里），再从同一点洇出一个洞把画面还回来。
// 阶段按总时长 T 的比例排（同色块扫屏，剪辑点放卡片正中）：落墨 0–8% / 洇开 4–45% / 全盖住 45–58%（中间一行字在这时出现）/ 洞洇开 58–100%。
// 毛边 = 圆形 + feTurbulence 噪声位移。噪声种子写死、位移量只由 t 算 —— 导出逐帧截图要和预览一致。
// 全盖住那一段**不挂滤镜**、直接铺一块实色：噪声位移有亚像素抖动，挂着的话盖满的那段画面边缘一直在微微动，读起来不像「停住了」。

export interface InkBleedData { from: string; ink: 'fg' | 'accent'; label: string; accent: string; scene: boolean; duration: number }
const props = defineProps<{ data: InkBleedData; t: number }>()
const emit = defineEmits<{ size: [{ w: number; h: number }] }>()
const { root, rootStyle } = useCardBase(props, emit, { exit: 'none', out: 0.01 })
const { w, h } = useSceneBox(root)

// 同一画面里可能有两张墨渗卡：滤镜 / 遮罩 id 必须各用各的，撞了的话第二张拿第一张的形状画（随机数只用在 id 上，不进画面）
const uid = `ink${Math.random().toString(36).slice(2, 9)}`

const T = computed(() => Math.max(0.8, props.data.duration))
const at = (f: number) => f * T.value
// 落墨点，占画面宽高的比例
const ORIGINS: Record<string, [number, number]> = { center: [0.5, 0.5], tl: [0.18, 0.22], tr: [0.82, 0.22], bl: [0.18, 0.78], br: [0.82, 0.78] }
const o = computed(() => ORIGINS[props.data.from] || ORIGINS.center)
const cx = computed(() => o.value[0] * w.value)
const cy = computed(() => o.value[1] * h.value)
// 毛边最多往外伸 DISP/2，所以要洇到最远那个角再多出这一截才算真的盖满
const DISP = 160
const rMax = computed(() => Math.hypot(Math.max(cx.value, w.value - cx.value), Math.max(cy.value, h.value - cy.value)) + DISP)

const inP = computed(() => progress(props.t, at(0.04), at(0.45)))
const outP = computed(() => progress(props.t, at(0.58), at(0.97)))
// 快慢不匀：匀速扩张读作普通光圈，这一点扰动就是「墨的脾气」；扰动在末段衰减到 0，保证正好洇满
const wobble = (p: number) => 1 + 0.08 * Math.sin(p * 19) * (1 - p)
// 先慢后快再收：前快后慢（out 曲线）的话不到四分之一就盖得差不多了，剩下大半段看不出墨在「走」
const rIn = computed(() => rMax.value * easeInOutCubic(inP.value) * wobble(inP.value))
const rOut = computed(() => rMax.value * easeInOutCubic(outP.value) * wobble(outP.value))
// 落墨：洇开之前先在落墨点落一个小墨点
const dot = computed(() => easeOutCubic(progress(props.t, 0, at(0.08))))
// 毛边随洇开越来越粗（墨走得越远边越乱）
const disp = computed(() => 60 + 100 * (props.t < at(0.5) ? inP.value : outP.value))

const phase = computed(() => (props.t < at(0.45) ? 'in' : props.t < at(0.58) ? 'full' : props.t < at(0.97) ? 'out' : 'done'))
const fill = computed(() => (props.data.ink === 'accent' ? 'var(--accent)' : 'var(--fg)'))
// 字压在墨上：正文色墨上用强调色，强调色墨上用压在强调色上的那个字色
const labelColor = computed(() => (props.data.ink === 'accent' ? 'var(--ink-on-accent)' : 'var(--accent)'))
const labelStyle = computed(() => {
  const a = easeOutCubic(progress(props.t, at(0.4), at(0.5)))
  const b = easeOutCubic(progress(props.t, at(0.58), at(0.64)))
  return { opacity: a * (1 - b), transform: `scale(${0.94 + 0.06 * a})`, color: labelColor.value }
})
</script>

<template>
  <div ref="root" class="ink" :style="rootStyle">
    <svg class="ink-svg" :viewBox="`0 0 ${w} ${h}`" :width="w" :height="h">
      <defs>
        <filter :id="`${uid}-f`" filterUnits="userSpaceOnUse" x="0" y="0" :width="w" :height="h">
          <feTurbulence type="fractalNoise" baseFrequency="0.02" numOctaves="3" seed="7" result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" :scale="disp" xChannelSelector="R" yChannelSelector="G" />
        </filter>
        <filter :id="`${uid}-halo`" filterUnits="userSpaceOnUse" x="0" y="0" :width="w" :height="h">
          <feGaussianBlur stdDeviation="28" />
        </filter>
        <!-- 出场的洞：白 = 墨还在，黑圆 = 洇开的洞 -->
        <mask :id="`${uid}-m1`" maskUnits="userSpaceOnUse" x="0" y="0" :width="w" :height="h">
          <rect :width="w" :height="h" fill="#fff" />
          <circle :cx="cx" :cy="cy" :r="rOut + 36" fill="#000" :filter="`url(#${uid}-f)`" />
        </mask>
        <mask :id="`${uid}-m2`" maskUnits="userSpaceOnUse" x="0" y="0" :width="w" :height="h">
          <rect :width="w" :height="h" fill="#fff" />
          <circle :cx="cx" :cy="cy" :r="rOut" fill="#000" :filter="`url(#${uid}-f)`" />
        </mask>
      </defs>

      <g v-if="phase === 'in'" :fill="fill">
        <circle v-if="inP === 0" :cx="cx" :cy="cy" :r="34 * dot" />
        <template v-else>
          <!-- 湿晕 / 外沿淡墨 / 内芯：三层叠出墨边，没有墨边的话读作普通光圈擦除 -->
          <circle :cx="cx" :cy="cy" :r="rIn + 110" opacity="0.12" :filter="`url(#${uid}-halo)`" />
          <g :filter="`url(#${uid}-f)`">
            <circle :cx="cx" :cy="cy" :r="rIn + 36" opacity="0.42" />
            <circle :cx="cx" :cy="cy" :r="Math.max(34 * dot, rIn)" />
          </g>
        </template>
      </g>
      <rect v-else-if="phase === 'full'" :width="w" :height="h" :fill="fill" />
      <g v-else-if="phase === 'out'" :fill="fill">
        <rect :width="w" :height="h" :mask="`url(#${uid}-m1)`" />
        <rect :width="w" :height="h" opacity="0.42" :mask="`url(#${uid}-m2)`" />
      </g>
    </svg>
    <div v-if="data.label" class="ink-label" :style="labelStyle">{{ data.label }}</div>
  </div>
</template>

<style scoped>
.ink { position: relative; width: var(--cw); height: var(--ch); overflow: hidden; pointer-events: none; font-family: var(--font-cn); }
.ink-svg { position: absolute; inset: 0; display: block; }
.ink-label {
  position: absolute; inset: 0; display: grid; place-items: center;
  font-size: 150px; font-weight: 900; white-space: nowrap; letter-spacing: 0.04em;
}
</style>
