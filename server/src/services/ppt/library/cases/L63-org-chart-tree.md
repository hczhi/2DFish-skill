# L63 · `org-chart-tree`（内容页：居中标题 + 顶层色块 + 2–4 条分支列「分支卡 + 下挂小项」+ 底部结论条）

> **📄 详情**：本文件供 design 阶段匹配到 L63 时**必读**。
> **★ 核心原则**：结构是灵魂，颜色/内容不绑死。所有配色必须用 `var(--c-*)` 变量。

---

## 一、结构速览

- **比例**：16:9，在 `.slide-inner` 里。居中标题 + 一行副标 → 居中的**顶层色块**（品牌色，写「谁管总」）→ 一条竖线落到通栏横线 → **2–4 条分支列**，每列是一张分支卡（组名 + 一行编制/职责）+ 下面 2–6 条小项 → 底部一条结论条（可选）
- **核心手法**：**这是库里唯一一条能画「层级」的版式** —— 上一层管下一层，靠连接线说出来，而不是靠缩进或者项目符号
- **是否全幅**：否（包 `.slide-inner`，留白由 `--pad-*` 给，这一层别写 padding）
- **页眉照旧贴**：内容页，左上角那行模块名由代码贴（`.slide-header`），**md 和模型都不要写**
- **不放图**：图槽位 0 个。这一页要看的是关系，塞图进去只会把线挤断
- **什么时候用**：**要说清「谁管谁 / 谁向谁汇报」** —— 项目组织架构、组织体系、部门职责分工、治理结构、供应链层级、平台功能分层。**分支 2–4 条**（3 条最稳）。只是把几件事并排讲（没有上下级关系）换 L7/L16 那一族；一页摆人的照片和头衔换 L62

---

## 二、结构拆解（自上而下）

实测（1920×1080、`--pad-*` 默认那一档）：可用区 1640×862，标题区 89px、顶层色块 103px、分支列区 532px、结论条 44px。

### 1. 标题区 · `.l63-head`

- `text-align:center`（这一条的头是**居中**的 —— 树本身是对称的，标题偏左会让整页看起来歪）。
- 标题**必须写成 `<h2 class="page-title">`**（页脚目录面板靠 `.page-title` 取这一页的标题）。40px 衬线，**≤14 字、一行**。
- `<p>` 一行副标（`var(--c-ink-soft)`，**≤30 字**）：说的是这套架构解决什么问题，不是把标题换个说法重复一遍（重复会被 `checkPage` ⑧ 每页报一句）。可以整个去掉（V3）。

### 2. 顶层色块 · `.l63-top`

- `align-self:center`，`min-width:420px;max-width:60%`，底色 `var(--c-brand)`。
- 字色**必须是 `var(--c-brand-on)`**，不许写死 `#fff`：品牌色由每份稿子的配色决定，换成浅品牌色（默认这套的橙对白字只有 2.6:1）之后那两行字读不出来，而浏览器、`checkPage`、导出全都正常。
- `<b>` 一行组名（**≤12 字**）+ `<span>` 一行说明（**≤26 字**，可省）。
- `::after` 是往下那条 38px 竖线，落在 `.l63-cols` 顶上那条横线（y=363）上。**它和 `.l63-cols` 的 `margin-top:38px` 是同一个数**：只改一处的话线要么悬空差一截、要么戳进横线下面，而两处都在、画面正常。

### 3. 分支列 · `.l63-cols` / `.l63-col`

- `display:flex` + `gap:34px`，每列 `flex:1`：**列数 2–4 条随内容变**，宽度自己分（2 列 803px / 3 列 524px / 4 列 385px）。
- **连接线是每一列自己画的**，不是一整根横贯的线：一整根线的两端要落在「第一列中心」和「最后一列中心」上，而这两个位置在纯 CSS 里算不出来（列数不固定）。所以每列画一段 `::after`（`left:-17px;right:-17px` 伸进列间距里把段接上），第一列那段从 `left:50%` 起、最后一列那段到 `right:50%` 止；`::before` 是这一列往下那条 36px 竖线。
- **列间距只能是 34px**：改了 `gap` 而不跟着改那两个 `-17px`，横线会在每两列之间断开几个像素 —— 看起来像「这条线本来就是虚的」，而每一格都渲染正常、一处都不报错。
- 分支卡 `.l63-box`：顶一条 3px `var(--c-accent)` 的线 + 白底，`<b>` 组名（**≤10 字**）+ `<span>` 一行编制/职责（**≤22 字**）。主责的那一列给 `.l63-col` 加 `on` 类（顶线和组名转品牌色）。
- 小项 `.l63-list > div`：一条 54px（一行字）+ 12px 间距，可用高度 382px —— **一行字的话每列最多 6 条**（第 6 条底 895px 对列底 896px），**7 条起最后一条压在底部那条结论线上**（不裁、不报错，看起来像「这一条是另起的一段」）。写两行的小项算 80px（4 条为限）。
- **各列条数差 ≤2**：差太多时短的那列下面空一大块，而长的那列顶到底，整排看起来像没排完。

