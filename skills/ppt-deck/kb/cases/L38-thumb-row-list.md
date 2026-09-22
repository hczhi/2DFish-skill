# L38 · `thumb-row-list`（图文行表：方缩略图 + 小标题 + 说明 + 右端编号，4–6 行）

> **📄 详情**：本文件供 design 阶段匹配到 L38 时**必读**。
> **★ 核心原则**：结构是灵魂，颜色/内容不绑死。所有配色必须用 `var(--c-*)` 变量。

---

## 一、结构速览

- **比例**：16:9，浅底，**文字容量大但是要点式**（4–6 行 × 每行小标题 + 2–3 行说明 ≈ 600–900 字）
- **核心手法**：① 顶部报告风标题条（`.rp-head`，可带一行 `lead`）；② 一叠**横向行**（`.l38-rows` > `.l38-row`），每行四格：**120px 方缩略图** → 小标题（`<h3>`，下面可挂一行加宽字距英文 `<em>`）→ 说明段 → **右端大号编号**（`.l38-no`）；③ 行间一条细线，末行不画线
- **是否全幅**：否 —— 全部内容包在 `.slide-inner` 里
- **底色**：默认不加类
- **什么时候用**：名词解释 / 条款说明 / FAQ / 分档说明 —— 每条都值得配一张小图的清单。没有图的清单请用 L27

---

## 二、结构拆解

### 1. 标题条 · `.rp-head`

标题**必须写成 `<h1 class="page-title">`**（页脚目录面板靠它取标题）。这一页建议带一行 `lead`（说清这几条是按什么排的：优先级？时间？金额？）—— 行表最容易被读成"随手列的"。

### 2. 行 · `.l38-row` × 4–6

- **行数只能 4–6 行。** `.l38-rows` 用 `justify-content:center` 把这一叠行在剩余高度里居中，
  七行起会**同时**从上下两端溢出，而中间那几行看起来完全正常 —— 翻页的人只会觉得
  "第一条和最后一条怎么被切了"，一处都不报错。真有 8 条请拆两页或改用 L28。
- 四格宽度写死（`120px 320px 1fr 90px`）：小标题那一格 320px 装得下 **10 个字以内**，
  写长了会换到第三行、把这一行顶高，于是别的行被压缩 —— 每一行仍然是一行完整的清单。
- 说明段 2–3 行（19px / 1.85）。这一格是 `1fr`，是整页最能吃字的地方。
- `.l38-no` 是**右端**的编号（34px 灰色数字）：编号放左边会和缩略图抢"这一行从哪儿开始"，
  两个视觉起点并排时清单读起来是散的。
- `<h3>` 里可挂一行 `<em>`（自动转成加宽字距的品牌色小字，非斜体）放英文/代号，**可选**。

### 3. 缩略图 · `.l38-thumb`

- 写死 `120px × 120px`，`object-fit:cover`。**别改成百分比**：跟着行高缩的话行一多图就压成一条，
  主体全没了，而那一行仍然排得整整齐齐。
- **主体必须在正中**：这一格只有 120px，偏一点就切没了。
- 要么每行都有图，要么整页都不放（V5 把这一格删掉）：只有两三行有图时，另外几行左边空一块，
  看着像图没加载出来。

---

## 三、CSS 骨架

```css
/* 报告风共用：标题条 */
.rp-head{padding-bottom:20px;border-bottom:2px solid var(--c-ink-deep)}
.rp-head .page-title{font-family:var(--sans);font-size:52px;font-weight:800;color:var(--c-ink-deep);line-height:1.18;letter-spacing:-.01em;margin-top:0}
.rp-head .lead{font-size:20px;line-height:1.7;color:var(--c-ink);margin-top:18px;max-width:1180px}
/* L38 图文行表：方缩略图 + 小标题 + 说明 + 右端编号（文字多） */
.l38-rows{flex:1;display:flex;flex-direction:column;justify-content:center;margin-top:30px;min-height:0}
.l38-row{display:grid;grid-template-columns:120px 320px 1fr 90px;gap:34px;align-items:center;padding:24px 0;border-bottom:1px solid var(--c-hairline)}
.l38-row:last-child{border-bottom:0}
.l38-thumb{position:relative;width:120px;height:120px;overflow:hidden;background:var(--c-bg-alt)}
.l38-thumb img{width:100%;height:100%;object-fit:cover;display:block}
.l38-row h3{font-size:27px;font-weight:800;line-height:1.35;color:var(--c-ink-deep)}
.l38-row h3 em{display:block;font-style:normal;font-family:var(--num);font-size:14px;font-weight:700;letter-spacing:.18em;color:var(--c-brand-deep);margin-top:8px}
.l38-row p{font-size:19px;line-height:1.85;color:var(--c-ink)}
.l38-no{font-family:var(--num);font-size:34px;font-weight:800;line-height:1;color:var(--c-ink-soft);text-align:right}
```

