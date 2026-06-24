import type { Fish } from './types'
import type { StoryEventPayload, EventPhase } from './StoryEventTemplates'

export interface BossEntity {
  name: string
  x: number
  y: number
  vx: number
  vy: number
  hp: number
  maxHp: number
  attack: number
  defense: number
  appearance: { color: string; size: number; shape: string }
  hitFlash: number
  angle: number
  animTime: number
}

export type StoryEventStatus = 'idle' | 'running' | 'finished'

export interface StoryEventState {
  status: StoryEventStatus
  payload: StoryEventPayload | null
  currentPhaseIndex: number
  phaseTimer: number
  boss: BossEntity | null
  battleResult: 'pending' | 'victory' | 'defeat'
  choiceResult: number | null
  shakeIntensity: number
}

type EventCallback = (state: StoryEventState) => void

export class StoryEventEngine {
  state: StoryEventState = {
    status: 'idle',
    payload: null,
    currentPhaseIndex: -1,
    phaseTimer: 0,
    boss: null,
    battleResult: 'pending',
    choiceResult: null,
    shakeIntensity: 0,
  }

  private tankWidth: number
  private tankHeight: number
  private onStateChange: EventCallback
  private savedActions = new Map<string, { action: string; target: string | null; urgency: number }>()

  constructor(tankWidth: number, tankHeight: number, onStateChange: EventCallback) {
    this.tankWidth = tankWidth
    this.tankHeight = tankHeight
    this.onStateChange = onStateChange
  }

  resize(w: number, h: number) {
    this.tankWidth = w
    this.tankHeight = h
  }

  get isActive(): boolean {
    return this.state.status === 'running'
  }

  get currentPhase(): EventPhase | null {
    if (!this.state.payload || this.state.currentPhaseIndex < 0) return null
    return this.state.payload.phases[this.state.currentPhaseIndex] || null
  }

  start(payload: StoryEventPayload, fishes: Fish[]) {
    for (const fish of fishes) {
      this.savedActions.set(fish.id, {
        action: fish.currentAction,
        target: fish.actionTarget,
        urgency: fish.actionUrgency,
      })
    }

    this.state = {
      status: 'running',
      payload,
      currentPhaseIndex: -1,
      phaseTimer: 0,
      boss: null,
      battleResult: 'pending',
      choiceResult: null,
      shakeIntensity: 0,
    }

    this.advancePhase(fishes)
    this.onStateChange(this.state)
  }

  submitChoice(optionIndex: number, fishes: Fish[]) {
    if (!this.currentPhase || this.currentPhase.type !== 'choice') return
    this.state.choiceResult = optionIndex
    this.advancePhase(fishes)
  }

  update(dt: number, fishes: Fish[]) {
    if (this.state.status !== 'running') return

    this.state.phaseTimer += dt
    this.state.shakeIntensity = Math.max(0, this.state.shakeIntensity - dt * 3)

    const phase = this.currentPhase
    if (!phase) return

    switch (phase.type) {
      case 'narration':
        if (this.state.phaseTimer > 4) {
          this.advancePhase(fishes)
        }
        break

      case 'spawn_enemy':
        this.updateBossSpawn(dt)
        if (this.state.phaseTimer > 2.5) {
          this.advancePhase(fishes)
        }
        break

      case 'battle':
        this.updateBattle(dt, fishes)
        break

      case 'choice':
        // Wait for player input (submitChoice)
        break

      case 'reward':
        if (this.state.phaseTimer > 4) {
          this.finish(fishes)
        }
        break
    }

    this.onStateChange(this.state)
  }

  private advancePhase(fishes: Fish[]) {
    this.state.currentPhaseIndex++
    this.state.phaseTimer = 0

    const phase = this.currentPhase
    if (!phase) {
      this.finish(fishes)
      return
    }

    if (phase.type === 'spawn_enemy' && phase.enemy) {
      this.spawnBoss(phase)
    }

    if (phase.type === 'battle') {
      for (const fish of fishes) {
        if (fish.isDead) continue
        fish.currentAction = 'attack'
        fish.actionTarget = '__boss__'
        fish.actionUrgency = 1
      }
    }

    if (phase.type === 'narration') {
      this.state.shakeIntensity = 0.5
    }

    if (phase.type === 'reward' && phase.reward) {
      this.applyReward(phase, fishes)
    }
  }

