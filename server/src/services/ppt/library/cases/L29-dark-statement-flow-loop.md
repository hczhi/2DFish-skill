# L29 · `dark-statement-flow-loop`（全幅暗底金句 + 底部四步回环）

> **📄 详情**：本文件供 design 阶段匹配到 L29 时**必读**。
> **★ 核心原则**：结构是灵魂，颜色/内容不绑死。所有配色必须用 `var(--c-*)` 变量。

---

## 一、结构速览

- **比例**：16:9，**暗底全幅**（背景图 `opacity:.4` 压在 `--c-ink-deep` 深底上），信息密度中等
- **核心手法**：① 整页一张压暗的背景图，只做气氛；② 中部**一句 64px 衬线金句**（`h1.page-title`，关键几个字用 `<em>` 染品牌色）+ 一行 21px 补充；③ 底部**四步回环**（`.l29-loop`，四个半透明描边格，格间一个 `→`，**最后一格是 `↺`**，读成"回到第一步"）
- **是否全幅**：**是** —— 内容不包 `.slide-inner`（位置靠 `.l29-say` / `.l29-loop` 两个绝对定位的子块给）
- **它既能当内容页也能当结尾页**：金句收一段论证 + 四步给出可循环的做法
- **底色**：section 上加 `has-bg`（背景图铺满整页）

---

## 二、结构拆解

### 1. 背景图 · `.l29-bg`

- 图 `opacity:.4`（原来那层烙死的 `rgba(0,0,0,.70)` 已删，整页原本压到两成、发灰）——
  剩下的 .4 压在 `--c-ink-deep` 上就是这一页白字唯一的依靠，**别再动它**；**选图只按气氛选**，细节全部会没。
- 没有配图时整个 `.l29-bg` 删掉即可（`.l29-wrap` 回落到 `var(--c-ink-deep)` 纯深底，V5）。

### 2. 金句 · `.l29-say`（`top:24%`）

- **必须写成 `<h1 class="page-title">`**（页脚目录面板靠它取标题；这一页没有别的标题，换掉之后目录里只剩一个页码）。
- 两到三行，`<br>` 手动断行到语义处。要染色的那几个字包 `<em>`（`font-style` 已被改成 normal，只上品牌色）。
- `.l29-sub` 一行补充（≤ 60 字），说"顺序倒过来会怎样"这类反面。不需要就整行删掉。

### 3. 四步回环 · `.l29-loop` > `.l29-step` × 4

- 每格 = `<i>`（STEP 01 这类小标，字距 `.22em`）+ `<b>`（步骤名，2–4 字）+ `<span>`（一行说明）。
- 格间那个箭头是 `::after` 画的，**最后一格是 `↺`**：换成 `→` 的话这一页就从"可循环的做法"变成"四步单向流程"，而画面几乎看不出差别 —— 单向流程请直接用 L6 / L25。
- **必须四格**：`grid-template-columns:repeat(4,1fr)` 写死，三格或五格要一起改（V2/V3）。
- **`.l29-wrap` 上一句 padding 都不能写**（`designSpec.test.ts` 盯着所有 `inset:0` 的容器）：模型被允许用 inline style 顺手调间距，它写一句 `style="padding:36px"` 就把 padding-top 顶掉，金句落进 44–100px 那条页眉带、被 `z-index:30` 的页眉压住，而页面渲染、类名校验、图位统计全部正常，problems 里一个字都没有。位置因此全靠两个绝对定位的子块：`.l29-say`（`top:24%`）和 `.l29-loop`（`bottom:12%`），左右缩进用 `var(--pad-x)` 跟着疏密档走。

---

## 三、CSS 骨架

