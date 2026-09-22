# L70 · `portrait-caption-overlap`（竖图压卡分屏：左侧竖构图照片 + 品牌色说明卡压在图的左下角并错出图沿 + 右侧巨标题与 2–3 块浅灰注解）

> **📄 详情**：本文件供 design 阶段匹配到 L70 时**必读**。
> **★ 核心原则**：结构是灵魂，颜色/内容不绑死。所有配色必须用 `var(--c-*)` 变量。

---

## 一、结构速览

- **比例**：16:9，左 46% 竖图 + 右 54% 文案，文字容量中等（领句 + 标题 + 一段引言 + 2–3 块注解 + 色卡里一段说明，约 240–320 字）
- **核心手法**：**色卡错位** —— 品牌色说明卡压在竖图的左下角，左沿再往图外错出 56px（落在 `.slide-inner` 那 140px padding 里），于是「图」和「卡」的边界不是一条直线。右侧是纯文字的三段式（领句 / 巨标题 / 浅灰注解块），注解块 `margin-top:auto` 贴内容区下沿，和左侧色卡的底沿差不多齐。
- **是否全幅**：否 —— 内容包在 `.slide-inner` 里（色卡只错出 56px，还留 84px 到页面左缘；这一条不是出血版式）
- **什么时候用**：一页「一个时间点/一个里程碑 + 一句判断 + 2–3 条注解」，而且**手上正好有一张竖构图的照片**：阶段成果、某个月份的进展、人物/现场 + 判断
- **导出 pptx**：一张图 + 一块实心色块 + 文字，没有渐变、没有 mask。色卡压在图上是层叠关系（导出后卡在图之上），`border-radius` 只在浅灰注解块上

---

## 二、结构拆解（由后到前）

### 1. 竖图 · `.l70-fig` / `.l70-fig img`

- **`.l70-fig` 不许加 `overflow:hidden`。** 色卡靠 `left:-56px` 错出图的左沿，裁掉之后它变成一张贴着图左边缘的方卡 —— 这一条的全部手法就没了，而画面上是一张图加一张卡，看起来就是设计本来如此，自检清单 和类名校验一处都不会说。
- 图**必须是竖构图**（`ph-3x4.svg` 那一档）：横图塞进这一格会被 `object-fit:cover` 裁掉左右两端，而裁掉的通常正是主体。
- 画面**下半要有可压字的暗区或空区**（色卡就压在那儿）。这一句要写进 `data-img-prompt` 里 —— 不写的话生出来的图主体正在下半，色卡盖住的就是主体，而那一页读起来只是「这张图选得不好」。

### 2. 品牌色说明卡 · `.l70-cap`

- **卡上的字一律 `var(--c-brand-on)`，不许写死 `#fff`，年份那一行更不许改成 `var(--c-accent)`。** 品牌色底能不能压白字**由配色决定**（默认那套的橙对白字 2.6:1，AA 要 4.5），而品牌色底上压点缀色是橙底压天青（1.2:1）—— 字还在、位置也对，只是读不出来，而每一页都是一页完整正常的幻灯片。
- 结构固定三行：`<em>`（40px 衬线，**汉字月份/阶段名，≤4 字**）+ `<b>`（40px 等宽数字，年份/编号）+ `<p>`（说明 **2–3 行**）。说明超过 3 行卡会往上长，压到图的中段主体上（不报错，只是「这张图被卡挡住了」）。
- `left:-56px` 是错位量的上限档：再往外推到 -140px 就贴着页面左缘了，读起来像出血版式，而这一条是非全幅的（页眉、页脚、疏密档都还按 `.slide-inner` 走）。

### 3. 右侧文案 · `.l70-say`

