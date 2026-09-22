# L66 · `feather-edge-photo-split`（羽化溶图分屏：右侧大图内缘羽化 + 标题跨进羽化区 + 左文 + 底部数据行）

> **📄 详情**：本文件供 design 阶段匹配到 L66 时**必读**。
> **★ 核心原则**：结构是灵魂，颜色/内容不绑死。所有配色必须用 `var(--c-*)` 变量。

---

## 一、结构速览

- **比例**：16:9，浅底（`var(--c-bg)`）+ 右侧一张**没有边界**的大图，文字容量中等（领句 + 标题 + 一段引言 + 2–3 个数据点，约 200–260 字）
- **核心手法**：整库唯一的**羽化溶图** —— 图不是一块矩形，它的**内缘（左边）用 `mask-image` 渐隐成透明**，直接溶进页面浅底；另外三边出血到画面外，所以整张图**一条硬边都没有**。大标题因此可以**跨进羽化区**（那里照片只剩 25% 以内的不透明度，实测导出的 PNG 在图的 28% 处 alpha 64），文字和图交织而不是各占半边。
- **是否全幅**：**是** —— 不包 `.slide-inner`（图要出血到三边，文字块自己绝对定位）
- **底色**：默认不加类（羽化溶的就是 `var(--c-bg)`，换了 deck 底色自动跟着变）
- **什么时候用**：一页里「一句判断 + 一段说明 + 2–3 个数字」并且**有一张能撑起半页的实景图**：趋势判断、行业口径、开篇立论、能力总述、结尾主张
- **导出 pptx**：羽化是**烙进像素的 alpha**（元素截图那条路），pptx 里和网页上同形；代价是这张图从 JPEG 变成透明 PNG，一页大几百 KB

---

## 二、结构拆解（由后到前）

### 1. 羽化图块 · `.l66-img`

- **`mask-image` 只能写在 `<img>` 自己身上。** 导出 pptx 时只有 `<img>` 这种块是截成像素贴的（截完的透明就是透明），羽化因此如实留在 alpha 里。挪到 `.l66-img` 上（它有子节点，走不到截图那条路）之后浏览器里一模一样，而 pptx 里是一整块**硬边矩形图**压在浅底上，那条硬边正好切过标题的最后两个字 —— 每一块都在、位置也对，看起来像「这一版的图被裁小了」。
- **不要改成「图上盖一层从浅到透的渐变」**（L20 那条文带的老做法）：pptx 的形状只有纯色填充，那层渐变退成**渐变的第一个色** = 一整块不透明的浅底盖住图的左半，而降级清单里只有一句轻描淡写的「渐变退成第一个色」。
- **`.l66-img` 自己不许有底色。** 铺了 `var(--c-bg)` 之后浏览器里看不出任何差别（同色），pptx 里那是一块不透明的浅色形状盖在图上，这一页只剩左边一段字。
- 羽化的三段值（`transparent 14%` / `rgba(0,0,0,.5) 42%` / `rgba(0,0,0,1) 66%`）和 `left:32%` 是**配套的**：图从页面 32% 处起，文字块占 44%，右端落在图的 28% 处 ≈ 25% 不透明度（`--pad-x:140px` + 44% 宽 = 右端 985px；实测导出 PNG 那一列 alpha 64）。改了 `left` 忘了改这三个数，要么标题压在浓图上（深墨字压暗照片，只表现成「这一行有点糊」），要么羽化区宽到图只剩一条边（画面上像「图没加载全」）。
- **mask 里那几个色是 alpha，不是颜色 —— 不许换成 `var(--c-*)`。** 全份写成 `rgba(0,0,0,…)` 就是为了这个：遮罩只看透明度通道，换 palette 时这三段一个都不该动；替成某个半透明的品牌色变量之后图整张变淡（浏览器里像「这张图曝光过了」），替成不透明的又白改一遍。
- **图必须是「主体和亮部都在右侧」的实景图**：左三分之一会被羽化掉，主体在左边的图溶完就是一块空景。

### 2. 文案区 · `.l66-txt`

