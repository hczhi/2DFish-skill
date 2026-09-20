# L69 · `block-mosaic-metrics`（实色块马赛克：左侧深底说明块通高 + 右侧 2×2 四个大数字实色块）

> **📄 详情**：本文件供 design 阶段匹配到 L69 时**必读**。
> **★ 核心原则**：结构是灵魂，颜色/内容不绑死。所有配色必须用 `var(--c-*)` 变量。

---

## 一、结构速览

- **比例**：16:9，一块通高深底说明块（左，占 1.35 份）+ 四个大数字色块（右，2×2），文字容量中等（约 220–300 字）
- **核心手法**：**层级来自实色块本身**，不是 hairline —— 这是 L5「白卡 + 细线的数据网格」的重色版本：深底块把叙述压住，四格里**只有两格上饱和色**（一格品牌、一格 accent）做主次
- **是否全幅**：否 —— 内容包在 `.slide-inner` 里（四边留白由疏密档控制）
- **什么时候用**：一页四个同口径的数字 + 一段「这几个数是怎么来的」：年度盘点、成效四项、验收指标
- **图槽位**：**0 个**（两行是 `1fr 1fr`，塞图会把大数字和说明挤出格子）
- **导出 pptx**：全是实心色块 + 文字，圆角 14px 导成 `roundRect` —— 保真的几条之一

---

## 二、结构拆解

### 1. 说明块 · `.l69-say`

- `grid-row:span 2` 通高，底色 `var(--c-ink-deep)`。里面的字一律 `#fff` / `rgba(255,255,255,…)`，
  **不要用 `var(--c-ink*)`**（那几个是深色，写上去等于隐形）。
- 顺序：`.l69-kicker` 领句（品牌色）→ `h1.page-title`（46px 衬线白字，**16 个汉字内**）→ `p` 一段
  2–4 行 → `.l69-note`（`margin-top:auto` 贴块底，写口径/版本/例外，**这一条是这页可信度的来源**，
  没有就整块删掉，别写一句空话）。

### 2. 数字格 · `.l69-cell`

- **正好 4 格**（`grid-template-columns:1.35fr 1fr 1fr` × 两行）。3 个数字的话换 L5，5 个起
  第五格挤到第三行、被 `--pad-bottom` 裁掉，而前四格排得整整齐齐。
- 每格 = `em` 英文小标签（一个词）+ `b` 大数字（62px，**≤5 个字符**，含 `%` / `‰` / 单位）+ `p`
  一行口径（**最多 2 行**）。`.l69-cell` 没有 `overflow:hidden`：说明写到 3 行会从格子下沿溢出、
  压在下一格的标签上，而每个字都在，看起来只是「排得有点挤」。
- **饱和色最多两格**：一格 `.brand`、一格 `.accent`，其余留 `var(--c-bg-alt)`。四格全铺饱和色之后
  几个数字之间没有主次，而每一格都「有颜色、读得清」，看不出是排错了。
- **色块上的字走 `var(--c-brand-on)` / `var(--c-accent-on)`，不许写死 `#fff`。** 浅品牌色那几套上
  白字直接读不出来，而字确实在那儿（见 `designSpec.ts` 的 `PALETTE_VARS`）。
- 最重要的那个数字放 `.brand`（左上那格），最「反直觉」的那个放 `.accent`（右下那格）—— 对角线上的
  两块饱和色是这一页的视觉主次。

---

## 三、CSS 骨架

