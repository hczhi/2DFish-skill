# L14 · vertical-split-hero-info（上下分屏 · 上 hero 全幅图 + 下双栏信息）

> **★ 案例只关注排版结构，颜色和内容不固定。** 版式名按结构手法命名，不绑定内容场景。配色由 deck palette 决定，不在案例里写死。

## 元信息
- **编号**：L14
- **来源**：用户截图（2026-08-27），原内容为蔚来 DNIO 概念车产品介绍页。
- **截图参考**：`img/L14-ref.png`
- **是否全幅**：否（在 `.slide-inner` 内排版，上下 flex 分屏，不用 absolute）
- **是否需要 has-card**：否
- **新组件类**：是（`.l14-*` 体系），已注入 `template.html`

## 一句话定位

**「上下二段式 · 上半全幅 hero 图嵌入产品名大字 + 下半浅底双栏双语信息」** —— 适合产品/项目/案例详情的高密度混合版式。视觉重但信息密度高，可做单页成稿。

## 结构拆解

```
┌──────────── 上半 hero 区（flex 0 0 56%）────────────┐
│ [kicker 小标]                                        │
│                                                      │
│  英文大字 (56px 白)                                   │
│  中文大字 (56px 白)                                   │  ← 文字靠左 80px
│                                                      │     垂直居中偏上
│                                              (hero图) │
├─────────── 下半信息区（flex 1, 浅底）──────────────────┤
│  ┌── 左栏 (1fr) ──┐  ┌── 右栏 (1fr) ──┐              │
│  │ 小标题(深·20px) │  │ 小标题(深·20px) │              │
│  │ 中文段落(15px)  │  │ 中文段落(15px)  │              │
│  │ English 段落   │  │ English 段落   │              │
│  │ (italic ·13px) │  │ (italic ·13px) │              │
│  └────────────────┘  └────────────────┘              │
│  padding: 48px 80px 64px                             │
└──────────────────────────────────────────────────────┘
```

| 维度 | 取值 |
|------|------|
| 上下分屏比 | **约 56 : 44**（hero 略大） |
| 分屏手法 | 靠**色温切换**区分（暗 hero 图 → 浅底信息区），无分界线 |
| 上半文字对齐 | 左对齐（贴左 80px 安全区），垂直居中偏上 |
| 上半堆叠 | kicker(14px) → 英文大字(56px) → 中文大字(56px) |
| 上半文字色 | `var(--c-card)`（白/浅），保证 hero 图上可读 |
| 上半渐变 | `linear-gradient(to top, rgba(0,0,0,.45), rgba(0,0,0,.1) 50%, rgba(0,0,0,.35))` |
| 下半底色 | `var(--c-bg)` 或 `var(--c-bg-alt)`（浅色系，与上半形成色温对比） |
| 下半分栏 | 双栏等宽 `1fr 1fr`，gap 64px，每栏 padding 48px 80px 64px |
| 每栏堆叠 | 小标题(20px deep + hairline 底线) → 中文段(15px) → 英文段(13px italic) |
| 双语对照 | 段落对照（非逐句对照），每栏一个完整信息单元 |

## 视觉手法（学得到的部分）

1. **上下二段式分屏靠色温切换**：不用分界线，暗 hero 图 → 浅底信息区自然过渡，最克制。
2. **上半图叠字、字号让位**：上半文字字重很大但"埋"在 hero 图中，与下半浅底信息形成强对比节奏。
3. **下半双栏中英对照**：每个信息单元（小标+中段+英段）做成一栏，比"上半说明下半"更整洁。
4. **非对称 56/44**：hero 略大保持视觉重，下半信息密度高但占比小——产品页经典分屏。
5. **上半 kicker 左边框**：kicker 前加 2px accent 竖线，是品牌一致性的小细节。

## 配色归一（不锁颜色，只做角色映射）

| 结构角色 | 变量 |
|---------|------|
| hero 图 | 由 ImageGen 按 deck palette 生成 |
| 上半文字主色 | `var(--c-card)` |
| 上半渐变遮罩 | `rgba(0,0,0,.x)` 固定黑色渐变（保证白字可读，与 palette 无关） |
| 下半底色 | `var(--c-bg)` 或 `var(--c-bg-alt)` |
| 下半小标题 | `var(--c-ink-deep)` |
| 下半中文段 | `var(--c-ink)` |
| 下半英文段 | `var(--c-ink-soft)` |
| kicker 竖线 | `var(--c-accent)` |
| 小标题底线 | `var(--c-hairline)` |

> 截图原色（蔚来标志蓝/概念车黑色/NIO 细线高光）不是被学习的一部分。案例只抓"上下分屏 + 双栏信息"结构。

## CSS 骨架（已注入 template.html）

```css
/* 上下分屏 · hero + 双栏信息 (L14) — 详情见 cases/L14-vertical-split-hero-info.md */
.l14-wrap{position:absolute;inset:0;display:flex;flex-direction:column}
.l14-hero{position:relative;flex:0 0 56%;overflow:hidden}
.l14-hero img{width:100%;height:100%;object-fit:cover;object-position:center 40%;display:block}
.l14-hero::after{content:"";position:absolute;inset:0;background:linear-gradient(to top,rgba(0,0,0,.45) 0%,rgba(0,0,0,.1) 50%,rgba(0,0,0,.35) 100%)}
.l14-hero-text{position:absolute;left:80px;top:50%;transform:translateY(-50%);z-index:2;color:var(--c-card)}
.l14-kicker{font-size:14px;font-weight:700;letter-spacing:3px;opacity:.85;margin-bottom:16px;padding-left:12px;border-left:2px solid var(--c-accent)}
.l14-mega-en{font-size:56px;font-weight:700;line-height:1.1;letter-spacing:-.5px}
.l14-mega-cn{font-size:56px;font-weight:800;line-height:1.15;margin-top:4px;opacity:.95}
.l14-info{flex:1;background:var(--c-bg);padding:48px 80px 64px;display:grid;grid-template-columns:1fr 1fr;gap:64px}
.l14-info-col h3{font-size:20px;font-weight:700;color:var(--c-ink-deep);margin-bottom:18px;padding-bottom:12px;border-bottom:1px solid var(--c-hairline)}
.l14-cn-p{font-size:15px;line-height:1.85;color:var(--c-ink);margin-bottom:12px}
.l14-en-p{font-size:13px;line-height:1.65;color:var(--c-ink-soft);font-style:italic;opacity:.85}
```

