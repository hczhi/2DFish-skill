# L60 · `arrow-lead-photo-strip`（内容页：左列注记 + 右侧巨标题带箭头 + 通栏结论色带 + 底部通宽照片条）

> **📄 详情**：本文件供 design 阶段匹配到 L60 时**必读**。
> **★ 核心原则**：结构是灵魂，颜色/内容不绑死。所有配色必须用 `var(--c-*)` 变量。

---

## 一、结构速览

- **比例**：16:9，**三段横切**：上段（132–530px）左小右大、中段一条通栏 82px 的浅品牌色结论带、下段 430px 的**通宽贴底照片条**。文字容量小（约 120–220 字）
- **核心手法**：右侧一句 76px 的衬线巨标题 + 一条 CSS 画的粗箭头指向下方 → 通栏色带给一句结论 → 照片条上压一排药丸标签、右下一个圆形箭头按钮、左下一行英文；左列是 2–4 条小注记（数字 + 一行说明），**给标题当脚注，不是并列要点**
- **是否全幅**：**是** —— 不包 `.slide-inner`（色带和照片条都要通宽贴边）
- **页眉照旧贴**：内容页，左上角那行模块名由代码贴（`.slide-header`，44–100px），**md 和模型都不要自己写**
- **什么时候用**：**一页里有「一句主张 + 几个数 + 一句结论 + 一张现场图」** —— 项目开场、阶段小结、方案主推页；要摆并列要点或数据卡请换别的版式

---

## 二、结构拆解（自上而下）

### 1. 上段 · `.l60-top` / `.l60-notes` / `.l60-head`

- `top:132px`（让开代码贴的页眉带 44–100px），`grid-template-columns:330px 1fr` + `gap:76px`：**左窄右宽不能对调**，倒过来之后那几条小注记变成主角，而那句巨标题挤在 330px 里一行 4 个字。
- 标题**必须写成 `<h1 class="page-title">`**（页脚目录面板靠 `h1.page-title` 取标题）。**一行 ≤11 个汉字、最多 2 行**（76px 在 1234px 的右栏里 12 字顶到边缘；第 3 行把箭头顶到色带上，两个都在、看着像挤）。题眼用 `<em>`（非斜体，转 `var(--c-brand)`），只标一处。
- `.l60-notes` **2–4 条**：一条 = `<b>`（一个数/年份，`var(--num)` 30px）+ `<span>`（一行说明，**≤22 字**）。**4 条正好 394px**（一条 82px + `gap:22px`，上段可用高度 132→530 = 398px），**第 5 条直接顶到色带上**；说明写到两行的话按每条 +26px 重新算，3 条两行说明就已经贴住色带了。
- `.l60-arrow` 是一条 190px 的粗杠 + 一个转 45° 的直角，**指向下面那条色带**：它是「上段的话由下面这句结论收口」的唯一视觉线索，去掉之后三段就是互不相干的三块。**别拿图标字体或 `<img>` 代替**（库里没有图标字体，`<i class="icon-arrow">` 出来是一块空白，画面上像「这个图标没加载」）。

### 2. 通栏结论带 · `.l60-band`

- `left:0;right:0;top:530px;height:82px` + `padding:0 var(--pad-x)`，浅品牌色底 `var(--hl-o)`：`<b>` 是**一句结论**（24px，**≤26 字**，一行），`<span>` 是右端一行英文小字（**≤30 个字符**）。
- **这条带的 y 是写死的**：往上挪会盖住上段、往下挪会顶到照片条上，而三层都渲染正常（读起来只是「这一页排得挤」）。要空间就减注记条数或把标题收成一行。
- `<b>` 超过一行时整条带被撑高、把照片条顶下去 —— 结论写不下就搬到正文里，别指望这条带换行。

### 3. 底部照片条 · `.l60-strip`

