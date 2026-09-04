# L10 · `icon-row`（图标行 · 横排 N 个能力卡）

> **📄 详情**：design 阶段匹配到 L10 时**必读**。
> **★ 核心原则**：结构是灵魂，颜色/内容不绑死 —— 所有配色只用 `var(--c-*)`。
> **★ CSS 在 `library/template.html` 的公共段里（`.card`），横排网格是 inline 写的，这份 md 不抄 CSS。**

---

## 一、结构速览

- **比例**：16:9 横版，标题在上、3–4 张等宽卡横排居中
- **是否全幅**：否 —— 全部内容包在 `.slide-inner` 里
- **核心手法**：① N 个**同构**单元（图标 + 小标题 + 一句）；② 每张卡都是 `.card`（不加 orange/blue）；③ 图标是小的（76px），不是视觉主角
- **底色**：默认不加类

---

## 二、结构拆解

1. **主标题**（`.page-title`）—— 写出**这几项之间是什么关系**（"四项能力，可单独交付"）。
   "可单独交付"这半句才是这一页的信息：只写"我们的能力"的话，读者不知道是套餐还是可拆的。
2. **色条**（`.title-bar`）
3. **横排网格**（inline `style="flex:1;display:grid;grid-template-columns:repeat(4,1fr);gap:26px;align-content:center"`）
   - **必须等宽**（`repeat(N,1fr)`）：这几项是并列的，宽度不同会读成"第一项最重要"。
   - 不给 `align-content:center` 的话卡片贴在标题下面、底部空一大块。
4. **每张卡**（`.card` —— **不加 `orange` / `blue`**）三层，顺序固定：
   - `<img src="/ppt-cases/ph-1x1.svg" alt="" style="width:76px;height:76px;border-radius:18px;margin-bottom:20px">`
     —— 尺寸必须 inline 写死：这里的 `<img>` 不在 `.gallery` 里，没有任何类兜住它，
     不写的话一张 1024 的图标图会把那张卡撑成整页高，而 HTML 照样渲染。
   - `<b style="font-size:24px;color:var(--c-ink-deep)">` 能力名 —— 2–4 字。
   - `<p style="font-size:17px;line-height:1.8">` 一句话，说**交付什么/多久**，≤ 18 字。

**左橙右蓝那套语义在这一页不适用**：`.card orange` / `.card blue` 表示"对立/对照"（见 L4），
这一页的几项是**平等并列**的。给它们分别上橙蓝之后，读者会去找"这两组的对立关系"，
而根本没有那层意思 —— 画面上只是"这页颜色挺丰富"。

---

## 三、build-part 结构模板

```html
<section class="slide">
  <!-- 左上角那行模块名由代码统一贴，这里不要写 -->
  <div class="slide-inner">
    <h1 class="page-title">{{标题，写出这几项之间的关系}}</h1>
    <div class="title-bar"></div>
    <div style="flex:1;display:grid;grid-template-columns:repeat(4,1fr);gap:26px;align-content:center">
      <div class="card">
        <img src="/ppt-cases/ph-1x1.svg" alt="" style="width:76px;height:76px;border-radius:18px;margin-bottom:20px" data-img-prompt="这一项要什么图标（中文一句话）" data-img-mode="concept">
        <b style="font-size:24px;color:var(--c-ink-deep)">{{能力名}}</b>
        <p style="font-size:17px;line-height:1.8;margin-top:10px">{{交付什么/多久}}</p>
      </div>
      <div class="card">
        <img src="/ppt-cases/ph-1x1.svg" alt="" style="width:76px;height:76px;border-radius:18px;margin-bottom:20px" data-img-prompt="这一项要什么图标（中文一句话）" data-img-mode="concept">
        <b style="font-size:24px;color:var(--c-ink-deep)">{{能力名}}</b>
        <p style="font-size:17px;line-height:1.8;margin-top:10px">{{交付什么/多久}}</p>
      </div>
      <div class="card">
        <img src="/ppt-cases/ph-1x1.svg" alt="" style="width:76px;height:76px;border-radius:18px;margin-bottom:20px" data-img-prompt="这一项要什么图标（中文一句话）" data-img-mode="concept">
        <b style="font-size:24px;color:var(--c-ink-deep)">{{能力名}}</b>
        <p style="font-size:17px;line-height:1.8;margin-top:10px">{{交付什么/多久}}</p>
      </div>
      <div class="card">
        <img src="/ppt-cases/ph-1x1.svg" alt="" style="width:76px;height:76px;border-radius:18px;margin-bottom:20px" data-img-prompt="这一项要什么图标（中文一句话）" data-img-mode="concept">
        <b style="font-size:24px;color:var(--c-ink-deep)">{{能力名}}</b>
        <p style="font-size:17px;line-height:1.8;margin-top:10px">{{交付什么/多久}}</p>
      </div>
    </div>
  </div>
</section>
```

---

## 四、图槽位

| 槽位 | 必填? | 模式 | 比例 | 构图要求 |
|------|-------|------|------|----------|
| `pXX_ic1` … `pXX_ic4` | 可选（要么全有，要么全无） | concept | 1:1 | **单色扁平图标感，N 张必须同一路画风**；主体居中、留白足（76px 里看得清） |

**要么全有要么全无**：三张有图标一张没有的时候，那一张卡的标题会往上跳一截 —— 画面上
看起来是"这一格排版塌了"，而它其实只是缺一张图。所以图标要么每张卡都写 `data-img-prompt`，
要么整页都不写（这时把 `<img>` 整行删掉，纯文字版更干净）。

**图标里不要有文字**：76px 里任何字都是一团糊，而生成出来的图自己看起来是完整的。

---

## 五、变体

| 编号 | 变化 | 用途 |
|------|------|------|
| V1 | 3 栏（`repeat(3,1fr)`，图标提到 88px） | 三项能力 |
| V2 | 5 栏（`repeat(5,1fr)`，图标收到 60px、正文 15px） | 五项，是上限 |
| V3 | 2×2（`repeat(2,1fr)` + `grid-template-rows:1fr 1fr`） | 四项且每项文字较多 |
| V4 | 去掉 `<img>`，改用 `.point-bar` 的 `.ic` 编号圆点 | 拿不到统一画风的图标时 |
| V5 | 每张卡底部加一行 `.kicker` 当英文名 | 双语场景 |

---

## 六、design 提示

- **视觉轻**：四个小图标 + 浅卡，前后可以直接接图重的版式（L2 / L11 / L13）
- **项数铁律**：3–5 项。2 项用 L4（左右对比），≥ 6 项说明这该是一张表
- **图标不能抢戏**：≤ 200px。图标一大这一页就变成了 L8（图廊），而它承载的信息其实是文字
- **与 L4 的区别**：L4 是两块**对立**（有色彩语义），L10 是 N 项**并列**（无色彩语义）
- **与 L15 的区别**：L15 是三栏克制排版（无卡片描边 + hero 图 + 双语），气质更高级；L10 是清单感
- **与 L16 的区别**：L16 每格图占 70% 高（纸面陈列），L10 的图只是一个 76px 的标记
