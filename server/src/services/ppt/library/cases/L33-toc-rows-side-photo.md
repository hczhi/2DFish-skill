# L33 · `toc-rows-side-photo`（目录页：左侧编号行表 + 右侧整列竖图）

> **📄 详情**：本文件供 design 阶段匹配到 L33 时**必读**。
> **★ 核心原则**：结构是灵魂，颜色/内容不绑死。所有配色必须用 `var(--c-*)` 变量。

---

## 一、结构速览

- **比例**：16:9，浅底，左表右图（1fr / 580px），信息密度低（这是一页导览）
- **核心手法**：① 顶部报告风标题条（`.rp-head`，标题就写「目录」或「本次要讲的五件事」）；② 左侧 **4–6 行编号行表**（`.l33-row`：编号 + 章节名（33px 粗）+ 右端页数/时长），行与行之间细横线、**第一行还有一条上边框**，合起来才是"表格感"；③ **当前/重点那一行加 `.on`**（编号与章节名转品牌深色）；④ 右侧一张贴顶贴底的竖图 + 下缘一行说明
- **是否全幅**：否 —— 全部内容包在 `.slide-inner` 里
- **底色**：默认不加类

---

## 二、结构拆解

### 1. 标题条 · `.rp-head`

标题**必须写成 `<h1 class="page-title">`**（页脚目录面板靠它取标题；换掉之后这一页在目录面板里只剩一个页码，而画面完全正常）。

### 2. 行表 · `.l33-list` > `.l33-row` × 4–6

- 每行三格（`100px 1fr auto`）：`.l33-no`（两位编号）+ `<h3>`（章节名，≤ 12 字，**一行**）+ `<span>`（页数 / 时长 / 一个词的补充）。
- **三格必须都在**：`<span>` 省掉的话右端塌陷，几行的对齐参差不齐，而页面照样渲染。没有页数就写时长或"3 项"。
- `:first-child` 那条上边框由 CSS 给，**不要手动加类**；少了它第一行看着像掉在半空。
- **最多 6 行**：7 行以上行高就得压到看不出层级，那种情况把章节合并，或改用 L17（诗意导览）。

### 3. 高亮行 · `.l33-row.on`

- **只能一行**：两行以上就没有"现在在这儿"的意思了，读起来只是"有几行是彩色的"。
- 当纯目录用时也可以一行都不加。

### 4. 右侧竖图 · `.l33-fig`

- 图不写高度，靠 grid 拉伸撑满整列（约 580×760 ≈ 3:4）。
- `.l33-cap` 是压在下缘的一行说明（渐变到 `rgba(0,0,0,.78)` 的白字），一般写"这份东西的重心在第几部分"。不需要就整行删掉。
- 没有配图时把 `.l33-fig` 删掉、`.l33-wrap` 列宽改 `1fr`（V4）—— 只删图不改列宽的话右边留一块 580px 的空洞。

---

## 三、CSS 骨架

```css
/* 报告风共用：标题条 */
.rp-head{padding-bottom:20px;border-bottom:2px solid var(--c-ink-deep)}
.rp-head .page-title{font-family:var(--sans);font-size:52px;font-weight:800;color:var(--c-ink-deep);line-height:1.18;letter-spacing:-.01em;margin-top:0}
.rp-head .lead{font-size:20px;line-height:1.7;color:var(--c-ink);margin-top:18px;max-width:1180px}
/* L33 编号目录行 + 右竖图 */
.l33-wrap{flex:1;display:grid;grid-template-columns:1fr 580px;gap:78px;margin-top:34px;min-height:0}
.l33-list{display:flex;flex-direction:column;justify-content:center}
.l33-row{display:grid;grid-template-columns:100px 1fr auto;align-items:center;gap:22px;padding:24px 0;border-bottom:1px solid var(--c-hairline)}
.l33-row:first-child{border-top:1px solid var(--c-hairline)}
.l33-no{font-family:var(--num);font-size:32px;font-weight:800;color:var(--c-brand)}
.l33-row h3{font-size:33px;font-weight:800;line-height:1.25;color:var(--c-ink-deep)}
.l33-row span{font-size:18px;color:var(--c-ink-soft)}
.l33-row.on h3{color:var(--c-brand-deep)}
.l33-row.on .l33-no{color:var(--c-brand-deep)}
.l33-fig{position:relative;overflow:hidden;background:var(--c-bg-alt)}
.l33-fig img{width:100%;height:100%;object-fit:cover;display:block}
.l33-cap{position:absolute;left:0;right:0;bottom:0;padding:26px 28px;background:linear-gradient(180deg,transparent,rgba(0,0,0,.78));color:#fff;font-size:19px;line-height:1.6}
```

