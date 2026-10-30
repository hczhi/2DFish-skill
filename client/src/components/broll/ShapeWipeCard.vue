<script setup lang="ts">
import { computed } from 'vue'
import { easeInOutCubic, easeOutCubic, progress } from './timeline'
import { useCardBase } from './cardBase'
import { useSceneBox } from './sceneBase'

// 「色块扫屏」转场：两三层同色系色块错峰从同一个方向扫过整屏，中间有一段整屏全被盖住 —— 剪辑点藏在这段里，观众看不见切换的那一下。
// 阶段按总时长 T 的比例排（拉长 = 整体放慢）：进场 0–45%（从底层到顶层依次扫进来）/ 全盖住 45–58%（中间一行字在这时出现）/
// 出场 58–100%（顶层先走，接着往同一个方向扫出去）。剪辑点放在卡片正中间（templates.ts 的 summary 会提示）。
// 色块是不透明的实色：颜色从主题强调色和 --ink-on-accent 里调出来，不写死暗色。

export interface ShapeWipeData { dir: 'right' | 'left' | 'down' | 'up'; layers: string; label: string; accent: string; scene: boolean; duration: number }
const props = defineProps<{ data: ShapeWipeData; t: number }>()
const emit = defineEmits<{ size: [{ w: number; h: number }] }>()
const { root, rootStyle } = useCardBase(props, emit, { exit: 'none', out: 0.01 })
const { w, h } = useSceneBox(root)

const T = computed(() => Math.max(0.6, props.data.duration))
const at = (f: number) => f * T.value
const L = computed(() => (props.data.layers === '2' ? 2 : 3))
const horiz = computed(() => props.data.dir === 'right' || props.data.dir === 'left')
const sign = computed(() => (props.data.dir === 'right' || props.data.dir === 'down' ? 1 : -1))
// 每层比画面长 30%，斜着的那条边落在多出来的那段里
const SPAN = 1.3
// 和 --ink-on-accent 调：它是主题里压在强调色上的那个纯色（暗主题深、纸感浅），调出来是同色系的深一档 / 浅一档。
// 不能拿 --full-bg / --tile / --panel 调 —— 那几个是渐变，color-mix 认不了，整层背景直接失效、只剩顶层一种颜色，也不报错
const COLORS = [
  'color-mix(in srgb, var(--accent) 40%, var(--ink-on-accent))',
  'color-mix(in srgb, var(--accent) 70%, var(--ink-on-accent))',
  'var(--accent)',
]
const layerColors = computed(() => (L.value === 2 ? [COLORS[1], COLORS[2]] : COLORS))

// 第 k 层（0 = 最底下、最先进来）：进场从画外到盖满，出场继续往同一方向走（顶层先走）
const pos = (k: number) => {
  const n = L.value
  const inP = easeInOutCubic(progress(props.t, at(0.04 + k * 0.08), at(0.3 + k * 0.075)))
  const outP = easeInOutCubic(progress(props.t, at(0.58 + (n - 1 - k) * 0.07), at(0.84 + (n - 1 - k) * 0.06)))
  // 以画面宽 / 高为单位：-SPAN（完全在画外）→ 0（盖满，斜边那一头伸在画外）→ +1（从另一边出去）
  return outP > 0 ? outP : -SPAN + SPAN * inP
}
const layerStyle = (k: number) => {
  const p = pos(k) * sign.value
  const len = (horiz.value ? w.value : h.value) * SPAN
  // 斜边：进场方向那一头斜切 12%
  const clip = horiz.value
    ? sign.value > 0 ? 'polygon(0 0, 100% 0, 88% 100%, 0 100%)' : 'polygon(12% 0, 100% 0, 100% 100%, 0 100%)'
    : sign.value > 0 ? 'polygon(0 0, 100% 0, 100% 88%, 0 100%)' : 'polygon(0 12%, 100% 0, 100% 100%, 0 100%)'
  const off = sign.value > 0 ? 0 : -(SPAN - 1) // 反方向时让斜边那一头朝外
  return {
    width: horiz.value ? `${len}px` : '100%',
    height: horiz.value ? '100%' : `${len}px`,
    transform: horiz.value ? `translateX(${(p + off) * w.value}px)` : `translateY(${(p + off) * h.value}px)`,
    background: layerColors.value[k],
    clipPath: clip,
  }
}
const labelStyle = computed(() => {
  const a = easeOutCubic(progress(props.t, at(0.38), at(0.48)))
  const b = easeOutCubic(progress(props.t, at(0.58), at(0.66)))
  return { opacity: a * (1 - b), transform: `scale(${0.92 + 0.08 * a})` }
})
</script>

<template>
  <div ref="root" class="sw" :style="rootStyle">
    <div v-for="k in L" :key="k" class="sw-layer" :style="layerStyle(k - 1)" />
    <div v-if="data.label" class="sw-label" :style="labelStyle">{{ data.label }}</div>
  </div>
</template>

<style scoped>
.sw { position: relative; width: var(--cw); height: var(--ch); overflow: hidden; pointer-events: none; font-family: var(--font-cn); }
.sw-layer { position: absolute; left: 0; top: 0; }
.sw-label {
  position: absolute; inset: 0; display: grid; place-items: center;
  font-size: 150px; font-weight: 900; color: var(--ink-on-accent); white-space: nowrap; letter-spacing: 0.04em;
}
</style>
