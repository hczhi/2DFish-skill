# L27 · `checklist-tall-figure`（报告风标题条 + 左侧编号清单 + 右侧整列竖图）

> **📄 详情**：本文件供 design 阶段匹配到 L27 时**必读**。
> **★ 核心原则**：结构是灵魂，颜色/内容不绑死。所有配色必须用 `var(--c-*)` 变量。

---

## 一、结构速览

- **比例**：16:9，浅底，左文右图（1fr / 560px），信息密度中等
- **核心手法**：① 顶部报告风标题条（`.rp-head`，可带一行 `lead`）；② 左栏 **3–5 条编号清单**，每条 = 大号编号（`.l27-no`，品牌色）+ 小标题 + 1–2 行说明，条间一道细分隔线；③ 右栏**一张贴顶贴底的竖图**（`.l27-fig`，`cover` 裁切），下缘一条深色渐变说明（`.l27-cap`）
- **是否全幅**：否 —— 全部内容包在 `.slide-inner` 里
- **清单要有顺序感**（依次收紧的判据 / 从前到后的步骤）：完全平等的 N 项并列请用 L10，四种取值请用 L24
- **底色**：默认不加类

---

## 二、结构拆解

### 1. 标题条 · `.rp-head`

标题**必须写成 `<h1 class="page-title">`**（页脚目录面板靠它取标题；换掉之后那一页在目录里只剩一个页码，画面完全正常）。`lead` 可选一行，说这几条清单**是按什么排序的**。

### 2. 左栏清单 · `.l27-list` > `.l27-item` × 3–5

- 每条 = `.l27-no`（两位编号 01/02…）+ 一个 `<div>` 包住 `<h3>`（小标题，≤ 10 字）和 `<p>`（1–2 行，≤ 45 字）。
- **`<h3>` 和 `<p>` 必须包在同一个 `<div>` 里**：`.l27-item` 是两列 grid，不包的话标题和正文各占一格，正文会跑到编号下面那一列去，而页面照样渲染。
- 最后一条的分隔线由 `:last-child` 去掉，不要手动加类。
- 条数超过 5 条时说明浓缩到一行，或改用 L28（双列八项）。

### 3. 右栏竖图 · `.l27-fig`

- 图**不写高度**，靠 grid 行拉伸撑满整列（约 560×760 ≈ 3:4）。写死高度的话清单一多图就比左栏短一截，右下角空一块，而页面照样渲染。
- `.l27-cap` 是压在图片下缘的一行说明（渐变到 `rgba(0,0,0,.78)` 上的白字，粗体）。不需要就整行删掉。
- 没有配图时整个 `.l27-fig` 删掉，并把 `.l27-wrap` 的列宽改成 `1fr`（V4）—— 只删图不改列宽的话右边留一块 560px 的空洞。

---

## 三、CSS 骨架

```css
/* 报告风共用：标题条 */
.rp-head{padding-bottom:20px;border-bottom:2px solid var(--c-ink-deep)}
.rp-head .page-title{font-family:var(--sans);font-size:52px;font-weight:800;color:var(--c-ink-deep);line-height:1.18;letter-spacing:-.01em;margin-top:0}
.rp-head .lead{font-size:20px;line-height:1.7;color:var(--c-ink);margin-top:18px;max-width:1180px}
/* L27 左编号清单 + 右竖图 */
.l27-wrap{flex:1;display:grid;grid-template-columns:1fr 560px;gap:72px;margin-top:36px;min-height:0}
.l27-list{display:flex;flex-direction:column;justify-content:center;gap:26px}
.l27-item{display:grid;grid-template-columns:74px 1fr;gap:20px;align-items:start;padding-bottom:24px;border-bottom:1px solid var(--c-hairline)}
.l27-item:last-child{padding-bottom:0;border-bottom:0}
.l27-no{font-family:var(--num);font-size:42px;font-weight:800;line-height:.9;color:var(--c-brand)}
.l27-item h3{font-size:28px;font-weight:800;color:var(--c-ink-deep);margin-bottom:8px}
.l27-item p{font-size:19px;line-height:1.8;color:var(--c-ink)}
.l27-fig{position:relative;overflow:hidden;background:var(--c-bg-alt)}
.l27-fig img{width:100%;height:100%;object-fit:cover;display:block}
.l27-cap{position:absolute;left:0;right:0;bottom:0;padding:26px 28px;background:rgba(0,0,0,.60);color:#fff;font-size:19px;font-weight:700;line-height:1.6}
```

