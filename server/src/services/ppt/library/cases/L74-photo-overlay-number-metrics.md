# L74 · `photo-overlay-number-metrics`（整页实景图 + 左栏序号标头 + 巨标题 + 一段说明 + 底部一排指标，全是白字压在图上）

> **📄 详情**：本文件供 design 阶段匹配到 L74 时**必读**。
> **★ 核心原则**：结构是灵魂，颜色/内容不绑死。所有配色必须用 `var(--c-*)` 变量。

---

## 一、结构速览

- **比例**：16:9，一张铺满整页的**暗调**实景图（版式不再压暗）+ 左栏一列白字，文字容量偏小（标头 + 标题 + 一段说明 + 3 个数字，约 140–200 字）
- **核心手法**：**整页一张图，文字不占格子** —— 左边那一列（52% 宽）从上到下分成三段：标头贴顶、标题居中、指标贴底（两个 `margin-top:auto` 撑开）。图的右半留给画面主体，文字和主体不抢位置。
- **是否全幅**：**是** —— 两层都装在 `.l74-wrap` 里，`.l74-txt` 自己绝对定位，**不包 `.slide-inner`**（理由见 §七第一条，不是为了出血）
- **什么时候用**：一页「一句主张 + 一段自我介绍 + 三个能撑门面的数字」：关于我们、公司/团队简介、能力总述、开篇立论、结尾主张
- **图槽位**：**1 个（必填）** —— `.l74-bg` 铺满整页的实景图（`16:9`，**暗调、主体和亮部在画面右侧**）
- **导出 pptx**：一张全幅图 + 一层带 alpha 的黑矩形 + 文字，保真；`text-shadow` 会丢（pptx 的文字没有投影），所以**图本身必须是暗的**，别指望投影救亮图

---

## 二、结构拆解（由后到前）

### 1. 整页图 · `.l74-bg`

- **必填**。这一层自带 `background:var(--c-ink-deep)` 深底，而且**占位图阶段单独压到 `.22`**
  （`img[src^="/ppt-cases/ph-"]`）：没有这两条的话，还没配图的这一页是一张浅灰占位图上压一列
  白字 = 一片空白，每个字都在、一处都不报错，看起来像「这个版式渲染塌了」。
- **图上没有蒙版了**：原来 `::after` 那层烙死的 `rgba(0,0,0,.42)` 已删 —— 它和「这一页的蒙版」
  滑块叠起来是 59% 的黑，投出来整本发灰。压暗只剩那个滑块（`--veil`，在 `z-index:1`，压得到图、
  压不到 `z-index:2` 的 `.l74-txt` —— `.l74-wrap` 不写 z-index 就是为了让它还能插在这两层中间），
  **而它缺省 0**：所以**图本身必须是暗的**（生图提示里「暗调/逆光/夜景」是承重的），亮图进来
  就是白字压在亮部上、投影到会议室墙上才发现读不出来。读不清时把滑块拉到 20–35%。
- **图必须是暗调的，主体和亮部都在右侧**：左 52% 是文字区。主体在左边的图被文字盖掉一半，
  高调发白的图（雪景、白墙、晴天大面积天空）没有任何一层帮着压，白字直接读不出来。

### 2. 序号标头 · `.num-kicker`（共用件）

- 三样东西：`<b>` 两位序号（64px 等宽数字）+ `<i></i>` 一条竖线 + `<span>` 里 `<em>` 英文标签
  与 `<small>` 中文小标。**颜色全部继承**（竖线是 `currentColor`）—— 这一族里有压在暗图上的
  白字页，也有浅底上的墨字页，写死白色的话浅底那一页上竖线直接消失。
- 序号是**这一页在稿子里的位置**（章节序号或页序），不是随手写的装饰。它由**代码/提纲决定**，
  想不出来就整个 `<b>` 不写（标签和竖线照旧成立）—— 编一个「05」出来的话它和页脚、目录上的
  序号对不上，而那一页读起来完全正常。
- `<em>` 英文标签一到三个词（`ABOUT US` / `OUR EDGE` / `WHAT WE DO`），`<small>` 中文 ≤6 字。
  两者是**同一件事的两种语言**，不是两条信息；也不许是下面大标题的复制（那是 `checkPage` ⑧）。

