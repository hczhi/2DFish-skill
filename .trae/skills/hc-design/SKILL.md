---
name: "hc-design"
description: "应用 HC Design 系统级设计规范。涵盖页面布局（网格背景与双栏结构）、全局 UI 规范（大圆角、弥散阴影、现代无衬线字体、全局滚动条）、高阶组件封装（弹窗、表单、按钮）以及磁性微交互。在开发新页面或重构系统 UI 时调用此技能。"
---

# HC Design System (HC 设计规范)

HC Design 是一套极其现代、丝滑、充满高级质感的系统级前端设计规范。它摒弃了陈旧的粗野主义（Brutalist）和死板的传统后台设计，致力于提供类似 Apple 官网、Vercel 或现代 SaaS 平台的极致用户体验。

当他人拿到此技能时，应能完全复刻出本系统（如 QiaoNan 平台）的高级 UI 效果。

## 1. 全局布局与背景 (Layout & Background)

*   **极简网格背景 (Grid Background)**
    *   整个系统（无论是前台还是后台大盘）底层背景推荐使用极致淡雅的网格线。
    *   **实现方式**：`background-image: linear-gradient(rgba(0,0,0,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,0.03) 1px, transparent 1px); background-size: 40px 40px;`
*   **固定侧边栏双栏结构 (Two-column Fixed Sidebar)**
    *   前台/后台布局通常采用左侧固定导航面板（`width: 280px` ~ `320px`，固定 `position: sticky`），右侧为自适应宽度的滚动内容区（`flex: 1`）。
    *   左右区域间不使用生硬的分割线，而是通过留白（Padding/Gap）或极淡的边框区分。

## 2. 核心视觉元素 (Core Visual Elements)

*   **柔软而友好的几何形态 (Soft Geometry)**
    *   **圆角 (Border Radius)**：广泛使用大圆角。
        *   弹窗 (Modals) / 大卡片 / 模块容器：`border-radius: 20px` 或 `24px`
        *   表单输入框 (Inputs) / 标准卡片：`border-radius: 12px` 到 `16px`
        *   按钮 (Buttons) / 徽章 (Badges)：`border-radius: 8px` 到 `12px`，特殊场景用全圆角 (`9999px`)
    *   **无感边框 (Borderless Feel)**：移除生硬的纯黑粗边框。改用极浅边框（如 `border: 1px solid #E5E7EB`）甚至无边框，依靠阴影区分层级。
*   **高级弥散阴影 (Premium Diffused Shadows)**
    *   严禁使用纯色偏移阴影（如 `box-shadow: 4px 4px 0 #000`）。
    *   **基础卡片/模块**：`box-shadow: 0 4px 12px rgba(0, 0, 0, 0.02)`
    *   **悬浮态 (Hover)**：`box-shadow: 0 16px 32px rgba(0, 0, 0, 0.08)`，伴随 `translateY(-4px)`
    *   **弹窗 (Modals)**：双层堆叠阴影，`box-shadow: 0 24px 64px rgba(0, 0, 0, 0.12), 0 8px 16px rgba(0, 0, 0, 0.04)`
*   **色彩体系 (Color Palette)**
    *   **主品牌色 (Primary Brand)**：充满活力的蓝 `#3B5BDB`。所有核心交互（主按钮、激活状态、重要文本）统一使用。
    *   **点缀色 (Accents)**：柔和紫 `#B197FC`，薄荷绿 `#38D9A9`。
    *   **文本色**：主标题/正文 `#111827`，辅助说明 `#6B7280`，禁用/极弱文本 `#9CA3AF`。
    *   **背景色**：卡片使用纯白 `#FFFFFF` 或带极弱背景模糊的 `rgba(255,255,255,0.8)`。

## 3. 高阶组件封装规范 (Component Guidelines)

### 3.1 弹窗 (Modals) - `HcModal`
*   **遮罩层**：必须使用全局全屏遮罩 `position: fixed; inset: 0;`。
*   **玻璃拟态背景**：遮罩必须带有深层模糊 `background: rgba(0, 0, 0, 0.4); backdrop-filter: blur(8px);`。
*   **出场动画 (Premium Easing)**：弹窗容器必须带有带阻尼感的缩放和位移过渡：`transition: all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);`，进场从 `translateY(20px) scale(0.95)` 开始。
*   **关闭按钮**：右上角悬浮的圆形关闭按钮，默认淡灰背景，Hover 时旋转 `90deg` 并加深背景。

