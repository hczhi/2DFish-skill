# L57 · `dual-table-sheet`（双表页：报告风标题条 + 上下两张各带小标题和口径的表 + 结论条）

> **📄 详情**：本文件供 design 阶段匹配到 L57 时**必读**。
> **★ 核心原则**：结构是灵魂，颜色/内容不绑死。所有配色必须用 `var(--c-*)` 变量。

---

## 一、结构速览

- **比例**：16:9，浅底，报告风，**一页两张表**（上下各一张，各 2–5 列 × 3–4 行，约 300–460 字）
- **核心手法**：把**两组口径不同的数各自成表** —— 每张表上方一行「小标题（这张表在说什么）+ 右端自己的单位/口径」，两格 `flex:1` 均分内容区高度；两张表的**表头、列数、单位互不相干**
- **是否全幅**：否（全部内容包在 `.slide-inner` 里）
- **什么时候用**：他给的一段资料里其实有**两组不同口径的数**：报价 + 工期、去年 + 今年、A 方案 + B 方案、投入 + 产出、线上 + 线下。这种内容并进一张表之后，列头只能取一个口径，另一组数被读的人拿错口径去套 —— 而那张表列数、行线、合计行全都正常，一处都不报错。**只有一组数的时候不要用这一条**（下面那格空着，看起来像「这一页没排完」），单表用 L45

---

## 二、结构拆解（从上到下）

### 1. 标题条 · `.rp-head`

- 报告风共用（`h1.page-title` + 2px 深色横线）。**标题要说清两张表合起来在回答什么问题**（「投入与产出对照」而不是「数据表」）—— 两张表各有各的小标题，页标题再重复一遍就没人知道它们的关系了。
- **`lead` 尽量不写**：写了之后留给两张表的高度从 656px 掉到 604px，每张表**只放得下 3 行**（见下条）。真要写就把行数压到 3 行。

### 2. 两格 · `.l57-stack` > `.l57-block`

- **只能两格。** 第三个 `.l57-block` 进来之后三格均分、每格 200px 出头，三张表各自从自己那格下沿漏出去压在下一张的小标题上，出来是字叠字的一页（`.l57-block` 故意不写 `overflow:hidden` —— 裁掉的话每张表的最后一行凭空消失，而剩下几行整整齐齐）。第三组数拖到下一页。
- **每张表最多 4 行**（含合计行）。实测：内容区 862px − 标题条 83 − `margin-top:26` − 脚注 42 − 结论条 55 = 656px，减 26px 间距后每格 315px；一格里小标题 47px + 表头 48px = 95px，一行 49px → 4 行还剩 24px 余量，**第 5 行起压到下面那张表的小标题上**。带 `lead` 时每格只有 289px → **3 行**。
- 两张表的行数不必一样（3 + 4 完全可以），但**都不许超过 4**。加起来十几行的内容要么拆两页，要么改用单表那一档分两页排。

### 3. 每格的小标题行 · `.l57-cap`

- 左边 `<h3>`（26px，**12 字以内**）说这张表是什么；右边 `.l57-unit` 是**这张表自己的**单位/口径（1–2 项）。
- **两格各写一行 `.l57-unit`，一行都不能省。** 只写上面那一张的话，读的人默认它管两张表 —— 「元」被套到下面那张的「工作日」上，「3.2」到底是万元还是天全靠猜，而这一页排得整整齐齐（代码会点名说出来）。
- 别在这里写整句说明（`<h3>` 长到换行之后那一格的表少一行的位置，最后一行被顶到下一格上）。整句说明写进 `.dt-src`。
- **不要用页面右上角那条 `.dt-unit`**（单表那一档的单位行）：它右对齐在整页顶上，读起来像「这一页所有数的单位」，正好是这一条要治的那种误读。

### 4. 两张表 · `<table class="dt-table">`

