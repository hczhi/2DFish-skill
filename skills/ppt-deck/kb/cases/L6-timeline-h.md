# L6 · `timeline-h`（横向时间轴 · 轴线 + 4 个阶段卡）

> **📄 详情**：design 阶段匹配到 L6 时**必读**。
> **★ 核心原则**：结构是灵魂，颜色/内容不绑死 —— 所有配色只用 `var(--c-*)`。
> **★ CSS 在 `library/template.html` 的公共段里（`.prog-item` / `.prog-item .yr`），这份 md 不抄一份。**

---

## 一、结构速览

- **比例**：16:9 横版，标题在上、轴线 + 阶段卡整块垂直居中
- **是否全幅**：否 —— 全部内容包在 `.slide-inner` 里
- **核心手法**：① 一条品牌色→强调色的渐变横线代表时间方向；② 线下面 3–5 个等宽卡片，每张一个阶段；③ 每张卡的第一行是**时间锚点**（年份/季度/阶段号），是这一页唯一的数字重量
- **底色**：默认不加类；盘点/回顾类的可以加 `cool`

---

## 二、结构拆解

1. **主标题**（`.page-title`）—— 写出**这几个阶段之间在变什么**（"四个阶段，各自的坎不同"），
   不要只写"发展历程"：只写历程的话四张卡就是四段并列的介绍，读者看不出为什么要排成一条线。
2. **色条**（`.title-bar`）
3. **居中容器**（inline `style="flex:1;display:flex;flex-direction:column;justify-content:center;gap:34px"`）
   —— 不给 `flex:1` 的话轴线贴在标题下面、下半页空一大块。
4. **轴线**（一个空 `<div>`，inline `style="height:3px;background:linear-gradient(90deg,var(--c-brand),var(--c-accent));border-radius:2px"`）
   —— 渐变方向就是时间方向，**不要反着写**（`var(--c-accent),var(--c-brand)`）：反了之后
   整页读起来是"从现在退回过去"，而画面完全正常。
5. **阶段网格**（inline `style="display:grid;grid-template-columns:repeat(4,1fr);gap:26px"`）
   —— **必须等宽**。按"哪个阶段内容多"给不同宽度的话，卡片宽度就变成了另一层含义
   （读者会以为宽的那段时间更长），而那通常不是真的。
6. **每格**（`.prog-item`）三行，顺序固定：
   - `<span class="yr">` 时间锚点（等宽数字字体，26px）—— **必须是真实的年份/季度**，
     推不出来时用"第一阶段"这种序号，别编年份（硬规则 3：会算错的东西不交给模型编）。
   - `<b style="font-size:22px;color:var(--c-ink-deep)">` 阶段名 —— 2–4 字。
   - `<p style="font-size:17px;line-height:1.75">` 一句话，说这个阶段**卡在哪**，≤ 20 字。

---

## 三、build-part 结构模板

```html
<section class="slide">
  <!-- 左上角那行模块名由代码统一贴，这里不要写 -->
  <div class="slide-inner">
    <h1 class="page-title">{{标题，写出阶段之间在变什么}}</h1>
    <div class="title-bar"></div>
    <div style="flex:1;display:flex;flex-direction:column;justify-content:center;gap:34px">
      <div style="height:3px;background:linear-gradient(90deg,var(--c-brand),var(--c-accent));border-radius:2px"></div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:26px">
        <div class="prog-item"><span class="yr">{{2022}}</span><b style="font-size:22px;color:var(--c-ink-deep)">{{阶段名}}</b><p style="font-size:17px;line-height:1.75">{{这个阶段卡在哪}}</p></div>
        <div class="prog-item"><span class="yr">{{2023}}</span><b style="font-size:22px;color:var(--c-ink-deep)">{{阶段名}}</b><p style="font-size:17px;line-height:1.75">{{这个阶段卡在哪}}</p></div>
        <div class="prog-item"><span class="yr">{{2024}}</span><b style="font-size:22px;color:var(--c-ink-deep)">{{阶段名}}</b><p style="font-size:17px;line-height:1.75">{{这个阶段卡在哪}}</p></div>
        <div class="prog-item"><span class="yr">{{2025}}</span><b style="font-size:22px;color:var(--c-ink-deep)">{{阶段名}}</b><p style="font-size:17px;line-height:1.75">{{这个阶段卡在哪}}</p></div>
      </div>
    </div>
  </div>
</section>
```

---

## 四、图槽位

0 个（轴线本身就是这一页的视觉结构）。**不要给这一页配一张大图** —— 图和轴线会争同一条
横向视线，翻起来读者先看图、再回头找轴线，而两者都在。

要"阶段 + 画面"的页用 L11（三栏全幅照片叠字，每栏一个阶段）。

---

## 五、变体

| 编号 | 变化 | 用途 |
|------|------|------|
| V1 | 3 栏（`repeat(3,1fr)`） | 三阶段 —— 也可以直接用 L11 |
| V2 | 5 栏（`repeat(5,1fr)`，正文收到 15px） | 五阶段，是上限 |
| V3 | 轴线移到卡片下面（把那个 `<div>` 挪到网格后） | 想强调"这几步已经走完" |
| V4 | 每格加一行 `.kicker` 当英文阶段名 | 双语场景 |
| V5 | `.prog-item` 换成 `.card`，`.yr` 保留 | 阶段之间没有严格时间顺序（这时优先考虑 L10） |

---

## 六、design 提示

- **视觉轻**：一条线 + 四张浅卡，前后可以直接接图重的版式（L2 / L11 / L13）
- **格数铁律**：3–5 个。2 个用 L4（左右对比），≥ 6 个说明这该是一张表
- **时间锚点必须真实**：编出来的年份在这一页是最显眼的三处之一，而它不会报错
- **与 L5 的区别**：L5 的几个数**之间没有顺序**（并列指标），L6 有明确的先后
- **与 L10 的区别**：L10 是并列的 N 项能力（无顺序、每项配图标），L6 是同一件事的推进
