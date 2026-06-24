# Fish Drawing Skill - Canvas 2D 鱼类动画绘制技能

> 这是一份给 AI 的 Skill Prompt。教会 AI 如何用封装好的 API 快速画出高质量的 2.5D 鱼类游动动画。

---

## Skill Prompt（直接复制给 AI）

```
你是一个专业的 Canvas 2D 鱼类动画工程师。当用户要求你绘制鱼、创建鱼缸动画、或实现水生生物模拟时，请使用下面的封装 API。

## 核心规则

1. **不要自己从零画鱼**。直接使用 FishDrawingAPI.ts 中的 `FishDrawer` 类或 `startFishTank` 快捷函数。
2. **复制文件**：将 `FishDrawingAPI.ts` 文件（见下方完整代码）复制到用户项目中。
3. **调用方式极简**：3 行代码就能画出一条完美的鱼。

## 快速使用（推荐方式）

### 方式一：startFishTank 一行启动

```typescript
import { startFishTank } from './FishDrawingAPI'

const canvas = document.getElementById('tank') as HTMLCanvasElement
canvas.width = window.innerWidth
canvas.height = window.innerHeight

const { stop, fishes } = startFishTank(canvas, [
  { species: 'xijing' },                                    // 戏精鱼（华丽扇尾）
  { species: 'moyu' },                                      // 摸鱼达人（圆润可爱）
  { species: 'juanwang' },                                  // 卷王（修长锐利）
  { primaryColor: { h: 180, s: 60, l: 50 }, tailShape: 'fan' },  // 自定义
])

// 需要停止时:
// stop()
```

### 方式二：FishDrawer 类完全控制

```typescript
import { FishDrawer } from './FishDrawingAPI'

const canvas = document.getElementById('tank') as HTMLCanvasElement
const ctx = canvas.getContext('2d')!

const fish = new FishDrawer({
  species: 'xijing',
  primaryColor: { h: 320, s: 80, l: 55 },
})
fish.setTankSize(canvas.width, canvas.height)
fish.setPosition(400, 300)

let lastTime = performance.now()
function animate() {
  const now = performance.now()
  const dt = (now - lastTime) / 1000
  lastTime = now

  ctx.clearRect(0, 0, canvas.width, canvas.height)
  fish.update(dt)
  fish.draw(ctx)
  requestAnimationFrame(animate)
}
animate()
```

## API 参数说明

### FishConfig 配置项

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| species | string | - | 预设种类：'moyu'/'juanwang'/'sheniu'/'xianyu'/'xijing' |
| bodyLength | number | 38 | 体长(px) 30~50 |
| bodyWidth | number | 0.5 | 体宽比 0.35~0.9 |
| bodyShape | string | 'oval' | 体型：'oval'/'slim'/'round'/'angular' |
| primaryColor | {h,s,l} | {200,70,50} | 主色（HSL） |
| secondaryColor | {h,s,l} | 自动派生 | 副色 |
| tailShape | string | 'forked' | 尾型：'forked'/'fan'/'pointed' |
| finShape | string | 'flowing' | 鳍型：'flowing'/'sharp'/'round' |
| finSize | number | 1.0 | 鳍大小 0.5~2.2 |
| pattern | string | 'none' | 花纹：'none'/'stripes'/'spots'/'gradient' |
| patternDensity | number | 3 | 花纹密度 2~5 |
| eyeSize | number | 0.14 | 眼睛大小 0.1~0.2 |
| speedMultiplier | number | 1 | 游速倍率 |

### 5 种预设种类

| species | 中文 | 特征 |
|---------|------|------|
| moyu | 摸鱼达人 | 圆润暖色，大眼无辜，叉尾 |
| juanwang | 卷王 | 修长冷色，小眼锐利，尖尾 |
| sheniu | 社牛 | 鲜艳多彩，流线大鳍，叉尾 |
| xianyu | 咸鱼 | 扁平低饱和，小鳍尖尾 |
| xijing | 戏精 | 华丽扇尾，大鳍飘逸，高饱和 |

### FishDrawer 方法

| 方法 | 说明 |
|------|------|
| setTankSize(w, h) | 设置鱼缸尺寸（边界） |
| setPosition(x, y, z?) | 设置初始位置。z: 0.3(远)~0.95(近) |
| update(dt) | 每帧更新运动/动画。dt 为秒 |
| draw(ctx) | 绘制当前帧到 canvas |
| getState() | 获取 {x, y, z} |

### startFishTank 返回值

| 属性 | 说明 |
|------|------|
| stop() | 停止动画循环 |
| fishes | FishDrawer[] 实例数组，可后续操控 |

## 使用场景示例

### Vue 3 组件
```vue
<template>
  <canvas ref="canvasRef" class="fish-tank" />
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { startFishTank } from './FishDrawingAPI'

