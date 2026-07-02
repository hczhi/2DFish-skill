<template>
  <div class="consultant-view">
    <div class="chat-messages" ref="messagesEl">
      <div class="system-msg">专业顾问模式 — 直接、务实、可执行的建议</div>
      <div v-for="msg in messages" :key="msg.id" class="message" :class="msg.role">
        <div class="message-content" v-html="renderMarkdown(msg.content)"></div>
      </div>
      <div v-if="streaming" class="message assistant">
        <div class="message-content">{{ streamContent }}<span class="cursor">|</span></div>
      </div>
    </div>

    <div class="chat-input-area">
      <textarea v-model="input" placeholder="向顾问提问..." @keydown.enter.exact.prevent="sendMessage" rows="1"></textarea>
      <button v-if="streaming" @click="stopStreaming" class="stop-btn">停止</button>
      <button v-else @click="sendMessage" :disabled="!input.trim()">发送</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick } from 'vue'
import { apiGet } from '../../lib/api'
import { streamSSE } from '../../lib/sse'

interface Message { id: string; role: string; content: string; created_at: string }

const messages = ref<Message[]>([])
const input = ref('')
const streaming = ref(false)
const streamContent = ref('')
const messagesEl = ref<HTMLElement>()
let abortController: AbortController | null = null

onMounted(async () => {
  try {
    const data = await apiGet<Message[]>('/api/consultant/messages')
    messages.value = data
  } catch {}
})

onUnmounted(() => { abortController?.abort() })

function scrollToBottom() { nextTick(() => { if (messagesEl.value) messagesEl.value.scrollTop = messagesEl.value.scrollHeight }) }
function renderMarkdown(text: string): string {
  return text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`(.+?)`/g, '<code>$1</code>').replace(/\n/g, '<br>')
}

function stopStreaming() { abortController?.abort() }

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
    url: '/api/consultant/stream',
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
.consultant-view { height: 100%; display: flex; flex-direction: column; }
.system-msg { text-align: center; color: var(--text-muted); font-size: 12px; padding: 8px; }
.chat-messages { flex: 1; overflow-y: auto; padding: 24px; display: flex; flex-direction: column; gap: 16px; }
.message { max-width: 80%; padding: 12px 16px; border-radius: 12px; font-size: 14px; line-height: 1.6; }
.message.user { align-self: flex-end; background: var(--primary); color: white; }
.message.assistant { align-self: flex-start; background: var(--bg); border: 1px solid var(--border-light); }
.cursor { animation: blink 1s infinite; }
@keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }
.chat-input-area { padding: 16px 24px; border-top: 1px solid var(--border); display: flex; gap: 12px; }
.chat-input-area textarea { flex: 1; padding: 12px 16px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg); color: var(--text); font-size: 14px; resize: none; outline: none; font-family: var(--font-sans); }
.chat-input-area button { padding: 12px 20px; background: var(--primary); color: white; border: none; border-radius: 8px; font-size: 14px; cursor: pointer; }
.chat-input-area button:disabled { opacity: 0.5; }
.chat-input-area .stop-btn { background: #ef4444; }
.chat-input-area .stop-btn:hover { background: #dc2626; }
</style>
