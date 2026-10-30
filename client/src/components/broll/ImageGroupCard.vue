<script setup lang="ts">
import { computed } from 'vue'
import { easeInCubic, easeInOutCubic, easeOutBack, easeOutCubic, focusIn, lerp, progress, pulse, stagger } from './timeline'
import { useCardSize } from './cardSize'
import CardShell from './CardShell.vue'
import { useThemeMotion } from './themeContext'
import { cueAt } from './cues'
import { FAN_PILE, FAN_AT, FAN_FLAT, FAN_END } from './fanTimes'

// 「图片组」卡：一行小字 + 大标题（左边一条强调竖线，可选一个图标框）+ 2–5 个图片位依次弹出，
// 每个下面一个名字胶囊，可选右上角打 ✓。图片是用户上传的（地址在服务器上，导出才读得到）。
// 缺图的位置画成虚线「待上传」，不画成一块空白 —— 空白读起来像本来就这样设计的。
// 排法：row 横排方块 / stack 横版卡片错落叠放（同一水平面上左右错开、互相压住一部分，每张带一点倾斜）。
// 入场：pop 依次弹出 / drop 依次从上方落下（重力加速、落地压扁回弹、地上一团阴影由小变大）/
// fan 卡堆扇开（先叠成一叠，扇开 ±24°、弧心在下方，停一拍，再铺平成一排 —— 「这一叠」变成「这几个」；总按错落叠放的排法画，整叠一起动、不认逐张时间）。
// 可选源头卡（sourceName / sourceImg）：上方一张「原版」，左边一条虚线画过来，表示「一张原版 → 批量出」。
// 每张图可以单独定出现时间（data.cues[i] = 第 i 个图片位开始弹出 / 开始落下的时刻，空位也算一个）。

export interface ImageItem { img: string; name: string }
export interface ImageGroupData {
  headerImg: string
  kicker: string
  title: string
  items: ImageItem[]
  check: boolean
  layout: 'row' | 'stack'
  entrance: 'pop' | 'drop' | 'fan'
  sourceImg: string
  sourceName: string
  cues?: (number | null)[]
  accent: string
  panel: boolean
  duration: number
}

const props = defineProps<{ data: ImageGroupData; t: number }>()
const emit = defineEmits<{ size: [{ w: number; h: number }] }>()
const root = useCardSize(emit)

const FALL = 0.45 // 落下用时
const STACK_DX = 250
const ROT = [-3, 2.5, -2, 3, -1.5]

const hasSource = computed(() => !!(props.data.sourceName || props.data.sourceImg))
const hasHead = computed(() => !!(props.data.title || props.data.kicker || props.data.headerImg))
const ITEM_AT = computed(() => (hasSource.value ? 1.0 : 0.6))
const ITEM_STEP = computed(() => (props.data.entrance === 'drop' ? 0.38 : 0.28))
const arrive = (i: number) => cueAt(props.data.cues, i, ITEM_AT.value + i * ITEM_STEP.value)

const OUT = 0.5
const outP = computed(() => easeInCubic(progress(props.t, props.data.duration - OUT, props.data.duration)))
const rootStyle = computed(() => ({
  // 有底板时「依次落下」只在底板范围里落（从底板上边缘掉进来），不在底板外面露出来；
  // inset 留几像素给四角刻度
  ...(props.data.panel && props.data.entrance === 'drop' ? { clipPath: 'inset(-6px round 16px)' } : {}),
  opacity: 1 - outP.value,
  filter: `blur(${outP.value * 8}px)`,
  transform: `translateY(${-30 * outP.value}px)`,
  ...(props.data.accent ? { '--accent': props.data.accent } : {}),
}))

const items = computed(() => props.data.items || [])
const { enter } = useThemeMotion()
const headerStyle = computed(() => enter(props.t, 0.1, 0.5))
const kickerStyle = computed(() => {
  const p = easeOutCubic(progress(props.t, 0.05, 0.5))
  return { opacity: p, letterSpacing: `${lerp(0.6, 0.3, p)}em` }
})
const barStyle = computed(() => ({ transform: `scaleY(${easeOutCubic(progress(props.t, 0, 0.5))})` }))
const iconStyle = computed(() => {
  const p = progress(props.t, 0, 0.5)
  return { opacity: easeOutCubic(p), transform: `scale(${lerp(0.6, 1, easeOutBack(p))}) rotate(${lerp(-8, 0, easeOutCubic(p))}deg)` }
})
const rot = (i: number) => (props.data.layout === 'stack' || props.data.entrance === 'fan' ? ROT[i % ROT.length] : 0)
// 停住时上下轻浮（每个错开相位，不整齐划一）
const bob = (i: number, settled: number) => Math.sin(props.t * 1.6 + i * 1.3) * 6 * settled

