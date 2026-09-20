# L72 · `brand-field-card-row`（品牌色大色场 + 底部照片带 + 压在带上的三张白卡：色场从 118px 铺到三边出血 + 场内标题与一行副题 + 底部照片带 + 三张白卡压在带上）

> **📄 详情**：本文件供 design 阶段匹配到 L72 时**必读**。
> **★ 核心原则**：结构是灵魂，颜色/内容不绑死。所有配色必须用 `var(--c-*)` 变量。

---

## 一、结构速览

- **比例**：16:9，一整块品牌色色场（左右下三边出血、上边停在 118px）+ 场内上方标题与一行副题 + 底部一条照片带 + 压在带上的 3 张白卡，文字容量中等（标题 + 一行副题 + 每卡 3–5 行，约 240–320 字）
- **核心手法**：**整页品牌色**（库里唯一一条）+ 三层叠压：色场 → 照片带（贴色场底，露出卡片上方那 50px）→ 白卡行。白卡在这一页是**真的分隔手段**（纯白压在品牌色上），这是它和库里其他白卡页最大的差别。
- **是否全幅**：**是** —— 不包 `.slide-inner`（色场要出血到左右和下沿）
- **顶部那条 118px 是留给代码贴的模块名的**（`.slide-header` 落在 44–100px），不是留白装饰
- **什么时候用**：一页「一个品类/一套东西分成 3 类」——产品/卡种/服务分类、三类客户、三种资质。要有「这一页是一个整块」的分量时用它
- **导出 pptx**：一块实心色块 + 一张图 + 三块白卡 + 文字，没有渐变、没有 mask、没有透明度

---

## 二、结构拆解（由后到前）

### 1. 品牌色色场 · `.l72-field`

- **`top:118px`，不许铺到 `top:0`。** 代码贴的那行模块名走 `.slide-header .kicker`，**颜色写死在 `var(--c-accent-deep)` 上**、位置写死在 44–100px 那条带里。色场铺到顶之后那行字是天青压橙（默认那套约 1.8:1）/ 深蓝压深蓝（蓝那套）—— 字和色都在，就是读不出来，而这一页每一层都渲染正常、`checkPage` 和类名校验一处都不会说。118 = 100 + 18 的余量（L61 让面板用浅色、L48 把白卡压到 150px、L50 把色块贴右，是同一件事的另三种解法）。
- 左右下三边**必须出血**（`left:0;right:0;bottom:0`）：给它留 `var(--pad-x)` 之后这一页是「白页上放了一个大色块」，而这一条的分量全在「整页是一块颜色」上。
- 色场上的字**一律 `var(--c-brand-on)`，不许写死 `#fff`**：品牌色能不能压白字由配色决定（默认那套的橙对白字 2.6:1，AA 要 4.5）。这是库里唯一整页铺品牌色的版式，所以这个角色变量在这儿是承重的。

### 2. 底部照片带 · `.l72-band`

- 贴色场底（`bottom:0`、高 46%），**在色场里面**（靠色场的 `overflow:hidden` 裁）。它露在卡片上方的那 50px 是这一页唯一的「实景」，删掉之后整页只剩一块颜色加三张卡。
- 图**必须是横构图**且**底部一条要安静**：页脚那 54px 压在带上（`#footer` 是舞台级 `z-index:50`），页脚的字是 `var(--c-ink-soft)` 这一档灰，落在花纹上就读不出来，而每一层都渲染正常。这句话要写进 `data-img-prompt`。
- 带的高度别超过 55%：再高就顶到副题下面，照片和标题之间没有色场了（画面照旧完整，只是这一页不再是「一块颜色」）。

### 3. 场内标题 · `.l72-txt`

- `top:176px`（色场顶 118 + 58）。标题 72px 衬线、**12 个汉字以内**（一到两行）；这一条**不设领句**（模块名那行由代码贴在上面的白条里，再加一行小字就是两行小字叠着）。
- `.l72-sub` **正好一行**（`max-width:1180px`）：两行起副题会顶到卡片行上沿（是叠字，不是消失）。
- 标题里**不要用 `<em>` 强调**：底已经是品牌色，强调色压在同色底上等于没标（而字确实在那儿）。要强调就断句。