### 4. 结论条 · `.l63-foot`（可选）

- 贴在页底（`.l63-cols` 吃掉中间的空高），顶一条 1px `var(--c-hairline)`，17px，**≤60 字、一行**。
- 写的是「这套架构怎么运转」（例会节奏、跨组的事谁落人），不是再重复一遍组名。

---

## 三、CSS 骨架

```css
/* L63 内容页（组织架构）：居中标题 + 顶层色块 + 2–4 条分支列（分支卡 + 下挂 2–6 条小项）+ 底部结论条 */
.l63-wrap{flex:1;min-height:0;display:flex;flex-direction:column}
.l63-head{text-align:center}
.l63-head .page-title{font-family:var(--serif);font-size:40px;font-weight:900;line-height:1.2;letter-spacing:-.01em;color:var(--c-ink-deep);margin-top:0}
.l63-head p{margin-top:12px;font-size:17px;line-height:1.7;color:var(--c-ink-soft)}
.l63-top{position:relative;align-self:center;margin-top:34px;min-width:420px;max-width:60%;padding:20px 34px;background:var(--c-brand);text-align:center}
.l63-top b{display:block;font-size:25px;font-weight:800;line-height:1.3;color:var(--c-brand-on)}
.l63-top span{display:block;margin-top:6px;font-size:16px;line-height:1.5;color:var(--c-brand-on);opacity:.86}
.l63-top::after{content:"";position:absolute;left:50%;top:100%;width:2px;height:38px;background:var(--c-ink-soft)}
.l63-cols{flex:1;min-height:0;margin-top:38px;display:flex;gap:34px}
.l63-col{position:relative;flex:1;min-width:0;padding-top:36px;display:flex;flex-direction:column}
.l63-col::before{content:"";position:absolute;top:0;left:50%;width:2px;height:36px;background:var(--c-ink-soft)}
.l63-col::after{content:"";position:absolute;top:0;left:-17px;right:-17px;height:2px;background:var(--c-ink-soft)}
.l63-col:first-child::after{left:50%}
.l63-col:last-child::after{right:50%}
.l63-box{padding:16px 22px;background:var(--c-card);border-top:3px solid var(--c-accent)}
.l63-box b{display:block;font-size:24px;font-weight:800;line-height:1.3;color:var(--c-ink-deep)}
.l63-box span{display:block;margin-top:7px;font-size:16px;line-height:1.6;color:var(--c-ink)}
.l63-list{flex:1;min-height:0;margin-top:16px;display:flex;flex-direction:column;gap:12px}
.l63-list div{flex:none;padding:14px 18px;background:var(--c-bg-alt);font-size:17px;line-height:1.5;color:var(--c-ink-deep)}
.l63-foot{flex:none;margin-top:22px;padding-top:16px;border-top:1px solid var(--c-hairline);font-size:17px;line-height:1.6;color:var(--c-ink)}
.l63-col.on .l63-box{border-top-color:var(--c-brand)}
.l63-col.on .l63-box b{color:var(--c-brand-deep)}
```

---

## 四、build-part 结构模板

