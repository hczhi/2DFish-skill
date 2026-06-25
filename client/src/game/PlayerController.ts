import type { Fish, PlayerControlState, Shockwave } from './types'

function distance(x1: number, y1: number, x2: number, y2: number): number {
  return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2)
}

const PRESS_DURATION = 2 // 长按2秒进入控制模式
const A_HOLD_THRESHOLD = 0.5 // A键长按0.5秒进入锁定模式
const TARGET_RANGE = 200 // 攻击目标搜索范围
const ATTACK_RANGE = 100 // 攻击生效范围
const S_CHARGE_MIN = 5 // S键最低蓄力时间（秒）
const S_CHARGE_MAX = 10 // S键最大蓄力时间（秒）
const S_COOLDOWN = 15 // 冲击波冷却时间（秒）

export class PlayerController {
  state: PlayerControlState = {
    active: false,
    fishId: null,
    pressStartTime: 0,
    pressProgress: 0,
    confirmed: false,
    targetLockMode: false,
    targetLockFishId: null,
    targetCandidates: [],
    targetIndex: 0,
    keys: { up: false, down: false, left: false, right: false, z: false, x: false, a: false, s: false },
    aHoldTime: 0,
    sCharging: false,
    sChargeTime: 0,
    sCooldown: 0,
  }

  private pressingFishId: string | null = null
  private pressing = false

  startPress(fishId: string) {
    this.pressing = true
    this.pressingFishId = fishId
    this.state.pressStartTime = performance.now()
    this.state.pressProgress = 0
    this.state.fishId = fishId
  }

  cancelPress() {
    this.pressing = false
    this.pressingFishId = null
    if (!this.state.confirmed) {
      this.state.pressProgress = 0
      this.state.fishId = null
    }
  }

  updatePress(): boolean {
    if (!this.pressing || !this.pressingFishId) return false

    const elapsed = (performance.now() - this.state.pressStartTime) / 1000
    this.state.pressProgress = Math.min(1, elapsed / PRESS_DURATION)

    if (this.state.pressProgress >= 1 && !this.state.confirmed) {
      this.state.confirmed = true
      this.state.active = true
      this.pressing = false
      return true
    }
    return false
  }

  exit() {
    this.state = {
      active: false,
      fishId: null,
      pressStartTime: 0,
      pressProgress: 0,
      confirmed: false,
      targetLockMode: false,
      targetLockFishId: null,
      targetCandidates: [],
      targetIndex: 0,
      keys: { up: false, down: false, left: false, right: false, z: false, x: false, a: false, s: false },
      aHoldTime: 0,
      sCharging: false,
      sChargeTime: 0,
      sCooldown: 0,
    }
    this.pressing = false
    this.pressingFishId = null
  }

  handleKeyDown(key: string) {
    if (!this.state.active) return

    switch (key) {
      case 'ArrowUp': this.state.keys.up = true; break
      case 'ArrowDown': this.state.keys.down = true; break
      case 'ArrowLeft': this.state.keys.left = true; break
      case 'ArrowRight': this.state.keys.right = true; break
      case 'z': case 'Z': this.state.keys.z = true; break
      case 'x': case 'X': this.state.keys.x = true; break
      case 'a': case 'A':
        if (!this.state.keys.a) {
          this.state.keys.a = true
          this.state.aHoldTime = 0
        }
        break
      case 's': case 'S':
        if (!this.state.keys.s && this.state.sCooldown <= 0) {
          this.state.keys.s = true
          this.state.sCharging = true
          this.state.sChargeTime = 0
        }
        break
    }
  }

  handleKeyUp(key: string) {
    if (!this.state.active) return

    switch (key) {
      case 'ArrowUp': this.state.keys.up = false; break
      case 'ArrowDown': this.state.keys.down = false; break
      case 'ArrowLeft': this.state.keys.left = false; break
      case 'ArrowRight': this.state.keys.right = false; break
      case 'z': case 'Z': this.state.keys.z = false; break
      case 'x': case 'X': this.state.keys.x = false; break
      case 'a': case 'A':
        this.state.keys.a = false
        // aHoldTime is consumed in update() next frame, don't reset here
        break
      case 's': case 'S':
        this.state.keys.s = false
        break
    }
  }

