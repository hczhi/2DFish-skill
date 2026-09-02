# L11 · tri-narrative-photo（三栏并列叙事 · 全幅图叠字）

> 📄 本条目为截图逆向案例，含本详情文件。design 阶段匹配到 L11 时**必须读本文件**获取完整 CSS 与结构。
> 演示实现见同目录 `L11-demo.html`，截图原件见 `img/L11-ref.jpg`。

## 元信息
- **适用内容类型**：路线/策略的三个并行轨道；三阶段演进并列（过去-现在-未来）；三案例同屏对比；产品/服务三模块矩阵；三档价位/三种能力等级。
- **来源**：用户截图（2026-08-27），原内容为某赛艇/水上运动 IP 活动三阶段年度策划页。
- **截图参考**：`img/L11-ref.jpg`
- **演示实现**：`L11-demo.html`（1280×720 简化版，正式生成时走 1920×1080）
- **新组件类**：是；已注入 `template.html`（`.tri-narrative` 体系），属常用版式。
- **是否全幅**：是（覆盖 `.slide-inner`，与 L2 fullbleed-bg-mask 同级处理，build-part 不使用 `.slide-inner`）。

## 一句话定位
**三栏等宽 · 全幅图叠字 · 大号数字锚点 · 顶 header 浅带** —— 一个适合"三阶段/三模块/三案例并行叙事"的强版式，视觉强、叙事清晰、单页信息密度高但毫不拥挤。

## 结构拆解

```
┌─────────────────── 顶 header 区（浅底 · flex:none 高 140px）──────────────────┐
│ [/// kicker]  企业AI转型 三阶段路径            想象数科·方法论 v2.0            │
├───────────────────── tri-cols（flex:1 · 三栏等宽）───────────────────────────┤
│            ┃                  │                  ┃                          │
│   照片1    ┃     照片2        │     照片3        ┃  ← 全幅 background-cover │
│ (全幅)     ┃    (全幅)        │    (全幅)        ┃                          │
│            ┃                  │                  ┃                          │
│         1  ┃              2   │              3   ┃  ← 大号衬线数字(右上锚定)│
│  阶段一    ┃   阶段二        │   阶段三        ┃     font-serif 200px      │
│  副标      ┃   副标          │   副标          ┃     半透明白 + 投影       │
│  • 要点    ┃   • 要点        │   • 要点        ┃                          │
│  • 要点    ┃   • 要点        │   • 要点        ┃                          │
│  • 要点    ┃   • 要点        │   • 要点        ┃                          │
└───────────┴──────────────────┴──────────────────┴──────────────────────────┘
 ↑ 列间 1px 半透明白分隔线（.tri-col + .tri-col::before）
 ↑ 底部黑色双向渐变（to top + to right）保证白字可读
```

| 维度 | 取值 |
|------|------|
| 顶 header 比例 | flex:none · 固定高 140px（约占 13%） |
| 三栏比例 | 等宽 1:1:1（grid-template-columns:1fr 1fr 1fr） |
| 分栏手法 | 直线分栏 + 1px 半透明白分隔（斜切为可选变体 V-skew） |
| 文本叠放位置 | 文本左下、大号数字右上，形成对角呼应 |
| 数字尺寸 | 200px 衬线、半透明白 .94、text-shadow 投影、letter-spacing -4px |
| 副标颜色 | var(--c-accent)（截图原为青蓝 #3DB4D9 → 归一为变量） |

## 视觉手法（可复用的"灵魂"）
1. **三栏并列叙事**：内容天然是 3 个同结构单元（阶段/模块/案例），一眼能扫完。
2. **全幅图 + 底部黑色渐变**：保证白色文字可读，又不挡图的整体氛围。渐变是双向叠加（to-top 主 + to-right 辅），让左下文字区比右下更可读。
3. **大号数字作为视觉锚点**：1/2/3 不只是序号，更是版式中的"大留白锚"，打破文字区的均质感；用衬线字体增加质感。
4. **顶 header 用浅带**：让标题信息有"出戏"空间，不与下方照片区争抢视觉；浅带用 135° 微渐变避免呆板。
5. **副标用强调色 + 列表菱形 marker**：副标是每栏的信息焦点，用 var(--c-accent) 与 deck 同色系；marker 用旋转 45° 的小方块，比圆点更有设计感。

