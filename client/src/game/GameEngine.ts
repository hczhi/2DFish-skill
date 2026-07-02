import type { Fish, Food, GameState, BubbleState, Relationship, PlayerControlState, Shockwave } from './types'
import { BehaviorExecutor } from './BehaviorExecutor'
import { PlayerController } from './PlayerController'
import { createFish, HOBBY_BUBBLES, HOBBY_KNOWLEDGE } from './FishFactory'
import { StoryEventEngine } from './StoryEventEngine'
import { StoryEventTrigger } from './StoryEventTrigger'
import type { StoryEventPayload } from './StoryEventTemplates'
import type { StoryEventState } from './StoryEventEngine'

const BUBBLE_TEXTS: Record<string, string[]> = {
  idle: ['...', '~', '...zzZ', '~~'],
  wander: ['♪', '~♪~', '...', '~~'],
  hunt: ['!!', '...!', '>:)', '!!!'],
  flee: ['!!', 'QAQ', '!?', 'aaa'],
  eat: ['nom~', 'yum!', '~', 'mmm'],
  follow: ['wait~', '♪', '~', '...'],
  rest: ['zzZ', '...', '~', 'zzz'],
  play: ['hehe', '~♪', 'wee!', '♪~'],
  hide: ['...', 'shh', '...', '...!'],
  attack: ['ha!', '!!', '>:(', '!!!'],
  fight: ['来啊！', '不服！', '看招！', '接着！'],
  hungry: ['肚子饿了…', '想吃东西', '好饿', '有吃的吗'],
  hurt: ['好痛', '...', '救命', 'QQ'],
  levelup: ['升级了!', '变强了!', '进化!', 'wow!'],
}

const CHAT_RESPONSES: Record<string, string[]> = {
  greet: ['你好呀', '嗨~', '在干嘛', '嘿'],
  agree: ['对对对', '确实', '说得好', '懂了'],
  disagree: ['不是吧', '真的吗', '我不信', '???'],
  laugh: ['哈哈哈', '笑死', '太好笑了', '233'],
  surprise: ['什么！', '不会吧', '真假的', '啊？'],
}

function pickBubbleText(key: string): string {
  const texts = BUBBLE_TEXTS[key] || BUBBLE_TEXTS.idle
  return texts[Math.floor(Math.random() * texts.length)]
}

function pickChatResponse(): string {
  const keys = Object.keys(CHAT_RESPONSES)
  const key = keys[Math.floor(Math.random() * keys.length)]
  const texts = CHAT_RESPONSES[key]
  return texts[Math.floor(Math.random() * texts.length)]
}

function distance(x1: number, y1: number, x2: number, y2: number): number {
  return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2)
}

interface GameEngineOptions {
  onUpdate: (state: GameState) => void
  onStoryEvent?: (state: StoryEventState) => void
  onPlayerControlChange?: (state: PlayerControlState) => void
}

export class GameEngine {
  fishes: Fish[] = []
  foods: Food[] = []
  physicalBubbles: import('./types').PhysicalBubble[] = []
  shockwaves: Shockwave[] = []
  private running = false
  private paused = false
  private lastTime = 0
  private behaviorExecutor: BehaviorExecutor
  playerController: PlayerController
  private onUpdate: (state: GameState) => void
  private onPlayerControlChange: (state: PlayerControlState) => void
  private tankWidth = window.innerWidth
  private tankHeight = window.innerHeight
  private foodIdCounter = 0
  private handleVisibility: () => void
  storyEventEngine: StoryEventEngine
  private storyEventTrigger: StoryEventTrigger
  private storyCheckTimer = 0

  constructor(options: GameEngineOptions) {
    this.onUpdate = options.onUpdate
    this.onPlayerControlChange = options.onPlayerControlChange || (() => {})
    this.behaviorExecutor = new BehaviorExecutor(this.tankWidth, this.tankHeight)
    this.playerController = new PlayerController()
    this.storyEventEngine = new StoryEventEngine(
      this.tankWidth, this.tankHeight,
      options.onStoryEvent || (() => {})
    )
    this.storyEventTrigger = new StoryEventTrigger()

    window.addEventListener('resize', () => {
      this.tankWidth = window.innerWidth
      this.tankHeight = window.innerHeight
      this.behaviorExecutor.tankWidth = this.tankWidth
      this.behaviorExecutor.tankHeight = this.tankHeight
      this.storyEventEngine.resize(this.tankWidth, this.tankHeight)
    })

    this.handleVisibility = () => {
      if (document.hidden) {
        this.paused = true
      } else {
        this.paused = false
        this.lastTime = performance.now()
      }
    }
    document.addEventListener('visibilitychange', this.handleVisibility)
  }

