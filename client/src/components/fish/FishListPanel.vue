<template>
  <div
    class="fish-list-panel"
    :class="{ collapsed: !expanded }"
    :style="{ left: pos.x + 'px', top: pos.y + 'px' }"
  >
    <div
      class="panel-header"
      @mousedown="startDrag"
      @click.self="expanded = !expanded"
    >
      <span class="panel-title" @click="expanded = !expanded">&#128031; 鱼池 ({{ fishes.length }}/10)</span>
      <span class="toggle" @click="expanded = !expanded">{{ expanded ? '&#9660;' : '&#9650;' }}</span>
    </div>
    <div v-if="expanded" class="panel-body">
      <div v-if="fishes.length === 0" class="empty-state">
        鱼池空空如也，快去加鱼吧~
      </div>
      <div
        v-for="fish in fishes"
        :key="fish.id"
        class="fish-card"
      >
        <div class="fish-card-header">
          <span class="fish-name">{{ fish.name }}</span>
          <span class="fish-species">{{ getSpeciesName(fish.species) }}</span>
          <span class="fish-level">Lv.{{ fish.hidden.level }}</span>
        </div>
        <div class="fish-card-body">
          <div class="stat-row">
            <span class="stat-label">爱好</span>
            <span class="stat-value hobby-tag">{{ getHobbyName(fish.hobby) }}</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">心情</span>
            <span class="stat-value">{{ getMoodName(fish.mood) }}</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">饥饿</span>
            <div class="stat-bar">
              <div class="stat-bar-fill hunger" :style="{ width: fish.hunger + '%' }"></div>
            </div>
            <span class="stat-num">{{ Math.round(fish.hunger) }}%</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">血量</span>
            <div class="stat-bar">
              <div class="stat-bar-fill hp" :style="{ width: (fish.currentHp / fish.hidden.hp * 100) + '%' }"></div>
            </div>
            <span class="stat-num">{{ Math.round(fish.currentHp) }}/{{ fish.hidden.hp }}</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">状态</span>
            <span class="stat-value action-tag">{{ getActionName(fish.currentAction) }}</span>
          </div>
          <div class="stats-grid">
            <div class="mini-stat">
              <span class="mini-label">攻</span>
              <span class="mini-value">{{ Math.round(fish.hidden.attack) }}</span>
            </div>
            <div class="mini-stat">
              <span class="mini-label">防</span>
              <span class="mini-value">{{ Math.round(fish.hidden.defense) }}</span>
            </div>
            <div class="mini-stat">
              <span class="mini-label">速</span>
              <span class="mini-value">{{ Math.round(fish.hidden.speed) }}</span>
            </div>
            <div class="mini-stat">
              <span class="mini-label">经验</span>
              <span class="mini-value">{{ Math.floor(fish.hidden.exp) }}/{{ fish.hidden.level * 100 }}</span>
            </div>
          </div>
          <div class="personality-row">
            <span v-for="t in getTraits(fish)" :key="t" class="trait">{{ t }}</span>
          </div>
          <div v-if="getRelationships(fish).length" class="relationships-row">
            <div v-for="r in getRelationships(fish)" :key="r.name" class="rel-item" :class="r.type">
              {{ r.icon }} {{ r.name }}
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, onUnmounted } from 'vue'
import type { Fish, Hobby } from '../../game/types'

const props = defineProps<{
  fishes: Fish[]
}>()

const expanded = ref(false)
const pos = reactive({ x: 16, y: 70 })
let dragging = false
let dragOffset = { x: 0, y: 0 }

function startDrag(e: MouseEvent) {
  dragging = true
  dragOffset.x = e.clientX - pos.x
  dragOffset.y = e.clientY - pos.y
  e.preventDefault()
}

function onMouseMove(e: MouseEvent) {
  if (!dragging) return
  pos.x = Math.max(0, Math.min(window.innerWidth - 280, e.clientX - dragOffset.x))
  pos.y = Math.max(0, Math.min(window.innerHeight - 60, e.clientY - dragOffset.y))
}

function onMouseUp() {
  dragging = false
}

onMounted(() => {
  window.addEventListener('mousemove', onMouseMove)
  window.addEventListener('mouseup', onMouseUp)
})

