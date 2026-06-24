# mmPla - 摸鱼缸 (Moyu Fish Tank)

一个基于 Vue 3 + Canvas 2D 的 2.5D 鱼缸模拟游戏。每条鱼拥有独立的性格、属性、行为决策系统，在画布上自由游动、觅食、战斗、社交。

## 预览

鱼缸场景包含：
- 自然光影效果（光束、焦散、粒子）
- 2.5D 深度透视（Z轴远近、大小、明暗变化）
- 流畅的鱼体动画（身体弯曲、尾鳍摆动、透视旋转）
- 丰富的交互（投喂、抚摸、摸鱼模式）

## 快速开始

```bash
# 安装依赖
npm install
cd client && npm install
cd ../server && npm install

# 启动开发服务器（前后端同时）
npm run dev
```

前端运行在 `http://localhost:5173`，后端 API 在 `http://localhost:3001`。

## 项目结构

```
mmPla/
├── client/                    # 前端（Vue 3 + Vite）
│   ├── src/
│   │   ├── components/        # Vue 组件
│   │   │   ├── GameCanvas.vue       # Canvas 主画布
│   │   │   ├── AddFishModal.vue     # 添加鱼弹窗
│   │   │   ├── FishListPanel.vue    # 鱼列表面板
│   │   │   ├── DebugPanel.vue       # 调试面板
│   │   │   ├── SettingsModal.vue    # AI 配置设置
│   │   │   └── StoryEventOverlay.vue # 剧情事件 UI
│   │   ├── game/              # 游戏核心引擎
│   │   │   ├── types.ts            # 类型定义
│   │   │   ├── GameEngine.ts       # 主引擎（决策 + 循环）
│   │   │   ├── BehaviorExecutor.ts # 行为物理执行器
│   │   │   ├── FishRenderer.ts     # 鱼体渲染（2.5D）
│   │   │   ├── FishFactory.ts      # 鱼生成工厂
│   │   │   ├── AmbientEffects.ts   # 背景特效（光束、粒子、沙地）
│   │   │   ├── ForegroundEffects.ts # 前景特效（气泡、水面波纹）
│   │   │   ├── AILogger.ts         # AI 调用日志
│   │   │   ├── StoryEventEngine.ts # 剧情事件引擎
│   │   │   ├── StoryEventTemplates.ts # 剧情模板
│   │   │   └── StoryEventTrigger.ts  # 剧情触发器
│   │   ├── App.vue            # 根组件
│   │   └── main.ts           # 入口
│   └── vite.config.ts
├── server/                    # 后端（Express + OpenAI）
│   └── src/
│       ├── app.ts            # Express 服务入口
│       └── api/
│           ├── ai.ts         # AI 知识/决策接口
│           └── story.ts      # 剧情事件 AI 接口
└── package.json              # 根配置（concurrently）
```

## 核心特性

### 1. 2.5D 渲染系统

鱼在三维空间中游动（X/Y/Z），通过 Canvas 2D 模拟透视效果：

- **Z轴深度**：z=0 远（靠后壁，小/暗/蓝调），z=1 近（靠玻璃，大/亮/鲜艳）
- **Yaw 透视旋转**：鱼转向时身体发生透视缩短（X轴压缩），同时可见圆形截面
- **动态轮廓线**：根据观察角度渲染身体表面的阴影/高光/轮廓，模拟圆柱体立体感
- **Z轴尾摆**：尾巴在深度方向摆动，表现为尾部水平缩放（透视效果）

### 2. 鱼体游动算法

#### 目标点导航系统

鱼的移动采用**目标点导航**（而非角度随机游走），核心保证：

```
鱼头永远朝向游动方向 → 角度驱动速度（而非速度驱动角度）
```

**游动流程：**
1. `pickWanderTarget()` 在画面对侧生成目标点（X跨屏幕80%+，Y微调±15%高度，Z 0.4~0.9）
2. 每帧以 0.06 的角速率将 `fish.angle` 转向目标
3. 速度矢量 = `cos/sin(angle) * speed`，保证鱼始终朝前游
4. 到达目标点（<60px）后生成下一个目标

