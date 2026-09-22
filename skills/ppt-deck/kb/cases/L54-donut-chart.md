# L54 · `donut-chart`（图表页：报告风标题条 + 左环右图例的 3–6 块占比 + 结论条）

> **📄 详情**：本文件供 design 阶段匹配到 L54 时**必读**。
> **★ 核心原则**：结构是灵魂，颜色/内容不绑死。所有配色必须用 `var(--c-*)` 变量。

---

## 一、结构速览

- **比例**：16:9，浅底，**占比那一档图表页**（3–6 块，左边一个环 + 右边一列图例，约 120–260 字）
- **核心手法**：① 顶部报告风标题条（`.rp-head` + 一行 `lead` 说清这一整圈是什么、口径是哪一段）；② 右对齐的**单位/口径行**（`.dt-unit`，和条形页/表格页共用）；③ `.l54-plot` 左右两块：左边 400px 的 `.l54-ring`（环那一圈是**一句 conic-gradient**，中间挖一个 `.l54-hole` 放一个大数字 + 一行说明）+ 右边 `.l54-legend`（3–6 个 `.l54-item`：色片 `.l54-chip` + 名称 `.l54-label` + 数字 `.l54-val`）；④ `.dt-src` 写来源；⑤ 底部结论条（`.rp-foot`）
- **是否全幅**：否 —— 全部内容包在 `.slide-inner` 里
- **底色**：默认不加类
- **什么时候用**：**一个整体拆成几块**、几块**加起来就是全部** —— 收入按业务线的构成、预算分配、客户按行业的分布、流量来源占比。要读的是**「谁占大头 / 结构是不是集中」**，不是「谁比谁大多少」，更不是趋势
- **和别的图表页的分工**：**加起来不是一个整体的数一律不许画成环**（三个城市的营收、四家友商的估值 —— 那种数放进环里就是在暗示「这三家凑成了整个市场」，而那一页是一张完整好看的环形图）→ 用横条页（L47）；比高低用横条页、按时间走用折线页（L53）或竖柱页（L52）

---

## 二、结构拆解

### 1. 标题条 · `.rp-head`

标题**必须写成 `<h1 class="page-title">`**（页脚目录面板靠它取标题）。`lead` 写一句：这一整圈代表什么（哪个口径下的 100%）、统计的是哪一段。环最容易被读成「这就是全部了」，而它到底是营收还是订单数、含不含税，只有画图的人知道。

### 2. 单位 / 口径行 · `.dt-unit`

右对齐的一行小字（1–3 项，如「单位：%」「口径：含税营收」）。
**单位必须写在这里**（或每一块的 `<i>`）：图例上写着「52」，是 52% 还是 52 亿只有画图的人知道，而缺单位的环看起来是一张干净完整的图。

### 3. 块 · `.l54-item` × 3–6

- **每一块只写 `style="--bar-v:数值"`，就是图例上印出来的那个原始数字。**
  **环那一圈（`--ring`）和每一块的颜色（`--slice`）全部由代码算**（`chartData.ts`），模型一个角度、
  一个颜色都不要写：角度自己算的那一版每一块看起来都很合理、旁边印着的百分比也是对的，
  只是块和数字对不上；颜色各写一遍更狠 —— 图例上写着「蓝色 = 直营」而环上那块蓝的是分销，
  读的人把每一块都认成了别的东西，而那一页颜色、单位、结论条全在，一处都不报错。
  `--bar-v` 和印出来的数字对不上时，**代码按印出来的那个数改回去并出声**。
- **上限 `--bar-max` 不要写**（代码把分母写在 `.l54-plot` 上）。一组百分比的分母**一律是 100**：
  按「几块的合计」切的话，合计 87% 的四块会各自被放大到刚好凑满一圈，每一块都比它印着的数字
  大一截。**合计就该是 100** —— 差的那一份要么补一块「其他」，要么在结论条里说清它是什么
  （代码会点名说出「合计只有 87%」并在环上留一段灰缺口，但它编不出那一块叫什么）。
- **占比不许重叠**：三块写成 60% / 50% / 30% 的话一圈只有 360 度，环只能按合计切，
  于是每一块都比它印着的数字小一点，而多出来的那部分在画面上完全看不出来。
- **3–6 块。** 2 块的环读起来不如一句话（用大数字那一档）；7 块起颜色只有 6 种、第 7 块开始
  和第 1 块同色（挨着的两块在环上看起来就是一整块），而图例读起来完全正常 —— 尾巴上那几块
  小的并成一块「其他」。
- **顺序按份额从大到小排**（「其他」永远放最后）：环是从 12 点顺时针铺的，大块在前才看得出
  「集中在头两块」；乱序排过的那一页照样是一张完整的环，而结构一眼读不出来。
- **只写正数**：负数在环上根本画不出来（那一块直接消失、后面的块整体前移），画面上完全看不出
  少了一块。有负值的数据用横条页或表格页。

