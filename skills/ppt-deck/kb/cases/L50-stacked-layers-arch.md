# L50 · `stacked-layers-arch`（分层架构页：右侧通高品牌色块 + 从左侧压过来的 3–4 条层带）

> **📄 详情**：本文件供 design 阶段匹配到 L50 时**必读**。
> **★ 核心原则**：结构是灵魂，颜色/内容不绑死。所有配色必须用 `var(--c-*)` 变量。

---

## 一、结构速览

- **比例**：16:9，浅底，**整库唯一的架构/分层图**，视觉中等（约 100–200 字，全是短词）
- **核心手法**：**整组错位叠压** —— ① 品牌色实块贴右边缘通高（`.l50-block`，宽 32%）；② 3–4 条层带（`.l50-layers`，`left:var(--pad-x)` / `right:96px`）从左侧压过来盖住色块的左侧大半，于是色块只在右边露出 96px、上下各露一截；③ 每条层带是 `280px 1fr` 两列：左端深底标签块（层名 + 英文小字）+ 右侧**等宽铺满**的要素块（`.l50-cells` 是 `grid-auto-flow:column`，2–5 个 `.l50-cell` 自动等分整行）
- **是否全幅**：**是** —— 不包 `.slide-inner`（色块要贴到画面边缘）
- **底色**：默认不加类（就是 deck 的 `var(--c-bg)`）
- **什么时候用**：**技术/产品架构分层**（应用层-能力层-数据层）、**能力地图**、**组织分层**、**平台由哪几层拼起来** —— 凡是「几层，每层里有几块」的内容。层与层之间是**包含/支撑**关系；如果是先后步骤，用时间轴那几条

---

## 二、结构拆解（由后到前）

### 1. 色块 · `.l50-block`

- 贴右边缘通高，宽 32%（=614px）。层带压到 `right:96px`，所以色块只露出右边 96px 和上下两截。
- **色块必须在右边。** 贴左的话代码贴的 `.slide-header`（左 `var(--pad-x)`、44–100px 那条带）落在色块上，
  蓝色模块名压在品牌色实底上 —— 对比度不够，而它照样渲染，看起来只是「这个标签有点看不清」。
- **别把层带收进内容区**（`right:var(--pad-x)`）：色块和层带之间空出一条缝，整页退回「浅底上摞了几条白带」，
  叠压关系没了而每一层都渲染正常。
- 整份走冷色时改 `var(--c-accent)`（V3）；**不要用 `var(--c-bg-alt)` 这种浅色**（和页面浅底糊成一片，等于没有色块）。

### 2. 层带 · `.l50-layer` × 3–4

- **从上往下 = 从上层往底层**（应用层在最上、数据层在最下）。顺序反了这一页仍然是一张完整的架构图，
  只是讲的是反的 —— 没有一处会报错。
- **3–4 条最合适，5 条是上限**：留给层带的是 630px，实测一条压到 108px 时正好等于「层名 + 要素块」的最小高度；
  **6 条起要素块的字开始顶出块边、层名上下的留白被吃掉**，看起来只是「排得紧了点」（这一层故意不加
  `overflow:hidden` —— 裁掉的话最后一条凭空消失，而前几条排得整整齐齐）。
- 标签块一律 `var(--c-ink-deep)` 深底白字，**几条层带配色完全一样**（原来有个 `.on` 高亮变体，已经去掉了）。
  **不要自己在 build-part 里给某一层套品牌色 inline style**：高亮那一层会被读成「这一层最重要」，而分层图讲的是
  包含/支撑关系，哪一层重要这一页压根没说 —— 而这一页自己看完全正常。

### 3. 要素块 · `.l50-cell` × 2–5（每层）

- `.l50-cells` 是 `grid-auto-flow:column` + `grid-auto-columns:1fr`：**几块就等分几份，自动铺满整行**。
  这是这一页像"架构图"而不像"标签云"的原因 —— **别改成 `flex` 靠内容宽度排**（那样几块挤在左边、右边空一大片，
  而每一块都渲染正常）。
- **每层 2–5 块**：6 块起每块只剩 200px 出头，四个字的词开始换行撑高整条层带（挤掉别的层的额度）。
- 块里只写**短词**（4–8 字，一行）：这一页是给人扫结构的，一句话的说明写在标题下那行 `lead` 里。
- 各层的块数不必相同（3/4/3 很正常）—— 等分是每层内部的，跨层不对齐是对的。

### 4. 标题 · `.l50-txt`

- `<h1 class="page-title">`（52px 无衬线，和报告风那条标题条同一档）+ 一行 `<p>` 说明。
- **宽度 58%（到色块左缘还剩 52px），别加宽**：加到 70% 之后标题末几个字压在品牌色块上，深灰字压橙底
  读起来只是「有点脏」。真要长标题就换行，别加宽。

---

## 三、CSS 骨架