onUnmounted(() => {
  window.removeEventListener('mousemove', onMouseMove)
  window.removeEventListener('mouseup', onMouseUp)
})

function getSpeciesName(species: string): string {
  const names: Record<string, string> = {
    moyu: '摸鱼达人', juanwang: '卷王', sheniu: '社牛', xianyu: '咸鱼', xijing: '戏精',
  }
  return names[species] || species
}

function getHobbyName(hobby: Hobby): string {
  const names: Record<Hobby, string> = {
    sports: '体育', food: '美食', gaming: '游戏',
    music: '音乐', coding: '编程', gossip: '八卦',
    philosophy: '哲学', finance: '理财',
  }
  return names[hobby] || hobby
}

function getMoodName(mood: string): string {
  const names: Record<string, string> = {
    calm: '平静', happy: '开心', angry: '生气', scared: '害怕', hungry: '饥饿',
  }
  return names[mood] || mood
}

function getActionName(action: string): string {
  const names: Record<string, string> = {
    idle: '发呆', wander: '闲逛', hunt: '追击', flee: '逃跑',
    eat: '进食', follow: '跟随', rest: '休息', play: '玩耍',
    hide: '躲藏', attack: '攻击',
  }
  return names[action] || action
}

function getRelationships(fish: Fish): { name: string; icon: string; type: string }[] {
  const results: { name: string; icon: string; type: string }[] = []
  for (const rel of fish.relationships) {
    if (rel.affinity > 30) {
      const other = props.fishes.find(f => f.id === rel.fishId)
      if (other) results.push({ name: other.name, icon: '💕', type: 'friend' })
    } else if (rel.affinity < -30) {
      const other = props.fishes.find(f => f.id === rel.fishId)
      if (other) results.push({ name: other.name, icon: '⚡', type: 'enemy' })
    }
  }
  return results
}

function getTraits(fish: Fish): string[] {
  const traits: string[] = []
  const p = fish.personality

  // Show the dominant traits of each fish (top values)
  const entries: [string, number][] = [
    ['好斗', p.aggression],
    ['佛系', 1 - p.aggression],
    ['社牛', p.social],
    ['独处', 1 - p.social],
    ['好奇', p.curiosity],
    ['胆小', p.cowardice],
    ['勇敢', 1 - p.cowardice],
  ]

  // Pick traits that score above 0.6
  for (const [name, val] of entries) {
    if (val > 0.6) traits.push(name)
  }

  // Always show at least 1 trait — pick the strongest
  if (traits.length === 0) {
    entries.sort((a, b) => b[1] - a[1])
    traits.push(entries[0][0])
  }

  return traits.slice(0, 3)
}
</script>

<style scoped>
.fish-list-panel {
  position: fixed;
  width: 280px;
  max-height: calc(100vh - 120px);
  background: rgba(255, 255, 255, 0.03);
  backdrop-filter: blur(32px) saturate(150%);
  -webkit-backdrop-filter: blur(32px) saturate(150%);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-top: 1px solid rgba(255, 255, 255, 0.3);
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  border-radius: 24px;
  box-shadow: 
    0 20px 40px rgba(0, 0, 0, 0.2),
    inset 0 1px 1px rgba(255, 255, 255, 0.2),
    inset 0 -1px 1px rgba(255, 255, 255, 0.05);
  z-index: 20;
  display: flex;
  flex-direction: column;
  font-size: 12px;
  transition: max-height 0.4s cubic-bezier(0.16, 1, 0.3, 1), transform 0.3s;
  overflow: hidden;
}

.fish-list-panel.collapsed {
  max-height: 52px;
  border-radius: 26px;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  cursor: grab;
  user-select: none;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  flex-shrink: 0;
  transition: background 0.3s;
}

.panel-header:active {
  cursor: grabbing;
}

.panel-header:hover {
  background: rgba(255, 255, 255, 0.05);
}

.panel-title {
  color: rgba(255, 255, 255, 0.95);
  font-weight: 600;
  font-size: 14px;
  letter-spacing: 0.5px;
  cursor: pointer;
}

.toggle {
  color: rgba(255, 255, 255, 0.6);
  font-size: 12px;
  cursor: pointer;
  transition: color 0.3s;
}

.toggle:hover {
  color: rgba(255, 255, 255, 0.9);
}

.panel-body {
  overflow-y: auto;
  padding: 12px;
  flex: 1;
}

