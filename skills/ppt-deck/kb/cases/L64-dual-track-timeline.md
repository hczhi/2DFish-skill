# L64 · `dual-track-timeline`（内容页：报告风标题条 + 上轨卡片行 + 中间阶段轴 + 下轨卡片行 + 结论条）

> **📄 详情**：本文件供 design 阶段匹配到 L64 时**必读**。
> **★ 核心原则**：结构是灵魂，颜色/内容不绑死。所有配色必须用 `var(--c-*)` 变量。

---

## 一、结构速览

- **比例**：16:9，在 `.slide-inner` 里。报告风标题条（`.rp-head`）→ 上轨一行卡片（左边一个轨道名 + N 张卡）→ 中间阶段轴（一整根横线 + N 个圆点 + 阶段名/时间）→ 下轨一行卡片（同构，换成 accent 配色）→ 底部结论条（`.rp-foot`）
- **核心手法**：**同一条时间轴上并行的两条线** —— 上面一条是「我们做什么」，下面一条是「同期对方要配合什么」，每个阶段两边各一件事，谁欠谁的一眼看得出来
- **是否全幅**：否（包 `.slide-inner`，留白由 `--pad-*` 给，这一层别写 padding）
- **页眉照旧贴**：内容页，左上角那行模块名由代码贴（`.slide-header`），**md 和模型都不要写**
- **不放图**：图槽位 0 个（两排卡片 + 一根轴已经占满，塞图进来卡片只剩一行字）
- **什么时候用**：**一条时间轴上有两方/两条线在并行推进** —— 实施排期的「我方交付 / 贵方配合」、「线上 / 线下」、「产品 / 市场」、「建设 / 运营」、每阶段的「做什么 / 产出什么」。**阶段 3–5 段**（4 段最稳）。只有一条线的时间轴换 L6 / L25 / L44；要画甘特那种「跨几个月的横条」**别选它**（条的起止得在代码里算，硬规则 3）

---

## 二、结构拆解（自上而下）

实测（1920×1080、`--pad-*` 默认那一档）：可用区 1640×862（y 100→962）。标题条 135px（100→235，含 `.lead`）、`.l64-body` 261→907（646px）、上轨行 354→522（168px）、阶段轴 544→624（80px）、下轨行 646→814（168px）、结论条 907→962（55px）。

### 1. 标题条 · `.rp-head`（报告风共用）

- `h2.page-title`（52px，**≤12 字**）+ 可选 `p.lead`（20px，**≤44 字一行**）。标题**必须是 `.page-title`**（页脚目录面板按它取这一页的标题）。
- `.lead` 说的是「这两条线各是谁的事」，**不是把标题换个说法重复一遍**（重复会被 自检清单 ⑧ 每页报一句）。

### 2. 两轨 + 轴 · `.l64-body` / `.l64-row` / `.l64-axis`

- **三行各自是一个独立的 flex 行**（上轨 `.l64-row` / 轴 `.l64-axis` / 下轨 `.l64-row.l64-dn`），列能对上靠的是「每行都是 120px 轨道名 + 24px 间距 + 等宽 `flex:1`」，**不是一个 grid**：阶段数 3–5 段不固定，grid 要写 `repeat(N,1fr)`，而那个 N 只有模型知道 —— 它填错一次（写了 4 而实际给了 3 段），整页卡片就和轴上的圆点错开半格，而每一格都渲染正常、一处都不报错。实测三档的圆点中心和卡片中心偏差都是 0：卡片宽 **3 段 483px / 4 段 356px / 5 段 280px**。
- **轴线是一整根**（`.l64-axis::before` 的 `left:144px;right:0`），**144 = 轨道名 120 + 行间距 24**，和 `.l64-axis` 的 `padding-left:144px` 是同一个数：只改一处的话圆点和上下两行的卡片整体错开 24px，看起来像「这个版式本来就是错位的」。
- 圆点外径 20px（14px + 3px+3px 的描边），所以线画在 `top:9px` 上 —— 改了圆点大小要跟着改这个数，不然线从圆点的腰上穿过去（画面上像一条被戳破的轴）。
- `.l64-node`：`<b>` 阶段名（**≤4 字**）+ `<span>` 时间（`var(--num)`，「2026 Q1」「M1–M3」这种）。当前阶段那一个加 `on` 类（圆点填品牌色 + 阶段名转 `var(--c-brand-deep)`）。
- **时间只写在 `.l64-node span` 里**，卡片里别再写一遍日期（两处对不上时没人知道哪个是准的）。

