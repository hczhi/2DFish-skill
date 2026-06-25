<template>
  <div class="app" :class="{ 'boss-key-active': isBossKeyActive }">
    <div class="stealth-indicator" v-if="isBossKeyActive">
      >_ 正在运行后台进程... (摸鱼模式: 敲击键盘喂鱼)
    </div>
    
    <GameCanvas
      :fishes="fishes"
      :foods="foods"
      :physicalBubbles="physicalBubbles"
      :shockwaves="shockwaves"
      :boss="storyState.boss"
      :playerControl="playerControlState"
      @feed="handleFeed"
      @pet="handlePet"
      @playerPressStart="handlePlayerPressStart"
      @playerPressEnd="handlePlayerPressEnd"
    />

    <!-- <StoryEventOverlay
      :state="storyState"
      @choice="handleStoryChoice"
    /> -->
    
    <transition name="fade">
      <div class="ui-overlay" v-if="!isBossKeyActive">
        <button class="dock-btn btn-settings" @click="showSettings = true" title="设置">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
        </button>
        <div class="dock-divider"></div>
        <button class="dock-btn btn-add-fish" @click="showAddFish = true">
          <span class="icon">🐡</span>
          <span class="label">引进</span>
        </button>
        <!-- <button class="dock-btn btn-event" @click="handleTriggerEvent" :disabled="storyState.status === 'running'">
          <span class="icon">⚔️</span>
          <span class="label">事件</span>
        </button> -->
      </div>
    </transition>
    
    <SettingsModal
      v-if="showSettings && !isBossKeyActive"
      :config="aiConfig"
      @close="showSettings = false"
      @save="handleSaveConfig"
    />
    <AddFishModal
      v-if="showAddFish && !isBossKeyActive"
      @close="showAddFish = false"
      @add="handleAddFish"
    />
    
    <transition name="fade">
      <FishListPanel :fishes="fishes" v-if="!isBossKeyActive" />
    </transition>
    <transition name="fade">
      <DebugPanel v-if="!isBossKeyActive" />
    </transition>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import GameCanvas from './components/GameCanvas.vue'
import SettingsModal from './components/SettingsModal.vue'
import AddFishModal from './components/AddFishModal.vue'
import DebugPanel from './components/DebugPanel.vue'
import FishListPanel from './components/FishListPanel.vue'
import StoryEventOverlay from './components/StoryEventOverlay.vue'
import { GameEngine } from './game/GameEngine'
import { HOBBY_KNOWLEDGE } from './game/FishFactory'
import type { Fish, Food, AIConfig, PhysicalBubble, PlayerControlState, Shockwave } from './game/types'
import type { StoryEventState } from './game/StoryEventEngine'

const showSettings = ref(false)
const showAddFish = ref(false)
const fishes = ref<Fish[]>([])
const foods = ref<Food[]>([])
const physicalBubbles = ref<PhysicalBubble[]>([])
const shockwaves = ref<Shockwave[]>([])
const storyState = ref<StoryEventState>({
  status: 'idle',
  payload: null,
  currentPhaseIndex: -1,
  phaseTimer: 0,
  boss: null,
  battleResult: 'pending',
  choiceResult: null,
  shakeIntensity: 0,
})

const aiConfig = ref<AIConfig>({
  apiUrl: localStorage.getItem('mmPla_apiUrl') || '',
  apiKey: localStorage.getItem('mmPla_apiKey') || '',
  model: localStorage.getItem('mmPla_model') || '',
})

// Slack Mode (摸鱼模式) state
const isBossKeyActive = ref(false)
const typingCounter = ref(0)
const SLACK_TYPING_THRESHOLD = 15 // Drops food every 15 keystrokes

// Player control state
const playerControlState = ref<PlayerControlState | null>(null)


let engine: GameEngine
let saveInterval: ReturnType<typeof setInterval>

