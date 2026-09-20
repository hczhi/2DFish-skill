# L73 · `trend-bars-note-stack`（趋势条 + 注解栈：左栏标题与一段嵌大号品牌色数字的话 + 下半一组横条（复用 L47 的条子）+ 右栏三张竖着叠的注解卡、最下一张品牌色）

> **📄 详情**：本文件供 design 阶段匹配到 L73 时**必读**。
> **★ 核心原则**：结构是灵魂，颜色/内容不绑死。所有配色必须用 `var(--c-*)` 变量。

---

## 一、结构速览

- **比例**：16:9，左 65% 叙述 + 图表 / 右 35% 三张注解卡，文字容量偏大（领句 + 标题 + 一段话 + 4–6 行条子 + 每卡 2–4 行，约 300–380 字）
- **核心手法**：**一页把「趋势」和「怎么解释这个趋势」摆在一起** —— 左栏上半是一句判断（话里嵌 1–2 个大号品牌色数字），下半是同一组数按年/按项排成的横条；右栏三张注解卡竖着叠，最下一张上品牌色，读的顺序是「判断 → 条子 → 三条解释」。
- **条子复用 L47 的 `.l47-*`**（`.l47-rows` / `.l47-row` / `.l47-track` / `.l47-fill` / `.l47-gap` / `.l47-val`），**条长和轨道上限由代码算**（`chartData.ts`）。这一条只改列宽（左栏比 L47 整页窄一半）。
- **是否全幅**：否（内容包在 `.slide-inner` 里）
- **什么时候用**：一页「某个量三到五年的走势 + 三条解释」——营收/利润趋势、用量增长、成本下降、份额变化
- **导出 pptx**：全是实心色块 + 文字（条子是两个 flex 块拼的），没有渐变、没有图、没有透明度

---

## 二、结构拆解

### 1. 条子 —— **一定要用 `.l47-*` 那套类名**

- `chartData.ts` 是**按类名扫**的（`l47-rows` / `l47-row` / `l47-val`）：条长 `--bar-v` 和轨道上限 `--bar-max` 都由它按**印出来的那个数**重算（一组百分比一律钉 100，其余向上取整齐上限）。改成 `.l73-row` 之类的自有类名，这一页的条子就**彻底绕过那段代码** —— 条长变成模型自己写的数，出来是一张干净完整的图表（颜色、单位、结论全在，一处都不报错），而照条长读出来的结论和旁边印着的数字不是一回事。
- **模型只写 `--bar-v`（= 那一行的原始数值，和 `.l47-val` 里印的数字必须是同一个数）**，`--bar-max` 不要写。
- 条子 **4–6 行**（`.l47-rows` 是 `justify-content:center`，3 行时中间空一块、7 行起挤到标题下面）。
- 行名那一格 110px：写**年份或 ≤4 个汉字**。长名字会折两行，条子跟着错位（画面照旧完整）。
- 高亮一行加 `.on`（深一档品牌色 + 名字和数字转 `var(--c-brand-deep)`）—— **最多一行**，两行以上就没有「最新那一年」了。要压低一行（对照组）用 `.dim`。
- **两段堆叠的条子这一条做不了**：`chartData` 管的是单值 `--bar-v` / `--bar-max`，段宽交给模型写的话它和行尾印的数字对不上，而画面完全正常。真要拆两段就得先改 `chartData`，别在这一页里用 inline style 硬拼。

### 2. 左栏叙述 · `.l73-say`

- 领句 `.l73-kicker` 说**另一个维度**（口径 / 年份区间 / 数据来源级别），不许是标题的前半句。
- 标题 46px 衬线、**16 个汉字以内**（两行）；这一条的主角是条子，标题别做到 60px 以上。
- `.l73-lead` 一段话 **3–5 行**，里面用 `<b>` 嵌 **1–2 个大号数字**（38px 品牌色，`line-height:1` 保证不顶开行距）。**三处起段落被撑得一行高一行矮**，而每个字都在，看起来只是「这段排得有点乱」。
- `.l73-chart` 上沿那条 2px 深线把「话」和「图」分开，`border-top` 别删（删了之后条子看起来是段落的一部分）。
- `.l73-ctitle` 是图表自己的标题（`<span>` 里放单位/口径，灰一档）。**单位一定要写**：一组没有单位的数字读者会当成「元」或「个」，而那一页每一行都对得上。

### 3. 右栏注解栈 · `.l73-notes` / `.l73-note`

