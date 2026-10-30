<script setup lang="ts">
import { computed } from 'vue'
import { easeOutBack, easeOutCubic, lerp, progress, stagger } from './timeline'
import { useCardBase } from './cardBase'
import CardShell from './CardShell.vue'
import CardHead from './CardHead.vue'

// 「因果链」卡：「因为 A → 所以 B → 最后 C」—— 一个个方块依次推出来，中间的箭头一节节画过去，最后一个是结果（强调色）。
// 和「步骤流程」的区别：步骤是做事的先后，因果链是推理（前面的导致后面的），所以箭头上标「导致」、最后一格标「结果」。
export interface CauseChainData { label: string; title: string; nodes: string[]; accent: string; panel: boolean; duration: number }
const props = defineProps<{ data: CauseChainData; t: number }>()
const emit = defineEmits<{ size: [{ w: number; h: number }] }>()
const { root, rootStyle } = useCardBase(props, emit)

const AT = 0.45
const STEP = 0.5
const nodes = computed(() => props.data.nodes.filter((s) => s.trim()))
const nodeStyle = (i: number) => {
  const p = stagger(props.t, AT, STEP, i, 0.4)
  return { opacity: easeOutCubic(p), transform: `translateX(${lerp(-30, 0, easeOutCubic(p))}px) scale(${lerp(0.85, 1, easeOutBack(p))})` }
}
const arrowP = (i: number) => easeOutCubic(stagger(props.t, AT + 0.25, STEP, i, STEP - 0.05))
const resultIn = computed(() => progress(props.t, AT + (nodes.value.length - 1) * STEP + 0.3, AT + (nodes.value.length - 1) * STEP + 0.6))
</script>

<template>
  <div ref="root" class="cc" :style="rootStyle">
    <CardShell v-if="data.panel" :t="t" :duration="data.duration" />
    <CardHead :t="t" :label="data.label" :title="data.title" />
    <div class="cc-row">
      <template v-for="(nd, i) in nodes" :key="i">
        <div class="cc-node" :class="{ last: i === nodes.length - 1 }" :style="nodeStyle(i)">
          <span v-if="i === nodes.length - 1" class="cc-tag" :style="{ opacity: resultIn }">结果</span>
          {{ nd }}
        </div>
        <div v-if="i < nodes.length - 1" class="cc-arrow">
          <span class="cc-why" :style="{ opacity: arrowP(i) }">导致</span>
          <svg viewBox="0 0 120 40"><path d="M4 20 H100 M84 6 L112 20 L84 34" pathLength="1" :style="{ strokeDashoffset: 1 - arrowP(i) }" /></svg>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.cc { position: relative; display: inline-block; padding: 48px 70px 50px 60px; box-sizing: border-box; color: var(--fg); font-family: var(--font-cn); }
.cc-row { position: relative; display: flex; align-items: center; gap: 10px; }
.cc-node { position: relative; padding: 30px 40px; border-radius: 20px; font-size: 50px; font-weight: 700; white-space: nowrap; background: var(--track); box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--accent) 30%, transparent); }
.cc-node.last { color: var(--ink-on-accent); background: var(--accent); box-shadow: 0 0 36px color-mix(in srgb, var(--accent) var(--glow-a, 45%), transparent); }
.cc-tag { position: absolute; left: 50%; top: -44px; transform: translateX(-50%); font-size: 28px; color: var(--accent); font-weight: 700; }
.cc-arrow { position: relative; display: flex; flex-direction: column; align-items: center; width: 130px; }
.cc-why { font-size: 26px; color: var(--mute); margin-bottom: 4px; }
.cc-arrow svg { width: 120px; height: 40px; }
.cc-arrow path { fill: none; stroke: var(--accent); stroke-width: 6; stroke-linecap: round; stroke-linejoin: round; stroke-dasharray: 1; }
</style>