const handleGlobalKeydown = (e: KeyboardEvent) => {
  // Escape: exit player control first, then toggle stealth mode
  if (e.key === 'Escape') {
    if (engine?.playerController.state.active) {
      engine.exitPlayerControl()
      playerControlState.value = null
      return
    }
    isBossKeyActive.value = !isBossKeyActive.value
    return
  }

  // Player control keys
  if (engine?.playerController.state.active) {
    e.preventDefault()
    const pc = engine.playerController

    // In target lock mode, direction keys switch targets
    if (pc.state.targetLockMode && pc.state.keys.a) {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        pc.switchTarget('next')
        playerControlState.value = { ...pc.state }
        return
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        pc.switchTarget('prev')
        playerControlState.value = { ...pc.state }
        return
      }
    }

    pc.handleKeyDown(e.key)
    playerControlState.value = { ...pc.state }
    return
  }

  // If in stealth mode, typing drops fish food automatically!
  if (isBossKeyActive.value) {
    typingCounter.value++
    if (typingCounter.value >= SLACK_TYPING_THRESHOLD) {
      typingCounter.value = 0
      const canvas = document.querySelector('canvas')
      if (canvas) {
        const rect = canvas.getBoundingClientRect()
        const x = Math.random() * rect.width
        const y = -20 // Drop from top
        engine.addFood(x, y)
      }
    }
  }
}

const handleGlobalKeyup = (e: KeyboardEvent) => {
  if (engine?.playerController.state.active) {
    engine.playerController.handleKeyUp(e.key)
    playerControlState.value = { ...engine.playerController.state }
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleGlobalKeydown)
  window.addEventListener('keyup', handleGlobalKeyup)
  engine = new GameEngine({
    onUpdate: (state) => {
      fishes.value = state.fishes
      foods.value = state.foods
      physicalBubbles.value = state.physicalBubbles || []
      shockwaves.value = state.shockwaves || []
      // Sync player control state for rendering
      if (engine.playerController.state.active || engine.playerController.isPressing()) {
        playerControlState.value = { ...engine.playerController.state }
      }
    },
    getAIConfig: () => aiConfig.value,
    onStoryEvent: (state) => {
      storyState.value = { ...state }
    },
    onPlayerControlChange: (state) => {
      playerControlState.value = state.active ? { ...state } : null
    },
  })
  engine.start()

  const saved = localStorage.getItem('mmPla_fishes')
  if (saved) {
    try {
      const data = JSON.parse(saved)
      data.forEach((f: any) => engine.addFish(f))
    } catch {}
  }

  // Auto-save every 10 seconds so deaths/changes persist
  saveInterval = setInterval(saveFishes, 10000)
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleGlobalKeydown)
  window.removeEventListener('keyup', handleGlobalKeyup)
  clearInterval(saveInterval)
  saveFishes()
  engine?.stop()
})

function handleSaveConfig(config: AIConfig) {
  aiConfig.value = config
  localStorage.setItem('mmPla_apiUrl', config.apiUrl)
  localStorage.setItem('mmPla_apiKey', config.apiKey)
  localStorage.setItem('mmPla_model', config.model)
  showSettings.value = false
}

function handleFeed(e?: MouseEvent) {
  const canvas = document.querySelector('canvas')
  if (!canvas) return
  const rect = canvas.getBoundingClientRect()
  const x = e ? e.clientX - rect.left : Math.random() * rect.width
  const y = e ? e.clientY - rect.top : Math.random() * rect.height * 0.5 + rect.height * 0.2
  engine.addFood(x, y)
}

function handlePet(x: number, y: number) {
  const pettedFish = engine.petFish(x, y)
  if (!pettedFish) return

  // 30% chance to show a knowledge fact from static local data
  if (Math.random() < 0.3) {
    const hobby = pettedFish.hobby || 'food'
    const knowledge = HOBBY_KNOWLEDGE[hobby as keyof typeof HOBBY_KNOWLEDGE]
    if (knowledge && knowledge.length > 0) {
      const text = knowledge[Math.floor(Math.random() * knowledge.length)]
      engine.showBubble(pettedFish, text, 5)
    }
  }
}

function handlePlayerPressStart(fishId: string) {
  engine.startPlayerControl(fishId)
}

function handlePlayerPressEnd() {
  engine.cancelPlayerControl()
}

function handleAddFish(fishData: { name: string; species: string }) {
  const success = engine.addFish(fishData)
  if (!success) {
    alert('鱼缸已满（最多10条鱼）')
    return
  }
  showAddFish.value = false
  saveFishes()
}

function handleTriggerEvent() {
  if (fishes.value.filter(f => !f.isDead).length === 0) {
    alert('鱼缸里没有鱼！')
    return
  }
  engine.triggerStoryEvent(false)
}

function handleStoryChoice(index: number) {
  engine.submitStoryChoice(index)
}

