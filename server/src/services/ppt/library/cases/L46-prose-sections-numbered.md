# L46 · `prose-sections-numbered`（分节说明页：报告风标题条 + 2–3 个「编号 + 小标题 + 整段正文」白底区块）

> **📄 详情**：本文件供 design 阶段匹配到 L46 时**必读**。
> **★ 核心原则**：结构是灵魂，颜色/内容不绑死。所有配色必须用 `var(--c-*)` 变量。

---

## 一、结构速览

- **比例**：16:9，浅底，**文字容量大且是整句成段**（2–3 节 × 每节「小标题 + 一段三五句话」，三节约 450–700 字）
- **核心手法**：① 顶部报告风标题条（`.rp-head`，建议带一行 `lead`）；② 竖着排的 2–3 个白底区块（`.l46-list` > `.l46-item`：`var(--c-card)` 底 + 一圈细线 + 左侧 3px 品牌色竖条），每块是 `92px 1fr` 两列 —— 左列 44px 品牌色编号，右列「小标题 + 一整段正文」；③ 底部结论条（`.rp-foot`）
- **是否全幅**：否 —— 全部内容包在 `.slide-inner` 里
- **底色**：默认不加类
- **什么时候用**：方案概述 / 核心功能 / 预期效果 / 服务内容 / 实施要点 / 风险与应对 —— 提案里那种「几个小标题、每段三五句话」的页。**要点式的清单不要用这一条**（拆成短句之后编号和小标题就白设了，观感退回一页清单）

---

## 二、结构拆解

### 1. 标题条 · `.rp-head`

标题**必须写成 `<h1 class="page-title">`**（页脚目录面板靠它取标题）。`lead` 建议写一句：这几节是按什么顺序排的（先后？重要性？三个不同维度？）—— 分节页最容易被读成「三段并列的废话」。放不下正文时它是第一个该删的（V2）。

### 2. 区块 · `.l46-item` × 2–3

- **区块只能 2–3 个。** `.l46-list` 是 `flex:1` + `min-height:0`，高度被剩余空间钉死而**不裁**内容：
  第 4 个区块从下沿漏出去压在 `.rp-foot` 上，出来是字叠字的一页。真有四五节请拆两页。
- **三节时正文合计 ≤ 8 行**（实测：留给 `.l46-list` 的是 640px，每块固定开销 97px = padding 52 +
  小标题 35 + 正文 margin 10，块间距 24px，正文一行 35px 约 58 个汉字）→ 三节各写 2–3 行。
  两节时合计 ≤ 12 行；去掉 `lead`（V2）和结论条（V3）各能多出 2–4 行。
- **每节的正文长度要接近**：一节 6 行另一节 1 行时，短的那节下面空出一块，看起来像内容没写完
  （而那一节本身读得通，一处都不报错）。
- 区块底色必须是 `var(--c-card)`：`var(--bg-plain)` 和浅色页的底色 `--c-bg` 是**同一个色值**，
  写它的话区块整块消失、只剩左边那条橙线，而页面照样渲染、一处都不报错。
- 左列写死 `92px`：跟着内容缩的话「10」比「1」宽，三节的正文起点各差几个像素。
- `align-items:start` 是承重的：改成 `center` 之后编号会跟着正文长短上下浮动，三个编号不在一条线上。

### 3. 小标题与正文 · `h3` / `p`

- **小标题 8 字以内**：长了会换行，把那一节的正文起点顶下去，三节的对齐就散了。
- `<h3>` 里可挂一段 `<em>`（自动转成加宽字距的灰色英文小字，同一行、非斜体）放英文/代号，
  **要么每节都有、要么都没有**：只有一两节有时看起来像漏了。
- 正文写**整句**（19px / 1.85）。关键句用 `<b>` 圈出，**每节最多一处**（全标等于没标）。

---

## 三、CSS 骨架

```css
/* 报告风共用：标题条 + 结论条 */
.rp-head{padding-bottom:20px;border-bottom:2px solid var(--c-ink-deep)}
.rp-head .page-title{font-family:var(--sans);font-size:52px;font-weight:800;color:var(--c-ink-deep);line-height:1.18;letter-spacing:-.01em;margin-top:0}
.rp-head .lead{font-size:20px;line-height:1.7;color:var(--c-ink);margin-top:18px;max-width:1180px}
.rp-foot{margin-top:auto;padding-top:20px;border-top:1px solid var(--c-hairline);font-size:21px;line-height:1.6;color:var(--c-ink-deep)}
.rp-foot b{font-weight:800;color:var(--c-brand-deep)}
/* L46 分节说明页 */
.l46-list{flex:1;min-height:0;display:flex;flex-direction:column;gap:24px;margin-top:32px}
.l46-item{display:grid;grid-template-columns:92px 1fr;gap:28px;align-items:start;background:var(--c-card);border:1px solid var(--c-hairline);border-left:3px solid var(--c-brand);padding:26px 32px}
.l46-no{font-family:var(--num);font-size:44px;font-weight:800;line-height:1;color:var(--c-brand)}
.l46-item h3{font-size:26px;font-weight:800;line-height:1.35;color:var(--c-ink-deep)}
.l46-item h3 em{font-style:normal;font-family:var(--num);font-size:14px;font-weight:700;letter-spacing:.18em;color:var(--c-ink-soft);margin-left:14px}
.l46-item p{margin-top:10px;font-size:19px;line-height:1.85;color:var(--c-ink)}
.l46-item p b{font-weight:800;color:var(--c-brand-deep)}
```

