# L62 · `team-portrait-rows`（内容页：标题条 + 两列人像卡「左 3:4 人像 + 右 姓名/头衔/一句话」）

> **📄 详情**：本文件供 design 阶段匹配到 L62 时**必读**。
> **★ 核心原则**：结构是灵魂，颜色/内容不绑死。所有配色必须用 `var(--c-*)` 变量。

---

## 一、结构速览

- **比例**：16:9，在 `.slide-inner` 里。顶上一条标题带（左边 42px 衬线标题 + 右边一句灰色引言，下面一条 2px 深线），下面**两列 × N 行**的人像卡：每张卡左边一张 3:4 竖版人像、右边三行字（姓名 / 头衔·年限 / 一句话）
- **核心手法**：**人数决定行数，行高决定图有多大** —— 人像不给宽度，只给 `aspect-ratio:3/4`，高度由那一行撑出来，所以 4 个人和 8 个人用同一份 CSS 都排得满，中间不留空档
- **是否全幅**：否（包 `.slide-inner`，留白由 `--pad-*` 给，这一层别自己写 padding）
- **页眉照旧贴**：内容页，左上角那行模块名由代码贴（`.slide-header`），**md 和模型都不要写**
- **什么时候用**：**一页要摆好几个人** —— 项目组配置 / 专家团队 / 评审组 / 榜样人物 / 讲师阵容 / 合作方对接人。**3–8 人**（推荐 4 或 6，偶数最齐）；只有 1 个人换 L12（圆形浮卡人物页），要摆的是「4 个地方 / 4 款产品」那种非人物卡换 L16

---

## 二、结构拆解（自上而下）

### 1. 标题条 · `.l62-head`

- `display:flex` + `align-items:flex-end` + `justify-content:space-between`，下沿 2px `var(--c-ink-deep)` 实线。
- 标题**必须写成 `<h2 class="page-title">`**（页脚目录面板靠 `.page-title` 取这一页的标题；写成别的类之后目录里这一页是空的，而页面上标题好好地在）。42px 衬线，**≤14 个汉字、一行**。
- 右边 `.l62-lead` 是一句灰色引言（`var(--c-ink-soft)`、右对齐、宽度 ≤42%）：**说的是「这些人凑在一起意味着什么」**，不是把标题换个说法重复一遍（重复的话 `checkPage` ⑧ 会在每一页报一句领句抄标题）。**≤30 字、一行**。可以整个去掉（V2）。

### 2. 人像卡栅格 · `.l62-grid`

- 固定 `grid-template-columns:1fr 1fr` + `grid-auto-rows:1fr`：**两列**，行数跟着人数走。`flex:1;min-height:0` 让它吃掉标题条以下的全部高度。
- 实测（1920×1080、`--pad-*` 默认那一档）：可用高度 762px、列宽 788px。
  - 3–4 人 → 2 行，行高 **364px**，人像 273px 宽，右边文字 489px
  - 5–6 人 → 3 行，行高 **231px**，人像 173px 宽，右边文字 589px
  - 7–8 人 → 4 行，行高 **165px**，人像 124px 宽，右边文字 638px
- **别改成三列**：三列的列宽只有 517px，人像照旧按行高反算成 273px 宽，右边只剩 218px —— 姓名一行两个字、说明一行五个字，而每一格都渲染正常。
- **别把 `grid-auto-rows:1fr` 去掉**：去掉之后行高跟着内容走，说明写长了的那个人比别人高一截，两列的人像于是左右错开，整页看起来是歪的。
- **9 人起不要用这一条**（5 行以后行高 128px，人像 96px 宽，脸小到认不出是谁；那时应该分两页，或者改用只有姓名+头衔的名单页）。

### 3. 单张人像卡 · `.l62-card`

- `display:flex` + `align-items:stretch` + `gap:26px`。
- `.l62-photo`：**只给 `aspect-ratio:3/4`，不给 width/height**。卡片 stretch 之后它的高度就是行高，宽度由比例反算 —— 这是「4 人和 8 人共用一份 CSS」的全部原因。写死宽度的话人数一变就是「图挤成一条」或者「最后一行掉出画面下沿」，而每一格单看都排得好。
- `<img>` 一律 `object-fit:cover` + **`object-position:top center`**：人像的脸在上三分之一，居中裁会切掉半个额头，而画面上仍是一张完整的照片、一处都不报错。
- `.l62-txt` 垂直居中三行：`.l62-name`（姓名，26px/800）→ `.l62-role`（头衔 · 年限，16px `var(--num)` `var(--c-brand-deep)`）→ `.l62-note`（一句话，顶一条 1px 细线）。
- 三行的高度约 120px（说明换两行时 148px），所以 **7–8 人那一档说明只能写一行**：第三行起顶出行高，下面那一行的人像跟着被顶下去（不是被裁，是往下漏），看着像「这一页多了一个人」。