**关键设计决策：**
- 禁止使用角度随机扰动（会导致蛇形走位）
- 禁止使用 boids/分离力/碰撞（会导致聚集和弹射）
- 自由游动时无碰撞，鱼可自由穿过彼此
- 只有攻击行为才有碰撞检测（30px 范围）

#### 速度公式

```typescript
baseSpeed = (fish.speed * 0.05 + 0.2) * (1 + level * 0.02) * (1 + urgency * 0.3)
swimSpeed = baseSpeed * 0.6  // 巡游速度
```

#### 身体动画

| 动画层 | 实现方式 |
|--------|----------|
| 身体弯曲 | `angularVelocity` → spine Y-offset，尾部影响最大 |
| 波浪摆动 | `sin(wavePhase - (1-t)*4.5)` 沿脊柱传播 |
| 尾鳍摆动 | `sin(tailPhase)` 驱动贝塞尔曲线顶点 |
| Z轴尾摆 | 三角波 0.8Hz → 尾部 X-scale（模拟深度摆动） |
| 呼吸 | 低频 sin 微缩放 |
| 速度拉伸 | 高速时身体前后拉长 |

### 3. 行为决策系统

本地规则引擎驱动（不依赖 AI），每帧判断：

| 优先级 | 条件 | 行为 |
|--------|------|------|
| 1 | HP < 20% | flee |
| 2 | 食物在 300~500px 内 | eat |
| 3 | 目标在 120px + 同Z层 | hunt |
| 4 | 默认 | wander |

攻击机制：
- 检测范围 120px，追击放弃距离 150px
- 目标逃跑则放弃追击
- 被攻击者有概率反击（进入 fight 模式，3~5回合对攻）

### 4. 五种鱼种

| 种类 | 性格 | 特点 |
|------|------|------|
| 摸鱼达人 (moyu) | 懒惰温和 | 圆润暖色，大眼，高防御 |
| 卷王 (juanwang) | 激进好斗 | 修长冷色，戴眼镜，高攻速 |
| 社牛 (sheniu) | 社交活跃 | 鲜艳花纹，大鳍，闪光特效 |
| 咸鱼 (xianyu) | 极度佛系 | 扁平低饱和，半眯眼 |
| 戏精 (xijing) | 华丽夸张 | 红色大尾，戴皇冠，腮红 |

### 5. 环境特效

- **背景**：海底沙地、水草摆动、光束穿透、悬浮微粒
- **前景**：气泡上升、水面波纹折射、焦散光斑
- **鱼**：深度阴影、速度尾迹、情绪粒子（愤怒蒸汽/恐惧汗滴/开心爱心）

### 6. 彩蛋功能

- **摸鱼模式**：按 `Esc` 启用 Boss Key，界面变成终端风格，敲键盘自动投喂
- **抚摸互动**：点击鱼触发开心动画，30% 概率弹出趣味知识
- **社交关系**：鱼之间积累好感/仇恨，显示心形/闪电指示器

## AI 集成（可选）

后端可配置 OpenAI 兼容接口，用于：
- 生成鱼的知识性对话（基于爱好）
- 触发剧情事件（Boss 入侵等）

在设置面板中配置 API URL、Key、Model 即可启用。不配置也能完整运行（所有行为由本地规则驱动）。

## 技术栈

- **前端**: Vue 3 (Composition API) + TypeScript + Vite + Canvas 2D
- **后端**: Express + OpenAI SDK + TypeScript
- **渲染**: 纯 Canvas 2D，无 WebGL/Three.js 依赖
- **状态管理**: 无 Pinia/Vuex，GameEngine 内部管理 + ref 同步

## 开发

```bash
# 仅启动前端
cd client && npm run dev

# 仅启动后端
cd server && npm run dev

# 类型检查
cd client && npx tsc --noEmit
```

## License

MIT