### 4. 环心 · `.l54-hole`

洞里放**一个** `<b>` 大数字（单位包进 `<i>`）+ 一行 `<span>` 说明它是什么。写**最想让人记住的
那一个数**：头一块的占比、前两块合计、或者整圈的绝对量（「12.4 亿 / 全年营收」）。
**说明那一行必须写**：光一个「68%」摆在环心，读的人不知道它是哪一块的（代码不核这件事 ——
环心写 68% 而没有任何一块是 68% 时，那一页看起来完全正常）。

### 5. 图例 · `.l54-chip` / `.l54-label` / `.l54-val`

- `.l54-chip` 是**空元素**（颜色由代码写的 `--slice` 给），里面一个字都不要写。
- `.l54-label` 写块名（**4–10 字**），要补口径/英文挂一段 `<em>`（另起一行的灰色小字，非斜体），
  **要么每块都有、要么都没有**。
- `.l54-val` 里数字直接写，单位包进 `<i>`（自动转成灰色小字）。**每一块都要写**：
  少一个的话那一块在环上照旧占着位置，而读的人不知道它是多少。
- **强调最多一块**：`.l54-item.on`（更大的色片 + 深色文字）标结论所指的那一块。全标等于没标。

### 6. 脚注与结论 · `.dt-src` / `.rp-foot`

`.dt-src` 一行灰字写数据来源/统计口径（可省）。`.rp-foot` 一句结论（`<b>` 圈出关键词）——
**必须写**：读的人从一个环上只能看出「有一块最大」，说不出你要他记住的那件事。

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
/* L54 环形图 */
.l54-plot{flex:1;min-height:0;display:flex;align-items:center;gap:76px;margin-top:34px}
.l54-ring{position:relative;flex:none;width:400px;height:400px;border-radius:50%;background-image:var(--ring)}
.l54-hole{position:absolute;inset:27%;border-radius:50%;background:var(--c-bg);display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:0 12px}
.l54-hole b{font-family:var(--num);font-size:56px;font-weight:800;line-height:1;letter-spacing:-.02em;font-variant-numeric:tabular-nums;color:var(--c-ink-deep)}
.l54-hole b i{font-style:normal;font-family:var(--sans);font-size:22px;font-weight:700;color:var(--c-ink-soft);margin-left:3px}
.l54-hole span{margin-top:12px;font-size:16px;font-weight:700;line-height:1.4;color:var(--c-ink-soft)}
.l54-legend{flex:1;min-width:0;display:flex;flex-direction:column}
.l54-item{display:flex;align-items:center;gap:18px;padding:16px 0;border-bottom:1px solid var(--c-hairline)}
.l54-item:last-child{border-bottom:0}
.l54-chip{flex:none;width:16px;height:16px;border-radius:4px;background:var(--slice)}
.l54-label{flex:1;min-width:0;font-size:21px;font-weight:700;line-height:1.35;color:var(--c-ink-deep)}
.l54-label em{display:block;font-style:normal;font-size:14px;font-weight:700;letter-spacing:.04em;color:var(--c-ink-soft);margin-top:4px}
.l54-val{flex:none;font-family:var(--num);font-size:30px;font-weight:800;line-height:1;font-variant-numeric:tabular-nums;color:var(--c-ink-deep)}
.l54-val i{font-style:normal;font-family:var(--sans);font-size:15px;font-weight:700;color:var(--c-ink-soft);margin-left:3px}
.l54-item.on .l54-label,.l54-item.on .l54-val{color:var(--c-brand-deep)}
.l54-item.on .l54-chip{width:24px;height:24px}
```

---

## 四、build-part 结构模板

```html
<section class="slide" data-layout="L54">
  <div class="slide-inner">
    <div class="rp-head">
      <h1 class="page-title">{{标题}}</h1>
      <div class="lead">{{一句话：这一整圈是什么口径下的 100%、统计的是哪一段}}</div>
    </div>
    <div class="dt-unit">
      <span>{{单位：%}}</span>
      <span>{{口径：统计范围}}</span>
    </div>
    <div class="l54-plot"><!-- 这一层不写 style：分母由代码算 -->
      <div class="l54-ring"><!-- 不写 style：环那一圈由代码算 -->
        <div class="l54-hole">
          <b>{{最想让人记住的那个数}}<i>{{单位}}</i></b>
          <span>{{它是什么，一行}}</span>
        </div>
      </div>
      <div class="l54-legend">
        <div class="l54-item on" style="--bar-v:{{数值 1，就是图例上印的那个数}}">
          <b class="l54-chip"></b><!-- 空的：颜色由代码写 -->
          <div class="l54-label">{{块名 1，4–10 字}}<em>{{英文/口径，可省；有就每块都有}}</em></div>
          <div class="l54-val">{{数值 1}}<i>{{单位}}</i></div>
        </div>
        <div class="l54-item" style="--bar-v:{{数值 2}}">
          <b class="l54-chip"></b>
          <div class="l54-label">{{块名 2}}<em>{{可省}}</em></div>
          <div class="l54-val">{{数值 2}}<i>{{单位}}</i></div>
        </div>
        <div class="l54-item" style="--bar-v:{{数值 3}}">
          <b class="l54-chip"></b>
          <div class="l54-label">{{块名 3}}<em>{{可省}}</em></div>
          <div class="l54-val">{{数值 3}}<i>{{单位}}</i></div>
        </div>
        <div class="l54-item" style="--bar-v:{{数值 4}}">
          <b class="l54-chip"></b>
          <div class="l54-label">{{块名 4，小的几块并成「其他」放最后}}<em>{{可省}}</em></div>
          <div class="l54-val">{{数值 4}}<i>{{单位}}</i></div>
        </div>
      </div>
    </div>
    <div class="dt-src">{{数据来源 / 统计口径，没有就删掉这一行}}</div>
    <div class="rp-foot">{{一句结论，关键词用 <b>b</b> 圈出 —— 读的人从一个环上只看得出「有一块最大」}}</div>
  </div>
