# L34 · `cover-slat-photos-title-band`（封面：三条不等宽竖图幕帘 + 横贯整幅的白色标题带）

> **📄 详情**：本文件供 design 阶段匹配到 L34 时**必读**。
> **★ 核心原则**：结构是灵魂，颜色/内容不绑死。所有配色必须用 `var(--c-*)` 变量。

---

## 一、结构速览

- **比例**：16:9，暗底（三张竖图铺满整幅）+ 一条白色横带，视觉重
- **核心手法**：① 整幅被切成**三条不等宽的竖图**（`.l34-slats`，`1.18fr / .74fr / 1.08fr`，缝隙 8px），像一排幕帘；② 一条**横贯整幅的白色标题带**（`.l34-band`，`left:0;right:0`）压在上三分之一处，把三条幕帘一起切断 —— 这一刀就是这一条封面的结构签名；③ 带子里三层：细线 eyebrow（`.l34-eyebrow`，英文小字 + 自动延伸的细线）→ 82px 衬线主标题（可用 `<em>` 给主题词上品牌色）→ 一行副标；④ 底部左右两端各一组小字元信息（`.l34-meta`，白字压在图上）
- **是否全幅**：**是** —— 不包 `.slide-inner`
- **只当整份第 1 页用**（`归属` 只写封面）：它没有页眉、也没有留给正文的空间
- **底色**：默认不加类（`.l34-wrap` 自带 `--c-ink-deep`；**图上没有蒙版**，暗调要图自己给）

---

## 二、结构拆解（由外到内）

### 1. 幕帘 · `.l34-slats` > `.l34-slat` × 3

- **三条宽度必须不等**（`1.18fr / .74fr / 1.08fr`）：改成 `repeat(3,1fr)` 之后它读成"三宫格图片墙"（那是 L32 干的事），封面的节奏感消失，而页面照样渲染。
- 每条一张**竖构图**图（缝隙里露出的是 `var(--c-ink-deep)` 底）。**幕帘上没有蒙版**（原来 `.l34-slat::after` 那层 `rgba(0,0,0,.48)` 已删，三条一起压黑整幅发灰）——
  于是底部那两组压在图上的白字元信息全靠图自己暗：三张都挑暗调/低调的，亮图进来那几行小字直接没了，而封面看起来完全正常。不够暗时拉「这一页的蒙版」滑块（20–30%）。
- **三张必须同一路调性/色温**：不同调性的三张并排时，那道 8px 缝隙会读成"三张不相干的图硬拼"。
- 配图缺一张时**三条一起去掉**（V4 纯色底），不要只放两张：`grid` 会把第三列留成一条深色空槽，而那条空槽看起来像图没加载出来。

### 2. 标题带 · `.l34-band`

- **横贯整幅**（`left:0;right:0`），内边距用 `var(--pad-x)` 和正文网格对齐。改成两边留白的浮卡就退化成"图上放个卡片"（L31 已经是那一条），幕帘被切断的那股封面劲没了。
- 顶边那条 6px `var(--c-brand)` 是唯一的品牌色实块，别去掉。
- 标题**必须写成 `<h1 class="page-title">`**（页脚目录面板靠它取标题；换成 `<div>` 之后那一页在目录里只剩一个页码，画面完全正常）。主题词用 `<em>`（非斜体，转品牌色），**只标一处**。
- 主标题最多两行（82px × 两行 ≈ 187px）。三行之后带子会长到把底部那排元信息盖住，而两者都还在渲染。
- 副标一行 ≤ 34 字；不需要就整个 `.l34-sub` 删掉。

### 3. 元信息 · `.l34-meta`

- `display:flex;justify-content:space-between` —— **左右各一组，正好两组**。写一组的话它会孤零零地贴在左下，写三组则中间那组无处对齐。
- 每组 = `<b>`（英文/拼音标签，加宽字距的小字）+ 一行内容（汇报人 / 日期 / 单位）。
- 它压在**下半张图**上，所以幕帘图的下缘不要有要看的细节。

---

## 三、CSS 骨架