- `left:var(--pad-x)` / `width:44%` / 通高 + flex column。**宽度别超过 46%**：再宽标题就伸到图的浓部（>35% 不透明度），深墨字压在照片上开始读不清。
- 领句 `.l66-kicker`（16px 加宽字距）说**另一个维度**的信息（口径 / 年份 / 数据来源 / 这一页属于哪一类），不许是标题的复制或前半句 —— 想不出来就整行不写。语言不锁：中文英文都行，按这一页的内容定（换中文时把 `letter-spacing` 收到 `.06em` 以内，不然是一行散开的中文）。
- 标题 66px 衬线，**14 个汉字以内**（两行封顶）；`<em>` 转品牌深色，一页只标一处。**只有标题可以跨进羽化区**。
- `.l66-lead` 一段引言 **3–4 行最稳**（数据行是 `margin-top:auto` 贴底的，引言只有 2 行时中间那段留白有 500px 左右，看着像「这一页没写完」；反过来 5 行起会顶到数据行），**`max-width:640px` 不许放宽**：21px 的字最多只能压在 11% 的照片上（右端 780px = 图的 12.7% 处，实测 alpha 29），再宽就糊，而它仍然是一段读得通的话，浏览器、自检清单、导出一处都不会说。
- `.l66-stats` 贴在文案区底部（`margin-top:auto`），**2–3 项**（4 项起每项只剩 160px，标签折成三行顶掉引言）：每项 `<b>`（数字/倍数/百分比，品牌色 46px）+ `<span>`（一行口径 ≤14 字）。上面那条 `border-top` 细线是它和引言的分界，别删。没有数字可写的就整块删掉（引言可放宽到 6 行）。

### 3. 图注 · `.l66-cap`

- **只能贴右下角**，那里是图的**浓部**（66% 之后是全不透明）。挪到左下角会落到羽化成浅底的那一侧 —— 白字在米底上直接看不见，而 HTML、CSS、自检清单 都不会说一个字。
- 底下那块 `rgba(0,0,0,.34)` 圆角小片是承重的：**纯色半透**在 pptx 里是一个带 alpha 的形状（如实还原、客户还能改深浅），**不要换成毛玻璃或渐变** —— 前者 pptx 里只剩一点底色、后者退成第一个色。
- 一行标签（`<b>`，加宽字距）+ **最多两行**说明（`<span>`）。没有可写的就整块删掉。

---

## 三、CSS 骨架

```css
.l66-wrap{position:absolute;inset:0;overflow:hidden;background:var(--c-bg)}
.l66-img{position:absolute;left:32%;right:0;top:0;bottom:0;z-index:0;overflow:hidden}
.l66-img img{width:100%;height:100%;object-fit:cover;display:block;-webkit-mask-image:linear-gradient(90deg,transparent 0,transparent 14%,rgba(0,0,0,.5) 42%,rgba(0,0,0,1) 66%);mask-image:linear-gradient(90deg,transparent 0,transparent 14%,rgba(0,0,0,.5) 42%,rgba(0,0,0,1) 66%)}
.l66-txt{position:absolute;left:var(--pad-x);top:var(--pad-top);bottom:var(--pad-bottom);width:44%;z-index:2;display:flex;flex-direction:column}
.l66-kicker{font-family:var(--num);font-size:16px;font-weight:700;letter-spacing:.22em;color:var(--c-brand-deep)}
.l66-rule{width:64px;height:4px;background:var(--c-brand);margin:22px 0 26px}
.l66-txt .page-title{font-family:var(--serif);font-size:66px;font-weight:900;line-height:1.16;letter-spacing:-.02em;color:var(--c-ink-deep);margin-top:0}
.l66-txt .page-title em{font-style:normal;color:var(--c-brand-deep)}
.l66-lead{margin-top:26px;max-width:640px;font-size:21px;line-height:1.85;color:var(--c-ink)}
.l66-stats{margin-top:auto;max-width:700px;padding-top:26px;border-top:1px solid var(--c-hairline);display:flex;gap:56px}
.l66-stats b{display:block;font-family:var(--num);font-size:46px;font-weight:800;line-height:1;letter-spacing:-.02em;color:var(--c-brand)}
.l66-stats span{display:block;margin-top:10px;font-size:17px;line-height:1.6;color:var(--c-ink-soft)}
.l66-cap{position:absolute;right:var(--pad-x);bottom:var(--pad-bottom);max-width:420px;z-index:2;text-align:right;background:rgba(0,0,0,.34);border-radius:8px;padding:14px 20px}
.l66-cap b{display:block;font-family:var(--num);font-size:14px;font-weight:700;letter-spacing:.24em;color:#fff}
.l66-cap span{display:block;margin-top:8px;font-size:17px;line-height:1.6;color:rgba(255,255,255,.86)}
```

---

## 四、build-part 结构模板