---

## 三、CSS 骨架

```css
/* L62 内容页（团队/多人）：标题条 + 两列人像卡（左 3:4 人像 + 右 姓名/头衔/一句话） */
.l62-wrap{flex:1;min-height:0;display:flex;flex-direction:column}
.l62-head{display:flex;align-items:flex-end;justify-content:space-between;gap:40px;padding-bottom:20px;border-bottom:2px solid var(--c-ink-deep)}
.l62-head .page-title{font-family:var(--serif);font-size:42px;font-weight:900;line-height:1.15;letter-spacing:-.01em;color:var(--c-ink-deep);margin-top:0}
.l62-lead{flex:none;max-width:42%;font-size:17px;line-height:1.7;color:var(--c-ink-soft);text-align:right}
.l62-grid{flex:1;min-height:0;margin-top:30px;display:grid;grid-template-columns:1fr 1fr;grid-auto-rows:1fr;gap:34px 64px}
.l62-card{display:flex;align-items:stretch;gap:26px;min-height:0}
.l62-photo{flex:none;aspect-ratio:3/4;background:var(--c-bg-alt);overflow:hidden}
.l62-photo img{width:100%;height:100%;object-fit:cover;object-position:top center;display:block}
.l62-txt{flex:1;min-width:0;display:flex;flex-direction:column;justify-content:center}
.l62-name{font-size:26px;font-weight:800;line-height:1.25;color:var(--c-ink-deep)}
.l62-role{margin-top:8px;font-family:var(--num);font-size:16px;font-weight:700;letter-spacing:.06em;color:var(--c-brand-deep)}
.l62-note{margin-top:14px;padding-top:14px;border-top:1px solid var(--c-hairline);font-size:17px;line-height:1.65;color:var(--c-ink)}
.l62-card.on .l62-photo{outline:3px solid var(--c-brand);outline-offset:-3px}
.l62-card.on .l62-name{color:var(--c-brand-deep)}
```

---

## 四、build-part 结构模板

```html
<section class="slide" data-layout="L62">
  <!-- 左上角那行模块名由代码统一贴，这里不要写 -->
  <div class="slide-inner">
  <div class="l62-wrap">
    <div class="l62-head">
      <h2 class="page-title">{{这一页的标题，14 字内}}</h2>
      <div class="l62-lead">{{一句引言：这几个人凑在一起意味着什么，30 字内}}</div>
    </div>
    <div class="l62-grid">
      <div class="l62-card">
        <div class="l62-photo"><img src="/ppt-cases/ph-3x4.svg" alt="" data-img-prompt="这一格要配什么人像（中文一句话：性别年龄段 + 身份 + 半身工作照、浅灰背景、自然光、齐胸景别、正面平视）" data-img-mode="case"></div>
        <div class="l62-txt">
          <div class="l62-name">{{姓名}}</div>
          <div class="l62-role">{{头衔 · 年限}}</div>
          <div class="l62-note">{{一句话：他在这件事里负责什么}}</div>
        </div>
      </div>
      <div class="l62-card">
        <div class="l62-photo"><img src="/ppt-cases/ph-3x4.svg" alt="" data-img-prompt="同上，同一批人像的第二张（背景、光线、景别必须和上一张一致）" data-img-mode="case"></div>
        <div class="l62-txt">
          <div class="l62-name">{{姓名}}</div>
          <div class="l62-role">{{头衔 · 年限}}</div>
          <div class="l62-note">{{一句话}}</div>
        </div>
      </div>
      <div class="l62-card">
        <div class="l62-photo"><img src="/ppt-cases/ph-3x4.svg" alt="" data-img-prompt="同上，同一批人像的第三张" data-img-mode="case"></div>
        <div class="l62-txt">
          <div class="l62-name">{{姓名}}</div>
          <div class="l62-role">{{头衔 · 年限}}</div>
          <div class="l62-note">{{一句话}}</div>
        </div>
      </div>
      <div class="l62-card">
        <div class="l62-photo"><img src="/ppt-cases/ph-3x4.svg" alt="" data-img-prompt="同上，同一批人像的第四张" data-img-mode="case"></div>
        <div class="l62-txt">
          <div class="l62-name">{{姓名}}</div>
          <div class="l62-role">{{头衔 · 年限}}</div>
          <div class="l62-note">{{一句话}}</div>
        </div>
      </div>
    </div>
  </div>
  </div>
</section>
```

