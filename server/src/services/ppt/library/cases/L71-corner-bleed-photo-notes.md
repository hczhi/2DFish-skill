# L71 · `corner-bleed-photo-notes`（出血角图 + 左侧文案：左上标题块 + 左下两张浅灰注解卡 + 右下角大图出血到页面右缘和下沿）

> **📄 详情**：本文件供 design 阶段匹配到 L71 时**必读**。
> **★ 核心原则**：结构是灵魂，颜色/内容不绑死。所有配色必须用 `var(--c-*)` 变量。

---

## 一、结构速览

- **比例**：16:9，左 40% 文案（上下各一块）+ 右下角一张出血大图（宽 50%、高 68%），文字容量中等（领句 + 标题 + 一段引言 + 2 块注解，约 220–300 字）
- **核心手法**：**图只占一个角，两条边都跑出页面**。浅底页上的图通常是半屏或整幅，这一条是「一张大图从右下角推进来」：右缘和下沿都不留白，左上角反过来是大片空白留给标题。左侧文案分上下两块（标题贴 `--pad-top`、注解卡贴 `--pad-bottom`），中间那段空白是这一页的呼吸。
- **是否全幅**：**是** —— 不包 `.slide-inner`（图要出血到页面右缘和下沿，文字块自己用 `var(--pad-x)` / `var(--pad-top)` / `var(--pad-bottom)` 对齐网格，疏密档照旧跟着这三个变量走）
- **什么时候用**：一页「一句判断 + 一段说明 + 2 条特质/原则」，而且**手上有一张值得占大面积的横图**：企业特质、团队/现场介绍、能力说明、理念页
- **导出 pptx**：一张图 + 两块实色圆角块 + 文字，没有渐变、没有 mask、没有蒙版。图出血的两条边在 pptx 里就是画布外（导出时按 1920×1080 裁），和浏览器一致

---

## 二、结构拆解（由后到前）

### 1. 出血角图 · `.l71-img` / `.l71-img img`

- **`right:0` / `bottom:0` 两边都出血，不许给它留 `var(--pad-x)`。** 留了之后这一页是「右下角贴了一张小图」—— 这一条存在的理由就是那个出血的角，而画面上是一页完整正常的幻灯片，`checkPage` 和类名校验一处都不会说。
- **页脚那 54px 压在图的下沿上**（`#footer` 挂在 `#stage` 上、`z-index:50`，比 `.slide` 里的一切都高）。这是这套外壳的常态（L11 / L21 同样如此），但页脚的字是 `var(--c-ink-soft)` 这一档灰：图的底部一条要是花的，主题文字、进度条、页码就读不出来，而每一层都渲染正常。所以 `data-img-prompt` 里**必须写「画面底部留一条安静/低对比的区域」**。
- 图**必须是横构图**（`ph-16x9.svg` 那一档）：竖图塞进这一格会被 `object-fit:cover` 裁掉上下，通常裁掉的正是主体。
- `.l71-img` 的 `overflow:hidden` 别删：`object-fit:cover` 的溢出靠它裁，删了图会顺着自己的固有比例伸出格子（往左盖住注解卡）。

### 2. 左上标题块 · `.l71-txt`

- **宽度 40% 是硬上限。** `140px + 40%×1920 = 908px`，图的左沿在 `50%` = 960px，只剩 52px 的缝。放到 44% 之后标题最后几个字**压在图的花纹上**（字是 `z-index:2`、图是 0，所以不是被盖住而是压上去），看起来只是「这一页有点挤」。
- 领句 `.l71-kicker` 说**另一个维度**（口径 / 年份 / 这一页属于哪一段），不许是标题的前半句。
- 标题 64px 衬线，**14 个汉字以内**（两行）；`<em>` 转 `var(--c-brand-deep)`，一页只标一处。
- `.l71-lead` 一段引言 **3–5 行**（这一块和下面的注解卡之间那段空白是这一页的呼吸，写到 8 行就把它填满了，画面照旧完整）。

### 3. 左下注解卡 · `.l71-notes` / `.l71-note`

- **正好 2 张**（`align-items:stretch` 让两张齐平）。3 张起每张只剩 240px 宽、小标题折三行；要摆 3–4 块换 L67（深底低垂卡）或 L30。
- 每张：`<em>` 英文小标签（14px 宽字距）+ `<b>` 小标题（≤8 字一行）+ `<p>` 说明 **2–3 行**。说明写到 5 行的话卡片往上长，顶进引言那一块（是叠字，不是消失）。
- 卡片靠 `var(--c-bg-alt)` 和页底区分，**别改成 `var(--c-card)`**：页底是纯白、`--c-card` 也是纯白，铺上去等于什么都没铺（画面上只是「这两块字糊在一起」）。

### 4. 全幅与页眉

- 不包 `.slide-inner`，但**页眉照旧贴**（内容页，`pageService.applyHeader` 贴在左上角 44–100px 那条带上，落在浅底上）。结构模板里**不要写 `.slide-header`**。
- **不要加 `has-card`**：那个类是给 L12 让色带溢出卡片边缘用的，这一页的图靠 `.l71-wrap` 的 `overflow:hidden` 裁在页面内，加了之后图会伸到舞台外的灰台面上。

---

## 三、CSS 骨架

