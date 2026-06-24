import type { Fish, Food, Relationship } from './types'

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function distance(x1: number, y1: number, x2: number, y2: number): number {
  return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2)
}

function normalize(x: number, y: number): { x: number; y: number } {
  const len = Math.sqrt(x * x + y * y)
  if (len === 0) return { x: 0, y: 0 }
  return { x: x / len, y: y / len }
}

function noise(t: number, seed: number): number {
  const x = Math.sin(t * 1.1 + seed) * 0.5
    + Math.sin(t * 2.3 + seed * 1.7) * 0.3
    + Math.sin(t * 4.7 + seed * 3.1) * 0.2
  return x
}

export class BehaviorExecutor {
  tankWidth: number
  tankHeight: number

  constructor(tankWidth: number, tankHeight: number) {
    this.tankWidth = tankWidth
    this.tankHeight = tankHeight
  }

  execute(fish: Fish, allFishes: Fish[], foods: Food[], dt: number) {
    const baseSpeed = (fish.hidden.speed * 0.05 + 0.2) * (1 + fish.hidden.level * 0.02) * (1 + fish.actionUrgency * 0.3)

    if (fish.isDead) {
      this.doDead(fish, dt)
      this.applyPhysics(fish, dt)
      return
    }

    if (fish.stunTimer > 0) {
      fish.stunTimer -= dt
      if (fish.stunTimer <= 0) {
        fish.currentAction = 'wander'
      } else {
        fish.currentAction = 'stunned'
        this.doStunned(fish, dt)
        this.applyPhysics(fish, dt)
        return
      }
    }

    switch (fish.currentAction) {
      case 'idle':
        this.doIdle(fish, dt)
        break
      case 'wander':
        this.doWander(fish, allFishes, baseSpeed, dt)
        break
      case 'hunt':
      case 'attack':
        this.doHunt(fish, allFishes, baseSpeed, dt)
        break
      case 'fight':
        this.doFight(fish, allFishes, baseSpeed, dt)
        break
      case 'flee':
        this.doFlee(fish, allFishes, baseSpeed, dt)
        break
      case 'eat':
        this.doEat(fish, foods, baseSpeed, dt)
        break
      case 'follow':
        this.doWander(fish, allFishes, baseSpeed, dt)
        break
      case 'rest':
        this.doRest(fish, dt)
        break
      case 'play':
        this.doWander(fish, allFishes, baseSpeed, dt)
        break
      case 'hide':
        this.doHide(fish, baseSpeed, dt)
        break
      default:
        this.doWander(fish, allFishes, baseSpeed, dt)
    }

    // Fluid damping
    fish.vx *= 0.97
    fish.vy *= 0.97
    fish.vz *= 0.95

    // Z-axis movement toward targetZ
    if (fish.z === undefined) fish.z = 0.6
    if (fish.vz === undefined) fish.vz = 0
    if (fish.targetZ === undefined) fish.targetZ = 0.4 + Math.random() * 0.5

    const zDiff = fish.targetZ - fish.z
    fish.vz += zDiff * 0.03
    fish.z += fish.vz * dt * 2

    if (fish.z < 0.3) { fish.z = 0.3; fish.vz = Math.abs(fish.vz) * 0.3 }
    if (fish.z > 0.95) { fish.z = 0.95; fish.vz = -Math.abs(fish.vz) * 0.3 }

    // Apply position
    fish.x += fish.vx * dt * 60
    fish.y += fish.vy * dt * 60

    // Hard boundary clamp
    const margin = 50
    if (fish.x < margin) { fish.x = margin; fish.vx = Math.abs(fish.vx) * 0.3 }
    if (fish.x > this.tankWidth - margin) { fish.x = this.tankWidth - margin; fish.vx = -Math.abs(fish.vx) * 0.3 }
    if (fish.y < margin) { fish.y = margin; fish.vy = Math.abs(fish.vy) * 0.3 }
    if (fish.y > this.tankHeight - margin) { fish.y = this.tankHeight - margin; fish.vy = -Math.abs(fish.vy) * 0.3 }

    // Sync angle to velocity for non-wander actions (wander sets angle directly)
    const speed = Math.sqrt(fish.vx * fish.vx + fish.vy * fish.vy)
    const oldAngle = fish.angle
    if (speed > 0.1 && fish.currentAction !== 'wander' && fish.currentAction !== 'play' && fish.currentAction !== 'follow') {
      const targetAngle = Math.atan2(fish.vy, fish.vx)
      let diff = targetAngle - fish.angle
      while (diff > Math.PI) diff -= Math.PI * 2
      while (diff < -Math.PI) diff += Math.PI * 2
      fish.angle += diff * 0.4
    }

    // Angular velocity for body bending
    let angleDiff = fish.angle - oldAngle
    while (angleDiff > Math.PI) angleDiff -= Math.PI * 2
    while (angleDiff < -Math.PI) angleDiff += Math.PI * 2
    const maxAngVel = 0.12
    const targetAngVel = Math.max(-maxAngVel, Math.min(maxAngVel, angleDiff / dt))
    fish.angularVelocity = lerp(fish.angularVelocity, targetAngVel, 0.1)
  }

