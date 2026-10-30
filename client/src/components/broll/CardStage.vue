<script setup lang="ts">
import { computed, ref, onMounted, onBeforeUnmount, provide, toRef, type Component } from 'vue'
import { themeById } from './theme'
import { THEME_KEY } from './themeContext'
import FullFrame from './FullFrame.vue'
import { fullscreenScale } from './templates'

// 一块缩小的画布：按容器宽度把 1920×1080（竖屏 1080×1920）的画布缩进来，在 box 的位置画一张卡。
// 调试台用；只读，不能拖。尺寸照样报给外面（体检要用）。

const props = defineProps<{
  component: Component
  data: Record<string, any>
  t: number
  aspect: '16:9' | '9:16'
  box: { x: number; y: number; s: number }
  theme: string
  bg: 'dark' | 'light' | 'grid' | 'image'
  bgImage?: string
}>()
const emit = defineEmits<{ size: [{ w: number; h: number }] }>()
provide(THEME_KEY, toRef(props, 'theme'))
const size = ref<{ w: number; h: number }>()
const onSize = (s: { w: number; h: number }) => { size.value = s; emit('size', s) }

const W = computed(() => (props.aspect === '16:9' ? 1920 : 1080))
const H = computed(() => (props.aspect === '16:9' ? 1080 : 1920))
const el = ref<HTMLElement>()
const width = ref(320)
let ro: ResizeObserver | null = null
onMounted(() => {
  ro = new ResizeObserver(([e]) => { width.value = e.contentRect.width })
  if (el.value) ro.observe(el.value)
})
onBeforeUnmount(() => ro?.disconnect())
</script>

<template>
  <div
    ref="el" class="cs" :class="`bg-${bg}`"
    :style="{ aspectRatio: `${W} / ${H}`, backgroundImage: bg === 'image' && bgImage ? `url(${bgImage})` : undefined }"
  >
    <div class="cs-canvas" :style="{ width: `${W}px`, height: `${H}px`, transform: `scale(${width / W})`, '--cw': `${W}px`, '--ch': `${H}px`, ...themeById(theme).vars }">
      <!-- 全屏卡（data.fullscreen）铺满画布，不按 box 摆 -->
      <!-- B-roll 场景（data.scene）铺满画布、自己画背景 -->
      <div v-if="data.scene" class="cs-card" style="left: 0; top: 0">
        <component :is="component" :data="data" :t="t" @size="onSize" />
      </div>
      <template v-else-if="data.fullscreen">
        <FullFrame :t="t" :duration="data.duration" />
        <div class="cs-full">
          <div :style="{ transform: `scale(${fullscreenScale(size, W, H)})` }">
            <component :is="component" :data="data" :t="t" @size="onSize" />
          </div>
        </div>
      </template>
      <div v-else class="cs-card" :style="{ left: `${box.x * W}px`, top: `${box.y * H}px`, transform: `scale(${box.s})` }">
        <component :is="component" :data="data" :t="t" @size="onSize" />
      </div>
      <!-- 字幕区（下 18%）：卡片压进来会和口播字幕叠在一起 -->
      <div v-if="!data.fullscreen && !data.scene" class="cs-safe" />
    </div>
  </div>
</template>

<style scoped>
.cs { position: relative; overflow: hidden; border-radius: 6px; background-size: cover; background-position: center; }
.bg-dark { background-color: #1a1d26; background-image: linear-gradient(135deg, #2b3142, #11141c); }
.bg-light { background-image: linear-gradient(135deg, #e9edf3, #c8d0dc); }
.bg-grid {
  background-color: #fff;
  background-image: linear-gradient(45deg, #ddd 25%, transparent 25%), linear-gradient(-45deg, #ddd 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #ddd 75%), linear-gradient(-45deg, transparent 75%, #ddd 75%);
  background-size: 24px 24px; background-position: 0 0, 0 12px, 12px -12px, -12px 0;
}
.bg-image { background-color: #000; }
.cs-canvas { position: absolute; left: 0; top: 0; transform-origin: 0 0; pointer-events: none; }
.cs-card { position: absolute; transform-origin: 0 0; }
.cs-full { position: absolute; inset: 0; display: grid; place-items: center; }
.cs-safe { position: absolute; left: 0; right: 0; bottom: 0; height: 18%; border-top: 3px dashed rgba(255, 80, 80, 0.5); }
</style>
