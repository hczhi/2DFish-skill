<script setup lang="ts">
import { computed } from 'vue'
import { easeOutBack, easeOutCubic, lerp, progress } from './timeline'
import { useCardBase } from './cardBase'

// 「手机通知」卡：iOS 风格的通知横幅从上面弹下来（回弹一下），App 图标 + App 名 + 「现在」+ 标题 + 正文。
// 内容只写原话里说了的（「突然收到一条消息，说……」）；图标可以上传，不传就用 App 名第一个字。
export interface NotifyData { app: string; icon: string; title: string; body: string; accent: string; panel: boolean; duration: number }
const props = defineProps<{ data: NotifyData; t: number }>()
const emit = defineEmits<{ size: [{ w: number; h: number }] }>()
const { root, rootStyle } = useCardBase(props, emit)

const bannerStyle = computed(() => {
  const p = progress(props.t, 0, 0.55)
  return { opacity: Math.min(1, p * 3), transform: `translateY(${lerp(-160, 0, easeOutBack(p))}px)` }
})
const textStyle = computed(() => ({ opacity: easeOutCubic(progress(props.t, 0.35, 0.7)) }))
</script>

<template>
  <div ref="root" class="nt" :style="rootStyle">
    <div class="nt-banner" :style="bannerStyle">
      <div class="nt-top">
        <span class="nt-icon"><img v-if="data.icon" :src="data.icon" alt="" /><b v-else>{{ [...(data.app || '·')][0] }}</b></span>
        <span class="nt-app">{{ data.app }}</span>
        <span class="nt-time">现在</span>
      </div>
      <div class="nt-text" :style="textStyle">
        <div v-if="data.title" class="nt-title">{{ data.title }}</div>
        <div class="nt-body">{{ data.body }}</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.nt { position: relative; display: inline-block; padding: 20px; font-family: -apple-system, var(--font-cn); }
.nt-banner {
  width: 1000px; padding: 30px 36px 34px; border-radius: 48px; box-sizing: border-box;
  background: rgba(246, 246, 248, 0.97); color: #111; /* 不用毛玻璃：导出时后面没有画面可模糊（见 CardShell） */
  box-shadow: 0 30px 70px rgba(0, 0, 0, 0.35), inset 0 0 0 1px rgba(255, 255, 255, 0.6);
}
.nt-top { display: flex; align-items: center; gap: 18px; }
.nt-icon { width: 64px; height: 64px; border-radius: 16px; overflow: hidden; display: grid; place-items: center; background: var(--accent); flex: none; }
.nt-icon img { width: 100%; height: 100%; object-fit: cover; }
.nt-icon b { color: #fff; font-size: 36px; }
.nt-app { font-size: 34px; color: #555; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; }
.nt-time { margin-left: auto; font-size: 30px; color: #888; }
.nt-text { margin-top: 18px; }
.nt-title { font-size: 46px; font-weight: 800; margin-bottom: 6px; }
.nt-body { font-size: 42px; line-height: 1.35; color: #222; }
</style>
