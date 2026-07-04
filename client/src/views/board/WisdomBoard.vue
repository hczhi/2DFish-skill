<template>
  <div class="board-app">
    <div class="global-grid"></div>

    <div class="main-content">
      <SplitFlapBoard ref="boardRef" />

      <transition name="blur-fade">
        <div class="prompt-hint" v-if="!showInput && !isLoading" @click="openInput">
          <span class="hint-text">点击此处 · 倾诉心事</span>
        </div>
      </transition>

      <transition name="blur-fade">
        <div class="loading-hint" v-if="isLoading">
          <span class="loading-text">静候回响</span>
        </div>
      </transition>
    </div>

    <transition name="expand">
      <div class="expand-overlay" v-if="expandingText">
        <div class="expand-text">{{ expandingText }}</div>
      </div>
    </transition>

    <transition name="fade">
      <div class="input-overlay" v-if="showInput" @click.self="closeInput">
        <div class="input-panel">
          <textarea
            ref="inputRef"
            v-model="inputText"
            placeholder="有何困惑？"
            @keydown.enter.prevent="handleSend"
            @keydown.escape="closeInput"
            maxlength="200"
          ></textarea>
          <button class="seal-btn" @click="handleSend" :disabled="!inputText.trim()">问</button>
        </div>
      </div>
    </transition>

    <div class="bottom-buttons">
      <router-link to="/" class="seal-btn small" title="首页">首</router-link>
      <!-- <button
        class="seal-btn small"
        :class="{ 'dark-mode': chatMode === 'dark' }"
        @click="toggleMode"
      >{{ chatMode === 'wisdom' ? '明' : '暗' }}</button> -->
      <button class="seal-btn small" @click="showLog = !showLog">记</button>
    </div>

    <LogPanel :visible="showLog" :logs="logs" @close="showLog = false" />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, nextTick } from 'vue'
import SplitFlapBoard from '../../components/board/SplitFlapBoard.vue'
import LogPanel from '../../components/board/LogPanel.vue'
import { authFetch, getToken } from '../../lib/auth'

interface LogEntry {
  timestamp: number
  input: string
  keyword?: string
  key_sentence?: string
  interpretation?: string
  domain?: string
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
}

const boardRef = ref<InstanceType<typeof SplitFlapBoard>>()
const showInput = ref(false)
const showLog = ref(false)
const isLoading = ref(false)
const inputText = ref('')
const inputRef = ref<HTMLTextAreaElement>()
const logs = ref<LogEntry[]>([])
const expandingText = ref('')
const chatMode = ref<'wisdom' | 'dark'>(
  (localStorage.getItem('mmboard_mode') as 'wisdom' | 'dark') || 'wisdom'
)

onMounted(() => {
  setTimeout(() => {
    boardRef.value?.startWelcome('静心\n点击下方 倾诉心事')
  }, 600)
})

function openInput() {
  showInput.value = true
  nextTick(() => inputRef.value?.focus())
}

function closeInput() {
  showInput.value = false
  inputText.value = ''
}

function toggleMode() {
  chatMode.value = chatMode.value === 'wisdom' ? 'dark' : 'wisdom'
  localStorage.setItem('mmboard_mode', chatMode.value)
}

async function handleSend() {
  const message = inputText.value.trim()
  if (!message) return

  closeInput()
  expandingText.value = message
  await new Promise(r => setTimeout(r, 800))
  expandingText.value = ''

  isLoading.value = true
  boardRef.value?.startLoading()

  try {
    const res = await authFetch('/api/ai/board/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, mode: chatMode.value }),
    })

    if (!res.ok) {
      const err = await res.json()
      throw new Error(err.error || '请求失败')
    }

    const data = await res.json()

    logs.value.push({
      timestamp: Date.now(),
      input: message,
      keyword: data.keyword,
      key_sentence: data.key_sentence,
      interpretation: data.interpretation,
      domain: data.domain,
      usage: data.usage,
    })

    if (data.keyword && data.key_sentence) {
      await boardRef.value?.displayWisdomSequence(
        { keyword: data.keyword, key_sentence: data.key_sentence, interpretation: data.interpretation },
        data.layout || { type: 'wisdom', keyword_color: [107, 44, 37], sentence_color: [44, 40, 38] },
      )
    } else {
      boardRef.value?.stopWaiting()
      boardRef.value?.displayText(data.key_sentence || data.interpretation || message)
    }
  } catch (err: any) {
    boardRef.value?.stopWaiting()
    boardRef.value?.displayText(err.message || '请求失败')
    logs.value.push({ timestamp: Date.now(), input: message, interpretation: `[错误] ${err.message}` })
  } finally {
    isLoading.value = false
  }
}
</script>