  start() {
    this.running = true
    this.lastTime = performance.now()
    this.loop()
  }

  stop() {
    this.running = false
    document.removeEventListener('visibilitychange', this.handleVisibility)
  }

  addFish(options: { name: string; species: string; personality?: any; hidden?: any; appearance?: any }): boolean {
    if (this.fishes.length >= 10) return false
    const fish = createFish({
      ...options,
      x: Math.random() * (this.tankWidth - 200) + 100,
      y: Math.random() * (this.tankHeight - 200) + 100,
    })
    fish.currentHp = fish.hidden.hp
    this.fishes.push(fish)
    return true
  }

  petFish(x: number, y: number): Fish | null {
    let petted: Fish | null = null
    for (const fish of this.fishes) {
      if (fish.isDead) continue
      const dx = x - fish.x
      const dy = y - fish.y
      if (Math.sqrt(dx * dx + dy * dy) < fish.appearance.bodyLength * 1.5) {
        this.triggerPet(fish)
        this.showBubble(fish, '❤️', 2)
        petted = fish
        break
      }
    }
    return petted
  }

  private triggerPet(fish: Fish) {
    fish.petEffect = 1

    // Swim toward the screen — strong z impulse so the fish visibly faces the viewer
    fish.targetZ = 0.95
    fish.vz = 0.25

    const PET_REACTIONS: Record<string, string[]> = {
      moyu: ['舒服~', '嘿嘿~', '再摸摸', '好开心~'],
      juanwang: ['别碰我！在忙', '...', '浪费时间', '快走开'],
      sheniu: ['你好呀！', '一起玩！', '摸摸~', '朋友！'],
      xianyu: ['...', '......', '嗯', '别动我'],
      xijing: ['哇！被翻牌了', '太感动了！', '再来再来', '观众好！'],
    }

    const reactions = PET_REACTIONS[fish.species] || PET_REACTIONS.moyu
    const text = reactions[Math.floor(Math.random() * reactions.length)]
    fish.bubble = { text, timer: 2.5, opacity: 1 }

    // Happiness boost
    fish.mood = 'happy'
    fish.hidden.exp += 2
  }

  getFishAt(x: number, y: number): Fish | null {
    for (const fish of this.fishes) {
      const dx = x - fish.x
      const dy = y - fish.y
      const dist = Math.sqrt(dx * dx + dy * dy)
      if (dist < fish.appearance.bodyLength * 0.8) {
        return fish
      }
    }
    return null
  }

  addFood(x: number, y: number) {
    this.foods.push({
      id: `food_${++this.foodIdCounter}`,
      x,
      y,
      vy: 0,
      vx: (Math.random() - 0.5) * 0.3,
      life: 30,
      opacity: 1,
      size: 4 + Math.random() * 2,
    })
  }

  private loop() {
    if (!this.running) return

    if (this.paused) {
      requestAnimationFrame(() => this.loop())
      return
    }

    const now = performance.now()
    const dt = Math.min((now - this.lastTime) / 1000, 0.1)
    this.lastTime = now

    this.update(dt)
    this.onUpdate({ fishes: this.fishes, foods: this.foods, physicalBubbles: this.physicalBubbles, shockwaves: this.shockwaves })

    requestAnimationFrame(() => this.loop())
  }

