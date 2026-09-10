# L35 · `cover-offset-block-portrait`（封面：左侧标题 + 右侧品牌色块与竖图错位叠压）

> **📄 详情**：本文件供 design 阶段匹配到 L35 时**必读**。
> **★ 核心原则**：结构是灵魂，颜色/内容不绑死。所有配色必须用 `var(--c-*)` 变量。

---

## 一、结构速览

- **比例**：16:9，浅底、文字为主，右半一块品牌色 + 一张竖图，视觉中等偏重
- **核心手法**：**三层错位叠压** —— ① 一块品牌色实块贴右边缘通高（`.l35-block`，宽 42%）；② 一张竖图（`.l35-fig`）**往左下错开**压在色块上（`right:200px`、上下各留 96px），于是色块只在右侧露出一条 200px、上下各露一条；③ 左半浅底上是文字：顶部一行加宽字距英文（`.l35-en`）→ 64×5px 品牌色短杠（`.l35-rule`）→ 78px 衬线主标题 → 一行主张 → 底部一条细线上的两栏元信息（`.l35-foot`）
- **是否全幅**：**是** —— 不包 `.slide-inner`（色块和竖图都要贴到画面边缘）
- **只当整份第 1 页用**（`归属` 只写封面）
- **底色**：默认不加类（左半就是 deck 的 `var(--c-bg)`）

---

## 二、结构拆解（由后到前）

### 1. 色块 · `.l35-block`

- 通高贴右边缘，宽 42%。它的作用只有一个：**给竖图垫出一条露边**（右侧 200px + 上下各 96px）。
- **别把竖图铺到右边缘**：那 200px 是整页唯一的品牌色实块，图盖满之后这一页就只是"左文右图"，和 L1 / L3 撞了，而画面照样是一页正常的封面。
- 整份走冷色时改用 `var(--c-accent)`（V3）；不要在这里用 `var(--c-bg-alt)` 那种浅色，色块和左半浅底会糊成一片。

### 2. 竖图 · `.l35-fig`

- `top:96px;bottom:96px;right:200px;width:38%` —— **四个值一起构成"错位"**。改成 `inset` 对齐色块（同高同右）之后三层的层次立刻塌成两层，而每一层都渲染正常。
- 阴影（`0 40px 90px`）是"浮在色块之上"的唯一线索，别去掉。
- **竖构图**、主体居中偏上：图的下缘会被阴影和色块的暗部压住。
- 没有配图时整个 `.l35-fig` 删掉即可（只剩一块品牌色，V4）。

### 3. 文字 · `.l35-en` / `.l35-txt` / `.l35-foot`

- 三块都固定在左半（`left:var(--pad-x)`，宽 42%）：**加宽这个宽度会撞到竖图的左边缘**（竖图从 990px 开始，文字块到 946px 结束，只剩 44px 余量），撞上之后标题最后几个字压在照片上，而那几个字仍然是深色、读起来只是"有点脏"。
- 标题**必须写成 `<h1 class="page-title">`**（页脚目录面板靠它取标题）。主题词用 `<em>`（非斜体，转 `var(--c-brand-deep)`），**只标一处**。
- 文字块**靠 `top:50%` + `translateY(-58%)` 在左半垂直居中**（略偏上）：这一块的高度随标题行数变（两行 ≈ 330px、三行 ≈ 420px），居中之后上下留白自己找平。**换回写死的 `top:` 之后，两行标题的那一份下面会空出三百像素**，而那一页照样是一页排版完整的封面 —— 只是"看起来有点松"。主标题最多三行（78px × 三行 ≈ 271px），四行会顶到底部那条细线。
- `.l35-foot` 是两栏（`display:flex;gap:56px`）：每栏 = `<b>`（加宽字距小标签）+ 一行内容。它靠 `bottom:var(--pad-bottom)` 和正文网格对齐，**不要改成 `bottom:0`**（那样它会掉到页脚色带里）。
- 顶部那行 `.l35-en` 在 `top:var(--pad-top)`：这一条不贴统一页眉，所以那条带子是空的，可以放东西；**但不要往上挪到 44px** —— 换成贴页眉的版式复用这段 CSS 时，那一行会和页眉重叠。

---

## 三、CSS 骨架

