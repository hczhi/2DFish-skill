# L30 · `numbered-evidence-trio`（三栏编号证据卡（上图下文，三栏同色））

> **📄 详情**：本文件供 design 阶段匹配到 L30 时**必读**。
> **★ 核心原则**：结构是灵魂，颜色/内容不绑死。所有配色必须用 `var(--c-*)` 变量。

---

## 一、结构速览

- **比例**：16:9，浅底 + 三张等高图，信息密度中等偏高
- **核心手法**：① 顶部报告风标题条（`.rp-head`）；② 三张**等高证据卡**（`.l30-row`），每张 = 上部 62% 高的图（`.l30-pic`，左下角压一个品牌色编号块 `.l30-no`）+ 下部文字（小标题 + 2–3 行 + 一行**收口数据** `.l30-tail`）；③ **三栏配色完全一样**（谁重要靠那行收口数据的变化量说，不靠一栏反色）
- **是否全幅**：否 —— 全部内容包在 `.slide-inner` 里
- **三栏必须是同一类东西的三个实例**（三处改动 / 三个案例 / 三条证据），每条都要有那行收口数据 —— 没有数据的三栏并列请用 L10
- **底色**：默认不加类

---

## 二、结构拆解

### 1. 标题条 · `.rp-head`

标题**必须写成 `<h1 class="page-title">`**（页脚目录面板靠它取标题）。这一页的 `lead` 一般不需要（三栏自解释）。

### 2. 三栏卡 · `.l30-row` > `.l30-card` × 3

- 卡内两块，顺序固定：`.l30-pic`（图 + 编号块）→ `.l30-body`（`<h3>` + `<p>` + `.l30-tail`）。
- 图区 `flex:0 0 62%` 是**按卡片高度**分的，不是按图片比例 —— 三张图因此严格等高。改成 `aspect-ratio` 的话三栏会因为文案长短不齐而错开，而页面照样渲染。这个比例还兼着「别在正文和收口数据之间空一大块」：调到 50% 以下时，卡片中段会空出一两百像素。
- `.l30-no` 是压在图片左下角的品牌色块（01/02/03），不是圆点：它同时起"这一栏是第几条"和"图与文字之间的接缝"两个作用。
- `.l30-tail` 靠 `margin-top:auto` 贴在卡片底部 + 一条上分隔线，**三栏必须都有**（缺一栏时那一栏的底部空一块，而另两栏的线还在，看着像没写完）。它写**变化量**（"42 分 → 26 分"），不是形容词。
- 没有配图时整个 `.l30-pic` 删掉，卡片变成纯文字（V5）；**三栏要么都有图要么都没有**。

## 三、CSS 骨架

```css
/* 报告风共用：标题条 */
.rp-head{padding-bottom:20px;border-bottom:2px solid var(--c-ink-deep)}
.rp-head .page-title{font-family:var(--sans);font-size:52px;font-weight:800;color:var(--c-ink-deep);line-height:1.18;letter-spacing:-.01em;margin-top:0}
.rp-head .lead{font-size:20px;line-height:1.7;color:var(--c-ink);margin-top:18px;max-width:1180px}
/* L30 三栏编号证据卡（三栏同色） */
.l30-row{flex:1;display:grid;grid-template-columns:repeat(3,1fr);gap:30px;margin-top:34px;min-height:0}
.l30-card{display:flex;flex-direction:column;overflow:hidden;background:var(--c-card);border:1px solid var(--c-hairline)}
.l30-pic{position:relative;flex:0 0 62%;overflow:hidden;background:var(--c-bg-alt)}
.l30-pic img{width:100%;height:100%;object-fit:cover;display:block}
.l30-no{position:absolute;left:0;bottom:0;padding:6px 18px;background:var(--c-brand);color:var(--c-brand-on);font-family:var(--num);font-size:26px;font-weight:800;line-height:1.3}
.l30-body{flex:1;display:flex;flex-direction:column;padding:28px 30px 30px}
.l30-body h3{font-size:27px;font-weight:800;line-height:1.3;color:var(--c-ink-deep);margin-bottom:12px}
.l30-body p{font-size:19px;line-height:1.8;color:var(--c-ink)}
.l30-tail{margin-top:auto;padding-top:18px;border-top:1px solid var(--c-hairline);font-size:17px;color:var(--c-ink-soft)}
```