## 配色归一（关键：剥离原图品牌色）

| 截图原色 | 归一为 | 用途 |
|---------|--------|------|
| 青蓝 #3DB4D9 | `var(--c-accent)` / `var(--c-accent-deep)` | 副标、kicker 描边、label 前缀线、列表 marker |
| 黑色（底部渐变） | `rgba(6,14,24,.x)` 渐变 | 文字可读性底（**不绑定 palette**，是中性深色） |
| 纯白 | `rgba(255,255,255,.94)` 等 | 数字、文本、分隔线 |
| 浅灰 header 底 | `var(--c-bg-alt)` → `#E6EEF5` 135° 渐变 | 顶 header 浅带 |

> 这样无论 deck palette 是什么色系（橙、青、紫），这个版式都成立，副标自动跟随 deck 主强调色。

## CSS 骨架（已注入 template.html，build-part 直接复用）

```css
/* 三栏并列叙事 (L11) · 全幅图叠字 + 顶 header 浅带 */
.tri-narrative{position:absolute;inset:0;z-index:1;display:flex;flex-direction:column;overflow:hidden}
.tri-head{flex:none;height:140px;background:linear-gradient(135deg,var(--c-bg-alt) 0%,#E6EEF5 100%);display:flex;align-items:center;padding:0 80px;gap:18px;border-bottom:1px solid rgba(0,0,0,.06)}
.tri-head .kicker{color:var(--c-accent-deep);font-size:16px;font-weight:700;letter-spacing:3px;padding:5px 12px;border:1.5px solid var(--c-accent);border-radius:2px}
.tri-head h1{font-family:var(--serif);font-size:42px;font-weight:700;color:var(--c-ink-deep);letter-spacing:.5px}
.tri-head h1 .em{color:var(--c-accent-deep)}
.tri-head .meta{margin-left:auto;font-size:14px;color:var(--c-ink-soft);text-align:right;line-height:1.5}
.tri-head .meta b{color:var(--c-ink-deep)}
.tri-cols{flex:1;display:grid;grid-template-columns:1fr 1fr 1fr;position:relative;overflow:hidden}
.tri-col{position:relative;overflow:hidden}
.tri-col .photo{position:absolute;inset:0;background-size:cover;background-position:center;filter:saturate(.92) contrast(1.05)}
.tri-col::after{content:"";position:absolute;inset:0;z-index:2;background:linear-gradient(to top,rgba(6,14,24,.85) 0%,rgba(6,14,24,.35) 50%,rgba(6,14,24,.1) 80%,transparent 100%),linear-gradient(to right,rgba(6,14,24,.25) 0%,transparent 35%)}
.tri-col+.tri-col::before{content:"";position:absolute;top:0;bottom:0;left:0;width:1px;background:rgba(255,255,255,.18);z-index:3}
.tri-num{position:absolute;top:36px;right:36px;font-family:var(--serif);font-size:200px;font-weight:700;line-height:.85;color:rgba(255,255,255,.94);z-index:4;text-shadow:0 6px 32px rgba(0,0,0,.4);letter-spacing:-4px}
.tri-num .step{display:block;font-family:var(--sans);font-size:12px;font-weight:700;letter-spacing:4px;color:var(--c-accent);margin-bottom:4px}
.tri-text{position:absolute;bottom:48px;left:48px;right:36px;color:#fff;z-index:4}
.tri-label{font-size:16px;font-weight:500;letter-spacing:1.5px;opacity:.9;display:inline-flex;align-items:center;gap:8px}
.tri-label::before{content:"";width:18px;height:1.5px;background:var(--c-accent)}
.tri-subtitle{font-size:34px;font-weight:800;color:var(--c-accent);margin:12px 0 20px;line-height:1.2;letter-spacing:.5px}
.tri-list{font-size:16px;line-height:1.95;list-style:none}
.tri-list li{padding-left:20px;position:relative;color:rgba(255,255,255,.92)}
.tri-list li::before{content:"";position:absolute;left:0;top:11px;width:8px;height:8px;background:var(--c-accent);transform:rotate(45deg)}
```

