# L31 · `photo-band-float-card`（全幅：上部浅底标题 + 下部横贯图带 + 压在图上的浮白卡）

> **📄 详情**：本文件供 design 阶段匹配到 L31 时**必读**。
> **★ 核心原则**：结构是灵魂，颜色/内容不绑死。所有配色必须用 `var(--c-*)` 变量。

---

## 一、结构速览

- **比例**：16:9，上浅下图，信息密度中偏低（一句主张 + 一张卡 + 一个数）
- **核心手法**：① 上部浅底标题区（`.l31-head`，58px 标题 + 一段 20px 引导），**左右到页边**、不套卡片；② 下部一条**横贯到页边的图带**（`.l31-band`，占剩余全部高度），左侧一层左浓右淡的暗蒙版；③ 一张**浮白卡**（`.l31-card`，660px 宽，品牌色顶边 + 大投影）压在图带左下；④ 右下角一个大数字（`.l31-meta`，白字）
- **是否全幅**：**是** —— 内容不包 `.slide-inner`（图带要贴到页面左右边）
- **当章节页或"一个主张 + 一个证据"页用**：图带是气氛，白卡是那句主张的落地，右下的数字是唯一的量化
- **底色**：默认不加类（上半仍是 deck 底色）

---

## 二、结构拆解（由上至下）

### 1. 标题区 · `.l31-head`

- 标题**必须写成 `<h1 class="page-title">`**（页脚目录面板靠它取标题；这一页没有别的标题）。
- 内边距写成 `var(--pad-top) var(--pad-x) 0`：写死像素的话疏密档在这一页上一个像素都不动，而页面照样渲染。
- `<p>` 一段引导（≤ 60 字）。不需要就整行删掉。

### 2. 图带 · `.l31-band`

- `flex:1` 吃掉标题以下的**全部高度**并贴到页面左右边（这是这一条要全幅的唯一原因）。
- 蒙版**左浓右淡**（`.5 → 0`）：白卡在左，右边留亮。
- 没有配图时这一条不成立，请改用 L1 / L27 —— 图带是它的结构主体。

### 3. 浮白卡 · `.l31-card`

- **是 `.l31-wrap` 的绝对定位子元素，不是 `.l31-band` 的子元素**：放进图带里的话会被 `overflow:hidden` 连投影一起切掉，看起来像"卡片没浮起来"，而页面照样渲染。
- 三块：`<h3>`（小标题）+ `<p>`（2–4 行）+ `<b>`（一句收口，品牌深色，独占一行）。
- 卡宽 660px 写死，`left:var(--pad-x)` 对齐上面的标题左缘 —— 改成 `left:0` 的话它和标题差 140px，看着像没对齐（画面上很难一眼指出来）。

### 4. 右下数字 · `.l31-meta`

- `<strong>`（一个数，64px）+ `<span>`（一行单位/口径）。**只放一个数**：两个数就和白卡抢主角，而这一页的主角是白卡里那句话。
- 不需要就整块删掉。

---

## 三、CSS 骨架

