# L75 · `photo-glass-panel-metrics`（整页实景图 + 右侧通高半透明深色面板：序号标头 + 深色条上的标题 + 一段说明 + 一排 pill + 一排指标）

> **📄 详情**：本文件供 design 阶段匹配到 L75 时**必读**。
> **★ 核心原则**：结构是灵魂，颜色/内容不绑死。所有配色必须用 `var(--c-*)` 变量。

---

## 一、结构速览

- **比例**：16:9，一张铺满整页的实景图（只压 28%，左半照片是露着的）+ 右侧 46% 一块通高的半透明深色面板，字全在面板里（约 180–240 字）
- **核心手法**：**图归左、字归右，中间那条边是面板的直边** —— 面板从画面顶边压到底边（`top:0;bottom:0`），靠自己 `.55` 的黑托住白字；左半留给照片主体。比 L74 能多装一排 pill（能力/主张标签）。
- **是否全幅**：**是** —— 图和面板都在 `.l75-wrap` 里，**不包 `.slide-inner`**（同 L74，理由见 §七第一条）
- **什么时候用**：一页「一句主张 + 一段自我介绍 + 三条能力标签 + 三个数字」：关于我们、公司/团队简介、服务承诺、能力总述
- **图槽位**：**1 个（必填）** —— `.l75-bg` 铺满整页的实景图（`16:9`，**主体必须在画面左半**，右半 46% 被面板整块盖住）
- **导出 pptx**：一张全幅图 + 两层带 alpha 的黑矩形 + 文字，保真；**面板不许用 `backdrop-filter` 或渐变**（导出还原不回来，见 §七）

---

## 二、结构拆解（由后到前）

### 1. 整页图 · `.l75-bg`

- **必填**。这一层自带 `background:var(--c-ink-deep)` 深底，占位图阶段单独压到 `.22`
  （`img[src^="/ppt-cases/ph-"]`）：还没配图的时候左半是深底、一眼看得出「这里还没有图」，
  而不是一块浅灰。
- `::after` 那层 `rgba(0,0,0,.28)` **不能删**：左半露出来的图上有代码贴的那行模块名
  （`.slide-header .kicker`，颜色写死 `var(--c-accent-deep)`，一个中等明度的彩色），删了之后
  它落在图的亮部上读不出来 —— 而那一行不在这份结构里，检查这一页时根本想不到它。
- **主体必须在左半**（和 L74 正好相反）：右边 46% 被面板整块盖住，主体在右的图进来之后这一页
  照样完整、每个字都在，只是「这张图看着是空的」，他会一张张重生。

### 2. 通高面板 · `.l75-panel`

- `right:0;top:0;bottom:0;width:46%`，**贴着三条画面边**。这块直边压到顶和底是这一条的签名：
  改成浮在中间的卡片就是 L12 那一族的形状了。
- **`background` 是一层单色 `rgba(0,0,0,.55)`**，alpha **不能低于 .5**：低了之后图的亮部从面板
  底下透上来，白字和亮部糊在一起 —— 现象是「有些页的右边有点花」，换一张图又好了，指不到
  版式上。也因此这一条**不带 `text-shadow`**（面板本身就是底），把面板调淡又指望投影救的话
  两头都不够。
- 内边距 `var(--pad-top) 84px var(--pad-bottom)`：上下和别的版式对齐（让开页眉带和页脚），
  左右是面板自己的 84px。**别把左右也写成 `var(--pad-x)`**（140px 两边一共 280px，面板里
  只剩 600px，标题一行只放得下 8 个字，而每一行都排得下、看不出是内边距的事）。

### 3. 序号标头 · `.num-kicker`（共用件）

- `<b>` 两位序号 + `<i></i>` 竖线 + `<span>` 里 `<em>` 英文标签与 `<small>` 中文小标，
  颜色全部继承（这里是白的）。序号是**这一页在稿子里的位置**（章节序号/页序），
  **不许编** —— 编一个出来和页脚、目录对不上，而这一页读起来完全正常。
- `<em>` 一到三个词、`<small>` 中文 ≤6 字，两者是同一件事的两种语言，也不许是大标题的复制。

### 4. 标题 / 说明 / pill · `.page-title` / `.l75-lead` / `.l75-pills`

- 标题 48px 衬线，压在自己那条 `rgba(0,0,0,.42)` 的深色条上（面板 + 这一条叠起来才是那块
  「更实的深底」）。**一行 ≤13 个汉字、最多两行**：第三行会把 pill 和指标一起往下顶，
  而顶出去的那部分被面板的 `padding-bottom` 挡在页脚上（看起来只是「这一页有点满」）。
