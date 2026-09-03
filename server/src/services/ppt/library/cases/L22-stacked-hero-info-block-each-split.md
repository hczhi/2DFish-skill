# L22 · `stacked-hero-info-block-each-split`（上下两段 + 每段各自左右分栏）

> **📄 详情**：本文件供 design 阶段匹配到 L22 时**必读**。
> **★ 核心原则**：结构是灵魂，颜色/内容不绑死。所有配色必须用 `var(--c-*)` 变量。

---

## 一、结构速览

- **比例**：16:9 上下分屏（顶底贴边，**不包 `.slide-inner`**）
- **核心手法**：① 上下两段（各 50%）；② 每段**内部分左右 1:1**；③ 上半左 = 木纹/材质大图叠白色品牌字；④ 上半右 = 浅米底 + "Brand summary" 标题 + 多段品牌信息；⑤ 下半左 = 副图标 + 副标题 + 文字；⑥ 下半右 = "品牌定位" 标题 + 描述段；⑦ 上下色温差异（上暖/图、下浅米/纯色）
- **是否全幅**：是（顶底贴边，**不包 `.slide-inner`**，与 L11/L13/L21 同 fullbleed 处理）
- **原色（仅供还原参考）**：木纹 hero / 白色品牌字 / 浅米底信息区 / hairline 分隔线

---

## 二、结构拆解（由上至下）

### 上半 50%（`.l22-upper`，grid 1fr 1fr）

**上半左 · `.l22-hero`**（材质/产品大图）
- `img` 全 cover
- `::after` 135deg 渐变（`transparent 50% → rgba(0,0,0,.25)`），让左下文字可读
- `.l22-hero-txt`（absolute bottom 48px left 48px，白色）
  - 中文品牌名（`.cn`，32–40px，weight 300，letter-spacing 0.04em）
  - 英文品牌名（`.en`，18px，margin-top 8px，letter-spacing 0.32em，weight 300）

**上半右 · `.l22-info`**（浅米底，padding 48px 56px，flex column center gap 14px）
- 小标题（`h3`，18px，weight 600，padding-bottom 8px，`border-bottom: 1px solid var(--c-hairline)`）
- 多行品牌信息（`.row`，14px，行高 1.8，可带 `<strong>` 加粗字段名）

### 下半 50%（`.l22-lower`，grid 1fr 1fr，`var(--c-card)` 底）

**下半左 · `.l22-lower-col`**（padding 48px 56px）
- 顶部小图标（`.icon`，24×24px，`var(--c-brand)`，margin-bottom 14px）
- 副标题（`h3`，18px，weight 600，margin-bottom 14px）
- 文字段（`p`，14px，`var(--c-ink-soft)`，行高 1.85）

**下半右 · `.l22-lower-col`**（padding 48px 56px，`border-left: 1px solid var(--c-hairline)`）
- 标题（"品牌定位"等，`h3`，18px，weight 600）
- 描述段（`p`，14px，行高 1.85）

---

## 三、CSS 骨架

```css
/* L22 上下两段 + 每段各自左右分栏 — 详情见 cases/L22-stacked-hero-info-block-each-split.md */
.l22-wrap{position:absolute;inset:0;display:flex;flex-direction:column;z-index:1;overflow:hidden}
.l22-upper{flex:1;display:grid;grid-template-columns:1fr 1fr;min-height:0}
.l22-hero{position:relative;overflow:hidden}
.l22-hero img{width:100%;height:100%;object-fit:cover;display:block}
.l22-hero::after{content:"";position:absolute;inset:0;background:linear-gradient(135deg,transparent 50%,rgba(0,0,0,.25));z-index:1}
.l22-hero-txt{position:absolute;bottom:48px;left:48px;color:#fff;z-index:2}
.l22-hero-txt .cn{font-size:36px;font-weight:300;letter-spacing:.04em}
.l22-hero-txt .en{display:block;font-size:18px;margin-top:8px;letter-spacing:.32em;font-weight:300}
.l22-info{background:var(--c-card);padding:48px 56px;display:flex;flex-direction:column;justify-content:center;gap:14px}
.l22-info h3{font-size:18px;font-weight:600;padding-bottom:8px;border-bottom:1px solid var(--c-hairline);color:var(--c-ink-deep)}
.l22-info .row{font-size:14px;color:var(--c-ink);line-height:1.8}
.l22-info .row strong{font-weight:600}
.l22-lower{flex:1;display:grid;grid-template-columns:1fr 1fr;background:var(--c-card);min-height:0}
.l22-lower-col{padding:48px 56px}
.l22-lower-col+.l22-lower-col{border-left:1px solid var(--c-hairline)}
.l22-lower-col .icon{width:24px;height:24px;color:var(--c-brand);margin-bottom:14px}
.l22-lower-col h3{font-size:18px;font-weight:600;margin-bottom:14px;color:var(--c-ink-deep)}
.l22-lower-col p{font-size:14px;color:var(--c-ink-soft);line-height:1.85}
```

