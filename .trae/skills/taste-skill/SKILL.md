---
name: "design-taste-frontend"
description: "反模版化（Anti-slop）前端 UI 技能。适用于着陆页、作品集和系统重构。严格执行顶级排版、色彩与间距纪律，拒绝廉价的 AI 默认设计。"
---

# Taste Skill (Anti-Slop Frontend Skill)

本系统旨在消除 LLM 生成前端代码时常见的“AI 廉价感”（AI Slop），如无意义的紫色渐变、生硬的卡片阴影、居中对齐的滥用以及杂乱的字体排版。

## 0. BRIEF INFERENCE (动手前先读懂需求)
在生成任何代码前，必须先进行“Design Read”（设计解读）。
- **受众是谁？** B2B 企业、高端消费者、创意开发者？
- **基调是什么？** 极简（Minimalist）、粗野主义（Brutalist）、编辑杂志风（Editorial）、还是原生应用风（Native App）？
- **输出原则**：在代码前，先输出一行简短的设计解读，例如：`"Design Read: High-end consumer. Low variance, high density, editorial typography."`

## 1. THE THREE DIALS (三个核心配置旋钮)
所有的设计决策受这三个旋钮控制（1-10级）：
1. **`DESIGN_VARIANCE` (排版变化度)**：1 = 完美的对称与网格；10 = 强烈的艺术感、不对称排版、打破网格。
2. **`MOTION_INTENSITY` (动画强度)**：1 = 仅有 hover 微交互；10 = 复杂的视差滚动、滚入错落动画（Scroll-Reveal Stagger）。
3. **`VISUAL_DENSITY` (信息密度)**：1 = 极度留白（Apple 风格）；10 = 紧凑的数据仪表盘。

## 2. BRIEF → DESIGN SYSTEM MAP (需求到设计系统的映射)
- 如果是企业级后台/复杂工具：老老实实用真正的设计系统（如 `shadcn/ui`, `Radix`）。
- 如果是着陆页/作品集/独立站：不要用死板的组件库，用 Tailwind 原生构建具有呼吸感的定制化界面。

## 3. DEFAULT ARCHITECTURE & CONVENTIONS (默认架构与约定)
- **Stack**: Vue/React + Tailwind CSS。
- **Icons**: 默认使用 `lucide` (如 `lucide-vue-next` 或 `lucide-react`)。线条统一保持 `stroke-width="1.5"`。
- **Emoji Policy**: 除非用户明确要求，否则**严禁使用 Emoji**。它会瞬间拉低页面的专业度。

## 4. DESIGN ENGINEERING DIRECTIVES (设计工程指令 - 纠正 AI 偏见)
这是最核心的规则，违背任何一条即为不及格：

### 4.1 Typography (排版纪律)
- **大标题 (Display)**: 默认使用 `text-4xl md:text-6xl tracking-tighter leading-none`。字距必须收紧！
- **正文 (Body)**: 默认使用 `text-base text-gray-600 leading-relaxed max-w-[65ch]`。
- **严禁滥用衬线体 (Serif)**：默认必须使用无衬线体（如 `Geist`, `Inter`, `Outfit`）。只有当品牌明确要求“复古/奢侈/杂志风”时才允许使用衬线体。
- **斜体下沉保护 (Italic Clearance)**：大标题使用斜体时，必须防止 `y, g, j` 等字母的下半部分被 `leading-none` 裁切，至少加 `pb-1`。

### 4.2 Color Calibration (色彩校准)
- **THE LILA RULE (紫色禁令)**：严禁默认使用“AI 紫色/蓝色发光”效果！不要动不动就加紫色渐变。
- **单一点缀色**：使用中性色（Zinc/Slate/Stone）作为基底，全站只允许**一个**高饱和度的点缀色（如翠绿、电蓝、深玫瑰色）。

### 4.3 Layout Diversification (布局多样化)
- **反居中偏见 (Anti-Center Bias)**：不要每个模块都居中！尝试 50/50 分栏、左对齐内容+右对齐图片、或者不对称留白。

### 4.4 Materiality, Shadows, Cards (材质、阴影与卡片)
- **圆角一致性 (Shape Consistency)**：选定一个圆角（如全部直角 `rounded-none`，或全部大圆角 `rounded-2xl`），并在全站严格锁定。绝对禁止在一个页面混用直角按钮和圆角卡片。
- **阴影法则**：绝对不要在亮色背景上使用纯黑阴影。阴影必须带有环境色的色调。

### 4.5 Interactive UI States (交互状态)
- **触觉反馈 (Tactile Feedback)**：按钮 `:active` 状态必须有 `-translate-y-[1px]` 或 `scale-[0.98]` 的物理按压感。
- **按钮文案 (CTA Wrap Ban)**：桌面端按钮文字**必须**在一行内显示。如果折行，说明设计失败。

### 4.7 Layout Discipline (强制布局纪律)
- **Hero 模块首屏可见**：Hero 的大标题最多 2 行，副标题最多 20 个字。不要让内容撑爆首屏导致 CTA 按钮被挤下去。
- **眉题限制 (EYEBROW RESTRAINT)**：AI 最喜欢在每个大标题上面加一行全大写的 `text-[11px] uppercase tracking-widest`（如 "OUR SERVICES"）。**硬性规定**：每 3 个区块最多只允许出现 1 次眉题。
- **Logo 墙**："Trusted by" 模块只放 Logo 即可，绝对不要在 Logo 下面加文字解释（如 Stripe 下面写个 "Payments"）。

### 4.8 Image & Visual Asset Strategy (图片资产策略)
- **严禁纯文字着陆页**。着陆页是视觉产品。
- 如果没有真实图片，使用占位符，或者生成高质量的图片。**严禁使用 div 拼凑出来的丑陋“假后台截图”**。

## 5-7. 骨架、性能与 DIAL 定义
- 必须支持暗黑模式 (`Dark Mode`)，尤其是 C 端产品。
- 遵循无障碍标准，按钮文字对比度必须达到 WCAG AA 标准。

## 8. AI TELLS (AI 露馅特征 / 禁忌模式)
如果你的代码里出现了以下特征，说明你暴露了自己是 AI：
1. **EM-DASH 滥用**：不要在副标题里疯狂使用破折号（—）。
2. **Jane Doe 效应**：不要在占位符里用 "Jane Doe"、"Acme Corp"、"Lorem ipsum"。写点符合行业背景的真实文案。
3. **假阴影**：`box-shadow: 0 0 10px rgba(0,0,0,0.1)` 这种干瘪的阴影是严禁的。

## 9. REDESIGN PROTOCOL (重构协议)
当你被要求“优化/重构”一个页面时：
- **先审计 (Audit)**：看看原页面有什么问题。
- **保留核心 (Preservation)**：不要改变原有的后端接口、路由或核心 DOM ID。
- **只做升级**：提升排版、加上高级动画、优化空间感，而不是推翻重写逻辑。

## 10. FINAL PRE-FLIGHT CHECK (起飞前检查)
在提交代码前，在心里默念：
1. 圆角一致吗？
2. 主题色收敛了吗？
3. 大标题字距收紧了吗 (`tracking-tighter`)？
4. 是否避免了毫无意义的卡片包裹？
5. 是否清除了所有紫色的发光特效？
如果全部满足，方可提交！