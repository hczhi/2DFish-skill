# L47 · `bar-chart-rows`（图表页：报告风标题条 + 横向条形 4–7 行 + 结论条）

> **📄 详情**：本文件供 design 阶段匹配到 L47 时**必读**。
> **★ 核心原则**：结构是灵魂，颜色/内容不绑死。所有配色必须用 `var(--c-*)` 变量。

---

## 一、结构速览

- **比例**：16:9，浅底，**整库唯一的真图表页**（4–7 行横向条形，每行「名称 + 条 + 数值」，约 150–300 字）
- **核心手法**：① 顶部报告风标题条（`.rp-head`，建议带一行 `lead` 说清这张图在比什么）；② 右对齐的**单位/口径行**（`.dt-unit`，和表格页共用）；③ **`.l47-rows` 里 4–7 个 `.l47-row`**，每行是 `300px 1fr 190px` 三列：左列名称（可挂一段 `<em>` 英文小字）、中列条形轨道（`.l47-track` > `.l47-fill` + `.l47-gap`）、右列数值（等宽数字 + `<i>` 单位）；④ 图下 `.dt-src` 写数据来源；⑤ 底部结论条（`.rp-foot`）
- **是否全幅**：否 —— 全部内容包在 `.slide-inner` 里
- **底色**：默认不加类
- **什么时候用**：耗时/占比/预算分布、渠道效果对比、几项指标横向比大小 —— 任何「同一个口径下几个对象比长短」的内容。只有 3–6 个孤立大数字不用这一条（那是大数字页），要横向纵向对着读的用表格页

---

## 二、结构拆解

### 1. 标题条 · `.rp-head`

标题**必须写成 `<h1 class="page-title">`**（页脚目录面板靠它取标题）。`lead` 尽量写一句：这张图在比什么、按什么排序（从大到小？按流程顺序？）。条形图最容易被读成「随便排了几条」。

### 2. 单位 / 口径行 · `.dt-unit`

和表格页共用的一行右对齐小字（1–3 项，如「单位：分钟」「口径：单份 30 页」）。
**单位必须写在这里**：右边写着「19」，是分钟还是万元只有画图的人知道，而缺单位的图看起来是一张排得很干净的完整图表，读的人只会照自己的假设去理解量级。

### 3. 条形行 · `.l47-row` × 4–7

- **条长由数值本身算出来，不许写百分比。** `.l47-rows` 上写一次 `style="--bar-max:N"`（N 取所有数值里
  最大的那个，或一个整齐的上限），每行写 `style="--bar-v:数值"` —— 就是右边那一列印出来的原始数字。
  条长是浏览器用 `flex-grow:var(--bar-v)` / `flex-grow:calc(var(--bar-max) - var(--bar-v))` 分出来的。
  **不要自己折算成百分比再写进 style**：算错的那一条照旧是一根颜色正常、长度看起来很合理的条，
  而它旁边的数字仍然是对的 —— 没有任何地方会报错，读的人只会照着条长得出反的结论。
- **`--bar-max` 必须 ≥ 最大的 `--bar-v`。** 小了的话 `calc()` 被夹到 0，那一条**看得见地**顶满整个轨道
  （这是故意的：这种错一眼就能看出来，比一堆算错的百分比安全）。
- **4–7 行。** 实测：整套结构（标题条 + `lead` + 单位行 + 脚注 + 结论条）之后留给 `.l47-rows` 的是
  551px，一行 53px + 行距 22px → 7 行占 341–841 刚好；第 8 行起从下沿**漏出去**压在单位行/脚注上
  （这一层是 `flex:1`，高度被剩余空间钉死，且故意不加 `overflow:hidden` —— 裁掉的话最后一两条
  凭空消失，而前面几条排得整整齐齐）。只有 2–3 个数就别画图了，写大数字页。
- **行的顺序要有理由**：从大到小、或按流程先后。既不排序又不说明时，读的人会以为你排过序。
- 左列写死 `300px`、右列 `190px`：跟着内容缩的话每行的条起点/终点各差几个像素，一眼看上去像条长不准。
- 名称超过 300px 会换行把那一行撑高（挤掉一整行的额度）→ **名称 12 字以内**，长的挪进 `<em>`。

### 4. 名称 / 数值 · `.l47-name` / `.l47-val`

- `.l47-name` 里可挂一段 `<em>`（自动转成另起一行的灰色小字，非斜体）放英文/代号/口径补充，
  **要么每行都有、要么都没有**：只有一两行有时那几行的名称基线和别的不齐，看起来像排版坏了。
