import type { Fish, AIConfig } from './types'
import { EVENT_TEMPLATES } from './StoryEventTemplates'
import type { StoryEventPayload } from './StoryEventTemplates'

export class StoryEventTrigger {
  private cooldown = 0
  private minInterval = 600 // 10 minutes between events
  private totalPlayTime = 0
  private fetching = false

  update(dt: number) {
    this.totalPlayTime += dt
    if (this.cooldown > 0) this.cooldown -= dt
  }

  canTrigger(fishes: Fish[]): boolean {
    if (this.cooldown > 0 || this.fetching) return false
    if (fishes.filter(f => !f.isDead).length === 0) return false

    const aliveFishes = fishes.filter(f => !f.isDead)
    const avgLevel = aliveFishes.reduce((s, f) => s + f.hidden.level, 0) / aliveFishes.length

    const eligible = EVENT_TEMPLATES.filter(t => {
      if (t.triggerConditions.minFishCount && aliveFishes.length < t.triggerConditions.minFishCount) return false
      if (t.triggerConditions.minAvgLevel && avgLevel < t.triggerConditions.minAvgLevel) return false
      if (t.triggerConditions.minPlayTime && this.totalPlayTime < t.triggerConditions.minPlayTime) return false
      return true
    })

    return eligible.length > 0
  }

  getEligibleTemplateIds(fishes: Fish[]): string[] {
    const aliveFishes = fishes.filter(f => !f.isDead)
    const avgLevel = aliveFishes.reduce((s, f) => s + f.hidden.level, 0) / aliveFishes.length

    return EVENT_TEMPLATES
      .filter(t => {
        if (t.triggerConditions.minFishCount && aliveFishes.length < t.triggerConditions.minFishCount) return false
        if (t.triggerConditions.minAvgLevel && avgLevel < t.triggerConditions.minAvgLevel) return false
        if (t.triggerConditions.minPlayTime && this.totalPlayTime < t.triggerConditions.minPlayTime) return false
        return true
      })
      .map(t => t.id)
  }

  async requestEvent(fishes: Fish[], config: AIConfig): Promise<StoryEventPayload | null> {
    if (this.fetching) return null
    this.fetching = true
    this.cooldown = this.minInterval

    const aliveFishes = fishes.filter(f => !f.isDead)
    const templates = this.getEligibleTemplateIds(fishes)

    try {
      const res = await fetch('/api/ai/story-event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiUrl: config.apiUrl,
          apiKey: config.apiKey,
          model: config.model,
          fishes: aliveFishes.map(f => ({
            id: f.id,
            name: f.name,
            species: f.species,
            level: f.hidden.level,
            attack: f.hidden.attack,
            hp: f.hidden.hp,
          })),
          availableTemplates: templates,
          playTime: this.totalPlayTime,
        }),
      })

      if (!res.ok) return null

      const data = await res.json()
      if (data.templateId && data.phases) {
        return data as StoryEventPayload
      }
      return null
    } catch {
      return null
    } finally {
      this.fetching = false
    }
  }

  // For debug/manual trigger
  generateFallbackEvent(fishes: Fish[]): StoryEventPayload {
    const aliveFishes = fishes.filter(f => !f.isDead)
    const totalAtk = aliveFishes.reduce((s, f) => s + f.hidden.attack, 0)
    const bossHp = totalAtk * 15

    return {
      templateId: 'boss_raid',
      title: '深海巨怪来袭！',
      phases: [
        { type: 'narration', narration: '海底传来阵阵轰鸣，一个巨大的身影正在逼近...' },
        {
          type: 'spawn_enemy',
          enemy: {
            name: '深海巨鳗',
            hp: bossHp,
            attack: Math.round(totalAtk * 0.3),
            defense: 5,
            appearance: { color: 'hsl(270, 60%, 40%)', size: 80, shape: 'serpent' },
          },
        },
        { type: 'battle', battle: { duration: 20, difficulty: 'normal' } },
        { type: 'reward', reward: { exp: 50, narration: '击败了深海巨鳗！全体鱼获得 50 经验！' } },
      ],
    }
  }
}
