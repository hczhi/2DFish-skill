# L42 · `arc-stage-metrics`（半圆舞台：底部大半圆 + 弧内三组数据 + 顶部居中标题）

> **📄 详情**：本文件供 design 阶段匹配到 L42 时**必读**。
> **★ 核心原则**：结构是灵魂，颜色/内容不绑死。所有配色必须用 `var(--c-*)` 变量。

---

## 一、结构速览

- **比例**：16:9，浅底 + **底部中央一个直径 1200px 的暗色半圆**（可放气氛图，压到 `.5` 再叠黑渐变），文字很少（标题 + 一句引言 + 3 组数据，约 160–220 字）
- **核心手法**：整库唯一的**弧形舞台** —— 半圆（`border-radius:600px 600px 0 0`）从画面底边升起，外面套一圈大 20px 的 1px 细线弧（`.l42-arc`）；3 组「56px 品牌色数字 + 一行说明」按 150° / 90° / 30° 排在**弧内侧**，中间那组最高，读起来是一道上扬的弧
- **是否全幅**：**是** —— 不包 `.slide-inner`（半圆要贴底边、三组数据各自绝对定位）
- **底色**：默认不加类（半圆自己是暗的）
- **什么时候用**：三个并列的关键指标 / 三项成果 / 三个覆盖面 —— 需要一页把数字说得有仪式感（开场的成绩单、章节前的三个数、结尾的三项承诺）

---

## 二、结构拆解（由后到前）

### 1. 半圆舞台 · `.l42-stage`

- 圆心在 `(960, 1080)`、半径 720：`left:50%` + `margin-left:-720px` + `width:1440px;height:720px` + `border-radius:720px 720px 0 0`。弧顶落在 y=360，正好接住标题区下面那一段留白 —— 半径缩到 600 的话标题和弧之间空出 270px 一条米色横带，看起来像“这一页只写了一半”。
- **圆角必须写成 `720px 720px 0 0`，不能写 `50%`**：写 `50%` 时上半圆被压成一个矮椭圆（横向 720 纵向 360 的圆角），三组数据的坐标就全对不上了 —— 而画面照样完整，看起来只是"这个弧有点扁"。
- 里面的图压到 `.5` 再叠一层上浅下深的黑渐变：三组数据是白字，不压的话它们压在实景图上直接不可读。
- 没有配图时整个 `<img>` 删掉即可（纯深色半圆，V4）—— 这一条**不配图也完整**。
- 半圆底边贴 `bottom:0`，会被整份 deck 的页脚色带（54px）压住一条边 —— 和其他全幅版式一样，这是预期的（三组数据最低到 y≈849，够不着页脚）。

### 2. 细线弧 · `.l42-arc`

- 比舞台大 20px 的一圈 1px 细线，`border-bottom:0` 只留上半。它是这一条的精致感来源，**不要加粗**（2px 起就变成一个描边图形，仪式感变成海报感）。
- 半径改了这里也要一起改（永远比 `.l42-stage` 大 20px），否则两条弧不同心，画面上是"弧线歪了"。

### 3. 三组数据 · `.l42-m` + `.l42-m1/m2/m3`

- 每组 = `<b>`（56px `var(--num)` 品牌色数字）+ `<span>`（一行说明，白字）。**结构写成 `<div class="l42-m l42-m1">`**：`.l42-m` 管样式、`.l42-mN` 只管坐标。
- 那几个 `left/top` 是按半径 720 的半圆算出来的：三个点取 150° / 90° / 30°，但都收到 `r=560` 那一圈上（`x=960+560cosθ`、`y=1080−560sinθ`），再按块高 97px 上移 48px 让文字压在点上 —— 直接放在 R=720 的弧上的话，280px 宽的块两个上角就伸到弧外面去了。**改了舞台尺寸必须重算**：三块白字一旦落到弧外面的米底上就**直接看不见**，而 HTML、CSS、`checkPage` 一个字都不说。
- 说明**一行、10 字以内**：换行会把这一块往下顶，第二行有可能压出弧外（同上，看不见）。
- **只能 3 组**：这个弧上排得下三个位置，第四个没有坐标可用（写 `.l42-m4` 是一个没有定义的类，那一块掉回默认流式布局，堆到画面左上角）。
- 数字要是**这一页真正的主角**：三个数说的应该是同一件事的三个面（覆盖 / 规模 / 效率），三个不相干的数放上来这个弧就只是装饰。

### 4. 顶部标题 · `.l42-head`

- **居中**（`text-align:center`）：这是整库少数居中标题的版式之一，弧是对称的，标题偏左会让整页看起来歪。
- 标题 56px 衬线，**14 个汉字以内**；下面一句引言最多 2 行（再多会压到中间那组数据上，两层字叠在一起）。

---

## 三、CSS 骨架

