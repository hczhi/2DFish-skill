# L44 · `vertical-timeline-five`（竖向时间轴：左侧说明栏 + 右侧 5 个节点）

> **📄 详情**：本文件供 design 阶段匹配到 L44 时**必读**。
> **★ 核心原则**：结构是灵魂，颜色/内容不绑死。所有配色必须用 `var(--c-*)` 变量。

---

## 一、结构速览

- **比例**：16:9，浅底，标准 `.slide-inner` 排版；文字容量中等偏大（左栏标题 + 引言 + 贴底一句，右栏 5 节点各「阶段标签 + 小标题 + 1–2 行」，约 450–560 字）
- **核心手法**：**竖向**时间轴（整库的时序版式此前只有 L6 横向轴 / L25 横向节点）—— 左 460px 说明栏 + 右侧一条通高细线，5 个 24px 空心圆点在自己那一格**正中**，最后一个点是实心（终点）
- **是否全幅**：否（全部内容包在 `.slide-inner` 里）
- **底色**：默认不加类
- **什么时候用**：5 个阶段的推进路线 / 实施节奏 / 里程碑 / 发展沿革 —— 每一步都要写一两句、而横向轴放不下这么多字的时候

---

## 二、结构拆解（左 → 右）

### 1. 说明栏 · `.l44-side`

- 三层：`<h1 class="page-title">`（54px 衬线）→ `<p>`（引言，**5–7 行**）→ `.l44-note`（`margin-top:auto` **贴到栏底**的一句，上面一条细线）。
- 引言**必须写到 5–7 行**（460px 宽 21px 字，约 110–150 字）：贴底那句被 `margin-top:auto` 顶到栏底，引言只写两三行的话左栏中间会空出四五百像素一块，而右边五个节点是满的 —— 页面完整、一处都不报错，看起来只是“这一页左边没写完”。
- 那句贴底的话写**这条轴的判据**（"每一步都能单独验收" / "以季度为单位"）—— 不写的话左栏下半是一大块空白，而右边五个节点是满的，画面重心整体偏右。
- 宽度写死 `460px`：改成 `1fr` 之后左右各半，右侧节点的说明一行只剩十几个字，五行全部换行、把轴撑出内容区（而每一条节点单看都完整）。

### 2. 轴线 · `.l44-axis::before`

- 一条 2px 通高细线，`left:11px` 正好穿过圆点圆心（圆点 24px，`left:-56px` + 容器 `padding-left:56px` → 圆点在 0–24，圆心 12；线在 11–13）。
- 两端那个 **`10%` 是按 5 个节点算的**（`1/(2×5)`：每个节点占 1/5 高、圆点在自己那一格正中，所以第一个和最后一个圆心各在 10% / 90% 处）。**节点数一变这两个数就不对**：4 个节点时轴线两端各穿出圆点 21px，看起来像"轴画长了"，而每一条节点都完整、一处都不报错。

### 3. 节点 · `.l44-step`

- `flex:1` + `justify-content:center`：五个节点**等分**剩余高度（各 172px），内容在自己那一格里垂直居中 —— 所以每一格的文字长度不同也不会让圆点跑位。
- **只能 4–5 个**。6 个起每格压到 140px 以下，小标题和说明各自换行、两条挨在一起看不出分段；7 个起最后一格直接从下缘溢出被裁。**少于 4 个**用 L6（横向轴更舒展）。
- 圆点必须有实底（`background:var(--c-card)`）：透明的话那条轴线从圆点中间穿过去，五个点全变成"甜甜圈上画了一道"，而它照样渲染。
- **最后一个点是实心品牌色**（`:last-child`）：全是空心的话轴的末端和中间节点长得一样，读的人不知道哪一个是终点（而轴线在末端还会往下走一小截）。
- 每个节点三层：`<b>`（阶段/年份，加宽字距 `var(--num)` 品牌色）→ `<h3>`（**12 字以内**）→ `<p>`（**最多 2 行**，`max-width:820px`）。
- 阶段标签要么全是年份、要么全是"第一步/第二步"，**别混着写**：混了之后读者会以为其中几个是并列的、几个是顺序的。

---

## 三、CSS 骨架

