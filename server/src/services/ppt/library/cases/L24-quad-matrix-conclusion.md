# L24 · `quad-matrix-conclusion`（报告风标题条 + 2×2 象限卡 + 底部结论条）

> **📄 详情**：本文件供 design 阶段匹配到 L24 时**必读**。
> **★ 核心原则**：结构是灵魂，颜色/内容不绑死。所有配色必须用 `var(--c-*)` 变量。

---

## 一、结构速览

- **比例**：16:9，浅底 + 每格一张压在蒙版下的底图，信息密度中偏高
- **核心手法**：① 顶部报告风标题条（`.rp-head`，标题 + 2px 深色横线，可带一行 `lead` 引导句）；② 中部 2×2 四格等高卡，每格 = **一张铺满整格的底图**（`.l24-bg`，压在浅色蒙版下）+ 小标题 + 2–3 行正文；③ **其中一格用 `.on` 描边高亮**（那一格是结论指向的那一象限）；④ 底部结论条（`.rp-foot`，1–2 行，关键半句用 `<b>`）
- **是否全幅**：否 —— 全部内容包在 `.slide-inner` 里
- **四格必须是同一维度的四种取值**（四种场景 / 四类用户 / 四个象限），不是四条并列要点 —— 并列要点用 L10，两块对立用 L4
- **底色**：默认不加类

---

## 二、结构拆解（由上至下）

### 1. 标题条 · `.rp-head`

- 标题**必须写成 `<h1 class="page-title">`**（`.rp-head .page-title` 只重写字体字号）。换成别的标签/类名之后，页脚那个目录面板取不到这一页的标题，目录里只剩一个页码，而页面本身完全正常。
- `lead`（可选一行）：说这四格**是按什么分的**。缺了它读者会自己找一条不存在的对立关系。

### 2. 四格 · `.l24-grid` > `.l24-cell` × 4

- 每格三层，顺序固定：`.l24-bg`（底图，**必须是第一个孩子**）→ `.l24-ttl`（小标题，2–6 字）→ `.l24-txt`（2–3 行，≤ 40 字）。
- 底图是**这一格的背景**，不是图标：铺满整格 + `object-fit:cover`，上面盖一层从 `.93` 渐到 `.66` 的 `--mask-rgb` 蒙版。所以选图要**画面平、留白多、不要主体压在左上角**（标题和正文就在那儿）。
- 没有配图时整个 `.l24-bg` 那一行删掉即可（格子回落到 `var(--bg-plain)` 纯色底）。**四格要么都有图，要么都没有** —— 只给两格配图时那两格看起来像"没加载出来"。
- 高亮那一格加 `.on`（白底 + 品牌色描边 + 品牌色标题）。**只能有一格**：两格以上就没有"指向"了，读起来只是"这页有几个框是彩色的"。
- 四格文案长度尽量齐（差一行以内），卡是等高的，差太多时短的那格底部空一块。

### 3. 结论条 · `.rp-foot`

- 一句"所以怎么办"。**这一页的信息量全在这里** —— 四格只是铺陈。
- 关键半句用 `<b>`（品牌深色加粗）。整句都加粗等于没加粗。

---

## 三、CSS 骨架

```css
/* 报告风共用：标题条 + 结论条 */
.rp-head{padding-bottom:20px;border-bottom:2px solid var(--c-ink-deep)}
.rp-head .page-title{font-family:var(--sans);font-size:52px;font-weight:800;color:var(--c-ink-deep);line-height:1.18;letter-spacing:-.01em;margin-top:0}
.rp-head .lead{font-size:20px;line-height:1.7;color:var(--c-ink);margin-top:18px;max-width:1180px}
.rp-foot{margin-top:auto;padding-top:20px;border-top:1px solid var(--c-hairline);font-size:21px;line-height:1.6;color:var(--c-ink-deep)}
.rp-foot b{font-weight:800;color:var(--c-brand-deep)}
/* L24 2×2 象限卡 */
.l24-grid{flex:1;display:grid;grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;gap:28px;margin:36px 0 28px}
.l24-cell{position:relative;z-index:0;overflow:hidden;background:var(--bg-plain);border:1px solid var(--c-hairline);padding:30px 34px;display:flex;flex-direction:column}
.l24-cell.on{background:var(--c-card);border:1.5px solid var(--c-brand)}
.l24-bg{position:absolute;inset:0;z-index:-1}
.l24-bg img{width:100%;height:100%;object-fit:cover;display:block}
.l24-bg::after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgba(var(--mask-rgb),.93) 0%,rgba(var(--mask-rgb),.86) 44%,rgba(var(--mask-rgb),.66) 100%)}
.l24-ttl{font-size:26px;font-weight:800;color:var(--c-ink-deep)}
.l24-cell.on .l24-ttl{color:var(--c-brand-deep)}
.l24-txt{font-size:19px;line-height:1.85;color:var(--c-ink);margin-top:16px}
```

