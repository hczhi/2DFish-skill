# L67 · `dark-drop-card-row`（深底低垂卡片行：整页深墨底 + 左侧巨标题与两个大数字 + 右侧 3–4 张白卡低垂到页脚线上方 + 卡顶外挂圆图标）

> **📄 详情**：本文件供 design 阶段匹配到 L67 时**必读**。
> **★ 核心原则**：结构是灵魂，颜色/内容不绑死。所有配色必须用 `var(--c-*)` 变量。

---

## 一、结构速览

- **比例**：16:9，**深墨底**（`var(--c-ink-deep)`）+ 左侧 32% 文案 + 右侧 3–4 张白卡，文字容量中等（领句 + 标题 + 一段引言 + 2 个数字 + 每卡 3–5 行，约 320–420 字）
- **核心手法**：库里唯一**一张图都不吃**的并列页，层级全靠三样东西 —— ① 卡片行**低垂**到远低于 `--pad-bottom` 的位置（`bottom:72px`，正好停在页脚线上方）、和左上角的巨标题拉成一条对角；② 圆图标**骑在卡片上边缘**（一半在卡外）；③ 深底上的**深投影**把白卡托起来。
- **是否全幅**：**是** —— 不包 `.slide-inner`（深底要铺满整页，文字块和卡片行各自绝对定位）
- **底色**：`.l67-wrap` 自带 `var(--c-ink-deep)`，**不加任何 `.slide` 底色类**
- **什么时候用**：一页「一句判断 + 3–4 个顺序推进的阶段/能力/档位」，而且**手上一张可用的图都没有**：落地路径、三段式方法、能力分层、方案档位
- **导出 pptx**：全是实心色块 + 文字，没有渐变、没有 mask、没有图 —— 这是库里导出最保真的几条之一。圆图标按 `border-radius:50%` 导成椭圆、卡片导成 `roundRect`

---

## 二、结构拆解（由后到前）

### 1. 页底 · `.l67-wrap`

- **底色必须是 `var(--c-ink-deep)`，不许换成 `var(--c-brand)`。** 品牌色能不能压白字**由配色决定**：默认那套的橙对白字是 2.6:1、`--c-brand-deep` 也只有 2.9:1（AA 要 4.5）。铺成整页底之后这一页的标题、引言、卡外的一切白字全部发飘，而每一页都是一页完整正常的幻灯片，浏览器 / `checkPage` / 导出一处都不会说。想要「整页品牌色」的观感，靠圆图标那几块实底和领句去带。
- 深底页上的字一律写 `#fff` / `rgba(255,255,255,…)`（同 L29 / L39），**不要用 `var(--c-ink*)`** —— 那几个是深色，写上去等于隐形。

### 2. 左侧文案 · `.l67-txt`

- `left:var(--pad-x)` / `width:32%` / 通高 flex column。**宽度别超过 34%**：`140px + 32%×1920 = 754px` 正好停在 `.l67-cards` 的 `left:41%`（787px）之前，再宽两块就开始打架（表现是标题最后两个字被卡片压住）。
- 领句 `.l67-kicker`（16px 宽字距品牌色）说**另一个维度**（口径 / 年份 / 这一页属于哪一段），不许是标题的前半句。
- 标题 64px 衬线白字，**14 个汉字以内**（三行封顶）；`<em>` 转品牌色，一页只标一处。
- `.l67-lead` 一段引言 **3–5 行**（`.l67-figs` 是 `margin-top:auto` 贴底的，2 行时中间会空一大块）。
- `.l67-figs` **正好 2 个数字**（3 个起每个只剩 130px，口径折两行）：`<b>`（44px 白字）+ `<span>`（一行口径 ≤10 字）。整页没有数字可写就整块删掉（V4，引言放到 6 行）。

### 3. 低垂卡片行 · `.l67-cards` / `.l67-card`