---

## 四、build-part 结构模板

```html
<section class="slide" data-layout="L22">
  <div class="l22-wrap">
    <div class="l22-upper">
      <div class="l22-hero">
        <img src="/ppt-cases/ph-16x9.svg" data-img-prompt="这一格要什么图（中文一句话）" alt="">
        <div class="l22-hero-txt">
          <div class="cn">{{中文品牌名}}</div>
          <span class="en">{{ENGLISH BRAND}}</span>
        </div>
      </div>
      <div class="l22-info">
        <h3>Brand summary 品牌概括</h3>
        <div class="row"><strong>中文名：</strong>{{value}}</div>
        <div class="row"><strong>英文名：</strong>{{value}}</div>
        <div class="row"><strong>诞生年：</strong>{{value}}</div>
        <div class="row"><strong>创始人：</strong>{{value}}</div>
        <div class="row">{{品牌描述}}</div>
      </div>
    </div>
    <div class="l22-lower">
      <div class="l22-lower-col">
        <div class="icon">{{SVG图标}}</div>
        <h3>{{副标题}}</h3>
        <p>{{文字段}}</p>
      </div>
      <div class="l22-lower-col">
        <h3>品牌定位</h3>
        <p>{{品牌定位描述}}</p>
      </div>
    </div>
  </div>
</section>
```

---

## 五、图槽位

| 槽位 | 必填? | 模式 | 尺寸 | 构图要求 |
|------|-------|------|------|----------|
| `pXX_hero` | ✅ 必填 | case | 1920×1080 | 材质/产品/品牌主视觉大图（木纹/皮革/金属/包装特写），暖色调 |
| `pXX_sub` | ⚪ 可选 | case | 1920×1080 | 下半左副图（如启用 V4 双栏变体），与 hero 同色系 |

**禁用**：人物 closeup、抽象插画、数据图表

---

## 六、变体

| 编号 | 变化 | 用途 |
|------|------|------|
| V1 | 上 40 下 60 | 信息为主 |
| V2 | 上 60 下 40 | hero 为主 |
| V3 | 上左右镜像（图右文左） | 视觉重心右移 |
| V4 | 下加双栏（再分左右，共 4 块） | 信息更多 |
| V5 | 上下统一浅米色 | 极简一致 |
| V6 | 上 hero 加底部 cta 按钮 | 引导行动 |
| V7 | 顶部加 kicker 条 | 章节标识 |

---

## 七、design 提示

- **视觉中等**：双模块分散视觉重心，前后页用 L7/L11/L13 缓冲
- **色温铁律**：上下色温必须有差异（上暖/图、下浅米/纯色），是版式气质的核心
- **字号铁律**：上半 hero 字 32–40px 偏细体（与 L13 的 96px 衬线重磅形成对比）；下半小标 18px + hairline 底线是气质信号
- **配色**：仅 `var(--c-brand)` 用于下半图标；hero 字纯白
- **与 L14 的区别**：L14 是"上 hero + 下双栏信息"单段式，L22 是"上下两段 + 每段各自左右分"双段式，信息密度更高
- **与 L15 的区别**：L15 是"上 hero 极小字 + 下纯白三栏"克制风，L22 是"双模块组合"叙事风
- **与 L16 的区别**：L16 是顶 header + 四栏矩阵陈列，L22 是上下两段各分左右