<style scoped>
@font-face {
  font-family: "TsangerJinKai02";
  src: url("/fonts/TsangerJinKai02-W04.ttf") format("truetype");
  font-weight: 400 500;
  font-style: normal;
  font-display: swap;
}

.board-app {
  width: 100vw;
  height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  position: relative;
  background: #f5f4ed;
  font-family: "TsangerJinKai02", "Songti SC", Georgia, serif;
  color: #141413;
}


.global-grid {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background-image:
    linear-gradient(to right, rgba(100, 80, 60, 0.04) 1px, transparent 1px),
    linear-gradient(to bottom, rgba(100, 80, 60, 0.04) 1px, transparent 1px);
  background-size: 40px 40px;
  mask-image: radial-gradient(circle at center, black 40%, transparent 100%);
}

.main-content {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 32px;
}

.prompt-hint {
  cursor: pointer;
  padding: 24px 10px;
  writing-mode: vertical-rl;
  text-orientation: upright;
  border-left: 1px solid rgba(44, 40, 38, 0.15);
  position: absolute;
  right: -60px;
  top: 50%;
  transform: translateY(-50%);
}
.prompt-hint:hover { border-left-color: rgba(44, 40, 38, 0.4); }

.hint-text {
  font-size: 14px;
  color: rgba(44, 40, 38, 0.6);
  letter-spacing: 6px;
}

.loading-hint {
  writing-mode: vertical-rl;
  text-orientation: upright;
  position: absolute;
  right: -60px;
  top: 50%;
  transform: translateY(-50%);
}
.loading-text {
  font-size: 14px;
  color: rgba(44, 40, 38, 0.6);
  letter-spacing: 8px;
  animation: breathe 3s infinite ease-in-out;
}
@keyframes breathe { 0%, 100% { opacity: 0.4; } 50% { opacity: 0.8; } }

.expand-overlay { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; z-index: 40; pointer-events: none; }
.expand-text { font-size: 28px; color: rgba(44, 40, 38, 0.7); letter-spacing: 8px; writing-mode: vertical-rl; }
.expand-enter-active { transition: all 1s cubic-bezier(0.23, 1, 0.32, 1); }
.expand-leave-active { transition: all 0.8s cubic-bezier(0.55, 0, 1, 0.45); }
.expand-enter-from { opacity: 0; transform: scale(0.8); }
.expand-leave-to { opacity: 0; transform: scale(2.5); }

.input-overlay { position: fixed; inset: 0; background: rgba(244, 240, 230, 0.95); display: flex; align-items: center; justify-content: center; z-index: 50; }
.input-panel { display: flex; gap: 20px; align-items: center; padding: 30px 40px; background: rgba(250, 248, 244, 0.95); border-radius: 8px; box-shadow: 0 10px 40px rgba(100, 80, 60, 0.08); border: 1px solid rgba(44, 40, 38, 0.08); }
.input-panel textarea { height: 48px; width: 480px; font-size: 18px; padding: 10px 16px; border: none; border-bottom: 1px solid rgba(44, 40, 38, 0.2); background: transparent; color: #2c2826; font-family: inherit; outline: none; letter-spacing: 2px; resize: none; }
.input-panel textarea:focus { border-bottom-color: #6b2c25; }

.seal-btn { font-size: 16px; width: 48px; height: 48px; background: transparent; color: #6b2c25; border: 2px solid #6b2c25; border-radius: 4px; cursor: pointer; font-family: inherit; display: flex; align-items: center; justify-content: center; text-decoration: none; transition: all 0.3s; }
.seal-btn:hover:not(:disabled) { background: color-mix(in srgb, #6b2c25 8%, transparent); }
.seal-btn:disabled { opacity: 0.2; }
.seal-btn.small { width: 32px; height: 32px; font-size: 14px; border-width: 1.5px; }
.seal-btn.dark-mode { color: #4a3a5c; border-color: #4a3a5c; }

.bottom-buttons { position: absolute; bottom: 30px; left: 30px; display: flex; flex-direction: column; gap: 16px; z-index: 5; }

.fade-enter-active, .fade-leave-active { transition: opacity 0.6s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
.blur-fade-enter-active, .blur-fade-leave-active { transition: all 0.8s ease; }
.blur-fade-enter-from, .blur-fade-leave-to { opacity: 0; }
</style>