```html
<section class="slide" data-layout="L66">
  <!-- 全幅：不包 .slide-inner；页眉由代码贴，这里不要写 -->
  <div class="l66-wrap">
    <div class="l66-img">
      <img src="/ppt-cases/ph-16x9.svg" alt="" data-img-prompt="这张图要什么（中文一句话，主体和亮部都在画面右侧，左三分之一可以是暗背景）" data-img-mode="case">
    </div>
    <div class="l66-txt">
      <div class="l66-kicker">{{领句：口径/年份/数据来源，不许重复标题}}</div>
      <div class="l66-rule"></div>
      <h1 class="page-title">{{标题，14 个汉字内，可用 <em>一处</em> 强调}}</h1>
      <p class="l66-lead">{{引言 2–4 行}}</p>
      <div class="l66-stats">
        <div><b>{{数字}}</b><span>{{口径，≤14 字}}</span></div>
        <div><b>{{数字}}</b><span>{{口径，≤14 字}}</span></div>
        <div><b>{{数字}}</b><span>{{口径，≤14 字}}</span></div>
      </div>
    </div>
    <div class="l66-cap">
      <b>{{图注标签}}</b>
      <span>{{图注说明，最多两行}}</span>
    </div>
  </div>
</section>
```

---

## 五、图槽位

| 槽位 | 必填? | 模式 | 比例 | 构图要求 |
|------|-------|------|------|----------|
| `pXX_side` | **必填**（`.l66-img` 不自带底色，不放图右半就是一片空白浅底） | case | 16:9 | 左三分之一会被羽化掉：**主体和亮部都在画面右侧**；**右下角要压得深**（图注是白字，虽然有半透黑小片托底，亮图上仍然发灰）；不要带文字/水印的图、不要人脸贴左边 |

**禁用**：主体在左侧的图（羽化完是一块空景）、整张高调发白的图（羽化边缘看不出溶进去、图注也压不住）、带文字的图

---

## 六、变体

| 编号 | 变化 | 用途 |
|------|------|------|
| V1 | 整体镜像（`.l66-img` 改 `left:0;right:32%`、mask 换成 `270deg`、文字块和图注左右对调） | 同一份里已经出现过左文右图 |
| V2 | 羽化更宽（`transparent 26%` / `rgba(0,0,0,.5) 56%` / `rgba(0,0,0,1) 78%`，文字块可放到 48%） | 图只当氛围底，文字是主角 |
| V3 | 去掉 `.l66-stats`（引言放到 5–6 行） | 这一页是一段陈述而不是带数字的判断 |
| V4 | 去掉 `.l66-cap` | 图是概念场景、没有可交代的出处 |
| V5 | `.l66-rule` inline 改 `var(--c-accent)`，或整条删掉 | 整份禁用双色 / 想更素 |
| V6 | 数据点改 2 项、`b` inline 提到 56px | 只有两个数字，但要更有分量 |

---

## 七、design 提示

- **一份里最多两页**，且别连着排：同一条羽化边出现两次就成了模板感（第二页换 V1 镜像会好一些）
- **`mask-image` 只能写在 `<img>` 上**：挪到 `.l66-img` 上之后浏览器里一模一样，导出 pptx 是一块硬边矩形图，硬边切过标题最后两个字（看起来像「图被裁小了」）
- **别用「渐变遮罩」代替 mask**：pptx 的形状没有渐变填充，那层渐变会退成第一个色 = 一整块不透明浅底盖住图的左半
- **文字块宽度别超过 46%、引言 `max-width:640px` 不许放宽**：标题跨进羽化区是这条版式的签名，正文跨进去只是「这几行有点糊」
- **这一页的蒙版（`--veil`）留 0**：那层黑压在图之上、字之下，拉高之后浅底那半也一起变灰，羽化成了一道脏边
- **图注只能在右下角**：挪到左边会落在羽化成浅底的那一侧，白字直接看不见
- **配色**：左侧文字走 `var(--c-ink-deep)` / `var(--c-ink)`（它们落在浅底上）；压在图浓部的图注直接写 `#fff` / `rgba(255,255,255,…)`
- **语言不锁**：领句、图注标签写中文还是英文按这一页的内容定，不要为了「看起来像模板」硬翻一句英文
- **与 L1 / L3 的区别**：那两条是规整的矩形分栏（54/46、左文右图），边界是一条直线；L66 没有边界 —— 图溶进纸里
- **与 L20 的区别**：L20 也是「文少图多」，但它靠**图上盖一层浅色渐变**做过渡（pptx 里退成一整块浅底）；L66 的过渡在图自己的 alpha 里，导出后同形
- **与 L40 的区别**：L40 是 `clip-path` 斜切（硬的斜边，有速度感）；L66 是软的羽化边（安静、编辑感）
- **与 L21 的区别**：L21 是**深底全幅**图上浮白字（整页压 38% 黑）；L66 的字全在浅底上，图只占右半