- `.l47-val` 里数字直接写，单位包进 `<i>`（自动转成灰色小字）。**每行都要有单位**（除非
  `.dt-unit` 里已经统一写了同一个单位，那时 `<i>` 可以全省）。
- **强调最多一行**：`.l47-row.on`（深品牌色条 + 名称和数值同色）标那个结论所指的一行；
  `.l47-row.dim`（灰条）标「不重要/被排除」的一行。两个类都是可选的，`on` 全标等于没标。

### 5. 脚注与结论 · `.dt-src` / `.rp-foot`

`.dt-src` 一行灰字写数据来源/统计口径（可省）。`.rp-foot` 一句结论（`<b>` 圈出关键词）——
条形图的结论必须写出来：**读的人从五根条上得不出你的结论**，他只会看到「有一根最长」。

---

## 三、CSS 骨架

```css
/* 报告风共用：标题条 + 结论条 */
.rp-head{padding-bottom:20px;border-bottom:2px solid var(--c-ink-deep)}
.rp-head .page-title{font-family:var(--sans);font-size:52px;font-weight:800;color:var(--c-ink-deep);line-height:1.18;letter-spacing:-.01em;margin-top:0}
.rp-head .lead{font-size:20px;line-height:1.7;color:var(--c-ink);margin-top:18px;max-width:1180px}
.rp-foot{margin-top:auto;padding-top:20px;border-top:1px solid var(--c-hairline);font-size:21px;line-height:1.6;color:var(--c-ink-deep)}
.rp-foot b{font-weight:800;color:var(--c-brand-deep)}
/* 单位行 / 脚注（与表格页共用） */
.dt-unit{display:flex;justify-content:flex-end;gap:26px;margin-top:22px;font-size:16px;color:var(--c-ink-soft);letter-spacing:.04em}
.dt-src{margin-top:16px;font-size:15px;line-height:1.7;color:var(--c-ink-soft)}
/* L47 横向条形图 */
.l47-rows{flex:1;min-height:0;display:flex;flex-direction:column;justify-content:center;gap:22px;margin-top:34px}
.l47-row{display:grid;grid-template-columns:300px 1fr 190px;gap:26px;align-items:center}
.l47-name{font-size:21px;font-weight:700;line-height:1.35;color:var(--c-ink-deep)}
.l47-name em{display:block;font-style:normal;font-size:15px;font-weight:700;letter-spacing:.06em;color:var(--c-ink-soft);margin-top:4px}
.l47-track{display:flex;height:38px;background:var(--c-card);border:1px solid var(--c-hairline)}
.l47-fill{flex-grow:var(--bar-v,1);flex-basis:0;min-width:4px;background:var(--c-brand)}
.l47-gap{flex-grow:calc(var(--bar-max,100) - var(--bar-v,1));flex-basis:0}
.l47-val{font-family:var(--num);font-size:27px;font-weight:800;line-height:1;text-align:right;font-variant-numeric:tabular-nums;color:var(--c-ink-deep)}
.l47-val i{font-style:normal;font-family:var(--sans);font-size:15px;font-weight:700;color:var(--c-ink-soft);margin-left:6px}
.l47-row.on .l47-fill{background:var(--c-brand-deep)}
.l47-row.on .l47-name,.l47-row.on .l47-val{color:var(--c-brand-deep)}
.l47-row.dim .l47-fill{background:var(--c-ink-soft)}
```

---

## 四、build-part 结构模板