```css
/* L42 半圆舞台 + 弧上三组数据（全幅） */
.l42-wrap{position:absolute;inset:0;overflow:hidden;background:var(--c-bg)}
.l42-head{position:absolute;left:var(--pad-x);right:var(--pad-x);top:var(--pad-top);z-index:2;text-align:center}
.l42-head .page-title{font-family:var(--serif);font-size:56px;font-weight:900;line-height:1.2;color:var(--c-ink-deep);margin-top:0}
.l42-head p{margin:18px auto 0;max-width:900px;font-size:21px;line-height:1.75;color:var(--c-ink)}
.l42-stage{position:absolute;left:50%;bottom:0;width:1440px;height:720px;margin-left:-720px;z-index:0;overflow:hidden;border-radius:720px 720px 0 0;background:var(--c-ink-deep)}
.l42-stage img{width:100%;height:100%;object-fit:cover;display:block;opacity:.5}
.l42-stage::after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.22) 0%,rgba(0,0,0,.78) 100%)}
.l42-arc{position:absolute;left:50%;bottom:0;width:1480px;height:740px;margin-left:-740px;z-index:1;border:1px solid var(--c-hairline);border-bottom:0;border-radius:740px 740px 0 0;pointer-events:none}
.l42-m{position:absolute;width:280px;z-index:2;text-align:center}
.l42-m b{display:block;font-family:var(--num);font-size:56px;font-weight:800;line-height:1;color:var(--c-brand)}
.l42-m span{display:block;margin-top:12px;font-size:18px;line-height:1.6;color:rgba(255,255,255,.82)}
.l42-m1{left:335px;top:752px}
.l42-m2{left:820px;top:472px}
.l42-m3{left:1305px;top:752px}
```

---

## 四、build-part 结构模板

```html
<section class="slide" data-layout="L42">
  <!-- 全幅：不包 .slide-inner；页眉由代码贴，这里不要写 -->
  <div class="l42-wrap">
    <div class="l42-head">
      <h1 class="page-title">{{标题，14 个汉字内}}</h1>
      <p>{{一句引言，最多两行}}</p>
    </div>
    <div class="l42-stage">
      <img src="/ppt-cases/ph-16x9.svg" alt="" data-img-prompt="半圆里的气氛图要什么（中文一句话，远景/夜景，会被压到 .5）" data-img-mode="concept">
    </div>
    <div class="l42-arc"></div>
    <div class="l42-m l42-m1"><b>{{数字}}</b><span>{{说明，10 字内}}</span></div>
    <div class="l42-m l42-m2"><b>{{数字}}</b><span>{{说明，10 字内}}</span></div>
    <div class="l42-m l42-m3"><b>{{数字}}</b><span>{{说明，10 字内}}</span></div>
  </div>
</section>
```

---

## 五、图槽位

| 槽位 | 必填? | 模式 | 比例 | 构图要求 |
|------|-------|------|------|----------|
| `pXX_stage` | 可选（没有就走 V4，纯深色半圆同样完整） | concept | 16:9 | 会被裁成一个半圆（1440×720，压到 `.5` + 上浅下深黑渐变）：**远景 / 夜景 / 肌理**，主体别靠左右两端（那两块被圆角切掉）；不要人脸特写、不要图表 |

**禁用**：人脸特写（压到 .5 又被圆角切，剩一半张脸）、带文字的图、高饱和亮图（白色数字发糊）

---

## 六、变体

| 编号 | 变化 | 用途 |
|------|------|------|
| V1 | 半圆改浅色（`var(--c-bg-alt)`），数据字色转 `var(--c-ink-deep)` 系 | 整份禁用暗色块 |
| V2 | 数字改 `var(--c-accent)` | 冷色调整份 |
| V3 | 去掉 `.l42-arc` 细线 | 想更干净 |
| V4 | 去掉图（纯深色半圆） | 找不到能压暗的远景图 |
| V5 | 半圆缩到 1200×600（三组坐标按 r=460 重算） | 标题和引言更长 |
| V6 | 三组数据换成三个短句（数字降到 40px） | 没有可用的数字 |

---

## 七、design 提示

- **整份最多一页**：这个弧太有识别度，第二页出现时会让人觉得翻回去了
- **三组坐标是算出来的**：改了 `.l42-stage` 的宽高必须重算 `.l42-m1/m2/m3` 的 `left/top`，否则白字落到浅底上**直接看不见**，一处都不报错
- **圆角写 `720px 720px 0 0`，不要写 `50%`**：`50%` 会把上半圆压成矮椭圆，而画面照样完整
- **只能 3 组、说明各一行**：第四组没有坐标（`.l42-m4` 是未定义的类，会堆到左上角）
- **标题必须居中**：弧是对称的，左对齐标题会让整页看起来歪
- **配色**：弧内的字直接写 `rgba(255,255,255,…)`（不要用 `var(--c-ink)` 系，在暗弧上看不见）；数字走 `var(--c-brand)`；细线弧用 `var(--c-hairline)`
- **与 L5 的区别**：L5 是规整的数据网格（2×2 / 1×3 卡片，能放 4–6 个指标），L42 只放 3 个但有仪式感
- **与 L29 的区别**：L29 是暗底整页金句 + 底部四步回环（主角是那句话），L42 的主角是三个数字
- **与 L21 的区别**：L21 是全幅暗底 + 左右浮信息（正文两三行 + 三个数），L42 没有正文，只有标题 + 三个数
