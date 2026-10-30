<script setup lang="ts">
import { computed } from 'vue'
import { progress, easeOutCubic, easeInCubic } from './timeline'

// 全屏卡（data.fullscreen）的背景：铺满画布、盖住口播画面，颜色跟主题走（--full-bg），带暗角和颗粒；
// 和卡片一起淡入淡出（不然卡片出场了一整块背景还停在那，像是卡住了）。
const props = defineProps<{ t: number; duration: number }>()
const style = computed(() => ({
  opacity: easeOutCubic(progress(props.t, 0, 0.35)) * (1 - easeInCubic(progress(props.t, props.duration - 0.35, props.duration))),
}))
</script>

<template>
  <div class="ff" :style="style">
    <div class="ff-grain" />
    <div class="ff-vig" />
  </div>
</template>

<style scoped>
.ff { position: absolute; inset: 0; background: var(--full-bg); }
.ff-grain { position: absolute; inset: 0; opacity: 0.18; mix-blend-mode: var(--grain-blend); background-image: var(--grain); }
.ff-vig { position: absolute; inset: 0; background: radial-gradient(ellipse at 50% 45%, transparent 55%, var(--shadow-c) 100%); }
</style>
