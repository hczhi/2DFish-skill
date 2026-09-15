# L53 · `line-chart`（图表页：报告风标题条 + 5–8 个点的折线 + 结论条）

> **📄 详情**：本文件供 design 阶段匹配到 L53 时**必读**。
> **★ 核心原则**：结构是灵魂，颜色/内容不绑死。所有配色必须用 `var(--c-*)` 变量。

---

## 一、结构速览

- **比例**：16:9，浅底，**折线那一档图表页**（5–8 个点，每个点「圆点 + 点上数字」，点下是横轴标签，约 120–260 字）
- **核心手法**：① 顶部报告风标题条（`.rp-head` + 一行 `lead` 说清这条线在看什么、横轴是哪一段时间）；② 右对齐的**单位/口径行**（`.dt-unit`，和条形页/表格页共用）；③ `.l53-plot` 里**两层叠一起**：`.l53-cols`（等分 5–8 个 `.l53-col`，每格里一个 `.l53-dot` 圆点 + `.l53-val` 数字，高度都靠 `--pt-y`）+ 铺满它的 `.l53-svg`（里面一条 `.l53-line` polyline）；④ 下面一层 `.l53-axis`（同样等分的横轴标签 `.l53-name`，整层的 `border-top` 就是横轴）；⑤ `.dt-src` 写来源；⑥ 底部结论条（`.rp-foot`）
- **是否全幅**：否 —— 全部内容包在 `.slide-inner` 里
- **底色**：默认不加类
- **什么时候用**：**一个量沿着时间连续地走** —— 半年的月度营收、12 周的留存、连续几期的转化率、一条指标的爬坡曲线。要读的是**趋势和拐点**（哪一段陡、哪里掉头），不是「谁比谁大」
- **和竖柱那一档的分工**：柱子读的是「每一期各自多少」（离散的几期一根根比），线读的是「连起来怎么走」。**离散的类别（渠道、城市、产品线）绝对不能连成线** —— 那条线在画面上把两个不相干的类别连起来，读的人会以为它们之间有过程；那样的数据用横条页

---

## 二、结构拆解

### 1. 标题条 · `.rp-head`

标题**必须写成 `<h1 class="page-title">`**（页脚目录面板靠它取标题）。`lead` 写一句：这条线是什么指标、横轴是哪一段（哪几个月？第几周到第几周？）。折线最容易被读成「涨了」而说不出涨在哪一段。

### 2. 单位 / 口径行 · `.dt-unit`

右对齐的一行小字（1–3 项，如「单位：万元」「口径：含税」）。
**单位必须写在这里**（或每个点的 `<i>`）：点上写着「4.8」，是万元还是万人只有画图的人知道，而缺单位的图看起来是一张干净完整的折线图，读的人只会照自己的假设去理解量级。

### 3. 点 · `.l53-col` × 5–8

- **每个点只写 `style="--bar-v:数值"`，就是点上印出来的那个原始数字。**
  **高度 `--pt-y` 和那条线的 `points` 全部由代码算**（`chartData.ts`），模型一个坐标都不要写：
  两处坐标各算一遍的话，线会从点旁边穿过去；按 `i*100/(n-1)`（0 / 25 / 50 / 100 那种一眼
  看着对的写法）算 x 的话整条线比点阵**偏半格**、首尾还贴到画面边缘 —— 出来是一张完整、
  好看的折线图，一处都不报错，而线的走势和点上印着的数字不是一回事。
  `--bar-v` 和印出来的数字对不上时，**代码按印出来的那个数改回去并出声**。
- **上限 `--bar-max` 不要写**（一组百分比钉 100，其余按最大值往上取一档整齐刻度），
  **基线一律是 0**：抬基线的折线图是最容易骗人的一种图，2% 的波动能画成断崖，
  而每个点旁边印着的数字都是对的。
- **5–8 个点。** 4 个点连出来的是三段折线、看不出趋势（那种数据用竖柱页）；9 个点起横轴标签
  挤到 130px 以内开始换行、点上的数字互相碰（`.l53-val` 是绝对定位的，**故意不裁**）。
- **顺序照时间往后排。** 反排过的那一页照样是一张完整的折线图，趋势却是反的。
- **只写正数**，中间**不许缺点**：少写一个点那条线会把它左右两期直接连起来，
  斜率变成两期的平均 —— 画面上完全看不出少了一期。真缺一期的数据用竖柱页（缺的那根空着）。
- **一页只画一条线。** 两条线要有图例、要区分颜色和虚实，这一条的骨架里没有那些东西
  （两条线全是品牌色，叠在一起读不出哪条是哪条）。

### 4. 数字 / 横轴标签 · `.l53-val` / `.l53-name`

- `.l53-val` 里数字直接写，单位包进 `<i>`（自动转成灰色小字）。它跟着点走（`bottom:var(--pt-y)`
  + 20px），所以永远在自己那个点的上方。**每个点都要写**：少一个的话读的人以为那一期没统计到。
- `.l53-name` 是横轴标签（`三月` / `W1` / `Q3`），**4–6 个字**；要补口径/英文挂一段 `<em>`
  （另起一行的灰色小字，非斜体），**要么每个都有、要么都没有**。
