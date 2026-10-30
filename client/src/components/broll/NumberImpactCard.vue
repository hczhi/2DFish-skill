<script setup lang="ts">
import { computed } from 'vue'
import { easeInCubic, easeOutBack, easeOutCubic, focusIn, lerp, progress, pulse } from './timeline'
import { useCardSize } from './cardSize'
import CardShell from './CardShell.vue'

// 「数字冲击」卡：英文小标签 + 大数字从 0 跳到目标值 + 单位 + 一行说明。只画卡片本身（按内容撑开），
// 放在画布哪、多大由外面定；颜色字体全走主题的 CSS 变量（theme.ts）。
// 画面完全由 t 决定（见 timeline.ts），导出时逐帧 seek 就是改 t。

export interface NumberImpactData {
  label: string
  prefix: string
  value: string
  unit: string
  title: string
  /** '' = 跟随主题 */
  accent: string
  align: 'left' | 'center' | 'right'
  panel: boolean
  duration: number
}

const props = defineProps<{ data: NumberImpactData; t: number }>()
// 卡片的自然尺寸（未缩放）。外面拿它判断「有没有出画面」—— 出画面的部分导出时被裁掉，而导出照样「成功」。
const emit = defineEmits<{ size: [{ w: number; h: number }] }>()

const OUT = 0.5 // 结尾淡出时长

// 「1,280」「3.5」「300」都能跳；带不了数的（如「三倍」）原样显示、不跳。
const parsed = computed(() => {
  const raw = props.data.value.trim()
  const plain = raw.replace(/,/g, '')
  if (!/^-?\d+(\.\d+)?$/.test(plain)) return null
  return { target: Number(plain), decimals: (plain.split('.')[1] || '').length, grouped: raw.includes(',') }
})

const numberText = computed(() => {
  const p = parsed.value
  if (!p) return props.data.value
  const cur = p.target * easeOutCubic(progress(props.t, 0.15, 1.45))
  return p.grouped
    ? cur.toLocaleString('en-US', { minimumFractionDigits: p.decimals, maximumFractionDigits: p.decimals })
    : cur.toFixed(p.decimals)
})

const outP = computed(() => easeInCubic(progress(props.t, props.data.duration - OUT, props.data.duration)))

const rootStyle = computed(() => ({
  opacity: 1 - outP.value,
  filter: `blur(${outP.value * 8}px)`,
  transform: `translateY(${-30 * outP.value}px)`,
  textAlign: props.data.align,
  ...(props.data.accent ? { '--accent': props.data.accent } : {}),
}))

const wipe = (a: number, b: number) => {
  const p = easeOutCubic(progress(props.t, a, b))
  return { opacity: p, clipPath: `inset(0 ${100 - p * 100}% 0 0)` }
}
const labelStyle = computed(() => wipe(0, 0.5))
const numberStyle = computed(() => {
  const p = progress(props.t, 0.15, 0.75)
  return { opacity: easeOutCubic(p), transform: `scale(${lerp(0.85, 1, easeOutBack(p))})` }
})
const unitStyle = computed(() => {
  const p = easeOutCubic(progress(props.t, 0.5, 1))
  return { opacity: p, transform: `translateX(${lerp(-24, 0, p)}px)` }
})
const lineStyle = computed(() => ({ transform: `scaleX(${easeOutCubic(progress(props.t, 0.6, 1.2))})` }))
const titleStyle = computed(() => wipe(0.85, 1.45))

const root = useCardSize(emit)
</script>

<template>
  <div ref="root" class="ni" :class="`ni--${data.align}`" :style="rootStyle">
    <CardShell v-if="data.panel" :t="t" :duration="data.duration" />
    <div v-if="data.label" class="ni-label" :style="labelStyle"><i class="bx-dot" :style="{ '--pulse': pulse(t) }" />{{ data.label }}</div>
    <div class="ni-row">
      <!-- 终值那一版占位（不可见）、跳动中的数叠在上面：卡片宽度从第一帧起就是最终宽度，跳数时不抖，量尺寸也量的是终值 -->
      <span class="ni-num" :style="numberStyle">
        <span class="ni-ghost">{{ data.prefix }}{{ data.value }}</span>
        <span class="ni-live bx-hot">{{ data.prefix }}{{ numberText }}</span>
      </span>
      <span v-if="data.unit" class="ni-unit bx-hot" :style="unitStyle">{{ data.unit }}</span>
    </div>
    <div class="ni-line" :style="lineStyle" />
    <div v-if="data.title" class="ni-title" :style="titleStyle">{{ data.title }}</div>
  </div>
</template>

<style scoped>
.ni {
  position: relative; display: inline-block; padding: 56px 72px 60px; box-sizing: border-box;
  color: var(--fg); font-family: var(--font-cn);
}
.ni-panel { position: absolute; inset: 0; border-radius: 8px; background: var(--panel); border: 2px solid var(--line); }
.ni-corner { position: absolute; width: 44px; height: 44px; border: 0 solid var(--accent); }
.ni-corner.tl { left: -6px; top: -6px; border-left-width: 6px; border-top-width: 6px; transform-origin: left top; }
.ni-corner.br { right: -6px; bottom: -6px; border-right-width: 6px; border-bottom-width: 6px; transform-origin: right bottom; }
.ni-label {
  position: relative; display: flex; align-items: center; gap: 18px; margin-bottom: 18px;
  font-family: var(--font-mono); font-size: 38px; font-weight: 600; letter-spacing: 0.3em; text-transform: uppercase;
  color: var(--accent); white-space: nowrap;
}
.ni--center .ni-label { justify-content: center; }
.ni--right .ni-label { justify-content: flex-end; }
.ni-label b { display: inline-block; width: 48px; height: 4px; background: var(--accent); }
.ni-row { position: relative; display: inline-flex; align-items: baseline; gap: 14px; white-space: nowrap; }
.ni-num {
  display: inline-grid; font-family: var(--font-mono); font-size: 260px; line-height: 1; font-weight: 800; letter-spacing: -6px;
  font-variant-numeric: tabular-nums; transform-origin: left bottom; color: var(--accent);
}
.ni-ghost, .ni-live { grid-area: 1 / 1; }
.ni-ghost { visibility: hidden; }
.ni--center .ni-num { transform-origin: center bottom; }
.ni--right .ni-num { transform-origin: right bottom; }
.ni-unit { display: inline-block; font-size: 110px; font-weight: 700; color: var(--accent); }
.ni-line {
  position: relative; height: 4px; margin: 24px 0 28px; transform-origin: left center;
  background: linear-gradient(90deg, var(--accent), transparent);
}
.ni--center .ni-line { transform-origin: center; background: linear-gradient(90deg, transparent, var(--accent), transparent); }
.ni--right .ni-line { transform-origin: right center; background: linear-gradient(270deg, var(--accent), transparent); }
.ni-title { position: relative; font-size: 68px; font-weight: 600; white-space: nowrap; }
</style>
