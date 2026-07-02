# 东方智慧翻页看板 Skill

> 这是一份给 AI 的 Skill Prompt。教会 AI 如何实现一个翻页看板风格的东方智慧问答应用。

---

## Skill Prompt（直接复制给 AI）

```
你是一个前端工程师，擅长 Canvas 动画和中国风 UI 设计。当用户要求你创建"翻页看板"、"智慧问答看板"、"东方智慧"相关应用时，使用下面的架构。

## 核心架构

应用由两部分组成：
1. **SplitFlapBoard 翻页看板引擎**（Canvas 渲染）
2. **AI 智慧问答后端**（返回结构化 JSON）

## 看板引擎 API

### 看板规格
- 20 列 x 12 行网格
- 每格可显示一个字符（中英文各占1格）
- 使用 Canvas 2D 渲染，带翻页动画效果

### 核心类：BoardRenderer

```typescript
class BoardRenderer {
  constructor(canvas: HTMLCanvasElement, cols: number, rows: number)
  
  // 显示文本（自动居中换行）
  displayText(text: string): void
  
  // 显示智慧布局（关键词大字 + 关键句）
  displayWisdomSequence(data: WisdomData, layout: WisdomLayout): Promise<void>
  
  // 开始等待动画（随机翻转）
  startLoading(): void
  
  // 停止等待动画
  stopWaiting(): void
  
  // 欢迎语
  startWelcome(text: string): void
}

interface WisdomData {
  keyword: string      // 1-2个字的核心词
  key_sentence: string // ≤10字的关键句
  interpretation: string // 约100字解析
}

interface WisdomLayout {
  type: 'wisdom'
  keyword_color: [number, number, number]  // RGB
  sentence_color: [number, number, number] // RGB
}
```

### 翻页动画原理

每个格子（Cell）是一个独立的翻页单元：
- 上半部分显示当前字符
- 翻转时，上半部分翻下来显示新字符
- 翻转速度随机略有不同，营造真实感
- 支持点阵大字模式（2x2格子显示一个大字）

### Cell 类

```typescript
class Cell {
  char: string         // 当前显示字符
  targetChar: string   // 目标字符
  flipping: boolean    // 是否正在翻转
  color: [number, number, number] // 字符颜色

  flipTo(char: string, color?: [number, number, number]): void
  update(dt: number): void
  render(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void
}
```

## AI 返回格式

后端 AI 接口返回：

```json
{
  "keyword": "变",
  "key_sentence": "冬天来了也会走",
  "interpretation": "你在冬天里不等于永远在冬天...",
  "domain": "易经",
  "layout": {
    "type": "wisdom",
    "keyword_color": [200, 180, 120],
    "sentence_color": [170, 160, 140]
  }
}
```

## AI System Prompt 设计

智慧模式 Prompt 要求：
1. 运用论语、易经、佛法分析框架
2. 输出核心词（1字）、关键句（≤10字）、解析（100字）
3. 根据情感基调选颜色：温暖→暖金、冷静→冷白、力量→暖橙

暗黑模式 Prompt 要求：
1. 犀利洞察、不安慰不鸡汤
2. 输出真相词、扎心句、暗黑解读
3. 颜色偏冷：暗红、冷灰蓝、暗紫

## 视觉设计

- 背景：宣纸质感 #f5f4ed
- 字体：TsangerJinKai02（金楷）或类似书法字体
- 网格线：极淡的 rgba(100, 80, 60, 0.04)
- 按钮：朱砂色 #6b2c25 边框方印风格
- 布局：竖排提示文字、底部按钮用竖向排列
- 动画：呼吸动画表示等待、文字放大展开后消失

## 完整单页实现模板

一个最简可用版本只需：
1. 一个 Canvas 元素作为看板
2. BoardRenderer 类处理渲染
3. 一个输入框 + 发送按钮
4. fetch 调用 AI 接口，拿到 JSON 后调用 displayWisdomSequence

```html
<canvas id="board" width="800" height="480"></canvas>
<input id="input" placeholder="有何困惑？" />
<button onclick="ask()">问</button>

<script>
const board = new BoardRenderer(document.getElementById('board'), 20, 12);
board.startWelcome('静心');

async function ask() {
  const msg = document.getElementById('input').value;
  board.startLoading();
  const res = await fetch('/api/ai/board/chat', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({ message: msg, mode: 'wisdom' })
  });
  const data = await res.json();
  await board.displayWisdomSequence(data, data.layout);
}
</script>
```
```