  private update(dt: number) {
    // Story event updates (disabled)
    // this.storyEventTrigger.update(dt)
    // this.storyEventEngine.update(dt, this.fishes)

    // Periodic check to auto-trigger story events (disabled)
    // this.storyCheckTimer += dt
    // if (this.storyCheckTimer >= 30) {
    //   this.storyCheckTimer = 0
    //   if (!this.storyEventEngine.isActive && this.storyEventTrigger.canTrigger(this.fishes)) {
    //     this.triggerStoryEvent()
    //   }
    // }

    // Update player controller press progress
    if (this.playerController.isPressing()) {
      const entered = this.playerController.updatePress()
      if (entered) {
        const fish = this.fishes.find(f => f.id === this.playerController.state.fishId)
        if (fish) {
          fish.currentAction = 'player-control'
          fish.actionTarget = null
          this.showBubble(fish, '被控制了!')
        }
        this.onPlayerControlChange(this.playerController.state)
      }
    }

    this.fishes.forEach(fish => {
      fish.animTime += dt
      fish.hunger = Math.min(100, fish.hunger + dt * 0.5)
      fish.age += dt

      if (fish.currentHp < fish.hidden.hp) {
        fish.currentHp = Math.min(fish.hidden.hp, fish.currentHp + fish.hidden.recovery * dt * 0.1)
      }

      if (fish.breedCooldown > 0) {
        fish.breedCooldown -= dt
      }

      // Track action transitions
      if (fish.currentAction !== fish.prevAction) {
        if (fish.currentAction === 'fight' && fish.prevAction !== 'fight') {
          this.showBubble(fish, pickBubbleText('fight'))
        }
        fish.prevAction = fish.currentAction
        fish.actionTimer = 0
        fish.chargeAmount = 0
      }
      fish.actionTimer += dt

      // Charge up on hunt/attack/fight
      if (fish.currentAction === 'hunt' || fish.currentAction === 'attack' || fish.currentAction === 'fight') {
        fish.chargeAmount = Math.min(1, fish.chargeAmount + dt * 2)
      } else {
        fish.chargeAmount = Math.max(0, fish.chargeAmount - dt * 4)
      }

      // Decay hit flash
      if (fish.hitFlash > 0) {
        fish.hitFlash = Math.max(0, fish.hitFlash - dt * 4)
      }

      // Decay pet effect
      if (fish.petEffect > 0) {
        fish.petEffect = Math.max(0, fish.petEffect - dt * 1.5)
      }

      this.updateRelationships(fish, dt)
      this.updateBubble(fish, dt)

      // Player-controlled fish: skip AI, use player input
      if (this.playerController.isControlling(fish.id)) {
        const result = this.playerController.update(fish, this.fishes, dt)
        if (result?.attack) {
          this.playerAttack(result.attack.attacker, result.attack.target)
        }
        if (result?.shockwave) {
          this.shockwaves.push(result.shockwave)
          this.showBubble(fish, '波动拳!')
          // Slight recoil but keep velocity mostly forward to avoid turning
          fish.vx = Math.cos(fish.angle) * 0.5
          fish.vy = Math.sin(fish.angle) * 0.5
        }
        this.behaviorExecutor.execute(fish, this.fishes, this.foods, dt)
      } else {
        if (!this.storyEventEngine.isActive) {
          this.localDecision(fish)
        }
        this.behaviorExecutor.execute(fish, this.fishes, this.foods, dt)
      }
      
      // Update pseudo-IK segments
      fish.segments[0] = { x: fish.x, y: fish.y, angle: fish.angle }
      for (let i = 1; i < fish.segments.length; i++) {
        const prev = fish.segments[i - 1]
        const curr = fish.segments[i]
        const dx = prev.x - curr.x
        const dy = prev.y - curr.y
        const dist = Math.sqrt(dx * dx + dy * dy)
        const targetDist = fish.appearance.bodyLength * 0.25

        if (dist > targetDist) {
          curr.x = prev.x - (dx / dist) * targetDist
          curr.y = prev.y - (dy / dist) * targetDist
        }

        // Ensure segment is always behind prev along its facing direction
        const behindX = prev.x - Math.cos(prev.angle) * targetDist
        const behindY = prev.y - Math.sin(prev.angle) * targetDist
        const aheadDot = (curr.x - prev.x) * Math.cos(prev.angle) + (curr.y - prev.y) * Math.sin(prev.angle)
        if (aheadDot > 0) {
          // Segment drifted in front — snap it behind
          curr.x = behindX
          curr.y = behindY
        }

        curr.angle = Math.atan2(prev.y - curr.y, prev.x - curr.x)
      }

      // Emit physical breathing bubbles randomly
      if (Math.random() < dt * 0.8) {
        const mouthX = fish.x + Math.cos(fish.angle) * fish.appearance.bodyLength * 0.45
        const mouthY = fish.y + Math.sin(fish.angle) * fish.appearance.bodyLength * 0.45
        this.physicalBubbles.push({
          id: `pb_${Date.now()}_${Math.random()}`,
          x: mouthX,
          y: mouthY,
          size: 1 + Math.random() * 2,
          vx: (Math.random() - 0.5) * 0.5 + fish.vx * 0.2,
          vy: -1 - Math.random() * 1.5,
          life: 0,
          maxLife: 2 + Math.random() * 2
        })
      }

      this.checkLevelUp(fish)
    })

    // Handle deaths: mark as dead instead of instantly removing
    this.fishes.forEach(fish => {
      if (fish.currentHp <= 0 && !fish.isDead) {
        fish.isDead = true
        fish.currentAction = 'dead'
        fish.deadTimer = 0
        fish.bubble = null
        this.showBubble(fish, 'X_X')
      }
      if (fish.isDead) {
        fish.deadTimer += dt
      }
    })

    // Remove fish that have been dead for more than 10 seconds
    this.fishes = this.fishes.filter(f => !f.isDead || f.deadTimer < 10)

    // Update physical bubbles
    this.physicalBubbles.forEach(b => {
      b.life += dt
      b.x += b.vx * dt * 60
      b.y += b.vy * dt * 60
      b.vx += (Math.random() - 0.5) * 0.1 // Wiggle
      b.size += dt * 0.5 // Expand as they rise
    })
    this.physicalBubbles = this.physicalBubbles.filter(b => b.life < b.maxLife && b.y > -20)

    // Update shockwaves
    this.updateShockwaves(dt)

    this.foods.forEach(f => {
      f.life -= dt
      // Sinking physics: accelerate downward, capped speed
      f.vy = Math.min(f.vy + 8 * dt, 25)
      // Slight horizontal drift (water current simulation)
      f.vx += (Math.sin(f.y * 0.01 + f.x * 0.005) * 0.1) * dt
      f.vx *= 0.99
      f.x += f.vx * dt
      f.y += f.vy * dt
      // Settle on the bottom
      const bottom = this.tankHeight - 70
      if (f.y >= bottom) {
        f.y = bottom
        f.vy = 0
        f.vx *= 0.95
      }
      // Fade out in last 5 seconds
      if (f.life < 5) {
        f.opacity = Math.max(0, f.life / 5)
      }
    })
    this.foods = this.foods.filter(f => f.life > 0)

    this.checkBreeding()
  }

