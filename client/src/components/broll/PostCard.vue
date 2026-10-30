<script setup lang="ts">
import { computed } from 'vue'
import { easeOutBack, easeOutCubic, lerp, progress } from './timeline'
import { useCardBase } from './cardBase'

// 「社交帖子」卡：一张帖子（头像 + 用户名 + 正文 + 可选配图），点赞数 / 评论数从 0 跳上去，心形「啵」一下变红。
// **只能手动填、AI 不配**：AI 编的点赞数和用户名读起来跟真的一样。默认带「示意」小标，拿真实帖子时可以关掉。
export interface PostData { user: string; avatar: string; text: string; img: string; likes: string; comments: string; mock: boolean; accent: string; panel: boolean; duration: number }
const props = defineProps<{ data: PostData; t: number }>()
const emit = defineEmits<{ size: [{ w: number; h: number }] }>()
const { root, rootStyle } = useCardBase(props, emit)

const COUNT_AT = 0.8
const cardStyle = computed(() => {
  const p = progress(props.t, 0, 0.5)
  return { opacity: easeOutCubic(p), transform: `translateY(${lerp(50, 0, easeOutCubic(p))}px) scale(${lerp(0.9, 1, easeOutBack(p))})` }
})
const count = (raw: string) => {
  const n = Number(String(raw).replace(/,/g, ''))
  if (!String(raw).trim() || !Number.isFinite(n)) return raw
  const v = Math.round(n * easeOutCubic(progress(props.t, COUNT_AT, COUNT_AT + 1.1)))
  return v >= 10000 ? `${(v / 10000).toFixed(1)}万` : v.toLocaleString('en-US')
}
const heartStyle = computed(() => {
  const p = progress(props.t, COUNT_AT + 0.6, COUNT_AT + 0.95)
  return { transform: `scale(${1 + Math.sin(p * Math.PI) * 0.45})`, fill: p > 0 ? '#ff3b5c' : 'none' }
})
</script>

<template>
  <div ref="root" class="ps" :style="rootStyle">
    <div class="ps-card" :style="cardStyle">
      <span v-if="data.mock" class="ps-tag">示意</span>
      <div class="ps-head">
        <span class="ps-av"><img v-if="data.avatar" :src="data.avatar" alt="" /><b v-else>{{ [...(data.user || '?')][0] }}</b></span>
        <span class="ps-user">{{ data.user }}</span>
      </div>
      <div class="ps-text">{{ data.text }}</div>
      <div v-if="data.img" class="ps-img"><img :src="data.img" alt="" /></div>
      <div class="ps-foot">
        <span><svg viewBox="0 0 24 24" class="ps-heart" :style="heartStyle"><path d="M12 21s-7.5-4.6-9.5-9.3C1 8 3.4 4.5 7 4.5c2 0 3.6 1.1 5 3 1.4-1.9 3-3 5-3 3.6 0 6 3.5 4.5 7.2C19.5 16.4 12 21 12 21z" /></svg>{{ count(data.likes) }}</span>
        <span v-if="data.comments">💬 {{ count(data.comments) }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ps { position: relative; display: inline-block; padding: 20px; font-family: -apple-system, var(--font-cn); }
.ps-card { position: relative; width: 860px; padding: 36px 40px 30px; border-radius: 32px; background: #fff; color: #111; box-sizing: border-box; box-shadow: 0 30px 70px rgba(0, 0, 0, 0.35); }
.ps-tag { position: absolute; right: 26px; top: 22px; padding: 2px 14px; border-radius: 8px; font-size: 24px; color: #888; background: #f1f1f1; }
.ps-head { display: flex; align-items: center; gap: 18px; margin-bottom: 20px; }
.ps-av { width: 72px; height: 72px; border-radius: 50%; overflow: hidden; display: grid; place-items: center; background: var(--accent); flex: none; }
.ps-av img { width: 100%; height: 100%; object-fit: cover; }
.ps-av b { color: #fff; font-size: 36px; }
.ps-user { font-size: 38px; font-weight: 700; }
.ps-text { font-size: 44px; line-height: 1.45; }
.ps-img { margin-top: 20px; height: 380px; border-radius: 18px; overflow: hidden; background: #eee; }
.ps-img img { width: 100%; height: 100%; object-fit: cover; }
.ps-foot { display: flex; gap: 50px; margin-top: 24px; font-size: 36px; color: #555; }
.ps-foot span { display: inline-flex; align-items: center; gap: 12px; }
.ps-heart { width: 44px; height: 44px; stroke: #ff3b5c; stroke-width: 2; }
</style>
