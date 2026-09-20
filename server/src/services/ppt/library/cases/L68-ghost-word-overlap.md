# L68 · `ghost-word-overlap`（巨字压底：300px 浅色巨词横在页面中段、右端跑出页面被裁 + 标题与要点行压在它上面）

> **📄 详情**：本文件供 design 阶段匹配到 L68 时**必读**。
> **★ 核心原则**：结构是灵魂，颜色/内容不绑死。所有配色必须用 `var(--c-*)` 变量。

---

## 一、结构速览

- **比例**：16:9，浅底（页底一律纯白）+ 左上标题块 + 右下三条要点行 + 中段一个巨词做底纹，文字容量中等（约 260–360 字）
- **核心手法**：**一个 300px 的实色浅词横在两块内容之间**，右端跑出页面右缘被 `#stage` 裁掉。层级来自「巨字 / 标题 / 要点」三级字号差（300 : 68 : 24），不靠图、不靠色块
- **是否全幅**：**是** —— 不包 `.slide-inner`（巨字要跑出页面右缘，两块内容各自绝对定位）
- **什么时候用**：一句判断 + 3 条支撑的内容页，而且这一页有一个**能立住的词**（窗口期 / 不可逆 / 三段式 / 口径）：时机判断、观点页、原则页
- **图槽位**：**0 个**（放了图就和巨字抢同一块中段，两个「大东西」互相削）
- **导出 pptx**：全是文字，没有渐变/mask/图 —— 保真。巨字跑出页面的那半截在 pptx 里落在画布外，放映时同样看不见

---

## 二、结构拆解

### 1. 巨词 · `.l68-ghost`

- **颜色必须是实色 `var(--c-bg-alt)`，不许用 rgba 或 `opacity` 调淡。** pptx 里的透明度写出来是
  `<a:alphaModFix>`，**苹果那套渲染器（Keynote / 预览）直接忽略它**：PowerPoint 里正常，Keynote 里这个
  300px 的词变成一整块近黑压在正文上，而导出这一步一句话都不会说。
- **`white-space:nowrap` 不能删。** 删了之后巨字折行，第二行横穿右下那几条要点行 —— 每一块字都在、位置
  也「对」，看起来只是「这一页有点乱」。
- 放**一个词**（2–6 个汉字，或「中文 + 一个英文单词」两段）。**不放数字**：空心巨数字那一档是 L41
  （章节页），内容页上一个巨大的数字会被读成序号。
- `top:300px` 是让它横在标题块下沿和要点行上沿之间的那条缝里。往上挪会顶到标题（巨字浅、看起来只是
  「标题发灰」），往下挪会压到页脚那 54px（`#footer` 是舞台级的、`z-index:50`，页码会印在巨字上）。

### 2. 标题块 · `.l68-txt`

- `left:var(--pad-x)` / `top:var(--pad-top)` / `width:44%`。**宽度别超过 46%**：右下那块是
  `right:var(--pad-x);width:40%`（左边缘在 1012px），44% 的标题块右边缘在 985px，只剩 27px 的缝。
- 领句 `.l68-kicker` 说另一个维度（时间窗 / 口径 / 这一页属于哪一段），不是标题的前半句。
- 标题 68px 衬线，**14 个汉字以内**（两行封顶）；`<em>` 转品牌色，一页只标一处。
- `.l68-lead` **2–4 行**（5 行起下沿压到巨字上，浅色巨字衬在正文后面读起来发脏）。

### 3. 要点行 · `.l68-rows` / `.l68-row`

- 贴右下角（`right:var(--pad-x)` / `bottom:var(--pad-bottom)`），**正好 3 条**：2 条时右下空一大块、
  4 条起总高超过 500px，顶到 `.l68-lead` 的下沿。
- 每条 = `<i>` 序号（品牌色小字）+ `<b>` 小标题（≤10 字）+ `<span>` 说明（1–2 行）。
- 上边那条 `border-top:2px solid var(--c-ink-deep)` 是这三条和巨字分层的唯一手段（1px 或换 hairline
  之后，浅色巨字从线后面透过来，三条要点看着像浮在雾里）。

---

## 三、CSS 骨架

