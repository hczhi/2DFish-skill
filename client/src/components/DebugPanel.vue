<template>
  <div class="debug-panel" :class="{ collapsed: !expanded }">
    <div class="debug-header" @click="expanded = !expanded">
      <span class="debug-title">
        <span class="dot" :class="latestStatus"></span>
        AI 调试面板
      </span>
      <span class="debug-meta">
        {{ logs.length }} 条记录 | Token: {{ formatTokens(totalTokens) }}
      </span>
      <span class="toggle">{{ expanded ? '▼' : '▲' }}</span>
    </div>
    <div v-if="expanded" class="debug-body">
      <div class="debug-toolbar">
        <button @click="clearLogs">清空</button>
        <label class="toggle-raw">
          <input type="checkbox" v-model="showRaw" />
          原始数据
        </label>
        <div class="token-stats">
          <span class="token-label">Prompt: {{ formatTokens(promptTokens) }}</span>
          <span class="token-label">Completion: {{ formatTokens(completionTokens) }}</span>
          <span class="token-label">Total: {{ formatTokens(totalTokens) }}</span>
          <span class="token-label">Requests: {{ requestCount }}</span>
        </div>
      </div>
      <div class="log-list">
        <div
          v-for="log in logs"
          :key="log.id"
          class="log-entry"
          :class="log.type"
        >
          <div class="log-header">
            <span class="log-type-badge" :class="log.type">
              {{ log.type === 'request' ? '请求' : log.type === 'response' ? '响应' : '错误' }}
            </span>
            <span class="log-time">{{ log.timestamp }}</span>
            <span v-if="log.duration" class="log-duration">{{ log.duration }}ms</span>
          </div>

          <div v-if="log.type === 'request' && log.request" class="log-content">
            <span class="log-detail">模型: {{ log.request.model }}</span>
            <span class="log-detail">鱼: {{ log.request.fishCount }}条</span>
            <span class="log-detail">食物: {{ log.request.foodCount }}个</span>
          </div>

          <div v-if="log.type === 'response' && log.response" class="log-content">
            <div class="decisions-list">
              <div
                v-for="d in log.response.decisions"
                :key="d.id"
                class="decision-item"
              >
                <span class="fish-name">{{ d.name }}</span>
                <span class="action-badge">{{ d.action }}</span>
                <span v-if="d.target" class="target-info">&#8594; {{ d.target }}</span>
                <span class="urgency-bar">
                  <span class="urgency-fill" :style="{ width: (d.urgency * 100) + '%' }"></span>
                </span>
              </div>
            </div>
          </div>

          <div v-if="log.type === 'error'" class="log-content error-content">
            {{ log.error }}
          </div>

          <details v-if="showRaw && (log.rawRequest || log.rawResponse)" class="raw-data">
            <summary>原始JSON</summary>
            <pre>{{ log.rawRequest || log.rawResponse }}</pre>
          </details>
        </div>

        <div v-if="logs.length === 0" class="empty-state">
          暂无AI通信记录。配置API后将自动开始。
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { AILogger, type AILogEntry } from '../game/AILogger'

const expanded = ref(false)
const showRaw = ref(false)
const logs = ref<AILogEntry[]>(AILogger.getLogs())
const totalTokens = ref(AILogger.totalTokens)
const promptTokens = ref(AILogger.totalPromptTokens)
const completionTokens = ref(AILogger.totalCompletionTokens)
const requestCount = ref(AILogger.requestCount)

const latestStatus = ref<'idle' | 'request' | 'response' | 'error'>('idle')

let unsubscribe: (() => void) | null = null

onMounted(() => {
  unsubscribe = AILogger.subscribe((newLogs) => {
    logs.value = [...newLogs]
    totalTokens.value = AILogger.totalTokens
    promptTokens.value = AILogger.totalPromptTokens
    completionTokens.value = AILogger.totalCompletionTokens
    requestCount.value = AILogger.requestCount
    if (newLogs.length > 0) {
      latestStatus.value = newLogs[0].type
    }
  })
})

onUnmounted(() => {
  unsubscribe?.()
})

function formatTokens(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M'
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k'
  return String(n)
}

function clearLogs() {
  AILogger.clear()
  totalTokens.value = 0
  promptTokens.value = 0
  completionTokens.value = 0
  requestCount.value = 0
}
</script>