```css
/* L50 分层架构页：右侧通高品牌色块 + 从左侧压过来的 3–4 条层带 */
.l50-wrap{position:absolute;inset:0;overflow:hidden;background:var(--c-bg)}
.l50-block{position:absolute;right:0;top:0;bottom:0;width:32%;background:var(--c-brand);z-index:0}
.l50-txt{position:absolute;left:var(--pad-x);top:132px;width:58%;z-index:2}
.l50-txt .page-title{font-family:var(--sans);font-size:52px;font-weight:800;line-height:1.18;letter-spacing:-.01em;color:var(--c-ink-deep);margin-top:0}
.l50-txt p{margin-top:18px;font-size:21px;line-height:1.7;color:var(--c-ink)}
.l50-layers{position:absolute;left:var(--pad-x);right:96px;top:300px;bottom:150px;z-index:2;display:flex;flex-direction:column;gap:22px}
.l50-layer{flex:1;min-height:0;display:grid;grid-template-columns:280px 1fr;background:var(--c-card);box-shadow:0 24px 54px rgba(0,0,0,.14)}
.l50-tag{background:var(--c-ink-deep);padding:24px 30px;display:flex;flex-direction:column;justify-content:center}
.l50-tag h3{font-size:24px;font-weight:800;line-height:1.3;color:#fff}
.l50-tag b{font-family:var(--num);font-size:14px;font-weight:700;letter-spacing:.2em;color:rgba(255,255,255,.58);margin-top:8px}
.l50-cells{display:grid;grid-auto-flow:column;grid-auto-columns:1fr;gap:16px;padding:22px 30px;align-items:stretch}
.l50-cell{display:flex;align-items:center;justify-content:center;text-align:center;padding:13px 18px;border:1px solid var(--c-hairline);background:var(--c-bg);font-size:19px;font-weight:700;line-height:1.4;color:var(--c-ink-deep)}
```

---

## 四、build-part 结构模板

```html
<section class="slide" data-layout="L50">
  <!-- 全幅：不包 .slide-inner。模块名由代码贴（.slide-header），这里不要写 -->
  <div class="l50-wrap"></div>
  <div class="l50-block"></div>
  <div class="l50-txt">
    <h1 class="page-title">{{这一页的标题，一行}}</h1>
    <p>{{一句话：这几层是什么关系}}</p>
  </div>
  <div class="l50-layers">
    <div class="l50-layer">
      <div class="l50-tag">
        <h3>{{最上面那层的名字}}</h3>
        <b>{{英文小字}}</b>
      </div>
      <div class="l50-cells">
        <div class="l50-cell">{{要素，4–8 字}}</div>
        <div class="l50-cell">{{要素}}</div>
        <div class="l50-cell">{{要素}}</div>
      </div>
    </div>
    <div class="l50-layer">
      <div class="l50-tag">
        <h3>{{要点出的那一层，最多一层加 on}}</h3>
        <b>{{英文小字}}</b>
      </div>
      <div class="l50-cells">
        <div class="l50-cell">{{要素}}</div>
        <div class="l50-cell">{{要素}}</div>
        <div class="l50-cell">{{要素}}</div>
        <div class="l50-cell">{{要素}}</div>
      </div>
    </div>
    <div class="l50-layer">
      <div class="l50-tag">
        <h3>{{最下面那层}}</h3>
        <b>{{英文小字}}</b>
      </div>
      <div class="l50-cells">
        <div class="l50-cell">{{要素}}</div>
        <div class="l50-cell">{{要素}}</div>
      </div>
    </div>
  </div>
</section>
```

---

## 五、图槽位

| 槽位 | 必填? | 模式 | 比例 | 构图要求 |
|------|-------|------|------|----------|
| —    | —     | —    | —    | **这一条不放图**：层带已经铺满整个内容区，图只能压在色块上，把唯一的那块品牌色盖掉。**架构图截图也禁用**（放大后是糊的，而这一条就是用来画架构的） |

**禁用**：任何 `<img>` / 背景图 / 现成架构图截图

---

## 六、变体

| 编号 | 变化 | 用途 |
|------|------|------|
| V1 | 4 层 | 多一层（如「接入层」） |
| V2 | 标签块整列改 `var(--c-brand)` 实底（**三条一起改**） | 想让整页更暖 |
| V3 | 色块改 `var(--c-accent)` | 整份走冷色调 |
| V4 | 去掉标签块里的英文小字 | 不想出现英文 |
| V5 | 去掉标题下那行说明（多让出一点高度） | 标题已经说清关系 |
| V6 | 某一层只放 1 个通宽要素块 | 那一层只有一个东西（如「一条网关」） |

---

## 七、design 提示

- **只当分层/包含关系用**：层与层是包含或支撑关系；先后步骤用时间轴那几条（这一页画成步骤图时读的人会以为下面那层支撑上面那层）
- **色块必须在右边**：贴左的话代码贴的模块名（左 140px、44–100px）压在品牌色实底上，蓝字对比度不够而它照样渲染
- **层带别收进内容区**：`right:96px` 是叠压关系的全部，改成 `var(--pad-x)` 之后色块和层带之间空出一条缝，整页退回「浅底上摞了几条白带」
- **从上往下 = 从上层往底层**：顺序反了这一页仍然是一张完整的架构图，只是讲的是反的
- **3–4 层、5 层是上限**：实测一条压到 108px 正好等于内容最小高度，6 层起要素块的字顶出块边、层名的留白被吃掉，看起来只是「排得紧了点」（故意不裁）
- **每层 2–5 个要素块**：`.l50-cells` 是等分铺满整行的 grid，**别改成 flex 按内容宽度排**（几块挤在左边、右边空一大片，而每一块都渲染正常）；6 块起四字词开始换行撑高整条层带
- **要素块里只写短词**（4–8 字一行），说明写在标题下那行
- **标题宽度别加**：58% 到色块左缘只剩 52px，加宽之后标题末几个字压在色块上，深灰压橙底读起来只是「有点脏」
- **配色**：色块 `var(--c-brand)`（冷色 deck 用 `var(--c-accent)`），层带底必须 `var(--c-card)`（用 `var(--bg-plain)` 的话层带和页面浅底同色、整条层带消失，只剩深色标签块和几个描边方块）；深底标签块里的字直接写 `#fff` / `rgba(255,255,255,…)`，不要用 `var(--c-ink)` 系
- **整份最多一页**（同一份里画两张架构图，读的人会以为是两套系统）
- **与并列三栏那几条的区别**：那些是 3–4 个**平级**单元横排，这一条是**纵向分层**（层与层不平级）；与时间轴那几条的区别 —— 那是先后，这是包含