  private doIdle(fish: Fish, dt: number) {
    // Gently decelerate to a near stop
    fish.vx = lerp(fish.vx, 0, 0.03)
    fish.vy = lerp(fish.vy, 0, 0.03)
  }

  private pickWanderTarget(fish: Fish) {
    const margin = 100
    const w = this.tankWidth
    const h = this.tankHeight

    // Primarily swim along X axis — pick a target on the opposite horizontal side
    const goingRight = fish.vx >= 0
    if (goingRight) {
      fish.stuckCheckX = w - margin - Math.random() * (w * 0.3)
    } else {
      fish.stuckCheckX = margin + Math.random() * (w * 0.3)
    }
    // If near a horizontal edge, flip to the other side
    if (fish.x > w - margin * 1.5) {
      fish.stuckCheckX = margin + Math.random() * (w * 0.3)
    } else if (fish.x < margin * 1.5) {
      fish.stuckCheckX = w - margin - Math.random() * (w * 0.3)
    }

    // Y changes only slightly — keep roughly same depth band
    fish.stuckCheckY = fish.y + (Math.random() - 0.5) * (h * 0.3)
    fish.stuckCheckY = Math.max(margin, Math.min(h - margin, fish.stuckCheckY))

    // Z changes on turn — keep in front half of tank (0.4~0.9)
    fish.targetZ = 0.4 + Math.random() * 0.5
  }

  private doWander(fish: Fish, allFishes: Fish[], speed: number, dt: number) {
    // stuckCheckX/Y is repurposed as the wander target point
    const targetX = fish.stuckCheckX
    const targetY = fish.stuckCheckY
    const dx = targetX - fish.x
    const dy = targetY - fish.y
    const distToTarget = Math.sqrt(dx * dx + dy * dy)

    // Arrived at target (or no valid target) — pick a new one
    if (distToTarget < 60 || (targetX === 0 && targetY === 0)) {
      this.pickWanderTarget(fish)
      return
    }

    // Steer angle toward target, then push velocity along angle
    // This guarantees fish always moves in the direction it faces
    const targetAngle = Math.atan2(dy, dx)
    let angleDiff = targetAngle - fish.angle
    while (angleDiff > Math.PI) angleDiff -= Math.PI * 2
    while (angleDiff < -Math.PI) angleDiff += Math.PI * 2

    // Turn rate — smooth but decisive
    fish.angle += angleDiff * 0.06

    // Always swim forward along current facing direction
    const swimSpeed = speed * 0.6
    fish.vx = Math.cos(fish.angle) * swimSpeed
    fish.vy = Math.sin(fish.angle) * swimSpeed
  }