---

## 四、build-part 结构模板

```html
<section class="slide" data-layout="L33">
  <div class="slide-inner">
    <div class="rp-head">
      <h1 class="page-title">{{目录 / 本次要讲的 N 件事}}</h1>
    </div>
    <div class="l33-wrap">
      <div class="l33-list">
        <div class="l33-row">
          <div class="l33-no">01</div>
          <h3>{{章节名}}</h3>
          <span>{{页数或时长}}</span>
        </div>
        <div class="l33-row">
          <div class="l33-no">02</div>
          <h3>{{章节名}}</h3>
          <span>{{页数或时长}}</span>
        </div>
        <div class="l33-row on">
          <div class="l33-no">03</div>
          <h3>{{要强调的那一章}}</h3>
          <span>{{页数或时长}}</span>
        </div>
        <div class="l33-row">
          <div class="l33-no">04</div>
          <h3>{{章节名}}</h3>
          <span>{{页数或时长}}</span>
        </div>
        <div class="l33-row">
          <div class="l33-no">05</div>
          <h3>{{章节名}}</h3>
          <span>{{页数或时长}}</span>
        </div>
      </div>
      <div class="l33-fig">
        <img src="/ppt-cases/ph-3x4.svg" alt="" data-img-prompt="右侧竖图配什么（中文一句话，竖构图、主体居中偏上）" data-img-mode="concept">
        <div class="l33-cap">{{重心在哪一部分，一行；不需要就整行删掉}}</div>
      </div>
    </div>
  </div>
</section>
```

---

## 五、图槽位

| 槽位 | 必填? | 模式 | 比例 | 构图要求 |
|------|-------|------|------|----------|
| `pXX_fig` | 可选（没有就走 V4） | concept | 3:4 | 整列竖图（约 580×760，`cover` 裁切）：**竖构图**，主体居中偏上（下缘会被 `.l33-cap` 的渐变压暗），气氛图即可 —— 目录页的图不承担信息 |

**禁用**：横构图（`cover` 之后只剩中间一条）、信息量大的图（目录页的图一旦"有内容"，读者会停在那儿而不看目录）、带文字的图

---

## 六、变体

| 编号 | 变化 | 用途 |
|------|------|------|
| V1 | 四行（行高自然拉开） | 只有四章 |
| V2 | 六行（章节名压到 10 字内） | 六章 |
| V3 | 图放左、行表放右（列宽 `580px 1fr` + 顺序对调） | 和下一页镜像 |
| V4 | 去掉竖图（`.l33-wrap` 列宽改 `1fr`，行表铺满整宽、字号提到 40px） | 找不到合适竖图时 |
| V5 | 去掉右端 `<span>`（列改 `100px 1fr`） | 页数还没定 |
| V6 | 不加高亮行 | 纯目录，不指向任何一章 |

---

## 七、design 提示

- **视觉轻**（一页导览），一般是整份的第 2 页，也可以在每个章节前重复出现（那时把 `.on` 挪到当前章）
- **`.on` 只能一行**：这是这一条唯一的"指向"，多了就没有指向
- **章节名必须一行**：换行之后行高不齐，几条横线的间距全乱，而页面照样渲染
- **配色**：编号 `var(--c-brand)`、高亮行 `var(--c-brand-deep)`、横线 `var(--c-hairline)`；图上说明的白字直接写 `#fff`（**不要用 `var(--c-ink-soft)`**，深渐变上会糊）
- **与 L17 的区别**：L17 是 50/50 分屏 + 毛笔字 + 圆圈目录（诗意+秩序，气质重），L33 是**报告风表格感**导览 —— 同一份里两者选一条，不要都用
- **与 L27 的区别**：L27 是判据清单（每条两行说明，属内容页），L33 每行只有章节名和页数（属目录页）