- **`bottom:72px` 是硬下限，别再往下推。** 页面下沿那 54px 是 `#footer`，它挂在舞台上、`z-index:50`，比 `.slide` 里的一切都高：卡片伸进去（更别说出血到 1080 之外）之后，页脚那条 hairline 横穿三张卡、主题文字印在第一张卡的白底上、进度条和页码印在最后一张卡上 —— 而页面照旧渲染正常，`checkPage` 和类名校验一处都不会说。72px = 54 + 18 的余量。**section 上也不要加 `has-card`**：那个类是给 L12 让色带溢出 `.card` 用的，加上之后卡片伸到舞台外面的灰台面上，看起来像「这一页排版溢出了」。
- **`.l67-cards` 不许写死 `height`**：高度由内容撑（`align-items:stretch` 让三张卡跟最高那张齐平），`min-height:420px` 只是防止「三条各一行」时卡片矮成三个色块。写死高度的两头都是静默出错 —— 短文案剩一大截空白、长文案把说明的最后一行截在卡外面，而两种画面都完全正常。
- **卡片里不要放 `<img>`。** 这一条的图槽位是 0 个：卡片行是贴底往上长的，塞进去的图会把整行顶到页眉上（而页面照旧渲染正常）。要「上图下文」的三栏卡换 L30。
- `box-shadow` 别删：深底上 `--c-hairline` 那条线**看不见**，投影是卡片唯一「浮起来」的证据。删了之后这一页退回三块贴在深底上的白方块。
- 卡片 **3–4 张**（2 张走 V2 并把 `left` 改到 52%，5 张起每张只剩 190px 宽、小标题会折三行）。

### 4. 外挂圆图标 · `.l67-ico`

- `top:-28px` 让它一半在卡外，所以 **`.l67-card` 不许加 `overflow:hidden`** —— 加了圆图标被削成半圆，而那看起来像是设计本来如此。
- 里面放**序号**（`01`/`02`/`03`）或 2–3 个字的短词（V3）。字色走 `var(--c-brand-on)`，**不许写死白色**：浅色品牌色那几套上白字直接读不出来，而它确实在那儿（见 `designSpec.ts` 的 `PALETTE_VARS` 那段）。
- 位置 `left:30px` 和卡片 `padding-left:30px` 是同一个数，图标和卡内文字**左对齐**。改一个要一起改，不然图标看起来是歪的。

---

## 三、CSS 骨架

```css
.l67-wrap{position:absolute;inset:0;overflow:hidden;background:var(--c-ink-deep)}
.l67-txt{position:absolute;left:var(--pad-x);top:var(--pad-top);bottom:var(--pad-bottom);width:32%;z-index:2;display:flex;flex-direction:column}
.l67-kicker{font-family:var(--num);font-size:16px;font-weight:700;letter-spacing:.2em;color:var(--c-brand)}
.l67-txt .page-title{font-family:var(--serif);font-size:64px;font-weight:900;line-height:1.2;letter-spacing:-.02em;color:#fff;margin-top:20px}
.l67-txt .page-title em{font-style:normal;color:var(--c-brand)}
.l67-lead{margin-top:22px;font-size:19px;line-height:1.85;color:rgba(255,255,255,.72)}
.l67-figs{margin-top:auto;display:flex;gap:44px}
.l67-figs b{display:block;font-family:var(--num);font-size:44px;font-weight:800;line-height:1;letter-spacing:-.02em;color:#fff}
.l67-figs span{display:block;margin-top:10px;font-size:16px;line-height:1.6;color:rgba(255,255,255,.6)}
.l67-cards{position:absolute;left:41%;right:var(--pad-x);bottom:72px;min-height:420px;z-index:2;display:flex;align-items:stretch;gap:26px}
.l67-card{position:relative;flex:1;background:var(--c-card);border-radius:16px;padding:56px 30px 40px;box-shadow:0 24px 60px rgba(0,0,0,.28)}
.l67-ico{position:absolute;top:-28px;left:30px;width:56px;height:56px;border-radius:50%;background:var(--c-brand);color:var(--c-brand-on);font-family:var(--num);font-size:22px;font-weight:800;display:flex;align-items:center;justify-content:center}
.l67-card em{display:block;font-family:var(--num);font-size:14px;font-weight:700;font-style:normal;letter-spacing:.18em;color:var(--c-ink-soft)}
.l67-card b{display:block;margin-top:12px;font-family:var(--num);font-size:34px;font-weight:800;line-height:1.15;letter-spacing:-.02em;color:var(--c-brand)}
.l67-card p{margin-top:16px;font-size:17px;line-height:1.75;color:var(--c-ink)}
```

---

## 四、build-part 结构模板