  private doHunt(fish: Fish, allFishes: Fish[], speed: number, dt: number) {
    const target = allFishes.find(f => f.id === fish.actionTarget)
    if (!target || target.isDead) {
      fish.currentAction = 'wander'
      return
    }

    const dist = distance(fish.x, fish.y, target.x, target.y)

    // Give up if target fled too far (short chase only)
    if (dist > 150) {
      fish.currentAction = 'wander'
      fish.actionTarget = null
      fish.actionUrgency = 0.3
      return
    }

    // Give up if target is fleeing (already escaped)
    if (target.currentAction === 'flee' && dist > 80) {
      fish.currentAction = 'wander'
      fish.actionTarget = null
      fish.actionUrgency = 0.3
      return
    }

    // Anticipation (蓄力)
    if (fish.actionTimer < 0.3) {
      const dx = fish.x - target.x
      const dy = fish.y - target.y
      const dir = normalize(dx, dy)
      fish.vx = lerp(fish.vx, dir.x * speed * 0.3, 0.08)
      fish.vy = lerp(fish.vy, dir.y * speed * 0.3, 0.08)
      return
    }

    const dx = target.x - fish.x
    const dy = target.y - fish.y

    if (dist < 25) {
      this.triggerAttack(fish, target)
      return
    }

    fish.targetZ = target.z

    const dir = normalize(dx, dy)
    const dashMod = fish.skills?.includes('dash') ? 1.3 : 1.0
    const huntSpeed = speed * 1.2 * dashMod
    fish.vx = lerp(fish.vx, dir.x * huntSpeed, 0.06)
    fish.vy = lerp(fish.vy, dir.y * huntSpeed, 0.06)
  }

  private doFlee(fish: Fish, allFishes: Fish[], speed: number, dt: number) {
    const threat = allFishes.find(f => f.id === fish.actionTarget)
    if (!threat) {
      fish.currentAction = 'wander'
      return
    }

    if (fish.actionTimer < 0.2) {
      fish.vx = lerp(fish.vx, 0, 0.15)
      fish.vy = lerp(fish.vy, 0, 0.15)
      return
    }

    const dx = fish.x - threat.x
    const dy = fish.y - threat.y
    const dist = distance(fish.x, fish.y, threat.x, threat.y)

    const zigzag = Math.sin(fish.animTime * 6) * 0.5
    const dir = normalize(dx + zigzag * dy, dy - zigzag * dx)
    const fleeSpeed = speed * 2.5
    fish.vx = lerp(fish.vx, dir.x * fleeSpeed, 0.1)
    fish.vy = lerp(fish.vy, dir.y * fleeSpeed, 0.1)

    fish.targetZ = threat.z > 0.5 ? 0.1 : 0.9

    if (dist > 250) {
      fish.currentAction = 'wander'
      fish.actionTarget = null
      fish.actionUrgency = 0.3
    }
  }

  private doEat(fish: Fish, foods: Food[], speed: number, dt: number) {
    let nearestFood: Food | null = null
    let nearestDist = Infinity
    for (const food of foods) {
      const d = distance(fish.x, fish.y, food.x, food.y)
      if (d < nearestDist) {
        nearestDist = d
        nearestFood = food
      }
    }

    if (!nearestFood) {
      fish.currentAction = 'wander'
      return
    }

    const dx = nearestFood.x - fish.x
    const dy = nearestFood.y - fish.y
    const eatRange = fish.skills?.includes('magnet') ? 45 : 15

    if (nearestDist < eatRange) {
      fish.hunger = Math.max(0, fish.hunger - 30)
      nearestFood.life = 0
      fish.currentAction = 'wander'
      fish.hidden.exp += 10
      fish.hidden.recovery += 0.1
      return
    }

    const excitement = Math.min(1, fish.hunger / 80)
    const approachSpeed = speed * (0.6 + excitement * 0.8)
    const dir = normalize(dx, dy)
    fish.vx = lerp(fish.vx, dir.x * approachSpeed, 0.03 + excitement * 0.03)
    fish.vy = lerp(fish.vy, dir.y * approachSpeed, 0.03 + excitement * 0.03)
  }

