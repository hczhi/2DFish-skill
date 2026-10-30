<script setup lang="ts">
import { computed } from 'vue'
import { easeOutBack, easeOutCubic, lerp, progress, stagger } from './timeline'
import { useCardBase } from './cardBase'
import CardShell from './CardShell.vue'
import CardHead from './CardHead.vue'

// 「公式卡」：「好内容 = 选题 + 表达 + 节奏」—— 各项依次弹出、中间的 + 跟着冒，最后「=」和结果砸出来（结果强调色）。
// 公式本身是说话人说的，各项和结果都摘原话。
export interface FormulaData { label: string; title: string; parts: string[]; op: string; result: string; accent: string; panel: boolean; duration: number }
const props = defineProps<{ data: FormulaData; t: number }>()
const emit = defineEmits<{ size: [{ w: number; h: number }] }>()
const { root, rootStyle } = useCardBase(props, emit)

const AT = 0.4
const STEP = 0.32
const parts = computed(() => props.data.parts.filter((s) => s.trim()))
const pop = (i: number) => {
  const p = stagger(props.t, AT, STEP, i, 0.4)
  return { opacity: easeOutCubic(p), transform: `scale(${lerp(0.5, 1, easeOutBack(p))})` }
}
const eqAt = computed(() => AT + parts.value.length * STEP + 0.1)
const resultStyle = computed(() => {
  const p = progress(props.t, eqAt.value + 0.15, eqAt.value + 0.55)
  return { opacity: Math.min(1, p * 3), transform: `scale(${p < 1 ? lerp(1.8, 0.95, p * p) : 1})` }
})
const eqStyle = computed(() => ({ opacity: easeOutCubic(progress(props.t, eqAt.value, eqAt.value + 0.25)) }))
</script>

<template>
  <div ref="root" class="fm" :style="rootStyle">
    <CardShell v-if="data.panel" :t="t" :duration="data.duration" />
    <CardHead :t="t" :label="data.label" :title="data.title" />
    <div class="fm-row">
      <template v-for="(pt, i) in parts" :key="i">
        <span v-if="i > 0" class="fm-op" :style="pop(i - 0.5)">{{ data.op || '+' }}</span>
        <span class="fm-part" :style="pop(i)">{{ pt }}</span>
      </template>
      <span class="fm-op eq" :style="eqStyle">=</span>
      <span class="fm-res" :style="resultStyle"><span class="bx-hot">{{ data.result }}</span></span>
    </div>
  </div>
</template>

<style scoped>
.fm { position: relative; display: inline-block; padding: 48px 80px 54px 60px; box-sizing: border-box; color: var(--fg); font-family: var(--font-cn); }
.fm-row { position: relative; display: flex; align-items: center; gap: 26px; }
.fm-part { padding: 22px 36px; border-radius: 20px; font-size: 56px; font-weight: 700; white-space: nowrap; background: var(--track); box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--accent) 30%, transparent); }
.fm-op { font-family: var(--font-mono); font-size: 72px; font-weight: 800; color: var(--accent); }
.fm-res { font-size: 96px; font-weight: 900; white-space: nowrap; }
</style>