<style scoped>
.debug-panel {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  max-height: 50vh;
  background: rgba(15, 23, 42, 0.95);
  backdrop-filter: blur(12px);
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  z-index: 50;
  display: flex;
  flex-direction: column;
  font-family: 'SF Mono', 'Fira Code', monospace;
  font-size: 12px;
  transition: max-height 0.3s ease;
}

.debug-panel.collapsed {
  max-height: 36px;
}

.debug-header {
  display: flex;
  align-items: center;
  padding: 8px 16px;
  cursor: pointer;
  user-select: none;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  flex-shrink: 0;
}

.debug-header:hover {
  background: rgba(255, 255, 255, 0.03);
}

.debug-title {
  color: #e2e8f0;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 8px;
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #475569;
}

.dot.request {
  background: #3b82f6;
  animation: pulse 1s infinite;
}

.dot.response {
  background: #4caf50;
}

.dot.error {
  background: #f44336;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

.debug-meta {
  margin-left: auto;
  color: #64748b;
}

.toggle {
  margin-left: 12px;
  color: #64748b;
  font-size: 10px;
}

.debug-body {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.debug-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.debug-toolbar button {
  padding: 4px 10px;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 4px;
  color: #94a3b8;
  font-size: 11px;
  cursor: pointer;
}

.debug-toolbar button:hover {
  background: rgba(255, 255, 255, 0.12);
  color: #e2e8f0;
}

.toggle-raw {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #64748b;
  font-size: 11px;
  cursor: pointer;
}

.toggle-raw input {
  margin: 0;
}

.token-stats {
  display: flex;
  gap: 12px;
  margin-left: auto;
}

.token-label {
  color: #64748b;
  font-size: 11px;
}

.token-label:last-child {
  color: #94a3b8;
  font-weight: 500;
}

.log-list {
  overflow-y: auto;
  padding: 8px 16px;
  flex: 1;
}

.log-entry {
  padding: 10px 12px;
  margin-bottom: 6px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
}

.log-entry.error {
  border-color: rgba(244, 67, 54, 0.3);
  background: rgba(244, 67, 54, 0.05);
}

.log-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 6px;
}

.log-type-badge {
  padding: 2px 6px;
  border-radius: 3px;
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
}

.log-type-badge.request {
  background: rgba(59, 130, 246, 0.2);
  color: #60a5fa;
}

.log-type-badge.response {
  background: rgba(76, 175, 80, 0.2);
  color: #81c784;
}

.log-type-badge.error {
  background: rgba(244, 67, 54, 0.2);
  color: #ef5350;
}

.log-time {
  color: #475569;
}

.log-duration {
  color: #94a3b8;
  font-size: 11px;
}

.log-content {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.log-detail {
  color: #94a3b8;
  background: rgba(255, 255, 255, 0.05);
  padding: 2px 8px;
  border-radius: 3px;
}

.decisions-list {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.decision-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 4px;
}

.fish-name {
  color: #e2e8f0;
  font-weight: 500;
  min-width: 60px;
}

.action-badge {
  padding: 2px 8px;
  border-radius: 3px;
  background: rgba(59, 130, 246, 0.15);
  color: #93c5fd;
  font-size: 11px;
}

.target-info {
  color: #64748b;
  font-size: 11px;
}

.urgency-bar {
  width: 40px;
  height: 4px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 2px;
  overflow: hidden;
  margin-left: auto;
}

.urgency-fill {
  display: block;
  height: 100%;
  background: linear-gradient(90deg, #4caf50, #ff9800, #f44336);
  border-radius: 2px;
  transition: width 0.3s;
}

.error-content {
  color: #ef5350;
  font-size: 12px;
}

.raw-data {
  margin-top: 8px;
}

.raw-data summary {
  color: #475569;
  cursor: pointer;
  font-size: 11px;
}

.raw-data summary:hover {
  color: #94a3b8;
}

.raw-data pre {
  margin-top: 6px;
  padding: 8px;
  background: rgba(0, 0, 0, 0.3);
  border-radius: 4px;
  color: #94a3b8;
  font-size: 10px;
  overflow-x: auto;
  max-height: 200px;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-all;
}

.empty-state {
  color: #475569;
  text-align: center;
  padding: 20px;
}
</style>
