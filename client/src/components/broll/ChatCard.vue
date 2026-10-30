<script setup lang="ts">
import { computed } from 'vue'
import { easeOutBack, easeOutCubic, lerp, progress, stagger } from './timeline'
import { useCardBase } from './cardBase'
import CardShell from './CardShell.vue'
import { cueAt } from './cues'

// 「聊天对话」卡：聊天窗口，对方的消息先出「正在输入…」三个点再冒出来，我的消息直接弹出（右侧、强调色）。
// 每行一条，「我：」开头的是我说的，其余是对方。对话摘原话（「客户跟我说……我回他……」）。
// 每条可以单独定出现时间（data.cues[i] = 这条气泡冒出来的时刻）；对方的「正在输入」在它前面 0.35 秒。
export interface ChatData { name: string; messages: string[]; cues?: (number | null)[]; accent: string; panel: boolean; duration: number }
const props = defineProps<{ data: ChatData; t: number }>()
const emit = defineEmits<{ size: [{ w: number; h: number }] }>()
const { root, rootStyle } = useCardBase(props, emit)

const AT = 0.5
const STEP = 0.75
const msgs = computed(() =>
  props.data.messages.filter((s) => s.trim()).map((s) => {
    const m = s.trim().match(/^(我|对方)\s*[:：]\s*(.*)$/)
    return m ? { me: m[1] === '我', text: m[2] } : { me: false, text: s.trim() }
  }),
)
// 对方的消息：前 0.35 秒是「正在输入」三个点
const TYPING = 0.35
const msgAt = (i: number) => cueAt(props.data.cues, i, AT + i * STEP + (msgs.value[i].me ? 0 : TYPING))
const typingOn = (i: number) => !msgs.value[i].me && props.t >= msgAt(i) - TYPING && props.t < msgAt(i)
const msgStyle = (i: number) => {
  const a = msgAt(i)
  const p = progress(props.t, a, a + 0.4)
  return { opacity: easeOutCubic(p), transform: `translateY(${lerp(24, 0, easeOutCubic(p))}px) scale(${lerp(0.85, 1, easeOutBack(p))})` }
}
const dot = (k: number) => ({ opacity: 0.35 + 0.65 * Math.max(0, Math.sin(props.t * 12 - k * 1.2)) })
const headStyle = computed(() => ({ opacity: easeOutCubic(progress(props.t, 0, 0.4)) }))
</script>

<template>
  <div ref="root" class="ct" :style="rootStyle">
    <CardShell v-if="data.panel" :t="t" :duration="data.duration" />
    <div class="ct-head" :style="headStyle"><span class="ct-av">{{ [...(data.name || '?')][0] }}</span>{{ data.name }}</div>
    <div v-for="(m, i) in msgs" :key="i" class="ct-row" :class="{ me: m.me }">
      <div v-if="typingOn(i)" class="ct-bubble typing"><i :style="dot(0)" /><i :style="dot(1)" /><i :style="dot(2)" /></div>
      <div v-else class="ct-bubble" :style="msgStyle(i)">{{ m.text }}</div>
    </div>
  </div>
</template>

<style scoped>
.ct { position: relative; display: inline-flex; flex-direction: column; min-width: 960px; padding: 40px 60px 44px; box-sizing: border-box; color: var(--fg); font-family: var(--font-cn); }
.ct-head { position: relative; display: flex; align-items: center; gap: 20px; font-size: 42px; font-weight: 700; padding-bottom: 24px; margin-bottom: 28px; border-bottom: 1px solid var(--line); }
.ct-av { width: 64px; height: 64px; border-radius: 50%; display: grid; place-items: center; font-size: 32px; color: var(--ink-on-accent); background: var(--accent); }
.ct-row { position: relative; display: flex; margin-bottom: 22px; }
.ct-row.me { justify-content: flex-end; }
.ct-bubble { max-width: 760px; padding: 22px 32px; border-radius: 30px 30px 30px 8px; font-size: 48px; line-height: 1.35; background: var(--tile); box-shadow: 0 10px 24px var(--shadow-c); transform-origin: left bottom; }
.ct-row.me .ct-bubble { border-radius: 30px 30px 8px 30px; color: var(--ink-on-accent); background: var(--accent); transform-origin: right bottom; }
.ct-bubble.typing { display: flex; gap: 12px; padding: 30px 34px; }
.ct-bubble.typing i { width: 16px; height: 16px; border-radius: 50%; background: var(--mute); }
</style>