## build-part 结构模板

```html
<section class="slide">
  <div class="slide-inner">
    <div class="l14-wrap">
      <!-- 上半 hero -->
      <div class="l14-hero">
        <img src="/ppt-cases/ph-16x9.svg" data-img-prompt="这一格要什么图（中文一句话）" alt="">
        <div class="l14-hero-text">
          <div class="l14-kicker">KICKER TEXT</div>
          <div class="l14-mega-en">English Title</div>
          <div class="l14-mega-cn">中文标题</div>
        </div>
      </div>
      <!-- 下半双栏信息 -->
      <div class="l14-info">
        <div class="l14-info-col">
          <h3>小标题 1</h3>
          <p class="l14-cn-p">中文段落内容…</p>
          <p class="l14-en-p">English paragraph…</p>
        </div>
        <div class="l14-info-col">
          <h3>小标题 2</h3>
          <p class="l14-cn-p">中文段落内容…</p>
          <p class="l14-en-p">English paragraph…</p>
        </div>
      </div>
    </div>
  </div>
</section>
```

### build-part 注意事项
- **上半必须有图片**（无图版式不成立，hero 区不能退化为色块）
- **上下分屏**靠 `flex: 0 0 56%` / `flex: 1` 比例控制，不用 absolute 定位
- **不需要 fullbleed 标记**，整体在 `.slide-inner` 内即可
- 双栏信息每栏文本最长不超过 8 行（否则拥挤）
- hero 图 `object-position: center 40%` 让上半视觉重心偏上，避免文字区遮挡主体

## 图槽位

- **1 张 hero 图**（必填）：`pXX_hero`，建议 mode `case`（场景/产品实景图）
- 长宽比：1920×1080 满幅，上半视角做 `object-position: center 40%`
- 关键选材：**有明确"主体"的全幅图**（产品/项目鸟瞰/概念图），不要散点/留白太多的极简图
- 禁用：人物 closeup、纯抽象插画、数据图表

## 适用内容类型（不锁内容，列出多场景）

- **产品介绍页**（新能源车/概念机/品牌发布主图）
- **项目详情页**（地产楼盘/工程项目/技术架构图）
- **案例分析页**（客户案例/标杆项目深度剖析）
- **章节配图页**（长报告中的"本期特写" / "本章案例"）
- **嘉宾/讲者深度页**（带 hero 视觉 + 下方双语履历，比 L12 更适合单人深页）
- **解决方案详情页**（方案封面 + 下方三大能力详解）

## 变体

| 变体 | 调整点 | 适用 |
|------|--------|------|
| V1 · 镜像 | 左右版（图左信息右） | 偏杂志风 |
| V2 · 三栏信息 | 下半 `1fr 1fr 1fr` | 信息更细分（如"外观·内饰·动力"） |
| V3 · 上 70/下 30 | 加大 hero 占比 | 视觉主角图片强、信息简略 |
| V4 · 上 30/下 70 | 信息密度更高 | 章节深度分析页 |
| V5 · 浅 hero | hero 图淡化，主要靠文字 | 商务严谨场景 |
| V6 · 颠倒 | 信息上半小卡 + hero 大图下半 | 信息先行的案例页 |
| V7 · 双语单栏 | 去掉双栏，中英交替堆叠一栏 | 文本量小、视觉弱化 |
| V8 · 中间分隔线 | 上下屏之间加 hairline | 必要时强化分屏 |
| V9 · hero 右侧浮卡 | 上半右侧加一个浮卡（标题/CTA/副标） | 转化导向产品页 |

## 与现有版式的差异

| 维度 | L11 | L12 | L13 | L14 |
|------|-----|-----|-----|-----|
| 主体 | 三栏并列叙事 | 圆形视觉+浮卡 | 单图+居中大标题 | 上图下信息 |
| 对齐 | 三栏等宽 | 左文本右圆形 | 居中堆叠 | 左对齐双段式 |
| 高度占比 | 顶 header + 三栏 | 全幅浮卡 | 全幅渐变 | 56% 上 / 44% 下 |
| 信息密度 | 中 | 低 | 极低（封面） | **高（详情页）** |
| 适用 | 路径/案例对比 | 人物/产品介绍 | 封面/扉页/宣言 | **产品/项目详情** |

> L14 是 L11/L12/L13 之外的"详情页"分支——前三个偏"印象"和"叙事"，L14 偏"信息密度"。

## design 提示

- 视觉重（hero 图压场），前后页用 L7/L13/L12 缓冲
- 56/44 比例可按内容密度微调（30~60% hero 区间），但 hero 不能低于 40%
- hero 文字字号 48~64px，低于 48px 会被 hero 图"吃掉"
- 下半小标题 18~22px，必须有 hairline 底线（否则栏内无视觉分隔）
- 英文段必须 italic + opacity ≤ .85，视觉权重低于中文段
- 双栏 gap 48~72px，低于 48px 拥挤、高于 80px 断裂
- 与 L3 case-hero 的区别：L3 是"左文右图"单段式，L14 是"上图下信息"双段式，信息密度更高