---

## 四、build-part 结构模板

```html
<section class="slide" data-layout="L46">
  <div class="slide-inner">
    <div class="rp-head">
      <h1 class="page-title">{{标题}}</h1>
      <div class="lead">{{一句话：这几节是按什么顺序排的}}</div>
    </div>
    <div class="l46-list">
      <div class="l46-item">
        <div class="l46-no">01</div>
        <div>
          <h3>{{这一节叫什么，8 字内}}<em>{{英文，可省；有就每节都有}}</em></h3>
          <p>{{一整段正文，2–3 行整句。关键句用 <b>b</b> 圈出，每节最多一处}}</p>
        </div>
      </div>
      <div class="l46-item">
        <div class="l46-no">02</div>
        <div>
          <h3>{{这一节叫什么}}<em>{{英文，可省}}</em></h3>
          <p>{{一整段正文，2–3 行，长度和上一节接近}}</p>
        </div>
      </div>
      <div class="l46-item">
        <div class="l46-no">03</div>
        <div>
          <h3>{{这一节叫什么}}<em>{{英文，可省}}</em></h3>
          <p>{{一整段正文，2–3 行}}</p>
        </div>
      </div>
    </div>
    <div class="rp-foot">{{一句结论，关键词用 <b>b</b> 圈出}}</div>
  </div>
</section>
```

---

## 五、图槽位

| 槽位 | 必填? | 模式 | 比例 | 构图要求 |
|------|-------|------|------|----------|
| —    | —     | —    | —    | **这一条不放图**：三个区块横向占满内容区，塞图只能把正文挤成一条窄栏（而窄栏排出来只是「这页字挤」）。要每节配一张小图的用带缩略图的行表那一档 |

**禁用**：任何 `<img>` / 背景图（白底区块上叠图之后正文对比度不够，而它照样渲染）

---

## 六、变体

| 编号 | 变化 | 用途 |
|------|------|------|
| V1 | 两节版（正文各能写到 6 行） | 只有两块要说透 |
| V2 | 去掉 `lead` | 正文放不下时第一个删它（多 2–3 行） |
| V3 | 去掉结论条 | 这一页没有可收的结论（多 1–2 行） |
| V4 | 编号留空，靠 `<em>` 里的英文小标区分 | 这几节没有先后顺序 |
| V5 | 首节反色强调（inline style 换 `var(--card-o)` 底） | 三节里有一节是重点 |
| V6 | 正文里关键句 `<b>` 圈出（每节最多一处） | 想让人扫一眼就抓住三个点 |

---

## 七、design 提示

- **区块只能 2–3 个**：第 4 个从 `.l46-list` 下沿漏出去压在结论条上（字叠字），这一层故意不加 `overflow:hidden`（裁掉的话最后那一节凭空消失，而前三节排得整整齐齐）
- **三节时正文合计 ≤ 8 行**（各 2–3 行）；两节 ≤ 12 行；去掉 `lead` / 结论条各能多出 2–4 行
- **这是写整句的地方，不是列要点**：拆成短句之后编号和小标题就白设了，观感退回一页清单
- **每节长度要接近**：一节 6 行另一节 1 行时短的那节下面空一块，看起来像没写完
- **小标题 8 字以内**（换行会顶下正文起点，三节的对齐散掉）；`<em>` 英文要么每节都有要么都没有
- **配色**：编号和左竖条 `var(--c-brand)`，区块底 `var(--c-card)`（**不是 `var(--bg-plain)`** —— 那个和浅色页底色是同一个色值，写它的话三个区块在画面上压根不存在，只剩左边三条橙线），`<b>` 用 `var(--c-brand-deep)`，小字 `var(--c-ink-soft)`
- **整份最多两页**，且别相邻（连着两页分节页翻起来像同一页没动）
- **与报刊双栏长文那一条的区别**：那一条是**一整篇**连续正文（900 字以上、首字下沉 + 边注），这一条是**分好节**的两三段
- **与带缩略图的行表那一档的区别**：那一条每行是「小图 + 10 字小标题 + 要点式说明」的清单（4–6 行），这一条是 2–3 段整话
- **与 2×2 象限卡那一条的区别**：那一条是四块并列的短块（每块几十字），这一条是竖着读的整段