```html
<section class="slide" data-layout="L67">
  <!-- 全幅：不包 .slide-inner；页眉由代码贴，这里不要写；不要加 has-card -->
  <div class="l67-wrap">
    <div class="l67-txt">
      <div class="l67-kicker">{{领句：口径/年份，不许重复标题}}</div>
      <h1 class="page-title">{{标题，12 个汉字内，可用 <em>一处</em> 强调}}</h1>
      <p class="l67-lead">{{引言 3–5 行}}</p>
      <div class="l67-figs">
        <div><b>{{数字}}</b><span>{{口径，≤10 字}}</span></div>
        <div><b>{{数字}}</b><span>{{口径，≤10 字}}</span></div>
      </div>
    </div>
    <div class="l67-cards">
      <div class="l67-card">
        <div class="l67-ico">01</div>
        <em>{{英文小标签}}</em>
        <b>{{小标题，≤6 字}}</b>
        <p>{{说明，3–5 行；别把卡片底部填满}}</p>
      </div>
      <div class="l67-card">
        <div class="l67-ico">02</div>
        <em>{{英文小标签}}</em>
        <b>{{小标题，≤6 字}}</b>
        <p>{{说明，3–5 行}}</p>
      </div>
      <div class="l67-card">
        <div class="l67-ico">03</div>
        <em>{{英文小标签}}</em>
        <b>{{小标题，≤6 字}}</b>
        <p>{{说明，3–5 行}}</p>
      </div>
    </div>
  </div>
</section>
```

---

## 五、图槽位

**0 个 —— 这一条故意不吃图。** 它存在的理由就是「手上没有可用的图，但这一页要有层级感」：并列页里 L16 / L26 / L30 都要配图，没图时那几格是占位灰，而每张真图还要单独花一次生图的钱。想放图换 L30，别在 `.l67-card` 里加 `<img>`（见第三节最后一条）。

---

## 六、变体

| 编号 | 变化 | 用途 |
|------|------|------|
| V1 | 四张卡（`p` 收到 3 行内、`b` 降到 30px） | 正好四个阶段 |
| V2 | 两张卡 + `.l67-cards` 的 `left` 改 52% | 只有两段，左侧文案可以更宽 |
| V3 | 圆图标里放 2–3 个字的短词而不是序号 | 这几块不是顺序关系 |
| V4 | 去掉 `.l67-figs`（引言放到 6 行） | 这一页没有可写的数字 |
| V5 | 去掉 `.l67-cards` 的 `min-height` | 说明本来就有 6 行以上，不需要那条下限 |
| V6 | `.l67-card b` inline 改 `var(--c-accent-deep)` | 整份里品牌色用得太满，想让卡内小标题退一档 |

---

## 七、design 提示

- **一份里最多一页**：深底 + 低垂卡的存在感很强，第二页会显得整份的节奏被它带走
- **卡片行 `bottom` 至少 72px**：再往下就压到舞台级的 `#footer`（`z-index:50`），页码和主题会印在白卡上，而画面看起来完全正常
- **section 上不要加 `has-card`**：那个类是给 L12 让色带溢出 `.card` 用的，加了之后卡片伸到舞台外面的灰台面上（看起来像「排版溢出了」）
- **`.l67-card` 不许 `overflow:hidden`**：圆图标一半在卡外，加了就被削成半圆
- **页底一律 `var(--c-ink-deep)`**：换成品牌色之后白字在浅色品牌色那几套上全部发飘，而每一页都正常
- **`.l67-cards` 不写 `height`**：写死了短文案空一大块、长文案截掉最后一行，两种都不报错
- **这一页的蒙版（`--veil`）留 0**：底本来就是深的，再压一层黑之后卡片的投影和底融成一片，层级全没了（而画面只是「闷」）
- **配色**：深底上的字写 `#fff` / `rgba(255,255,255,…)`；卡内的字照旧走 `var(--c-ink*)`；品牌色只出现在领句、卡内小标题、圆图标实底（圆图标里的字走 `var(--c-brand-on)`）
- **与 L30 的区别**：L30 是浅底三栏「上图下文」等高卡，**每栏都要一张图**；L67 不吃图，层级靠低垂卡片、外挂图标和深投影
- **与 L19 的区别**：L19 也是深底 + 白卡，但那是贴着底边的三张扁参数卡、主角是中央那张透明底产品图；L67 没有图，卡片就是主角
- **与 L51 的区别**：L51 三档方案卡比的是「选哪一档」（推荐那档挂小旗）；L67 的三张卡是顺序推进的阶段，序号在外挂圆图标上
- **与 L29 / L39 的区别**：那两条也是深底，但它们是金句页和长文页（一整页文字）；L67 是并列页