  update(controlledFish: Fish, allFishes: Fish[], dt: number): { attack?: { attacker: Fish; target: Fish }; shockwave?: Shockwave } | null {
    if (!this.state.active || !controlledFish) return null

    const { keys } = this.state

    // Cooldown tick
    if (this.state.sCooldown > 0) {
      this.state.sCooldown = Math.max(0, this.state.sCooldown - dt)
    }

    // S键蓄力逻辑
    let shockwaveResult: Shockwave | undefined
    if (this.state.sCharging) {
      if (keys.s) {
        this.state.sChargeTime = Math.min(S_CHARGE_MAX, this.state.sChargeTime + dt)
      } else {
        // S键松开，判断是否达到最低蓄力
        if (this.state.sChargeTime >= S_CHARGE_MIN) {
          shockwaveResult = this.createShockwave(controlledFish)
          this.state.sCooldown = S_COOLDOWN
        }
        this.state.sCharging = false
        this.state.sChargeTime = 0
      }
    }

    // 蓄力时减速
    const chargingSlow = this.state.sCharging ? 0.3 : 1.0
    const moveSpeed = (controlledFish.hidden.speed * 0.05 + 0.3) * 0.5 * chargingSlow

    // 方向键移动
    let ax = 0, ay = 0
    if (keys.up) ay -= 1
    if (keys.down) ay += 1
    if (keys.left) ax -= 1
    if (keys.right) ax += 1

    if (ax !== 0 || ay !== 0) {
      const len = Math.sqrt(ax * ax + ay * ay)
      ax /= len
      ay /= len
      controlledFish.vx += ax * moveSpeed * 0.6
      controlledFish.vy += ay * moveSpeed * 0.6
    }

    // Z/X 轴移动
    if (keys.z) {
      controlledFish.targetZ = Math.min(0.95, controlledFish.targetZ + dt * 0.5)
    }
    if (keys.x) {
      controlledFish.targetZ = Math.max(0.3, controlledFish.targetZ - dt * 0.5)
    }

    // A键逻辑
    if (keys.a) {
      this.state.aHoldTime += dt

      if (this.state.aHoldTime >= A_HOLD_THRESHOLD && !this.state.targetLockMode) {
        // 进入目标锁定模式
        this.state.targetLockMode = true
        this.updateTargetCandidates(controlledFish, allFishes)
      }

      // 锁定模式下方向键切换目标
      if (this.state.targetLockMode && this.state.targetCandidates.length > 0) {
        // 切换逻辑在 handleKeyDown 中通过方向键触发不太合适
        // 在这里通过方向键的状态来切换
      }
    } else if (this.state.aHoldTime > 0) {
      // A键松开
      if (this.state.targetLockMode && this.state.targetLockFishId) {
        // 检查目标是否在攻击范围内，如果是就攻击
        const target = allFishes.find(f => f.id === this.state.targetLockFishId)
        if (target && !target.isDead) {
          const dist = distance(controlledFish.x, controlledFish.y, target.x, target.y)
          if (dist <= ATTACK_RANGE) {
            this.state.aHoldTime = 0
            this.state.targetLockMode = false
            return { attack: { attacker: controlledFish, target } }
          }
        }
      }

      // 非锁定模式下短按A：对附近最近目标直接攻击
      if (!this.state.targetLockMode && this.state.aHoldTime > 0 && this.state.aHoldTime < A_HOLD_THRESHOLD) {
        const nearest = this.findNearestTarget(controlledFish, allFishes)
        if (nearest) {
          const dist = distance(controlledFish.x, controlledFish.y, nearest.x, nearest.y)
          if (dist <= ATTACK_RANGE) {
            this.state.aHoldTime = 0
            this.state.targetLockMode = false
            return { attack: { attacker: controlledFish, target: nearest } }
          }
        }
      }

      this.state.aHoldTime = 0
      this.state.targetLockMode = false
    }

    // 持续更新候选目标列表
    if (this.state.targetLockMode) {
      this.updateTargetCandidates(controlledFish, allFishes)
    }

    if (shockwaveResult) {
      return { shockwave: shockwaveResult }
    }
    return null
  }