- **`.l53-axis` 里的标签个数必须和点数完全一样**：点和标签是**两层各自等分**的 grid，
  少一个标签的话每个点的标签都往前挪一格（三月的数字下面写着四月），而这一页排出来完全正常
  —— 代码会点名说出来（「N 个点、M 个标签」），但别指望它替你补名字。
- **强调最多一个点**：`.l53-col.on`（更大的深色圆点 + 更大的深色数字）标结论所指的那一期，
  一般是最后一个或者拐点那个。全标等于没标。

### 5. 脚注与结论 · `.dt-src` / `.rp-foot`

`.dt-src` 一行灰字写数据来源/统计口径（可省）。`.rp-foot` 一句结论（`<b>` 圈出关键词）——
**必须写**：读的人从一条线上只能看出「往上走」，说不出你要他记住的那件事。

---

## 三、CSS 骨架

```css
/* 报告风共用：标题条 + 结论条 */
.rp-head{padding-bottom:20px;border-bottom:2px solid var(--c-ink-deep)}
.rp-head .page-title{font-family:var(--sans);font-size:52px;font-weight:800;color:var(--c-ink-deep);line-height:1.18;letter-spacing:-.01em;margin-top:0}
.rp-head .lead{font-size:20px;line-height:1.7;color:var(--c-ink);margin-top:18px;max-width:1180px}
.rp-foot{margin-top:auto;padding-top:20px;border-top:1px solid var(--c-hairline);font-size:21px;line-height:1.6;color:var(--c-ink-deep)}
.rp-foot b{font-weight:800;color:var(--c-brand-deep)}
/* 单位行 / 脚注（与条形页、表格页共用） */
.dt-unit{display:flex;justify-content:flex-end;gap:26px;margin-top:22px;font-size:16px;color:var(--c-ink-soft);letter-spacing:.04em}
.dt-src{margin-top:16px;font-size:15px;line-height:1.7;color:var(--c-ink-soft)}
/* L53 折线图 */
.l53-plot{flex:1;min-height:0;display:flex;flex-direction:column;margin-top:30px;padding-top:46px}
.l53-cols{position:relative;flex:1;min-height:0;display:grid;grid-auto-flow:column;grid-auto-columns:1fr}
.l53-svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible}
.l53-line{fill:none;stroke:var(--c-brand);stroke-width:3;stroke-linejoin:round;stroke-linecap:round;vector-effect:non-scaling-stroke}
.l53-col{position:relative;min-width:0}
.l53-dot{position:absolute;left:50%;bottom:var(--pt-y,0%);width:14px;height:14px;margin:0 0 -7px -7px;border-radius:50%;background:var(--c-brand);box-shadow:0 0 0 4px var(--c-bg)}
.l53-val{position:absolute;left:-10px;right:-10px;bottom:var(--pt-y,0%);margin-bottom:20px;text-align:center;font-family:var(--num);font-size:22px;font-weight:800;line-height:1;font-variant-numeric:tabular-nums;color:var(--c-ink-deep)}
.l53-val i{font-style:normal;font-family:var(--sans);font-size:14px;font-weight:700;color:var(--c-ink-soft);margin-left:3px}
.l53-axis{display:grid;grid-auto-flow:column;grid-auto-columns:1fr;border-top:2px solid var(--c-ink-deep)}
.l53-name{padding:16px 6px 0;text-align:center;font-size:18px;font-weight:700;line-height:1.35;color:var(--c-ink-deep)}
.l53-name em{display:block;font-style:normal;font-size:14px;font-weight:700;letter-spacing:.06em;color:var(--c-ink-soft);margin-top:4px}
.l53-col.on .l53-dot{width:20px;height:20px;margin:0 0 -10px -10px;background:var(--c-brand-deep)}
.l53-col.on .l53-val{color:var(--c-brand-deep);font-size:26px}
```

---

## 四、build-part 结构模板