- `.l75-lead` 3–5 行。`.l75-pills` **2–4 个**（每个 ≤5 字）：5 个起换到第二行，把指标那一排
  往下顶；pill 里写的是**能力/主张**（品牌宣传 / 服务态度 / 作品质量），不是指标的口径。

### 5. 指标 · `.metric-row`（共用件，面板里 `gap:56px`）

- **小标在上、大数字在下**，2–3 项（面板里只有 715px 宽，4 项时 56px 的数字会挤到贴边）。
  每项 `<span>` 口径 ≤6 字 + `<b>` 数字 ≤6 字符。
- 没有数字可写就整块删掉（说明放宽到 6 行）。

---

## 三、CSS 骨架

```css
.num-kicker{display:flex;align-items:flex-start;gap:24px}
.num-kicker>b{font-family:var(--num);font-size:64px;font-weight:800;line-height:.92;letter-spacing:-.04em}
.num-kicker>i{flex:none;width:2px;height:64px;background:currentColor;opacity:.42}
.num-kicker em{display:block;font-family:var(--num);font-size:32px;font-weight:700;font-style:normal;letter-spacing:.12em;line-height:1}
.num-kicker small{display:block;margin-top:12px;font-size:19px;letter-spacing:.14em;opacity:.78}
.metric-row{margin-top:auto;display:flex;gap:80px}
.metric-row span{display:block;font-size:17px;letter-spacing:.06em;opacity:.76}
.metric-row b{display:block;margin-top:12px;font-family:var(--num);font-size:56px;font-weight:800;line-height:1;letter-spacing:-.03em}
.l75-wrap{position:absolute;inset:0;overflow:hidden}
.l75-bg{position:absolute;inset:0;z-index:0;overflow:hidden;background:var(--c-ink-deep)}
.l75-bg img{width:100%;height:100%;object-fit:cover;display:block}
.l75-bg::after{content:"";position:absolute;inset:0;background:rgba(0,0,0,.28)}
.l75-panel{position:absolute;right:0;top:0;bottom:0;width:46%;z-index:2;padding:var(--pad-top) 84px var(--pad-bottom);background:rgba(0,0,0,.55);display:flex;flex-direction:column;color:#fff}
.l75-panel .page-title{margin-top:auto;padding:18px 24px;background:rgba(0,0,0,.42);font-family:var(--serif);font-size:48px;font-weight:900;line-height:1.28;letter-spacing:-.02em;color:#fff}
.l75-lead{margin-top:22px;font-size:19px;line-height:1.9;color:rgba(255,255,255,.82)}
.l75-pills{margin-top:26px;display:flex;flex-wrap:wrap;gap:14px}
.l75-pills span{padding:11px 24px;border-radius:999px;border:1px solid rgba(255,255,255,.55);background:rgba(255,255,255,.14);font-size:18px;font-weight:700;color:#fff}
.l75-panel .metric-row{gap:56px}
```

---

## 四、build-part 结构模板

```html
<section class="slide" data-layout="L75">
  <!-- 全幅：图和面板都在 .l75-wrap 里，**不要 .slide-inner**（包了的话这一格的生图提示词
       会变成「不要主体、只要质感」）；页眉由代码贴，这里不要写 -->
  <div class="l75-wrap">
    <div class="l75-bg">
      <img src="/ppt-cases/ph-16x9.svg" alt="" data-img-prompt="{{这张图要什么：实景，主体和亮部都在画面左半，右半是安静的背景}}" data-img-mode="case">
    </div>
    <div class="l75-panel">
      <div class="num-kicker">
        <b>{{两位序号，如 03；想不出来就整个 b 不写}}</b>
        <i></i>
        <span>
          <em>{{英文标签，1–3 个词}}</em>
          <small>{{中文小标，≤6 字}}</small>
        </span>
      </div>
      <h1 class="page-title">{{标题，≤13 个汉字}}</h1>
      <p class="l75-lead">{{一段说明，3–5 行}}</p>
      <div class="l75-pills">
        <span>{{能力标签，≤5 字}}</span>
        <span>{{能力标签}}</span>
        <span>{{能力标签}}</span>
      </div>
      <div class="metric-row">
        <div><span>{{口径，≤6 字}}</span><b>{{数字，≤6 字符}}</b></div>
        <div><span>{{口径}}</span><b>{{数字}}</b></div>
        <div><span>{{口径}}</span><b>{{数字}}</b></div>
      </div>
    </div>
  </div>
</section>
```

