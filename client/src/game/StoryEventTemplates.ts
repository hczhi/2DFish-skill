export interface EventTemplate {
  id: string
  name: string
  triggerConditions: {
    minFishCount?: number
    minAvgLevel?: number
    minPlayTime?: number
  }
  phaseTypes: EventPhaseType[]
}

export type EventPhaseType = 'narration' | 'spawn_enemy' | 'battle' | 'choice' | 'reward'

export interface EventPhase {
  type: EventPhaseType
  narration?: string
  enemy?: {
    name: string
    hp: number
    attack: number
    defense: number
    appearance: { color: string; size: number; shape: string }
  }
  battle?: {
    duration: number
    difficulty: 'easy' | 'normal' | 'hard'
  }
  choice?: {
    prompt: string
    options: { label: string; effect: string }[]
  }
  reward?: {
    exp: number
    statBoost?: { fishId: string; stat: string; amount: number }[]
    narration: string
  }
}

export interface StoryEventPayload {
  templateId: string
  title: string
  phases: EventPhase[]
}

export const EVENT_TEMPLATES: EventTemplate[] = [
  {
    id: 'boss_raid',
    name: '海怪入侵',
    triggerConditions: { minFishCount: 2, minAvgLevel: 3, minPlayTime: 600 },
    phaseTypes: ['narration', 'spawn_enemy', 'battle', 'reward'],
  },
  {
    id: 'treasure_chest',
    name: '神秘宝箱',
    triggerConditions: { minFishCount: 1, minAvgLevel: 2, minPlayTime: 300 },
    phaseTypes: ['narration', 'choice', 'reward'],
  },
  {
    id: 'storm',
    name: '深海风暴',
    triggerConditions: { minFishCount: 3, minAvgLevel: 4, minPlayTime: 900 },
    phaseTypes: ['narration', 'battle', 'reward'],
  },
]
