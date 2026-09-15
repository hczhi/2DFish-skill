# L45 · `data-table-sheet`（数据表页：报告风标题条 + 全宽数据表 + 结论条）

> **📄 详情**：本文件供 design 阶段匹配到 L45 时**必读**。
> **★ 核心原则**：结构是灵魂，颜色/内容不绑死。所有配色必须用 `var(--c-*)` 变量。

---

## 一、结构速览

- **比例**：16:9，浅底，**整库唯一的真表格页**（表头 3–6 列 × 表体最多 8 行，每格 10 字以内 ≈ 300–500 字）
- **核心手法**：① 顶部报告风标题条（`.rp-head`，建议带一行 `lead` 说清这张表在比什么）；② 右对齐的**单位/口径行**（`.dt-unit`）；③ **全宽 `<table class="dt-table">`**：深底反白表头 + 偶数行白底斑马纹 + 首列加粗 + 数字列 `class="num"` 右对齐等宽 + 最多一行 `<tr class="on">` 作合计/结论行；④ 表下 `.dt-src` 写数据来源；⑤ 底部结论条（`.rp-foot`）
- **是否全幅**：否 —— 全部内容包在 `.slide-inner` 里
- **底色**：默认不加类
- **什么时候用**：报价/预算表、参数对照表、分项指标表、排期表、评分表 —— 任何「几列口径 × 几行对象」、要横向纵向对着读的内容。只有 3–6 个孤立大数字请用 L5，要写整句说明的清单请用 L38

---

## 二、结构拆解

### 1. 标题条 · `.rp-head`

标题**必须写成 `<h1 class="page-title">`**（页脚目录面板靠它取标题）。这一页的 `lead` 尽量写：一句话说清这张表在比什么、按什么排序。表格是整份里最容易被跳过的一页，没有这句话读的人得自己从表头猜。

### 2. 单位 / 口径行 · `.dt-unit`

右对齐的一行小字（可以放 1–3 项，如「单位：万元」「口径：含税」「统计截至 2026-08」）。
**单位必须出现在这里或 `.dt-src` 里**：格子里写着「3.2」，是万亿还是亿只有写表的人知道，而缺了单位的表看起来是一张排得很干净的完整表格，读的人只会照自己的假设去比大小。这一页放不下的口径写进 `.dt-src`。

### 3. 表 · `.dt-table`（包在 `.dt-wrap` 里）

- **表体最多 8 行（含那一行合计）。** 实测：整套结构（标题条 + `lead` + 单位行 + 表头 + 脚注 +
  结论条）之后留给表体的是 555px，一行 62px → 8 行刚好。第 9 行起表格从 `.dt-wrap` 下沿**漏出去**
  （这一层是 `flex:1`，高度被剩余空间钉死），压在 `.dt-src` 和 `.rp-foot` 上 —— 第 9 行压脚注、
  第 10 行起压结论条，出来是字叠字的一页。去掉 `lead` 和脚注（V2/V5）能到 9 行。
  真有十几行请拆两页，或按 V4 压行高（一行 52px → 10 行）。
- **一张表只放一组口径的数。** 两组口径不同的数（报价 + 工期、去年 + 今年两套指标、A 方案 + B 方案）
  并进这一张表之后，列头只能取一个口径，读的人拿它去套另一组数（「工期那两列的单位也是元？」），
  而那张表列数、斑马纹、合计行全都正常、一处都不报错。这种内容用**双表**那一档
  （一页上下两张表，各带自己的表头和单位/口径行）—— 不是在这张表上多加几列。
- **列数 3–6。** 7 列起每列不到 220px，表头那几个词各自换成两行，行高被顶到 90px 以上，
  于是表体只放得下 5 行 —— 而那 5 行本身排得很正常。
- **每格 10 字以内。** 长句写进格子里 = 那一行自己撑高两倍，把别的行挤出画面。
- `table-layout:fixed` + `width:100%`：列宽平分，不跟着内容乱跳。要给某一列定宽就在
  `<thead>` 的那个 `<th>` 上写一句 `style="width:220px"`，**别在 `<td>` 上写**（fixed 布局只认第一行）。