- **正好 3 张**（`flex:1` 三等分）。4 张起每张只剩 190px 高、说明被挤成两行；2 张时每张 420px 高、里面空一大块。
- 每张：`em` 英文小标签 + `b` 小标题（≤10 字）+ `p` 说明 **2–4 行**。
- **最下那张加 `.brand`**（品牌色实底），里面的字**一律走 `var(--c-brand-on)`，不许写死 `#fff`** —— 浅色品牌色那几套上白字直接读不出来，而字确实在那儿（同 L69 的 `.brand` 格）。上色的那张**只能有一张**：三张全上色之后三条解释之间没有主次，而每一张都「有颜色、读得清」。
- 注解卡用 `var(--c-bg-alt)`，**别改成 `var(--c-card)`**：页底是纯白、`--c-card` 也是纯白，铺上去等于什么都没铺（画面上只是「这三块字糊在一起」）。

---

## 三、CSS 骨架

```css
.l73-grid{flex:1;min-height:0;display:grid;grid-template-columns:1fr .52fr;gap:56px}
.l73-say{min-height:0;display:flex;flex-direction:column}
.l73-kicker{font-family:var(--num);font-size:16px;font-weight:700;letter-spacing:.2em;color:var(--c-brand-deep)}
.l73-say .page-title{font-family:var(--serif);font-size:46px;font-weight:900;line-height:1.22;letter-spacing:-.02em;color:var(--c-ink-deep);margin-top:16px}
.l73-lead{margin-top:18px;font-size:19px;line-height:1.85;color:var(--c-ink)}
.l73-lead b{font-family:var(--num);font-size:38px;font-weight:800;line-height:1;letter-spacing:-.02em;color:var(--c-brand)}
.l73-chart{flex:1;min-height:0;margin-top:26px;padding-top:20px;border-top:2px solid var(--c-ink-deep);display:flex;flex-direction:column}
.l73-ctitle{font-size:19px;font-weight:800;line-height:1.3;color:var(--c-ink-deep)}
.l73-ctitle span{font-weight:700;color:var(--c-ink-soft);margin-left:12px}
.l73-chart .l47-row{grid-template-columns:110px 1fr 140px}
.l73-notes{min-height:0;display:flex;flex-direction:column;gap:18px}
.l73-note{flex:1;background:var(--c-bg-alt);border-radius:14px;padding:28px 30px;display:flex;flex-direction:column;justify-content:center}
.l73-note em{display:block;font-family:var(--num);font-size:14px;font-weight:700;font-style:normal;letter-spacing:.18em;color:var(--c-ink-soft)}
.l73-note b{display:block;margin-top:10px;font-size:23px;font-weight:800;line-height:1.35;color:var(--c-ink-deep)}
.l73-note p{margin-top:10px;font-size:17px;line-height:1.7;color:var(--c-ink)}
.l73-note.brand{background:var(--c-brand)}
.l73-note.brand em,.l73-note.brand b,.l73-note.brand p{color:var(--c-brand-on)}
.l47-rows{flex:1;min-height:0;display:flex;flex-direction:column;justify-content:center;gap:22px;margin-top:34px}
.l47-row{display:grid;grid-template-columns:300px 1fr 190px;gap:26px;align-items:center}
.l47-name{font-size:21px;font-weight:700;line-height:1.35;color:var(--c-ink-deep)}
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
<section class="slide" data-layout="L73">
  <!-- 非全幅：内容包在 .slide-inner 里；页眉由代码贴，这里不要写 -->
  <div class="slide-inner">
    <div class="l73-grid">
      <div class="l73-say">
        <div class="l73-kicker">{{领句：口径/年份区间，不许重复标题}}</div>
        <h1 class="page-title">{{标题，16 个汉字内}}</h1>
        <!-- <b> 里嵌大号数字，最多两处（三处起段落一行高一行矮） -->
        <p class="l73-lead">{{一段话 3–5 行，里面用 <b>{{数字}}</b> 嵌 1–2 个大号数字}}</p>
        <div class="l73-chart">
          <div class="l73-ctitle">{{图表标题}}<span>{{单位/口径，必写}}</span></div>
          <!-- 条长和 --bar-max 由代码算（chartData.ts 按类名扫）：只写 --bar-v，且它必须和
               .l47-val 里印的数字是同一个数；别改成自有类名，改了这一页就绕过那段代码 -->
          <div class="l47-rows">
            <div class="l47-row" style="--bar-v:{{数值}}">
              <div class="l47-name">{{年份或 ≤4 字}}</div>
              <div class="l47-track"><div class="l47-fill"></div><div class="l47-gap"></div></div>
              <div class="l47-val">{{数值}}<i>{{单位}}</i></div>
            </div>
            <div class="l47-row" style="--bar-v:{{数值}}">
              <div class="l47-name">{{年份或 ≤4 字}}</div>
              <div class="l47-track"><div class="l47-fill"></div><div class="l47-gap"></div></div>
              <div class="l47-val">{{数值}}<i>{{单位}}</i></div>
            </div>
            <div class="l47-row" style="--bar-v:{{数值}}">
              <div class="l47-name">{{年份或 ≤4 字}}</div>
              <div class="l47-track"><div class="l47-fill"></div><div class="l47-gap"></div></div>
              <div class="l47-val">{{数值}}<i>{{单位}}</i></div>
            </div>
            <div class="l47-row on" style="--bar-v:{{数值}}">
              <div class="l47-name">{{最新那一年}}</div>
              <div class="l47-track"><div class="l47-fill"></div><div class="l47-gap"></div></div>
              <div class="l47-val">{{数值}}<i>{{单位}}</i></div>
            </div>
          </div>
        </div>
      </div>
      <div class="l73-notes">
        <div class="l73-note">
          <em>{{英文小标签}}</em>
          <b>{{小标题，≤10 字}}</b>
          <p>{{说明 2–4 行}}</p>
        </div>
        <div class="l73-note">
          <em>{{英文小标签}}</em>
          <b>{{小标题，≤10 字}}</b>
          <p>{{说明 2–4 行}}</p>
        </div>
        <!-- 最下这张上品牌色，里面的字一律 var(--c-brand-on)，不许写死 #fff -->
        <div class="l73-note brand">
          <em>{{英文小标签}}</em>
          <b>{{小标题，≤10 字}}</b>
          <p>{{说明 2–4 行}}</p>
        </div>
      </div>
    </div>
  </div>
</section>
```