- 表格样式是**共用组件**（同 `.rp-head`），单表那一档用的是同一份 CSS：深底反白表头 + 首列加粗 + 数字列 `class="num"` + 最多一行 `<tr class="on">`。L57 只把字号压小一档（18px / `padding:12px 20px`），HTML 写法完全一样。
- **列数 2–5**（每张表各自算）。**两张表的列数不必相同** —— 这正是选这一条的理由；硬凑成一样的列数等于又把两个口径并回去了。
- **每格 8 字以内**（比单表那一档还紧一点：字号小了但列也短了）。长句写进格子里那一行自己撑高两倍，把下面那张表顶下去。
- `table-layout:fixed`，**列宽只写在 `<th>` 上**（写在 `<td>` 上不生效，而表格照样渲染，只是列宽是浏览器按第一行内容猜的）。
- **数字列整列都标 `class="num"`**（只标一半的话那一列半左半右，一列对不齐的数字看起来只是「排得糙」，读的人照旧拿它比大小）。
- **不许 `colspan` / `rowspan`**，**不许 `overflow:auto`**（投出来的稿子没人去滚一个格子，超出的行就是不存在）。
- 两张表的**表头配色要一样**（都是 `var(--c-ink-deep)`）。给其中一张换品牌色底的话读起来像「这张更重要」，而它们本来是平级的两组数。

### 5. 脚注与结论条 · `.dt-src` / `.rp-foot`

- `.dt-src` 一条就够（两张表的来源写在同一句里，用「；」隔开）；两张表之间不要各插一条脚注（那 42px 是从表格高度里扣的，扣完每张表少一行）。
- **`.rp-foot` 必须写**，而且要说**两张表之间的关系**（「工期长的那两档单价反而低」）—— 只把两张表摆在一页上，读的人不知道该横着对还是各看各的。

---

## 三、CSS 骨架

```css
.rp-head{padding-bottom:20px;border-bottom:2px solid var(--c-ink-deep)}
.rp-head .page-title{font-family:var(--sans);font-size:52px;font-weight:800;color:var(--c-ink-deep);line-height:1.18;letter-spacing:-.01em;margin-top:0}
.rp-head .lead{font-size:20px;line-height:1.7;color:var(--c-ink);margin-top:18px;max-width:1180px}
.rp-foot{margin-top:auto;padding-top:20px;border-top:1px solid var(--c-hairline);font-size:21px;line-height:1.6;color:var(--c-ink-deep)}
.rp-foot b{font-weight:800;color:var(--c-brand-deep)}
.dt-table{width:100%;table-layout:fixed;border-collapse:collapse;font-size:20px;color:var(--c-ink)}
.dt-table th,.dt-table td{padding:16px 22px;text-align:left;vertical-align:middle;border-bottom:1px solid var(--c-hairline);overflow-wrap:break-word}
.dt-table thead th{background:var(--c-ink-deep);color:#fff;font-size:19px;font-weight:700;line-height:1.4;letter-spacing:.02em;border-bottom:0}
.dt-table tbody td:first-child{font-weight:700;color:var(--c-ink-deep)}
.dt-table .num{font-family:var(--num);font-variant-numeric:tabular-nums;text-align:right;font-weight:700;color:var(--c-ink-deep)}
.dt-table thead th.num{color:#fff}
.dt-table tbody tr.on{background:var(--hl-o)}
.dt-table tbody tr.on td{border-bottom:0;font-weight:800;color:var(--c-brand-deep);border-top:2px solid var(--c-brand)}
.dt-src{margin-top:16px;font-size:15px;line-height:1.7;color:var(--c-ink-soft)}
/* L57 双表页：两格 flex:1 均分，每格「小标题 + 自己的单位/口径」+ 一张表 */
.l57-stack{flex:1;min-height:0;display:flex;flex-direction:column;gap:26px;margin-top:26px}
.l57-block{flex:1;min-height:0;display:flex;flex-direction:column}
.l57-cap{display:flex;align-items:baseline;justify-content:space-between;gap:24px;margin-bottom:13px}
.l57-cap h3{font-size:26px;font-weight:800;line-height:1.3;letter-spacing:-.01em;color:var(--c-ink-deep)}
.l57-unit{flex:none;display:flex;gap:22px;font-size:16px;line-height:1.4;letter-spacing:.04em;color:var(--c-ink-soft)}
.l57-block .dt-table{font-size:18px}
.l57-block .dt-table th,.l57-block .dt-table td{padding:12px 20px}
.l57-block .dt-table thead th{font-size:17px}
```

---

## 四、build-part 结构模板