// 依次弹出
function popStyle(i: number) {
  const p = progress(props.t, arrive(i), arrive(i) + 0.5)
  return {
    opacity: easeOutCubic(p),
    transform: `translateY(${lerp(40, 0, easeOutCubic(p)) + bob(i, easeOutCubic(p))}px) scale(${lerp(0.6, 1, easeOutBack(p))}) rotate(${rot(i)}deg)`,
    filter: `blur(${lerp(10, 0, easeOutCubic(p))}px)`,
  }
}
// 依次落下：前半段按重力加速（p²），落地后压扁一下、回弹两次衰减掉
function dropStyle(i: number) {
  const a = arrive(i)
  const p = progress(props.t, a, a + FALL)
  const b = progress(props.t, a + FALL, a + FALL + 0.55)
  const y = lerp(-440, 0, p * p) - Math.abs(Math.sin(b * Math.PI * 2)) * 34 * (1 - b) * (1 - b)
  const squash = b > 0 && b < 1 ? Math.sin(Math.min(1, b * 4) * Math.PI) * 0.07 * (1 - b) : 0
  const r = lerp(rot(i) + (i % 2 ? 14 : -14), rot(i), easeOutCubic(p))
  return {
    opacity: Math.min(1, p * 4),
    transform: `translateY(${y + bob(i, b)}px) rotate(${r}deg) scale(${1 + squash}, ${1 - squash})`,
    transformOrigin: 'center bottom',
  }
}
// 卡堆扇开：每张都先挪到中间那一叠的位置（相对自己的最终槽位平移），绕下方很远的一点转开，再平移回槽位
const fan = computed(() => props.data.entrance === 'fan')
function fanStyle(i: number) {
  const n = items.value.length, c = (n - 1) / 2
  const appear = easeOutCubic(progress(props.t, FAN_PILE + i * 0.05, FAN_PILE + i * 0.05 + 0.35))
  const spread = easeInOutCubic(progress(props.t, FAN_AT, FAN_AT + 0.7))
  const flat = easeInOutCubic(progress(props.t, FAN_FLAT, FAN_END))
  const ang = n > 1 ? ((i - c) / c) * 24 : 0
  const pile = (c - i) * STACK_DX
  // 叠着的时候每张错一点角度，读得出「是一叠」
  const pileRot = (i - c) * 1.5
  return {
    opacity: appear,
    transform: `translateX(${lerp(pile, 0, flat)}px) translateY(${lerp(30, 0, appear)}px) rotate(${lerp(lerp(pileRot, ang, spread), rot(i), flat)}deg)`,
    transformOrigin: '50% 260%',
  }
}
const itemStyle = (i: number) => (fan.value ? fanStyle(i) : props.data.entrance === 'drop' ? dropStyle(i) : popStyle(i))
// 落地阴影：越接近地面越深、越大
const shadowStyle = (i: number) => {
  if (props.data.entrance !== 'drop') return { opacity: 0 }
  const p = progress(props.t, arrive(i), arrive(i) + FALL)
  return { opacity: p * p * 0.55, transform: `scale(${lerp(0.3, 1, p * p)})` }
}
const pillStyle = (i: number) => focusIn(props.t, arrive(i) + (props.data.entrance === 'drop' ? FALL : 0.15), 0.4, 16)
const checkStyle = (i: number) => {
  const a = fan.value ? FAN_END + i * 0.1 : arrive(i) + (props.data.entrance === 'drop' ? FALL + 0.15 : 0.35)
  const p = progress(props.t, a, a + 0.35)
  return { opacity: easeOutCubic(p), transform: `scale(${lerp(0, 1, easeOutBack(p))})` }
}
// 叠放时每张的位置：都落在同一水平面上，左右错开、互相压住一部分（作者要求，不做台阶式上下错位）
const stackPos = (i: number) => ({ left: `${i * STACK_DX}px`, top: '0px' })
const stackSize = computed(() => ({
  width: `${380 + Math.max(0, items.value.length - 1) * STACK_DX + 30}px`,
  height: '360px',
}))
// 源头卡：虚线先画过来，卡再弹出
const lineStyle = computed(() => ({ transform: `scaleX(${easeOutCubic(progress(props.t, 0.15, 0.6))})` }))
const sourceStyle = computed(() => {
  const p = progress(props.t, 0.45, 0.9)
  return { opacity: easeOutCubic(p), transform: `scale(${lerp(0.6, 1, easeOutBack(p))})` }
})
const glow = computed(() => pulse(props.t, 1.8))
</script>