  private doFollow(fish: Fish, allFishes: Fish[], speed: number, dt: number) {
    const target = allFishes.find(f => f.id === fish.actionTarget)
    if (!target) {
      fish.currentAction = 'wander'
      return
    }

    fish.targetZ = target.z

    const dx = target.x - fish.x
    const dy = target.y - fish.y
    const dist = distance(fish.x, fish.y, target.x, target.y)

    if (dist < 50) {
      const away = normalize(-dx, -dy)
      fish.vx = lerp(fish.vx, away.x * speed * 0.2, 0.02)
      fish.vy = lerp(fish.vy, away.y * speed * 0.2, 0.02)
      return
    }

    if (dist < 100) {
      const seed = fish.id.charCodeAt(5) || 1
      fish.vx = lerp(fish.vx, target.vx + noise(fish.animTime, seed) * 0.5, 0.03)
      fish.vy = lerp(fish.vy, target.vy + noise(fish.animTime, seed + 30) * 0.5, 0.03)
      return
    }

    const dir = normalize(dx, dy)
    fish.vx = lerp(fish.vx, dir.x * speed * 0.7, 0.03)
    fish.vy = lerp(fish.vy, dir.y * speed * 0.7, 0.03)
  }

  private doRest(fish: Fish, dt: number) {
    const targetY = this.tankHeight - 100
    const seed = fish.id.charCodeAt(5) || 1
    const sway = noise(fish.animTime * 0.3, seed) * 0.2
    fish.vx = lerp(fish.vx, sway, 0.02)
    fish.vy = lerp(fish.vy, (targetY - fish.y) * 0.003, 0.02)

    if (fish.skills?.includes('zen') && fish.currentHp < fish.hidden.hp) {
      fish.currentHp = Math.min(fish.hidden.hp, fish.currentHp + fish.hidden.recovery * dt * 0.5)
    }
  }

  private doPlay(fish: Fish, speed: number, dt: number) {
    const t = fish.animTime * 2
    const playSpeed = speed * 1.1
    const targetVx = Math.sin(t) * playSpeed * 0.8
    const targetVy = Math.sin(t * 2) * playSpeed * 0.4
    const burst = Math.random() < 0.01
    const mult = burst ? 2.5 : 1
    fish.vx = lerp(fish.vx, targetVx * mult, 0.04)
    fish.vy = lerp(fish.vy, targetVy * mult, 0.04)
  }

  private doHide(fish: Fish, speed: number, dt: number) {
    const corners = [
      { x: 60, y: this.tankHeight - 60 },
      { x: this.tankWidth - 60, y: this.tankHeight - 60 },
      { x: 60, y: 60 },
      { x: this.tankWidth - 60, y: 60 },
    ]

    let nearest = corners[0]
    let nearestDist = distance(fish.x, fish.y, corners[0].x, corners[0].y)
    for (const c of corners) {
      const d = distance(fish.x, fish.y, c.x, c.y)
      if (d < nearestDist) { nearest = c; nearestDist = d }
    }

    if (nearestDist < 40) {
      fish.vx = lerp(fish.vx, noise(fish.animTime * 2, 99) * 0.15, 0.05)
      fish.vy = lerp(fish.vy, noise(fish.animTime * 2, 77) * 0.15, 0.05)
      return
    }

    const dir = normalize(nearest.x - fish.x, nearest.y - fish.y)
    fish.vx = lerp(fish.vx, dir.x * speed * 0.8, 0.04)
    fish.vy = lerp(fish.vy, dir.y * speed * 0.8, 0.04)
  }