  private localDecision(fish: Fish) {
    // Don't interrupt combat or fleeing
    if (fish.currentAction === 'flee' || fish.currentAction === 'fight') {
      return
    }

    // Don't interrupt wander — let fish finish swimming to their target
    if (fish.currentAction === 'wander') {
      // Only interrupt for critical events
      if (fish.currentHp < fish.hidden.hp * 0.3) {
        fish.currentAction = 'rest'
        fish.actionUrgency = 0.7
        return
      }
      // React to food — any hunger level will respond to nearby food
      if (this.foods.length > 0) {
        let nearestDist = Infinity
        for (const food of this.foods) {
          const d = distance(fish.x, fish.y, food.x, food.y)
          if (d < nearestDist) nearestDist = d
        }
        const reactRange = fish.hunger > 50 ? 500 : 300
        if (nearestDist < reactRange) {
          fish.currentAction = 'eat'
          fish.actionTarget = 'food'
          fish.actionUrgency = 0.6
          return
        }
      }
      // Flee from immediate threat
      if (fish.personality.cowardice > 0.5) {
        const threat = this.fishes.find(f =>
          f.id !== fish.id &&
          !f.isDead &&
          f.personality.aggression > 0.5 &&
          f.species !== fish.species &&
          (f.currentAction === 'hunt' || f.currentAction === 'attack') &&
          Math.abs(fish.z - f.z) < 0.1 &&
          distance(fish.x, fish.y, f.x, f.y) < 100
        )
        if (threat) {
          fish.currentAction = 'flee'
          fish.actionTarget = threat.id
          fish.actionUrgency = 0.9
          return
        }
      }
      return
    }

    // For non-wander states, decide what to do next
    // Critical HP: rest
    if (fish.currentHp < fish.hidden.hp * 0.3) {
      fish.currentAction = 'rest'
      fish.actionUrgency = 0.7
      return
    }

    // Hungry + food available nearby
    if (this.foods.length > 0 && fish.hunger > 60) {
      let nearestDist = Infinity
      for (const food of this.foods) {
        const d = distance(fish.x, fish.y, food.x, food.y)
        if (d < nearestDist) nearestDist = d
      }
      if (nearestDist < 200) {
        fish.currentAction = 'eat'
        fish.actionTarget = 'food'
        fish.actionUrgency = 0.6
        return
      }
    }

    // Hungry + aggressive: hunt nearby
    if (fish.hunger > 80 && fish.personality.aggression > 0.6) {
      const prey = this.fishes.find(f =>
        f.id !== fish.id &&
        f.species !== fish.species &&
        !f.isDead &&
        f.currentHp > 0 &&
        f.currentAction !== 'flee' &&
        f.hidden.hp < fish.hidden.hp &&
        Math.abs(fish.z - f.z) < 0.1 &&
        distance(fish.x, fish.y, f.x, f.y) < 120
      )
      if (prey) {
        fish.currentAction = 'hunt'
        fish.actionTarget = prey.id
        fish.actionUrgency = 0.8
        return
      }
    }

    // Default: wander
    fish.currentAction = 'wander'
    fish.actionUrgency = 0.3
  }

