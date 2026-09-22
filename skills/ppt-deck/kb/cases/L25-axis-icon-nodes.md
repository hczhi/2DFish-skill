# L25 · `axis-icon-nodes`（报告风标题条 + 横轴四节点「上标签 / 圆形图片 / 下描述」+ 结论条）

> **📄 详情**：本文件供 design 阶段匹配到 L25 时**必读**。
> **★ 核心原则**：结构是灵魂，颜色/内容不绑死。所有配色必须用 `var(--c-*)` 变量。

---

## 一、结构速览

- **比例**：16:9，纯浅底（不配整页图），信息密度低（每节点只有一个标签 + 一句）
- **核心手法**：① 顶部报告风标题条（`.rp-head`）；② 中部一条**贯穿的细横线**，四个圆形图片压在线上（`.l25-dot`，128px 圆，图**铺满整个圆**：`cover` + `border-radius:50%` + `overflow:hidden`）；③ 线**上方**是阶段名（`.l25-stage`，28px 粗），线**下方**是这一段做什么（`.l25-desc`，19px 两行）—— 三层严格对齐是这一条的签名；④ **末节点用 `.on` 高亮**（那一段是重点，或者是"例外情况"）；⑤ 底部结论条（`.rp-foot`）
- **是否全幅**：否 —— 全部内容包在 `.slide-inner` 里
- **轴线是每个节点自己画的**（`.l25-node::before`，首尾各收半格到圆心），所以 `top:160px` 和上面三个写死的高度绑在一起：`40`（标签行高）+ `56`（间距）+ `64`（圆的一半）。改字号或圆的直径忘了改它的话，线会横穿图片或飘在标签上，而页面照样渲染、一处都不报错。
- **底色**：默认不加类

---

## 二、结构拆解（由上至下）

### 1. 标题条 · `.rp-head`

- 标题**必须写成 `<h1 class="page-title">`**（页脚目录面板靠它取标题；换掉之后那一页在目录里只剩一个页码，画面完全正常）。
- 标题要写出**这条轴是什么轴**（"同一份 deck，在不同阶段扮演不同角色"），不要只写"流程"。

### 2. 四节点 · `.l25-axis` > `.l25-node` × 4

- `.l25-stage`（阶段名，2–6 字，**一行**，高度写死 40px 所以换行会把轴线顶歪）
- `.l25-dot` > `<img>`（**铺满整个圆的图**：`width/height:100%` + `object-fit:cover`，圆由 `.l25-dot` 的 `border-radius` + `overflow:hidden` 裁出来）—— 不是居中的小图标，少了 `overflow:hidden` 就是一张方图压在圆环上
- 图是圆形裁切的：选图要**主体在正中、四角可丢**（人脸/单一物体/近景），四张必须同一路调性；没有图时整个 `<img>` 删掉即可（回落成纯色圆）
- `.l25-desc`（这一段做什么，≤ 2 行、≤ 24 字）
- 高亮那一节点加 `.on`（品牌色标题 + 品牌色圆环 + 暖底）。**只能一个**，通常是最后一个（"没有 X 的时候怎么办"）。

### 3. 结论条 · `.rp-foot`

- 一句"所以每一段该用哪种做法"，关键半句 `<b>`。

---

## 三、CSS 骨架

```css
/* 报告风共用：标题条 + 结论条 */
.rp-head{padding-bottom:20px;border-bottom:2px solid var(--c-ink-deep)}
.rp-head .page-title{font-family:var(--sans);font-size:52px;font-weight:800;color:var(--c-ink-deep);line-height:1.18;letter-spacing:-.01em;margin-top:0}
.rp-head .lead{font-size:20px;line-height:1.7;color:var(--c-ink);margin-top:18px;max-width:1180px}
.rp-foot{margin-top:auto;padding-top:20px;border-top:1px solid var(--c-hairline);font-size:21px;line-height:1.6;color:var(--c-ink-deep)}
.rp-foot b{font-weight:800;color:var(--c-brand-deep)}
/* L25 横轴四节点 */
.l25-axis{flex:1;display:grid;grid-template-columns:repeat(4,1fr);align-content:center;margin:44px 0 32px}
.l25-node{position:relative;text-align:center;padding:0 18px}
.l25-node::before{content:"";position:absolute;top:160px;left:0;right:0;height:1.5px;background:var(--c-ink-deep);opacity:.28}
.l25-node:first-child::before{left:50%}
.l25-node:last-child::before{right:50%}
.l25-stage{height:40px;font-size:28px;font-weight:800;color:var(--c-ink-deep);letter-spacing:.02em}
.l25-node.on .l25-stage{color:var(--c-brand-deep)}
.l25-dot{position:relative;z-index:2;width:128px;height:128px;margin:56px auto 0;border-radius:50%;overflow:hidden;background:var(--c-card);border:1.5px solid var(--c-hairline);display:flex;align-items:center;justify-content:center}
.l25-node.on .l25-dot{border-color:var(--c-brand);background:var(--card-o);box-shadow:0 0 0 8px var(--hl-o)}
.l25-dot img{width:100%;height:100%;object-fit:cover;display:block}
.l25-desc{font-size:19px;line-height:1.75;color:var(--c-ink);margin-top:26px}
```