---

## 四、build-part 结构模板

```html
<section class="slide" data-layout="L38">
  <div class="slide-inner">
    <div class="rp-head">
      <h1 class="page-title">{{标题}}</h1>
      <div class="lead">{{一行：这几条是按什么排的}}</div>
    </div>
    <div class="l38-rows">
      <div class="l38-row">
        <div class="l38-thumb">
          <img src="/ppt-cases/ph-1x1.svg" alt="" data-img-prompt="这一条配什么小图（中文一句话，主体严格居中、构图极简）" data-img-mode="concept">
        </div>
        <h3>{{这一条叫什么，10 字内}}<em>{{英文/代号，可省}}</em></h3>
        <p>{{2–3 行说明：它是什么、什么时候用}}</p>
        <div class="l38-no">01</div>
      </div>
      <div class="l38-row">
        <div class="l38-thumb">
          <img src="/ppt-cases/ph-1x1.svg" alt="" data-img-prompt="这一条配什么小图（中文一句话，主体严格居中、构图极简）" data-img-mode="concept">
        </div>
        <h3>{{这一条叫什么}}<em>{{英文/代号，可省}}</em></h3>
        <p>{{2–3 行说明}}</p>
        <div class="l38-no">02</div>
      </div>
      <div class="l38-row">
        <div class="l38-thumb">
          <img src="/ppt-cases/ph-1x1.svg" alt="" data-img-prompt="这一条配什么小图（中文一句话，主体严格居中、构图极简）" data-img-mode="concept">
        </div>
        <h3>{{这一条叫什么}}<em>{{英文/代号，可省}}</em></h3>
        <p>{{2–3 行说明}}</p>
        <div class="l38-no">03</div>
      </div>
      <div class="l38-row">
        <div class="l38-thumb">
          <img src="/ppt-cases/ph-1x1.svg" alt="" data-img-prompt="这一条配什么小图（中文一句话，主体严格居中、构图极简）" data-img-mode="concept">
        </div>
        <h3>{{这一条叫什么}}<em>{{英文/代号，可省}}</em></h3>
        <p>{{2–3 行说明}}</p>
        <div class="l38-no">04</div>
      </div>
    </div>
  </div>
</section>
```

---

## 五、图槽位

| 槽位 | 必填? | 模式 | 比例 | 构图要求 |
|------|-------|------|------|----------|
| `pXX_t1` … `pXX_t6` | 可选（要么每行都有，要么整页都不放） | concept | 1:1 | 行首小图（120×120，`cover` 裁切）：**主体严格居中、构图极简**（一个物件 / 一个动作），几行之间必须同一路调性；不要带文字、不要多主体 |

**禁用**：横构图（切成方块只剩局部）、复杂场景图、图表截图、几行风格不一（清单立刻散成几张不相关的卡）

---

## 六、变体

| 编号 | 变化 | 用途 |
|------|------|------|
| V1 | 缩略图换 3:4 竖图（`.l38-thumb` 改 `width:100px;height:130px`，行距加大） | 人物类清单（嘉宾/团队） |
| V2 | 编号换成品牌色实心块（给 `.l38-no` 套 `background:var(--c-brand)` 的变体类） | 想强调顺序 |
| V3 | 去掉编号列（`90px` 一格删掉） | 这几条没有顺序 |
| V4 | 小标题格加宽到 400px（说明格相应变窄） | 条目名字普遍偏长 |
| V5 | 去掉缩略图列 | 找不到同调性的小图（这时更适合 L27） |
| V6 | 4 行版每行说明放到 4 行（`padding:34px 0`） | 只有四条但每条要说透 |

---

## 七、design 提示

- **视觉偏轻**（小图 + 行线），适合排在一页重图页（L31 / L32 / L13）之后做"落地说明"
- **行数 4–6**：七行起上下两端会被切，而中间几行完全正常 —— 这一条是这个版式唯一的硬约束
- **小标题 10 字以内**：320px 那一格换行会顶高整行，别的行被压缩
- **编号必须在右端**：挪到左边和缩略图抢起点，清单读起来是散的
- **配色**：编号 `var(--c-ink-soft)`（它是索引不是重点），`<em>` 小字 `var(--c-brand-deep)`，行线 `var(--c-hairline)`
- **与 L27 的区别**：L27 是"左编号清单 + 右一整列竖图"（图是一张大图），L38 是**每条各自一张小图**
- **与 L33 的区别**：L33 是目录页（只有章节名，没有说明段），L38 每行都要有 2–3 行说明
- **与 L25 的区别**：L25 是横轴四节点（有时间/顺序含义），L38 是竖着一条条读的清单
