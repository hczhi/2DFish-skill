# L76 · `slant-photo-light-metrics`（浅底页：左栏序号标头 + 标题 + 细线 + 一段说明 + 一排指标，右侧一张斜切的明调实景图出血到三边）

> **📄 详情**：本文件供 design 阶段匹配到 L76 时**必读**。
> **★ 核心原则**：结构是灵魂，颜色/内容不绑死。所有配色必须用 `var(--c-*)` 变量。

---

## 一、结构速览

- **比例**：16:9，浅底（`var(--c-bg)`）+ 左栏 34% 一列墨字 + 右侧一张**不压暗**的实景图，图的左边界是一条斜线（顶部 46%、底部 58%），右/上/下三边出血
- **核心手法**：**这一族的浅底那一版** —— 标头、标题、指标三件套和 L74/L75 一模一样（`.num-kicker` / `.metric-row` 靠 `color:var(--c-ink-deep)` 继承成墨色），图不再当底、退到右边当一块斜切的图版；图上**一个字都不放**，所以照片可以是明亮的原色调。
- **是否全幅**：**是** —— 图和文字都在 `.l76-wrap` 里、文字自己绝对定位，**不包 `.slide-inner`**（同 L74/L75）
- **什么时候用**：一页「一句主张 + 一段自我介绍 + 三个数字」，而手里那张照片**舍不得压暗**（山景、车间、门店、产品实拍）：关于我们、团队/工厂简介、能力总述
- **图槽位**：**1 个（必填）** —— `.l76-img` 斜切的实景图（`16:9`，**主体必须在画面右半**，左边会被斜线切掉）
- **导出 pptx**：斜边长在 `<img>` 自己身上，截图时如实留在像素里（见 §七第一条）

---

## 二、结构拆解（由后到前）

### 1. 浅底 · `.l76-wrap`

- `background:var(--c-bg)` 是这一页的底色（不是白卡）。整页只有这一块底 + 一张图 + 一列字，
  别再往左栏加卡片/色块（这一条的对比全靠那条斜边）。

### 2. 斜切图 · `.l76-img` / `.l76-img img`

- **必填**。斜边是 `clip-path:polygon(100% 0,46% 0,58% 100%,100% 100%)`：顶边从 46% 开始、
  底边从 58% 开始（上宽下窄），所以左栏底部那一排指标不会撞到斜边。
- **`clip-path` 必须写在 `<img>` 自己身上**，不许挪到 `.l76-img` 上（同 `.l40-img img`）：导出 pptx
  时只有 `<img>` 这种块是截成像素贴的（截完 `omitBackground`，裁掉的那部分是透明），斜边才会
  如实留在像素里。写到外层容器上的话它有子节点、走不到截图那条路 —— pptx 里是一张**满幅**
  照片压掉左边的浅色文字区，深墨字落在照片上，每一块都在、位置也对，看起来像「这一版设计
  成了照片底」。
- **图不压暗**（没有 `filter`、没有蒙版层），所以**图上一个字都不许写**。照 L40 加一层
  `brightness(.55)` 的话这一页多出一块灰绿的暗照片，画面完全正常 —— 只是不再是「明调实景」那一版。
- **主体必须在画面右半**：`object-fit:cover` 铺的是整幅 1920×1080，左边那块被斜线切掉，
  主体在左的图进来之后露出来的是背景，这一页照样完整、只是「这张图看着是空的」。

### 3. 左栏 · `.l76-txt`

- `left:var(--pad-x);top:var(--pad-top);bottom:var(--pad-bottom);width:34%`（653px），从上到下
  三段：`.num-kicker` 贴顶 → 标题（`margin-top:auto` 撑到中间）+ `.l76-rule` + `.l76-lead`
  → `.metric-row` 贴底。