/* Custom Scrollbar for Panel Body */
.panel-body::-webkit-scrollbar {
  width: 6px;
}
.panel-body::-webkit-scrollbar-track {
  background: transparent;
}
.panel-body::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.15);
  border-radius: 3px;
}
.panel-body::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.25);
}

.empty-state {
  color: rgba(255, 255, 255, 0.5);
  text-align: center;
  padding: 30px 12px;
  font-size: 13px;
}

.fish-card {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-top: 1px solid rgba(255, 255, 255, 0.15);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05);
  border-radius: 16px;
  padding: 14px;
  margin-bottom: 12px;
  transition: transform 0.3s, background 0.3s;
}

.fish-card:hover {
  background: rgba(255, 255, 255, 0.08);
  transform: translateY(-2px);
}

.fish-card:last-child {
  margin-bottom: 0;
}

.fish-card-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}

.fish-name {
  color: rgba(255, 255, 255, 0.95);
  font-weight: 700;
  font-size: 14px;
  letter-spacing: 0.5px;
}

.fish-species {
  color: rgba(255, 255, 255, 0.6);
  font-size: 12px;
}

.fish-level {
  margin-left: auto;
  color: #ffd54f;
  font-weight: 700;
  font-size: 12px;
  text-shadow: 0 0 8px rgba(255, 213, 79, 0.4);
}

.fish-card-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.stat-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.stat-label {
  color: rgba(255, 255, 255, 0.5);
  width: 32px;
  flex-shrink: 0;
  font-size: 12px;
  font-weight: 500;
}

.stat-value {
  color: rgba(255, 255, 255, 0.85);
  font-size: 12px;
}

.hobby-tag {
  background: linear-gradient(135deg, rgba(139, 92, 246, 0.2), rgba(139, 92, 246, 0.1));
  border: 1px solid rgba(139, 92, 246, 0.3);
  color: #c4b5fd;
  padding: 2px 8px;
  border-radius: 6px;
}

.action-tag {
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.2), rgba(59, 130, 246, 0.1));
  border: 1px solid rgba(59, 130, 246, 0.3);
  color: #93c5fd;
  padding: 2px 8px;
  border-radius: 6px;
}

.stat-bar {
  flex: 1;
  height: 6px;
  background: rgba(0, 0, 0, 0.2);
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.3);
  border-radius: 3px;
  overflow: hidden;
}

.stat-bar-fill {
  height: 100%;
  border-radius: 3px;
  transition: width 0.4s cubic-bezier(0.16, 1, 0.3, 1);
}

.stat-bar-fill.hunger {
  background: linear-gradient(90deg, #81c784, #ffb74d, #e57373);
}

.stat-bar-fill.hp {
  background: linear-gradient(90deg, #4caf50, #81c784);
  box-shadow: 0 0 8px rgba(76, 175, 80, 0.4);
}

.stat-num {
  color: rgba(255, 255, 255, 0.6);
  font-size: 11px;
  min-width: 40px;
  text-align: right;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
  margin-top: 6px;
}

.mini-stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  background: rgba(0, 0, 0, 0.15);
  border: 1px solid rgba(255, 255, 255, 0.05);
  border-radius: 8px;
  padding: 6px 2px;
}

.mini-label {
  color: rgba(255, 255, 255, 0.4);
  font-size: 10px;
  margin-bottom: 2px;
}

.mini-value {
  color: rgba(255, 255, 255, 0.9);
  font-size: 12px;
  font-weight: 600;
}

.personality-row {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-top: 6px;
}

.trait {
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.7);
  padding: 2px 8px;
  border-radius: 6px;
  font-size: 11px;
}

.relationships-row {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-top: 6px;
}

.rel-item {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 6px;
  border: 1px solid transparent;
}

.rel-item.friend {
  background: linear-gradient(135deg, rgba(244, 143, 177, 0.2), rgba(244, 143, 177, 0.1));
  border-color: rgba(244, 143, 177, 0.3);
  color: #f48fb1;
}

.rel-item.enemy {
  background: linear-gradient(135deg, rgba(255, 213, 79, 0.2), rgba(255, 213, 79, 0.1));
  border-color: rgba(255, 213, 79, 0.3);
  color: #ffd54f;
}
</style>
