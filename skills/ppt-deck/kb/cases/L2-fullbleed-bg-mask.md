# L2 · `fullbleed-bg-mask`（全幅背景 + 浅色遮罩，居中一句主标题）

> **📄 详情**：design 阶段匹配到 L2 时**必读**。
> **★ 核心原则**：结构是灵魂，颜色/内容不绑死 —— 所有配色只用 `var(--c-*)`。
> **★ CSS 在 `library/template.html` 的公共段里（`.case-bg` / `.slide.has-bg` …），这份 md 不抄一份**
> （抄了之后 template 一改这里就在说谎，而模型照这份写 inline style 去补，出来是一页遮罩叠了两层、
> 字反而更糊的正常幻灯片）。

---

## 一、结构速览

- **比例**：16:9 横版，背景图铺满整页 + 自上而下加深的浅色遮罩
- **是否全幅**：**否** —— 图是 `.case-bg`（绝对定位 inset:0）铺满的，**文字照旧包在 `.slide-inner` 里**。
  不包的话标题贴着画面边缘，而且疏密档（舒展 / 紧凑改的就是 `.slide-inner` 的 padding）在这一页
  一个像素都不动 —— 它仍是一页完整的章节封面，一处都不报错。
- **section 上的类**：`has-bg`（让 `.slide-inner` 浮到图上面）+ `tinted` 或 `cool`（章节底色三态，跟这一章的色温）
- **不贴统一页眉**：代码对 L2 不贴（`layout.noHeader`），所以**正文里也不要写模块名** —— 写了没人摘，等于这一页多出一行字
- **核心手法**：整页一句话。除标题外最多一行副标，多一块内容就该换 L13 或 L7

---

## 二、结构拆解（居中堆叠）

`.slide-inner` 上加 `style="align-items:center;justify-content:center;text-align:center"`，里面四层：

1. **段落序号**（`.kicker`，20px）—— `SECTION 02` / `PART THREE` 这种，别写中文长句
2. **主标题**（`.page-title` + inline `font-size:88px;margin-top:14px`）—— 一行，12 字以内最有力
3. **色条**（`.title-bar` + inline `margin:26px auto 22px`；居中必须靠 `margin:auto`，不加就贴到左边）
4. **一行副标**（`<p>`，24px，`var(--c-ink-soft)`，`letter-spacing:2px`）—— 可省

**遮罩不要自己加**：`.case-bg::after` 已经是一层随 palette 走的浅色渐变（`--mask-rgb`）。
自己再叠一个 `rgba(0,0,0,.4)` 的话，浅色遮罩 + 深色遮罩叠在一起，字比不加更糊，
而且那个黑色不跟 palette 变 —— 画面上只是「这一页有点脏」。

---

## 三、build-part 结构模板

```html
<section class="slide has-bg tinted">
  <!-- 全幅背景图（遮罩由 .case-bg::after 自动给；这一页不贴页眉，正文里也不要写模块名） -->
  <div class="case-bg"><img src="/ppt-cases/ph-16x9.svg" data-img-prompt="这一格要什么图（中文一句话）" data-img-mode="case" alt=""></div>
  <div class="slide-inner" style="align-items:center;justify-content:center;text-align:center">
    <div class="kicker">{{SECTION 02}}</div>
    <h1 class="page-title" style="font-size:88px;margin-top:14px">{{一句主标题，12 字内}}</h1>
    <div class="title-bar" style="margin:26px auto 22px"></div>
    <p style="font-size:24px;color:var(--c-ink-soft);letter-spacing:2px">{{一行副标，可省}}</p>
  </div>
</section>
```

---

## 四、图槽位

| 槽位 | 必填? | 模式 | 比例 | 构图要求 |
|------|-------|------|------|----------|
| `pXX_bg` | ✅ 必填 | case / concept | 16:9 | 整页氛围图，**中间不要有主体**（标题就压在中间）；远景、材质、天空、城市轮廓都行 |

**禁用**：人物 closeup、信息图、图表、带文字的截图（遮罩之后那些字既看不清又在跟标题抢）。

---

## 五、变体

| 编号 | 变化 | 用途 |
|------|------|------|
| V1 | 左对齐（去掉居中那三个 inline 值，`.slide-inner` 默认就是左上） | 连续多页章节封面时换气 |
| V2 | `cool` 底色 | 换到冷色章节 |
| V3 | 去掉副标，只留标题 | 过渡页 |
| V4 | 标题下加一行 `.kicker` 当日期/署名 | 总结页 |

---

## 六、design 提示

- **视觉重**（整页图 + 88px 大字），前后必须是内容页，不要和 L13 / L7 挨着 —— 两页都是"整页一句话"，翻起来像卡住了
- **整份里用得最多的一条**：每个章节开头一页。同一份 deck 里连续用要换图的色温，不然读起来像同一页
- **与 L13 的区别**：L13 是封面（年份大字 + 双语脚注 + 胶囊标签，不包 `.slide-inner`），L2 是章节扉页（一句话 + 色条）
- **与 L7 的区别**：L7 是纯色底金句（无图），L2 靠图给气场