### 4. 白卡行 · `.l72-cards` / `.l72-card`

- **正好 3 张**（`align-items:stretch` 齐平）。2 张时每张宽 800px、一行说明排到 40 字，读起来是两大块；4 张起每张只剩 370px、小标题折三行 —— 要 4 块换 L67。
- **`bottom:72px` 是硬下限**：页面下沿那 54px 是 `#footer`，伸进去之后页脚那条 hairline 横穿三张卡、页码印在最后一张卡上，而画面照旧正常。**section 上不要加 `has-card`**（那是给 L12 让色带溢出用的，加了卡片会伸到舞台外的灰台面上）。
- `min-height:320px` 只是「三条各一行」时的下限，**别写死 `height`**：写死了短文案剩一大截空白、长文案把说明最后一行截在卡外，两种画面都完全正常。
- 卡内：`em` 英文小标签 + `b` 小标题（≤8 字）+ `p` 说明 3–5 行。卡里的字照旧走 `var(--c-ink*)`（白底上）。
- **卡片里不要放 `<img>`**：卡片是贴底往上长的，塞进去的图会把整行顶到副题上（而页面照旧渲染正常）。要「上图下文」三栏换 L30。

---

## 三、CSS 骨架

```css
.l72-wrap{position:absolute;inset:0;overflow:hidden;background:var(--c-bg)}
.l72-field{position:absolute;left:0;right:0;top:118px;bottom:0;z-index:0;overflow:hidden;background:var(--c-brand)}
.l72-band{position:absolute;left:0;right:0;bottom:0;height:46%;z-index:1;overflow:hidden}
.l72-band img{width:100%;height:100%;object-fit:cover;display:block}
.l72-txt{position:absolute;left:var(--pad-x);right:var(--pad-x);top:176px;z-index:2}
.l72-txt .page-title{font-family:var(--serif);font-size:72px;font-weight:900;line-height:1.16;letter-spacing:-.02em;color:var(--c-brand-on);margin-top:0}
.l72-sub{margin-top:22px;max-width:1180px;font-size:21px;line-height:1.8;color:var(--c-brand-on)}
.l72-cards{position:absolute;left:var(--pad-x);right:var(--pad-x);bottom:72px;min-height:320px;z-index:3;display:flex;align-items:stretch;gap:26px}
.l72-card{flex:1;background:var(--c-card);border-radius:16px;padding:36px 32px;box-shadow:0 26px 60px rgba(0,0,0,.24)}
.l72-card em{display:block;font-family:var(--num);font-size:14px;font-weight:700;font-style:normal;letter-spacing:.18em;color:var(--c-ink-soft)}
.l72-card b{display:block;margin-top:12px;font-size:26px;font-weight:800;line-height:1.3;color:var(--c-ink-deep)}
.l72-card p{margin-top:14px;font-size:17px;line-height:1.75;color:var(--c-ink)}
```

---

## 四、build-part 结构模板

```html
<section class="slide" data-layout="L72">
  <!-- 全幅：不包 .slide-inner；页眉由代码贴在顶部那条 118px 的白带里，这里不要写；不要加 has-card -->
  <div class="l72-wrap">
    <!-- 色场从 118px 开始（顶上那条白带是留给模块名的），不要改成 top:0 -->
    <div class="l72-field">
      <div class="l72-band">
        <img src="/ppt-cases/ph-16x9.svg" alt="" data-img-prompt="{{横构图；适合做底部一条横带，底部留一条安静/低对比的区域给页脚}}" data-img-mode="case">
      </div>
    </div>
    <!-- 场上的字一律 var(--c-brand-on)，不许写死 #fff；标题里不用 <em>（同色底上标不出来） -->
    <div class="l72-txt">
      <h1 class="page-title">{{标题，12 个汉字内}}</h1>
      <p class="l72-sub">{{副题，正好一行}}</p>
    </div>
    <div class="l72-cards">
      <div class="l72-card">
        <em>{{英文小标签}}</em>
        <b>{{小标题，≤8 字}}</b>
        <p>{{说明 3–5 行}}</p>
      </div>
      <div class="l72-card">
        <em>{{英文小标签}}</em>
        <b>{{小标题，≤8 字}}</b>
        <p>{{说明 3–5 行}}</p>
      </div>
      <div class="l72-card">
        <em>{{英文小标签}}</em>
        <b>{{小标题，≤8 字}}</b>
        <p>{{说明 3–5 行}}</p>
      </div>
    </div>
  </div>
</section>
```