### build-part 结构模板（fragment 内 `<section>` 用法）

```html
<section class="slide">
  <div class="tri-narrative">
    <div class="tri-head">
      <span class="kicker">/// 路径规划</span>
      <h1>企业AI转型 <span class="em">三阶段路径</span></h1>
      <div class="meta"><b>出品方</b><br>v2.0 · 路线图</div>
    </div>
    <div class="tri-cols">
      <!-- 栏 1 -->
      <div class="tri-col">
        <div class="photo" style="background-image:url('cases/pXX_col1.jpg')"></div>
        <div class="tri-num"><span class="step">PHASE</span>1</div>
        <div class="tri-text">
          <div class="tri-label">阶段一 · 基础设施</div>
          <div class="tri-subtitle">数字化底座</div>
          <ul class="tri-list">
            <li>统一数据中台与资产沉淀</li>
            <li>云原生算力与可观测体系</li>
            <li>权限、合规与安全基线</li>
          </ul>
        </div>
      </div>
      <!-- 栏 2、3 同结构，改 num/label/subtitle/list 与图槽位 -->
    </div>
  </div>
</section>
```

> ⚠️ L11 是全幅版式，**不要包 `.slide-inner`**（与 L2/L3 同处理），否则 140px padding 会破坏全幅效果。
> 图片用 `cases/pXX_col1.jpg` 外链，不要内联 base64。

## 图槽位

- **3 张全幅图**（每列 1 张）：`pXX_col1` / `pXX_col2` / `pXX_col3`
- 建议模式：`case`（实景类，如团队/车间/产品场景）或 `concept`（场景类，如等距插画场景）；**禁用 `data`**（图表会破坏全幅氛围）
- 长宽比：3:4 竖版（1024×1365），与栏位的 1:3 高度比例匹配；横图会被 cover 裁切，竖图更稳
- 配色跟随 deck 的 chosen palette（生图提示词用 `{{BRAND}}`/`{{ACCENT}}` 占位）

## 变体（同家族）

| 变体 | 调整点 | 适用 |
|------|--------|------|
| V1 · 双栏 | `grid-template-columns:1fr 1fr`，删中栏，数字 1/2 | 双案例对比、二元对立 |
| V2 · 四栏 | `1fr 1fr 1fr 1fr`，数字 1-4，文字区缩小、字号降 | 四象限、四季、四产品 |
| V3 · 中宽侧窄 | `1.4fr 1fr 1fr`，主次分明 | 一主两次、核心+辅助 |
| V4 · 无大数字 | 删 `.tri-num`，用小图标卡替代 | 三产品（非阶段）、并列能力 |
| V5 · 浅色背景版 | 不用全幅图，改浅色 + 极淡插画，文本改深色 | 商务正式、无图素材时 |
| V-skew · 斜切分栏 | `.tri-col` 加 `clip-path:polygon(...)` 切斜边 | 需要更强动感（代码复杂，按需启用） |

## design 决策提示
- 相邻页去重：L11 视觉很重，**前后页建议用 L7 quote-full 或 L2 fullbleed-bg-mask 缓冲**，不要连续两页 L11。
- 内容前提：每栏要有 1 个副标 + 2~3 条要点，少于 2 条会显空、多于 4 条会挤。
- 数字必须用衬线（`var(--serif)`），不要换无衬线，否则失去质感。
- 副标字数控制在 4~8 字，过长会换行破坏对齐。