function saveFishes() {
  const data = fishes.value
    .filter(f => !f.isDead)
    .map(f => ({
      name: f.name,
      species: f.species,
      hobby: f.hobby,
      personality: f.personality,
      hidden: f.hidden,
      appearance: f.appearance,
    }))
  localStorage.setItem('mmPla_fishes', JSON.stringify(data))
}
</script>

<style>
.app {
  width: 100vw;
  height: 100vh;
  position: relative;
  overflow: hidden;
}

.ui-overlay {
  position: absolute;
  bottom: 32px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 12px;
  z-index: 10;
  padding: 10px 14px;
  background: rgba(20, 25, 35, 0.4);
  border-radius: 28px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-top: 1px solid rgba(255, 255, 255, 0.15);
  box-shadow: 
    0 24px 48px rgba(0, 0, 0, 0.4),
    inset 0 1px 1px rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(48px) saturate(200%);
  -webkit-backdrop-filter: blur(48px) saturate(200%);
}

.dock-divider {
  width: 1px;
  height: 24px;
  background: rgba(255, 255, 255, 0.1);
  margin: 0 4px;
  border-radius: 1px;
}

.dock-btn {
  padding: 10px 20px;
  border: none;
  border-radius: 20px;
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.5px;
  cursor: pointer;
  background: transparent;
  color: rgba(255, 255, 255, 0.85);
  transition: all 0.3s cubic-bezier(0.2, 0.8, 0.2, 1);
  display: flex;
  align-items: center;
  gap: 8px;
}

.dock-btn:hover {
  transform: translateY(-2px);
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
  box-shadow: 0 8px 16px rgba(0, 0, 0, 0.2);
}

.dock-btn:active {
  transform: translateY(1px) scale(0.96);
  transition: all 0.1s;
}

.btn-settings {
  padding: 10px 14px;
  color: rgba(255, 255, 255, 0.6);
}
.btn-settings:hover {
  color: rgba(255, 255, 255, 0.95);
  background: rgba(255, 255, 255, 0.1);
}

.btn-feed {
  background: linear-gradient(180deg, rgba(76, 175, 80, 0.15), rgba(76, 175, 80, 0.05));
  border: 1px solid rgba(76, 175, 80, 0.2);
  color: #a5d6a7;
}
.btn-feed:hover {
  background: linear-gradient(180deg, rgba(76, 175, 80, 0.25), rgba(76, 175, 80, 0.1));
  border-color: rgba(76, 175, 80, 0.4);
  color: #c8e6c9;
  box-shadow: 0 8px 24px rgba(76, 175, 80, 0.2);
}

.btn-add-fish {
  background: linear-gradient(180deg, rgba(33, 150, 243, 0.15), rgba(33, 150, 243, 0.05));
  border: 1px solid rgba(33, 150, 243, 0.2);
  color: #90caf9;
}
.btn-add-fish:hover {
  background: linear-gradient(180deg, rgba(33, 150, 243, 0.25), rgba(33, 150, 243, 0.1));
  border-color: rgba(33, 150, 243, 0.4);
  color: #bbdefb;
  box-shadow: 0 8px 24px rgba(33, 150, 243, 0.2);
}

.btn-event {
  background: linear-gradient(180deg, rgba(255, 87, 34, 0.15), rgba(255, 87, 34, 0.05));
  border: 1px solid rgba(255, 87, 34, 0.2);
  color: #ffab91;
}
.btn-event:hover {
  background: linear-gradient(180deg, rgba(255, 87, 34, 0.25), rgba(255, 87, 34, 0.1));
  border-color: rgba(255, 87, 34, 0.4);
  color: #ffccbc;
  box-shadow: 0 8px 24px rgba(255, 87, 34, 0.2);
}
.btn-event:disabled {
  opacity: 0.4;
  pointer-events: none;
}

.dock-btn .icon {
  font-size: 16px;
  filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3));
}
.boss-key-active {
  background: #1e1e1e !important;
}

.boss-key-active canvas {
  opacity: 0.15;
  filter: grayscale(80%) blur(2px);
  transition: all 0.5s ease;
}

.stealth-indicator {
  position: absolute;
  top: 10px;
  left: 10px;
  font-family: monospace;
  color: #4caf50;
  font-size: 12px;
  z-index: 100;
  opacity: 0.7;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease, transform 0.3s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
  transform: translateY(10px);
}
</style>