```css
/* L35 品牌色块与竖图错位叠压（全幅封面） */
.l35-wrap{position:absolute;inset:0;overflow:hidden;background:var(--c-bg)}
.l35-block{position:absolute;top:0;right:0;bottom:0;width:42%;background:var(--c-brand);z-index:0}
.l35-fig{position:absolute;top:96px;bottom:96px;right:200px;width:38%;overflow:hidden;z-index:1;box-shadow:0 40px 90px rgba(0,0,0,.28)}
.l35-fig img{width:100%;height:100%;object-fit:cover;display:block}
.l35-en{position:absolute;left:var(--pad-x);top:var(--pad-top);z-index:2;font-family:var(--num);font-size:16px;font-weight:700;letter-spacing:.3em;color:var(--c-brand-deep)}
.l35-txt{position:absolute;left:var(--pad-x);top:50%;transform:translateY(-58%);width:42%;z-index:2}
.l35-rule{width:64px;height:5px;background:var(--c-brand);margin-bottom:30px}
.l35-txt .page-title{font-family:var(--serif);font-size:78px;font-weight:900;line-height:1.16;letter-spacing:-.02em;color:var(--c-ink-deep);margin-top:0}
.l35-txt .page-title em{font-style:normal;color:var(--c-brand-deep)}
.l35-txt p{margin-top:26px;font-size:23px;line-height:1.75;color:var(--c-ink);max-width:600px}
.l35-foot{position:absolute;left:var(--pad-x);bottom:var(--pad-bottom);z-index:2;width:42%;display:flex;gap:56px;padding-top:22px;border-top:1px solid var(--c-hairline)}
.l35-foot div{font-size:19px;color:var(--c-ink-deep)}
.l35-foot b{display:block;font-family:var(--num);font-size:14px;font-weight:700;letter-spacing:.2em;color:var(--c-ink-soft);margin-bottom:8px}
```

---

## 四、build-part 结构模板

```html
<section class="slide" data-layout="L35">
  <!-- 全幅：不包 .slide-inner。封面页不贴统一页眉（代码不贴，这里也不要写） -->
  <div class="l35-wrap">
    <div class="l35-block"></div>
    <div class="l35-fig">
      <img src="/ppt-cases/ph-3x4.svg" alt="" data-img-prompt="封面竖图要什么（中文一句话，竖构图、主体居中偏上）" data-img-mode="concept">
    </div>
    <div class="l35-en">{{英文/拼音小字，如 2026 MID-YEAR REPORT}}</div>
    <div class="l35-txt">
      <div class="l35-rule"></div>
      <h1 class="page-title">{{主标题}}<em>{{要上品牌色的那个主题词}}</em></h1>
      <p>{{一行主张，34 字内}}</p>
    </div>
    <div class="l35-foot">
      <div><b>{{标签，如 SPEAKER}}</b>{{汇报人 / 单位}}</div>
      <div><b>{{标签，如 DATE}}</b>{{日期 / 场合}}</div>
    </div>
  </div>
</section>
```

---

## 五、图槽位

| 槽位 | 必填? | 模式 | 比例 | 构图要求 |
|------|-------|------|------|----------|
| `pXX_fig` | 可选（没有就走 V4） | concept | 3:4 | 右侧竖图（约 730×888，`cover` 裁切）：**竖构图**、主体居中偏上，下缘会被阴影和色块暗部压住；调性要和品牌色搭得上（同色系或中性灰调） |

**禁用**：横构图（切成竖块只剩局部）、带文字的图、和品牌色打架的高饱和图、人脸贴边的特写

---

## 六、变体

| 编号 | 变化 | 用途 |
|------|------|------|
| V1 | 色块与竖图整组镜像到左边（`left` / `right` 互换，文字移到右半） | 同一份里已经出现过右图封面 |
| V2 | 竖图换 1:1（`width:34%`，上下留白加大） | 只有方图可用 |
| V3 | 色块改 `var(--c-accent)` | 整份走冷色调 |
| V4 | 去掉竖图（`.l35-fig` 删掉，只剩色块） | 找不到搭得上的竖图时 |
| V5 | 去掉 `.l35-foot`（汇报信息放主张里） | 封面不写人和日期 |
| V6 | 色块改成 `var(--c-ink-deep)` 深块 + 竖图不加阴影 | 严肃场合 |

---

## 七、design 提示

- **只当整份第 1 页**：它没有页眉、也没有留给正文的空间；章节扉页用 L2 / L31
- **视觉中等偏重**：左半是浅底大字，比 L34 轻一档 —— 同一份里两条封面**只能选一条**
- **错位是结构签名**：图和色块对齐之后这一页就是"左文右图"，和 L1 / L3 撞了，而每一层都渲染正常
- **文字块宽度别加**：42% 到竖图左缘只剩 44px 余量，加宽之后标题末几个字压在照片上，颜色还是深的，读起来只是"有点脏"
- **配色**：色块 `var(--c-brand)`（冷色 deck 用 `var(--c-accent)`），短杠同色；主题词 `<em>` 走 `var(--c-brand-deep)`（在浅底上比 `var(--c-brand)` 更压得住）；元信息标签 `var(--c-ink-soft)`
- **与 L34 的区别**：L34 是暗底三条幕帘 + 横贯白带（杂志感、图为主），L35 是浅底 + 一块色 + 一张竖图（克制、文字为主）
- **与 L20 的区别**：L20 是左 30% 浮文带压在宽 hero 上（文字在图上），L35 的文字在自己的浅底上，图不参与承载文字