### 3. 轨道名与卡片 · `.l64-lane` / `.l64-card`

- `.l64-lane`：`width:120px` 右对齐 + 右侧 3px 色边（上轨 `var(--c-brand)`、下轨 `var(--c-accent)`）。`<b>` 轨道名（**≤5 字**）+ `<span>` 一行归属（**≤8 字**）。
- `.l64-card`：`min-height:168px` + 垂直居中，`<b>` 一行要点（**≤12 字**）+ `<span>` 说明（**≤2 行**，4 段那档 ≤38 字、5 段 ≤30 字）。下轨的卡片自动换成 `var(--c-bg-alt)` 底 + accent 左边线。
- **上下两轨的卡片数必须和轴上的节点数一样**：少一张卡片时后面所有列往左挪一格，卡片和圆点整体错开，而每一格都渲染正常 —— 这一页看起来只是「排得有点歪」。这个阶段那条线真没事的话放一张 **`.l64-card.off`**（透明 + 虚线左边框的空格，读起来是「这一段这条线不动」）。
- `.l64-body` 用 `justify-content:center`（不是让三行 `flex:1`）：卡片只有两行字时拉满高度是一排空盒子，居中之后上下留白对称（实测各 93px），看起来是「轴摆在页面正中」。
- **溢出是两头一起挤**（因为整块居中）：单格说明约 120 字时卡片长到 248px、还在页内；**150 字时卡片 273px，下轨底 919px 压在结论条那条线（907px）上，同时上轨顶爬到 249px 逼近标题条的 235px** —— 不裁不报错，看起来像「这一页字太多了」。

### 4. 结论条 · `.rp-foot`（可选）

- 17–21px 一行（**≤60 字**），可用 `<b>` 点一个词。写的是「这几个阶段的边界是什么 / 谁延期了会怎样」，不是把四个阶段名再列一遍。

---

## 三、CSS 骨架

