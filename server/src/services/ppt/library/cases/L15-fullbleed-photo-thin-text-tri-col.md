# L15 · fullbleed-photo-thin-text-tri-col（上 hero 极小字+纯白三栏文字·克制美）

- 适用内容类型：品牌价值观页（三大理念/三大原则/三大支柱）；方法论三要素；产品三大优势（商务克制版，比 L4 双卡更"高级"）；服务三大承诺；团队/业务三大方向。
- 来源：用户截图（2026-08-27 16:11），原内容为蔚来 NIO 官网"Designing the Future Within Reach"价值观页。
- 截图参考：img/L15-ref.png

## 一句话定位

**「上下分屏 40/60 + 上 hero 极克制（仅 2 个极小信息点）+ 下纯白三栏带竖线锚点」** —— 商务克制美学的"价值观/品牌理念"页型。和 L11/L13 同为全幅但气质截然不同。

## 结构拆解

```
┌──────────────── 上 hero（约 40%）────────────────┐
│ ⊙ │ ← 顶左 logo
│ Designing the Future            Visualize…│ ← 左上标语 + 右上小字
│  Within Reach                       Closing…│     仅2 个信息点
│                                                    │ （极克制）
├─────────────────── 下文字（约 60%）─────────────────┤
│ ● 纯白底（无渐变）                                    │
│                                                    │
│  │科技的力量   │设计驱动    │超越期待的高品质服务 │ ← 三栏等宽
│  │              │              │              │    │ 左侧 `|` 竖线锚点
│  │ 中文段（大） │ 中文段（大） │ 中文段（大） │    │
│  │              │              │              │    │
│  │ 英文段（小） │ 英文段（小） │ 英文段（小） │    │
└────────────────────────────────────────────────┘
```

| 维度 | 取值 |
|------|------|
| 上下分屏比 | **约 40 : 60**（上半 hero 占比较少，文字区更大；与 L14 56/44 相反） |
| hero 文字 | **极小字号**（16-20px），左上标语 + 右上小说明，**不抢戏** |
| 三栏比例 | **等宽 1:1:1** |
| 三栏分隔 | **左侧 `\|` 竖线锚点**（不是 L11 那种列间分隔线，是每栏标题前的短线） |
| 三栏结构 | 中文小标(粗) → 中文段(15-17px 中等) → 英文段(11-12px 浅灰) |
| 整体底色 | 上半全幅图 + 下半纯白，**无渐变**（与 L13 的径向渐变相反） |
| 装饰元素 | 仅 logo + 竖线 + 文字，无圆点、无标签、无胶囊 |

## 视觉手法（结构层面）

1. **hero 图仅 2 个极小信息点**：与 L13 顶部胶囊 + 居中堆叠相反，L15 在 hero 上"几乎不写字"。结构信号 —— 适合"图本身就够信息"的视觉。
2. **纯白底三栏 + 竖线锚点**：商务克制美学的核心。竖线作为"标题前装饰"，比 L11 的菱形 marker 更冷静。
3. **三栏节奏：中大英小**：中文段字号约 17px，英文段约 11px，形成 1.5:1 的层级（不是 2:1），保持视觉流动。
4. **上下分屏无渐变过渡**：靠色温（暗图→白底）自然切换，不加渐变，最克制。
5. **左侧竖线**用 `border-left` 或 `::before` 实现，长度 ≈ 中文小标高度即可，不要拉通到底。

## 配色归一（骨架提示，不锁颜色）

| 结构角色 | 实现方式 |
|---------|----------|
| hero 图 | ImageGen 按 deck palette 生成氛围场景 |
| hero 文字 | `var(--c-card)`（白） |
| 下半底色 | `var(--c-card)`（纯白） |
| 中文小标 | `var(--c-ink-deep)` |
| 中文段 | `var(--c-ink)` |
| 英文段 | `var(--c-ink-soft)`（opacity 0.7） |
| 竖线 | `var(--c-accent)` 或 `var(--c-hairline)`（按 deck 调性） |

> 关键：截图原色（蔚来蓝灰调/森林绿调）不是被学习的一部分，案例只抓"上下分屏 + 三栏文字 + 竖线锚点"结构。

## CSS 骨架

```css
/* 上 hero + 下三栏文字（克制美） */
.l15-wrap{position:absolute;inset:0;display:flex;flex-direction:column}
.l15-hero{position:relative;flex:0 0 40%;overflow:hidden}
.l15-hero img{width:100%;height:100%;object-fit:cover}
.l15-hero-tl{position:absolute;top:48px;left:80px;color:var(--c-card);z-index:2;font-size:18px;line-height:1.4}
.l15-hero-tl .logo{font-size:28px;font-weight:700;margin-bottom:8px}
.l15-hero-tr{position:absolute;top:48px;right:80px;color:var(--c-card);z-index:2;font-size:14px;line-height:1.6;opacity:.85;max-width:240px;text-align:right}
.l15-text{position:relative;z-index:2;flex:1;background:var(--c-card);padding:64px 80px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:56px}
.l15-col h3{font-size:22px;font-weight:700;color:var(--c-ink-deep);margin-bottom:24px;padding-left:14px;border-left:3px solid var(--c-accent)}
.l15-cn{font-size:16px;line-height:1.85;color:var(--c-ink);margin-bottom:16px}
.l15-en{font-size:14px;line-height:1.65;color:var(--c-ink-soft);opacity:.78}
```

