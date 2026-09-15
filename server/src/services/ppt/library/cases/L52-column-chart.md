# L52 · `column-chart`（图表页：报告风标题条 + 4–8 根竖柱 + 结论条）

> **📄 详情**：本文件供 design 阶段匹配到 L52 时**必读**。
> **★ 核心原则**：结构是灵魂，颜色/内容不绑死。所有配色必须用 `var(--c-*)` 变量。

---

## 一、结构速览

- **比例**：16:9，浅底，**竖柱那一档图表页**（4–8 根柱，每根「柱 + 柱顶数字 + 柱下名称」，约 120–260 字）
- **核心手法**：① 顶部报告风标题条（`.rp-head`，带一行 `lead` 说清这张图在看什么、横轴是什么）；② 右对齐的**单位/口径行**（`.dt-unit`，和横条页/表格页共用）；③ `.l52-plot` 里一个 `.l52-cols`，等分 4–8 个 `.l52-col`：每根柱是 `.l52-track`（上 `.l52-gap` + 下 `.l52-fill`），**数字贴在柱顶上方**（`.l52-val`，`.l52-fill` 的绝对定位子元素），名称在横轴下面（`.l52-name`，可挂一段 `<em>` 小字）；④ 图下 `.dt-src` 写来源；⑤ 底部结论条（`.rp-foot`）
- **是否全幅**：否 —— 全部内容包在 `.slide-inner` 里
- **底色**：默认不加类
- **什么时候用**：**按顺序看一个量怎么变** —— 逐月/逐季/逐年的营收、五期投放的转化、四个阶段的耗时、几档价格区间的分布。横轴天然是「顺序」（时间、区间、流程先后），所以柱子的顺序**不许按大小重排**
- **和横条那一档的分工**：柱子是竖的、名称写在下面，一根只放得下 4–6 个字 → 只适合短标签（`2024` / `Q3` / `一线城市`）。名称长（「品牌内容代运营」）、或者要的就是「谁最长、谁最短」的排序对比，用横条那一条；要横向纵向对着读的矩阵用表格页

---

## 二、结构拆解

### 1. 标题条 · `.rp-head`

标题**必须写成 `<h1 class="page-title">`**（页脚目录面板靠它取标题）。`lead` 写一句：这张图在看什么、横轴是什么（哪几期？哪几档？）。柱状图最容易被读成「涨了」而说不出涨在哪一段。

### 2. 单位 / 口径行 · `.dt-unit`

右对齐的一行小字（1–3 项，如「单位：万元」「口径：含税」）。
**单位必须写在这里**（或每根柱的 `<i>`）：柱顶写着「4.8」，是万元还是万人只有画图的人知道，而缺单位的图看起来是一张排得很干净的完整柱状图，读的人只会照自己的假设去理解量级。

### 3. 柱子 · `.l52-col` × 4–8

- **每根柱只写 `style="--bar-v:数值"`，就是柱顶印出来的那个原始数字。不许写百分比、不许自己折算成高度。**
  柱高是浏览器用 `flex-grow:var(--bar-v)`（`.l52-fill`）和 `flex-grow:calc(var(--bar-max) - var(--bar-v))`（`.l52-gap`）
  分掉整条轨道的 —— 自己折算的那一根照旧是一根颜色正常、高度看起来很合理的柱，柱顶的数字仍然是对的，
  没有任何地方会报错，而读的人照柱高得出的结论是反的。
  `--bar-v` 和柱顶印出来的数字对不上时，**代码按印出来的那个数改回去并出声**（`chartData.ts`）。
- **上限 `--bar-max` 由代码算，不要写**（和横条那一条同一套：一组百分比钉 100，其余按最大值往上取
  一档整齐刻度）。写「取最大值」的话最高那根永远顶到画面顶上，而数据是百分比时 40% 画出来就是满格。
- **4–8 根。** 9 根起每根柱连柱名一起挤到 130px 以内，柱名换两行把横轴线下面顶高一截、柱顶的数字
  开始互相碰（`.l52-val` 是绝对定位的，**故意不裁**）；只有 2–3 个数就别画图了，写大数字页。
- **顺序照横轴的顺序排，不按大小。** 这一条是柱状图和横条页最大的区别：把 2024 排在 2022 前面之后
  那一页照样是一张完整的图，趋势却是反的。
- **`--bar-v` 只写正数。** 负数那一根 `flex-grow` 变负、被夹成 0，出来是一根**看不见**的柱（那一格
  空着，看起来像「这一期没有数据」）。真有负值请换成横条页或表格页。

### 4. 数字 / 名称 · `.l52-val` / `.l52-name`

- `.l52-val` 里数字直接写，单位包进 `<i>`（自动转成灰色小字）。它贴在柱顶上方 12px，随柱高走 ——
  所以矮柱的数字也永远在自己那根柱上面。**每根都要写**：少一根的话读的人以为那一期没统计到。