- 领句 `.l70-kicker` 说**另一个维度**（口径 / 年份 / 这一页属于哪一段），不许是标题的前半句。
- 标题 60px 衬线，**16 个汉字以内**（两到三行）；`<em>` 转 `var(--c-brand-deep)`，一页只标一处。
- `.l70-lead` 一段引言 2–4 行，没什么可写就整块删掉（V3）。
- `.l70-notes` **2–3 块**：`<b>` 小标题（≤10 字一行）+ `<p>` 说明 2–3 行。4 块起注解区从 `margin-top:auto` 一直顶到标题下面，标题和注解之间的呼吸没了（画面照旧完整）。

### 4. 两栏的高度关系

- **`.l70-grid` 的 `min-height:0` 不能删。** grid 子项默认 `min-height:auto`，竖图那一格会按图的固有比例把整行撑到比内容区还高，于是图的下半和色卡一起沉进页脚那 54px（`#footer` 是舞台级的 `z-index:50`，页码会印在色卡上），而页面照旧渲染正常。
- 左右两栏是**各自贴底**的（色卡 `bottom:48px`、注解块 `margin-top:auto`），不是对齐的同一条线 —— 想让它们严格齐平要改这两个数中的一个，别去给 `.l70-grid` 加 `align-items`（那会把图拉成非 cover 的高度）。

---

## 三、CSS 骨架

```css
.l70-grid{flex:1;min-height:0;display:grid;grid-template-columns:.86fr 1fr;gap:72px}
.l70-fig{position:relative;min-height:0}
.l70-fig img{width:100%;height:100%;object-fit:cover;display:block}
.l70-cap{position:absolute;left:-56px;right:44px;bottom:48px;z-index:3;background:var(--c-brand);padding:28px 32px 30px}
.l70-cap em{display:block;font-family:var(--serif);font-size:40px;font-weight:900;font-style:normal;line-height:1.08;letter-spacing:-.02em;color:var(--c-brand-on)}
.l70-cap b{display:block;font-family:var(--num);font-size:40px;font-weight:800;line-height:1.05;letter-spacing:-.02em;color:var(--c-brand-on)}
.l70-cap p{margin-top:14px;font-size:16px;line-height:1.7;color:var(--c-brand-on)}
.l70-say{min-height:0;display:flex;flex-direction:column}
.l70-kicker{font-family:var(--num);font-size:16px;font-weight:700;letter-spacing:.2em;color:var(--c-brand-deep)}
.l70-say .page-title{font-family:var(--serif);font-size:60px;font-weight:900;line-height:1.2;letter-spacing:-.02em;color:var(--c-ink-deep);margin-top:20px}
.l70-say .page-title em{font-style:normal;color:var(--c-brand-deep)}
.l70-lead{margin-top:22px;font-size:20px;line-height:1.8;color:var(--c-ink)}
.l70-notes{margin-top:auto;display:flex;flex-direction:column;gap:18px}
.l70-note{background:var(--c-bg-alt);border-radius:14px;padding:26px 30px}
.l70-note b{display:block;font-size:22px;font-weight:800;line-height:1.35;color:var(--c-ink-deep)}
.l70-note p{margin-top:10px;font-size:17px;line-height:1.75;color:var(--c-ink)}
```

---

## 四、build-part 结构模板

```html
<section class="slide" data-layout="L70">
  <!-- 非全幅：内容包在 .slide-inner 里；页眉由代码贴，这里不要写 -->
  <div class="slide-inner">
    <div class="l70-grid">
      <!-- .l70-fig 不要加 overflow:hidden（色卡要错出图的左沿） -->
      <div class="l70-fig">
        <img src="/ppt-cases/ph-3x4.svg" alt="" data-img-prompt="{{竖构图；主体在画面上半，下半留出可压色卡的暗区或空区}}" data-img-mode="case">
        <!-- 卡上的字一律 var(--c-brand-on)，不许写死 #fff、年份不许用 var(--c-accent) -->
        <div class="l70-cap">
          <em>{{月份/阶段名，≤4 字}}</em>
          <b>{{年份或编号}}</b>
          <p>{{说明 2–3 行，别超过 3 行}}</p>
        </div>
      </div>
      <div class="l70-say">
        <div class="l70-kicker">{{领句：口径/年份，不许重复标题}}</div>
        <h1 class="page-title">{{标题，16 个汉字内，可用 <em>一处</em> 强调}}</h1>
        <p class="l70-lead">{{引言 2–4 行；没有就整块删掉}}</p>
        <div class="l70-notes">
          <div class="l70-note">
            <b>{{注解小标题，≤10 字}}</b>
            <p>{{说明 2–3 行}}</p>
          </div>
          <div class="l70-note">
            <b>{{注解小标题，≤10 字}}</b>
            <p>{{说明 2–3 行}}</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</section>
```