- `left:0;right:0;bottom:0;height:430px`，`<img>` 铺满 + `object-fit:cover`；`::after` 是一层 180deg **由浅（.14）到深（.62）** 的蒙版。
- **蒙版是条上所有白字的唯一可读性依赖**：去掉之后药丸标签和左下英文压在亮照片上只是「若隐若现」，浏览器、`checkPage`、导出全都不报错。
- **必须通宽贴底**：缩进到 `var(--pad-x)` 之后它就退化成一张普通配图，而这一条的分量全在「底下那条带把整页压住」上。
- `.l60-pills` **2–5 个**（每个 ≤6 字）：药丸标签是「这张图里在看什么」的标注。**6 个起（或单个标签超过 8 字）整排会伸到右下那个圆按钮底下**，两层都在、字叠在一起。
- `.l60-go` 是右下 92px 的圆形按钮，里面放**一个文字箭头**（`→`）：它是「往下翻」的手势，不是可点的控件（导出成图之后没人点得动它），所以别在里面写字。
- `.l60-em` 是左下一行英文全大写小字（**≤40 个字符**），给照片条压住左下角。

---

## 三、CSS 骨架

```css
/* L60 内容页：左列注记 + 右侧巨标题带箭头 + 通栏结论色带 + 底部通宽照片条（全幅） */
.l60-wrap{position:absolute;inset:0;overflow:hidden;background:var(--c-bg)}
.l60-top{position:absolute;left:var(--pad-x);right:var(--pad-x);top:132px;z-index:2;display:grid;grid-template-columns:330px 1fr;gap:76px;align-items:start}
.l60-notes{display:flex;flex-direction:column;gap:22px}
.l60-note{padding-top:16px;border-top:1px solid var(--c-hairline)}
.l60-note b{display:block;font-family:var(--num);font-size:30px;font-weight:800;line-height:1.1;color:var(--c-brand)}
.l60-note span{display:block;margin-top:7px;font-size:16px;line-height:1.6;color:var(--c-ink)}
.l60-head .page-title{font-family:var(--serif);font-size:76px;font-weight:900;line-height:1.16;letter-spacing:-.01em;color:var(--c-ink-deep);margin-top:0}
.l60-head .page-title em{font-style:normal;color:var(--c-brand)}
.l60-arrow{display:flex;align-items:center;margin-top:34px}
.l60-arrow i{display:block;width:190px;height:6px;background:var(--c-brand);font-style:normal}
.l60-arrow b{display:block;width:26px;height:26px;margin-left:-16px;border-top:6px solid var(--c-brand);border-right:6px solid var(--c-brand);transform:rotate(45deg)}
.l60-band{position:absolute;left:0;right:0;top:530px;height:82px;z-index:2;padding:0 var(--pad-x);background:var(--hl-o);display:flex;align-items:center;justify-content:space-between;gap:48px}
.l60-band b{font-size:24px;font-weight:800;line-height:1.4;color:var(--c-ink-deep)}
.l60-band span{flex:none;font-family:var(--num);font-size:14px;font-weight:700;letter-spacing:.24em;color:var(--c-brand-deep)}
.l60-strip{position:absolute;left:0;right:0;bottom:0;height:430px;z-index:2;overflow:hidden}
.l60-strip img{width:100%;height:100%;object-fit:cover;display:block}
.l60-strip::after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgba(12,20,30,.14) 0%,rgba(12,20,30,.62) 100%)}
.l60-pills{position:absolute;left:var(--pad-x);bottom:124px;z-index:3;display:flex;gap:16px}
.l60-pills span{padding:11px 26px;border-radius:999px;border:1px solid rgba(255,255,255,.6);background:rgba(255,255,255,.16);font-size:18px;font-weight:700;color:#fff}
.l60-em{position:absolute;left:var(--pad-x);bottom:58px;z-index:3;font-family:var(--num);font-size:15px;font-weight:800;letter-spacing:.22em;color:#fff}
.l60-go{position:absolute;right:var(--pad-x);bottom:80px;z-index:3;display:flex;align-items:center;justify-content:center;width:92px;height:92px;border-radius:50%;background:var(--c-brand);font-family:var(--num);font-size:34px;font-weight:800;color:var(--c-brand-on)}
```

---

## 四、build-part 结构模板