### 3. 标题与说明 · `.page-title` / `.l74-bar` / `.l74-rule` / `.l74-lead`

- 标题 60px 衬线，**16 个汉字以内**（两行封顶）。中间想断一下用 `<i class="l74-bar"></i>`（那条
  细竖线），**别打一个真的 `|` 字符**：那是等宽字体里一根和字同高的粗杠，行距也被顶开。
- `.l74-rule` 是标题和说明之间那条 1px 白线（`max-width:560px`）。删掉整行也成立（V3），
  但别把它改成品牌色粗线 —— 这一页只有一条视觉主线（那张图），再加一块饱和色就打架。
- `.l74-lead` 一段说明 **3–5 行**（`max-width:780px`）：2 行时标题和指标之间会空出一大块
  （看着像「这一页没写完」），6 行起顶到指标那一排上。

### 4. 指标 · `.metric-row`（共用件）

- **小标在上、大数字在下**，2–4 项（每项 `<span>` 口径 ≤8 字 + `<b>` 数字 ≤6 字符）。
  反过来排（数字在上）之后这一排和 L66 的 `.l66-stats` 一模一样，而「先说口径再报数」是
  这一族的签名。
- 5 项起每项只剩 160px，口径折成三行把说明顶上去 —— 而每一项单看都排得下。
- 没有数字可写就整块删掉（说明可放宽到 7 行，V4）。

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
.l74-wrap{position:absolute;inset:0;overflow:hidden}
.l74-bg{position:absolute;inset:0;z-index:0;overflow:hidden;background:var(--c-ink-deep)}
.l74-bg img{width:100%;height:100%;object-fit:cover;display:block}
.l74-txt{position:absolute;left:var(--pad-x);top:var(--pad-top);bottom:var(--pad-bottom);width:52%;z-index:2;display:flex;flex-direction:column;color:#fff;text-shadow:0 2px 16px rgba(0,0,0,.5)}
.l74-txt .page-title{margin-top:auto;font-family:var(--serif);font-size:60px;font-weight:900;line-height:1.2;letter-spacing:-.02em;color:#fff}
.l74-bar{display:inline-block;width:2px;height:.72em;margin:0 20px;background:currentColor;opacity:.5}
.l74-rule{width:100%;max-width:560px;height:1px;background:rgba(255,255,255,.34);margin:30px 0 26px}
.l74-lead{max-width:780px;font-size:20px;line-height:1.9;color:rgba(255,255,255,.82)}
```

---

## 四、build-part 结构模板

```html
<section class="slide" data-layout="L74">
  <!-- 全幅：两层都在 .l74-wrap 里，**不要 .slide-inner**（包了的话这一格的生图提示词
       会变成「不要主体、只要质感」，见 §七第一条）；页眉由代码贴，这里不要写 -->
  <div class="l74-wrap">
    <div class="l74-bg">
      <img src="/ppt-cases/ph-16x9.svg" alt="" data-img-prompt="{{这张图要什么：暗调实景，主体和亮部都在画面右侧，左半留成深色}}" data-img-mode="case">
    </div>
    <div class="l74-txt">
      <div class="num-kicker">
        <b>{{两位序号，如 02；想不出来就整个 b 不写}}</b>
        <i></i>
        <span>
          <em>{{英文标签，1–3 个词}}</em>
          <small>{{中文小标，≤6 字}}</small>
        </span>
      </div>
      <h1 class="page-title">{{标题前半句}}<i class="l74-bar"></i>{{后半句}}</h1>
      <div class="l74-rule"></div>
      <p class="l74-lead">{{一段说明，3–5 行}}</p>
      <div class="metric-row">
        <div><span>{{口径，≤8 字}}</span><b>{{数字，≤6 字符}}</b></div>
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
| `pXX_bg` | **必填**（不放图时这一页是深底白字，读得清但明显缺一张图） | case | 16:9 | **暗调**；主体和亮部都在**画面右侧**（左 52% 被文字占着）；左上角要压深（页眉那行彩色字压在上面）；不要带文字/水印；不要人脸贴左边 |

**禁用**：高调发白的图（雪景、白墙、大片晴空 —— 压完 42% 还是浅的，白字读不出来）、主体在左侧的图（被文字盖掉一半）、拼贴/多图格子（整页只有一张图）

---

## 六、变体

| 编号 | 变化 | 用途 |
|------|------|------|
| V1 | 整体靠右（`.l74-txt` inline 加 `left:auto;right:var(--pad-x);text-align:right`；**不是** `margin-left:auto` —— 它是绝对定位的，写 margin 一点反应都没有） | 图的主体在左侧 |
| V2 | 去掉 `<b>` 序号，只留竖线 + 双语标签 | 这一页不在编号序列里 |
| V3 | 去掉 `.l74-rule` | 想更素 / 标题已经两行 |
| V4 | 去掉 `.metric-row`（说明放到 6–7 行） | 这一页没有数字 |
| V5 | 指标改 2 项、`b` inline 提到 64px | 只有两个数字但要更有分量 |

---

## 七、design 提示

- **不许把这两层包进 `.slide-inner`**（哪怕包了照样好看）：`imageSpace` 估留白时只收「不是图的
  祖先」的文字块，而 `.slide-inner` 和图那一层是**兄弟** —— 它整块被算成一片覆盖 70% 的文字，
  这一格于是判成 `most`，发给生图的那句话变成「整幅都被文字压住，不要单一的视觉焦点，给一片
  均匀低反差的质感」，回来一张抽象肌理图，而这一页要的正是主体在右侧的实景照片。页面排得
  好好的、接口 200，一处都不会说，他只会一张张重生（每张真扣一次额度）。装进 `.l74-wrap`
  之后被收的是 `.l74-txt`，判出来才是 `left`；wrap 自己**不许写 z-index**（不然 `--veil` 压不到图）
- **图必填、且必须暗**：`.l74-bg` 的深底和占位图那条 `.22` 只保证「没配图时也读得清」，真配了一张
  高调发白的图之后，白字压在亮部上直接读不出来，而每个字都在、导出也正常
- **图的左上角要压得深**：页眉那行模块名由代码贴，颜色写死 `var(--c-accent-deep)`（一个中等明度
  的彩色），落在图的亮部上就读不出来 —— 而它不在这份结构里，检查这一页时根本想不到它
- **`--veil` 现在是唯一的压暗手段，而它缺省 0**（版式那层 `.42` 的黑已删）：所以承重的是**选图**，
  一张亮图 + 没拉过滑块 = 白字压亮图，而那一页每个字都在、一处不报错
- **`text-shadow` 不许删**：亮部落在哪一行是生图那一刻才定的，删了之后现象是「有时候某一行读不清」，
  重新生成一张图又好了 —— 指不到版式上（pptx 里没有这层投影，所以图本身必须暗）
- **文字区别超过 56%**（缺省 52%）：再宽标题就伸到图的主体上，白字压在亮主体上只表现成
  「这一行有点糊」；而且宽过 60% 之后 `imageSpace` 会把这一格判成 `most`，又回到上面那种抽象图
- **两个 `margin-top:auto`（标题 + 指标）不许换成 `justify-content:space-between`**：那会把细线和
  说明也拆开，这一页变成四块散在竖向上的字
- **配色**：这一页的字**直接写 `#fff` / `rgba(255,255,255,…)`**（同 L19/L21），不要用 `var(--c-ink*)`
  —— 那几个是深色，压在暗图上等于隐形
- **序号不许编**：它是这一页在稿子里的位置（章节序号/页序），编一个出来和页脚、目录对不上，
  而这一页读起来完全正常
- **一份里最多两页**，且别连着排（同一张暗图铺满的构图出现两次就是模板感）
- **与 L21 的区别**：L21 要**中央透视**的图 + 左文右数据两块分置、整体垂直居中；L74 的图主体在右，
  文字是**一列**（标头/标题/指标从上到下），且指标是「口径在上、数字在下」
- **与 L2 / L23 的区别**：那两条的背景图刷的是**浅色幕帘**（`--mask-rgb`，深墨字压在洗白的图上）；
  L74 是反的 —— 图留着暗，字是白的
- **与 L75 的区别**：L75 的字装在一块半透明深色玻璃面板里（面板通高贴右），图整幅都露着；
  L74 的字直接压在图上，靠**图自己暗**托底（版式不压）
