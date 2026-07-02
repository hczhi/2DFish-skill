<template>
  <transition name="slide-right">
    <div class="log-panel" v-if="visible">
      <div class="log-header">
        <span class="log-title">日志</span>
        <button class="log-close" @click="$emit('close')">x</button>
      </div>
      <div class="log-body" ref="bodyRef">
        <div v-if="logs.length === 0" class="log-empty">暂无记录</div>
        <div v-for="(log, i) in logs" :key="i" class="log-entry">
          <div class="log-time">{{ formatTime(log.timestamp) }}</div>
          <div class="log-section">
            <span class="log-label">输入</span>
            <span class="log-value">{{ log.input }}</span>
          </div>
          <div class="log-section" v-if="log.key_sentence">
            <span class="log-label">关键句</span>
            <span class="log-value log-highlight">{{ log.key_sentence }}</span>
          </div>
          <div class="log-section" v-if="log.interpretation">
            <span class="log-label">解析</span>
            <span class="log-value">{{ log.interpretation }}</span>
          </div>
          <div class="log-section" v-if="log.usage">
            <span class="log-label">Token</span>
            <span class="log-value log-token">
              {{ log.usage.prompt_tokens }} + {{ log.usage.completion_tokens }} = {{ log.usage.total_tokens }}
            </span>
          </div>
          <div class="log-section" v-if="log.keyword">
            <span class="log-label">关键词</span>
            <span class="log-value">{{ log.keyword }} · {{ log.domain }}</span>
          </div>
        </div>
      </div>
    </div>
  </transition>
</template>

<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'

export interface LogEntry {
  timestamp: number
  input: string
  keyword?: string
  key_sentence?: string
  interpretation?: string
  domain?: string
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}

defineProps<{
  visible: boolean
  logs: LogEntry[]
}>()

defineEmits<{ close: [] }>()

const bodyRef = ref<HTMLElement>()

watch(() => bodyRef.value, async () => {
  await nextTick()
  if (bodyRef.value) {
    bodyRef.value.scrollTop = bodyRef.value.scrollHeight
  }
})

function formatTime(ts: number): string {
  const d = new Date(ts)
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`
}
</script>

<style scoped>
.log-panel {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  width: 360px;
  max-width: 90vw;
  background: rgba(244, 240, 230, 0.98); /* 提高不透明度，移除 blur */
  border-left: 1px solid rgba(44, 40, 38, 0.1);
  z-index: 80;
  display: flex;
  flex-direction: column;
  box-shadow: -4px 0 20px rgba(100, 80, 60, 0.05);
}

.log-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px;
  border-bottom: 1px solid rgba(44, 40, 38, 0.08);
}

.log-title {
  font-size: 14px;
  color: #8c221c; /* 朱砂红标题 */
  letter-spacing: 4px;
  font-weight: bold;
}

.log-close {
  background: none;
  border: none;
  color: rgba(44, 40, 38, 0.4);
  font-size: 18px;
  cursor: pointer;
  padding: 4px 8px;
  font-family: 'Noto Serif SC', serif;
}

.log-close:hover {
  color: rgba(44, 40, 38, 0.8);
}

.log-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px;
}

.log-empty {
  color: rgba(44, 40, 38, 0.3);
  font-size: 13px;
  text-align: center;
  padding: 40px 0;
  letter-spacing: 2px;
}

.log-entry {
  margin-bottom: 24px;
  padding-bottom: 20px;
  border-bottom: 1px dashed rgba(44, 40, 38, 0.1);
}

.log-entry:last-child {
  border-bottom: none;
}

.log-time {
  font-size: 11px;
  color: rgba(44, 40, 38, 0.3);
  font-family: 'Courier New', monospace;
  margin-bottom: 8px;
}

.log-section {
  margin-bottom: 6px;
  display: flex;
  gap: 12px;
  align-items: flex-start;
}

.log-label {
  font-size: 12px;
  color: #8c221c; /* 标签用朱砂红 */
  min-width: 42px;
  flex-shrink: 0;
  padding-top: 2px;
  font-weight: bold;
}

.log-value {
  font-size: 13px;
  color: rgba(44, 40, 38, 0.8);
  line-height: 1.6;
  word-break: break-word;
  letter-spacing: 1px;
}

.log-highlight {
  color: #2c2826;
  font-weight: bold;
}

.log-token {
  font-family: 'Courier New', monospace;
  color: rgba(44, 40, 38, 0.4);
}

/* Scrollbar */
.log-body::-webkit-scrollbar {
  width: 4px;
}

.log-body::-webkit-scrollbar-track {
  background: transparent;
}

.log-body::-webkit-scrollbar-thumb {
  background: rgba(44, 40, 38, 0.15);
  border-radius: 2px;
}

/* Transition */
.slide-right-enter-active,
.slide-right-leave-active {
  transition: transform 0.3s ease;
}

.slide-right-enter-from,
.slide-right-leave-to {
  transform: translateX(100%);
}
</style>