  private updateBubble(fish: Fish, dt: number) {
    if (fish.bubble) {
      fish.bubble.timer -= dt
      if (fish.bubble.timer <= 0.5) {
        fish.bubble.opacity = Math.max(0, fish.bubble.timer / 0.5)
      }
      if (fish.bubble.timer <= 0) {
        fish.bubble = null
      }
    }

    if (fish.bubble) return
    if (Math.random() > dt * 0.04) return

    // Priority: hurt > hungry > hobby/chat/action
    if (fish.currentHp < fish.hidden.hp * 0.4) {
      this.showBubble(fish, pickBubbleText('hurt'))
      return
    }
    if (fish.hunger > 75) {
      this.showBubble(fish, pickBubbleText('hungry'))
      return
    }

    // 40% chance: hobby bubble
    // 30% chance: chat with nearby fish
    // 30% chance: action bubble
    const roll = Math.random()
    if (roll < 0.4) {
      this.showHobbyBubble(fish)
    } else if (roll < 0.7) {
      this.tryChatWithNearby(fish)
    } else {
      this.showBubble(fish, pickBubbleText(fish.currentAction))
    }
  }

  showBubble(fish: Fish, text: string, duration: number = 3) {
    fish.bubble = {
      text,
      timer: duration,
      opacity: 1,
    }
  }

  private showHobbyBubble(fish: Fish) {
    // 40% chance to show knowledge from static local data
    if (Math.random() < 0.4) {
      const staticKnowledge = HOBBY_KNOWLEDGE[fish.hobby]
      if (staticKnowledge && staticKnowledge.length > 0) {
        const text = staticKnowledge[Math.floor(Math.random() * staticKnowledge.length)]
        this.showBubble(fish, text)
        return
      }
    }
    const texts = HOBBY_BUBBLES[fish.hobby]
    if (!texts || texts.length === 0) return
    const text = texts[Math.floor(Math.random() * texts.length)]
    this.showBubble(fish, text)
  }


  private tryChatWithNearby(fish: Fish) {
    const nearby = this.fishes.find(f =>
      f.id !== fish.id &&
      !f.bubble &&
      distance(fish.x, fish.y, f.x, f.y) < 120
    )

    if (!nearby) {
      this.showHobbyBubble(fish)
      return
    }

    // Fish A says something (hobby or greeting)
    if (Math.random() < 0.5) {
      this.showHobbyBubble(fish)
    } else {
      const greets = CHAT_RESPONSES.greet
      this.showBubble(fish, greets[Math.floor(Math.random() * greets.length)])
    }

    // Fish B responds after a short delay (set timer shorter so it appears staggered)
    setTimeout(() => {
      if (!nearby.bubble) {
        const response = Math.random() < 0.4
          ? pickChatResponse()
          : HOBBY_BUBBLES[nearby.hobby]?.[Math.floor(Math.random() * HOBBY_BUBBLES[nearby.hobby].length)] || pickChatResponse()
        nearby.bubble = { text: response, timer: 3 + Math.random(), opacity: 1 }
      }
    }, 800 + Math.random() * 600)
  }