  private triggerAttack(attacker: Fish, target: Fish) {
    const damage = Math.max(1, attacker.hidden.attack - target.hidden.defense * 0.5)
    target.currentHp -= damage
    target.hitFlash = 1
    attacker.hitFlash = 0.5
    attacker.hunger = Math.max(0, attacker.hunger - 20)
    attacker.hidden.exp += 20
    attacker.hidden.attack += 0.3

    const dx = target.x - attacker.x
    const dy = target.y - attacker.y
    const dist = Math.sqrt(dx * dx + dy * dy) || 1

    // Knockback both slightly
    target.vx += (dx / dist) * 80
    target.vy += (dy / dist) * 80
    attacker.vx -= (dx / dist) * 40
    attacker.vy -= (dy / dist) * 40

    // Relationship damage
    let rel = target.relationships.find(r => r.fishId === attacker.id)
    if (!rel) {
      rel = { fishId: attacker.id, affinity: 0, interactions: 0 }
      target.relationships.push(rel)
    }
    rel.affinity = Math.max(-100, rel.affinity - 25)
    rel.interactions++

    if (target.currentHp <= 0) {
      target.currentHp = 0
      attacker.hidden.exp += 50
      attacker.currentAction = 'wander'
      attacker.actionTarget = null
      return
    }

    // Fight back chance: based on target's aggression and cowardice
    const fightBackChance = target.personality.aggression * 0.6 + (1 - target.personality.cowardice) * 0.3
    if (Math.random() < fightBackChance && target.currentHp > target.hidden.hp * 0.3) {
      // Both enter fight mode
      this.startFight(attacker, target)
    } else {
      // Normal flee
      target.stunTimer = 2 + Math.random() * 1.5
      target.hidden.defense += 0.5
      target.hidden.exp += 25
      target.currentAction = 'flee'
      target.actionTarget = attacker.id
      target.actionUrgency = 1
      attacker.currentAction = 'wander'
      attacker.actionTarget = null
    }
  }

  private startFight(fishA: Fish, fishB: Fish) {
    const totalRounds = 3 + Math.floor(Math.random() * 3) // 3-5 rounds

    fishA.currentAction = 'fight'
    fishA.actionTarget = fishB.id
    fishA.fightRounds = totalRounds
    fishA.fightPhase = 'recoil'
    fishA.fightPhaseTimer = 0.4

    fishB.currentAction = 'fight'
    fishB.actionTarget = fishA.id
    fishB.fightRounds = totalRounds
    fishB.fightPhase = 'recoil'
    fishB.fightPhaseTimer = 0.4
  }

  private doFight(fish: Fish, allFishes: Fish[], speed: number, dt: number) {
    const opponent = allFishes.find(f => f.id === fish.actionTarget)
    if (!opponent || opponent.isDead || opponent.currentAction !== 'fight') {
      fish.currentAction = 'wander'
      fish.actionTarget = null
      fish.fightRounds = 0
      fish.fightPhase = 'idle'
      return
    }

    fish.fightPhaseTimer -= dt
    const dx = opponent.x - fish.x
    const dy = opponent.y - fish.y
    const dist = distance(fish.x, fish.y, opponent.x, opponent.y)
    fish.targetZ = opponent.z

    switch (fish.fightPhase) {
      case 'recoil':
        // Short pull-back — just barely separate, stay close
        if (dist < 40) {
          const away = normalize(-dx, -dy)
          fish.vx = lerp(fish.vx, away.x * speed * 0.8, 0.15)
          fish.vy = lerp(fish.vy, away.y * speed * 0.8, 0.15)
        } else {
          // Stay near opponent, orbit slightly
          const orbit = normalize(-dy, dx)
          fish.vx = lerp(fish.vx, orbit.x * speed * 0.4, 0.1)
          fish.vy = lerp(fish.vy, orbit.y * speed * 0.4, 0.1)
        }
        if (fish.fightPhaseTimer <= 0) {
          fish.fightPhase = 'charge'
          fish.fightPhaseTimer = 0.3 + Math.random() * 0.2
        }
        break

      case 'charge': {
        // Short quick lunge toward opponent
        const chargeDir = normalize(dx, dy)
        const chargeSpeed = speed * 2.0
        fish.vx = lerp(fish.vx, chargeDir.x * chargeSpeed, 0.2)
        fish.vy = lerp(fish.vy, chargeDir.y * chargeSpeed, 0.2)

        if (dist < 25 || fish.fightPhaseTimer <= 0) {
          fish.fightPhase = 'clash'
          fish.fightPhaseTimer = 0.2
        }
        break
      }

      case 'clash':
        // Impact — deal damage, small knockback
        if (fish.fightPhaseTimer > 0.15) {
          const clashDamage = Math.max(1, fish.hidden.attack * 0.5 - opponent.hidden.defense * 0.3)
          opponent.currentHp -= clashDamage
          opponent.hitFlash = 0.8
          fish.hitFlash = 0.3
          fish.hidden.exp += 8

          // Small mutual knockback — stay close
          const knockDir = normalize(dx, dy)
          fish.vx -= knockDir.x * 30
          fish.vy -= knockDir.y * 30
          opponent.vx += knockDir.x * 20
          opponent.vy += knockDir.y * 20
        }

        fish.vx *= 0.9
        fish.vy *= 0.9

        if (fish.fightPhaseTimer <= 0) {
          fish.fightRounds--
          if (fish.fightRounds <= 0 || fish.currentHp <= 0 || opponent.currentHp <= 0) {
            this.endFight(fish, opponent)
          } else {
            fish.fightPhase = 'recoil'
            fish.fightPhaseTimer = 0.3 + Math.random() * 0.2
          }
        }
        break
    }
  }

