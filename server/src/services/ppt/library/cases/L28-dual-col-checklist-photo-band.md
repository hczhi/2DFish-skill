# L28 · `dual-col-checklist-photo-band`（报告风标题条 + 双列勾选清单（6–8 项）+ 底部横幅图带）

> **📄 详情**：本文件供 design 阶段匹配到 L28 时**必读**。
> **★ 核心原则**：结构是灵魂，颜色/内容不绑死。所有配色必须用 `var(--c-*)` 变量。

---

## 一、结构速览

- **比例**：16:9，浅底，纯文字为主 + 底部一条横幅图带，信息密度这一族里偏高
- **核心手法**：① 顶部报告风标题条（`.rp-head` + 一行 `lead`）；② 中部**双列勾选清单**（`.l28-cols`，6–8 项，每项 = 圆形勾选点 `.l28-tick` + 一行文字，关键半句 `<b>`；行距固定 30px，紧凑排在标题下面）；③ 底部**横幅图带**（`.l28-band`，`flex:1` 吃掉剩下的高度、最矮 216px，蒙版**左浓右淡**，一句话压在左下）
- **是否全幅**：否 —— 全部内容包在 `.slide-inner` 里
- **适合"能逐条核对"的东西**（自检清单、验收标准、准入条件）：每项都是可判定的一句话，不是概念解释
- **底色**：默认不加类

---

## 二、结构拆解（由上至下）

### 1. 标题条 · `.rp-head`

标题**必须写成 `<h1 class="page-title">`**（页脚目录面板靠它取标题）。`lead` 说这几条**什么时候用**（"发出去之前过一遍"）。

### 2. 双列清单 · `.l28-cols` > `.l28-line` × 6–8

- **项数要是偶数**（6 或 8）：奇数时最后一列缺一格，右下角空一块，而页面照样渲染。
- 每项 = `.l28-tick`（圆形勾选点，里面就一个 `✓`，也可放 01/02 这种编号）+ `<p>`（**一行**，≤ 22 字，关键半句 `<b>` 加深）。
- **每项只写一行**：写成两行之后八项会把图带压到只剩 216px 那个下限，再多就顶出页面（被挤时它自己不报错，只是图带越来越扁）。真要写两行就减到 6 项。
- 阅读顺序是**先左列从上到下、再右列**（grid 默认行优先其实是「左右左右」）—— 所以清单项之间**不要有强顺序**；有严格顺序的用 L27 / L25。

### 3. 图带 · `.l28-band`

- **页面剩余高度归图带**（`flex:1`，`min-height:216px` 是清单很长时的下限），所以八项时它大约 400px 高。反过来把 `flex:1` 给 `.l28-cols` 并配 `align-content:space-between` 的话，八个勾选项会被摊到一百三十多像素的行距上 —— 那时它读起来不像一份能逐条核对的清单，而是八段不相干的话，两种写法都合法、都不报错。
- 蒙版是**左浓右淡**（`.78 → .06`），一句话压在**左边**（`.l28-band p`，白字粗体，≤ 40 字）。所以选图要**主体在右半张**。
- 没有配图时整个 `.l28-band` 删掉即可（清单自然铺开，V5）。

---

## 三、CSS 骨架

