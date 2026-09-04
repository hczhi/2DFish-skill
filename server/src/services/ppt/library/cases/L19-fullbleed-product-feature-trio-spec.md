# L19 · `fullbleed-product-feature-trio-spec`

> 全幅暗 bg 产品图 + 左上标题 + 中央产品 + 底部 3 白卡参数

**截图原件**：`cases/img/L19-ref.png`（DJI FLIGHT LOG · Wide-Angle Camera 产品规格页）

---

## 一、适用场景

- **产品参数 / 规格页**（强产品风）：3 个核心参数（焦段/光圈/变焦/尺寸等）一目了然
- **产品功能介绍页**：单产品 + 3 个卖点
- **设备/器材/技术规格页**：相机、镜头、汽车、工具
- ❌ 不适合：品牌主张（用 L18）、系列入口（用 L17）、数据展示（用 L4）、多产品对比（用 L11）

---

## 二、结构拆解（由上至下）

### 整体 16:9 全幅图（不包 `.slide-inner`）

1. 全幅背景图（**产品场景图**——产品在环境中飞行/行驶/工作的全景）
2. 顶部通栏：左侧 logo + 小标（如 "DJI · FLIGHT LOG"），右侧空
3. 左上：产品类目标题（"Wide-Angle Camera" 等产品类别名）
4. 左上副标：技术小标（"Image Sensor | 1-inch CMOS, 50 MP effective pixels"）
5. 中央偏左：产品图（飞行器/相机/汽车——可与背景融合也可独立）
6. 左下：长段技术描述（3–4 行，浅色小字）
7. 底部：3 个等宽白色规格卡（参数主标 + 参数小标）

### 顶部通栏

- 左：logo + 小标（"DJI · FLIGHT LOG" 用小字，logo 可以是文字 logo 或 img）
- 字号：logo 16–20px，小标 13–16px，间距 12–16px

### 左上标题区

- 主标（"Wide-Angle Camera" 等产品类别名）：48–64px 浅色（白色/brand），无衬线粗体
- 副标（技术细节，pipe 分隔的"参数列表"）：14–18px 浅灰，行高 1.4
- 主标与副标间距 8–14px

### 中央产品图

- 产品独立 cut-out 图（PNG 透明底或半透明 PNG），尺寸约占幻灯片 35–50% 宽
- 位置：中央偏左 1/3（视觉重心在左半）
- 允许产品图与背景图**前后景融合**（产品飞行在山谷/行驶在公路上）

### 左下长段描述

- 4–6 行技术描述段（"The 1-inch primary camera with f/1.8 aperture..." 风）
- 字号 16–20px 浅色，行高 1.6
- 最大宽度 ≤ 50%（避免与产品图重叠）

### 底部 3 白卡

- 3 张白色矩形卡片（4px 圆角，可选 1px 浅灰描边）
- 卡片高度 80–100px，等宽，间距 16–24px
- 卡片内容：
  - 上：参数主标（"24mm" / "f/1.8" / "1-2.9x"），24–32px 粗体深色
  - 下：参数小标（"Equivalent Focal Length" / "Aperture" / "Digital Zoom"），11–13px 浅灰

---

## 三、视觉手法（结构信号）

| 手法 | 作用 | 何时去掉 |
|------|------|----------|
| **全幅暗 bg + 中央产品** | 营造"产品在场景中"沉浸感 | 改成 V2 浅底 + 产品居中（更电商风） |
| **左上标题 + 左下描述** | "参数列表+详细说明" 上下分置 | 改成 V3 中央标题（更杂志感） |
| **底部 3 白卡** | 3 个核心参数一目了然 | 改成 V4 5 卡片 / V5 无卡片（参数融进描述） |
| **产品与背景融合** | 视觉连贯 | 改成 V6 产品独立（不与背景融合） |
| **白卡浮在暗 bg 上** | 强对比，数据易读 | 改成 V7 半透磨砂卡（更克制） |

---

## 四、配色归一表

| 截图原色 | 归一变量 | 出现位置 |
|----------|----------|----------|
| 暗灰 bg（山谷） | `var(--c-bg)` 或图本身 | 全幅 bg |
| 浅色标题（白） | `#fff` | 主标"产品类别名" |
| 浅灰副标 | `rgba(255,255,255,.78)` | 技术副标 + 长段描述 |
| 白色卡片底 | `var(--c-card)` | 底部 3 白卡 |
| 深色卡片主标 | `var(--c-ink-deep)` | 卡片"24mm"等参数 |
| 浅灰卡片小标 | `var(--c-ink-soft)` | 卡片小标 |

> **铁律**：暗 bg 上文字必须浅色；亮卡上文字必须深色。亮卡那一套是 `var(--c-ink-deep)` / `var(--c-ink-soft)`（暗底上的字直接写 `#fff` / `rgba(255,255,255,.78)`，不走变量）。

---

## 五、CSS 骨架