<template>
  <div ref="root" class="ig" :style="rootStyle">
    <CardShell v-if="data.panel" :t="t" :duration="data.duration" />
    <div v-if="hasHead" class="ig-head">
      <div class="ig-bar bx-glow-box" :style="barStyle" />
      <div v-if="data.headerImg" class="ig-icon" :style="iconStyle"><img :src="data.headerImg" alt="" /></div>
      <div class="ig-titles" :style="headerStyle">
        <div v-if="data.kicker" class="ig-kicker" :style="kickerStyle">{{ data.kicker }}</div>
        <div v-if="data.title" class="ig-title">{{ data.title }}</div>
      </div>
    </div>
    <div v-if="hasSource" class="ig-source">
      <div class="ig-line" :style="lineStyle" />
      <div class="ig-src" :style="[sourceStyle, { '--g': glow }]">
        <img v-if="data.sourceImg" :src="data.sourceImg" alt="" />
        <span v-if="data.sourceName" class="ig-src-name">{{ data.sourceName }}</span>
      </div>
    </div>
    <div v-if="data.layout !== 'stack' && !fan" class="ig-row">
      <div v-for="(it, i) in items" :key="i" class="ig-item">
        <div class="ig-tile" :class="{ empty: !it.img }" :style="[itemStyle(i), { '--g': glow }]">
          <img v-if="it.img" :src="it.img" alt="" />
          <span v-else>待上传</span>
          <i v-if="data.check" class="ig-check" :style="checkStyle(i)">✓</i>
        </div>
        <i class="ig-shadow" :style="shadowStyle(i)" />
        <div v-if="it.name" class="ig-pill" :style="pillStyle(i)">{{ it.name }}</div>
      </div>
    </div>
    <div v-else class="ig-stack" :style="stackSize">
      <div v-for="(it, i) in items" :key="i" class="ig-slot" :style="stackPos(i)">
        <i class="ig-shadow wide" :style="shadowStyle(i)" />
        <div class="ig-card" :style="itemStyle(i)">
          <div class="ig-card-img" :class="{ empty: !it.img }">
            <img v-if="it.img" :src="it.img" alt="" />
            <span v-else>待上传</span>
          </div>
          <div class="ig-card-cap">{{ it.name }}<i /></div>
          <i v-if="data.check" class="ig-check" :style="checkStyle(i)">✓</i>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ig {
  position: relative; display: inline-block; padding: 52px 72px 56px 56px; box-sizing: border-box;
  color: var(--fg); font-family: var(--font-cn);
}
.ig-head { position: relative; display: flex; align-items: center; gap: 32px; margin-bottom: 56px; }
.ig-bar { align-self: stretch; width: 8px; border-radius: 4px; background: var(--accent); transform-origin: top center; }
.ig-icon {
  width: 150px; height: 150px; border-radius: 32px; display: grid; place-items: center; flex: none;
  background: var(--tile);
  box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--accent) 45%, transparent), 0 16px 40px var(--shadow-c);
}
.ig-icon img { width: 70%; height: 70%; object-fit: contain; }
.ig-kicker { font-size: 44px; font-weight: 700; color: var(--accent); white-space: nowrap; }
.ig-title { margin-top: 6px; font-size: 104px; font-weight: 800; line-height: 1.1; white-space: nowrap; }
.ig-row { position: relative; display: flex; gap: 64px; padding-left: 40px; }
.ig-item { display: flex; flex-direction: column; align-items: center; gap: 30px; }
.ig-tile {
  position: relative; width: 190px; height: 190px; border-radius: 44px; display: grid; place-items: center;
  background: var(--tile);
  box-shadow:
    inset 0 0 0 1.5px var(--track),
    0 18px 40px var(--shadow-c),
    0 0 calc(20px + var(--g, 0) * 26px) color-mix(in srgb, var(--accent) var(--glow-a, 45%), transparent);
}
.ig-tile img { width: 76%; height: 76%; object-fit: contain; border-radius: 30px; }
.ig-tile.empty { background: transparent; box-shadow: none; border: 4px dashed color-mix(in srgb, var(--accent) 70%, transparent); }
.ig-tile.empty span { font-size: 34px; color: var(--accent); }
.ig-check {
  position: absolute; right: -26px; top: -34px; width: 76px; height: 76px; border-radius: 50%; display: grid; place-items: center;
  font-style: normal; font-size: 44px; font-weight: 900; color: var(--ink-on-accent);
  background: radial-gradient(circle at 35% 30%, color-mix(in srgb, var(--accent) 45%, #fff), var(--accent) 55%, color-mix(in srgb, var(--accent) 75%, #000));
  box-shadow: 0 0 24px color-mix(in srgb, var(--accent) 55%, transparent);
}
.ig-pill {
  padding: 10px 40px; border-radius: 999px; font-size: 52px; font-weight: 600; white-space: nowrap;
  border: 3px solid color-mix(in srgb, var(--accent) 75%, transparent);
  background: color-mix(in srgb, var(--accent) 10%, var(--stamp-bg));
  box-shadow: 0 0 22px color-mix(in srgb, var(--accent) 25%, transparent);
}
.ig-item { position: relative; }
.ig-shadow {
  position: absolute; left: 50%; top: 178px; width: 170px; height: 26px; margin-left: -85px; border-radius: 50%;
  background: radial-gradient(closest-side, var(--shadow-c), transparent); pointer-events: none;
}
.ig-shadow.wide { top: auto; bottom: 18px; width: 340px; margin-left: -170px; }
.ig-source { position: relative; display: flex; align-items: center; margin: 0 0 40px; }
.ig-line {
  width: 420px; height: 8px; transform-origin: left center;
  background: repeating-linear-gradient(90deg, var(--accent) 0 26px, transparent 26px 42px);
}
.ig-src {
  position: relative; width: 210px; height: 210px; border-radius: 34px; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 14px;
  background: var(--tile);
  box-shadow: inset 0 0 0 3px color-mix(in srgb, var(--accent) 70%, transparent),
    0 0 calc(24px + var(--g, 0) * 30px) color-mix(in srgb, var(--accent) 45%, transparent);
}
.ig-src img { width: 46%; height: 46%; object-fit: contain; }
.ig-src-name { font-size: 30px; font-weight: 700; white-space: nowrap; }
.ig-stack { position: relative; margin-left: 20px; }
.ig-slot { position: absolute; width: 380px; height: 320px; }
.ig-card {
  position: absolute; left: 0; bottom: 30px; width: 380px; padding: 14px 14px 0; box-sizing: border-box; border-radius: 22px;
  background: linear-gradient(180deg, #fbf8f3, #ece6dd);
  box-shadow: 0 24px 50px var(--shadow-c), inset 0 1px 0 #fff;
}
.ig-card-img { height: 214px; border-radius: 14px; overflow: hidden; background: #0d0f14; display: grid; place-items: center; }
.ig-card-img img { width: 100%; height: 100%; object-fit: cover; }
.ig-card-img.empty { background: transparent; border: 4px dashed color-mix(in srgb, var(--accent) 70%, transparent); box-sizing: border-box; }
.ig-card-img.empty span { font-size: 32px; color: var(--accent); }
.ig-card-cap {
  display: flex; align-items: center; justify-content: space-between; padding: 14px 6px 16px;
  font-size: 34px; font-weight: 700; color: #1d1a17; white-space: nowrap;
}
.ig-card-cap i { width: 14px; height: 14px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 10px var(--accent); }
.ig-card .ig-check { right: -22px; top: -26px; width: 64px; height: 64px; font-size: 36px; }
</style>