  private endFight(fish: Fish, opponent: Fish) {
    // Loser = lower HP ratio
    const fishHpRatio = fish.currentHp / fish.hidden.hp
    const opponentHpRatio = opponent.currentHp / opponent.hidden.hp

    if (fish.currentHp <= 0) {
      fish.currentHp = 0
    } else if (opponent.currentHp <= 0) {
      opponent.currentHp = 0
    }

    // Winner gets exp bonus, loser flees
    const fishWins = fishHpRatio >= opponentHpRatio

    if (fishWins) {
      fish.hidden.exp += 30
      fish.hidden.attack += 0.5
      fish.currentAction = 'wander'
      fish.actionTarget = null
      opponent.currentAction = 'flee'
      opponent.actionTarget = fish.id
      opponent.actionUrgency = 1
    } else {
      opponent.hidden.exp += 30
      opponent.hidden.attack += 0.5
      opponent.currentAction = 'wander'
      opponent.actionTarget = null
      fish.currentAction = 'flee'
      fish.actionTarget = opponent.id
      fish.actionUrgency = 1
    }

    fish.fightRounds = 0
    fish.fightPhase = 'idle'
    opponent.fightRounds = 0
    opponent.fightPhase = 'idle'
  }


  private doDead(fish: Fish, dt: number) {
    fish.vy = Math.max(-20, fish.vy - 15 * dt)
    fish.vx *= 0.95
    fish.targetZ = 0.5
    let diff = Math.PI - fish.angle
    while (diff > Math.PI) diff -= Math.PI * 2
    while (diff < -Math.PI) diff += Math.PI * 2
    fish.angle += diff * dt * 2
  }

  private doStunned(fish: Fish, dt: number) {
    fish.vx *= 0.92
    fish.vy *= 0.92
    fish.angle += dt * 3
  }

  private applyPhysics(fish: Fish, dt: number) {
    fish.x += fish.vx * dt
    fish.y += fish.vy * dt
    fish.z = lerp(fish.z, fish.targetZ, dt * 2)

    const margin = 50
    if (fish.x < margin) { fish.x = margin; fish.vx *= -1 }
    if (fish.x > this.tankWidth - margin) { fish.x = this.tankWidth - margin; fish.vx *= -1 }

    const topMargin = fish.isDead ? 10 : margin
    if (fish.y < topMargin) { fish.y = topMargin; fish.vy = fish.isDead ? 0 : fish.vy * -1 }
    if (fish.y > this.tankHeight - margin) { fish.y = this.tankHeight - margin; fish.vy *= -1 }
  }
}