```css
/* L34 三条竖图幕帘 + 横贯标题带（全幅封面） */
.l34-wrap{position:absolute;inset:0;overflow:hidden;background:var(--c-ink-deep)}
.l34-slats{position:absolute;inset:0;display:grid;grid-template-columns:1.18fr .74fr 1.08fr;gap:8px}
.l34-slat{position:relative;overflow:hidden}
.l34-slat img{width:100%;height:100%;object-fit:cover;display:block}
.l34-band{position:absolute;left:0;right:0;top:33%;z-index:3;padding:46px var(--pad-x) 50px;background:var(--c-card);border-top:6px solid var(--c-brand)}
.l34-eyebrow{display:flex;align-items:center;gap:18px;font-family:var(--num);font-size:16px;font-weight:700;letter-spacing:.26em;color:var(--c-brand-deep);margin-bottom:18px}
.l34-eyebrow::after{content:"";flex:1;height:1px;background:var(--c-hairline)}
.l34-band .page-title{font-family:var(--serif);font-size:82px;font-weight:900;line-height:1.14;letter-spacing:-.02em;color:var(--c-ink-deep);max-width:1400px;margin-top:0}
.l34-band .page-title em{font-style:normal;color:var(--c-brand)}
.l34-sub{margin-top:22px;font-size:23px;line-height:1.7;color:var(--c-ink);max-width:1080px}
.l34-meta{position:absolute;left:var(--pad-x);right:var(--pad-x);bottom:64px;z-index:3;display:flex;justify-content:space-between;align-items:flex-end}
.l34-meta div{font-size:20px;line-height:1.6;color:rgba(255,255,255,.86)}
.l34-meta b{display:block;font-family:var(--num);font-size:15px;font-weight:700;letter-spacing:.2em;color:rgba(255,255,255,.6);margin-bottom:8px}
```

---

## 四、build-part 结构模板

```html
<section class="slide" data-layout="L34">
  <!-- 全幅：不包 .slide-inner。封面页不贴统一页眉（代码不贴，这里也不要写） -->
  <div class="l34-wrap">
    <div class="l34-slats">
      <div class="l34-slat"><img src="/ppt-cases/ph-3x4.svg" alt="" data-img-prompt="左幕帘配什么（中文一句话，竖构图、主体在中上部）" data-img-mode="concept"></div>
      <div class="l34-slat"><img src="/ppt-cases/ph-3x4.svg" alt="" data-img-prompt="中幕帘配什么（同一路调性的竖构图）" data-img-mode="concept"></div>
      <div class="l34-slat"><img src="/ppt-cases/ph-3x4.svg" alt="" data-img-prompt="右幕帘配什么（同一路调性的竖构图）" data-img-mode="concept"></div>
    </div>
    <div class="l34-band">
      <div class="l34-eyebrow">{{英文/拼音小字，如 ANNUAL REVIEW 2026}}</div>
      <h1 class="page-title">{{主标题}}<em>{{要上品牌色的那个主题词}}</em></h1>
      <div class="l34-sub">{{一行副标，34 字内；不需要就整行删掉}}</div>
    </div>
    <div class="l34-meta">
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
| `pXX_slat1` … `pXX_slat3` | 可选（要么三张全有，要么全无 → V4） | concept | 3:4 | 三条竖图（约 719 / 451 / 658 × 1080，`cover` 裁切）：**竖构图**、主体在中上部，中段会被标题带压住、下缘会被元信息压住；三张必须同一路调性/色温 |

**禁用**：横构图特写（切成竖条只剩一块局部）、带文字的图、三张风格不一（8px 缝隙会把它们读成硬拼）、中段有主体的图（正好被白带切掉）

---

## 六、变体

| 编号 | 变化 | 用途 |
|------|------|------|
| V1 | 标题带下移到 `top:44%`（垂直更居中） | 主标题只有一行时 |
| V2 | 两条幕帘（`grid-template-columns:1.25fr .8fr`） | 只有两张同调性的图 |
| V3 | 四条幕帘（`1fr .7fr 1.1fr .8fr`，宽度仍不等） | 想更密的节奏 |
| V4 | 去掉幕帘（整个 `.l34-slats` 删掉，留 `var(--c-ink-deep)` 底） | 找不到三张同调性竖图时 |
| V5 | 标题带改暗底（`background:var(--c-ink-deep)`，字色转白） | 整份走暗色调 |
| V6 | 去掉 `.l34-meta`（汇报信息放副标里） | 封面不写人和日期 |

---

## 七、design 提示

- **只当整份第 1 页**：它没有页眉、也没有留给正文的空间；章节扉页用 L2 / L13 / L31
- **视觉重**（整幅照片 + 82px 衬线大字），**第 2 页必须换轻的那一档**（L33 目录 / L2 章节封面）
- **三条宽度必须不等**：`repeat(3,1fr)` 之后它就是一堵三宫格图片墙（那是 L32），封面的节奏没了
- **主标题最多两行**：三行会把底部那排元信息盖住，而两者都还在渲染
- **配色**：带子是 `var(--c-card)` 白底 + `var(--c-ink-deep)` 字，顶边 6px `var(--c-brand)`；主题词 `<em>` 走 `var(--c-brand)`；压在图上的元信息直接写 `rgba(255,255,255,.86)`（**不要用 `var(--c-ink-soft)`**，暗图上会糊）
- **与 L13 的区别**：L13 是一张整幅图 + 文字居中堆叠（仪式感、发布会），L34 是三条幕帘被一刀切断（杂志感、年度汇报）
- **与 L20 的区别**：L20 是左 30% 文带 + 右 70% 一张宽 hero（文少图多的分屏），L34 的文字横贯整幅、图是三条