```css
/* L44 竖向时间轴（5 节点） */
.l44-grid{flex:1;display:grid;grid-template-columns:460px 1fr;gap:80px;min-height:0;margin-top:8px}
.l44-side{display:flex;flex-direction:column}
.l44-side .page-title{font-family:var(--serif);font-size:54px;font-weight:900;line-height:1.2;color:var(--c-ink-deep);margin-top:0}
.l44-side p{margin-top:20px;font-size:21px;line-height:1.85;color:var(--c-ink)}
.l44-side .l44-note{margin-top:auto;padding-top:22px;border-top:1px solid var(--c-hairline);font-size:18px;line-height:1.7;color:var(--c-ink-deep)}
.l44-axis{position:relative;padding-left:56px;display:flex;flex-direction:column}
.l44-axis::before{content:"";position:absolute;left:11px;top:10%;bottom:10%;width:2px;background:var(--c-hairline)}
.l44-step{position:relative;flex:1;display:flex;flex-direction:column;justify-content:center}
.l44-step::before{content:"";position:absolute;left:-56px;top:50%;margin-top:-12px;width:24px;height:24px;border-radius:50%;background:var(--c-card);border:2px solid var(--c-brand)}
.l44-step:last-child::before{background:var(--c-brand)}
.l44-step b{font-family:var(--num);font-size:15px;font-weight:700;letter-spacing:.2em;color:var(--c-brand)}
.l44-step h3{margin-top:8px;font-size:27px;font-weight:800;line-height:1.35;color:var(--c-ink-deep)}
.l44-step p{margin-top:8px;max-width:820px;font-size:19px;line-height:1.7;color:var(--c-ink)}
```

---

## 四、build-part 结构模板

```html
<section class="slide" data-layout="L44">
  <div class="slide-inner">
    <!-- 页眉由代码贴，这里不要写 -->
    <div class="l44-grid">
      <div class="l44-side">
        <h1 class="page-title">{{标题}}</h1>
        <p>{{引言，5–7 行，说清这条轴是按什么排的}}</p>
        <div class="l44-note">{{贴底一句：这条轴的判据}}</div>
      </div>
      <div class="l44-axis">
        <div class="l44-step"><b>{{阶段/年份}}</b><h3>{{小标题，12 字内}}</h3><p>{{说明，最多 2 行}}</p></div>
        <div class="l44-step"><b>{{阶段/年份}}</b><h3>{{小标题}}</h3><p>{{说明}}</p></div>
        <div class="l44-step"><b>{{阶段/年份}}</b><h3>{{小标题}}</h3><p>{{说明}}</p></div>
        <div class="l44-step"><b>{{阶段/年份}}</b><h3>{{小标题}}</h3><p>{{说明}}</p></div>
        <div class="l44-step"><b>{{阶段/年份}}</b><h3>{{小标题}}</h3><p>{{说明}}</p></div>
      </div>
    </div>
  </div>
</section>
```

---

## 五、图槽位

0 个 —— **这一条不放图**。五个节点已经占满右半，图只能塞进左栏那 460px（变成一张小得看不出内容的图）。需要配图的时序页用 L25（横向节点 + 图标）或 L28。

---

## 六、变体

| 编号 | 变化 | 用途 |
|------|------|------|
| V1 | 4 个节点（轴线两端改 `12.5%`） | 只有四个阶段 |
| V2 | 左右镜像（轴在左、说明栏在右） | 同一份里已经出现过左栏说明 |
| V3 | 圆点改品牌色实心 + 白色小编号 | 想强调步骤顺序 |
| V4 | 去掉 `.l44-note`（引言放长到 9–11 行填满左栏） | 没有可写的判据 |
| V5 | 阶段标签改 40px 大号年份（`<b>` 上加 inline `style="font-size:40px;letter-spacing:0"`） | 沿革/历程类，年份是主角 |
| V6 | 说明栏宽度降到 380px（节点说明多一行） | 节点内容比引言重要 |

---

## 七、design 提示

- **整份最多一页**：竖轴很占版面，第二条时序页换 L6（横向）
- **节点只能 4–5 个**：6 个起每格压到 140px 以下、两条挨在一起看不出分段，7 个起最后一格被裁，而每一条单看都完整
- **轴线两端的 `10%` 跟着节点数改**（5 个 → 10%，4 个 → 12.5%）：不改的话轴线两端穿出首尾圆点，看起来像"轴画长了"
- **圆点必须有实底**：透明的话轴线从圆心穿过去，五个点全变成"甜甜圈上画了一道"
- **最后一个点必须实心**：不然读的人找不到终点
- **引言写到 5–7 行**：贴底那句被顶到栏底，引言太短时左栏中间空一大块，而右边五个节点是满的
- **说明栏宽度写死 460px**：改成 `1fr` 之后右侧五行全换行、把轴撑出内容区
- **阶段标签别混写**（要么全年份、要么全"第几步"）
- **配色**：圆点边和阶段标签 `var(--c-brand)`，圆点内 `var(--c-card)`，轴线和分隔线 `var(--c-hairline)`，正文 `var(--c-ink)` / 小标题 `var(--c-ink-deep)`
- **与 L6 的区别**：L6 是横向时间轴（节点卡片，每个只放一句），L44 是竖向（每个能放一两句 + 左边还有一栏说明）
- **与 L25 的区别**：L25 是横向图标节点（轴上挂图标，偏"流程"），L44 偏"节奏/里程碑"（有阶段标签和终点）
- **与 L38 的区别**：L38 是无序的行表（4–6 行清单，顺序不重要），L44 的顺序本身就是内容