```css
/* L31 横贯图带 + 浮白卡（全幅） */
.l31-wrap{position:absolute;inset:0;overflow:hidden;display:flex;flex-direction:column}
.l31-head{padding:var(--pad-top) var(--pad-x) 0}
.l31-head .page-title{font-family:var(--sans);font-size:58px;font-weight:800;line-height:1.16;letter-spacing:-.01em;color:var(--c-ink-deep);max-width:1200px;margin-top:0}
.l31-head p{margin-top:16px;font-size:20px;line-height:1.7;color:var(--c-ink);max-width:1000px}
.l31-band{position:relative;flex:1;margin-top:36px;overflow:hidden}
.l31-band img{width:100%;height:100%;object-fit:cover;display:block}
.l31-band::after{content:"";position:absolute;inset:0;background:linear-gradient(90deg,rgba(0,0,0,.5) 0%,rgba(0,0,0,.16) 46%,rgba(0,0,0,0) 74%)}
.l31-card{position:absolute;left:var(--pad-x);bottom:56px;z-index:3;width:660px;padding:32px 36px;background:var(--c-card);border-top:5px solid var(--c-brand);box-shadow:0 26px 60px rgba(0,0,0,.24)}
.l31-card h3{font-size:30px;font-weight:800;line-height:1.3;color:var(--c-ink-deep);margin-bottom:14px}
.l31-card p{font-size:19px;line-height:1.8;color:var(--c-ink)}
.l31-card b{display:block;margin-top:16px;font-size:21px;font-weight:800;color:var(--c-brand-deep)}
.l31-meta{position:absolute;right:var(--pad-x);bottom:74px;z-index:3;text-align:right;color:#fff}
.l31-meta strong{display:block;font-family:var(--num);font-size:64px;font-weight:800;line-height:1}
.l31-meta span{display:block;margin-top:10px;font-size:19px;color:rgba(255,255,255,.82)}
```

---

## 四、build-part 结构模板

```html
<section class="slide" data-layout="L31">
  <div class="l31-wrap">
    <div class="l31-head">
      <h1 class="page-title">{{标题，一句判断句}}</h1>
      <p>{{一段引导，≤ 60 字；不需要就整行删掉}}</p>
    </div>
    <div class="l31-band">
      <img src="/ppt-cases/ph-16x9.svg" alt="" data-img-prompt="横贯图带配什么（中文一句话，横构图、主体在右半张、左边留大面积低对比区）" data-img-mode="case">
      <div class="l31-card">
        <h3>{{小标题}}</h3>
        <p>{{2–4 行说明}}</p>
        <b>{{一句收口}}</b>
      </div>
      <div class="l31-meta">
        <strong>{{一个数}}</strong>
        <span>{{单位或口径}}</span>
      </div>
    </div>
  </div>
</section>
```

---

## 五、图槽位

| 槽位 | 必填? | 模式 | 比例 | 构图要求 |
|------|-------|------|------|----------|
| `pXX_band` | **必填**（图带是这一条的结构主体） | case | 16:9 | 横贯图带（约 1920×620，`cover` 裁切）：**主体在右半张**，左边要有大面积低对比区（白卡压在那儿），右下角别有要看的细节（大数字在那儿）；不要带文字 |

**禁用**：竖构图、主体在左半张的图（被白卡盖住）、细节密集的图表截图

---

## 六、变体

| 编号 | 变化 | 用途 |
|------|------|------|
| V1 | 白卡放右（`right:var(--pad-x)` + 蒙版方向反过来 + 数字挪到左下） | 图的主体在左半张 |
| V2 | 去掉右下数字 | 没有可量化的东西 |
| V3 | 白卡改反色（`background:var(--c-ink-deep)` + 白字） | 要更重 |
| V4 | 去掉标题区的 `<p>`，标题写两行 | 标题本身就说完了 |
| V5 | 图带高度收一半（`flex:0 0 46%`），下面补一行三列小字 | 还有三条要交代 |

---

## 七、design 提示

- **视觉中等**（上半浅、下半图），适合放在两页密集页之间，也适合当章节页
- **白卡的位置是结构签名**：它压在图带上、顶边一条品牌色 —— 挪进 `.l31-band` 里或去掉投影之后，这一页就变成"上文下图"的普通分屏
- **配色**：卡底 `var(--c-card)` + `var(--c-brand)` 顶边、收口句 `var(--c-brand-deep)`；图上的字直接写 `#fff` / `rgba(255,255,255,.82)`，**不要用 `var(--c-ink-soft)`**（在图上糊）
- **与 L3 的区别**：L3 是左文右图 50/50（图有边界），L31 的图**横贯到页边**、文字压在图上
- **与 L20 的区别**：L20 是左右 30/70 grid，L31 是上下切 + 一张浮卡跨在接缝上
- **与 L21 的区别**：L21 整页暗底、左右两块浮信息，L31 上半是浅底
