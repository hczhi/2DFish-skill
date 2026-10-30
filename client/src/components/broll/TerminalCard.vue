<script setup lang="ts">
import { computed } from 'vue'
import { easeOutBack, easeOutCubic, lerp, progress } from './timeline'
import { useCardBase } from './cardBase'

// 「终端」卡：深色终端窗口（三个圆点 + 标题），「$ 」开头的行是输入（逐字打出来），其余行是输出（整行出现）。
// 一行一行按顺序来，打字速度按字数算。讲 AI 工具 / 提示词 / 命令时用，内容摘原话。
export interface TerminalData { title: string; lines: string[]; accent: string; panel: boolean; duration: number }
const props = defineProps<{ data: TerminalData; t: number }>()
const emit = defineEmits<{ size: [{ w: number; h: number }] }>()
const { root, rootStyle } = useCardBase(props, emit)

const CHAR = 0.045
const GAP = 0.25
// 每一行的开始时刻：输入行按字数占时间，输出行一下就出
const plan = computed(() => {
  let at = 0.5
  return props.data.lines.filter((s) => s.trim()).map((raw) => {
    const cmd = /^\$\s?/.test(raw)
    const text = cmd ? raw.replace(/^\$\s?/, '') : raw
    const row = { cmd, text, at, dur: cmd ? [...text].length * CHAR : 0.15 }
    at += row.dur + GAP
    return row
  })
})
const shown = (r: { cmd: boolean; text: string; at: number }) =>
  r.cmd ? [...r.text].slice(0, Math.max(0, Math.floor((props.t - r.at) / CHAR) + 1)).join('') : r.text
const visible = (r: { at: number }) => props.t >= r.at
const caretAt = computed(() => {
  const rows = plan.value
  for (let i = rows.length - 1; i >= 0; i--) if (props.t >= rows[i].at) return i
  return 0
})
const blink = computed(() => Math.floor(props.t * 3) % 2 === 0)
const winStyle = computed(() => {
  const p = progress(props.t, 0, 0.45)
  return { opacity: easeOutCubic(p), transform: `translateY(${lerp(30, 0, easeOutCubic(p))}px) scale(${lerp(0.92, 1, easeOutBack(p))})` }
})
</script>

<template>
  <div ref="root" class="tm" :style="rootStyle">
    <div class="tm-win" :style="winStyle">
      <div class="tm-bar"><i class="r" /><i class="y" /><i class="g" /><span>{{ data.title || 'terminal' }}</span></div>
      <div class="tm-body">
        <div v-for="(r, i) in plan" v-show="visible(r)" :key="i" class="tm-line" :class="{ cmd: r.cmd }">
          <span v-if="r.cmd" class="tm-ps">$</span>
          <span class="tm-text">{{ shown(r) }}</span>
          <i v-if="i === caretAt && blink" class="tm-caret" />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tm { position: relative; display: inline-block; padding: 20px; font-family: var(--font-mono); }
.tm-win { width: 1200px; border-radius: 22px; overflow: hidden; background: #0d1016; box-shadow: 0 30px 70px rgba(0, 0, 0, 0.5), inset 0 0 0 1.5px rgba(255, 255, 255, 0.08); }
.tm-bar { display: flex; align-items: center; gap: 14px; padding: 20px 26px; background: #171b24; color: #8a93a6; font-size: 28px; }
.tm-bar i { width: 22px; height: 22px; border-radius: 50%; }
.tm-bar .r { background: #ff5f57; } .tm-bar .y { background: #febc2e; } .tm-bar .g { background: #28c840; }
.tm-bar span { margin-left: 16px; }
.tm-body { padding: 30px 36px 40px; min-height: 260px; }
.tm-line { display: flex; gap: 18px; font-size: 40px; line-height: 1.6; color: #a9b3c6; white-space: pre-wrap; }
.tm-line.cmd { color: #f2f4f8; }
.tm-ps { color: var(--accent); font-weight: 800; }
.tm-caret { display: inline-block; width: 20px; height: 44px; margin-top: 10px; background: var(--accent); }
</style>