- `.l52-name` 是横轴标签（`2024` / `Q3` / `30–50 万`），**4–6 个字**；要补口径/英文挂一段 `<em>`
  （另起一行的灰色小字，非斜体），**要么每根都有、要么都没有**（只有一两根有时那几根的名字基线和
  别的不齐，看起来像排版坏了）。
- **强调最多一根**：`.l52-col.on`（深品牌色柱 + 数字和名称同色）标结论所指的那一根；`.l52-col.dim`
  （灰柱）标「预测值 / 不计入」的那一根。`on` 全标等于没标。

### 5. 脚注与结论 · `.dt-src` / `.rp-foot`

`.dt-src` 一行灰字写数据来源/统计口径（可省）。`.rp-foot` 一句结论（`<b>` 圈出关键词）——
**必须写**：读的人从五根柱上只能看出「后面比前面高」，得不出你要说的那件事。

---

## 三、CSS 骨架

```css
/* 报告风共用：标题条 + 结论条 */
.rp-head{padding-bottom:20px;border-bottom:2px solid var(--c-ink-deep)}
.rp-head .page-title{font-family:var(--sans);font-size:52px;font-weight:800;color:var(--c-ink-deep);line-height:1.18;letter-spacing:-.01em;margin-top:0}
.rp-head .lead{font-size:20px;line-height:1.7;color:var(--c-ink);margin-top:18px;max-width:1180px}
.rp-foot{margin-top:auto;padding-top:20px;border-top:1px solid var(--c-hairline);font-size:21px;line-height:1.6;color:var(--c-ink-deep)}
.rp-foot b{font-weight:800;color:var(--c-brand-deep)}
/* 单位行 / 脚注（与横条页、表格页共用） */
.dt-unit{display:flex;justify-content:flex-end;gap:26px;margin-top:22px;font-size:16px;color:var(--c-ink-soft);letter-spacing:.04em}
.dt-src{margin-top:16px;font-size:15px;line-height:1.7;color:var(--c-ink-soft)}
/* L52 竖柱图 */
.l52-plot{flex:1;min-height:0;display:flex;flex-direction:column;margin-top:30px;padding-top:52px}
.l52-cols{flex:1;min-height:0;display:grid;grid-auto-flow:column;grid-auto-columns:1fr;align-items:stretch}
.l52-col{display:flex;flex-direction:column;min-width:0}
.l52-track{flex:1;min-height:0;display:flex;flex-direction:column;padding:0 17%}
.l52-gap{flex-grow:calc(var(--bar-max,100) - var(--bar-v,1));flex-basis:0}
.l52-fill{position:relative;flex-grow:var(--bar-v,1);flex-basis:0;min-height:5px;background:var(--c-brand)}
.l52-val{position:absolute;left:-16px;right:-16px;bottom:100%;margin-bottom:12px;text-align:center;font-family:var(--num);font-size:26px;font-weight:800;line-height:1;font-variant-numeric:tabular-nums;color:var(--c-ink-deep)}
.l52-val i{font-style:normal;font-family:var(--sans);font-size:14px;font-weight:700;color:var(--c-ink-soft);margin-left:4px}
.l52-name{border-top:2px solid var(--c-ink-deep);padding:18px 6px 0;text-align:center;font-size:19px;font-weight:700;line-height:1.35;color:var(--c-ink-deep)}
.l52-name em{display:block;font-style:normal;font-size:14px;font-weight:700;letter-spacing:.06em;color:var(--c-ink-soft);margin-top:4px}
.l52-col.on .l52-fill{background:var(--c-brand-deep)}
.l52-col.on .l52-val,.l52-col.on .l52-name{color:var(--c-brand-deep)}
.l52-col.dim .l52-fill{background:var(--c-ink-soft)}
```

---

## 四、build-part 结构模板