---

## 四、build-part 结构模板

```html
<section class="slide" data-layout="L30">
  <div class="slide-inner">
    <div class="rp-head">
      <h1 class="page-title">{{标题，一句判断句}}</h1>
    </div>
    <div class="l30-row">
      <div class="l30-card">
        <div class="l30-pic">
          <img src="/ppt-cases/ph-16x9.svg" alt="" data-img-prompt="这一条配什么图（中文一句话，主体居中、下缘留白给编号块）" data-img-mode="case">
          <div class="l30-no">01</div>
        </div>
        <div class="l30-body">
          <h3>{{这一条改了什么}}</h3>
          <p>{{2–3 行具体说明}}</p>
          <div class="l30-tail">{{变化量，如 42 分 → 26 分}}</div>
        </div>
      </div>
      <div class="l30-card">
        <div class="l30-pic">
          <img src="/ppt-cases/ph-16x9.svg" alt="" data-img-prompt="这一条配什么图（中文一句话，主体居中、下缘留白给编号块）" data-img-mode="case">
          <div class="l30-no">02</div>
        </div>
        <div class="l30-body">
          <h3>{{这一条改了什么}}</h3>
          <p>{{2–3 行具体说明}}</p>
          <div class="l30-tail">{{变化量}}</div>
        </div>
      </div>
      <div class="l30-card">
        <div class="l30-pic">
          <img src="/ppt-cases/ph-16x9.svg" alt="" data-img-prompt="这一条配什么图（中文一句话，主体居中、下缘留白给编号块）" data-img-mode="case">
          <div class="l30-no">03</div>
        </div>
        <div class="l30-body">
          <h3>{{第三条改了什么}}</h3>
          <p>{{2–3 行具体说明}}</p>
          <div class="l30-tail">{{变化量}}</div>
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
| `pXX_e1` … `pXX_e3` | 可选（要么三张全有，要么全无） | case | 16:9 | 卡片上部（约 520×450，`cover` 裁切）：主体**居中**，**左下角留白**（编号块压在那儿），三张必须同一路调性/色温；不要带文字 |

**禁用**：主体压在左下角的图（被编号块盖住）、三张风格不一（三栏立刻散成三张不相关的卡）、图表截图

---

## 六、变体

| 编号 | 变化 | 用途 |
|------|------|------|
| V1 | 两栏（`repeat(2,1fr)`，正文可写 5 行） | 只有两条证据 |
| V2 | 四栏（`repeat(4,1fr)`，小标题压到 8 字） | 四条 |
| V5 | 去掉图（`.l30-pic` 删掉，纯文字卡） | 找不到三张同调性的图时 |
| V6 | 图区高度提到 70%（`flex:0 0 70%`，正文压到 2 行） | 图本身就是证据（前后对比截图除外） |

---

## 七、design 提示

- **视觉中等偏重**（三张图 + 三段文字），前后接 L2 / L13 / L25 缓冲
- **三栏配色完全一样**：原来末栏有个 `.dark` 反色变体，已经去掉了，**不要自己在 build-part 里给某一栏套深底/满色 inline style** —— 那一栏在整份浅色稿子里是唯一一处深底卡，翻起来像另一套模板里的页，而这一页自己看完全正常。哪一条最重要靠那行收口数据说
- **收口数据三栏都要有**：这一页的说服力全在那三行变化量上，缺一行就退化成"三个说明卡"
- **配色**：三栏一律 编号块 `var(--c-brand)` + `#fff`、卡底 `var(--c-card)`、正文 `var(--c-ink)`、收口数据 `var(--c-ink-soft)`
- **与 L11 的区别**：L11 是三图叙事全幅（图占主体、文字压在图上），L30 是有边界的三张卡、图只占上部 44%
- **与 L26 的区别**：L26 底部四栏是"一个东西的四个层次"（图是卡片底图），L30 三栏是"三个独立实例"（图在上、文字在下，各自带数据）
