# L37 · `dense-two-col-prose`（长文页：报刊双栏正文 + 首字下沉 + 右侧边注栏）

> **📄 详情**：本文件供 design 阶段匹配到 L37 时**必读**。
> **★ 核心原则**：结构是灵魂，颜色/内容不绑死。所有配色必须用 `var(--c-*)` 变量。

---

## 一、结构速览

- **比例**：16:9，浅底、**这一条是整库文字容量最大的版式**（两栏正文合计 24–28 行，约 900–1100 字）
- **核心手法**：报刊排版 —— ① 双线报头（`.l37-head`，`border-bottom:3px double` + 右端一行 dateline 小字）；② **两栏正文**（`.l37-col` × 2，栏间一条竖细线），第一栏第一段**首字下沉**（76px 衬线品牌色）；③ 右侧 380px **边注栏**（`.l37-aside`，左边一条 2px 品牌色竖线）：一张方图 + 一到两条小标题边注 + 底部一句 `margin-top:auto` 贴底的衬线摘句
- **是否全幅**：否 —— 全部内容包在 `.slide-inner` 里
- **底色**：默认不加类（浅底才读得下长文）
- **什么时候用**：一段需要**读**而不是**扫**的说明（背景/立场/方法论综述/政策解读）。要点式的内容请用 L38 / L27

---

## 二、结构拆解

### 1. 报头 · `.l37-head`

- 标题**必须写成 `<h1 class="page-title">`**（页脚目录面板靠它取标题）。50px 衬线，最多两行。
- 右端 `.l37-dateline` 是**两三行加宽字距的小字**（栏目名 / 日期 / 数据口径），不是副标题：写成一句话之后它会挤掉标题的宽度，标题被迫换到第三行，而两者都还在渲染。
- 双线（`3px double`）是这一条的报刊签名。换成 `.rp-head` 那条 2px 实线就和 L24 / L28 那一批撞了。

### 2. 双栏正文 · `.l37-col` × 2

- **必须写两个 `<div class="l37-col">`，自己决定哪几段进左栏、哪几段进右栏。**
  不要用 `column-count` 让浏览器分：字数一多最后一段会流到容器外面（`.slide` 是 `overflow:hidden`），
  页面上就是"最后一段没写完"，一处都不报错。
- **两栏合计 24–28 行**（19px / `line-height:1.95` ≈ 37px 一行，正文区高约 700px，每栏 18 行封顶）。
  超了会顶到页脚色带上 —— 至少看得见，但仍然要在写的时候数一下。
- **首字下沉只有第一栏第一段有**（CSS 已经限定 `:first-child p:first-child`）。想让右栏也下沉的话请改文案顺序，
  不要在 build-part 里套 style：两栏都下沉会读成两篇不相干的文章。
- 段内关键短语用 `<b>`（转 `var(--c-ink-deep)` 加粗），一段最多标一处 —— 长文里标三处等于没标。

### 3. 边注栏 · `.l37-aside`

- 固定 380px。**别改成 `1fr`**：三栏等分之后正文栏只剩 620px，19px 的字一行不到 30 个，读起来变成"竖着的窄条"。
- 三块，顺序固定：`.l37-fig`（1:1 方图，`aspect-ratio` 撑高）→ `.l37-note`（`<h3>` 加宽字距小标签 + 一段 3–4 行）→ `.l37-pull`（`margin-top:auto` 贴底的衬线摘句）。
- `.l37-pull` 是从正文里**摘一句**（原话），不是再总结一遍：它和正文重复的时候，读者会以为自己漏了什么。
- 没有配图时把 `.l37-fig` 删掉，边注可以放两条 `.l37-note`（V4）。

---

## 三、CSS 骨架