## build-part 结构模板

```html
<section class="slide">
  <div class="slide-inner">
  <div class="l15-wrap">
    <div class="l15-hero">
      <img src="/ppt-cases/ph-16x9.svg" data-img-prompt="这一格要什么图（中文一句话）" alt="">
      <div class="l15-hero-tl">
        <div class="logo">品牌/章节标签</div>
        <div>中文大标语 1-2 行</div>
      </div>
      <div class="l15-hero-tr">右上小说明 2-3 行</div>
    </div>
    <div class="l15-text">
      <div class="l15-col">
        <h3>主题 A</h3>
        <p class="l15-cn">中文段</p>
        <p class="l15-en">English paragraph</p>
      </div>
      <div class="l15-col">
        <h3>主题 B</h3>
        <p class="l15-cn">中文段</p>
        <p class="l15-en">English paragraph</p>
      </div>
      <div class="l15-col">
        <h3>主题 C</h3>
        <p class="l15-cn">中文段</p>
        <p class="l15-en">English paragraph</p>
      </div>
    </div>
  </div>
  </div>
</section>
```

## 图槽位

- **1 张 hero 图**（必填）：`pXX_hero`，建议 mode `case`（场景/建筑/空间类，避免人物 closeup 和抽象插画）
- 关键选材：氛围型场景图，构图简洁有"景深感"（走廊/钢架/远眺/海面），保证文字叠加不挡主体
- 长宽比：上半占 40% 高度的 16:9，建议 1920×1080 顶部视角 `object-position: center 40%`

## 变体

| 变体 | 调整点 | 适用 |
|------|--------|------|
| V1 · 两栏 | 删一栏，1fr 1fr | 两大支柱 |
| V2 · 四栏 | 1fr×4 | 四大方向 |
| V3 · 上 50/下 50 | 对半分屏 | 信息密度更平衡 |
| V4 · 上 30/下 70 | 文字区主导 | 偏论文风/白皮书风 |
| V5 · 竖线改菱形 | 改用 L11 风格菱形 marker | 商业广告风 |
| V6 · 改 hairline | 竖线改用 `--c-hairline` 极浅灰 | 极致冷静风 |
| V7 · 加 kicker 顶头 | 三栏上方加一行 kicker + 大标题 | 章节扉页型 |
| V8 · 双语无英文段 | 删英文段，纯中文 | 全中文场景 |
| V9 · 中下加图标 | 中文段上方加 24px 小图标 | 三大优势型 |

## 与 L11/L12/L13/L14 的差异

| 维度 | L11 | L12 | L13 | L14 | L15 |
|------|-----|-----|-----|-----|-----|
| 主体 | 三栏并列叙事 | 圆形浮卡 | 单图+居中大标题 | 上图下信息 | 上图+三栏文字 |
| 上下分屏比 | 顶 header 14% + 三栏 | 全幅浮卡 | 全幅渐变 | 56/44 | 40/60 |
| hero 文字 | 大字+菱形 | 无 | 大字+胶囊+引号 | 中字+kicker | 极小字+logo |
| 三栏特色 | 全幅图叠字+大数字 | 浮卡+圆形视觉 | — | — | 白底纯文字+竖线 |
| 信息密度 | 高 | 低 | 极低 | 高 | 中（克制） |
| 气质 | 商业广告/路演 | 人物/产品介绍 | 封面/宣言 | 产品详情 | 商务克制/价值观 |

> L15 是 L11 的"克制版"：同三栏结构，但无大数字锚点、无渐变蒙版、纯白底、纯文字。**适合需要严肃感的场景。**

## build-part 注意事项

- **不需 fullbleed**：L15 在 `.slide-inner` 内排版（与 L14 同）
- hero 字号要克制（**不要**抄 L13 的 96px），用 16-20px 是关键气质
- 英文段与中文段字号比建议 11:16 ≈ 0.69，**别用 1:1**（否则无层级）
- 竖线高度只需贴合中文小标高度（约 22px），不要做 60px+ 长竖线

## design 提示

- 视觉中（克制但有张力），前后页用 L7/L13/L12 缓冲
- 与 L11 区别：L11 是"商业广告/路演"风（路演大数字+渐变），L15 是"商务克制"风（纯白底+纯文字+竖线）
- 视觉对比节奏：L11→L15 是"重→轻"过渡