```html
<section class="slide" data-layout="L63">
  <!-- 左上角那行模块名由代码统一贴，这里不要写 -->
  <div class="slide-inner">
  <div class="l63-wrap">
    <div class="l63-head">
      <h2 class="page-title">{{这一页的标题，14 字内}}</h2>
      <p>{{一行副标：这套架构解决什么问题，30 字内}}</p>
    </div>
    <div class="l63-top">
      <b>{{最上面那一层的名字，12 字内}}</b>
      <span>{{一行说明：由谁组成、多久碰一次，26 字内}}</span>
    </div>
    <div class="l63-cols">
      <div class="l63-col on">
        <div class="l63-box">
          <b>{{分支一的名字}}</b>
          <span>{{几个人 · 对什么负责}}</span>
        </div>
        <div class="l63-list">
          <div>{{这个分支具体干的一件事}}</div>
          <div>{{第二件}}</div>
          <div>{{第三件}}</div>
        </div>
      </div>
      <div class="l63-col">
        <div class="l63-box">
          <b>{{分支二的名字}}</b>
          <span>{{几个人 · 对什么负责}}</span>
        </div>
        <div class="l63-list">
          <div>{{一件事}}</div>
          <div>{{第二件}}</div>
          <div>{{第三件}}</div>
        </div>
      </div>
      <div class="l63-col">
        <div class="l63-box">
          <b>{{分支三的名字}}</b>
          <span>{{几个人 · 对什么负责}}</span>
        </div>
        <div class="l63-list">
          <div>{{一件事}}</div>
          <div>{{第二件}}</div>
          <div>{{第三件}}</div>
        </div>
      </div>
    </div>
    <div class="l63-foot">{{一句结论：这套架构怎么运转，60 字内}}</div>
  </div>
  </div>
</section>
```

---

## 五、图槽位

**0 个** —— 这一页要看的是层级关系，不配图。要人像换 L62，要场景图换 L11/L16。

---

## 六、变体

| 编号 | 变化 | 用途 |
|------|------|------|
| V1 | 2 条分支（每列 803px） | 只有两条线，小项可写两行 |
| V2 | 4 条分支（每列 385px） | 组多；组名压到 8 字内 |
| V3 | 去掉 `.l63-head p` | 标题自己够说明白 |
| V4 | 去掉 `.l63-foot` | 不需要收一句 |
| V5 | 去掉某一列的 `.l63-list` | 那个分支只有名字（此时各列都别放小项，只留一排卡） |
| V6 | 顶层色块 inline style 改 `var(--c-ink-deep)` | 需要更冷静的头（字色照旧留 `var(--c-brand-on)` 那一档的深浅关系，别写死白色） |
| V7 | `.l63-col` 加 `on` 类 | 点出主责的那一条分支 |

---

## 七、design 提示

- **分支 2–4 条**：5 条起每列只剩 306px，组名换行、小项一条挤成三行，而每一格都渲染正常。真有 5 个以上的组，就把同级的合并成「组」再往下挂
- **列间距只能是 34px**（`.l63-col::after` 那两个 `-17px` 是按它算的）：改了 gap 横线会在每两列之间断开几个像素，看起来像本来就是虚线
- **每列小项 2–6 条**（一行字）：7 条起最后一条压在底部那条结论线上；**各列条数差 ≤2**，差太多整排看起来像没排完
- **顶层色块的字色走 `var(--c-brand-on)`**，不许写死 `#fff`：浅品牌色的配色里白字读不出来，而一处都不报错
- **顶层那条竖线（38px）和 `.l63-cols` 的 `margin-top:38px` 要一起改**：只改一处的话线悬空或者戳过头
- **标题必须是 `.page-title`**（页脚目录面板按它取标题，换个类之后目录里这一页是空的）
- **别给 `.l63-wrap` 写 padding**（留白由 `.slide-inner` 的 `--pad-*` 给，改了它标题会被左上角那行模块名压住）
- **这一条不放图**：塞图进来会把连接线挤断，而线断了这一页就不再是架构图
- **配色**：标题 `var(--c-ink-deep)`、副标 `var(--c-ink-soft)`、顶层块 `var(--c-brand)` + 字 `var(--c-brand-on)`、连接线 `var(--c-ink-soft)`、分支卡顶线 `var(--c-accent)`（主责那列 `var(--c-brand)`）、小项底 `var(--c-bg-alt)`、结论条 `var(--c-ink)`
- **与 L62 的区别**：L62 是一页摆几个人（人像 + 姓名 + 头衔），说的是「有谁」；L63 说的是「谁管谁」，没有照片
- **与 L7 / L16 那一族的区别**：那些是几件事**并排**（没有上下级），L63 多了最上面那一层和连接线 —— 内容里没有汇报关系的话别挑它（画出来的线在说一件不存在的事）
- **与 L50 的区别**：L50 是分层堆叠的架构图（一层压一层，讲系统分层）；L63 是往下分叉的树（讲人和组织）
- **整份最多一页 L63**，放在方案/组织保障那一段
