# L26 · `contrast-duo-quote-icon-row`（对比双条（浅底 vs 反色）+ 竖线引用 + 底部四栏图卡）

> **📄 详情**：本文件供 design 阶段匹配到 L26 时**必读**。
> **★ 核心原则**：结构是灵魂，颜色/内容不绑死。所有配色必须用 `var(--c-*)` 变量。

---

## 一、结构速览

- **比例**：16:9，浅底 + 底部四张卡片底图，信息密度高（这一族里最满的一条）
- **核心手法**：三层由重到轻堆下来 —— ① 顶部报告风标题条（`.rp-head`）；② **对比双条**：左浅底 `.l26-a` / 右反色 `.l26-b`（深底白字），一对概念摆在同一行做区分；③ **竖线引用**（`.l26-quote`，左边 5px 品牌色竖线 + 30px 粗体一句），把上面那对区分收成一句判断；④ 底部**四栏图卡**（`.l26-row`），每格是**一张铺满卡片的底图**（上淡下浓的蒙版，文字压在卡片下缘）+ 层次名 + 一行说明，其中一格 `.on` 高亮
- **是否全幅**：否 —— 全部内容包在 `.slide-inner` 里
- **三层的关系是"区分 → 判断 → 展开"**，不是三块并列内容。顺序换了（比如把四栏放中间）这一条就散成三段没关系的东西，而每一段单看都正常
- **底色**：默认不加类

---

## 二、结构拆解（由上至下）

### 1. 标题条 · `.rp-head`

标题**必须写成 `<h1 class="page-title">`**（页脚目录面板靠它取标题；换掉之后那一页在目录里只剩一个页码，画面完全正常）。

### 2. 对比双条 · `.l26-duo` > `.l26-a` + `.l26-b`

- 每条 = `<h3>`（概念名，26px 粗）+ `<p>`（一句定义，≤ 30 字）。
- **右边那条是反色的**（`var(--c-ink-deep)` 底 + 白字）：反色的那一条读成"更重的 / 包含关系里更上层的那一个"。两条都浅底的话这层对比消失，看起来只是"两个说明框"。
- 只能两条。三个概念请用 L15 / L30。

### 3. 竖线引用 · `.l26-quote`

- 一句 30px 粗体判断，前后不加引号也成立（竖线本身就是引用信号）。
- **不要写成两句**：这一层的作用是收口，两句就变成正文段。
- 页面剩余的空白由它的 `margin:auto 0` 吃掉（上下各一半），所以它是浮在中段的。改成 `flex:1` 的话那条竖线会被拉到三四百像素高；把 `margin-top:auto` 挪到 `.l26-cap` 上的话空白全落在它下面，引用贴着双条、页面中段空一块 —— 两种都照样渲染、一处都不报错。

### 4. 四栏图卡 · `.l26-cap` + `.l26-row` > `.l26-cell` × 4

- `.l26-cap`：一行小灰字，说下面这四格**是什么的四层/四类**（"一个模板可组合多个可复用层次"）。这一层靠"自己是最后一块 + 上面的引用吃掉了空白"落在页面底部，不要再给它加 `margin-top:auto`。
- 每格 = `.l26-bg`（**铺满卡片的底图**，必须是第一个孩子）+ `<b>`（层次名）+ `<span>`（一行说明，≤ 14 字）。
- 蒙版是**上淡下浓**的（`.40 → .96`），文字靠 `justify-content:flex-end` 压在卡片下缘 —— 上半张露图、下半张给字。反过来的话 17px 灰字压在照片上，那个尺寸读不出来。
- 没有配图时整个 `.l26-bg` 那一行删掉即可（卡片回落纯色底）。**四格要么都有图，要么都没有**。
- 高亮那一格加 `.on`（暖底 + 品牌色描边），**只能一格**。

---

## 三、CSS 骨架

```css
/* 报告风共用：标题条 + 结论条 */
.rp-head{padding-bottom:20px;border-bottom:2px solid var(--c-ink-deep)}
.rp-head .page-title{font-family:var(--sans);font-size:52px;font-weight:800;color:var(--c-ink-deep);line-height:1.18;letter-spacing:-.01em;margin-top:0}
.rp-head .lead{font-size:20px;line-height:1.7;color:var(--c-ink);margin-top:18px;max-width:1180px}
/* L26 对比双条 + 引用 + 四栏图卡 */
.l26-duo{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:34px}
.l26-a{background:var(--bg-plain);border:1px solid var(--c-hairline);padding:26px 30px}
.l26-b{background:var(--c-ink-deep);padding:26px 30px}
.l26-duo h3{font-size:26px;font-weight:800;color:var(--c-ink-deep);margin-bottom:10px}
.l26-duo p{font-size:19px;line-height:1.7;color:var(--c-ink)}
.l26-b h3{color:var(--c-card)}
.l26-b p{color:rgba(255,255,255,.8)}
.l26-quote{margin:auto 0;padding:6px 0 6px 26px;border-left:5px solid var(--c-brand);font-size:30px;font-weight:700;line-height:1.55;color:var(--c-ink-deep)}
.l26-cap{padding-top:34px;font-size:17px;color:var(--c-ink-soft)}
.l26-row{display:grid;grid-template-columns:repeat(4,1fr);gap:22px;margin-top:14px}
.l26-cell{position:relative;z-index:0;overflow:hidden;border:1px solid var(--c-hairline);background:var(--c-card);padding:22px 24px;min-height:200px;display:flex;flex-direction:column;justify-content:flex-end}
.l26-cell.on{background:var(--card-o);border-color:var(--c-brand)}
.l26-bg{position:absolute;inset:0;z-index:-1}
.l26-bg img{width:100%;height:100%;object-fit:cover;display:block}
.l26-bg::after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgba(var(--mask-rgb),.40) 0%,rgba(var(--mask-rgb),.86) 56%,rgba(var(--mask-rgb),.96) 100%)}
.l26-cell b{display:block;font-size:22px;font-weight:800;color:var(--c-ink-deep)}
.l26-cell span{display:block;font-size:17px;line-height:1.6;color:var(--c-ink-soft);margin-top:8px}
```