  private updateRelationships(fish: Fish, dt: number) {
    for (const other of this.fishes) {
      if (other.id === fish.id) continue
      const dist = distance(fish.x, fish.y, other.x, other.y)

      let rel = fish.relationships.find(r => r.fishId === other.id)
      if (!rel) {
        rel = { fishId: other.id, affinity: 0, interactions: 0 }
        fish.relationships.push(rel)
      }

      // Proximity bonding: being near each other slowly increases affinity
      if (dist < 100) {
        rel.affinity = Math.min(100, rel.affinity + dt * 0.3)
      }

      // Same species bonus
      if (dist < 120 && fish.species === other.species) {
        rel.affinity = Math.min(100, rel.affinity + dt * 0.15)
      }

      // Playing together
      if (dist < 100 && fish.currentAction === 'play' && other.currentAction === 'play') {
        rel.affinity = Math.min(100, rel.affinity + dt * 1.0)
      }

      // Very slow natural decay (relationships fade without interaction)
      rel.affinity *= (1 - dt * 0.002)
    }
  }

  private checkLevelUp(fish: Fish) {
    const expNeeded = fish.hidden.level * 100
    if (fish.hidden.exp >= expNeeded) {
      fish.hidden.exp -= expNeeded
      fish.hidden.level++
      fish.hidden.hp += 5
      fish.hidden.attack += 1
      fish.hidden.defense += 1
      fish.hidden.speed += 0.5
      fish.currentHp = fish.hidden.hp
      
      // Grow slightly each level, max bodyLength cap raised
      fish.appearance.bodyLength = Math.min(100, fish.appearance.bodyLength * 1.05)
      
      // Skill milestones
      const ALL_SKILLS: import('./types').FishSkill[] = ['dash', 'magnet', 'tough', 'zen', 'glow']
      if (fish.hidden.level % 5 === 0) {
        const availableSkills = ALL_SKILLS.filter(s => !fish.skills.includes(s))
        if (availableSkills.length > 0) {
          const newSkill = availableSkills[Math.floor(Math.random() * availableSkills.length)]
          fish.skills.push(newSkill)
          
          // Custom skill bubble text
          const skillNames: Record<string, string> = {
            dash: '迅捷水流', magnet: '深海巨口', tough: '钢铁鳞片', zen: '禅定吐息', glow: '海王光环'
          }
          this.showBubble(fish, `学会了 [${skillNames[newSkill]}]!`)
        } else {
          this.showBubble(fish, 'levelup')
        }
      } else {
        this.showBubble(fish, 'levelup')
      }
    }
  }

