---
name: "design-taste-frontend-full"
description: "Taste Skill 原版 14 章节完整中文翻译版。包含所有骨架代码、禁忌列表与高级排版工程学指令。"
---

# Taste Skill (Anti-Slop Frontend Skill) - 完整翻译版

本规范旨在消除 LLM 生成前端代码时常见的“AI 廉价感”（AI Slop）。

## 0. BRIEF INFERENCE (动手前先读懂需求)
### 0.A 首要读取信号
- 目标受众（B2B、创意机构、DTC 消费品等）
- 目标情绪（克制、高能、高级感、粗野主义等）
### 0.B 强制输出 "Design Read"
在写任何代码前，必须输出一行：`Design Read: [受众]. [Dial 1], [Dial 2], [Dial 3]. [排版策略].`
### 0.C 消除歧义
如果需求模糊，不要瞎猜，提出一个关键问题。
### 0.D 反默认纪律 (Anti-Default Discipline)
LLM 倾向于回归到“居中标题 + 3列特征卡片 + 紫色渐变按钮”的默认状态。必须主动打破这种肌肉记忆。

---

## 1. THE THREE DIALS (三个核心配置旋钮)
所有的设计生成必须基于这三个 1-10 级的参数：
### 1.A 旋钮推断
- **`DESIGN_VARIANCE` (排版变化度)**：1 = 完美对称的网格；10 = 打破网格、极强艺术感。
- **`MOTION_INTENSITY` (动画强度)**：1 = 仅 Hover 微交互；10 = 复杂的视差滚动与交错入场。
- **`VISUAL_DENSITY` (信息密度)**：1 = 极度留白（Apple 级）；10 = 极高密度（彭博终端机级）。
### 1.B 用例预设 (Presets)
- B2B SaaS：Variance 3, Motion 3, Density 7
- 创意组合/工作室：Variance 8, Motion 8, Density 3
- 高端 DTC 消费品：Variance 5, Motion 6, Density 4
- 开发者工具：Variance 4, Motion 2, Density 8

---

## 2. BRIEF → DESIGN SYSTEM MAP (映射设计系统)
### 2.A 何时使用真正的设计系统
如果需求是构建复杂的仪表盘、表单密集型应用，使用官方包（如 shadcn/ui, Radix）。不要用 Tailwind 徒手搓复杂的 Select 组件。
### 2.B 当需求是“美学”而非“系统”
如果是着陆页、展示页，不要用 shadcn/ui。手写具有呼吸感的 Tailwind 布局。

---

## 3. DEFAULT ARCHITECTURE & CONVENTIONS (默认架构与约定)
### 3.A 技术栈
Vue/React + Tailwind CSS + Framer Motion (或 VueUseMotion)。
### 3.B 状态管理
除非明确要求，否则保持组件的无状态或使用极其简单的本地状态。
### 3.C 图标 (Icons)
默认使用 `lucide`。线条粗细统一为 `stroke-width="1.5"`。
### 3.D Emoji 政策 (Emoji Policy)
**严禁使用 Emoji**。除非用户明确要求。Emoji 会瞬间破坏专业感。
### 3.E 响应式
移动端优先（Mobile-first）。在 `md:` 和 `lg:` 断点上主动切换布局（如从垂直堆叠切换为并排）。
### 3.F 依赖校验
在使用 `framer-motion` 或 `lucide` 之前，必须检查 `package.json`。

---

## 4. DESIGN ENGINEERING DIRECTIVES (设计工程指令 - 纠正 AI 偏见)

### 4.1 Typography (排版)
- **大标题**: 默认 `text-4xl md:text-6xl tracking-tighter leading-none`。
- **正文**: 默认 `text-base text-gray-600 leading-relaxed max-w-[65ch]`。
- **禁用衬线体 (Serif Discipline)**：默认严禁使用衬线体。只有在明确是奢侈品、杂志、传统品牌时才允许。禁用 `Fraunces` 和 `Instrument_Serif` 作为默认。
- **斜体下沉保护**: 使用大标题斜体时，为 `y, g, p` 等字母保留底部空间（`pb-1` 或 `leading-[1.1]`）。

### 4.2 Color Calibration (色彩校准)
- **THE LILA RULE (紫色禁令)**：禁止默认使用紫色/蓝色的发光或渐变。
- **高级消费品调色板禁令**：AI 默认喜欢用“米白背景 + 赭石色/红铜色点缀 + 墨黑色文字”。禁止滥用此套路。尝试“冷银色+冷灰”、“纯黑+纯白+高饱和单色”。
- **色彩一致性**：一旦选定了一个点缀色（Accent Color），全站必须锁定使用。

### 4.3 Layout Diversification (布局多样化)
- **反居中偏见**：不要总是使用居中布局。尝试 50/50 拆分、不对称网格。

### 4.4 Materiality, Shadows, Cards (材质与阴影)
- **圆角锁定**：页面必须选定一种圆角风格（全直角、软圆角 12px、或全胶囊形）并全站遵守。混用直角卡片和胶囊按钮是设计失败。
- **拒绝纯黑阴影**：亮色背景上的阴影必须带有一点环境色。

### 4.5 Interactive UI States (交互状态)
- **触觉反馈**：按钮必须有 `:active` 状态的 `-translate-y-[1px]` 或缩放。
- **CTA 换行禁令**：桌面端按钮上的文字绝对不允许折行。