---

## 五、图槽位

| 槽位 | 必填? | 模式 | 比例 | 构图要求 |
|------|-------|------|------|----------|
| `pXX_bg` | **必填**（不放图时左半是一块深底，读得通但明显缺一张图） | case | 16:9 | **主体和亮部都在画面左半**（右边 46% 被面板整块盖住）；左上角略压深（页眉那行彩色模块名压在上面）；不要带文字/水印 |

**禁用**：主体在右半的图（整个被面板盖住，这一页看起来像「图是空的」）、拼贴/多图格子（整页只有一张图）、已经压得很暗的图（左半露着的那一半会黑成一块）

---

## 六、变体

| 编号 | 变化 | 用途 |
|------|------|------|
| V1 | 面板换到左边（`.l75-panel` inline 加 `left:0;right:auto`） | 照片主体在右半 |
| V2 | 去掉 `<b>` 序号，只留竖线 + 双语标签 | 这一页不在编号序列里 |
| V3 | 去掉 `.l75-pills` | 没有能力标签可写（说明放宽到 6 行） |
| V4 | 去掉 `.metric-row` | 这一页没有数字 |
| V5 | 面板加宽到 52%（inline `width:52%`） | 说明偏长（但照片只剩不到一半，别当常态） |

---

## 七、design 提示

- **不许把这两层包进 `.slide-inner`**（哪怕包了照样好看）：`imageSpace` 收「压住画面的文字块」时
  跳过图的祖先，而 `.slide-inner` 和图那一层是**兄弟** —— 它整块被算成一片覆盖 70% 的文字，
  这一格判成 `most`，发给生图的那句话变成「整幅都被文字压住，不要单一的视觉焦点，给一片均匀
  低反差的质感」，回来一张抽象肌理图，而这一页要的是主体在左半的实景照片。页面排得好好的、
  接口 200，一处都不会说，他只会一张张重生（每张真扣一次额度）
- **面板不许写 `backdrop-filter`，也不许换成渐变**：浏览器里毛玻璃很好看，导出 pptx / 单页截图时
  只有 `<img>` 是按像素截的，滤镜和渐变都还原不回来 —— 那时面板退成一块更淡的平底，白字压在
  没压暗的照片亮部上，而每一块都在、位置也对，看起来像「导出的这一版配色淡了点」
- **面板 alpha 不低于 `.5`**：低了之后图的亮部从底下透上来，白字和亮部糊在一起，现象是「有些页
  右边有点花」、换张图又好了；这一条**没有 `text-shadow`** 兜底（面板就是底）
- **照片主体必须在左半**：右边 46% 被面板盖住，主体在右的图进来之后这一页照样完整，只是「图是空的」
- **`.l75-bg::after` 那层 `.28` 不能删**：左半图上有代码贴的模块名（`var(--c-accent-deep)`），
  删了之后它落在亮部上读不出来，而它不在这份结构里
- **面板左右内边距保持 84px**，别改成 `var(--pad-x)`（面板里只剩 600px，标题一行 8 个字，
  而每一行都排得下、看不出是内边距的事）
- **标题 ≤13 个汉字、最多两行**；pill **2–4 个**（5 个起换行，把指标顶到页脚上）；指标 **2–3 项**
  且口径在上、数字在下（面板里只有 715px，4 项时数字挤到贴边）
- **序号不许编**（它是这一页在稿子里的位置，编一个和页脚、目录对不上而页面完全正常）
- **配色**：面板里的字直接写 `#fff` / `rgba(255,255,255,…)`（同 L19/L21/L74），不要用 `var(--c-ink*)`
- **一份里最多两页**，且别和 L74 连着排（都是「整页照片 + 关于我们」，连排就是模板感）
- **与 L74 的区别**：L74 的字直接压在图上、靠整层 `.42` 的黑托底，主体留**右**；L75 的字装在
  右侧通高面板里、图只压 `.28`，主体留**左**，而且多一排 pill
- **与 L12 的区别**：L12 是浮在页面中间的白卡（四边都留着边）；这一条的面板贴顶贴底贴右，是一堵墙
- **与 L21 的区别**：L21 的左文字块和右三栏数据都是**直接压在图上**的（只有整层 `.38` 的黑 +
  `text-shadow`），没有面板这堵墙，所以它要的是中央透视、四周安静的图
