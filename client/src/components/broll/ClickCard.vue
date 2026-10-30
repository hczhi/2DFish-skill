<script setup lang="ts">
import { computed } from 'vue'
import { easeInOutCubic, easeOutBack, easeOutCubic, lerp, progress } from './timeline'
import { useCardBase } from './cardBase'
import CardShell from './CardShell.vue'

// 「点击按钮」卡：一个按钮出现 → 鼠标箭头从右下滑过来 → 点下去（按钮下沉 + 一圈波纹）→ 按钮变成「已完成」的样子，旁边一行结果。
// 「点这里」「点一下开启」时用。按钮上的字摘原话。
export interface ClickData { button: string; result: string; accent: string; panel: boolean; duration: number }
const props = defineProps<{ data: ClickData; t: number }>()
const emit = defineEmits<{ size: [{ w: number; h: number }] }>()
const { root, rootStyle } = useCardBase(props, emit)

const MOVE_AT = 0.45
const CLICK = 1.25
const btnStyle = computed(() => {
  const p = progress(props.t, 0, 0.45)
  const press = progress(props.t, CLICK, CLICK + 0.22)
  return { opacity: easeOutCubic(p), transform: `scale(${lerp(0.7, 1, easeOutBack(p)) - Math.sin(press * Math.PI) * 0.06})` }
})
const done = computed(() => props.t >= CLICK + 0.1)
const cursorStyle = computed(() => {
  const p = easeInOutCubic(progress(props.t, MOVE_AT, CLICK))
  const press = progress(props.t, CLICK, CLICK + 0.22)
  return {
    // 点完 0.4 秒后淡出，别一直压在按钮的字上
    opacity: Math.min(1, progress(props.t, MOVE_AT, MOVE_AT + 0.2) * 1.5) * (1 - progress(props.t, CLICK + 0.4, CLICK + 0.8)),
    transform: `translate(${lerp(320, 0, p)}px, ${lerp(220, 0, p)}px) scale(${1 - Math.sin(press * Math.PI) * 0.15})`,
  }
})
const rippleStyle = computed(() => {
  const p = progress(props.t, CLICK, CLICK + 0.6)
  return { opacity: p > 0 && p < 1 ? 1 - p : 0, transform: `translate(-50%, -50%) scale(${lerp(0.2, 2.2, easeOutCubic(p))})` }
})
const resultStyle = computed(() => {
  const p = easeOutCubic(progress(props.t, CLICK + 0.25, CLICK + 0.7))
  return { opacity: p, transform: `translateX(${lerp(-20, 0, p)}px)` }
})
</script>

<template>
  <div ref="root" class="ck" :style="rootStyle">
    <CardShell v-if="data.panel" :t="t" :duration="data.duration" />
    <div class="ck-row">
      <div class="ck-btn" :class="{ done }" :style="btnStyle">
        <span v-if="done" class="ck-ok">✓</span>{{ data.button }}
        <i class="ck-ripple" :style="rippleStyle" />
        <svg class="ck-cursor" viewBox="0 0 24 24" :style="cursorStyle"><path d="M4 2 L4 19 L8.5 15 L11.5 22 L14.5 20.7 L11.6 14 L18 14 Z" /></svg>
      </div>
      <div v-if="data.result" class="ck-res" :style="resultStyle">{{ data.result }}</div>
    </div>
  </div>
</template>

<style scoped>
.ck { position: relative; display: inline-block; padding: 70px 120px 90px 70px; color: var(--fg); font-family: var(--font-cn); }
.ck-row { position: relative; display: flex; align-items: center; gap: 44px; }
.ck-btn {
  position: relative; display: inline-flex; align-items: center; gap: 16px; padding: 30px 70px; border-radius: 999px; white-space: nowrap;
  font-size: 60px; font-weight: 800; color: var(--fg); background: var(--tile);
  box-shadow: inset 0 0 0 3px color-mix(in srgb, var(--accent) 70%, transparent), 0 20px 40px var(--shadow-c);
}
.ck-btn.done { color: var(--ink-on-accent); background: var(--accent); box-shadow: 0 0 40px color-mix(in srgb, var(--accent) var(--glow-a, 45%), transparent), 0 20px 40px var(--shadow-c); }
.ck-ok { font-size: 52px; }
.ck-ripple { position: absolute; left: 50%; top: 50%; width: 200px; height: 200px; border-radius: 50%; border: 6px solid var(--accent); pointer-events: none; }
.ck-cursor { position: absolute; left: 50%; top: 50%; width: 90px; height: 90px; fill: #fff; stroke: #111; stroke-width: 1.3; filter: drop-shadow(0 6px 10px rgba(0, 0, 0, 0.45)); }
.ck-res { font-size: 52px; font-weight: 700; color: var(--accent); white-space: nowrap; }
</style>