```html
<section class="slide" data-layout="L47">
  <div class="slide-inner">
    <div class="rp-head">
      <h1 class="page-title">{{标题}}</h1>
      <div class="lead">{{一句话：这张图在比什么、按什么排的}}</div>
    </div>
    <div class="dt-unit">
      <span>{{单位：分钟}}</span>
      <span>{{口径：统计范围}}</span>
    </div>
    <div class="l47-rows" style="--bar-max:{{所有数值里最大的那个}}">
      <div class="l47-row" style="--bar-v:{{数值 1，就是右边印的那个数}}">
        <div class="l47-name">{{对象 1，12 字内}}<em>{{英文/口径，可省；有就每行都有}}</em></div>
        <div class="l47-track"><div class="l47-fill"></div><div class="l47-gap"></div></div>
        <div class="l47-val">{{数值 1}}<i>{{单位}}</i></div>
      </div>
      <div class="l47-row" style="--bar-v:{{数值 2}}">
        <div class="l47-name">{{对象 2}}<em>{{英文，可省}}</em></div>
        <div class="l47-track"><div class="l47-fill"></div><div class="l47-gap"></div></div>
        <div class="l47-val">{{数值 2}}<i>{{单位}}</i></div>
      </div>
      <div class="l47-row on" style="--bar-v:{{数值 3}}">
        <div class="l47-name">{{结论所指的那一行，最多一行加 on}}<em>{{英文，可省}}</em></div>
        <div class="l47-track"><div class="l47-fill"></div><div class="l47-gap"></div></div>
        <div class="l47-val">{{数值 3}}<i>{{单位}}</i></div>
      </div>
      <div class="l47-row" style="--bar-v:{{数值 4}}">
        <div class="l47-name">{{对象 4}}<em>{{英文，可省}}</em></div>
        <div class="l47-track"><div class="l47-fill"></div><div class="l47-gap"></div></div>
        <div class="l47-val">{{数值 4}}<i>{{单位}}</i></div>
      </div>
    </div>
    <div class="dt-src">{{数据来源 / 统计口径，没有就删掉这一行}}</div>
    <div class="rp-foot">{{一句结论，关键词用 <b>b</b> 圈出 —— 读的人从条上得不出结论}}</div>
  </div>
</section>
```

---

## 五、图槽位

| 槽位 | 必填? | 模式 | 比例 | 构图要求 |
|------|-------|------|------|----------|
| —    | —     | —    | —    | **这一条不放图**：条形已经占满内容区，塞一张图只能把轨道压到两三百像素宽，条与条的长短差就看不出来了（而那一页看起来只是「图表小了点」） |

**禁用**：任何 `<img>` / 背景图 / **图表截图**（截图里的坐标轴放大后是糊的，而它在编辑器里看着清楚；有数据就用这一条画）

---

## 六、变体

| 编号 | 变化 | 用途 |
|------|------|------|
| V1 | 去掉 `.dt-src` | 数据是自己的，没有外部来源 |
| V2 | 去掉 `lead`（多容一行） | 标题已经说清在比什么 |
| V3 | 全行不写 `<i>` 单位，单位只在 `.dt-unit` 里写一次 | 所有行同一个单位 |
| V4 | `--bar-max` 取一个整齐上限（如 100 / 20）而不是最大值 | 想让人看出「离满格还差多少」 |
| V5 | 一行 `dim` 灰条 | 有一项要标成「被排除 / 不计入」 |
| V6 | `.l47-name` 里不挂 `<em>`，只留中文 | 没有英文/代号可写 |

---

## 七、design 提示

- **条长不许自己算百分比**：`--bar-max` 写一次在 `.l47-rows` 上（取最大值），每行 `--bar-v` 写**右边印出来的那个原始数**，除法交给浏览器（`flex-grow`）—— 自己折算算错的那条是一根长度看起来很合理的条、旁边数字还是对的，一处都不报错，而结论是反的
- **`--bar-max` 必须 ≥ 最大的 `--bar-v`**：小了那一条会**看得见地**顶满轨道（故意的，这种错一眼看出来）
- **4–7 行**：第 8 行起从 `.l47-rows` 下沿漏出去压在脚注/结论条上（字叠字），这一层故意不加 `overflow:hidden`（裁掉的话最后一两条凭空消失，而前面几条排得整整齐齐）；只有 2–3 个数改用大数字页
- **单位必须写**（`.dt-unit`，或每行的 `<i>`）：缺了它这一页仍然是一张干净完整的图表
- **顺序要有理由**（从大到小 / 按流程先后）：既不排序又不说明时，读的人会以为你排过序
- **名称 12 字以内**（超出 300px 就换行撑高那一行，挤掉一行额度），`<em>` 要么每行都有要么都没有
- **`on` 最多一行**（全标等于没标）；结论条**必须写**（读的人从条上只能看出「有一根最长」）
- **配色**：条 `var(--c-brand)`，强调行 `var(--c-brand-deep)`，灰条 `var(--c-ink-soft)`，轨道底 `var(--c-card)` + 细线（**不是 `var(--bg-plain)`** —— 那个和浅色页底色是同一个色值，写它的话轨道消失、只剩一根悬空的橙条，而页面照样渲染）
- **整份最多两页**，且别和表格页相邻（两页都是「标题条 + 一大块数据 + 结论条」，翻起来像同一页没动）
- **与大数字页那一条的区别**：那一条是 3–6 个孤立大数字（一眼看结论，不比长短），这一条是比长短
- **与表格页那一条的区别**：那一条是「几列口径 × 几行对象」的矩阵（要横向纵向对着读），这一条只有一个口径、比大小