```html
<section class="slide" data-layout="L60">
  <!-- 全幅：不包 .slide-inner。左上角那行模块名由代码统一贴，这里不要写 -->
  <div class="l60-wrap">
    <div class="l60-top">
      <div class="l60-notes">
        <div class="l60-note"><b>{{数}}</b><span>{{一行说明，22 字内}}</span></div>
        <div class="l60-note"><b>{{数}}</b><span>{{一行说明}}</span></div>
        <div class="l60-note"><b>{{数}}</b><span>{{一行说明}}</span></div>
      </div>
      <div class="l60-head">
        <h1 class="page-title">{{主标题上半，}}<br>{{下半，题眼用 <em> 包起来}}</h1>
        <div class="l60-arrow"><i></i><b></b></div>
      </div>
    </div>
    <div class="l60-band">
      <b>{{一句结论，26 字内}}</b>
      <span>{{一行英文小字}}</span>
    </div>
    <div class="l60-strip">
      <img src="/ppt-cases/ph-16x9.svg" alt="" data-img-prompt="这一页要配什么现场图（中文一句话：横向很宽的一条，主体在中间偏左，上方留白）" data-img-mode="case">
      <div class="l60-pills"><span>{{标签一}}</span><span>{{标签二}}</span><span>{{标签三}}</span></div>
      <div class="l60-em">{{一行英文全大写小字}}</div>
      <div class="l60-go">→</div>
    </div>
  </div>
</section>
```

---

## 五、图槽位

| 槽位 | 必填? | 模式 | 比例 | 构图要求 |
|------|-------|------|------|----------|
| `pXX_strip` | **必填**（没有图这一页底下 430px 是一块深灰，那排药丸标签和圆按钮悬在空处） | case | 16:9 | **横向条状裁切**（画面实际是 1920×430，上下会被 `cover` 切掉大半）：主体在**中间偏左**、上方留白、不要把重点放在上下边缘；不要带文字的图 |

---

## 六、变体

| 编号 | 变化 | 用途 |
|------|------|------|
| V1 | 注记放 2 条 | 只有两个数要交代 |
| V2 | 去掉 `.l60-band` 的 `<span>` | 这份稿子不带英文 |
| V3 | 去掉 `.l60-em` | 照片条左下不放英文 |
| V4 | 去掉 `.l60-go` | 不要「往下翻」那个手势（此时药丸标签可放到 6 个） |
| V5 | 标题写一行 | 一句 11 字以内 |
| V6 | 色带和箭头改 `var(--c-accent)` | 照片偏暖，想让点缀色更冷 |

---

## 七、design 提示

- **这一页是「一句主张 + 几个数 + 一句结论 + 一张现场图」**：往里塞并列要点、卡片、表格就把三段横切挤成一团，而画面完全正常
- **左窄右宽不能对调**（330px / 1fr）：倒过来标题一行只剩 4 个字
- **三段的 y 是写死的**：色带 `top:530px`、照片条 `height:430px` —— 挪任何一段都会盖住相邻那段，三层都渲染正常
- **注记 2–4 条、说明各 1 行**：第 5 条顶到色带上（说明写两行时按每条 +26px 重算）
- **标题一行 ≤11 字、最多 2 行；结论 ≤26 字（一行）；注记说明 ≤22 字；药丸 2–5 个各 ≤6 字；左下英文 ≤40 字符**：超了要么撑高把下一段顶掉，要么被 `overflow:hidden` 静默切掉
- **照片条的蒙版一层都不能去**：白字压在亮照片上只是「若隐若现」，不报错
- **照片条必须通宽贴底**，缩进之后这一条就退化成普通图文页
- **箭头和圆按钮里不放图标字体、不放 `<img>`**（库里没有图标字体，出来是一块空白）
- **别给 `.l60-wrap` 写 padding**（全幅版式通例，`designSpec.test.ts` 拦这件事）
- **配色**：巨标题 `var(--c-ink-deep)`、题眼和注记数字 `var(--c-brand)`、色带底 `var(--hl-o)`、照片条上的字 `#fff`
- **与 L47 / L52 的区别**：那两条是图表页（数在图里）；L60 的几个数只是标题的脚注，一根条一根柱都没有
- **与 L59 的区别**：L59 是整页压在一张远景照上的**金句页**（只有一句主张 + 一排圆）；L60 是内容页，照片只占底下 430px，上面还有标题、注记和结论三段
- **与 L1 / L3 的区别**：那两条是**左右**分栏（左文右图）；L60 是**上下**三段横切，图通宽贴底
- **整份最多一页 L60**，且**别和别的照片页相邻**
