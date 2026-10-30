<script setup lang="ts">
import { computed } from 'vue'
import { easeOutBack, easeOutCubic, lerp, progress, stagger } from './timeline'
import { useCardBase } from './cardBase'
import CardShell from './CardShell.vue'

// 「关注引导」卡：点赞 / 收藏 / 关注三个按钮依次弹出，一只手指依次点过去，被点到的按钮变成强调色并弹一下；上面一行引导语。
// 视频结尾「觉得有用就点个关注」时用。图标是画的 SVG（不用 emoji，服务器上缺 emoji 字体也照样能导）。
export interface CtaData { text: string; buttons: string; accent: string; panel: boolean; duration: number }
const props = defineProps<{ data: CtaData; t: number }>()
const emit = defineEmits<{ size: [{ w: number; h: number }] }>()
const { root, rootStyle } = useCardBase(props, emit)

const ICONS: Record<string, { label: string; d: string }> = {
  like: { label: '点赞', d: 'M7 21H3V10h4zm2 0h8.6a2 2 0 0 0 2-1.7l1.2-7A2 2 0 0 0 18.8 10H14l.8-4.2A2 2 0 0 0 12.9 3.4L9 10z' },
  fav: { label: '收藏', d: 'M12 2.8l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.6l-5.8 3.1 1.1-6.5L2.6 9.6l6.5-.9z' },
  follow: { label: '关注', d: 'M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-7 9c0-3.5 3-6 7-6s7 2.5 7 6zm16-12h2v3h3v2h-3v3h-2v-3h-3v-2h3z' },
  share: { label: '转发', d: 'M14 4l7 7-7 7v-4.2c-5 0-8.3 1.6-11 5.2 1-5 4-10 11-11z' },
}
const keys = computed(() => props.data.buttons.split(/[,，、\s]+/).filter((k) => ICONS[k]))
const AT = 0.45
const STEP = 0.25
const TAP_AT = computed(() => AT + keys.value.length * STEP + 0.2)
const TAP_STEP = 0.45
const btnStyle = (i: number) => {
  const p = stagger(props.t, AT, STEP, i, 0.4)
  const tap = progress(props.t, TAP_AT.value + i * TAP_STEP, TAP_AT.value + i * TAP_STEP + 0.3)
  return { opacity: easeOutCubic(p), transform: `scale(${lerp(0.4, 1, easeOutBack(p)) + Math.sin(tap * Math.PI) * 0.15})` }
}
const tapped = (i: number) => props.t >= TAP_AT.value + i * TAP_STEP + 0.12
// 手指：从右下进来，依次停在每个按钮上点一下
const handStyle = computed(() => {
  const n = keys.value.length
  if (!n) return { opacity: 0 }
  const local = (props.t - TAP_AT.value) / TAP_STEP
  const i = Math.max(0, Math.min(n - 1, Math.floor(local)))
  const frac = Math.max(0, Math.min(1, local - i))
  const x = i * 250 + (frac < 0.3 ? 0 : 0)
  const press = Math.sin(Math.min(1, frac / 0.3) * Math.PI) * 18
  const enterP = easeOutCubic(progress(props.t, TAP_AT.value - 0.35, TAP_AT.value))
  return { opacity: enterP * (1 - progress(props.t, TAP_AT.value + n * TAP_STEP, TAP_AT.value + n * TAP_STEP + 0.3)), transform: `translate(${x + lerp(200, 0, enterP)}px, ${press + lerp(160, 0, enterP)}px)` }
})
const textStyle = computed(() => {
  const p = easeOutCubic(progress(props.t, 0.1, 0.5))
  return { opacity: p, transform: `translateY(${lerp(18, 0, p)}px)` }
})
</script>

<template>
  <div ref="root" class="cta" :style="rootStyle">
    <CardShell v-if="data.panel" :t="t" :duration="data.duration" />
    <div v-if="data.text" class="cta-text" :style="textStyle">{{ data.text }}</div>
    <div class="cta-row">
      <div v-for="(k, i) in keys" :key="k" class="cta-btn" :class="{ on: tapped(i) }" :style="btnStyle(i)">
        <svg viewBox="0 0 24 24"><path :d="ICONS[k].d" /></svg>
        <span>{{ ICONS[k].label }}</span>
      </div>
      <svg class="cta-hand" viewBox="0 0 24 24" :style="handStyle"><path d="M9 11V4.5a1.5 1.5 0 0 1 3 0V10h.5V8.5a1.5 1.5 0 0 1 3 0V10h.5V9.5a1.5 1.5 0 0 1 3 0V15c0 3.6-2.4 6.5-6 6.5-2.4 0-4-1-5.3-2.9L4.6 14.3a1.5 1.5 0 0 1 2.4-1.8L9 15z" /></svg>
    </div>
  </div>
</template>

<style scoped>
.cta { position: relative; display: inline-flex; flex-direction: column; align-items: center; padding: 50px 80px 70px; box-sizing: border-box; color: var(--fg); font-family: var(--font-cn); }
.cta-text { position: relative; font-size: 60px; font-weight: 800; margin-bottom: 40px; white-space: nowrap; }
.cta-row { position: relative; display: flex; gap: 70px; }
.cta-btn { position: relative; display: flex; flex-direction: column; align-items: center; gap: 14px; width: 180px; }
.cta-btn svg { width: 150px; height: 150px; padding: 32px; box-sizing: border-box; border-radius: 50%; fill: var(--fg); background: var(--track); box-shadow: inset 0 0 0 2px var(--line); }
.cta-btn.on svg { fill: var(--ink-on-accent); background: var(--accent); box-shadow: 0 0 36px color-mix(in srgb, var(--accent) var(--glow-a, 45%), transparent); }
.cta-btn span { font-size: 40px; font-weight: 700; }
.cta-hand { position: absolute; left: 70px; top: 80px; width: 120px; height: 120px; fill: #fff; stroke: #222; stroke-width: 0.8; filter: drop-shadow(0 8px 14px rgba(0, 0, 0, 0.45)); }
</style>