---

## 四、build-part 结构模板

```html
<section class="slide" data-layout="L24">
  <div class="slide-inner">
    <div class="rp-head">
      <h1 class="page-title">{{标题，一句判断句}}</h1>
      <div class="lead">{{这四格是按什么分的，一行；不需要就整行删掉}}</div>
    </div>
    <div class="l24-grid">
      <div class="l24-cell">
        <div class="l24-bg"><img src="/ppt-cases/ph-16x9.svg" alt="" data-img-prompt="这一格配什么底图（中文一句话，画面要平、留白多）" data-img-mode="case"></div>
        <div class="l24-ttl">{{象限名}}</div>
        <div class="l24-txt">{{这一格是什么，2–3 行}}</div>
      </div>
      <div class="l24-cell">
        <div class="l24-bg"><img src="/ppt-cases/ph-16x9.svg" alt="" data-img-prompt="这一格配什么底图（中文一句话，画面要平、留白多）" data-img-mode="case"></div>
        <div class="l24-ttl">{{象限名}}</div>
        <div class="l24-txt">{{这一格是什么，2–3 行}}</div>
      </div>
      <div class="l24-cell">
        <div class="l24-bg"><img src="/ppt-cases/ph-16x9.svg" alt="" data-img-prompt="这一格配什么底图（中文一句话，画面要平、留白多）" data-img-mode="case"></div>
        <div class="l24-ttl">{{象限名}}</div>
        <div class="l24-txt">{{这一格是什么，2–3 行}}</div>
      </div>
      <div class="l24-cell on">
        <div class="l24-bg"><img src="/ppt-cases/ph-16x9.svg" alt="" data-img-prompt="这一格配什么底图（中文一句话，画面要平、留白多）" data-img-mode="case"></div>
        <div class="l24-ttl">{{结论指向的那一格}}</div>
        <div class="l24-txt">{{这一格是什么，2–3 行}}</div>
      </div>
    </div>
    <div class="rp-foot">{{所以怎么办 —— <b>关键半句加粗</b>}}</div>
  </div>
</section>
```

---

## 五、图槽位

| 槽位 | 必填? | 模式 | 比例 | 构图要求 |
|------|-------|------|------|----------|
| `pXX_bg1` … `pXX_bg4` | 可选（要么四张全有，要么全无） | case | 16:9 | **每格的底图**（约 806×300 的横条，`cover` 裁切）：画面要**平**（大面积低对比区域）、主体偏右下或整体虚化，四张必须同一路调性/色温；不要带文字 |

**禁用**：主体压在左上角的图（标题和正文就在那儿）、高对比强色块、图表截图（蒙版压到 `.86` 之后只剩一团脏色）、四张风格不一（四格立刻散成四张不相关的卡）

---

## 六、变体

| 编号 | 变化 | 用途 |
|------|------|------|
| V1 | 2×3 六格（`grid-template-rows:repeat(3,1fr)`，正文压到 2 行） | 六种场景 |
| V2 | 1×3 三格（`grid-template-columns:repeat(3,1fr)` 单行） | 三种取值，正文可写长 |
| V3 | 高亮格改反色（`background:var(--c-ink-deep)` + 白字） | 结论那一格要更狠 |
| V4 | 去掉底图（整个 `.l24-bg` 删掉，格子回落纯色底） | 找不到四张同一路调性的图时 |
| V5 | 去掉 `lead`，标题两行 | 标题本身就说清了分法 |
| V6 | 结论条换成两行（第二行 `<b>` 整句） | 有"所以→因此"两跳 |

---

## 七、design 提示

- **视觉中等**（四张底图压在蒙版下；不配图时是轻的），前后可以接全幅图页（L2 / L13 / L21），不要连着接 L26 / L28 那两条同族的文字页
- **高亮格只能一格**：这是这一条的结构签名，两格以上就退化成"四个彩框"
- **配色**：卡底 `var(--bg-plain)`、高亮 `var(--c-brand)` 描边 + `var(--c-card)` 底、结论加粗 `var(--c-brand-deep)`，一个色值都不写死
- **与 L4 的区别**：L4 是两块**对立**（左橙右蓝，语义就是对照），L24 是同一维度的**四种取值** + 一格指向
- **与 L5 的区别**：L5 格子里是大数字（数据页），L24 格子里是一句描述（判断页）
- **与 L10 的区别**：L10 是横排 N 项平等并列（能力清单），L24 是 2×2 象限 + 结论条，读者要在四格里**选一格**