```html
<section class="slide" data-layout="L57">
  <div class="slide-inner">
    <div class="rp-head">
      <h1 class="page-title">{{两张表合起来在回答的那个问题}}</h1>
    </div>
    <div class="l57-stack">
      <div class="l57-block">
        <div class="l57-cap">
          <h3>{{第一张表是什么，12 字内}}</h3>
          <div class="l57-unit"><span>单位：{{这张表的单位}}</span><span>口径：{{这张表的口径}}</span></div>
        </div>
        <table class="dt-table">
          <thead>
            <tr>
              <th style="width:300px">{{对象列}}</th>
              <th class="num">{{数字列 1}}</th>
              <th class="num">{{数字列 2}}</th>
            </tr>
          </thead>
          <tbody>
            <tr><td>{{对象}}</td><td class="num">{{数}}</td><td class="num">{{数}}</td></tr>
            <tr><td>{{对象}}</td><td class="num">{{数}}</td><td class="num">{{数}}</td></tr>
            <tr class="on"><td>{{合计 / 结论行，可省}}</td><td class="num">{{数}}</td><td class="num">{{数}}</td></tr>
          </tbody>
        </table>
      </div>
      <div class="l57-block">
        <div class="l57-cap">
          <h3>{{第二张表是什么，和上面那张口径不同}}</h3>
          <div class="l57-unit"><span>单位：{{这张表自己的单位}}</span></div>
        </div>
        <table class="dt-table">
          <thead>
            <tr>
              <th style="width:300px">{{对象列，列数不必和上面一样}}</th>
              <th>{{文字列}}</th>
              <th class="num">{{数字列}}</th>
            </tr>
          </thead>
          <tbody>
            <tr><td>{{对象}}</td><td>{{一句 8 字内}}</td><td class="num">{{数}}</td></tr>
            <tr><td>{{对象}}</td><td>{{一句 8 字内}}</td><td class="num">{{数}}</td></tr>
            <tr><td>{{对象}}</td><td>{{一句 8 字内}}</td><td class="num">{{数}}</td></tr>
          </tbody>
        </table>
      </div>
    </div>
    <div class="dt-src">{{两张表的来源写在同一句里，用「；」隔开}}</div>
    <div class="rp-foot">{{两张表之间的关系}}<b>{{关键半句}}</b></div>
  </div>
</section>
```

---

## 五、图槽位

0 个 —— **这一条不放图**（两张表已经占满内容区，塞图只能把列压窄到换行）。**图表截图也禁用**。

---

## 六、变体

| 编号 | 变化 | 用途 |
|------|------|------|
| V1 | 去掉 `.dt-src` | 数据来源不用交代（两张表各多 40px 余量） |
| V2 | 两格都去掉 `<tr class="on">` | 没有合计/结论行 |
| V3 | 上表 4 行 + 下表 3 行 | 两组数本来就不一样长 |
| V4 | `.l57-unit` 只写一项（单位，不写口径） | 口径已在标题里说清 |
| V5 | 下面那张表的首列换成序号列（`width:90px` 的 `.num`） | 下表是清单式的 |
| V6 | `.l57-stack` 的 `gap` 用 inline style 改成 34px | 两张表各 3 行、想让两块分得更开 |

---

## 七、design 提示

- **两组口径不同的数各占一张表**：这一条的全部意义就在这里 —— 并进一张表之后列头只能取一个口径，读的人拿它套另一组数，而那张表排得整整齐齐、一处都不报错
- **只能两张表、每张最多 4 行**（带 `lead` 是 3 行）：超了从下沿漏出去压在下一张的小标题上，出来是字叠字的一页
- **每张表各写一行 `.l57-unit`**：省掉一行的话上面那张的单位被套到下面那张上（代码会点名说出来）
- **只有一组数时不要用这一条**（下面那格空着，看起来像「这一页没排完」）；十几行一组的数也不用这一条（拆两页排）
- **两张表的表头配色要一样**：换一张的颜色读起来像「这张更重要」，而它们是平级的两组数
- **结论条必须写两张表之间的关系**：只把两张表摆在一页上，读的人不知道该横着对还是各看各的
- **配色**：表头 `var(--c-ink-deep)` + `#fff`，**没有斑马纹**（页纯白，行靠 `border-bottom` 那条 `--c-hairline` 分隔），合计行 `var(--hl-o)` + `var(--c-brand)` 上边线，小标题 `var(--c-ink-deep)`，单位/口径和脚注 `var(--c-ink-soft)`
- 整份最多一页双表页，且别和别的表格页/图表页相邻（连着两页表翻起来像同一页没动）