```css
.l68-wrap{position:absolute;inset:0}
.l68-ghost{position:absolute;left:var(--pad-x);top:300px;font-family:var(--serif);font-size:300px;font-weight:900;line-height:.86;letter-spacing:-.03em;white-space:nowrap;color:var(--c-bg-alt);z-index:0}
.l68-txt{position:absolute;left:var(--pad-x);top:var(--pad-top);width:44%;z-index:2}
.l68-kicker{font-family:var(--num);font-size:16px;font-weight:700;letter-spacing:.2em;color:var(--c-brand)}
.l68-txt .page-title{font-family:var(--serif);font-size:68px;font-weight:900;line-height:1.18;letter-spacing:-.02em;color:var(--c-ink-deep);margin-top:18px}
.l68-txt .page-title em{font-style:normal;color:var(--c-brand)}
.l68-lead{margin-top:20px;font-size:20px;line-height:1.8;color:var(--c-ink)}
.l68-rows{position:absolute;right:var(--pad-x);bottom:var(--pad-bottom);width:40%;z-index:2;display:flex;flex-direction:column;gap:22px}
.l68-row{display:flex;gap:22px;padding-top:20px;border-top:2px solid var(--c-ink-deep)}
.l68-row i{flex:none;font-family:var(--num);font-size:15px;font-weight:800;font-style:normal;letter-spacing:.16em;color:var(--c-brand);padding-top:6px}
.l68-row b{display:block;font-size:24px;font-weight:800;line-height:1.35;color:var(--c-ink-deep)}
.l68-row span{display:block;margin-top:8px;font-size:17px;line-height:1.7;color:var(--c-ink)}
```

---

## 四、build-part 结构模板

```html
<section class="slide" data-layout="L68">
  <!-- 全幅：不包 .slide-inner；页眉由代码贴，这里不要写 -->
  <div class="l68-wrap">
    <div class="l68-ghost">{{一个词，2–6 个汉字，可带一个英文单词；不写数字}}</div>
    <div class="l68-txt">
      <div class="l68-kicker">{{领句，不许重复标题}}</div>
      <h1 class="page-title">{{标题，14 个汉字内，可用 <em>一处</em> 强调}}</h1>
      <p class="l68-lead">{{引言 2–4 行}}</p>
    </div>
    <div class="l68-rows">
      <div class="l68-row"><i>01</i><div><b>{{小标题，≤10 字}}</b><span>{{说明，1–2 行}}</span></div></div>
      <div class="l68-row"><i>02</i><div><b>{{小标题}}</b><span>{{说明}}</span></div></div>
      <div class="l68-row"><i>03</i><div><b>{{小标题}}</b><span>{{说明}}</span></div></div>
    </div>
  </div>
</section>
```

---

## 五、图槽位

**0 个** —— 这一条的中段被巨字占了，再放一张图两个「大东西」互相削。要「一句判断 + 一张大图」换 L21，
要「三条要点 + 三张小图」换 L30。

---

## 六、变体

| 编号 | 变化 | 用途 |
|------|------|------|
| V1 | 巨词改英文单词（`letter-spacing:.02em`） | 品牌调性偏国际化 |
| V2 | 要点行两条 + 每条说明放到 3 行 | 只有两条支撑 |
| V3 | `.l68-ghost` 的 `top` 提到 260px、字号降到 260px | 标题是三行时 |
| V4 | 去掉 `.l68-lead` | 标题本身就是完整判断 |

---

## 七、design 提示

- **一份里最多一页**：巨字这个手法第二次出现就变成模板感
- **巨字用实色 `--c-bg-alt`**，不许 rgba / `opacity`（Keynote 忽略 pptx 的透明度，那个词会变成近黑一块）
- **`white-space:nowrap` 不能删**（折行的第二行横穿要点行，而画面看起来只是「有点乱」）
- **巨字不写数字**（会被读成序号，空心巨数字那一档是 L41）
- **两块内容都要 `z-index:2`**：漏了就落在巨字之下 —— 而巨字很浅，症状只是「这一页的字发灰」
- **`--veil` 留 0**：这一页没有图，那层黑只会把巨字和正文一起压灰
- **与 L41 的区别**：L41 是章节扉页 + 空心描边巨**数字**；L68 是内容页 + 实色巨**词**，且右端出页
- **与 L29 / L7 的区别**：那两条是金句页（一整页就一句话）；L68 的巨词是底纹，正文照旧是判断 + 三条支撑
