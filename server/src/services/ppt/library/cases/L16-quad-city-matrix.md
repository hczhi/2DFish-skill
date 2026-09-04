# L16 · quad-city-matrix（四栏等宽「图+中英标题+双语描述」单元）

> 本文件里的 CSS 和结构**必须和 `library/template.html` 里那一段完全对得上**（那份才是真的渲染
> 用的骨架，本文件只是喂给模型的说明）。对不上的后果不是编译错误：模型照本文件写出一个
> `<div class="l16-head">`，template 里没有这个类，那一块掉回默认流式布局 —— 页面照样渲染、
> 接口 200，看起来是「这个版式塌了」，而重新生成一次拿到的是同样的一版（`caseLibrary.test.ts`
> 逐个 token 核这件事）。效果 demo 是 `library/demo-slides.html` 里 `<!-- @demo L16 -->` 那个片段。

- 适用内容类型：城市/办公地分布；客户案例矩阵；产品矩阵（4 款同屏）；业务四大板块；门店/分公司矩阵；合作伙伴矩阵；四季/四节内容；四类用户/四类场景。
- 来源：用户截图（2026-08-27 16:11），原内容为蔚来 NIO 官网"我们一起，将梦想实现"城市分布页。
- 截图参考：img/L16-ref.png

## 一句话定位

**「中文大标题+中文一行副标 + 四栏等宽『图+中英标题+双语描述』单元」** —— 一个干净利落的"项目矩阵陈列"版式。视觉重在图集而非叙事，适合"看图说话"型内容。

## 结构拆解

```
┌── .slide-header（左上角固定页眉，全平台统一）──┐
│  第二部分 · 服务网络                          │ ← 只有一句 kicker
├────────────────────────────────────────────┤
│                                            │ ← 标题区（约 18%）
│  我们一起，将梦想实现  (中文大字)             │
│  自2014 年创立，蔚来便在全球招募…(中文副标)  │
├────────── 4 栏矩阵（占主体约 74%）──────────┤
│            │            │            │           │
│   城市图    │   城市图 │   城市图   │   城市图   │ ← 等宽图片
│            │            │            │           │
│   │上海    │   │合肥    │   │北京    │   │南京    │ ← 竖线锚点 + 中英标题
│   SHANGHAI │   HEFEI    │   BEIJING  │   NANJING │
│            │            │            │           │
│  蔚来国际… │  蔚来中国…  │  蔚来全球… │  蔚来电驱…│ ← 双语描述
│ 蔚来全球…  │  整车制造…  │            │           │
└────────────┴────────────┴────────────┴───────────┘
```

| 维度 | 取值 |
|------|------|
| 页眉 | 只有 `.slide-header` 里那一句 kicker（**不要在 `.l16-wrap` 里另造一条 header 带**：那一层没有 CSS，会掉回默认流式布局把矩阵往下顶，而接口 200、界面上像是这个版式塌了） |
| 标题区 | 中文大标(粗) + 中文一行副标(浅灰) |
| 矩阵比例 | 标题区 18% + 矩阵 74%（矩阵占绝对主体） |
| 列数 | **4 等宽** |
| 每栏结构 | 图(占主体) + `\|`竖线+中文标题(粗) +英文标题(浅) + 双语描述 |
| 文字与图比 | **图 70% / 文字 30%**（图主导，文字辅助） |
| 整体气质 | 干净利落、纸面陈列风、极简 |

## 视觉手法（结构层面）

1. **页眉极克制**：只有 `.slide-header` 那一句 kicker，**几乎不抢戏**——把视觉完全让给矩阵。
2. **矩阵单元"上图下文"**：图占 70%，文字仅占 30%。**图是主角**，文字是辅助说明。
3. **`\|` 竖线 + 中英标题**：与 L15 同款竖线锚点手法，但用在每栏标题前（中英标题是 `|` 短线，不拉通）。
4. **竖向节奏一致**：四栏必须严格等宽、严格同结构，**统一感是灵魂**。任何一栏高度不一致就破功。
5. **双语对照式标题**：中文大 + 英文小（与 L15 中文大英文小同款节奏），保持品牌一致。

## 配色归一（骨架提示，不锁颜色）

| 结构角色 | 实现方式 |
|---------|----------|
| 页眉 kicker | `.slide-header .kicker` 自带 `var(--c-accent-deep)`，不用另写 |
| 标题区中文大标 | `var(--c-ink-deep)` 极深 |
| 标题区中文副标 | `var(--c-ink-soft)` 浅灰 |
| 每栏图片 | ImageGen 按 deck palette |
| 中文标题 | `var(--c-ink-deep)` |
| 英文标题 | `var(--c-ink-soft)` |
| 描述文字 | `var(--c-ink)` 中 |
| 竖线 | `var(--c-accent)` 或 `var(--c-hairline)` |
| 整体底色 | `var(--c-card)` 纯白 |

## CSS 骨架