---

## 五、图槽位

**1 个 —— `.l70-fig img`（竖构图，3:4 一档）。** 这一格是硬要求：删掉图之后左栏是一块空白加一张品牌色卡，右侧文案不会自己占过来（grid 列宽是写死的比例）。`data-img-prompt` 里**必须写「下半留暗区/空区」**，色卡就压在那儿。没有可用竖图的话换 L67（不吃图的并列页）或 L66（右半横图羽化）。

---

## 六、变体

| 编号 | 变化 | 用途 |
|------|------|------|
| V1 | 三块 `.l70-note`（`p` 收到 2 行内） | 正好三条注解 |
| V2 | `.l70-cap` inline 改 `var(--c-accent)` 底（字跟着改 `var(--c-accent-on)`） | 整份里品牌色用得太满 |
| V3 | 去掉 `.l70-lead` | 这一页没有引言，注解块自己承担说明 |
| V4 | `.l70-cap` 的 `left` 改 `-24px`（错位收窄） | 图的左下角正好有主体，不想压太多 |
| V5 | `.l70-grid` 列宽改 `1fr 1fr` | 图值得占半屏（人物/现场照） |
| V6 | `.l70-cap` 里只留 `<em>` + `<b>`（去掉 `<p>`） | 这一页只要标一个时间点 |

---

## 七、design 提示

- **一份里最多两页**：竖图 + 错位色卡的辨识度很高，第三页开始看起来像同一页换了字
- **`.l70-fig` 不许 `overflow:hidden`**：色卡错出图沿是这一条的全部手法，裁掉之后退回「左图右文」（库里已有五条），而画面看起来是设计本来如此
- **`.l70-grid` 的 `min-height:0` 不许删**：竖图会把这一行撑过内容区，图的下半和色卡一起沉进页脚那 54px，页码印在色卡上而画面照旧正常
- **色卡上的字一律 `var(--c-brand-on)`**：写死 `#fff` 的话浅色品牌色那几套上读不出来；**年份那行不许用 `var(--c-accent)`**（品牌色底压点缀色是 1.2:1，字确实在那儿）
- **色卡说明最多 3 行**：再长卡往上长，压住图中段的主体（不报错，只是「这张图被挡住了」）
- **注解块 2–3 块**：4 块起注解区顶到标题下面，标题和注解之间的呼吸没了
- **图必须是竖构图且下半留空**：横图被 `object-fit:cover` 裁掉左右主体；下半有主体的话色卡正好盖住它
- **`--veil` 留 0**：图只占左栏、右侧全是浅底上的深字，压一层黑只会让图发灰
- **与 L1 / L3 / L17 的区别**：那三条是规整的左右分屏（边界是一条竖直的直线）；L70 的边界被色卡打断，且色卡错到图外
- **与 L12 的区别**：L12 是出血版式（section 要 `has-card`，色带溢出卡片边缘）；L70 只错出 56px、留在 `.slide-inner` 里，**不要加 `has-card`**
- **与 L66 的区别**：L66 是右半横图 + `mask-image` 羽化溶进浅底（无边界）；L70 是左侧竖图 + 硬边 + 色卡错位
