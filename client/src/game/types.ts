export interface Personality {
  aggression: number
  social: number
  curiosity: number
  cowardice: number
}

export type Hobby = 'sports' | 'food' | 'gaming' | 'music' | 'coding' | 'gossip' | 'philosophy' | 'finance'

export interface HiddenStats {
  attack: number
  defense: number
  speed: number
  hp: number
  recovery: number
  exp: number
  level: number
}

export interface FishAppearance {
  bodyLength: number
  bodyWidth: number
  bodyShape: 'oval' | 'slim' | 'round' | 'angular'
  primaryColor: { h: number; s: number; l: number }
  secondaryColor: { h: number; s: number; l: number }
  patternColor: { h: number; s: number; l: number }
  pattern: 'none' | 'stripes' | 'spots' | 'gradient'
  patternDensity: number
  finSize: number
  finShape: 'flowing' | 'sharp' | 'round'
  tailShape: 'forked' | 'fan' | 'pointed'
  eyeSize: number
}

export interface Relationship {
  fishId: string
  affinity: number // -100 (enemy) to 100 (best friend)
  interactions: number
}

export type FishSkill = 'dash' | 'magnet' | 'tough' | 'zen' | 'glow'

export interface Fish {
  id: string
  name: string
  species: string
  hobby: Hobby
  personality: Personality
  hidden: HiddenStats
  appearance: FishAppearance
  skills: FishSkill[]
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  targetZ: number
  angle: number
  angularVelocity: number
  segments: { x: number; y: number; angle: number }[]
  currentAction: string
  actionTarget: string | null
  actionUrgency: number
  hunger: number
  currentHp: number
  mood: string
  age: number
  wanderAngle: number
  wanderTimer: number
  animTime: number
  breedCooldown: number
  facingDir: number
  facingTransition: number
  yaw: number
  mouthOpen: number
  turnAccumulator: number // Tracks continuous spinning to break death spirals
  stuckCheckX: number
  stuckCheckY: number
  stuckTimer: number
  stunTimer: number
  isDead: boolean
  deadTimer: number
  bubble: BubbleState | null
  // Visual state for animations
  actionTimer: number
  prevAction: string
  hitFlash: number
  chargeAmount: number
  // Fight state
  fightRounds: number
  fightPhase: 'charge' | 'clash' | 'recoil' | 'idle'
  fightPhaseTimer: number
  // Interaction
  petEffect: number // 0-1, decays over time, triggered by click
  relationships: Relationship[]
}

export interface BubbleState {
  text: string
  timer: number
  opacity: number
}

export interface PhysicalBubble {
  id: string
  x: number
  y: number
  size: number
  vx: number
  vy: number
  life: number
  maxLife: number
}

export interface Food {
  id: string
  x: number
  y: number
  vy: number
  vx: number
  life: number
  opacity: number
  size: number
}

export interface AIConfig {
  apiUrl: string
  apiKey: string
  model: string
}

export interface GameState {
  fishes: Fish[]
  foods: Food[]
  physicalBubbles: PhysicalBubble[]
  shockwaves: Shockwave[]
}

export type ActionType = 'idle' | 'wander' | 'hunt' | 'flee' | 'eat' | 'follow' | 'rest' | 'play' | 'hide' | 'attack' | 'fight' | 'stunned' | 'dead' | 'player-control'

export interface Shockwave {
  id: string
  x: number
  y: number
  angle: number // direction of travel
  speed: number
  radius: number // current radius (expands as it travels)
  maxRadius: number
  damage: number
  knockback: number
  range: number // max travel distance
  traveled: number
  sourceLevel: number
  sourceFishId: string
  opacity: number
  hitFishIds: string[] // already hit targets
}

export interface PlayerControlState {
  active: boolean
  fishId: string | null
  pressStartTime: number
  pressProgress: number // 0~1, 长按进度
  confirmed: boolean // 进度满，进入控制模式
  targetLockMode: boolean // A键长按锁定模式
  targetLockFishId: string | null // 当前锁定的攻击目标
  targetCandidates: string[] // 附近可攻击目标列表
  targetIndex: number // 当前选中索引
  keys: {
    up: boolean
    down: boolean
    left: boolean
    right: boolean
    z: boolean
    x: boolean
    a: boolean
    s: boolean
  }
  aHoldTime: number // A键按住时长
  sCharging: boolean // S键正在蓄力
  sChargeTime: number // S键蓄力时长
  sCooldown: number // 冲击波冷却剩余时间
}