### 3.2 表单系统 (Forms)
*   **结构**：Label 在上（字号 `13px`，加粗，颜色 `#4B5563`），Input 在下，独占一行。
*   **输入框 (Inputs/Textareas/Selects)**：
    *   背景色：未激活时为极浅灰 `#F9FAFB`。
    *   内边距：宽大舒适，`padding: 12px 16px`。
    *   **聚焦态 (Focus Ring)**：绝不使用默认黑框。聚焦时背景变纯白，边框变为品牌蓝 `#3B5BDB`，并扩散出一个极其柔和的半透明蓝色光晕：`box-shadow: 0 0 0 4px rgba(59, 91, 219, 0.15); outline: none;`。

### 3.3 按钮系统 (Buttons)
*   所有按钮必须带有平滑的 `transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1)`。
*   **Primary 按钮**：背景 `#3B5BDB`，白色文字，无边框。Hover 时背景加深为 `#2B45A8`，上浮 `translateY(-2px)`，并增加品牌色弥散阴影 `box-shadow: 0 4px 12px rgba(59, 91, 219, 0.3)`。
*   **Secondary/Cancel 按钮**：白底，灰字 `#374151`，浅灰边框 `#E5E7EB`。Hover 时背景变浅灰 `#F9FAFB`。

## 4. 极致微交互与排版 (Micro-Interactions & Typography)

*   **现代排版**：移除任何传统衬线体 (Serif)。全站统一使用无衬线体 (如 `Inter, system-ui, sans-serif`)。大标题加粗并采用负字距 (`letter-spacing: -0.5px`)。
*   **全局隐藏式滚动条**：
    *   重写 `::-webkit-scrollbar` 宽度为 `8px`。
    *   轨道透明，滑块 (`thumb`) 为半透明灰 `rgba(156, 163, 175, 0.4)`，全圆角。使用 `border: 2px solid transparent; background-clip: content-box;` 制造内缩悬浮的视觉错觉。
*   **3D 纵深切换 (3D Parallax Transitions)**：
    *   当页面或卡片内部有 Tab 切换（如登录框右侧插画）时，避免生硬的淡入淡出。
    *   利用 `perspective` 和 `translateZ`，将不同层级 (`layer-1, layer-2, layer-3`) 的元素配置不同的 `transition-delay`。进出场时带有 `rotateX` 或 Z 轴纵深，实现 Apple 级别的视差错落入场感。
*   **磁性文字算法 (Magnetic Text)**：
    *   对于顶级 Logo 或大标题，使用 JavaScript 将字母拆分 `<span class="letter">`。
    *   监听鼠标移动，计算鼠标与每个字母的距离，动态插值改变字母的 `translateY` 和颜色，形成跟随鼠标起伏的流体波浪效果。

## 5. 杂志风悬浮遮罩卡片 (Editorial Cover Card)

这是一种用于展示高质量图片或作品集的极简、高级布局方案。当卡片需要以视觉图片为主导时，采用此规范。

*   **视觉核心**：图片作为底层背景 100% 撑满整个圆角卡片，不使用白底或模糊面板。
*   **深色渐变遮罩 (Dark Gradient Overlay)**：在图片底部叠加 `linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.2) 50%, transparent 100%)`，确保白色文字的绝对可读性。
*   **夸张大标题**：标题采用 `28px` 的白色纯色大字号，附带深色阴影 `text-shadow: 0 4px 12px rgba(0,0,0,0.4)`，直接叠加在图片上方。
*   **滑出式交互 (Slide-up Reveal)**：
    *   **默认状态**：隐藏次要描述文字和操作按钮，保持极简封面感。
    *   **悬浮 (Hover) 状态**：底层图片微微放大（`scale(1.08)`）并变暗（`brightness(0.9)`）；同时次要文本和按钮利用 `max-height` 和 `opacity` 的缓动过渡，从大标题下方顺滑滑出。

## 如何使用此技能
当被要求应用 HC Design 时，请严格对齐上述 1~4 节的设计常量、代码结构（如 `HcModal` 的 DOM 结构）和贝塞尔动画曲线，全面重构目标页面或组件。