### 4.6 Data & Form Patterns (表单)
- Label 永远在 Input 上方。不要用 Placeholder 代替 Label。

### 4.7 Layout Discipline (强制布局纪律)
- **Hero 必须在一屏内**：标题最多 2 行，副标题最多 20 字。
- **Hero 顶部间距限制**：最大 `pt-24`。不要让内容浮在页面中间。
- **眉题限制 (EYEBROW RESTRAINT)**：禁止在每个区块上方都加一行全大写的 `tracking-widest` 标签。每 3 个区块最多只允许 1 个眉题。
- **Bento 单元格规则**：Bento Grid 必须刚好填满内容。如果有 5 块内容，就设计 5 格的网格，绝对不允许留一个空网格。

### 4.8 Image & Visual Asset Strategy (图片资产策略)
- 着陆页必须有图片。如果没有真实图片，必须生成图片。**严禁用 <div> 徒手画丑陋的假后台截图**。
- Logo 墙只放 Logo，严禁在 Logo 下方加行业标签（如 Stripe 下面写个 Payments）。

### 4.9 Content Density (信息密度)
- 着陆页依赖第一印象，文案必须极度精简。

### 4.10 Quotes & Testimonials (引言与客户评价)
- 客户评价不一定要放在卡片里，可以尝试超大字体的全宽排版（Editorial Style）。

### 4.11 Page Theme Lock (主题锁定)
- 亮色和暗色模式必须在全局一致，不能在一个页面里既有暗色模块又有亮色模块（除非是极特殊的黑白翻转设计）。

---

## 5. CONTEXT-AWARE PROACTIVITY (上下文感知的布局骨架)
*文档原生提供了 3 种典型骨架（已做翻译说明）：*
- **5.A Sticky-Stack (粘性堆叠)**：左侧固定内容，右侧内容滚动（如 Apple 官网介绍页）。
- **5.B Horizontal-Pan (水平平移)**：通过 `position: sticky` 实现滚轮垂直滚动转化为水平滑动。
- **5.C Scroll-Reveal Stagger (错落滚动入场)**：元素进入视口时依次向上浮现。
- **5.D 禁用的动画模式**：禁止元素的宽高在 Hover 时发生跳动式改变（引发 Layout Thrashing）。

---

## 6. PERFORMANCE & ACCESSIBILITY GUARDRAILS (性能与无障碍)
- **硬件加速**：动画必须使用 `transform` 和 `opacity`，严禁动画化 `margin` 或 `height`。
- **无障碍**：必须有 `:focus-visible` 状态，并且对比度达标（WCAG AA）。
- **暗黑模式**：所有 C 端页面必须强制支持暗黑模式。

---

## 7. DIAL DEFINITIONS (旋钮技术定义)
*(详细描述了 1-10 级在 CSS 中的具体表现，例如 Variance 1 是 `grid-cols-2`，Variance 10 是绝对定位和 `translate` 偏移)*。

---

## 8. DARK MODE PROTOCOL (暗黑模式协议)
- 必须使用 Tailwind 的 `dark:` 修饰符。
- 不要使用纯黑 `#000000` 作为背景，使用 `#0a0a0a` 或 `#111827`。

---

## 9. AI TELLS (AI 露馅特征禁忌列表)
**如果代码里有这些，你就会被识破是 AI：**
- **视觉层**：滥用 `bg-gradient-to-r from-purple-500 to-blue-500`。
- **排版层**：大标题忘记加 `tracking-tighter`，或强行混用衬线体和无衬线体。
- **布局层**：页面里每一个模块都是居中的 `text-center flex flex-col items-center`。
- **文案层**：使用 "Jane Doe", "Acme Corp", "Supercharge your workflow"。
- **终极禁忌 (EM-DASH BAN)**：在每个副标题或引言里使用破折号（—）。

---

## 10. REFERENCE VOCABULARY (参考词汇表)
- `Hero Paradigms` (英雄区范式)
- `Bento Grids` (便当盒网格)
- `Marquee` (无限滚动跑马灯)
- `Glassmorphism` (玻璃拟态)

---

## 11. REDESIGN PROTOCOL (重构协议)
- 第一步永远是检测模式：是只做样式升级（Targeted Evolution）还是彻底重构（Full Redesign）。
- **保留规则**：不能改动后端数据接口、不能改动页面的路由逻辑。
- 升级手段（按优先级）：1. 字体排版 2. 空间留白 3. 色彩收敛 4. 微交互动画。

---

## 12. THE BLOCK LIBRARY (区块库约定)
定义了如果把这段规范作为库沉淀下来，文件需要包含哪些元数据（Frontmatter）。

---

## 13. OUT OF SCOPE (超出范围)
本技能不处理后端数据库逻辑、不处理复杂的 WebGL/Three.js 3D 渲染。

---

## 14. FINAL PRE-FLIGHT CHECK (起飞前最后检查)
1. 页面所有的圆角风格统一了吗？
2. 主题色是否收敛到了唯一的一个？
3. 大标题的字距是否使用了 `tracking-tighter` 收紧？
4. 是否删除了毫无意义的卡片外层边框？
5. 是否清除了所有 AI 默认的紫色/蓝色渐变发光？
6. CTAs (按钮) 是否在一行内展示完毕？
如果全部通过，输出即可。

---
*(End of Translation)*