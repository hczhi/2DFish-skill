<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, type Component } from 'vue'
import CardStage from './CardStage.vue'

// 调试台卡片墙的一格：滚进视口才挂 CardStage 循环播放，滚出就卸掉（50 多张卡同时按 t 重算会把页面拖卡）。

defineProps<{
  component: Component
  data: Record<string, any>
  t: number
  aspect: '16:9' | '9:16'
  box: { x: number; y: number; s: number }
  theme: string
  bg: 'dark' | 'light' | 'grid' | 'image'
  bgImage?: string
}>()

const el = ref<HTMLElement>()
const visible = ref(false)
let io: IntersectionObserver | null = null
onMounted(() => {
  io = new IntersectionObserver(([e]) => { visible.value = e.isIntersecting }, { rootMargin: '120px 0px' })
  if (el.value) io.observe(el.value)
})
onBeforeUnmount(() => io?.disconnect())
</script>

<template>
  <div ref="el" class="tile-prev" :class="{ portrait: aspect === '9:16' }">
    <CardStage
      v-if="visible"
      :component="component" :data="data" :t="t"
      :aspect="aspect" :box="box" :theme="theme" :bg="bg" :bg-image="bgImage"
    />
  </div>
</template>

<style scoped>
.tile-prev { aspect-ratio: 16 / 9; background: #0e0e12; }
.tile-prev.portrait { aspect-ratio: 9 / 16; }
</style>