  private checkBreeding() {
    for (let i = 0; i < this.fishes.length; i++) {
      for (let j = i + 1; j < this.fishes.length; j++) {
        const a = this.fishes[i]
        const b = this.fishes[j]

        if (a.species !== b.species) continue
        if (a.hidden.level < 5 || b.hidden.level < 5) continue
        if (a.hunger > 30 || b.hunger > 30) continue
        if (a.breedCooldown > 0 || b.breedCooldown > 0) continue
        if (a.mood !== 'happy' && a.mood !== 'calm') continue

        const dist = Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2)
        if (dist > 80) continue

        if (Math.random() < 0.001) {
          this.breed(a, b)
        }
      }
    }
  }

  private breed(parent1: Fish, parent2: Fish) {
    if (this.fishes.length >= 10) return

    const child = createFish({
      name: `${parent1.name}Jr`,
      species: parent1.species,
      x: (parent1.x + parent2.x) / 2,
      y: (parent1.y + parent2.y) / 2,
    })

    child.hidden.attack = this.inheritStat(parent1.hidden.attack, parent2.hidden.attack)
    child.hidden.defense = this.inheritStat(parent1.hidden.defense, parent2.hidden.defense)
    child.hidden.speed = this.inheritStat(parent1.hidden.speed, parent2.hidden.speed)
    child.hidden.hp = this.inheritStat(parent1.hidden.hp, parent2.hidden.hp)
    child.currentHp = child.hidden.hp
    child.appearance.bodyLength = 20

    child.appearance.primaryColor = {
      h: (parent1.appearance.primaryColor.h + parent2.appearance.primaryColor.h) / 2 + (Math.random() - 0.5) * 20,
      s: (parent1.appearance.primaryColor.s + parent2.appearance.primaryColor.s) / 2,
      l: (parent1.appearance.primaryColor.l + parent2.appearance.primaryColor.l) / 2,
    }

    parent1.breedCooldown = 300
    parent2.breedCooldown = 300

    this.fishes.push(child)
  }

  private inheritStat(a: number, b: number): number {
    const avg = (a + b) / 2
    return avg * (0.9 + Math.random() * 0.2)
  }

  startPlayerControl(fishId: string) {
    this.playerController.startPress(fishId)
  }

  cancelPlayerControl() {
    this.playerController.cancelPress()
  }

  exitPlayerControl() {
    const fishId = this.playerController.state.fishId
    if (fishId) {
      const fish = this.fishes.find(f => f.id === fishId)
      if (fish) {
        fish.currentAction = 'wander'
        this.showBubble(fish, '自由了~')
      }
    }
    this.playerController.exit()
    this.onPlayerControlChange(this.playerController.state)
  }

  private updateShockwaves(dt: number) {
    this.shockwaves.forEach(sw => {
      const moveDist = sw.speed * dt
      sw.x += Math.cos(sw.angle) * moveDist
      sw.y += Math.sin(sw.angle) * moveDist
      sw.traveled += moveDist

      // Expand radius as it travels
      const travelRatio = sw.traveled / sw.range
      sw.radius = sw.maxRadius * (0.5 + travelRatio * 0.5)
      sw.opacity = 1 - travelRatio * 0.6

      // Check collision with fishes
      this.fishes.forEach(fish => {
        if (fish.id === sw.sourceFishId || fish.isDead) return
        if (sw.hitFishIds.includes(fish.id)) return

        const dist = distance(sw.x, sw.y, fish.x, fish.y)
        if (dist < sw.radius + fish.appearance.bodyLength * 0.4) {
          sw.hitFishIds.push(fish.id)

          // Apply damage
          const defense = fish.hidden.defense * 0.3
          const dmg = Math.max(1, sw.damage - defense)
          fish.currentHp -= dmg
          fish.hitFlash = 1

          // Knockback along shockwave direction
          fish.vx += Math.cos(sw.angle) * sw.knockback
          fish.vy += Math.sin(sw.angle) * sw.knockback

          // Stun if target level is lower than source
          if (fish.hidden.level < sw.sourceLevel) {
            fish.stunTimer = 2 + (sw.sourceLevel - fish.hidden.level) * 0.3
            this.showBubble(fish, '晕了...')
          } else {
            this.showBubble(fish, '好痛!')
          }
        }
      })
    })

    // Remove expired shockwaves
    this.shockwaves = this.shockwaves.filter(sw => sw.traveled < sw.range)
  }

  private playerAttack(attacker: Fish, target: Fish) {
    // Face toward the target
    const dx = target.x - attacker.x
    const dy = target.y - attacker.y
    const dist = Math.sqrt(dx * dx + dy * dy) || 1
    attacker.angle = Math.atan2(dy, dx)

    const damage = Math.max(1, attacker.hidden.attack - target.hidden.defense * 0.5)
    target.currentHp -= damage
    target.hitFlash = 1
    attacker.hitFlash = 0.5
    attacker.hidden.exp += 20

    target.vx += (dx / dist) * 20
    target.vy += (dy / dist) * 20
    attacker.vx -= (dx / dist) * 8
    attacker.vy -= (dy / dist) * 8

    this.showBubble(attacker, '吃我一击!')

    if (target.currentHp <= 0) {
      target.currentHp = 0
      attacker.hidden.exp += 50
      this.showBubble(attacker, 'K.O.!')
    } else {
      if (target.personality.cowardice > 0.3) {
        target.currentAction = 'flee'
        target.actionTarget = attacker.id
        target.actionUrgency = 1
      }
    }
  }

  async triggerStoryEvent(forceLocal = false) {
    if (this.storyEventEngine.isActive) return

    if (forceLocal) {
      const payload = this.storyEventTrigger.generateFallbackEvent(this.fishes)
      this.storyEventEngine.start(payload, this.fishes)
      return
    }

    const payload = await this.storyEventTrigger.requestEvent(this.fishes)
    if (payload) {
      this.storyEventEngine.start(payload, this.fishes)
    } else {
      const fallback = this.storyEventTrigger.generateFallbackEvent(this.fishes)
      this.storyEventEngine.start(fallback, this.fishes)
    }
  }

  submitStoryChoice(optionIndex: number) {
    this.storyEventEngine.submitChoice(optionIndex, this.fishes)
  }
}
