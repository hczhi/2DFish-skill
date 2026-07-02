<template>
  <div class="story-overlay" v-if="visible">
    <!-- Screen shake -->
    <div class="shake-wrapper" :style="shakeStyle">
      <!-- Title banner -->
      <transition name="slide-down">
        <div class="event-title" v-if="showTitle">
          <h1>{{ state.payload?.title }}</h1>
        </div>
      </transition>

      <!-- Narration text -->
      <transition name="fade">
        <div class="narration-box" v-if="currentPhase?.type === 'narration' || currentPhase?.type === 'reward'">
          <p class="narration-text">{{ displayText }}</p>
        </div>
      </transition>

      <!-- Boss HP bar -->
      <transition name="fade">
        <div class="boss-hud" v-if="state.boss && currentPhase?.type === 'battle'">
          <div class="boss-name">{{ state.boss.name }}</div>
          <div class="boss-hp-bar">
            <div class="boss-hp-fill" :style="{ width: bossHpPercent + '%' }" />
          </div>
          <div class="boss-hp-text">{{ Math.round(state.boss.hp) }} / {{ state.boss.maxHp }}</div>
        </div>
      </transition>

      <!-- Choice panel -->
      <transition name="fade">
        <div class="choice-panel" v-if="currentPhase?.type === 'choice' && currentPhase.choice">
          <p class="choice-prompt">{{ currentPhase.choice.prompt }}</p>
          <div class="choice-options">
            <button
              v-for="(opt, i) in currentPhase.choice.options"
              :key="i"
              class="choice-btn"
              @click="$emit('choice', i)"
            >
              {{ opt.label }}
            </button>
          </div>
        </div>
      </transition>

      <!-- Battle result -->
      <transition name="scale">
        <div class="battle-result" v-if="state.battleResult !== 'pending' && currentPhase?.type === 'reward'">
          <span class="result-text" :class="state.battleResult">
            {{ state.battleResult === 'victory' ? '胜利！' : '撤退...' }}
          </span>
        </div>
      </transition>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { StoryEventState } from '../../game/StoryEventEngine'
import type { EventPhase } from '../../game/StoryEventTemplates'

const props = defineProps<{
  state: StoryEventState
}>()

defineEmits<{
  choice: [index: number]
}>()

const displayText = ref('')
let typewriterTimer: ReturnType<typeof setTimeout> | null = null

const visible = computed(() => props.state.status === 'running')
const showTitle = computed(() => props.state.status === 'running' && props.state.phaseTimer < 3)

const currentPhase = computed<EventPhase | null>(() => {
  if (!props.state.payload || props.state.currentPhaseIndex < 0) return null
  return props.state.payload.phases[props.state.currentPhaseIndex] || null
})

const bossHpPercent = computed(() => {
  if (!props.state.boss) return 0
  return Math.max(0, (props.state.boss.hp / props.state.boss.maxHp) * 100)
})

const shakeStyle = computed(() => {
  const intensity = props.state.shakeIntensity
  if (intensity <= 0) return {}
  const x = (Math.random() - 0.5) * intensity * 8
  const y = (Math.random() - 0.5) * intensity * 8
  return { transform: `translate(${x}px, ${y}px)` }
})

watch(() => currentPhase.value?.narration, (text) => {
  if (!text) { displayText.value = ''; return }
  typewriterEffect(text)
})

watch(() => currentPhase.value?.reward?.narration, (text) => {
  if (!text) return
  typewriterEffect(text)
})

function typewriterEffect(text: string) {
  if (typewriterTimer) clearTimeout(typewriterTimer)
  displayText.value = ''
  let i = 0
  const tick = () => {
    if (i < text.length) {
      displayText.value += text[i]
      i++
      typewriterTimer = setTimeout(tick, 50)
    }
  }
  tick()
}
</script>

<style scoped>
.story-overlay {
  position: fixed;
  inset: 0;
  z-index: 50;
  pointer-events: none;
}

.shake-wrapper {
  width: 100%;
  height: 100%;
  position: relative;
}

.event-title {
  position: absolute;
  top: 60px;
  left: 50%;
  transform: translateX(-50%);
  pointer-events: none;
}

.event-title h1 {
  font-size: 28px;
  font-weight: 800;
  color: #fff;
  text-shadow: 0 2px 12px rgba(0, 0, 0, 0.6), 0 0 30px rgba(255, 100, 50, 0.4);
  letter-spacing: 2px;
  white-space: nowrap;
}

.narration-box {
  position: absolute;
  bottom: 120px;
  left: 50%;
  transform: translateX(-50%);
  max-width: 500px;
  padding: 16px 28px;
  background: rgba(10, 20, 40, 0.85);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  backdrop-filter: blur(12px);
}

.narration-text {
  color: rgba(255, 255, 255, 0.95);
  font-size: 15px;
  line-height: 1.6;
  text-align: center;
}

.boss-hud {
  position: absolute;
  top: 30px;
  left: 50%;
  transform: translateX(-50%);
  text-align: center;
  min-width: 300px;
}

.boss-name {
  font-size: 18px;
  font-weight: 700;
  color: #ff6b6b;
  text-shadow: 0 1px 8px rgba(255, 50, 50, 0.5);
  margin-bottom: 8px;
}

.boss-hp-bar {
  width: 100%;
  height: 12px;
  background: rgba(0, 0, 0, 0.5);
  border-radius: 6px;
  overflow: hidden;
  border: 1px solid rgba(255, 100, 100, 0.3);
}

.boss-hp-fill {
  height: 100%;
  background: linear-gradient(90deg, #ff4444, #ff6b6b);
  border-radius: 6px;
  transition: width 0.3s ease;
}

.boss-hp-text {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.7);
  margin-top: 4px;
}

.choice-panel {
  position: absolute;
  bottom: 140px;
  left: 50%;
  transform: translateX(-50%);
  text-align: center;
  pointer-events: all;
}

.choice-prompt {
  color: #fff;
  font-size: 16px;
  margin-bottom: 16px;
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.5);
}

.choice-options {
  display: flex;
  gap: 12px;
}

.choice-btn {
  padding: 10px 24px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 8px;
  background: rgba(20, 40, 80, 0.8);
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
  backdrop-filter: blur(8px);
}

.choice-btn:hover {
  background: rgba(40, 80, 160, 0.9);
  border-color: rgba(100, 180, 255, 0.5);
  transform: translateY(-2px);
}

.battle-result {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  pointer-events: none;
}

.result-text {
  font-size: 48px;
  font-weight: 900;
  text-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
}

.result-text.victory {
  color: #ffd700;
}

.result-text.defeat {
  color: #aaa;
}

.slide-down-enter-active { transition: all 0.5s ease; }
.slide-down-leave-active { transition: all 0.3s ease; }
.slide-down-enter-from { opacity: 0; transform: translateX(-50%) translateY(-20px); }
.slide-down-leave-to { opacity: 0; }

.fade-enter-active, .fade-leave-active { transition: opacity 0.4s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }

.scale-enter-active { transition: all 0.4s cubic-bezier(0.2, 0.8, 0.2, 1.2); }
.scale-enter-from { opacity: 0; transform: translate(-50%, -50%) scale(0.5); }
</style>