```css
.l69-grid{flex:1;min-height:0;display:grid;grid-template-columns:1.35fr 1fr 1fr;grid-template-rows:1fr 1fr;gap:16px}
.l69-say{grid-row:span 2;background:var(--c-ink-deep);border-radius:14px;padding:44px 40px;display:flex;flex-direction:column}
.l69-kicker{font-family:var(--num);font-size:15px;font-weight:700;letter-spacing:.2em;color:var(--c-brand)}
.l69-say .page-title{font-family:var(--serif);font-size:46px;font-weight:900;line-height:1.22;letter-spacing:-.02em;color:#fff;margin-top:16px}
.l69-say p{margin-top:18px;font-size:18px;line-height:1.8;color:rgba(255,255,255,.72)}
.l69-note{margin-top:auto;padding-top:18px;border-top:1px solid rgba(255,255,255,.16);font-size:16px;line-height:1.6;color:rgba(255,255,255,.55)}
.l69-cell{background:var(--c-bg-alt);border-radius:14px;padding:34px 32px;display:flex;flex-direction:column;justify-content:center}
.l69-cell em{font-family:var(--num);font-size:14px;font-weight:700;font-style:normal;letter-spacing:.18em;color:var(--c-ink-soft)}
.l69-cell b{margin-top:12px;font-family:var(--num);font-size:62px;font-weight:800;line-height:1;letter-spacing:-.03em;color:var(--c-ink-deep)}
.l69-cell p{margin-top:14px;font-size:17px;line-height:1.7;color:var(--c-ink)}
.l69-cell.brand{background:var(--c-brand)}
.l69-cell.brand em,.l69-cell.brand b,.l69-cell.brand p{color:var(--c-brand-on)}
.l69-cell.accent{background:var(--c-accent)}
.l69-cell.accent em,.l69-cell.accent b,.l69-cell.accent p{color:var(--c-accent-on)}
```

---

## 四、build-part 结构模板

```html
<section class="slide" data-layout="L69">
  <!-- 非全幅：内容包在 .slide-inner 里；页眉由代码贴，这里不要写 -->
  <div class="slide-inner">
    <div class="l69-grid">
      <div class="l69-say">
        <div class="l69-kicker">{{领句：年份/口径}}</div>
        <h1 class="page-title">{{标题，16 个汉字内}}</h1>
        <p>{{这几个数是怎么来的，2–4 行}}</p>
        <div class="l69-note">{{口径/版本/例外，一行；没有就删掉整块}}</div>
      </div>
      <div class="l69-cell brand">
        <em>{{英文标签}}</em><b>{{数字，≤5 字符}}</b><p>{{口径，1–2 行}}</p>
      </div>
      <div class="l69-cell">
        <em>{{英文标签}}</em><b>{{数字}}</b><p>{{口径}}</p>
      </div>
      <div class="l69-cell">
        <em>{{英文标签}}</em><b>{{数字}}</b><p>{{口径}}</p>
      </div>
      <div class="l69-cell accent">
        <em>{{英文标签}}</em><b>{{数字}}</b><p>{{口径}}</p>
      </div>
    </div>
  </div>
</section>
```

---

## 五、图槽位

**0 个** —— 两行是 `1fr 1fr`，图塞进去会把大数字和说明挤出格子下沿（压在下一格上，不是消失）。
要「数字 + 配图」换 L5 的扁平信息图模式。

---

## 六、变体

| 编号 | 变化 | 用途 |
|------|------|------|
| V1 | 饱和的两格换到另一条对角线 | 最重要的数字不在左上 |
| V2 | 只有一格上 `.brand`，其余全 `--c-bg-alt` | 四个数字里只有一个是重点 |
| V3 | `grid-template-columns` 改 `1fr 1fr 1fr`（说明块变窄） | 叙述只有两行 |
| V4 | 去掉 `.l69-note` | 没有需要交代的口径 |

---

## 七、design 提示

- **饱和色最多两格**（其余 `--c-bg-alt`）：全铺之后大数字之间没有主次，而每格都读得清
- **色块上的字走 `--c-brand-on` / `--c-accent-on`**，不许写死 `#fff`（浅品牌色那几套上白字读不出来）
- **深底说明块里的字写 `#fff` / `rgba(255,255,255,…)`**，不许用 `--c-ink*`（深色，等于隐形）
- **正好 4 格**：5 格起第五格落到第三行、被 `--pad-bottom` 裁掉，而前四格排得整整齐齐
- **每格说明最多 2 行**：3 行从格子下沿溢出压在下一格的标签上（叠字，不是消失）
- **`--veil` 留 0**：这一页没有图，那层黑会把四块色一起压灰
- **与 L5 的区别**：L5 是白卡 + hairline 的平面数据网格（默认那一档）；L69 是实色块拼贴 + 一块深底
  叙述，用在「这一页要有分量」的盘点页上。同一份里两条只用一条
- **与 L24 的区别**：L24 的 2×2 是四种取值的分类矩阵（每格有底图和一段正文）；L69 每格只有一个数字