- **别超过 38%**：图的左边界在顶部就是 46%（883px），再宽标题最后一行伸到斜边上 —— 浅底的
  墨字压在照片上只表现成「这一行有点糊」；而且过 60% 之后 `computeSpaceHints` 把这一格判成
  `most`，生图只回一片没有主体的抽象质感。
- 两个 `margin-top:auto`（标题 + 指标）**不许换成 `justify-content:space-between`**：那会把细线和
  说明也拆开，左栏变成四块散在竖向上的字。

### 4. 标头 / 标题 / 细线 / 说明 / 指标

- `.num-kicker` 共用件，**颜色全部继承**（这里是 `var(--c-ink-deep)`，竖线是 `currentColor`）。
  在这里另抄一套 `.l76-num` 的话改了 L74 这一页照旧，而两页单看都正常。
- 序号是**这一页在稿子里的位置**（章节序号/页序），**不许编**（编一个和页脚、目录对不上，
  而这一页读起来完全正常）；`<em>` 英文 1–3 个词、`<small>` 中文 ≤6 字，也不许是大标题的复制。
- 标题 56px 衬线、**一行 ≤11 个汉字、最多两行**（653px 宽）。
- `.l76-rule` 是标题和说明之间那条 1px `var(--c-hairline)`（删掉也成立，V3）。
- `.l76-lead` 3–5 行。`.metric-row` **2–3 项**（左栏里 `gap:44px`、数字 46px 品牌深色）。

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
.l76-wrap{position:absolute;inset:0;overflow:hidden;background:var(--c-bg)}
.l76-img{position:absolute;inset:0;z-index:0;overflow:hidden}
.l76-img img{width:100%;height:100%;object-fit:cover;display:block;clip-path:polygon(100% 0,46% 0,58% 100%,100% 100%)}
.l76-txt{position:absolute;left:var(--pad-x);top:var(--pad-top);bottom:var(--pad-bottom);width:34%;z-index:2;display:flex;flex-direction:column;color:var(--c-ink-deep)}
.l76-txt .page-title{margin-top:auto;font-family:var(--serif);font-size:56px;font-weight:900;line-height:1.2;letter-spacing:-.02em;color:var(--c-ink-deep)}
.l76-rule{width:100%;max-width:420px;height:1px;background:var(--c-hairline);margin:28px 0 24px}
.l76-lead{font-size:20px;line-height:1.9;color:var(--c-ink)}
.l76-txt .metric-row{gap:44px}
.l76-txt .metric-row b{font-size:46px;color:var(--c-brand-deep)}
```

---

## 四、build-part 结构模板

```html
<section class="slide" data-layout="L76">
  <!-- 全幅：图和文字都在 .l76-wrap 里，**不要 .slide-inner**；页眉由代码贴，这里不要写。
       clip-path 在 template.html 里长在 <img> 上，这里一句 style 都不要写 -->
  <div class="l76-wrap">
    <div class="l76-img">
      <img src="/ppt-cases/ph-16x9.svg" alt="" data-img-prompt="{{这张图要什么：明亮的实景，主体和亮部都在画面右半，不要压暗}}" data-img-mode="case">
    </div>
    <div class="l76-txt">
      <div class="num-kicker">
        <b>{{两位序号，如 01；想不出来就整个 b 不写}}</b>
        <i></i>
        <span>
          <em>{{英文标签，1–3 个词}}</em>
          <small>{{中文小标，≤6 字}}</small>
        </span>
      </div>
      <h1 class="page-title">{{标题，≤11 个汉字}}</h1>
      <div class="l76-rule"></div>
      <p class="l76-lead">{{一段说明，3–5 行}}</p>
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
| `pXX_bg` | **必填**（不放图时右半是一块浅底 + 一条斜边，明显缺一张图） | case | 16:9 | **主体和亮部都在画面右半**（左边被斜线切掉）；**明调**（这一条不压暗，图上没有字）；不要带文字/水印 |

**禁用**：主体在左半的图（被斜线切掉，露出来的是背景，这一页看起来像「图是空的」）、已经压得很暗的图（浅底页上一块死黑）、拼贴/多图格子