</section>
```

---

## 五、图槽位

| 槽位 | 必填? | 模式 | 比例 | 构图要求 |
|------|-------|------|------|----------|
| —    | —     | —    | —    | **这一条不放图**：左边那 400px 已经是这一页的视觉主角，再塞一张图就是两个主角抢位置，环被压小之后几块的差别就看不出来了（而那一页看起来只是「排得有点挤」） |

**禁用**：任何 `<img>` / 背景图 / **图表截图**（截图里的图例放大后是糊的，而它在编辑器里看着清楚；有数据就用这一条画）

---

## 六、变体

| 编号 | 变化 | 用途 |
|------|------|------|
| V1 | 去掉 `.dt-src` | 数据是自己的，没有外部来源 |
| V2 | 去掉 `lead`（环和图例多一截高度） | 标题已经说清口径 |
| V3 | 每块不写 `<i>` 单位，单位只在 `.dt-unit` 里写一次 | 所有块同一个单位 |
| V4 | 一块都不加 `on` | 结构本身就是结论，不想指某一块 |
| V5 | `.l54-label` 里不挂 `<em>` | 没有口径/英文可写 |
| V6 | `.l54-ring` 的宽高用 inline style 改成 340px | 图例有 6 块、名称还带 `<em>` 时给右边多让一点 |

---

## 七、design 提示

- **一个角度、一个颜色都不要自己写**：只写 `--bar-v`（图例上印出来的那个原始数），环那一圈 `--ring` 和每块的 `--slice` 全由 `chartData.ts` 算 —— 两处各算一遍的话图例上写着「蓝色 = 直营」而环上那块蓝的是分销，读的人把每一块都认成了别的东西，而那一页颜色、单位、结论条全在，一处都不报错
- **加起来不是一个整体的数不许画成环**（三个城市的营收、四家友商的估值）：环本身在说「这几块凑成了全部」，而那一页是一张完整好看的环形图 —— 那种数用横条页（L47）
- **一组百分比合计就该是 100**：少了的话代码在环上留一段灰缺口并点名说出来（但它编不出那一块叫什么，得自己补一块「其他」或在结论里说清）；多了的话一圈只有 360 度，每块反而被压小，而画面上完全看不出来
- **3–6 块**：2 块不如一句话（用大数字那一档）；7 块起颜色只有 6 种、第 7 块和第 1 块同色，挨着的两块在环上看起来就是一整块，而图例读起来完全正常 —— 尾巴上几块小的并成「其他」
- **顺序按份额从大到小、「其他」放最后**（环从 12 点顺时针铺，大块在前才读得出「集中在头两块」）
- **`.l54-chip` 里一个字都不要写**（它是纯色片）；**`.l54-val` 每块都要写**（少一个的话那块在环上照旧占着位置，而读的人不知道它是多少）
- **环心必须有那一行说明**：光一个「68%」摆在中间，读的人不知道它是哪一块的（代码不核环心那个数和几块的关系）
- **只写正数**（负数在环上画不出来，那一块直接消失、后面的块整体前移，画面上看不出少了一块）
- **单位必须写**（`.dt-unit` 或每块 `<i>`）：缺了它这一页仍然是一张干净完整的环形图
- **`on` 最多一块**（全标等于没标）；结论条**必须写**（一个环只能让人看出「有一块最大」）
- **配色**：块的颜色由代码按「相邻两块对比最大」的顺序取（橙 → 蓝 → 深灰 → 深橙 → 深蓝 → 浅灰），环心底色必须是 `var(--c-bg)`（换成 `var(--c-card)` 的话洞比页面白一档，看起来像中间垫了一张卡片）
- **整份最多一页环形**，且别和横条页/竖柱页/表格页相邻（都是「标题条 + 一大块数据 + 结论条」，翻起来像同一页没动）