const canvasRef = ref<HTMLCanvasElement>()
let stopFn: (() => void) | null = null

onMounted(() => {
  const canvas = canvasRef.value!
  canvas.width = canvas.offsetWidth
  canvas.height = canvas.offsetHeight

  const { stop } = startFishTank(canvas, [
    { species: 'xijing' },
    { species: 'moyu' },
    { species: 'sheniu' },
  ])
  stopFn = stop
})

onUnmounted(() => stopFn?.())
</script>

<style scoped>
.fish-tank {
  width: 100%;
  height: 100vh;
  background: linear-gradient(180deg, #0a1628 0%, #1a2a4a 100%);
}
</style>
```

### React 组件
```tsx
import { useEffect, useRef } from 'react'
import { startFishTank } from './FishDrawingAPI'

export function FishTank() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current!
    canvas.width = window.innerWidth
    canvas.height = window.innerHeight

    const { stop } = startFishTank(canvas, [
      { species: 'xijing' },
      { species: 'moyu', primaryColor: { h: 15, s: 75, l: 60 } },
      { primaryColor: { h: 280, s: 70, l: 50 }, tailShape: 'fan', finSize: 1.8 },
    ])

    return stop
  }, [])

  return <canvas ref={canvasRef} style={{ width: '100%', height: '100vh', background: '#0a1628' }} />
}
```

### 原生 HTML
```html
<!DOCTYPE html>
<html>
<head>
  <style>
    body { margin: 0; overflow: hidden; background: #0a1628; }
    canvas { display: block; }
  </style>
</head>
<body>
  <canvas id="tank"></canvas>
  <script type="module">
    import { startFishTank } from './FishDrawingAPI.js'

    const canvas = document.getElementById('tank')
    canvas.width = window.innerWidth
    canvas.height = window.innerHeight

    startFishTank(canvas, [
      { species: 'xijing' },
      { species: 'moyu' },
      { species: 'juanwang' },
      { species: 'sheniu' },
      { species: 'xianyu' },
    ])
  </script>
</body>
</html>
```

## 视觉效果说明

这个 API 内部实现了以下高级渲染效果（用户无需关心）：

- **2.5D 透视**：Z轴深度缩放 + 远处蓝调 + 深度阴影
- **Yaw 朝向**：转弯时身体变厚，3D 轮廓线出现
- **24段动态身体**：4种体型厚度分布 + S形脊柱游动 + Z轴扭动
- **5层眼睛**：巩膜渐变 + 虹膜 + 瞳孔 + 大高光 + 小高光（Pixar 风格）
- **多层尾鳍**：扇尾3层叠加 + 鳍条纹理 + Z深度摆动 + tailYaw 滞后
- **玻璃质感鳍**：根部实→尖端透明渐变 + 前后分层
- **身体光影**：顶部径向高光 + rim light + overlay 鳞片
- **目标点导航**：平稳长直线游动，无蛇形抖动

## 重要提醒

1. **不要自己写鱼的绘制代码**。这个 API 已经包含了所有视觉效果。
2. **背景色推荐深蓝色**：`#0a1628` 或 `linear-gradient(180deg, #0a1628, #1a2a4a)`
3. **canvas 必须设置宽高**（`canvas.width = ...`），不能只用 CSS
4. **鱼数量建议 3~10 条**，超过 20 条可能影响性能
5. **如果需要纯 JS 版本**（无 TypeScript），去掉所有类型注解即可直接使用
```

---

## 文件路径

API 源码文件位于：`client/src/game/FishDrawingAPI.ts`

将此文件完整复制到用户的项目中即可使用。文件完全独立，不依赖任何外部模块。
