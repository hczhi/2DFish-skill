# L40 · `diagonal-split-photo-text`（斜切分屏：clip-path 对角线 + 左文右图 + 斜线渐变高光）

> **📄 详情**：本文件供 design 阶段匹配到 L40 时**必读**。
> **★ 核心原则**：结构是灵魂，颜色/内容不绑死。所有配色必须用 `var(--c-*)` 变量。

---

## 一、结构速览

- **比例**：16:9，浅底（`var(--c-bg)`）+ 右侧一块**被斜切**的暗图，文字容量中等（标题 + 一段引言 + 3 条要点，约 260–320 字）
- **核心手法**：整库唯一的**斜切分屏** —— 图不是矩形的半幅，而是 `clip-path:polygon(100% 0,52% 0,66% 100%,100% 100%)`（写在 `<img>` **自己身上**）切出来的一块斜梯形；那条斜边上再压一条 3px 的品牌→accent 渐变高光（`.l40-edge`，`left:59%` + `rotate(-14deg)`）
- **是否全幅**：**是** —— 不包 `.slide-inner`（斜切块要铺满上下边，文字块自己绝对定位）
- **底色**：默认不加类
- **什么时候用**：一页里「一句判断 + 三条支撑」并且**有一张能撑起半页的实景图**：方案开篇、单个案例、能力介绍、合作说明

---

## 二、结构拆解（由后到前）

### 1. 斜切图块 · `.l40-img`

- `clip-path` 的四个点：右上 → 顶边 52% → 底边 66% → 右下。**顶边比底边靠左**，于是斜边是「上宽下窄」，左侧文字区在底部反而更宽。
- **斜切和压暗都写在 `.l40-img img` 上，外面那个 `.l40-img` 是没有底色、没有遮罩的空壳。** 导出 pptx 时只有 `<img>` 这种块是截成像素贴的（截完裁掉的部分就是透明），斜边因此如实留在像素里。
  把 `clip-path` 挪回 `.l40-img`（它有子节点，走不到截图那条路）之后，pptx 里是**一整块满幅暗底 + 一张满幅照片**压掉左边的浅色文字区，深墨标题落在照片上 —— 每一块都在、位置也对，看起来像「这一版设计成了暗底」。
- 压暗用 `filter:brightness(.55)`（不写成 `.l40-img::after` 那层 45% 黑）：那层遮罩是 `.l40-img` 的孩子，不在 `<img>` 的截图范围里，到了 pptx 就成了一层盖满整页的黑。`brightness(.55)` 和 45% 黑逐像素等价（都是乘 0.55），差别只在它跟着裁剪一起烙进像素。图注是白字，右下角必须压得住。
- **这一页的图是必填的**：`.l40-img` 不再自带底色，不放 `<img>` 的话右半是一片空白（浅底上什么都没有），而页面照旧渲染、一处不报错。没有能用的实景图就换 L1 / L3。

### 2. 斜边高光 · `.l40-edge`

- **它和 `clip-path` 是同一条线的两份表达，必须一起改。** `left:59%` 是那条斜边的中点（(52+66)/2），`rotate(-14deg)` 是它的斜率（`atan(268.8/1080)`）。
- 改了 `clip-path` 的百分比忘了改这里，画面上是**两条错开几十像素的斜线**（一条颜色边界、一条渐变高光）—— 看起来像"这个版式设计成双线"，一处都不报错。
- `top:-8%;bottom:-8%` 是给旋转留的余量：写成 `top:0;bottom:0` 的话旋转后上下两端各缩进 130px，斜线中间一段有高光、两头没有。

### 3. 文字区 · `.l40-txt`

- `left:var(--pad-x)` / `width:40%` / 通高 + `justify-content:center` 垂直居中。**宽度别超过 42%**：顶边的图从 52% 开始，44% 起标题的长句就会伸到图上（黑图上的深墨字，只表现成"这一行有点糊"）。
- 标题 62px 衬线，**12 个汉字以内**（两行封顶）；`<em>` 转品牌深色，一页只标一处。
- `.l40-lead` 一段引言，2–4 行。再多的话下面三条会被挤到底部安全线以外（这一块是垂直居中的，超了从上下两端一起溢出）。
- `.l40-list` 3 条（**最多 4 条**）：每条 `<b>`（编号/年份/短标签，`var(--num)` 品牌色）+ `<span>`（一行说明）。上面那条 `border-top` 细线是它和引言的分界，别删。

### 4. 图注 · `.l40-cap`

- **只能贴右下角。** 挪到左下角会落到斜边的浅底那一侧 —— 白字在米底上直接看不见，而 HTML、CSS、自检清单 都不会说一个字。
- `text-align:right` 是承重的：左对齐时长句的左端会越过斜边跑到浅底上，同一句话前半截看不见、后半截正常。
- 一行标签（`<b>`，加宽字距品牌色）+ **最多两行**说明（`<span>`）。没有可写的就整块删掉。

---

## 三、CSS 骨架