```css
.rp-head{padding-bottom:20px;border-bottom:2px solid var(--c-ink-deep)}
.rp-head .page-title{font-family:var(--sans);font-size:52px;font-weight:800;color:var(--c-ink-deep);line-height:1.18;letter-spacing:-.01em;margin-top:0}
.rp-head .lead{font-size:20px;line-height:1.7;color:var(--c-ink);margin-top:18px;max-width:1180px}
.rp-foot{margin-top:auto;padding-top:20px;border-top:1px solid var(--c-hairline);font-size:21px;line-height:1.6;color:var(--c-ink-deep)}
.rp-foot b{font-weight:800;color:var(--c-brand-deep)}

/* L64 内容页（双轨时间线） */
.l64-wrap{flex:1;min-height:0;display:flex;flex-direction:column}
.l64-body{flex:1;min-height:0;margin-top:26px;display:flex;flex-direction:column;justify-content:center}
.l64-row{display:flex;gap:24px;align-items:stretch}
.l64-lane{flex:none;width:120px;padding-right:16px;border-right:3px solid var(--c-brand);display:flex;flex-direction:column;justify-content:center;text-align:right}
.l64-lane b{font-size:19px;font-weight:800;line-height:1.3;color:var(--c-ink-deep)}
.l64-lane span{margin-top:6px;font-size:15px;line-height:1.5;color:var(--c-ink-soft)}
.l64-card{flex:1;min-width:0;min-height:168px;padding:16px 20px;background:var(--c-card);border-left:3px solid var(--c-brand);display:flex;flex-direction:column;justify-content:center}
.l64-card b{display:block;font-size:21px;font-weight:800;line-height:1.35;color:var(--c-ink-deep)}
.l64-card span{display:block;margin-top:8px;font-size:16px;line-height:1.6;color:var(--c-ink)}
.l64-dn .l64-lane{border-right-color:var(--c-accent)}
.l64-dn .l64-card{background:var(--c-bg-alt);border-left-color:var(--c-accent)}
.l64-card.off{background:none;border-left:3px dashed var(--c-hairline)}
.l64-axis{position:relative;margin:22px 0;padding-left:144px;padding-top:30px;display:flex;gap:24px}
.l64-axis::before{content:"";position:absolute;left:144px;right:0;top:9px;height:2px;background:var(--c-ink-deep)}
.l64-node{position:relative;flex:1;min-width:0;text-align:center}
.l64-node::before{content:"";position:absolute;top:-30px;left:50%;margin-left:-10px;width:14px;height:14px;border-radius:50%;background:var(--c-card);border:3px solid var(--c-ink-deep)}
.l64-node b{display:block;font-size:20px;font-weight:800;line-height:1.3;color:var(--c-ink-deep)}
.l64-node span{display:block;margin-top:6px;font-family:var(--num);font-size:16px;font-weight:700;letter-spacing:.06em;color:var(--c-ink-soft)}
.l64-node.on::before{background:var(--c-brand);border-color:var(--c-brand)}
.l64-node.on b{color:var(--c-brand-deep)}
```

**`.l64-card.off` 那一条必须排在 `.l64-dn .l64-card` 后面**（两条都是两个类，权重一样，靠先后定胜负）：反过来的话下轨那一格空卡照旧是一块 accent 底色，看起来像「这一格的字丢了」而不是「这一段这条线不动」。

---

## 四、build-part 结构模板

```html
<section class="slide" data-layout="L64">
  <!-- 左上角那行模块名由代码统一贴，这里不要写 -->
  <div class="slide-inner">
  <div class="l64-wrap">
    <div class="rp-head">
      <h2 class="page-title">{{这一页的标题，12 字内}}</h2>
      <p class="lead">{{一行：这两条线各是谁的事，44 字内}}</p>
    </div>
    <div class="l64-body">
      <div class="l64-row">
        <div class="l64-lane">
          <b>{{上轨名，5 字内}}</b>
          <span>{{谁主责，8 字内}}</span>
        </div>
        <div class="l64-card">
          <b>{{第一阶段这条线做什么，12 字内}}</b>
          <span>{{说明，两行内}}</span>
        </div>
        <div class="l64-card">
          <b>{{第二阶段}}</b>
          <span>{{说明}}</span>
        </div>
        <div class="l64-card">
          <b>{{第三阶段}}</b>
          <span>{{说明}}</span>
        </div>
        <div class="l64-card">
          <b>{{第四阶段}}</b>
          <span>{{说明}}</span>
        </div>
      </div>
      <div class="l64-axis">
        <div class="l64-node on">
          <b>{{阶段名，4 字内}}</b>
          <span>{{时间，如 2026 Q1}}</span>
        </div>
        <div class="l64-node">
          <b>{{阶段名}}</b>
          <span>{{时间}}</span>
        </div>
        <div class="l64-node">
          <b>{{阶段名}}</b>
          <span>{{时间}}</span>
        </div>
        <div class="l64-node">
          <b>{{阶段名}}</b>
          <span>{{时间}}</span>
        </div>
      </div>
      <div class="l64-row l64-dn">
        <div class="l64-lane">
          <b>{{下轨名，5 字内}}</b>
          <span>{{谁主责，8 字内}}</span>
        </div>
        <div class="l64-card">
          <b>{{同期对方要配合的事}}</b>
          <span>{{说明}}</span>
        </div>
        <div class="l64-card">
          <b>{{第二阶段}}</b>
          <span>{{说明}}</span>
        </div>
        <div class="l64-card">
          <b>{{第三阶段}}</b>
          <span>{{说明}}</span>
        </div>
        <div class="l64-card off"></div>
      </div>
    </div>
    <div class="rp-foot">{{一句结论：阶段边界是什么可验收的东西，60 字内}}</div>
  </div>
  </div>
</section>
```