---

## 五、图槽位

| 槽位 | 必填? | 模式 | 比例 | 构图要求 |
|------|-------|------|------|----------|
| `pXX_p1`..`pXX_p8` | **必填，一人一张**（缺一张那一格是一块 `var(--c-bg-alt)` 的空框，右边的名字和头衔照旧在，看起来像「这个人没照片」而不像出错了） | case | 3:4 | **同一批人像**：同一种背景（浅灰/浅色墙）、同一种光、同一个景别（齐胸半身）、正面平视，主体居中偏上（脸在上三分之一，`object-position:top center` 按这个裁）。**不要混搭**（一张影棚白底 + 一张户外逆光摆在一列里，整页立刻散掉）；不要全身照（缩到 124px 宽时脸只有几个像素）；不要带文字/水印的图 |

---

## 六、变体

| 编号 | 变化 | 用途 |
|------|------|------|
| V1 | 6 人（3 行）/ 8 人（4 行） | 团队更大；说明跟着压到一行 |
| V2 | 去掉 `.l62-lead` | 标题自己够说明白 |
| V3 | 某张卡加 `on` 类 | 点出主负责人（人像描一圈品牌色边、姓名转 `var(--c-brand-deep)`） |
| V4 | 去掉 `.l62-note` | 只有姓名和头衔的阵容页（此时人数可到 8） |
| V5 | `.l62-role` inline style 改 `var(--c-accent-deep)` | 这一份的点缀色是冷的 |
| V6 | `.l62-photo` inline style 加 `border-radius:50%` + `aspect-ratio:1/1` | 圆形头像风（**必须整页一起改**，混着方圆两种是最扎眼的一种不齐） |

---

## 七、design 提示

- **人数 3–8，推荐 4 或 6（偶数）**：5 人 / 7 人时最后一行右边空一格 —— 不裁、不报错，看起来像「漏了一个人」。9 人起换成两页
- **别改成三列**：三列的文字区只剩 218px，姓名一行两个字，而每一格都渲染正常
- **别去掉 `grid-auto-rows:1fr`**：行高跟着内容走之后两列的人像左右错开，整页是歪的
- **7–8 人那一档说明只写一行**（≤34 字）：第三行起把下面那一行的人像往下顶，看着像多了一个人；4 人那一档可以写两行（≤56 字）
- **人像必须是同一批**（同背景、同光、同景别）：混搭的话每一张单看都好，摆成一列立刻散
- **`object-position` 保持 `top center`**：改成居中会切掉额头，而画面上是一张完整的照片
- **标题必须是 `.page-title`**（页脚目录面板按它取标题，换个类之后目录里这一页是空的）
- **别给 `.l62-wrap` 写 padding**（留白由 `.slide-inner` 的 `--pad-*` 给，改了它标题会被左上角那行模块名压住）
- **配色**：标题 `var(--c-ink-deep)`、引言 `var(--c-ink-soft)`、头衔 `var(--c-brand-deep)`、说明 `var(--c-ink)`、细线 `var(--c-hairline)`、人像底框 `var(--c-bg-alt)`
- **与 L12 的区别**：L12 是**一个人**的圆形浮卡人物页（巨字 + 一段简介）；L62 是一页摆 3–8 个人，每人三行字
- **与 L16 的区别**：L16 是四栏「图在上、文在下」的等宽矩阵（城市/产品/案例），图文竖着排；L62 是两列「图在左、文在右」的人像卡，行数跟着人数变
- **与 L11 的区别**：L11 是全幅图叠字的三栏叙事，图是场景不是人像
- **整份最多一页 L62**（团队只介绍一次），放在方案/资历那一段，别和 L12 相邻（连着两页人像看起来像同一页没动）