```css
/* L19 · 全幅暗 bg + 左上标题 + 中央产品 + 底部 3 白卡 */
.l19-wrap{position:absolute;inset:0;overflow:hidden;}
.l19-bg img{width:100%;height:100%;object-fit:cover;}
.l19-bg::after{content:'';position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.15) 0%,rgba(0,0,0,.35) 60%,rgba(0,0,0,.7) 100%);}
.l19-logo{position:absolute;top:32px;left:32px;color:#fff;font-size:18px;letter-spacing:.16em;font-weight:600;z-index:2;}
.l19-logo small{display:block;font-size:13px;margin-top:4px;font-weight:400;letter-spacing:.12em;opacity:.8;}
.l19-title{position:absolute;top:18%;left:5%;max-width:55%;z-index:2;color:#fff;}
.l19-title h1{font-size:clamp(40px,5vw,64px);font-weight:600;letter-spacing:-.005em;line-height:1.1;margin-bottom:12px;}
.l19-title .sub{font-size:15px;color:rgba(255,255,255,.75);letter-spacing:.04em;}
.l19-product{position:absolute;top:30%;left:18%;width:64%;z-index:1;pointer-events:none;}
.l19-product img{width:100%;height:auto;filter:drop-shadow(0 8px 28px rgba(0,0,0,.45));}
.l19-desc{position:absolute;bottom:18%;left:5%;max-width:48%;font-size:16px;color:rgba(255,255,255,.85);line-height:1.6;z-index:2;}
.l19-specs{position:absolute;bottom:5%;left:5%;right:5%;display:grid;grid-template-columns:repeat(3,1fr);gap:18px;z-index:3;}
.l19-spec{background:var(--c-card);padding:18px 22px;border-radius:4px;min-height:84px;}
.l19-spec .v{font-size:30px;font-weight:700;color:var(--c-ink-deep);line-height:1;letter-spacing:-.01em}
.l19-spec .k{font-size:12px;color:var(--c-ink-soft);margin-top:8px;letter-spacing:.04em}
```

---

## 六、build-part 结构模板

```html
<section class="slide">
  <!-- 包装层是 section 里的第一个 div，不要把 l19-wrap 加到 <section> 上 -->
  <div class="l19-wrap">
    <!-- 全幅 bg + 产品图 -->
    <div class="l19-bg"><img src="/ppt-cases/ph-16x9.svg" data-img-prompt="这一格要什么图（中文一句话）" alt=""></div>
    <div class="l19-product"><img src="/ppt-cases/ph-16x9.svg" data-img-prompt="这一格要什么图（中文一句话）" alt=""></div>

    <!-- 顶部 logo -->
    <div class="l19-logo">{{brand_text}}<small>{{series_text}}</small></div>

    <!-- 左上标题 -->
    <div class="l19-title">
      <h1>{{feature_title}}</h1>
      <div class="sub">{{feature_subline}}</div>
    </div>

    <!-- 左下描述 -->
    <div class="l19-desc">{{feature_desc}}</div>

    <!-- 底部 3 白卡 -->
    <div class="l19-specs">
      <div class="l19-spec">
        <div class="v">{{spec1_value}}</div>
        <div class="k">{{spec1_key}}</div>
      </div>
      <div class="l19-spec">
        <div class="v">{{spec2_value}}</div>
        <div class="k">{{spec2_key}}</div>
      </div>
      <div class="l19-spec">
        <div class="v">{{spec3_value}}</div>
        <div class="k">{{spec3_key}}</div>
      </div>
    </div>
  </div>
</section>
```

> **design 提示**：产品图用 PNG 透明底效果最好（不会与背景"打架"），如果只能用 JPG 抠图，建议加 `filter: drop-shadow` 增加产品立体感。

---

## 七、图槽位

- `pXX_hero`（必填 · 1 个） · 全幅场景图，1920×1080，**产品在场景中的全景**（飞行器飞过山谷 / 汽车行驶在公路 / 相机放在桌面上被相机拍着）。禁用纯产品白底图与人物特写
- `pXX_product`（必填 · 1 个） · 产品 cut-out 图，**PNG 透明底**最佳，**1600×900 宽高比约 16:9**，可用 JPG 但需用 `mix-blend-mode: lighten` 配合

---

## 八、变体（6 个）

- **V1 镜像**：标题改右上，描述改右下（适合产品从左到右的视觉动线）
- **V2 浅底**：去掉全幅图，背景改浅米/纯白（电商风/规格表风）
- **V3 中央标题**：标题移到中央顶部，描述和产品图在中央（更杂志感）
- **V4 5 卡片**：底部 3 卡改 5 卡（适合参数较多）
- **V5 无卡片**：把 3 个参数融进左上描述或左下正文（更克制）
- **V6 产品独立**：产品图不与背景融合，独立浮在暗 bg 中央
- **V7 半透磨砂卡**：白卡改 `rgba(255,255,255,.15)` 配 `backdrop-filter: blur(10px)`（更克制）
- **V8 2 卡片**：3 卡改 2 卡（适合 2 个核心参数）

---

## 九、design 提示

- **视觉**：重（暗 bg + 产品大图 + 白卡对比，气场强）
- **是否全幅**：是（**不包 `.slide-inner`**，与 L11/L13/L18/L21/L22 同级 fullbleed）
- **build-part 决策**：section 标注 `fullbleed:true`，build-part 决定性跳过 `.slide-inner` 包裹
- **关键约束**：
  - 3 个白卡必须等宽，间距一致
  - 卡片参数主标字号 ≥ 24px（太小在大屏上会糊）
  - 产品图必须 PNG 透明底（如果只能 JPG 抠图，必须用 mix-blend-mode 适配）
  - 左上标题与产品图不能视觉打架（产品图位置避开头标题区域）
  - 底部白卡与暗 bg 的对比是版式灵魂，禁止改成半透卡

---

## 十、气质关键词

- 产品风 · 规格页 · 沉浸感 · 数据易读 · 高级感
- 适合：电子产品、汽车、家电、工具、设备规格页

---

> 与 L13 区别：L13 是"全幅+居中大标题+引号"；L19 是"全幅+左上产品标题+中央产品+底部参数"，是"产品+参数"版式。
> 与 L18 区别：L18 是"全幅+双语双标题+暗蒙版三栏"；L19 是"全幅+产品标题+产品图+底部白卡参数"，是"产品+规格"版式。
> 与 L21 区别：L21 是"全幅+左文+右数据栏"；L19 是"全幅+左上标题+中央产品+底部白卡"，L19 有"产品视觉主体"，L21 无产品图。