```css
/* 报告风共用：标题条 */
.rp-head{padding-bottom:20px;border-bottom:2px solid var(--c-ink-deep)}
.rp-head .page-title{font-family:var(--sans);font-size:52px;font-weight:800;color:var(--c-ink-deep);line-height:1.18;letter-spacing:-.01em;margin-top:0}
.rp-head .lead{font-size:20px;line-height:1.7;color:var(--c-ink);margin-top:18px;max-width:1180px}
/* L28 双列勾选清单 + 底部横幅图带 */
.l28-cols{display:grid;grid-template-columns:1fr 1fr;gap:30px 60px;margin:34px 0 40px}
.l28-line{display:grid;grid-template-columns:36px 1fr;gap:18px;align-items:start}
.l28-tick{width:36px;height:36px;border-radius:50%;background:var(--card-o);color:var(--c-brand-deep);font-size:18px;font-weight:800;display:flex;align-items:center;justify-content:center}
.l28-line p{font-size:20px;line-height:1.65;color:var(--c-ink)}
.l28-line b{font-weight:800;color:var(--c-ink-deep)}
.l28-band{position:relative;flex:1;min-height:216px;overflow:hidden;display:flex;align-items:flex-end}
.l28-band img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.l28-band::after{content:"";position:absolute;inset:0;background:rgba(0,0,0,.65)}
.l28-band p{position:relative;z-index:2;padding:0 34px 28px;max-width:900px;color:#fff;font-size:22px;font-weight:700;line-height:1.55}
```

---

## 四、build-part 结构模板

```html
<section class="slide" data-layout="L28">
  <div class="slide-inner">
    <div class="rp-head">
      <h1 class="page-title">{{标题，一句判断句}}</h1>
      <div class="lead">{{这几条什么时候用，一行；不需要就整行删掉}}</div>
    </div>
    <div class="l28-cols">
      <div class="l28-line">
        <div class="l28-tick">✓</div>
        <p><b>{{可判定的关键半句}}</b>{{，补足的后半句}}</p>
      </div>
      <!-- 同样的 .l28-line 再写 5 或 7 遍，总数必须是偶数 -->
    </div>
    <div class="l28-band">
      <img src="/ppt-cases/ph-16x9.svg" alt="" data-img-prompt="底部图带配什么（中文一句话，横构图、主体在右半张）" data-img-mode="case">
      <p>{{这几条里最容易漏的是哪一条，一句话}}</p>
    </div>
  </div>
</section>
```

---

## 五、图槽位

| 槽位 | 必填? | 模式 | 比例 | 构图要求 |
|------|-------|------|------|----------|
| `pXX_band` | 可选（没有就走 V5） | case | 16:9 | 底部横幅（约 1640×400 的横条，`cover` 裁切上下会被切掉一些）：**主体在右半张**（左边被 `.78` 蒙版压住给文字），构图要横向舒展、别有细节要看 |

**禁用**：竖构图、人脸特写（切成窄条只剩半张脸）、主体压在左边的图（被蒙版吞掉）、图表截图

---

## 六、变体

| 编号 | 变化 | 用途 |
|------|------|------|
| V1 | 六项（说明可写两行） | 每条要补一句解释 |
| V2 | 单列（`grid-template-columns:1fr`，4 项，字号提到 24px） | 只有四条但要更醒目 |
| V3 | 勾选点改编号（`.l28-tick` 里放 01/02…） | 清单有顺序 |
| V4 | 图带蒙版改右浓左淡 + 文字右对齐 | 图的主体在左半张 |
| V5 | 去掉图带 | 找不到能切成窄条的图时 |
| V6 | 图带换成 `.rp-foot` 结论条 | 要收一句「所以怎么办」 |

---

## 七、design 提示

- **视觉偏重**（八行文字），前后接 L2 / L13 / L21 这类全幅图页缓冲，**不要接 L24 / L26** 那两条同族文字页
- **每项一行是硬约束**：两行之后图带被压到 216px 的下限、再多就顶出页面，这一页立刻从"清单"变成"一大段字"
- **项数偶数**：奇数时右下角空一格，看起来像漏了一条
- **配色**：勾选点 `var(--card-o)` 底 + `var(--c-brand-deep)` 字，加粗半句 `var(--c-ink-deep)`；图带上的字直接写 `#fff`（**不要用 `var(--c-ink-soft)`**，深蒙版上会糊）
- **与 L10 的区别**：L10 是 3–4 个带图标的横排卡（能力清单），L28 是 6–8 条可逐项核对的文字
- **与 L27 的区别**：L27 只 3–5 条、每条两行、右边一张整列竖图；L28 是密度换条数