---

## 六、变体

| 编号 | 变化 | 用途 |
|------|------|------|
| V1 | 左右对调（`.l76-img img` inline 改 `clip-path:polygon(0 0,54% 0,42% 100%,0 100%)`、`.l76-txt` inline 加 `left:auto;right:var(--pad-x)`） | 照片主体在左半 |
| V2 | 去掉 `<b>` 序号，只留竖线 + 双语标签 | 这一页不在编号序列里 |
| V3 | 去掉 `.l76-rule` | 想更素 / 标题已经两行 |
| V4 | 去掉 `.metric-row`（说明放到 6–7 行） | 这一页没有数字 |
| V5 | 斜边站直（inline `clip-path:polygon(100% 0,50% 0,50% 100%,100% 100%)`） | 要一条规矩的竖分割线 |

---

## 七、design 提示

- **`clip-path` 长在 `<img>` 自己身上，不许挪到 `.l76-img` 上**：导出 pptx 时只有 `<img>` 是截成
  像素贴的（裁掉的部分是透明），斜边才会留在像素里；写到外层的话 pptx 里是一张满幅照片压掉
  左边的文字区，深墨字落在照片上 —— 每一块都在、位置也对，看起来像「这一版设计成了照片底」
- **不许把这两层包进 `.slide-inner`**：`imageSpace` 收文字块时跳过图的祖先，而 `.slide-inner`
  和图那一层是**兄弟** —— 它整块被算成一片覆盖 70% 的文字，这一格判成 `most`，生图提示词变成
  「不要单一的视觉焦点，给一片均匀低反差的质感」，回来一张抽象肌理图，而这一页要的是主体在右半
  的实景照片。页面完全正常、接口 200，他只会一张张重生（每张真扣一次额度）
- **这一条的图不压暗，图上一个字都不许写**：加了 `filter:brightness()` 之后浅底页上多一块灰暗的
  照片，画面完全正常、只是不再是这一条要的那一版；反过来往图上放白字的话，明调实景一压就没了
- **文字列别超过 38%**（缺省 34%）：图的左边界在顶部是 46%，再宽标题最后一行伸到斜边上，
  墨字压在照片上只表现成「这一行有点糊」；过 60% 之后 `imageSpace` 又把这一格判成 `most`
- **照片主体必须在右半**：左边被斜线切掉，主体在左的图进来之后露出来的是背景，
  这一页照样完整，只是「这张图看着是空的」
- **两个 `margin-top:auto`（标题 + 指标）不许换成 `justify-content:space-between`**：细线和说明
  会被一起拆开，左栏变成四块散在竖向上的字
- **`.num-kicker` / `.metric-row` 不许在这里另抄一套**（`.l76-num` 那种）：颜色靠 `.l76-txt` 上
  那句 `color:var(--c-ink-deep)` 继承，抄一套之后改了 L74 这一页照旧，而两页单看都正常
- **序号不许编**（它是这一页在稿子里的位置，编一个和页脚、目录对不上而页面完全正常）
- **配色**：这一页是浅底墨字，**不要**照 L74/L75 写 `#fff`（白字落在浅底上等于隐形）
- **一份里最多两页**
- **与 L40 的区别**：L40 也是斜切分屏，但它把图 `brightness(.55)` 压暗、右下角压一段白色图注、
  还有一条品牌色渐变高光贴在斜边上（`.l40-edge`），左栏是「领句 + 三条编号要点」；L76 的图是
  明调原色、图上没有字、没有那条高光，左栏是这一族的「序号双语标头 + 标题 + 一排指标」。
  手里那张照片**舍不得压暗**、又要报三个数字时选 L76，要三条编号要点时选 L40
- **与 L74 / L75 的区别**：那两条的图是整页的底（白字压在图上 / 装在通高深色面板里）；
  L76 的图退到右边当图版，整页是浅底墨字
