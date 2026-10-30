<script setup lang="ts">
import { computed } from 'vue'
import { easeInCubic, easeOutCubic, lerp, progress } from './timeline'
import { useCardSize } from './cardSize'
import CardShell from './CardShell.vue'

// 「人名条」（下三分之一）：一条强调色竖条先划出来，名字从竖条后面滑出，下面一行头衔 / 机构。
// **只能用户自己填，不交给 AI**：名字和头衔编错了读起来完全正常（把「CEO」写成「创始人」没人会怀疑）。
export interface LowerThirdData { name: string; role: string; accent: string; panel: boolean; duration: number }
const props = defineProps<{ data: LowerThirdData; t: number }>()
const emit = defineEmits<{ size: [{ w: number; h: number }] }>()
const root = useCardSize(emit)

const OUT = 0.45
const outP = computed(() => easeInCubic(progress(props.t, props.data.duration - OUT, props.data.duration)))
const rootStyle = computed(() => ({
  opacity: 1 - outP.value, transform: `translateX(${-40 * outP.value}px)`,
  ...(props.data.accent ? { '--accent': props.data.accent } : {}),
}))
const barStyle = computed(() => ({ transform: `scaleY(${easeOutCubic(progress(props.t, 0, 0.35))})` }))
// 名字和头衔从竖条后面滑出来（被竖条那一侧裁掉，像从缝里抽出来）
const slide = (a: number) => {
  const p = easeOutCubic(progress(props.t, a, a + 0.5))
  return { transform: `translateX(${lerp(-110, 0, p)}%)`, opacity: Math.min(1, p * 2) }
}
</script>

<template>
  <div ref="root" class="lt" :style="rootStyle">
    <CardShell v-if="data.panel" :t="t" :duration="data.duration" />
    <i class="lt-bar bx-glow-box" :style="barStyle" />
    <div class="lt-clip">
      <div class="lt-name" :style="slide(0.2)">{{ data.name }}</div>
      <div v-if="data.role" class="lt-role" :style="slide(0.4)">{{ data.role }}</div>
    </div>
  </div>
</template>

<style scoped>
.lt { position: relative; display: inline-flex; align-items: stretch; gap: 28px; padding: 30px 70px 30px 40px; box-sizing: border-box; color: var(--fg); font-family: var(--font-cn); }
.lt-bar { position: relative; width: 10px; border-radius: 5px; background: var(--accent); transform-origin: top center; }
.lt-clip { position: relative; overflow: hidden; padding-right: 10px; }
.lt-name { font-size: 84px; font-weight: 800; white-space: nowrap; line-height: 1.15; }
.lt-role { margin-top: 6px; font-size: 44px; color: var(--accent); font-weight: 600; white-space: nowrap; }
</style>
