<script setup lang="ts">
import { computed } from 'vue'
import { easeOutCubic, lerp, progress, pulse } from './timeline'
import CardShell from './CardShell.vue'
import CardHead from './CardHead.vue'
import { useCardBase } from './cardBase'
import { cueAt } from './cues'

// 「五选一」卡：几个候选 3 + 2 居中逐个淡入让观众读题；选中那一刻它先灰闪一帧（像被按下），再填满强调色、轻弹一下，
// 其余淡到 18% 但位置锁死不动（「是从这几个里挑出来的」）；最后一行理由跟上。
// 候选、选中项、理由都摘原话。cues[0..n-1] 是各候选出现的时刻，cues[n] 是「选中」的时刻。

export interface ChooseData {
  label: string
  title: string
  options: string[]
  pick: string
  note: string
  cues?: (number | null)[]
  accent: string
  panel: boolean
  duration: number
}

const props = defineProps<{ data: ChooseData; t: number }>()
const emit = defineEmits<{ size: [{ w: number; h: number }] }>()
const { root, rootStyle } = useCardBase(props, emit)

// 和 templates.ts 的 chooseOptAt / choosePickAt 一致
const OPT_START = 0.5
const OPT_STEP = 0.22
const options = computed(() => props.data.options.filter((s) => s.trim()))
const optAt = (i: number) => cueAt(props.data.cues, i, OPT_START + i * OPT_STEP)
const pickAt = computed(() => cueAt(props.data.cues, options.value.length, OPT_START + options.value.length * OPT_STEP + 0.6))
const pickIdx = computed(() => options.value.findIndex((o) => o.trim() === props.data.pick?.trim()))

// 每行最多 3 个：4 = 2+2，5 = 3+2，6 = 3+3
const rows = computed(() => {
  const n = options.value.length
  const first = n === 4 ? 2 : Math.min(3, n)
  const idx = options.value.map((_, i) => i)
  return [idx.slice(0, first), idx.slice(first, first + 3)].filter((r) => r.length)
})

const chipStyle = (i: number) => {
  const inP = easeOutCubic(progress(props.t, optAt(i), optAt(i) + 0.35))
  const base = { opacity: inP, transform: `translateY(${lerp(18, 0, inP)}px)` }
  if (pickIdx.value < 0 || props.t < pickAt.value) return base
  if (i !== pickIdx.value) return { ...base, opacity: inP * lerp(1, 0.18, easeOutCubic(progress(props.t, pickAt.value, pickAt.value + 0.4))) }
  // 选中：灰闪一帧 → 填色 + 正弦轻弹
  const bounce = Math.sin(progress(props.t, pickAt.value + 0.06, pickAt.value + 0.46) * Math.PI) * 0.06
  return { ...base, transform: `scale(${1 + bounce})` }
}
const flash = (i: number) => i === pickIdx.value && props.t >= pickAt.value && props.t < pickAt.value + 0.06
const fill = (i: number) => (i === pickIdx.value ? progress(props.t, pickAt.value + 0.06, pickAt.value + 0.23) : 0)
const noteStyle = computed(() => {
  const p = easeOutCubic(progress(props.t, pickAt.value + 0.5, pickAt.value + 0.95))
  return { opacity: p, transform: `translateY(${lerp(16, 0, p)}px)` }
})
</script>

<template>
  <div ref="root" class="cc" :style="rootStyle">
    <CardShell v-if="data.panel" :t="t" :duration="data.duration" />
    <CardHead :t="t" :label="data.label" :title="data.title" />
    <div class="cc-grid">
      <div v-for="(row, r) in rows" :key="r" class="cc-row">
        <div v-for="i in row" :key="i" class="cc-chip" :class="{ flash: flash(i) }" :style="chipStyle(i)">
          <i class="cc-fill" :style="{ opacity: fill(i) }" />
          <span class="cc-txt" :style="{ color: fill(i) > 0.5 ? 'var(--ink-on-accent)' : undefined }">{{ options[i] }}</span>
        </div>
      </div>
    </div>
    <div v-if="data.note" class="cc-note" :style="noteStyle"><i class="bx-dot" :style="{ '--pulse': pulse(t) }" />{{ data.note }}</div>
  </div>
</template>

<style scoped>
.cc {
  position: relative; display: inline-block; padding: 44px 64px 48px; box-sizing: border-box;
  color: var(--fg); font-family: var(--font-cn);
}
.cc-grid { position: relative; display: flex; flex-direction: column; align-items: center; gap: 22px; }
.cc-row { display: flex; gap: 22px; justify-content: center; }
.cc-chip {
  position: relative; padding: 22px 44px; border-radius: 22px; overflow: hidden; white-space: nowrap;
  border: 3px solid var(--line); background: var(--tile);
  font-size: 60px; font-weight: 700; line-height: 1.2;
}
.cc-chip.flash { filter: brightness(0.55) saturate(0); }
.cc-fill { position: absolute; inset: 0; background: var(--accent); box-shadow: 0 0 50px color-mix(in srgb, var(--accent) var(--glow-a), transparent); }
.cc-txt { position: relative; }
.cc-note {
  position: relative; display: flex; align-items: center; justify-content: center; gap: 16px; margin-top: 30px;
  font-size: 52px; font-weight: 600; white-space: nowrap;
}
</style>