```html
<section class="slide" data-layout="L52">
  <div class="slide-inner">
    <div class="rp-head">
      <h1 class="page-title">{{标题}}</h1>
      <div class="lead">{{一句话：这张图在看什么、横轴是哪几期/哪几档}}</div>
    </div>
    <div class="dt-unit">
      <span>{{单位：万元}}</span>
      <span>{{口径：统计范围}}</span>
    </div>
    <div class="l52-plot">
      <div class="l52-cols"><!-- 这一层不写 style：柱高的上限由代码算 -->
        <div class="l52-col" style="--bar-v:{{数值 1，就是柱顶印的那个数}}">
          <div class="l52-track">
            <div class="l52-gap"></div>
            <div class="l52-fill"><div class="l52-val">{{数值 1}}<i>{{单位}}</i></div></div>
          </div>
          <div class="l52-name">{{横轴标签 1，4–6 字}}<em>{{口径/英文，可省；有就每根都有}}</em></div>
        </div>
        <div class="l52-col" style="--bar-v:{{数值 2}}">
          <div class="l52-track">
            <div class="l52-gap"></div>
            <div class="l52-fill"><div class="l52-val">{{数值 2}}<i>{{单位}}</i></div></div>
          </div>
          <div class="l52-name">{{横轴标签 2}}<em>{{可省}}</em></div>
        </div>
        <div class="l52-col" style="--bar-v:{{数值 3}}">
          <div class="l52-track">
            <div class="l52-gap"></div>
            <div class="l52-fill"><div class="l52-val">{{数值 3}}<i>{{单位}}</i></div></div>
          </div>
          <div class="l52-name">{{横轴标签 3}}<em>{{可省}}</em></div>
        </div>
        <div class="l52-col on" style="--bar-v:{{数值 4}}">
          <div class="l52-track">
            <div class="l52-gap"></div>
            <div class="l52-fill"><div class="l52-val">{{数值 4}}<i>{{单位}}</i></div></div>
          </div>
          <div class="l52-name">{{结论所指的那一根，最多一根加 on}}<em>{{可省}}</em></div>
        </div>
      </div>
    </div>
    <div class="dt-src">{{数据来源 / 统计口径，没有就删掉这一行}}</div>
    <div class="rp-foot">{{一句结论，关键词用 <b>b</b> 圈出 —— 读的人从柱子上只看得出「后面比前面高」}}</div>
  </div>
</section>
```

---

## 五、图槽位

| 槽位 | 必填? | 模式 | 比例 | 构图要求 |
|------|-------|------|------|----------|
| —    | —     | —    | —    | **这一条不放图**：柱子要占满内容区高度才看得出高低差，塞一张图会把轨道压到两三百像素高，几根柱的差别就没了（而那一页看起来只是「图小了点」） |

**禁用**：任何 `<img>` / 背景图 / **图表截图**（截图里的坐标轴放大后是糊的，而它在编辑器里看着清楚；有数据就用这一条画）

---

## 六、变体

| 编号 | 变化 | 用途 |
|------|------|------|
| V1 | 去掉 `.dt-src` | 数据是自己的，没有外部来源 |
| V2 | 去掉 `lead`（柱子多一截高度） | 标题已经说清横轴是什么 |
| V3 | 每根不写 `<i>` 单位，单位只在 `.dt-unit` 里写一次 | 所有柱同一个单位 |
| V4 | 最后一根 `dim` 灰柱 | 那一期是预测值 / 未完成 |
| V5 | `.l52-name` 里不挂 `<em>` | 没有口径/英文可写 |
| V6 | `.l52-track` 的左右 padding 改 `26%`（inline style） | 只有 4 根柱、想让柱子瘦一点别像色块 |

---

## 七、design 提示

- **柱高不许自己折算**：每根 `--bar-v` 就写**柱顶印出来的那个原始数**，除法交给浏览器（`flex-grow`）—— 自己算错的那根是一根高度看起来很合理的柱、柱顶数字还是对的，一处都不报错，而结论是反的
- **`--bar-max` 不要写**（写了会被 `chartData.ts` 重算）：**百分比一律钉 100**，其余按最大值往上取一档整齐刻度 —— 「取最大值」会让最高那根顶到画面顶上，百分比时 40% 就画成了满格
- **顺序照横轴排、不按大小**（时间/区间/流程先后）：重排过的那一页照样完整，趋势却是反的
- **4–8 根**：9 根起柱名换两行、柱顶数字互相碰（`.l52-val` 绝对定位，故意不裁）；2–3 个数改用大数字页
- **只写正数**：负值 `flex-grow` 被夹成 0，那一格是一根看不见的柱，读起来像「这一期没数据」
- **柱名 4–6 字**（柱子只有一百多像素宽），长的挪进 `<em>`；`<em>` 要么每根都有要么都没有
- **单位必须写**（`.dt-unit` 或每根 `<i>`）：缺了它这一页仍然是一张干净完整的柱状图
- **`on` 最多一根**（全标等于没标）；结论条**必须写**（柱子只能让人看出「后面比前面高」）
- **配色**：柱 `var(--c-brand)`，强调 `var(--c-brand-deep)`，灰柱 `var(--c-ink-soft)`，横轴线 `var(--c-ink-deep)`（画在 `.l52-name` 的 `border-top` 上、柱间不留 gap —— 加了 gap 那条线会被切成几段悬在柱下面，看起来像横轴没画出来）
- **整份最多一页竖柱**，且别和横条页/表格页相邻（都是「标题条 + 一大块数据 + 结论条」，翻起来像同一页没动）
- **和横条那一档的分工**：柱名只放得下 4–6 个字，所以长名称/排序比大小走横条页；这一条只用于「按顺序看一个量怎么变」