---

## 五、图槽位

**0 个** —— 两排卡片 + 一根轴已经占满。要配图的时间轴换 L25（图标节点），要单轨竖排换 L44。

---

## 六、变体

| 编号 | 变化 | 用途 |
|------|------|------|
| V1 | 3 段（每张卡 483px 宽） | 阶段少；说明可写三行 |
| V2 | 5 段（每张卡 280px 宽） | 阶段多；要点压到 8 字、说明 ≤2 行 |
| V3 | 去掉 `.rp-head .lead` | 标题自己够说明白 |
| V4 | 去掉 `.rp-foot` | 不需要收一句 |
| V5 | 某一格用 `.l64-card.off` | 这个阶段那条线没有事 |
| V6 | 当前阶段的 `.l64-node` 加 `on` 类 | 点出「现在走到哪」 |
| V7 | 两轨换成「做什么 / 产出什么」 | 不是两方而是「动作 / 交付物」两条线 |

---

## 七、design 提示

- **阶段 3–5 段**，**上下两轨的卡片数必须等于轴上的节点数**：少一张后面所有列往左挪一格，卡片和圆点整体错开，而每一格都渲染正常 —— 这一页看起来只是「排得有点歪」。这一段那条线没事就放 `.l64-card.off`
- **轨道名 120px、行间距 24px、`.l64-axis` 的 `padding-left:144px`、轴线的 `left:144px` 是同一组数**（144 = 120 + 24）：改一处圆点就和上下的卡片错开 24px
- **圆点外径 20px 对应轴线 `top:9px`**：改了圆点大小不改这个数，线会从圆点的腰上穿过去
- **单格文字有上限**：说明约 120 字还在页内，**150 字起下轨压到结论条那条线上、上轨同时顶到标题条**（整块居中，超了是两头一起挤，不裁不报错）。写不下就删字，别改 `min-height`
- 轨道名 ≤5 字 + 一行归属 ≤8 字；卡片要点 ≤12 字一行、说明 ≤2 行；阶段名 ≤4 字、时间走 `var(--num)`
- **时间只写在圆点下面**，卡片里别再写日期（两处对不上时没人知道哪个准）
- **标题必须是 `.page-title`**（页脚目录面板按它取标题，换个类之后目录里这一页是空的）；`.lead` 别复述标题（会被 自检清单 ⑧ 每页报一句）
- **别给 `.l64-wrap` 写 padding**（留白由 `.slide-inner` 的 `--pad-*` 给）
- **配色**：标题 `var(--c-ink-deep)`、`.lead` `var(--c-ink)`、轴线和圆点描边 `var(--c-ink-deep)`、上轨 `var(--c-brand)`、下轨 `var(--c-accent)` + `var(--c-bg-alt)` 底、空格 `var(--c-hairline)` 虚线、当前节点 `var(--c-brand)`
- **与 L6 / L25 / L44 的区别**：那三条都是**单轨**（一条线上串 N 个节点）；L64 是同一条轴上下各一条轨，说的是「两方并行」—— 内容里只有一条线的话别挑它（下轨会被编出来）
- **与 L51 的区别**：L51 是三档并列的方案/套餐卡（没有时间），L64 的横向顺序就是时间顺序
- **整份最多一页**，别和 L6 / L44 相邻（两页时间轴挨着翻，看起来像同一页没动过）；它属于报告风那一族（`.rp-head` + `.rp-foot`），也别和 L45 / L47 那几页连排