```css
/* 四栏矩阵陈列（模块名走全平台统一的 .slide-header，这一版没有自己的顶 header） */
.l16-wrap{position:absolute;inset:0;padding:40px 64px;display:flex;flex-direction:column;background:var(--c-card)}
.l16-title{margin-bottom:32px}
.l16-title h2{font-family:var(--serif);font-size:40px;font-weight:800;color:var(--c-ink-deep);line-height:1.1;margin-bottom:10px}
.l16-title p{font-size:14px;color:var(--c-ink-soft)}
.l16-grid{flex:1;display:grid;grid-template-columns:repeat(4,1fr);gap:28px}
.l16-cell{display:flex;flex-direction:column}
.l16-cell-img{flex:0 0 70%;background:var(--c-bg-alt);border-radius:4px;overflow:hidden;margin-bottom:14px}
.l16-cell-img img{width:100%;height:100%;object-fit:cover;display:block}
.l16-cell-title{font-size:18px;font-weight:800;color:var(--c-ink-deep);padding-left:12px;border-left:2px solid var(--c-accent);margin-bottom:4px}
.l16-cell-title-en{font-size:12px;font-weight:600;color:var(--c-ink-soft);letter-spacing:2px;padding-left:12px;margin-bottom:14px}
.l16-cell-desc{font-size:13px;line-height:1.7;color:var(--c-ink);padding-left:14px}
.l16-cell-desc .en{font-size:11px;color:var(--c-ink-soft);font-style:italic;opacity:.8;margin-top:6px}
```

## build-part 结构模板

```html
<section class="slide">
  <div class="slide-inner">
  <!-- 左上角那行模块名（.slide-header）由代码统一贴，这里不要写 -->
  <div class="l16-wrap">
    <div class="l16-title">
      <h2>我们一起，将梦想实现</h2>
      <p>自 2014 年创立，蔚来便在全球招募……</p>
    </div>
    <div class="l16-grid">
      <div class="l16-cell">
        <div class="l16-cell-img"><img src="/ppt-cases/ph-3x4.svg" data-img-prompt="这一格要什么图（中文一句话）" alt=""></div>
        <div class="l16-cell-title">上海</div>
        <div class="l16-cell-title-en">SHANGHAI</div>
        <div class="l16-cell-desc">
          <p>蔚来国际……</p>
          <p class="en">NIO International...</p>
        </div>
      </div>
      <div class="l16-cell">…</div>
      <div class="l16-cell">…</div>
      <div class="l16-cell">…</div>
    </div>
  </div>
  </div>
</section>
```

## 图槽位

- **N 张等宽图**（必填）：`pXX_c1/c2/c3/c4`，建议 mode `case`（场景/建筑/产品图），**所有图色调统一**（同 deck palette）
- 长宽比：建议 3:4 或 4:5 竖版（800×1066 或 800×1000），与文字区 70/30 比例匹配
- 关键选材：每张图选材应**保持构图风格一致**（全为建筑/全为产品/全为场景），**严禁混搭**（一栏建筑一栏人物）

## 变体

| 变体 | 调整点 | 适用 |
|------|--------|------|
| V1 · 三栏 | 1fr×3 | 三大支柱 |
| V2 · 五栏 | 1fr×5 | 五大门店/五大产品 |
| V3 · 六栏 | 1fr×3 双行 | 六大城市/六大产品 |
| V4 · 图文比 50/50 | 图 50%/文字 50% | 信息密度更高 |
| V5 · 图文比 80/20 | 图 80%/文字 20% | 杂志风/视觉主导 |
| V6 · 加 kicker | 标题区加品牌色 kicker | 章节扉页型 |
| V7 · 加底部页脚 | 矩阵下加底部品牌色带 | 与 L12 出血色带呼应 |
| V8 · 卡片化 | 每栏加圆角边框+阴影 | 强调独立单元感 |
| V9 · 数字编号 | 每栏前加大数字(01/02/03/04) | 阶段/路线矩阵 |
| V10 · 双语单列 | 每栏删英文标题 | 全中文场景 |

## 与 L11/L15 的差异

| 维度 | L11 | L15 | L16 |
|------|-----|-----|-----|
| 主体 | 三栏并列叙事 | 三栏文字 | 四栏矩阵 |
| 顶部 | 标题白字叠在图上 | 上 40% hero | 只有 `.slide-header` 那句 kicker |
| 单元结构 | 图叠字+大数字 | 中文+英文段 | 图+中英标题+双语描述 |
| 文字与图比 | 图 100% | 图 0% | 图 70%/文字 30% |
| 气质 | 商业广告/路演 | 商务克制 | 纸面陈列/杂志风 |
| 适用 | 路径/案例对比 | 价值观/三大支柱 | 矩阵陈列/项目集 |

> L16 是 L11 的"展柜版"：去掉了大数字锚点和渐变蒙版，让每张图独立干净地"陈列"出来。**适合需要安静展示的场景。**

## build-part 注意事项

- **不要包 `.slide-inner`**：`.l16-wrap` 自己是 `absolute inset:0` 且带了 padding，再套一层
  140px padding 出来是一块缩在中间的小矩阵，而页面渲染完全正常
- 四栏严格等宽 `repeat(4, 1fr)`，**严禁自定义列宽**（破坏矩阵感）
- 图色调统一是关键——所有图走 `filter: saturate(.92) contrast(1.05)` 等统一处理
- 单元高度差最多 8px，否则视觉不齐
- 模块名只写在 `.slide-header` 里，不在 `.l16-wrap` 里再写一条

## design 提示

- 视觉中重，矩阵陈列感强，前后页用 L7/L13/L2 缓冲
- 与 L11/L15 区别：L11 是"商业路演"风（数字+渐变），L15 是"商务克制"风（白底+纯文字+竖线），L16 是"纸面陈列"风（图片主导+统一矩阵）
- 单元 N 数 = 4 是默认；如需 3/5/6 栏，用 V1/V2/V3 变体