  private createShockwave(fish: Fish): Shockwave {
    const chargeRatio = (this.state.sChargeTime - S_CHARGE_MIN) / (S_CHARGE_MAX - S_CHARGE_MIN)
    const power = 0.5 + chargeRatio * 0.5 // 0.5 ~ 1.0

    const baseDamage = fish.hidden.attack * (0.4 + power * 0.4)
    const baseRange = 200 + fish.hidden.level * 20 + power * 150
    const baseRadius = 30 + fish.hidden.level * 3 + power * 20

    return {
      id: `sw_${Date.now()}_${Math.random()}`,
      x: fish.x + Math.cos(fish.angle) * fish.appearance.bodyLength * 0.5,
      y: fish.y + Math.sin(fish.angle) * fish.appearance.bodyLength * 0.5,
      angle: fish.angle,
      speed: 400 + power * 200,
      radius: baseRadius * 0.5,
      maxRadius: baseRadius,
      damage: baseDamage,
      knockback: 15 + power * 25,
      range: baseRange,
      traveled: 0,
      sourceLevel: fish.hidden.level,
      sourceFishId: fish.id,
      opacity: 1,
      hitFishIds: [],
    }
  }

  switchTarget(direction: 'next' | 'prev') {
    if (!this.state.targetLockMode || this.state.targetCandidates.length === 0) return

    if (direction === 'next') {
      this.state.targetIndex = (this.state.targetIndex + 1) % this.state.targetCandidates.length
    } else {
      this.state.targetIndex = (this.state.targetIndex - 1 + this.state.targetCandidates.length) % this.state.targetCandidates.length
    }
    this.state.targetLockFishId = this.state.targetCandidates[this.state.targetIndex]
  }

  private updateTargetCandidates(controlledFish: Fish, allFishes: Fish[]) {
    const candidates = allFishes
      .filter(f => f.id !== controlledFish.id && !f.isDead && distance(controlledFish.x, controlledFish.y, f.x, f.y) < TARGET_RANGE)
      .sort((a, b) => distance(controlledFish.x, controlledFish.y, a.x, a.y) - distance(controlledFish.x, controlledFish.y, b.x, b.y))
      .map(f => f.id)

    this.state.targetCandidates = candidates

    if (candidates.length > 0) {
      // 保持当前选中目标，如果它还在候选列表中
      const currentIdx = candidates.indexOf(this.state.targetLockFishId || '')
      if (currentIdx >= 0) {
        this.state.targetIndex = currentIdx
      } else {
        this.state.targetIndex = 0
        this.state.targetLockFishId = candidates[0]
      }
    } else {
      this.state.targetLockFishId = null
      this.state.targetIndex = 0
    }
  }

  private findNearestTarget(controlledFish: Fish, allFishes: Fish[]): Fish | null {
    let nearest: Fish | null = null
    let nearestDist = ATTACK_RANGE
    for (const f of allFishes) {
      if (f.id === controlledFish.id || f.isDead) continue
      const dist = distance(controlledFish.x, controlledFish.y, f.x, f.y)
      if (dist < nearestDist) {
        nearestDist = dist
        nearest = f
      }
    }
    return nearest
  }

  isControlling(fishId: string): boolean {
    return this.state.active && this.state.fishId === fishId
  }

  isPressing(): boolean {
    return this.pressing
  }

  getPressingFishId(): string | null {
    return this.pressing ? this.pressingFishId : null
  }
}
