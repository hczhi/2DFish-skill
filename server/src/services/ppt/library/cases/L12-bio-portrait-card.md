# L12 · circle-float-card（圆形浮卡 · 出血色带）

- **适用内容类型**：人物/嘉宾/创始人介绍页；**产品介绍页**（圆形产品图）；项目/案例展示扉页；章节扉页；获奖/荣誉展示；客户成功故事开场。圆形视觉主体可以是头像、产品图、logo、图标——任何圆形 crop 的视觉元素。
- **来源**：用户截图（2026-08-27），原内容为通用简历模板
- **截图参考**：`img/L12-ref.png`
- **演示实现**：`L12-demo.html`（1280×720，洪成智·首席AI转型顾问示例）
- **是否全幅**：否，但**不包 `.slide-inner`**（浮卡 + 出血色带需脱离标准 padding，section 加 `has-card`）
- **是否新组件类**：是，通用性强，已注入 `template.html`
- **★ 原则**：CSS 类名 `.bio-*` 为实现标识，不限定内容——可放头像也可放产品图。配色全部用 `var(--c-brand)` 等变量，不绑死任何色系。

---

## 一句话定位

**「浮卡 + 圆形视觉主体 + 标题五段堆叠 + 底部色带出血」** —— 一个温暖、人格化的介绍/展示版式。圆形视觉主体（人像/产品/logo）成为绝对焦点，出血色带让硬卡片瞬间活起来。不限于人物——产品、项目、荣誉都适用。

---

## 结构拆解

```
┌──── 外层（neutral 浅底，inset 56px）────┐
│ ┌──────── Card（圆角 24px，白底）────────┐│
│ │  KICKER (灰小标)                        ││
│ │  MEGA-WORD (巨大品牌色字)    ┌─────┐  ││
│ │  中文主标题 (深色)              │ 圆形 │  ││
│ │  灰色描述段落                   │ 视觉 │  ││
│ │  ▬▬ (品牌色短线)               │ 主体 │  ││
│ │                                └─────┘  ││
│ │═══════════ 品牌色色带出血 ══════════════││ ← 色带溢出 Card 边缘
└─────────────────────────────────────────┘
```

| 维度 | 取值 |
|------|------|
| 外层 inset | 56px（slide 到 card-wrap 的间距） |
| Card 圆角 | 24px（软） |
| Card 内 padding | 62px 72px 90px（底部多留色带空间） |
| 内分栏 | `1.4fr 1fr`（文本为主，圆形视觉辅） |
| 圆形视觉 | 圆形 crop，~320px 直径，居右，6px 白边 + 阴影 |
| 标题堆叠 | 5 层：① 灰 kicker(24px) ② 品牌色巨字(116px serif) ③ 深色中字(38px serif) ④ 灰色描述段(15px) ⑤ 品牌色短线(64×5) |
| 底部色带 | 高度 64px，**出血**到 Card 边缘外（左右各 -24px、底部 -28px） |
| Card 阴影 | `0 24px 60px rgba(0,0,0,.08)` + `0 2px 8px rgba(0,0,0,.04)` |
| 圆形阴影 | `0 16px 40px rgba(0,0,0,.14)` |

---

## 视觉手法（学得到的部分）

1. **浮卡 + 出血色带（灵魂手法）**：色带比 Card 宽，自然露在外边。**没有色带就失去灵魂** —— 这是整个版式最值得复用的结构性手法。色带用 `position:absolute` + 负 margin 实现出血。
2. **圆形视觉主体 + 阴影 + 白边**：圆形 crop 让视觉主体成为绝对焦点，亲和力远强于方形裁切。6px 白边 + 阴影给"漂浮感"。
3. **标题五段堆叠（五层节奏）**：kicker(灰小) → super-word(品牌色巨字) → 中字(深色) → 段落(灰) → 短线(品牌色)，**层级跌落**让标题区有呼吸节奏。
4. **大字号 super-word**：用 116px 巨字当主视觉，而不是依赖图。这是文字型 hero 的典型手法 —— 用名字/产品名/身份词本身做视觉锚点。
5. **轻量装饰收尾**：底部短线 64×5 是收尾呼应，不抢戏但强化品牌色记忆。

