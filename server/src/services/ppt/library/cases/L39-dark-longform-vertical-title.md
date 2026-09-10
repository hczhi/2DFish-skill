# L39 · `dark-longform-vertical-title`（暗底长文：左侧竖排中文标题 + 中间三四段正文 + 右侧数据边栏）

> **📄 详情**：本文件供 design 阶段匹配到 L39 时**必读**。
> **★ 核心原则**：结构是灵魂，颜色/内容不绑死。所有配色必须用 `var(--c-*)` 变量。

---

## 一、结构速览

- **比例**：16:9，暗底（`var(--c-ink-deep)` + 压到 `.22` 的气氛图），**文字容量大**（正文 3–4 段共 14–18 行，约 700–900 字）
- **核心手法**：三竖带 —— ① 左侧一条 **`writing-mode:vertical-rl` 竖排衬线标题**（56px 白字 + 一行竖排英文小字，整库只有这一条这么排）；② 中间是正文（21px / `line-height:2`，`justify-content:center` 垂直居中）；③ 右侧 340px **数据边栏**（`.l39-stats`，左边一条半透白竖线，2–3 组「60px 品牌色数字 + 一行说明」）
- **是否全幅**：**是** —— 不包 `.slide-inner`（背景图要铺满，三竖带各自绝对定位）
- **底色**：默认不加类（暗调由 `.l39-wrap` 自己给）
- **什么时候用**：需要**读**的暗底页：立场陈述 / 行业判断 / 一段有分量的综述 + 几个支撑数字

---

## 二、结构拆解（由后到前）

### 1. 气氛底 · `.l39-bg`

- 图压到 `.22`，再叠一层**横向**渐变（左 `.88` → 中 `.6` → 右 `.82`）：两侧压深托住竖排标题和数据栏，中段稍亮给正文一点空气。
- 不压的话 21px 白字压在实景图上直接不可读，而缩略图上看着"挺高级"。
- 没有配图时整个 `.l39-bg` 删掉即可（纯深底，V4）—— 这一条**不配图也完整**。

### 2. 竖排标题 · `.l39-side`

- 标题**必须写成 `<h1 class="page-title">`**（页脚目录面板靠它取标题；`writing-mode` 只影响画面，目录里那一条仍然是正常的一行字）。
- **只能 6–10 个汉字。** 竖排的高度就是 `--pad-top` 到 `--pad-bottom` 那 862px，56px 的字写到第 11 个就从下缘裁掉了 ——
  页面上看着只是"标题少了两个字"，而目录面板里那一条是全的，对不上也没人报错。
- 旁边那行 `.l39-en` 也是竖排（`var(--num)` 加宽字距品牌色）：写英文或年份，**最多 20 个字符**。
- 这一带靠 `.l39-side{align-items:center}` **垂直居中**。去掉之后标题从 `--pad-top` 起排，
  六个字的标题下面空掉 400–500px，而右边的正文和数据栏都是居中的 —— 画面上只表现成"左上角一列字"，
  看着像是有意为之的设计，一处都不报错。
- 这一带占掉左边约 200px，正文的 `left` 就是按它算的 —— 两者要一起改。

### 3. 正文 · `.l39-body`

- 左右边界是 `calc(var(--pad-x) + 220px)` / `calc(var(--pad-x) + 440px)`：**必须给两侧让位**。
  改成 `left:var(--pad-x)` 之后正文压在竖排标题上，两层都是白字，读起来只是"有点糊"。
- 3–4 段，每段 3–5 行，段间 24px。**14–18 行封顶**（21px × `line-height:2` = 42px 一行，862px 装得下 20 行）：
  超了会从上下两端一起溢出（这一块是垂直居中的），而中间几段完全正常。
- 关键短语用 `<b>`（转纯白）：暗底上正文是 `rgba(255,255,255,.82)`，`<b>` 那点亮度差就是这一页唯一的强调手段。
- **不要在这里放小标题**：三四段带小标题的内容属于 L38 / L28，那种在暗底上会变成一堆碎块。

### 4. 数据边栏 · `.l39-stats`

- 2–3 组，每组 = `<b>`（60px 品牌色数字）+ `<span>`（一行说明）。**4 组起会挤到没有呼吸**（这一栏只有 340px 宽、862px 高，但数字本身很占地方）。
- 数字必须是**正文里出现过的那几个**：边栏和正文说两套数的时候，读者会以为自己看漏了。
- 那条 `border-left` 是半透白（`rgba(255,255,255,.22)`），不要换成 `var(--c-hairline)` —— 那是给浅底用的，在暗底上看不见（而 CSS 一点都不报错）。

---

## 三、CSS 骨架