  private spawnBoss(phase: EventPhase) {
    const enemy = phase.enemy!
    const side = Math.random() < 0.5 ? -1 : 1
    this.state.boss = {
      name: enemy.name,
      x: side > 0 ? this.tankWidth + 80 : -80,
      y: this.tankHeight * 0.3 + Math.random() * this.tankHeight * 0.4,
      vx: -side * 2,
      vy: 0,
      hp: enemy.hp,
      maxHp: enemy.hp,
      attack: enemy.attack,
      defense: enemy.defense,
      appearance: enemy.appearance,
      hitFlash: 0,
      angle: side > 0 ? Math.PI : 0,
      animTime: 0,
    }
  }

  private updateBossSpawn(dt: number) {
    const boss = this.state.boss
    if (!boss) return

    boss.animTime += dt
    const targetX = this.tankWidth * 0.5
    const dx = targetX - boss.x
    boss.vx += dx * 0.02
    boss.vx *= 0.95
    boss.x += boss.vx * dt * 60
    boss.y += Math.sin(boss.animTime * 2) * 0.5
    boss.angle = boss.vx > 0 ? 0 : Math.PI
  }

  private updateBattle(dt: number, fishes: Fish[]) {
    const boss = this.state.boss
    const phase = this.currentPhase
    if (!boss || !phase?.battle) return

    boss.animTime += dt
    boss.hitFlash = Math.max(0, boss.hitFlash - dt * 4)

    // Boss movement: wander around center
    const centerX = this.tankWidth * 0.5
    const centerY = this.tankHeight * 0.5
    boss.vx += (centerX - boss.x) * 0.005 + Math.sin(boss.animTime * 0.7) * 0.3
    boss.vy += (centerY - boss.y) * 0.005 + Math.cos(boss.animTime * 0.5) * 0.2
    boss.vx *= 0.97
    boss.vy *= 0.97
    boss.x += boss.vx * dt * 60
    boss.y += boss.vy * dt * 60
    boss.angle = boss.vx > 0 ? 0 : Math.PI

    // Fish attack boss
    for (const fish of fishes) {
      if (fish.isDead) continue
      const dist = Math.sqrt((fish.x - boss.x) ** 2 + (fish.y - boss.y) ** 2)
      if (dist < boss.appearance.size + 30) {
        const dmg = Math.max(1, fish.hidden.attack - boss.defense * 0.3) * dt * 0.5
        boss.hp -= dmg
        boss.hitFlash = 0.3

        fish.hidden.exp += dt * 2
      }

      // Direct fish toward boss
      if (fish.currentAction === 'attack' && fish.actionTarget === '__boss__') {
        const angle = Math.atan2(boss.y - fish.y, boss.x - fish.x)
        fish.vx += Math.cos(angle) * 0.3
        fish.vy += Math.sin(angle) * 0.3
      }
    }

    // Boss attacks fish
    if (Math.random() < dt * 0.5) {
      const aliveFishes = fishes.filter(f => !f.isDead)
      if (aliveFishes.length > 0) {
        const target = aliveFishes[Math.floor(Math.random() * aliveFishes.length)]
        const dmg = Math.max(1, boss.attack - target.hidden.defense * 0.5)
        target.currentHp -= dmg * 0.3
        target.hitFlash = 0.5
        this.state.shakeIntensity = 0.3
      }
    }

    // Victory
    if (boss.hp <= 0) {
      this.state.battleResult = 'victory'
      this.state.shakeIntensity = 1
      this.advancePhase(fishes)
      return
    }

    // Timeout = defeat
    if (this.state.phaseTimer > phase.battle.duration) {
      this.state.battleResult = 'defeat'
      this.advancePhase(fishes)
    }
  }

  private applyReward(phase: EventPhase, fishes: Fish[]) {
    if (!phase.reward) return

    for (const fish of fishes) {
      if (fish.isDead) continue
      fish.hidden.exp += phase.reward.exp

      if (phase.reward.statBoost) {
        for (const boost of phase.reward.statBoost) {
          if (boost.fishId === fish.id || boost.fishId === 'all') {
            const stat = boost.stat as keyof typeof fish.hidden
            if (typeof fish.hidden[stat] === 'number') {
              ;(fish.hidden as any)[stat] += boost.amount
            }
          }
        }
      }
    }
  }

  private finish(fishes: Fish[]) {
    // Restore fish actions
    for (const fish of fishes) {
      const saved = this.savedActions.get(fish.id)
      if (saved && !fish.isDead) {
        fish.currentAction = 'wander'
        fish.actionTarget = null
        fish.actionUrgency = 0.3
      }
    }

    this.savedActions.clear()
    this.state.status = 'finished'
    this.state.boss = null
    this.onStateChange(this.state)

    setTimeout(() => {
      this.state.status = 'idle'
      this.state.payload = null
      this.state.currentPhaseIndex = -1
      this.onStateChange(this.state)
    }, 2000)
  }
}