- 数字列**整列**都要标 `class="num"`（`<th>` 和每个 `<td>` 都标）：这个类给的是等宽数字 +
  右对齐。只标一半的话那一列半左半右，而「一列数字没对齐」看起来只是排得糙，读的人照旧拿它比大小。
- 合计/结论行写 `<tr class="on">`，**最多一行**（全标等于没标）。它自带上方 2px 品牌色线，
  所以它必须是最后一行或者视觉上确实是「小计」。
- **不许 `colspan` / `rowspan`**：跨列数算错时整行往左错一格，而每一格都还有字、表格照旧渲染，
  对不上的只是列口径。
- **不许给表或 `.dt-wrap` 加 `overflow:auto`**：投出来的稿子没人去滚一个格子，超出的行就是不存在。

### 4. 脚注与结论 · `.dt-src` / `.rp-foot`

`.dt-src` 一行灰字写数据来源/口径补充（可省）。`.rp-foot` 一句结论（`<b>` 圈出关键词），
它靠 `margin-top:auto` 贴在页底 —— 表格行数少的时候中间那块空白就是留给它的。

---

## 三、CSS 骨架

```css
/* 报告风共用：标题条 + 结论条 */
.rp-head{padding-bottom:20px;border-bottom:2px solid var(--c-ink-deep)}
.rp-head .page-title{font-family:var(--sans);font-size:52px;font-weight:800;color:var(--c-ink-deep);line-height:1.18;letter-spacing:-.01em;margin-top:0}
.rp-head .lead{font-size:20px;line-height:1.7;color:var(--c-ink);margin-top:18px;max-width:1180px}
.rp-foot{margin-top:auto;padding-top:20px;border-top:1px solid var(--c-hairline);font-size:21px;line-height:1.6;color:var(--c-ink-deep)}
.rp-foot b{font-weight:800;color:var(--c-brand-deep)}
/* 表格共用 .dt-*（L45 起这一族都用它） */
.dt-wrap{flex:1;min-height:0;margin-top:30px}
.dt-table{width:100%;table-layout:fixed;border-collapse:collapse;font-size:20px;color:var(--c-ink)}
.dt-table th,.dt-table td{padding:16px 22px;text-align:left;vertical-align:middle;border-bottom:1px solid var(--c-hairline);overflow-wrap:break-word}
.dt-table thead th{background:var(--c-ink-deep);color:#fff;font-size:19px;font-weight:700;line-height:1.4;letter-spacing:.02em;border-bottom:0}
.dt-table tbody tr:nth-child(even){background:var(--c-card)}
.dt-table tbody td:first-child{font-weight:700;color:var(--c-ink-deep)}
.dt-table .num{font-family:var(--num);font-variant-numeric:tabular-nums;text-align:right;font-weight:700;color:var(--c-ink-deep)}
.dt-table thead th.num{color:#fff}
.dt-table tbody tr.on{background:var(--hl-o)}
.dt-table tbody tr.on td{border-bottom:0;font-weight:800;color:var(--c-brand-deep);border-top:2px solid var(--c-brand)}
.dt-unit{display:flex;justify-content:flex-end;gap:26px;margin-top:22px;font-size:16px;color:var(--c-ink-soft);letter-spacing:.04em}
.dt-src{margin-top:16px;font-size:15px;line-height:1.7;color:var(--c-ink-soft)}
```

---

## 四、build-part 结构模板

```html
<section class="slide" data-layout="L45">
  <div class="slide-inner">
    <div class="rp-head">
      <h1 class="page-title">{{标题}}</h1>
      <div class="lead">{{一句话：这张表在比什么、按什么排的}}</div>
    </div>
    <div class="dt-unit">
      <span>{{单位：万元}}</span>
      <span>{{口径：含税}}</span>
    </div>
    <div class="dt-wrap">
      <table class="dt-table">
        <thead>
          <tr>
            <th style="width:260px">{{第一列表头，如"项目"}}</th>
            <th>{{列口径 2}}</th>
            <th>{{列口径 3}}</th>
            <th class="num">{{数字列口径}}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>{{对象 1，10 字内}}</td>
            <td>{{10 字内}}</td>
            <td>{{10 字内}}</td>
            <td class="num">{{数字}}</td>
          </tr>
          <tr>
            <td>{{对象 2}}</td>
            <td>{{10 字内}}</td>
            <td>{{10 字内}}</td>
            <td class="num">{{数字}}</td>
          </tr>
          <tr>
            <td>{{对象 3}}</td>
            <td>{{10 字内}}</td>
            <td>{{10 字内}}</td>
            <td class="num">{{数字}}</td>
          </tr>
          <tr>
            <td>{{对象 4}}</td>
            <td>{{10 字内}}</td>
            <td>{{10 字内}}</td>
            <td class="num">{{数字}}</td>
          </tr>
          <tr class="on">
            <td>{{合计 / 结论行，最多一行}}</td>
            <td>—</td>
            <td>—</td>
            <td class="num">{{合计数}}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <div class="dt-src">{{数据来源 / 口径补充，没有就删掉这一行}}</div>
    <div class="rp-foot">{{一句结论，关键词用 <b>b</b> 圈出}}</div>
  </div>
</section>
```