```css
/* L39 暗底长文 + 竖排中文标题 + 右侧数据边栏（文字多） */
.l39-wrap{position:absolute;inset:0;overflow:hidden;background:var(--c-ink-deep)}
.l39-bg{position:absolute;inset:0;z-index:0}
.l39-bg img{width:100%;height:100%;object-fit:cover;display:block;opacity:.22}
.l39-bg::after{content:"";position:absolute;inset:0;background:linear-gradient(90deg,rgba(0,0,0,.88) 0%,rgba(0,0,0,.6) 52%,rgba(0,0,0,.82) 100%)}
.l39-side{position:absolute;left:var(--pad-x);top:var(--pad-top);bottom:var(--pad-bottom);z-index:2;display:flex;align-items:center;gap:20px}
.l39-side .page-title{writing-mode:vertical-rl;font-family:var(--serif);font-size:56px;font-weight:900;line-height:1.24;letter-spacing:.16em;color:#fff;margin-top:0}
.l39-side .l39-en{writing-mode:vertical-rl;font-family:var(--num);font-size:14px;font-weight:700;letter-spacing:.3em;color:var(--c-brand)}
.l39-body{position:absolute;left:calc(var(--pad-x) + 220px);right:calc(var(--pad-x) + 440px);top:var(--pad-top);bottom:var(--pad-bottom);z-index:2;display:flex;flex-direction:column;justify-content:center}
.l39-body p{font-size:21px;line-height:2;color:rgba(255,255,255,.82);margin-bottom:24px}
.l39-body p:last-child{margin-bottom:0}
.l39-body p b{font-weight:700;color:#fff}
.l39-stats{position:absolute;right:var(--pad-x);top:var(--pad-top);bottom:var(--pad-bottom);width:340px;z-index:2;display:flex;flex-direction:column;justify-content:center;gap:38px;padding-left:44px;border-left:1px solid rgba(255,255,255,.22)}
.l39-stats b{display:block;font-family:var(--num);font-size:60px;font-weight:800;line-height:1;color:var(--c-brand)}
.l39-stats span{display:block;margin-top:12px;font-size:18px;line-height:1.65;color:rgba(255,255,255,.7)}
```

---

## 四、build-part 结构模板

```html
<section class="slide" data-layout="L39">
  <!-- 全幅：不包 .slide-inner -->
  <div class="l39-wrap">
    <div class="l39-bg">
      <img src="/ppt-cases/ph-16x9.svg" alt="" data-img-prompt="气氛底要什么（中文一句话，远景/肌理，会被压到 .22）" data-img-mode="concept">
    </div>
    <div class="l39-side">
      <h1 class="page-title">{{标题，6–10 个汉字}}</h1>
      <div class="l39-en">{{英文/年份，20 字符内}}</div>
    </div>
    <div class="l39-body">
      <p>{{第一段，3–5 行}}</p>
      <p>{{第二段，含一处 <b>关键短语</b>}}</p>
      <p>{{第三段}}</p>
    </div>
    <div class="l39-stats">
      <div><b>{{数字}}</b><span>{{这个数字是什么}}</span></div>
      <div><b>{{数字}}</b><span>{{这个数字是什么}}</span></div>
    </div>
  </div>
</section>
```

---

## 五、图槽位

| 槽位 | 必填? | 模式 | 比例 | 构图要求 |
|------|-------|------|------|----------|
| `pXX_bg` | 可选（没有就走 V4，纯深底同样完整） | concept | 16:9 | 全幅气氛底（1920×1080，会被压到 `.22` + 左右浓中段淡的横向蒙版）：**远景 / 肌理 / 夜景**，中段不要有主体（正文压在那儿）；不要人脸特写、不要图表 |

**禁用**：人脸特写（压到 .22 之后是一团看不清的脸）、带文字的图、高饱和亮图（压不下去，白字发糊）、中央有主体的图

---

## 六、变体

| 编号 | 变化 | 用途 |
|------|------|------|
| V1 | 竖排标题移到最右、数据栏移到最左（三带整体镜像） | 同一份里已经出现过左竖排 |
| V2 | 去掉数据栏（正文右界改 `var(--pad-x)`，多 3 行） | 没有可用的数字 |
| V3 | 数据栏数字改 `var(--c-accent)` | 整份走冷色调 |
| V4 | 去掉气氛图（`.l39-bg` 删掉，纯深底） | 找不到能压暗的远景图 |
| V5 | 浅底版（`.l39-wrap` 改 `var(--c-bg)`，字色转 `var(--c-ink)` 系、竖线用 `var(--c-hairline)`） | 整份禁用暗底页 |
| V6 | 竖排标题降到 44px（可写 12–14 字） | 标题实在压不到 10 字 |

---

## 七、design 提示

- **整份最多一页**：暗底长文很重，两页连着出现时第二页只会被翻过去
- **前后别接暗底页**（L29 / L32 / L36 都是暗的，连着两页会分不出换了页）
- **竖排标题 6–10 个汉字**：这是硬约束，超了从下缘静默裁掉，而目录里那一条是全的
- **正文别从 `--pad-x` 起**：会压在竖排标题上，两层都是白字，只表现成"有点糊"
- **配色**：暗底上的字直接写 `#fff` / `rgba(255,255,255,…)`（**不要用 `var(--c-ink)` 系**，在暗底上看不见）；数字和竖排英文走 `var(--c-brand)`；分隔线用 `rgba(255,255,255,.22)`，不要用 `var(--c-hairline)`
- **与 L37 的区别**：L37 是浅底报刊双栏（字最多、要一句句读），L39 是暗底单栏（字少一档，但有气氛和数据）
- **与 L21 的区别**：L21 是全幅暗底 + 左文右三数据栏，但正文只有两三行（它的主角是中央那张透视图）；L39 没有主视觉，正文是主角
- **与 L29 的区别**：L29 是暗底一句金句 + 底部四步回环（字少），L39 是暗底长文