```css
/* L40 斜切分屏：clip-path 对角线 + 左文右图（全幅） */
.l40-wrap{position:absolute;inset:0;overflow:hidden;background:var(--c-bg)}
.l40-img{position:absolute;inset:0;z-index:0;overflow:hidden}
.l40-img img{width:100%;height:100%;object-fit:cover;display:block;clip-path:polygon(100% 0,52% 0,66% 100%,100% 100%);filter:brightness(.55)}
.l40-edge{position:absolute;top:-8%;bottom:-8%;left:59%;width:3px;z-index:1;transform:rotate(-14deg);background:linear-gradient(180deg,var(--c-brand),var(--c-accent))}
.l40-txt{position:absolute;left:var(--pad-x);top:var(--pad-top);bottom:var(--pad-bottom);width:40%;z-index:2;display:flex;flex-direction:column;justify-content:center}
.l40-txt .page-title{font-family:var(--serif);font-size:62px;font-weight:900;line-height:1.18;letter-spacing:-.02em;color:var(--c-ink-deep);margin-top:0}
.l40-txt .page-title em{font-style:normal;color:var(--c-brand-deep)}
.l40-lead{margin-top:24px;font-size:22px;line-height:1.8;color:var(--c-ink)}
.l40-list{margin-top:34px;display:flex;flex-direction:column;gap:20px;padding-top:26px;border-top:1px solid var(--c-hairline)}
.l40-list div{display:flex;gap:18px;align-items:baseline}
.l40-list b{flex:none;font-family:var(--num);font-size:19px;font-weight:800;letter-spacing:.06em;color:var(--c-brand)}
.l40-list span{font-size:20px;line-height:1.7;color:var(--c-ink-deep)}
.l40-cap{position:absolute;right:var(--pad-x);bottom:var(--pad-bottom);max-width:420px;z-index:2;text-align:right}
.l40-cap b{display:block;font-family:var(--num);font-size:14px;font-weight:700;letter-spacing:.24em;color:var(--c-brand);margin-bottom:10px}
.l40-cap span{display:block;font-size:19px;line-height:1.65;color:rgba(255,255,255,.86)}
```

---

## 四、build-part 结构模板

```html
<section class="slide" data-layout="L40">
  <!-- 全幅：不包 .slide-inner；页眉由代码贴，这里不要写 -->
  <div class="l40-wrap">
    <div class="l40-img">
      <img src="/ppt-cases/ph-16x9.svg" alt="" data-img-prompt="这块斜切图要什么（中文一句话，主体靠右，左侧三分之一可留空）" data-img-mode="case">
    </div>
    <div class="l40-edge"></div>
    <div class="l40-txt">
      <h1 class="page-title">{{标题，12 个汉字内，可用 <em>一处</em> 强调}}</h1>
      <p class="l40-lead">{{引言 2–4 行}}</p>
      <div class="l40-list">
        <div><b>01</b><span>{{一行支撑}}</span></div>
        <div><b>02</b><span>{{一行支撑}}</span></div>
        <div><b>03</b><span>{{一行支撑}}</span></div>
      </div>
    </div>
    <div class="l40-cap">
      <b>{{图注标签，英文/年份}}</b>
      <span>{{图注说明，最多两行}}</span>
    </div>
  </div>
</section>
```

---

## 五、图槽位

| 槽位 | 必填? | 模式 | 比例 | 构图要求 |
|------|-------|------|------|----------|
| `pXX_side` | **必填**（`.l40-img` 不自带底色，不放图右半就是一片空白） | case | 16:9 | 会被斜切成右侧一块斜梯形（顶边从 52% 起、底边从 66% 起）：**主体必须在画面右三分之二**，左侧和左下角会被切掉；右下角要能压深（图注是白字）；不要人脸特写贴左边、不要带文字的图 |

**禁用**：主体在左侧的图（切掉之后是一块空景）、四角有关键信息的图、高饱和亮图（图注压不出来）

---

## 六、变体

| 编号 | 变化 | 用途 |
|------|------|------|
| V1 | 整体镜像（`clip-path` 改 `polygon(0 0,48% 0,34% 100%,0 100%)`、文字块移到右侧、`.l40-edge` 位置角度对称改） | 同一份里已经出现过左文右图 |
| V2 | 斜度加大（顶边 46% / 底边 72%） | 图更重要、文字只留标题 + 3 条 |
| V3 | 去掉 `.l40-list`（只留标题 + 引言，引言放到 6–8 行） | 这一页是一段陈述而不是清单 |
| V5 | 高光线改纯 `var(--c-brand)`（去掉渐变） | 整份禁用双色渐变 |
| V6 | 压暗改浅（`filter:brightness(.7)`，图注改深墨字） | 图本身偏暗、白图注反而糊 |

---

## 七、design 提示

- **一份里最多两页**，且别连着排：同一条斜线出现两次就成了模板感（第二页换 V1 镜像会好一些，但仍然看得出来）
- **`clip-path` 和 `.l40-edge` 是同一条线的两份表达**：改一个必须改另一个，否则画面上是两条错开的斜线，一处都不报错
- **斜切只能写在 `<img>` 上**：挪到 `.l40-img` 上之后浏览器里一模一样，而导出 pptx 是满幅暗底 + 满幅照片压掉左边文字区（看起来像「这一版设计成了暗底」）
- **文字区宽度别超过 42%**：标题会伸到暗图上，深墨字压在暗图上只表现成"这一行有点糊"
- **图注只能在右下角、右对齐**：挪到左边或改左对齐会有半句话落在浅底上，白字直接看不见
- **要点最多 4 条**：这一块垂直居中，超了从上下两端一起溢出，而中间几条完全正常
- **配色**：压在图上的字直接写 `#fff` / `rgba(255,255,255,…)`（不要用 `var(--c-ink)` 系，在暗图上看不见）；左侧文字走 `var(--c-ink-deep)` / `var(--c-ink)`
- **与 L1 的区别**：L1 是规整的左右分栏（54/46 矩形），L40 是斜切 —— 有速度感，但只适合「一句判断 + 三条」，放不了 L1 那种两栏正文
- **与 L3 的区别**：L3 是案例页（左文右矩形图 + 案例标签），L40 没有案例语义，斜切本身是主视觉
- **与 L31 的区别**：L31 是上下（浅底标题 + 横贯图带 + 浮白卡），L40 是左右斜切
