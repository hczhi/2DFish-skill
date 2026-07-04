<template>
  <div class="chat-view">
    <div class="chat-messages" ref="messagesEl">
      <div v-for="msg in messages" :key="msg.id" class="message" :class="msg.role">
        <div class="message-content" v-html="renderMarkdown(msg.content)"></div>
      </div>
      <div v-if="streaming" class="message assistant">
        <div class="message-content">{{ streamContent }}<span class="cursor">|</span></div>
      </div>
    </div>

    <div class="chat-input-area">
      <textarea
        v-model="input"
        placeholder="输入消息..."
        @keydown.enter.exact.prevent="sendMessage"
        rows="1"
      ></textarea>
      <button v-if="streaming" @click="stopStreaming" class="stop-btn">停止</button>
      <button v-else @click="sendMessage" :disabled="!input.trim()">发送</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick } from 'vue'
import { apiGet } from '../../lib/api'
import { streamSSE } from '../../lib/sse'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  created_at: string
}

const messages = ref<Message[]>([])
const input = ref('')
const streaming = ref(false)
const streamContent = ref('')
const messagesEl = ref<HTMLElement>()
let abortController: AbortController | null = null

onMounted(async () => {
  try {
    const data = await apiGet<Message[]>('/api/chat/messages')
    messages.value = data
    scrollToBottom()
  } catch {}
})

onUnmounted(() => { abortController?.abort() })

function scrollToBottom() {
  nextTick(() => {
    if (messagesEl.value) {
      messagesEl.value.scrollTop = messagesEl.value.scrollHeight
    }
  })
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderMarkdown(text: string): string {
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/\n/g, '<br>')
}

function stopStreaming() {
  abortController?.abort()
}

async function sendMessage() {
  const text = input.value.trim()
  if (!text || streaming.value) return

  messages.value.push({ id: Date.now().toString(), role: 'user', content: text, created_at: new Date().toISOString() })
  input.value = ''
  streaming.value = true
  streamContent.value = ''
  scrollToBottom()

  abortController = new AbortController()
  const timeoutId = setTimeout(() => abortController?.abort(), 120_000)

  await streamSSE({
    url: '/api/chat/stream',
    body: { message: text },
    signal: abortController.signal,
    onContent: (content) => {
      streamContent.value += content
      scrollToBottom()
    },
    onError: (err) => {
      messages.value.push({ id: Date.now().toString(), role: 'assistant', content: `[错误] ${err}`, created_at: new Date().toISOString() })
    },
    onDone: () => {
      if (streamContent.value) {
        messages.value.push({ id: Date.now().toString(), role: 'assistant', content: streamContent.value, created_at: new Date().toISOString() })
      }
    },
  })

  clearTimeout(timeoutId)
  streaming.value = false
  streamContent.value = ''
  abortController = null
  scrollToBottom()
}
</script>

<style scoped>
.chat-view {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-6) var(--space-8);
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.message {
  max-width: 80%;
  padding: 12px 16px;
  border-radius: var(--radius-lg);
  font-size: 14px;
  line-height: 1.6;
}
.message.user {
  align-self: flex-end;
  background: var(--text);
  color: var(--text-inverse);
  border-bottom-right-radius: 4px;
  box-shadow: var(--shadow-sm);
}
.message.assistant {
  align-self: flex-start;
  background: var(--bg);
  border: 1px solid var(--border-light);
  border-bottom-left-radius: 4px;
  box-shadow: var(--shadow-sm);
}

.message-content :deep(code) {
  background: var(--bg-secondary);
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 13px;
  font-family: var(--font-mono);
}

.cursor { animation: blink 1s infinite; }
@keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }

.chat-input-area {
  padding: var(--space-4) var(--space-6);
  border-top: 1px solid var(--border-light);
  display: flex;
  gap: var(--space-3);
  background: var(--bg);
}

.chat-input-area textarea {
  flex: 1;
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg);
  color: var(--text);
  font-size: 14px;
  resize: none;
  outline: none;
  font-family: var(--font-sans);
  transition: border-color 0.2s;
}
.chat-input-area textarea:focus { border-color: var(--primary); box-shadow: 0 0 0 2px var(--primary-subtle); }

.chat-input-area button {
  padding: 0 var(--space-4);
  background: var(--primary);
  color: var(--text-inverse);
  border: none;
  border-radius: var(--radius-md);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.2s;
}
.chat-input-area button:disabled { background: var(--bg-secondary); color: var(--text-muted); cursor: not-allowed; }
.chat-input-area .stop-btn { background: #ef4444; }
.chat-input-area .stop-btn:hover { background: #dc2626; }
</style>