---

## 五、图槽位

| 槽位 | 必填? | 模式 | 比例 | 构图要求 |
|------|-------|------|------|----------|
| —    | —     | —    | —    | **这一条不放图**：表格已经占满内容区，塞一张图只能把列压窄到换行（而换行后的表看起来只是"行高不齐"）。要图文对照的清单用 L38，要配图的数据页用 L5 |

**禁用**：任何 `<img>` / 背景图 / 图表截图（截图里的数字放大后是糊的，而它在编辑器里看着清楚）

---

## 六、变体

| 编号 | 变化 | 用途 |
|------|------|------|
| V1 | 去掉合计行（不写 `<tr class="on">`） | 这张表没有可加总的口径 |
| V2 | 去掉 `.dt-src` | 数据是自己的，没有外部来源 |
| V3 | 首列换成序号列（`<th class="num" style="width:90px">`，对象名挪到第二列） | 条目多、要按编号口头指认 |
| V4 | 行高压到 `padding:11px 22px`（inline style 覆盖，一行 52px → 10 行） | 真有 9–10 行，**只在放不下时用** |
| V5 | 去掉 `lead`，口径全放 `.dt-unit`（两项） | 表头已经说清了在比什么 |
| V6 | 表头改品牌色底（`background:var(--c-brand);color:#fff`） | 一份里第二页表格，避免和上一页看起来一样 |

---

## 七、design 提示

- **表体最多 8 行（含合计行）**：第 9 行起表格漏出 `.dt-wrap` 压在脚注/结论条上（字叠字）；去掉 `lead` 和脚注能到 9 行
- **列数 3–6**：7 列起表头各自换两行、行高顶到 90px 以上，表体只剩 5 行放得下
- **每格 10 字以内**：长句撑高那一行，把别的行挤出画面；要写句子的用 L38
- **数字列整列都标 `class="num"`**：只标一半 = 那一列半左半右，看起来只是"排得糙"，读的人照旧拿它比大小
- **`class="on"` 最多一行**，**不许 `colspan` / `rowspan`**（错一格照样渲染），**不许 `overflow:auto`**（没人滚投影）
- **单位/口径必须写**（`.dt-unit` 或 `.dt-src`）：缺了它这一页仍然是一张干净完整的表
- **一张表只放一组口径的数**：两组口径不同的数（报价 + 工期、去年 + 今年）并进来之后列头只能取一个口径，读的人拿它去套另一组数，而表格排得整整齐齐 —— 那种内容用**双表**那一档（一页两张各带表头和单位的表），不是在这张表上多加几列
- **配色**：表头底 `var(--c-ink-deep)` + 字 `#fff`（暗底白字不走变量），斑马纹 `var(--c-card)`（白 —— `var(--bg-plain)` 和浅色页底色是同一个色值，写它等于没有斑马纹），合计行 `var(--hl-o)` + 上线 `var(--c-brand)`，脚注/单位 `var(--c-ink-soft)`
- **整份最多两页表格页**，且别相邻（连着两页表格翻起来像同一页没动）
- **与 L5 的区别**：L5 是 3–6 个大数字（一眼看结论），L45 是要横向纵向对着读的表
- **与 L38 的区别**：L38 每行是"小标题 + 2–3 行说明"的清单（能吃字），L45 每格只有一个词或一个数
- **与 L26 的区别**：L26 是两栏对照（A vs B 各自成块），L45 是多行多列的矩阵