---

## 五、图槽位

**0 个 —— 这一条不吃图。** 左栏下半已经被条子占满，右栏三张卡是文字块；塞图进去要么把条子挤成三行，要么把注解卡的说明顶出卡外（都是「画面完整、只是排得怪」）。要「趋势 + 一张实景」换 L71，要「趋势 + 结论条」的整页报告风换 L47。

---

## 六、变体

| 编号 | 变化 | 用途 |
|------|------|------|
| V1 | 条子 6 行 | 六年/六个项 |
| V2 | `.l73-note.brand` 改挂在最上那张 | 最重要的那条解释在最前面 |
| V3 | `.brand` 换成 inline `var(--c-accent)` 底 + 字 `var(--c-accent-on)` | 整份里品牌色用得太满 |
| V4 | 去掉 `.l73-lead` 里的 `<b>`（不嵌大号数字） | 这一段没有能立住的单个数字 |
| V5 | 某一行加 `.dim`（灰条） | 有一年是对照组/不可比 |
| V6 | 列宽改 `1fr .68fr` | 注解说明偏长 |

---

## 七、design 提示

- **一份里最多一页**：同一份里第二页趋势条会和 L47 / L52 撞（都是轨道 + 数字）
- **条子必须用 `.l47-*` 那套类名**：`chartData.ts` 按类名扫，换了名字这一页的条长就变成模型自己写的数 —— 图表干净完整、一处不报错，而照条长读出的结论和旁边印的数字不是一回事
- **模型只写 `--bar-v`（等于 `.l47-val` 里印的那个数），`--bar-max` 不要写**
- **不做两段堆叠条**：`chartData` 管的是单值，段宽交给模型写的话它和行尾的数字对不上，而画面完全正常
- **`.l73-lead` 里的大号数字最多两处**：三处起段落一行高一行矮（`line-height:1` 只保证不顶开当前行）
- **条子 4–6 行、`.on` 最多一行**：3 行时中间空一块、7 行起挤到标题下；两行 `.on` 就没有「最新那一年」
- **`.l73-ctitle` 的单位必写**：没有单位的一组数字读者会当成「元」或「个」，而每一行都对得上
- **注解正好 3 张、只有一张上色**：4 张起每张只剩 190px 高，三张全上色之后三条解释之间没有主次
- **`.brand` 那张里的字走 `var(--c-brand-on)`，不许写死 `#fff`**：浅色品牌色那几套上白字读不出来，而字确实在那儿
- **注解卡用 `var(--c-bg-alt)` 不许用 `var(--c-card)`**：页底纯白、`--c-card` 也是纯白，铺上去等于什么都没铺
- **`--veil` 留 0**：整页浅底，压黑只让条子和卡片一起发灰
- **与 L47 的区别**：L47 是整页报告风的条形图（`.rp-head` + 结论条 `.rp-foot`），条子占满整页宽；L73 的条子只占左栏下半，右边是三条文字解释
- **与 L52 / L53 的区别**：那两条是竖柱/折线（同样走 `--bar-v`）；L73 是横条 + 注解栈
- **与 L69 的区别**：L69 是 2×2 大数字色块拼贴（没有轨道、没有趋势）；L73 有轨道、读的是走势