---

## 配色归一（关键：剥离原图品牌色）

| 截图原色 | 归一为 | 用途 |
|---------|--------|------|
| 红（截图原色） | `var(--c-brand)` | super-word、色带、短线、角标 |
| 深红 | `var(--c-brand-deep)` | 色带渐变深端 |
| 深色文字 | `var(--c-ink-deep)` | 中字主标题 |
| 浅灰 | `var(--c-ink-soft)` | kicker、描述段落 |
| 白 | `var(--c-card)` | Card 底、圆形视觉白边 |
| 浅米底 | `var(--c-bg)` | 整页外层底 |

> 归一后，无论 deck palette 是橙、青、黄、蓝、双色系，这个版式都成立。super-word 和色带自动跟随 deck 品牌色。**配色完全由 design-spec.json 决定，案例不绑死任何色系。**

---

## CSS 骨架（已注入 template.html）

```css
/* 圆形浮卡 (L12) · 圆形视觉 + 出血色带 — 详情见 cases/L12-bio-portrait-card.md */
.bio-wrap{position:absolute;inset:56px;z-index:2}
.bio-card{position:relative;width:100%;height:100%;background:var(--c-card);border-radius:24px;
  box-shadow:0 24px 60px rgba(0,0,0,.08),0 2px 8px rgba(0,0,0,.04);
  padding:62px 72px 90px;display:grid;grid-template-columns:1.4fr 1fr;gap:48px;align-items:center;
  overflow:visible}
.bio-text{position:relative;z-index:3}
.bio-kicker{font-size:24px;font-weight:800;color:var(--c-ink-soft);letter-spacing:5px;margin-bottom:4px}
.bio-mega{font-family:var(--serif);font-size:116px;font-weight:900;color:var(--c-brand);
  line-height:.88;letter-spacing:-3px;margin:0 0 20px;text-shadow:0 4px 24px rgba(0,0,0,.06)}
.bio-title-cn{font-family:var(--serif);font-size:38px;font-weight:800;color:var(--c-ink-deep);
  margin-bottom:18px;letter-spacing:1px}
.bio-desc{font-size:15px;line-height:1.8;color:var(--c-ink-soft);max-width:460px;margin-bottom:8px}
.bio-accent-line{width:64px;height:5px;background:var(--c-brand);border-radius:3px;margin-top:24px}
.bio-portrait-wrap{position:relative;display:flex;justify-content:center;align-items:center;z-index:3}
.bio-portrait{position:relative;width:320px;height:320px;border-radius:50%;overflow:hidden;
  box-shadow:0 16px 40px rgba(0,0,0,.14),0 2px 8px rgba(0,0,0,.08);border:6px solid var(--c-card)}
.bio-portrait img{width:100%;height:100%;object-fit:cover;display:block}
.bio-portrait::after{content:"";position:absolute;inset:-6px;border-radius:50%;
  border:2px solid var(--c-brand);opacity:.35;z-index:-1}
.bio-badge{position:absolute;bottom:-10px;right:-10px;background:var(--c-brand);color:#fff;
  font-size:13px;font-weight:700;letter-spacing:2px;padding:8px 16px;border-radius:20px;
  box-shadow:0 6px 20px rgba(0,0,0,.18);z-index:4}
.bio-bleed{position:absolute;bottom:-28px;left:-24px;right:-24px;height:64px;
  background:linear-gradient(90deg,var(--c-brand-deep) 0%,var(--c-brand) 50%,var(--c-brand-deep) 100%);
  border-radius:0 0 24px 24px;z-index:2;box-shadow:0 12px 36px rgba(0,0,0,.12);
  display:flex;align-items:center;justify-content:space-between;padding:0 72px}
.bio-bleed .bleed-text{color:rgba(255,255,255,.85);font-size:13px;font-weight:600;letter-spacing:6px}
.bio-bleed .bleed-dots{display:flex;gap:8px}
.bio-bleed .bleed-dots span{width:8px;height:8px;border-radius:50%;background:rgba(255,255,255,.4)}
.bio-bleed .bleed-dots span:first-child{background:rgba(255,255,255,.9)}
.bio-corner-tag{position:absolute;top:28px;right:32px;font-size:11px;font-weight:700;
  color:var(--c-ink-soft);letter-spacing:3px;z-index:5;display:flex;align-items:center;gap:10px}
.bio-corner-tag::before{content:"";width:24px;height:2px;background:var(--c-brand)}
/* .bio-page-num 已删除：页面上不显示页码（当前页和总页数都不要）。 */
```