```html
<section class="slide" data-layout="L53">
  <div class="slide-inner">
    <div class="rp-head">
      <h1 class="page-title">{{标题}}</h1>
      <div class="lead">{{一句话：这条线是什么指标、横轴是哪一段时间}}</div>
    </div>
    <div class="dt-unit">
      <span>{{单位：万元}}</span>
      <span>{{口径：统计范围}}</span>
    </div>
    <div class="l53-plot">
      <div class="l53-cols"><!-- 这一层不写 style：上限由代码算 -->
        <svg class="l53-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <polyline class="l53-line" points=""></polyline><!-- points 空着，坐标由代码算 -->
        </svg>
        <div class="l53-col" style="--bar-v:{{数值 1，就是点上印的那个数}}">
          <b class="l53-dot"></b>
          <div class="l53-val">{{数值 1}}<i>{{单位}}</i></div>
        </div>
        <div class="l53-col" style="--bar-v:{{数值 2}}">
          <b class="l53-dot"></b>
          <div class="l53-val">{{数值 2}}<i>{{单位}}</i></div>
        </div>
        <div class="l53-col" style="--bar-v:{{数值 3}}">
          <b class="l53-dot"></b>
          <div class="l53-val">{{数值 3}}<i>{{单位}}</i></div>
        </div>
        <div class="l53-col" style="--bar-v:{{数值 4}}">
          <b class="l53-dot"></b>
          <div class="l53-val">{{数值 4}}<i>{{单位}}</i></div>
        </div>
        <div class="l53-col on" style="--bar-v:{{数值 5}}">
          <b class="l53-dot"></b>
          <div class="l53-val">{{数值 5}}<i>{{单位}}</i></div>
        </div>
      </div>
      <div class="l53-axis"><!-- 标签个数必须和上面的点数一样多 -->
        <div class="l53-name">{{横轴标签 1，4–6 字}}<em>{{英文/口径，可省；有就每个都有}}</em></div>
        <div class="l53-name">{{横轴标签 2}}<em>{{可省}}</em></div>
        <div class="l53-name">{{横轴标签 3}}<em>{{可省}}</em></div>
        <div class="l53-name">{{横轴标签 4}}<em>{{可省}}</em></div>
        <div class="l53-name">{{横轴标签 5}}<em>{{可省}}</em></div>
      </div>
    </div>
    <div class="dt-src">{{数据来源 / 统计口径，没有就删掉这一行}}</div>
    <div class="rp-foot">{{一句结论，关键词用 <b>b</b> 圈出 —— 读的人从一条线上只看得出「往上走」}}</div>
  </div>
</section>
```

---

## 五、图槽位

| 槽位 | 必填? | 模式 | 比例 | 构图要求 |
|------|-------|------|------|----------|
| —    | —     | —    | —    | **这一条不放图**：折线要占满内容区高度，斜率才读得出来；塞一张图会把绘图区压到两三百像素高，一条陡线看起来只是「有点起伏」（而那一页看起来只是「图小了点」） |

**禁用**：任何 `<img>` / 背景图 / **图表截图**（截图里的坐标轴放大后是糊的，而它在编辑器里看着清楚；有数据就用这一条画）

---

## 六、变体

| 编号 | 变化 | 用途 |
|------|------|------|
| V1 | 去掉 `.dt-src` | 数据是自己的，没有外部来源 |
| V2 | 去掉 `lead`（绘图区多一截高度） | 标题已经说清横轴是什么 |
| V3 | 每个点不写 `<i>` 单位，单位只在 `.dt-unit` 里写一次 | 所有点同一个单位 |
| V4 | 一个点都不加 `on` | 整条线本身就是结论，不想指某一期 |
| V5 | `.l53-name` 里不挂 `<em>` | 没有口径/英文可写 |
| V6 | `.l53-line` 的 `stroke` 用 inline style 换 `var(--c-accent)` | 同一份里另一页已经有品牌色的图表 |

---

## 七、design 提示

- **一个坐标都不要自己算**：只写 `--bar-v`（点上印出来的那个原始数），`--pt-y` 和 polyline 的 `points` 全由 `chartData.ts` 算 —— 自己算的那条线从点旁边穿过去、或者整条偏半格（`i*100/(n-1)`），而那一页是一张完整好看的折线图，一处都不报错
- **`--bar-max` 不要写**（写了会被重算）：百分比钉 100、其余取整齐刻度，**基线一律 0** —— 抬基线能把 2% 的波动画成断崖，而每个点上的数字都是对的
- **`.l53-axis` 的标签个数 = 点数**（两层各自等分的 grid）：少一个标签，每个点的标签都往前挪一格（三月的数字下面写着四月），而这一页排出来完全正常
- **5–8 个点**：4 个点看不出趋势（改用竖柱页）；9 个起横轴标签换行、点上数字互相碰（`.l53-val` 绝对定位，故意不裁）
- **中间不许缺点**：少一期的话线把左右两期直接连起来、斜率变成两期的平均，画面上一点看不出来；真缺就用竖柱页
- **只连连续的时间/期次**，离散类别（渠道、城市、产品线）不许连成线（那条线会让人以为两个类别之间有过程）；一页只画一条线（骨架里没有图例，两条品牌色的线叠在一起读不出哪条是哪条）
- **顺序照时间往后排**（反排过的那一页照样完整，趋势却是反的）
- **单位必须写**（`.dt-unit` 或每个点 `<i>`）：缺了它这一页仍然是一张干净完整的折线图
- **`on` 最多一个点**（全标等于没标）；结论条**必须写**（一条线只能让人看出「往上走」）
- **配色**：线和圆点 `var(--c-brand)`，强调点 `var(--c-brand-deep)`，横轴线 `var(--c-ink-deep)`（画在 `.l53-axis` 整层的 `border-top` 上，所以永远是连续的一条）；圆点外圈那道 `box-shadow` 必须是 `var(--c-bg)`（页面底色），改成 `var(--c-card)` 的话每个点周围多一圈浅色晕，看起来像点没画干净
- **整份最多一页折线**，且别和竖柱页/表格页相邻（都是「标题条 + 一大块数据 + 结论条」，翻起来像同一页没动）
- **和竖柱那一档的分工**：读趋势/拐点用这一条，读「每一期各自多少」用竖柱页；比大小排序用横条页
