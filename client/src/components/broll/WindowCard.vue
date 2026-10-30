<script setup lang="ts">
import { computed } from 'vue'
import { easeOutCubic, lerp, progress } from './timeline'
import { useCardBase } from './cardBase'

// 「窗口截图」卡：浏览器 / App 窗口外壳 + 用户上传的截图，从斜着的 3D 角度转正、放大落位，下面可选一行说明。
// 截图必须上传（导出在服务器上渲染）；没传时画虚线「待上传」并由 check 报出来。只能手动加，AI 不配（它拿不到截图）。
export interface WindowData { img: string; url: string; caption: string; style: string; accent: string; panel: boolean; duration: number }
const props = defineProps<{ data: WindowData; t: number }>()
const emit = defineEmits<{ size: [{ w: number; h: number }] }>()
const { root, rootStyle } = useCardBase(props, emit)

const winStyle = computed(() => {
  const p = easeOutCubic(progress(props.t, 0, 0.8))
  return {
    opacity: Math.min(1, p * 2),
    transform: `perspective(2400px) rotateY(${lerp(-24, 0, p)}deg) rotateX(${lerp(10, 0, p)}deg) scale(${lerp(0.8, 1, p)})`,
  }
})
// 停住时极慢地推近一点（Ken Burns），画面不是死的
const imgStyle = computed(() => ({ transform: `scale(${1 + Math.max(0, props.t - 0.8) * 0.012})` }))
const capStyle = computed(() => {
  const p = easeOutCubic(progress(props.t, 0.7, 1.2))
  return { opacity: p, transform: `translateY(${lerp(16, 0, p)}px)` }
})
</script>

<template>
  <div ref="root" class="wn" :style="rootStyle">
    <div class="wn-win" :style="winStyle">
      <div class="wn-bar">
        <i class="r" /><i class="y" /><i class="g" />
        <span v-if="data.style !== 'app'" class="wn-url">{{ data.url || 'https://' }}</span>
        <span v-else class="wn-title">{{ data.url }}</span>
      </div>
      <div class="wn-shot" :class="{ empty: !data.img }">
        <img v-if="data.img" :src="data.img" alt="" :style="imgStyle" />
        <span v-else>待上传截图</span>
      </div>
    </div>
    <div v-if="data.caption" class="wn-cap" :style="capStyle">{{ data.caption }}</div>
  </div>
</template>

<style scoped>
.wn { position: relative; display: inline-flex; flex-direction: column; align-items: center; padding: 30px; color: var(--fg); font-family: var(--font-cn); }
.wn-win { width: 1100px; border-radius: 20px; overflow: hidden; background: var(--tile); box-shadow: 0 40px 90px var(--shadow-c), inset 0 0 0 1.5px var(--track); transform-origin: center; }
.wn-bar { display: flex; align-items: center; gap: 12px; padding: 18px 24px; background: color-mix(in srgb, var(--tile) 70%, var(--track)); }
.wn-bar i { width: 20px; height: 20px; border-radius: 50%; }
.wn-bar .r { background: #ff5f57; } .wn-bar .y { background: #febc2e; } .wn-bar .g { background: #28c840; }
.wn-url { margin-left: 20px; flex: 1; padding: 8px 24px; border-radius: 999px; font-size: 26px; color: var(--mute); background: var(--track); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wn-title { margin: 0 auto; font-size: 28px; color: var(--mute); font-weight: 600; }
.wn-shot { height: 620px; overflow: hidden; display: grid; place-items: center; background: #0d1016; }
.wn-shot img { width: 100%; height: 100%; object-fit: cover; transform-origin: center; }
.wn-shot.empty { background: transparent; border: 4px dashed color-mix(in srgb, var(--accent) 70%, transparent); box-sizing: border-box; }
.wn-shot.empty span { font-size: 40px; color: var(--accent); }
.wn-cap { margin-top: 30px; font-size: 52px; font-weight: 700; white-space: nowrap; text-shadow: var(--text-shadow); }
</style>