---

## 四、build-part 结构模板

```html
<section class="slide" data-layout="L25">
  <div class="slide-inner">
    <div class="rp-head">
      <h1 class="page-title">{{标题，写出这条轴是什么轴}}</h1>
    </div>
    <div class="l25-axis">
      <div class="l25-node">
        <div class="l25-stage">{{阶段名}}</div>
        <div class="l25-dot"><img src="/ppt-cases/ph-1x1.svg" alt="" data-img-prompt="这一段配什么图（中文一句话，主体在正中、会被裁成圆）" data-img-mode="case"></div>
        <div class="l25-desc">{{这一段做什么，≤ 2 行}}</div>
      </div>
      <div class="l25-node">
        <div class="l25-stage">{{阶段名}}</div>
        <div class="l25-dot"><img src="/ppt-cases/ph-1x1.svg" alt="" data-img-prompt="这一段配什么图（中文一句话，主体在正中、会被裁成圆）" data-img-mode="case"></div>
        <div class="l25-desc">{{这一段做什么，≤ 2 行}}</div>
      </div>
      <div class="l25-node">
        <div class="l25-stage">{{阶段名}}</div>
        <div class="l25-dot"><img src="/ppt-cases/ph-1x1.svg" alt="" data-img-prompt="这一段配什么图（中文一句话，主体在正中、会被裁成圆）" data-img-mode="case"></div>
        <div class="l25-desc">{{这一段做什么，≤ 2 行}}</div>
      </div>
      <div class="l25-node on">
        <div class="l25-stage">{{重点/例外那一段}}</div>
        <div class="l25-dot"><img src="/ppt-cases/ph-1x1.svg" alt="" data-img-prompt="这一段配什么图（中文一句话，主体在正中、会被裁成圆）" data-img-mode="case"></div>
        <div class="l25-desc">{{这一段做什么，≤ 2 行}}</div>
      </div>
    </div>
    <div class="rp-foot">{{所以每一段该用哪种做法 —— <b>关键半句加粗</b>}}</div>
  </div>
</section>
```

---

## 五、图槽位

| 槽位 | 必填? | 模式 | 比例 | 构图要求 |
|------|-------|------|------|----------|
| `pXX_n1` … `pXX_n4` | 可选（要么四张全有，要么全无） | case | 1:1 | **铺满 128px 圆的图**（`cover` + 圆形裁切）：主体正中、四角可丢、近景，四张必须同一路调性/色温；不要带文字 |

**禁用**：宽幅全景（圆里只剩中间一条）、主体偏一角的图（圆一裁就没了）、图表截图与四张风格不一（四个圆立刻散成四张不相关的图）

---

## 六、变体

| 编号 | 变化 | 用途 |
|------|------|------|
| V1 | 三节点（`repeat(3,1fr)`，描述可写 3 行） | 三阶段 |
| V2 | 五节点（`repeat(5,1fr)`，阶段名压到 4 字内） | 五步流程 |
| V3 | 圆里不放图（整个 `<img>` 删掉，纯色圆 + 品牌色圆环） | 找不到四张同一路调性的图时 |
| V4 | 描述上移到线上、阶段名下移（上下互换） | 阶段名很长时 |
| V5 | 去掉结论条，轴整体垂直居中 | 没有"所以怎么办" |
| V6 | 轴线改虚线（`background` 换成 `repeating-linear-gradient`） | 阶段之间不是强因果 |

---

## 七、design 提示

- **视觉中等偏轻**（一条线 + 四个圆形图），是这一族里最"透气"的一条，可以放在两页密集页之间当缓冲
- **阶段名必须一行**：高度写死 40px，换行会把整条轴线顶歪（线的位置是算出来的，不是跟着内容走的）
- **高亮只能一个节点**：两个以上就没有落点，读起来只是"这条轴颜色挺花"
- **配色**：轴线 `var(--c-ink-deep)` + `opacity:.28`（不要用 `var(--c-hairline)`，那个在浅底上太淡看不见），高亮走 `var(--c-brand)` / `var(--card-o)`
- **与 L6 的区别**：L6 是"轴线 + 节点卡片"（卡片挂在轴的一侧，信息量大），L25 是**三层严格对齐**（标签在线上、图标压线、描述在线下），信息量小但一眼看完
- **与 L11 的区别**：L11 是三栏全幅照片叠字的阶段叙事（视觉重），L25 是浅底线性时序 + 四个小圆形图（视觉轻）