```css
/* L29 暗底金句 + 四步回环（全幅） */
.l29-wrap{position:absolute;inset:0;overflow:hidden;background:var(--c-ink-deep)}
.l29-bg{position:absolute;inset:0;z-index:0}
.l29-bg img{width:100%;height:100%;object-fit:cover;display:block;opacity:.4}
.l29-say{position:absolute;top:24%;left:var(--pad-x);right:var(--pad-x);z-index:2}
.l29-say .page-title{font-family:var(--serif);font-size:64px;font-weight:900;line-height:1.28;color:#fff;max-width:1400px;margin-top:0}
.l29-say .page-title em{font-style:normal;color:var(--c-brand)}
.l29-sub{margin-top:24px;font-size:21px;line-height:1.85;color:rgba(255,255,255,.72);max-width:1080px}
.l29-loop{position:absolute;left:var(--pad-x);right:var(--pad-x);bottom:12%;z-index:2;display:grid;grid-template-columns:repeat(4,1fr);gap:22px}
.l29-step{position:relative;padding:24px 26px;border:1px solid rgba(255,255,255,.22);background:rgba(255,255,255,.06)}
.l29-step::after{content:"\2192";position:absolute;right:-18px;top:50%;transform:translateY(-50%);z-index:3;font-size:22px;color:var(--c-brand)}
.l29-step:last-child::after{content:"\21BA"}
.l29-step i{display:block;font-family:var(--num);font-size:15px;font-style:normal;letter-spacing:.22em;color:var(--c-brand);margin-bottom:10px}
.l29-step b{display:block;font-size:23px;font-weight:800;color:#fff}
.l29-step span{display:block;margin-top:8px;font-size:17px;line-height:1.65;color:rgba(255,255,255,.72)}
```

---

## 四、build-part 结构模板

```html
<section class="slide has-bg" data-layout="L29">
  <div class="l29-wrap">
    <div class="l29-bg"><img src="/ppt-cases/ph-16x9.svg" alt="" data-img-prompt="整页气氛底图配什么（中文一句话，会被压到 40% 亮度，只看氛围）" data-img-mode="concept"></div>
    <div class="l29-say">
      <h1 class="page-title">{{金句前半<em>要染色的那几个字</em>}}，<br>{{金句后半}}。</h1>
      <div class="l29-sub">{{顺序倒过来会怎样，一行；不需要就整行删掉}}</div>
    </div>
    <div class="l29-loop">
      <div class="l29-step">
        <i>STEP 01</i>
        <b>{{步骤名}}</b>
        <span>{{一行说明}}</span>
      </div>
      <div class="l29-step">
        <i>STEP 02</i>
        <b>{{步骤名}}</b>
        <span>{{一行说明}}</span>
      </div>
      <div class="l29-step">
        <i>STEP 03</i>
        <b>{{步骤名}}</b>
        <span>{{一行说明}}</span>
      </div>
      <div class="l29-step">
        <i>STEP 04</i>
        <b>{{步骤名}}</b>
        <span>{{一行说明}}</span>
      </div>
    </div>
  </div>
</section>
```

---

## 五、图槽位

| 槽位 | 必填? | 模式 | 比例 | 构图要求 |
|------|-------|------|------|----------|
| `pXX_bg` | 可选（没有就走 V5） | concept | 16:9 | 整页气氛底图：**大面积低对比**（夜景、雾、深色质感），被压到 40% 亮度，主体在哪都无所谓，但**不能有文字或图表** |

**禁用**：高饱和亮图（压暗之后一团脏色）、人脸特写（半张脸浮在字后面）、任何带字的截图

---

## 六、变体

| 编号 | 变化 | 用途 |
|------|------|------|
| V1 | 去掉 `.l29-sub`，金句写三行 | 金句自足 |
| V2 | 三步（`repeat(3,1fr)`） | 只有三步 |
| V3 | 五步（`repeat(5,1fr)`，说明压到 4 字） | 五步 |
| V4 | 末格箭头保持 `→`（改 `:last-child` 那条） | 确实是单向流程（但优先考虑 L6） |
| V5 | 去掉背景图（纯 `var(--c-ink-deep)` 底） | 找不到干净的暗图时 |
| V6 | 金句居左改居中（`.l29-say` 加 `text-align:center`，`.page-title` 加 `margin:0 auto`） | 当结尾页用 |

---

## 七、design 提示

- **视觉重**（整页暗底）：整份里这类暗页不要超过两三页，**不要和 L18 / L21 / L19 相邻**（三条都是暗底全幅，连着看像同一页没翻过去）
- **末格 `↺` 是结构签名**：这一页的意思是"这套做法会再走一遍"
- **暗底上的正文一律 `rgba(255,255,255,.72)`**，**不要用 `var(--c-ink-soft)`**（在暗底上糊成一团）；描边用 `rgba(255,255,255,.22)`，别用 `var(--c-hairline)`（那是给浅底的，暗底上完全看不见）
- **配色**：染色字与箭头 `var(--c-brand)`，底色 `var(--c-ink-deep)`
- **与 L2 的区别**：L2 是章节封面（整页就一句话，不贴页眉），L29 底部还有四步、要贴页眉
- **与 L25 的区别**：L25 是浅底横轴四节点（阶段推进，一眼看完），L29 是暗底金句为主、四步只是脚注级