---

## 五、图槽位

**1 个 —— `.l72-band img`（横构图，16:9 一档，用作底部一条横带）。** 它露在卡片上方的那 50px 是这一页唯一的实景，删掉之后整页只剩一块颜色加三张白卡（画面照旧完整，只是分量全没了）。`data-img-prompt` 里**必须写「底部留一条安静的区域」**：页脚压在带上，页脚那档灰字落在花纹上读不出来。没有可用横图的话换 L67（深底、不吃图的并列页）。

---

## 六、变体

| 编号 | 变化 | 用途 |
|------|------|------|
| V1 | `.l72-field` 的底色改 `var(--c-accent)`（场上的字跟着改 `var(--c-accent-on)`） | 整份里品牌色用得太满 |
| V2 | 去掉 `.l72-band`（整页纯色场 + 三张白卡） | 手上没有合适的横图 |
| V3 | 带高改 `54%`（照片露得更多） | 图本身很好 |
| V4 | 去掉 `.l72-sub` | 标题两行时 |
| V5 | 卡片里去掉 `em` 小标签 | 没有合适的英文标签，别硬编 |
| V6 | `.l72-card b` inline 改 `var(--c-brand-deep)` | 想让卡内小标题和色场呼应 |

---

## 七、design 提示

- **一份里最多一页**：整页品牌色的存在感极强，第二页会把整份的节奏带走
- **色场 `top:118px` 不许改成 0**：代码贴的模块名走 `.slide-header .kicker`（色写死 `var(--c-accent-deep)`、位置写死 44–100px），铺到顶之后那行字压在同色调的底上读不出来，而画面完全正常
- **色场上的字一律 `var(--c-brand-on)`，不许写死 `#fff`**：默认那套的橙对白字 2.6:1（AA 要 4.5），换配色那天整页标题发飘而每一页都正常
- **标题里不用 `<em>`**：底就是品牌色，强调色压在同色底上等于没标
- **副题正好一行**：两行起顶到卡片行上沿（叠字，不是消失）
- **白卡 3 张、`bottom` 至少 72px、不写死 `height`**：伸进页脚那 54px 之后 hairline 横穿三张卡、页码印在卡上；写死高度则短文案空一截、长文案截掉最后一行
- **`data-img-prompt` 必须写「底部留一条安静的区域」**：页脚压在照片带上，页脚的字是 `var(--c-ink-soft)` 这档灰
- **不要加 `has-card`**：加了卡片会伸到舞台外的灰台面上
- **`--veil` 留 0**：那层黑（`.slide::before`）在色场之上、卡片之下，拉高之后色场变脏而卡片不变，看起来只是「这一版颜色不对」
- **白卡在这一页有效，别把这条经验搬去别的页**：页底是纯白的那些页上 `--c-card` 也是纯白，铺上去等于什么都没铺（见 `:root` 那条）
- **与 L67 的区别**：L67 是深墨底 + 低垂卡 + 外挂圆图标、**不吃图**；L72 是品牌色场 + 底部照片带，卡片是平的（没有外挂图标）
- **与 L48 的区别**：L48 是白卡压在底部品牌色带上（色带只露出边缘）；L72 反过来 —— 品牌色是整页的底，白卡是压在上面的三块
- **与 L19 的区别**：L19 是暗底照片 + 中央产品图 + 底部扁参数卡；L72 没有主角图，照片只是底部一条带
