<script setup lang="ts">
import { computed } from 'vue'
import { easeOutCubic, lerp, progress } from './timeline'
import { useCardBase } from './cardBase'
import { useSceneBox } from './sceneBase'

// 「关键词穿越」：一串关键词按黄金角铺在一个扁椭圆截面上，从远处沿纵深飞向镜头、擦身而过，循环不断；中间可以压一行标题。
// 每个词的相位均分（i / 槽位数），整段跑满 LOOPS 圈；透明度走 [0, 1, .5, .2, 0] 的生命曲线 —— 前段猛亮、中段压暗给标题让位、贴脸时淡掉。
// 透视全在 JS 里按 t 算（不用 CSS 3D + 动画），导出逐帧截图一致。词少于 18 个时重复填满槽位，不然画面太空。
// 透明底（默认）叠在口播上；整屏底色用主题的 --full-bg。

export interface FlyWordsData { words: string[]; title: string; bg: 'clear' | 'full'; accent: string; scene: boolean; duration: number }
const props = defineProps<{ data: FlyWordsData; t: number }>()
const emit = defineEmits<{ size: [{ w: number; h: number }] }>()
const { root, rootStyle } = useCardBase(props, emit, { exit: 'none' })
const { w, h } = useSceneBox(root)

const words = computed(() => (props.data.words || []).filter((s) => s?.trim()))
const SLOTS = computed(() => Math.max(18, words.value.length))
const LOOPS = 2
const F = 900, Z0 = -1750, Z1 = 760
const GOLD = 2.39996
const life = (u: number) => {
  const ks = [0, 1, 0.5, 0.2, 0]
  const x = u * 4, i = Math.min(3, Math.floor(x))
  return lerp(ks[i], ks[i + 1], x - i)
}
const items = computed(() => {
  const n = SLOTS.value, ws = words.value
  if (!ws.length) return []
  const T = Math.max(1, props.data.duration)
  const cx = w.value / 2, cy = h.value / 2
  // 椭圆截面：横向铺开、纵向压扁（竖屏时反过来按短边算，词不会全挤出画）
  const rx = w.value * 0.42, ry = Math.min(h.value * 0.36, rx * 0.62)
  const out = []
  for (let i = 0; i < n; i++) {
    const u = (((props.t / T) * LOOPS + i / n) % 1 + 1) % 1
    const z = lerp(Z0, Z1, u)
    const s = F / (F - z)
    const r = 0.35 + 0.65 * Math.sqrt((i + 0.5) / n)
    const a = i * GOLD
    const x = cx + Math.cos(a) * rx * r * s * 0.55
    const y = cy + Math.sin(a) * ry * r * s * 0.55
    const o = life(u)
    if (o <= 0.01 || s > 5.5) continue
    out.push({ key: i, text: ws[i % ws.length], hot: i % 5 === 0, style: {
      transform: `translate(${x}px, ${y}px) translate(-50%, -50%) scale(${s})`,
      opacity: o,
      filter: `blur(${Math.max(0, s - 2.2) * 2.2}px)`,
      zIndex: Math.round(s * 100),
    } })
  }
  return out
})
const layerStyle = computed(() => ({ opacity: easeOutCubic(progress(props.t, 0, 0.5)) }))
const titleStyle = computed(() => {
  const p = easeOutCubic(progress(props.t, 0.4, 1.0))
  return { opacity: p, filter: `blur(${lerp(12, 0, p)}px) drop-shadow(0 6px 24px var(--shadow-c))`, transform: `scale(${lerp(1.08, 1, p)})`, fontSize: `${Math.round(Math.min(w.value * 0.075, (w.value * 0.8) / Math.max(4, [...(props.data.title || '')].length)))}px` }
})
</script>

<template>
  <div ref="root" class="fw" :class="{ full: data.bg === 'full' }" :style="rootStyle">
    <div class="fw-layer" :style="layerStyle">
      <span v-for="it in items" :key="it.key" class="fw-word" :class="{ hot: it.hot }" :style="it.style">{{ it.text }}</span>
    </div>
    <div v-if="data.title" class="fw-title-wrap"><div class="fw-title" :style="titleStyle">{{ data.title }}</div></div>
  </div>
</template>

<style scoped>
.fw { position: relative; width: var(--cw); height: var(--ch); overflow: hidden; pointer-events: none; font-family: var(--font-cn); color: var(--fg); }
.fw.full { background: var(--full-bg); }
.fw-layer { position: absolute; inset: 0; }
.fw-word { position: absolute; left: 0; top: 0; font-size: 56px; font-weight: 700; white-space: nowrap; text-shadow: 0 2px 10px var(--shadow-c); }
.fw-word.hot { color: var(--accent); }
.fw-title-wrap { position: absolute; inset: 0; display: grid; place-items: center; z-index: 1000; }
.fw-title { font-weight: 900; white-space: nowrap; letter-spacing: 0.02em; }
</style>