---

## 四、build-part 结构模板

```html
<section class="slide" data-layout="L27">
  <div class="slide-inner">
    <div class="rp-head">
      <h1 class="page-title">{{标题，一句判断句}}</h1>
      <div class="lead">{{这几条是按什么排序的，一行；不需要就整行删掉}}</div>
    </div>
    <div class="l27-wrap">
      <div class="l27-list">
        <div class="l27-item">
          <div class="l27-no">01</div>
          <div>
            <h3>{{小标题}}</h3>
            <p>{{1–2 行说明}}</p>
          </div>
        </div>
        <div class="l27-item">
          <div class="l27-no">02</div>
          <div>
            <h3>{{小标题}}</h3>
            <p>{{1–2 行说明}}</p>
          </div>
        </div>
        <div class="l27-item">
          <div class="l27-no">03</div>
          <div>
            <h3>{{小标题}}</h3>
            <p>{{1–2 行说明}}</p>
          </div>
        </div>
        <div class="l27-item">
          <div class="l27-no">04</div>
          <div>
            <h3>{{小标题}}</h3>
            <p>{{1–2 行说明}}</p>
          </div>
        </div>
      </div>
      <div class="l27-fig">
        <img src="/ppt-cases/ph-3x4.svg" alt="" data-img-prompt="右侧竖图配什么（中文一句话，竖构图、主体居中偏上）" data-img-mode="case">
        <div class="l27-cap">{{这张图在说什么，一行；不需要就整行删掉}}</div>
      </div>
    </div>
  </div>
</section>
```

---

## 五、图槽位

| 槽位 | 必填? | 模式 | 比例 | 构图要求 |
|------|-------|------|------|----------|
| `pXX_fig` | 可选（没有就走 V4） | case | 3:4 | 整列竖图（约 560×760，`cover` 裁切）：**竖构图**，主体居中偏上（下缘 26% 会被 `.l27-cap` 的渐变压暗），不要带文字 |

**禁用**：横构图（`cover` 之后只剩中间一条）、主体压在下缘的图（被说明条盖住）、多主体拼图（这一列只承担一个画面）

---

## 六、变体

| 编号 | 变化 | 用途 |
|------|------|------|
| V1 | 三条清单（说明可写三行） | 每条都要讲透 |
| V2 | 五条清单（说明压到一行） | 判据多 |
| V3 | 图放左、清单放右（列宽 `560px 1fr` + 顺序对调） | 需要和上一页镜像 |
| V4 | 去掉竖图（`.l27-wrap` 列宽改 `1fr`，清单铺满整宽） | 找不到合适竖图时 |
| V5 | 去掉 `.l27-cap` | 图本身自解释 |
| V6 | 底部补 `.rp-foot` 结论条（清单压到 3 条） | 要收一句「所以怎么办」 |

---

## 七、design 提示

- **视觉中等**（一张竖图 + 一栏文字），前后不要再接 L1 / L3 这两条同样左右分屏的版式
- **编号是结构签名**：去掉编号之后这一页读起来只是「右边有张图的正文页」，顺序感消失
- **配色**：编号 `var(--c-brand)`、小标题 `var(--c-ink-deep)`、分隔线 `var(--c-hairline)`，说明条上的白字直接写 `#fff`（深色渐变上不能用 `var(--c-ink-soft)`，会糊）
- **与 L1 的区别**：L1 是右侧全高背景图 + 左侧一段文字（金句页），L27 右图是有边界的一列、左边是**有序清单**
- **与 L10 的区别**：L10 是横排 N 项平等并列，L27 是纵向有序 + 一张竖图
- **与 L28 的区别**：L28 是双列八项（纯清单页，图只是底部一条），L27 只 3–5 条但每条能写两行