> **注**：CSS 类名 `.bio-*` 为实现标识，不限定内容。`.bio-portrait` 里可以放产品图，`.bio-mega` 可以放产品名。

---

## build-part 结构模板

```html
<!-- L12 · circle-float-card（浮卡版式，不包 .slide-inner） -->
<section class="slide has-card" data-layout="L12">
  <div class="corners"><i class="tl"></i><i class="tr"></i><i class="bl"></i><i class="br"></i></div>
  <div class="bio-wrap">
    <div class="bio-card">
      <div class="bio-corner-tag">{{CORNER_TAG}}</div>

      <div class="bio-text">
        <div class="bio-kicker">{{KICKER}}</div>
        <div class="bio-mega">{{MEGA_WORD}}</div>
        <div class="bio-title-cn">{{TITLE_CN}}</div>
        <p class="bio-desc">{{DESC_PARAGRAPH}}</p>
        <div class="bio-accent-line"></div>
      </div>

      <div class="bio-portrait-wrap">
        <div class="bio-portrait">
          <img src="/ppt-cases/ph-1x1.svg" data-img-prompt="这一格要什么图（中文一句话）" alt="{{VISUAL_ALT}}">
        </div>
        <div class="bio-badge">{{BADGE_TEXT}}</div>
      </div>

      <div class="bio-bleed">
        <span class="bleed-text">{{BLEED_TEXT}}</span>
        <div class="bleed-dots"><span></span><span></span><span></span><span></span><span></span></div>
      </div>
    </div>
  </div>
</section>
```

---

## 图槽位

- **1 张圆形视觉主体**（必填）：`pXX_visual`
- 建议模式：`case`（人像/产品/实物写实均可）
- 尺寸：**正方形 1080×1080**（圆形 crop 后无信息损失）
- 内容选择灵活：
  - 人物：清晰正面、自然光、纯色或虚化背景
  - 产品：主体居中、干净背景、适当留白
  - logo/图标：高对比度、简洁
- **禁用**：信息过于分散的风景图、纯抽象插画（会破坏版式焦点调性）

---

## 变体

| 变体 | 调整点 | 适用 |
|------|--------|------|
| V1 · 镜像 | 圆形视觉左、文本右 | 西方阅读顺序、产品展示 |
| V2 · 无外卡 | 取消 Card，全幅底色 | 更简洁、章节扉页 |
| V3 · 多圆形并排 | 3 个圆形并排，去 super-word，改横向 mini 列 | 团队页、产品矩阵 |
| V4 · 中文巨字 | 删灰 kicker，super-word 改中文（"履历"/"产品"/"案例"） | 全中文场景 |
| V5 · 双色带 | 顶部加一条窄 brand 带 + 底部色带 | 更强仪式感、节庆风 |
| V6 · 矩形视觉 | 圆形改竖向矩形（圆角），露出更多画面 | 需展示完整产品形态 |

---

## design 提示

- **视觉中等偏重**，前后页可用 L7（金句整页）或 L2（全幅背景）缓冲
- **super-word 巨字**是主视觉锚点，字号 ≥96px，必须衬线字体。内容灵活：人名/产品名/身份词/案例名均可
- **色带出血是灵魂**：build-part 必须保证 section 的 `overflow` 不裁剪色带（`has-card` 类需在 template 中允许 overflow:visible）
- **圆形视觉主体选材**：ImageGen 提示词按内容类型调整——人像需"professional, natural lighting, clean background"；产品需"product photography, centered, clean background"
- **mega-word 内容选择**：用 2~4 字词（人名/产品名/"案例"/"产品"/"嘉宾"），超过 4 字字号需降至 80px 以下
- **配色归一铁律**：super-word、色带、短线、角标一律用 `var(--c-brand)` 系列变量，禁止硬编码色值。案例配色完全由 design-spec.json 决定
