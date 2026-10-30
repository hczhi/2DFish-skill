<script setup lang="ts">
import { computed } from 'vue'
import { progress, easeOutCubic, easeInCubic } from './timeline'
import { sceneCam } from './sceneBase'

// B-roll 场景的背景层：主题底色（--full-bg）上几团强调色的光慢慢漂 + 透视网格往远处流 + 颗粒 + 暗角。
// 自己一直在动（停住时画面不死），跟着场景一起淡入淡出。
const props = defineProps<{ t: number; duration: number }>()
const fade = computed(() => easeOutCubic(progress(props.t, 0, 0.4)) * (1 - easeInCubic(progress(props.t, props.duration - 0.4, props.duration))))
const blob = (k: number) => {
  const a = props.t * (0.18 + k * 0.05) + k * 2.1
  return { transform: `translate(${Math.cos(a) * (14 + k * 6)}%, ${Math.sin(a * 1.3) * (10 + k * 4)}%)` }
}
const gridOff = computed(() => `${(props.t * 40) % 80}px`)
</script>

<template>
  <div class="sb" :style="{ opacity: fade }">
    <div class="sb-base" />
    <div class="sb-layer" :style="sceneCam(t, duration, 0.1)">
      <i class="sb-blob a" :style="blob(0)" />
      <i class="sb-blob b" :style="blob(1)" />
      <i class="sb-blob c" :style="blob(2)" />
    </div>
    <div class="sb-grid" :style="{ '--off': gridOff }" />
    <div class="sb-grain" />
    <div class="sb-vig" />
  </div>
</template>

<style scoped>
.sb { position: absolute; inset: 0; overflow: hidden; }
.sb-base { position: absolute; inset: 0; background: var(--full-bg); }
.sb-layer { position: absolute; inset: -10%; }
.sb-blob { position: absolute; border-radius: 50%; filter: blur(60px); }
.sb-blob.a { left: 5%; top: 10%; width: 55%; height: 60%; background: radial-gradient(closest-side, color-mix(in srgb, var(--accent) 34%, transparent), transparent); }
.sb-blob.b { right: 0; bottom: 5%; width: 50%; height: 55%; background: radial-gradient(closest-side, color-mix(in srgb, var(--accent) 22%, transparent), transparent); }
.sb-blob.c { left: 35%; top: 40%; width: 40%; height: 40%; background: radial-gradient(closest-side, color-mix(in srgb, var(--fg) 7%, transparent), transparent); }
/* 透视网格：只铺下半屏，往远处流动 */
.sb-grid {
  position: absolute; left: -50%; right: -50%; bottom: -10%; height: 55%; opacity: 0.35;
  background-image: linear-gradient(var(--line) 1.5px, transparent 1.5px), linear-gradient(90deg, var(--line) 1.5px, transparent 1.5px);
  background-size: 80px 80px; background-position: 0 var(--off);
  transform: perspective(600px) rotateX(62deg); transform-origin: center top;
  -webkit-mask-image: linear-gradient(to bottom, transparent, #000 40%); mask-image: linear-gradient(to bottom, transparent, #000 40%);
}
.sb-grain { position: absolute; inset: 0; opacity: 0.16; mix-blend-mode: var(--grain-blend); background-image: var(--grain); }
.sb-vig { position: absolute; inset: 0; background: radial-gradient(ellipse at 50% 45%, transparent 50%, var(--shadow-c) 100%); }
</style>