```css
/* L37 报刊双栏长文 + 首字下沉 + 右侧边注（文字多） */
.l37-head{display:flex;align-items:flex-end;justify-content:space-between;gap:40px;padding-bottom:20px;border-bottom:3px double var(--c-ink-deep)}
.l37-head .page-title{font-family:var(--serif);font-size:50px;font-weight:900;line-height:1.2;letter-spacing:-.01em;color:var(--c-ink-deep);margin-top:0;max-width:1060px}
.l37-dateline{flex:none;font-family:var(--num);font-size:14px;font-weight:700;letter-spacing:.2em;line-height:1.9;color:var(--c-ink-soft);text-align:right}
.l37-wrap{flex:1;display:grid;grid-template-columns:1fr 1fr 380px;min-height:0;margin-top:34px}
.l37-col{padding-right:46px}
.l37-col + .l37-col{padding-left:46px;border-left:1px solid var(--c-hairline)}
.l37-col p{font-size:19px;line-height:1.95;color:var(--c-ink);margin-bottom:20px}
.l37-col p:last-child{margin-bottom:0}
.l37-col p b{font-weight:700;color:var(--c-ink-deep)}
.l37-col:first-child p:first-child::first-letter{float:left;margin:8px 14px 0 0;font-family:var(--serif);font-size:76px;font-weight:900;line-height:.84;color:var(--c-brand)}
.l37-aside{padding-left:44px;border-left:2px solid var(--c-brand);display:flex;flex-direction:column;gap:24px}
.l37-fig{position:relative;aspect-ratio:1/1;overflow:hidden;background:var(--c-bg-alt)}
.l37-fig img{width:100%;height:100%;object-fit:cover;display:block}
.l37-note h3{font-family:var(--num);font-size:15px;font-weight:700;letter-spacing:.16em;color:var(--c-ink-soft);margin-bottom:10px}
.l37-note p{font-size:18px;line-height:1.8;color:var(--c-ink-deep)}
.l37-pull{margin-top:auto;padding-top:22px;border-top:1px solid var(--c-hairline);font-family:var(--serif);font-size:23px;font-weight:700;line-height:1.6;color:var(--c-ink-deep)}
```

---

## 四、build-part 结构模板

```html
<section class="slide" data-layout="L37">
  <div class="slide-inner">
    <div class="l37-head">
      <h1 class="page-title">{{标题，最多两行}}</h1>
      <div class="l37-dateline">{{栏目名}}<br>{{日期 / 数据口径}}</div>
    </div>
    <div class="l37-wrap">
      <div class="l37-col">
        <p>{{第一段，5–7 行；首字会自动下沉}}</p>
        <p>{{第二段，含一处 <b>关键短语</b>}}</p>
      </div>
      <div class="l37-col">
        <p>{{第三段}}</p>
        <p>{{第四段}}</p>
      </div>
      <div class="l37-aside">
        <div class="l37-fig">
          <img src="/ppt-cases/ph-1x1.svg" alt="" data-img-prompt="边注方图要什么（中文一句话，主体居中、构图简单）" data-img-mode="concept">
        </div>
        <div class="l37-note">
          <h3>{{小标签，如 BACKGROUND}}</h3>
          <p>{{3–4 行边注：一个数字口径 / 一条限定条件}}</p>
        </div>
        <div class="l37-pull">{{从正文里摘的一句原话}}</div>
      </div>
    </div>
  </div>
</section>
```

---

## 五、图槽位

| 槽位 | 必填? | 模式 | 比例 | 构图要求 |
|------|-------|------|------|----------|
| `pXX_aside` | 可选（没有就走 V4） | concept | 1:1 | 边注方图（约 336×336）：**构图简单、主体居中**，这一格很小，复杂场景缩进去只剩色块；调性要安静（这一页主角是文字） |

**禁用**：信息量大的场景图、图表截图、带文字的图、高饱和抢眼的图（它会盖过整页正文）

---

## 六、变体

| 编号 | 变化 | 用途 |
|------|------|------|
| V1 | 三栏正文（`1fr 1fr 1fr 380px` 会太窄，改成去掉边注、正文三栏） | 纯长文、没有边注材料 |
| V2 | 边注栏移到最左（`grid-template-columns:380px 1fr 1fr`，首字下沉跟着挪到中间那栏） | 想让图先被看到 |
| V3 | 首字下沉换成 `var(--c-accent)` | 整份走冷色调 |
| V4 | 去掉 `.l37-fig`，边注放两条 `.l37-note` | 找不到安静的方图 |
| V5 | 去掉 `.l37-pull` | 正文里没有值得摘的句子 |
| V6 | 正文字号降到 18px / `line-height:1.9`（每栏多 2 行） | 字数实在压不下来 |

---

## 七、design 提示

- **整份最多两页**：长文页连着两三页会让人合上电脑 —— 中间必须夹一页图为主的（L31 / L32 / L13）
- **文字容量是这一条唯一的存在理由**：内容只有 5–6 行时用它会空掉半页，那种请用 L7 / L23
- **别用 `column-count` 分栏**（浏览器分栏时超出的字直接消失，而页面看起来只是"最后一段没写完"）
- **边注栏 380px 别动**（改成等分之后正文一行不到 30 个字，读起来像竖条）
- **配色**：首字下沉和边注竖线用 `var(--c-brand)`；正文 `var(--c-ink)`、加粗处 `var(--c-ink-deep)`；dateline 用 `var(--c-ink-soft)`
- **与 L15 的区别**：L15 是"上 hero 图 + 下三栏极小字"（克制、字少），L37 是没有 hero 的纯长文页
- **与 L38 的区别**：L38 是**要点式**的行表（每条 2–3 行、可扫），L37 是**连续行文**（要一句句读下去）
