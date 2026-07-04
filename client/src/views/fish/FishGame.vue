<template>
  <div class="fish-app" :class="{ 'boss-key-active': isBossKeyActive }">
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

    <transition name="fade">
      <div class="ui-overlay" v-if="!isBossKeyActive">
        <router-link to="/" class="dock-btn btn-home" title="首页">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9,22 9,12 15,12 15,22"/></svg>
        </router-link>
        <div class="dock-divider"></div>
        <button class="dock-btn btn-add-fish" @click="showAddFish = true">
          <span class="icon">🐡</span>
          <span class="label">引进</span>
        </button>
      </div>
    </transition>

    <AddFishModal
      v-if="showAddFish && !isBossKeyActive"
      @close="showAddFish = false"
      @add="handleAddFish"
    />

    <transition name="fade">
      <FishListPanel :fishes="fishes" v-if="!isBossKeyActive" />
    </transition>
    <!-- <transition name="fade">
      <DebugPanel v-if="!isBossKeyActive" />
    </transition> -->
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import GameCanvas from '../../components/fish/GameCanvas.vue'
import AddFishModal from '../../components/fish/AddFishModal.vue'
import DebugPanel from '../../components/fish/DebugPanel.vue'
import FishListPanel from '../../components/fish/FishListPanel.vue'
import { GameEngine } from '../../game/GameEngine'
import { HOBBY_KNOWLEDGE } from '../../game/FishFactory'
import type { Fish, Food, PhysicalBubble, PlayerControlState, Shockwave } from '../../game/types'
import type { StoryEventState } from '../../game/StoryEventEngine'

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

const isBossKeyActive = ref(false)
const typingCounter = ref(0)
const SLACK_TYPING_THRESHOLD = 15
const playerControlState = ref<PlayerControlState | null>(null)

let engine: GameEngine
let saveInterval: ReturnType<typeof setInterval>

const handleGlobalKeydown = (e: KeyboardEvent) => {
  if (e.key === 'Escape') {
    if (engine?.playerController.state.active) {
      engine.exitPlayerControl()
      playerControlState.value = null
      return
    }
    isBossKeyActive.value = !isBossKeyActive.value
    return
  }

  if (engine?.playerController.state.active) {
    e.preventDefault()
    const pc = engine.playerController
    if (pc.state.targetLockMode && pc.state.keys.a) {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { pc.switchTarget('next'); playerControlState.value = { ...pc.state }; return; }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { pc.switchTarget('prev'); playerControlState.value = { ...pc.state }; return; }
    }
    pc.handleKeyDown(e.key)
    playerControlState.value = { ...pc.state }
    return
  }

  if (isBossKeyActive.value) {
    typingCounter.value++
    if (typingCounter.value >= SLACK_TYPING_THRESHOLD) {
      typingCounter.value = 0
      const canvas = document.querySelector('canvas')
      if (canvas) {
        const rect = canvas.getBoundingClientRect()
        engine.addFood(Math.random() * rect.width, -20)
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
      if (engine.playerController.state.active || engine.playerController.isPressing()) {
        playerControlState.value = { ...engine.playerController.state }
      }
    },
    onStoryEvent: (state) => { storyState.value = { ...state } },
    onPlayerControlChange: (state) => { playerControlState.value = state.active ? { ...state } : null },
  })
  engine.start()

  const saved = localStorage.getItem('mmPla_fishes')
  if (saved) {
    try {
      JSON.parse(saved).forEach((f: any) => engine.addFish(f))
    } catch {}
  }

  saveInterval = setInterval(saveFishes, 10000)
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleGlobalKeydown)
  window.removeEventListener('keyup', handleGlobalKeyup)
  clearInterval(saveInterval)
  saveFishes()
  engine?.stop()
})

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
  if (Math.random() < 0.3) {
    const hobby = pettedFish.hobby || 'food'
    const knowledge = HOBBY_KNOWLEDGE[hobby as keyof typeof HOBBY_KNOWLEDGE]
    if (knowledge && knowledge.length > 0) {
      engine.showBubble(pettedFish, knowledge[Math.floor(Math.random() * knowledge.length)], 5)
    }
  }
}

function handlePlayerPressStart(fishId: string) { engine.startPlayerControl(fishId) }
function handlePlayerPressEnd() { engine.cancelPlayerControl() }

function handleAddFish(fishData: { name: string; species: string }) {
  const success = engine.addFish(fishData)
  if (!success) { alert('鱼缸已满（最多10条鱼）'); return }
  showAddFish.value = false
  saveFishes()
}

function saveFishes() {
  const data = fishes.value
    .filter(f => !f.isDead)
    .map(f => ({ name: f.name, species: f.species, hobby: f.hobby, personality: f.personality, hidden: f.hidden, appearance: f.appearance }))
  localStorage.setItem('mmPla_fishes', JSON.stringify(data))
}
</script>

<style scoped>
.fish-app {
  width: 100vw;
  height: 100vh;
  position: relative;
  overflow: hidden;
  background: radial-gradient(ellipse at top, #1e293b 0%, #0f172a 70%);
  color: #f1f5f9;
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
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: 0 24px 48px rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(48px) saturate(200%);
}

.dock-divider {
  width: 1px;
  height: 24px;
  background: rgba(255, 255, 255, 0.1);
}

.dock-btn {
  padding: 10px 20px;
  border: none;
  border-radius: 10px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  background: transparent;
  color: rgba(255, 255, 255, 0.85);
  transition: all 0.3s ease;
  display: flex;
  align-items: center;
  gap: 8px;
  text-decoration: none;
}
.dock-btn:hover { transform: translateY(-2px); background: rgba(255, 255, 255, 0.08); color: #fff; }

.btn-home { padding: 10px 14px; color: rgba(255, 255, 255, 0.6); }
.btn-home:hover { color: rgba(255, 255, 255, 0.95); }

.btn-add-fish {
  background: linear-gradient(180deg, rgba(33, 150, 243, 0.15), rgba(33, 150, 243, 0.05));
  border: 1px solid rgba(33, 150, 243, 0.2);
  color: #90caf9;
}

.dock-btn .icon { font-size: 16px; }

.boss-key-active { background: #1e1e1e !important; }
.boss-key-active canvas { opacity: 0.15; filter: grayscale(80%) blur(2px); transition: all 0.5s; }
.stealth-indicator { position: absolute; top: 10px; left: 10px; font-family: monospace; color: #4caf50; font-size: 12px; z-index: 100; opacity: 0.7; }

.fade-enter-active, .fade-leave-active { transition: opacity 0.3s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