---

## 四、build-part 结构模板

```html
<section class="slide" data-layout="L26">
  <div class="slide-inner">
    <div class="rp-head">
      <h1 class="page-title">{{标题，一句判断句}}</h1>
    </div>
    <div class="l26-duo">
      <div class="l26-a">
        <h3>{{概念 A}}</h3>
        <p>{{一句定义}}</p>
      </div>
      <div class="l26-b">
        <h3>{{概念 B（更上层的那个）}}</h3>
        <p>{{一句定义}}</p>
      </div>
    </div>
    <div class="l26-quote">{{把上面那对区分收成一句判断}}</div>
    <div class="l26-cap">{{下面这四格是什么的四层/四类，一行小字}}</div>
    <div class="l26-row">
      <div class="l26-cell">
        <div class="l26-bg"><img src="/ppt-cases/ph-16x9.svg" alt="" data-img-prompt="这一层配什么底图（中文一句话，主体在上半张）" data-img-mode="case"></div>
        <b>{{层次名}}</b>
        <span>{{一行说明}}</span>
      </div>
      <div class="l26-cell">
        <div class="l26-bg"><img src="/ppt-cases/ph-16x9.svg" alt="" data-img-prompt="这一层配什么底图（中文一句话，主体在上半张）" data-img-mode="case"></div>
        <b>{{层次名}}</b>
        <span>{{一行说明}}</span>
      </div>
      <div class="l26-cell">
        <div class="l26-bg"><img src="/ppt-cases/ph-16x9.svg" alt="" data-img-prompt="这一层配什么底图（中文一句话，主体在上半张）" data-img-mode="case"></div>
        <b>{{层次名}}</b>
        <span>{{一行说明}}</span>
      </div>
      <div class="l26-cell on">
        <div class="l26-bg"><img src="/ppt-cases/ph-16x9.svg" alt="" data-img-prompt="这一层配什么底图（中文一句话，主体在上半张）" data-img-mode="case"></div>
        <b>{{要强调的那一层}}</b>
        <span>{{一行说明}}</span>
      </div>
    </div>
  </div>
</section>
```

---

## 五、图槽位

| 槽位 | 必填? | 模式 | 比例 | 构图要求 |
|------|-------|------|------|----------|
| `pXX_bg1` … `pXX_bg4` | 可选（要么四张全有，要么全无） | case | 16:9 | **每格的底图**（约 393×200 的横条，`cover` 裁切）：主体在**上半张**（下半张被蒙版压到 `.96` 给文字），四张必须同一路调性/色温；不要带文字 |

**禁用**：主体压在下缘的图（一上蒙版就没了）、高对比强色块、四张风格不一（四格立刻散成四张不相关的卡）

---

## 六、变体

| 编号 | 变化 | 用途 |
|------|------|------|
| V1 | 三栏图卡（`repeat(3,1fr)`，说明可写两行） | 只有三层 |
| V2 | 五栏图卡（`repeat(5,1fr)`，层次名压到 4 字内） | 五层 |
| V3 | 双条上下叠（`grid-template-columns:1fr`） | 两个概念的名字很长 |
| V4 | 去掉引用层（双条 + 四栏） | 没有可收口的一句 |
| V5 | 去掉四栏（双条 + 引用 + `.rp-foot` 结论条） | 只做区分不展开 |
| V6 | 反色条改到左边（`.l26-b` 放前面） | 上层概念要先出场 |
| V7 | 四栏去掉底图（整个 `.l26-bg` 删掉，纯色卡） | 找不到四张同一路调性的图时 |

---

## 七、design 提示

- **视觉中等偏重**（三层堆叠，这一族里最满的一条）：前后不要再接 L24 / L28 那两条同族文字页，用 L2 / L13 / L7 缓冲
- **反色那一条是结构签名**：两条都浅底之后"包含关系"这层意思消失，画面上只是两个说明框
- **引用层只写一句**：写成两句就退化成正文段，三层的"区分 → 判断 → 展开"节奏散掉
- **配色**：反色条 `var(--c-ink-deep)` 底 + `var(--c-card)` 字（暗底上的正文用 `rgba(255,255,255,.8)`，**不要用 `var(--c-ink-soft)`**，那个在暗底上会糊）；竖线与高亮格走 `var(--c-brand)`
- **与 L4 的区别**：L4 是整页两块对立（左橙右蓝，页面就这一层），L26 的对比只是第一层，后面还要收口和展开
- **与 L24 的区别**：L24 是同一维度四种取值 + 结论条（一层结构），L26 是三层递进