```css
.l71-wrap{position:absolute;inset:0;overflow:hidden;background:var(--c-bg)}
.l71-img{position:absolute;right:0;bottom:0;width:50%;height:68%;z-index:0;overflow:hidden}
.l71-img img{width:100%;height:100%;object-fit:cover;display:block}
.l71-txt{position:absolute;left:var(--pad-x);top:var(--pad-top);width:40%;z-index:2}
.l71-kicker{font-family:var(--num);font-size:16px;font-weight:700;letter-spacing:.2em;color:var(--c-brand-deep)}
.l71-txt .page-title{font-family:var(--serif);font-size:64px;font-weight:900;line-height:1.18;letter-spacing:-.02em;color:var(--c-ink-deep);margin-top:20px}
.l71-txt .page-title em{font-style:normal;color:var(--c-brand-deep)}
.l71-lead{margin-top:24px;font-size:20px;line-height:1.85;color:var(--c-ink)}
.l71-notes{position:absolute;left:var(--pad-x);bottom:var(--pad-bottom);width:40%;z-index:2;display:flex;align-items:stretch;gap:24px}
.l71-note{flex:1;background:var(--c-bg-alt);border-radius:14px;padding:26px 28px}
.l71-note em{display:block;font-family:var(--num);font-size:14px;font-weight:700;font-style:normal;letter-spacing:.18em;color:var(--c-ink-soft)}
.l71-note b{display:block;margin-top:10px;font-size:22px;font-weight:800;line-height:1.35;color:var(--c-ink-deep)}
.l71-note p{margin-top:10px;font-size:17px;line-height:1.75;color:var(--c-ink)}
```

---

## 四、build-part 结构模板

```html
<section class="slide" data-layout="L71">
  <!-- 全幅：不包 .slide-inner；页眉由代码贴，这里不要写；不要加 has-card -->
  <div class="l71-wrap">
    <div class="l71-img">
      <img src="/ppt-cases/ph-16x9.svg" alt="" data-img-prompt="{{横构图；主体偏画面右上，底部留一条安静/低对比的区域给页脚}}" data-img-mode="case">
    </div>
    <div class="l71-txt">
      <div class="l71-kicker">{{领句：口径/年份，不许重复标题}}</div>
      <h1 class="page-title">{{标题，14 个汉字内，可用 <em>一处</em> 强调}}</h1>
      <p class="l71-lead">{{引言 3–5 行；别写到 8 行，中间那段空白是这一页的呼吸}}</p>
    </div>
    <div class="l71-notes">
      <div class="l71-note">
        <em>{{英文小标签}}</em>
        <b>{{小标题，≤8 字}}</b>
        <p>{{说明 2–3 行}}</p>
      </div>
      <div class="l71-note">
        <em>{{英文小标签}}</em>
        <b>{{小标题，≤8 字}}</b>
        <p>{{说明 2–3 行}}</p>
      </div>
    </div>
  </div>
</section>
```

---

## 五、图槽位

**1 个 —— `.l71-img img`（横构图，16:9 一档）。** 这一格是硬要求：删掉图之后右下角是一块空白，而左侧文案不会占过来（位置是写死的百分比）。`data-img-prompt` 里两句必写：**主体偏画面右上**（左下角会被注解卡那一侧的空白衬着，主体压在那儿会被裁）、**底部留一条安静的区域**（页脚压在图上）。没有合适横图的话换 L67（不吃图的并列页）。

---

## 六、变体

| 编号 | 变化 | 用途 |
|------|------|------|
| V1 | `.l71-img` 的 `height` 改 `78%`（图更高） | 图本身很好，想让它压过页面中线 |
| V2 | `.l71-img` 的 `width` 改 `44%` + 文字块放到 44% | 标题偏长（3 行） |
| V3 | 去掉 `.l71-lead` | 这一页只有标题和两条注解 |
| V4 | 注解卡 inline 改 `var(--c-brand)` 底 + 字走 `var(--c-brand-on)` | 这两条是这一页的重点 |
| V5 | 注解卡里去掉 `<em>` 小标签 | 没有合适的英文标签，别硬编 |

---

## 七、design 提示

- **一份里最多两页**：出血角图的辨识度很高，第三页开始看起来像同一页换了图
- **图必须两边出血（`right:0` / `bottom:0`）**：留出 padding 之后这一页是「右下角贴了一张小图」，而画面完全正常
- **文字块宽度 40% 封顶**：44% 起标题最后几个字压在图的花纹上（字在图之上，所以不是被盖住，看起来只是「有点挤」）
- **`data-img-prompt` 里必须写「底部留一条安静的区域」**：页脚那 54px 压在图上，页脚的字是 `var(--c-ink-soft)` 这档灰，落在花纹上读不出来而每一层都渲染正常
- **注解卡用 `var(--c-bg-alt)`，不许用 `var(--c-card)`**：页底是纯白、`--c-card` 也是纯白，铺上去等于什么都没铺（画面上只是「这两块字糊在一起」）
- **注解正好 2 张**：3 张起每张只剩 240px 宽、小标题折三行
- **`.l71-img` 的 `overflow:hidden` 别删**：`object-fit:cover` 的溢出靠它裁，删了图会往左盖住注解卡
- **不要加 `has-card`**：加了图会伸到舞台外的灰台面上（看起来像「这一页排版溢出了」）
- **`--veil` 留 0**：那层黑（`.slide::before`，在图之上、字之下）会把左边那半浅底一起压灰，而画面只是「这一版发闷」
- **与 L1 / L3 的区别**：那两条是规整的左右分屏，图占满右半的整个高度；L71 的图只占右下角，左上和图上方是连成一片的空白
- **与 L21 / L11 的区别**：那两条是整幅照片 + 浮字（字在图上）；L71 的字全在浅底上，图只吃一个角
- **与 L70 的区别**：L70 是非全幅的竖图分屏（色卡骑在图沿上）；L71 是全幅横图出血到两条边，文案分上下两块
