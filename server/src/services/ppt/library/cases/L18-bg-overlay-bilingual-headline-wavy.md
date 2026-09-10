# L18 · `bg-overlay-bilingual-headline-wavy`

> 全幅暗 bg + 英文左 / 中文右双标题对称 + 红色波浪线 + 暗蒙版三栏卡片

**截图原件**：`cases/img/L18-ref.png`（GNYS 品牌介绍页 · 数字排毒章节扉页）

> 本文件里的 CSS 和结构**必须和 `library/template.html` 里那一段完全对得上**（那份才是真的渲染
> 用的骨架，本文件只是喂给模型的说明）。对不上时页面照样渲染、接口 200，只是那一块掉回默认
> 流式布局 —— 看起来是「这个版式塌了」，而重新生成一次拿到的是同样的一版
> （`caseLibrary.test.ts` 逐个 token 核这件事）。

---

## 一、适用场景

- **章节扉页 / 概念页**（强气质版）：当章节主题有"双语对照感"（"REDISCOVERING LOST FOCUS" vs "数字排毒 找回遗失的专注力"）
- **品牌主张 / 宣言页**：一句话主张中英双语并置
- **议题/概念页**：用 3 个支撑点拆解一句话主张
- ❌ 不适合：纯产品介绍（用 L19）、数据展示（用 L4）、章节目录（用 L17）

---

## 二、结构拆解（由上至下）

### 整体 16:9 全幅图（不包 `.slide-inner`）

1. 全幅背景图（**深色 / 神秘氛围**——森林光束、深山、星空、暗色海面等）
2. 左上角一句 kicker（`.slide-header`，全平台统一的页眉，**由代码贴、你不要写**；也**不要另写
   logo / 胶囊 pill**，那两个类
   已经不在 `template.html` 里了 —— 写出来的那两块没有 CSS，会掉回默认流式布局堆在页面顶上，
   而接口 200、看起来像这个版式塌了）
3. 顶部 1/3：横向双标题（左英右中）
4. 中部 1/3：右中文标题中央穿过一条**红色波浪线**（手绘感/丝带感）
5. 底部 1/3：暗蒙版覆盖 + 3 栏卡片

### 顶部双标题（左英右中）

- **左侧英文**（占左 50%）：两行巨字，"REDISCOVERING / LOST FOCUS"（约 72–96px，粗体白色，行高 1.0）
- **右侧中文**（占右 50%）：两行巨字，"数字排毒 / 找回遗失的专注力"（约 88–112px，细体白色，行高 1.0）
- 中英文之间无明显分界，靠左右对齐+字重对比区分

### 中文标题下的说明段（`.l18-lead`）

- 中文巨字下面**右对齐**一段 2–4 行说明（20px，`rgba(255,255,255,.8)`），把那句主张落到具体场景 —— 参考原图右半边那三行小字。
- 它是 `.l18-headline` 这个两列 grid 的第三个孩子，靠 CSS 里的 `grid-column:2` 落到中文那一列下面；**不要放进 `.l18-cn` 里**（波浪线按 `.l18-cn` 高度的 48% 定位，一放进去线就掉到说明文字上）。
- 不需要时整块删掉即可（标题块自然收回两行）。

### 中部红色波浪线

- 一条**红色波浪线**横穿右半中文标题中央（约 4–6px 粗，brand/accent 色，长度等于右半宽度的 60–80%）
- 用 `.l18-cn` 里内嵌的 `<svg>` 画二次贝塞尔曲线（`M0 9 Q 50 0 100 8 T 200 8 …`），**不用 CSS `clip-path`**

### 底部暗蒙版 + 3 栏卡片

1. 暗色蒙版（`linear-gradient(180deg, transparent 0%, rgba(0,0,0,.65) 50%, rgba(0,0,0,.85) 100%)`）—— 三栏整体离底边 13%（`bottom:13%`），**别贴到底**：贴底那一版三栏和画面下缘挤在一起，而页面照样渲染
2. 3 栏等宽（间距 24–40px）：
   - 顶部小引号（`""`，50–60px，brand 色）
   - 大数字（`01 / 02 / 03`，40–56px 衬线 italic，brand 色）
   - 标题（"主动'断连'的勇气"等，25px 粗体白色）
   - 描述段（18px，`rgba(255,255,255,.8)`，3–5 行，行高 1.8）

---

## 三、视觉手法（结构信号）

| 手法 | 作用 | 何时去掉 |
|------|------|----------|
| **暗 bg + 暗蒙版** | 营造"沉浸感"和"议题重量" | 改成 V2 浅底（接近 L17） |
| **左右双标题对称** | 双语/双视角对照 | 改成 V3 单语 + 单巨字 |
| **红色波浪线穿过中文** | 给"严肃议题"加一笔"灵动" | 改成 V4 直线 / V5 装饰圆点 |
| **3 栏数字 + 引号 + 标题 + 描述** | 一句话主张的 3 个支撑点 | 改成 V6 5 栏 / V7 2 栏 |
| **全幅图** | 视觉重量强 | 改成 V8 卡片化（不 fullbleed） |

---

## 四、配色归一表

| 截图原色 | 归一变量 | 出现位置 |
|----------|----------|----------|
| 深色背景（森林） | `var(--c-bg)` 或图本身 | 全幅 bg |
| 红色波浪线 | `var(--c-accent)` | 波浪线 |
| 红色数字 01/02/03 | `var(--c-accent)` | 序号 |
| 红色引号 "" | `var(--c-accent)` | 卡片引号 |
| 白色标题/正文 | `#fff` / `rgba(255,255,255,.78)` | 标题描述 |
| 暗蒙版 | `rgba(0,0,0,.65–.85)` | 底部蒙版 |

> **铁律**：暗 bg 排版时，所有文字必须浅色（白色/brand/accent），禁止用 `var(--c-ink-soft)` 浅灰——在暗底上会糊。

---

## 五、CSS 骨架

```css
/* L18 · 全幅暗 bg + 双语双标题 + 波浪线 + 暗蒙版三栏 */
.l18-wrap{position:absolute;inset:0;overflow:hidden;}
.l18-bg img{width:100%;height:100%;object-fit:cover;}
.l18-bg::after{content:'';position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.25) 0%,rgba(0,0,0,.4) 35%,rgba(0,0,0,.75) 70%,rgba(0,0,0,.9) 100%);}
/* 左上角的模块名走全平台统一的 .slide-header，这一版没有自己的 logo / pill */
.l18-headline{position:absolute;top:18%;left:5%;right:5%;display:grid;grid-template-columns:1fr 1fr;gap:60px;z-index:2}
.l18-en{font-size:clamp(60px,7vw,96px);font-weight:800;color:#fff;line-height:1.0;letter-spacing:-.01em;}
.l18-cn{position:relative;font-size:clamp(76px,9vw,112px);font-weight:300;color:#fff;line-height:1.05;letter-spacing:.04em;z-index:1}
/* 波浪线是 `.l18-cn` 里内嵌的那个 <svg>（见下面 build-part），不是伪元素：
   `clip-path:path()` 那一版只在这份 md 里存在过，template.html 里没有这条规则，
   于是模型照 md 写完之后中文标题上一条线都没有 —— 这一页照样渲染、类名校验也过。 */
.l18-cn svg{position:absolute;left:0;right:0;top:48%;width:100%;height:14px;z-index:2;pointer-events:none}
.l18-lead{grid-column:2;justify-self:end;max-width:600px;margin-top:28px;text-align:right;font-size:20px;line-height:1.85;color:rgba(255,255,255,.8);z-index:2}
.l18-cards{position:absolute;bottom:13%;left:5%;right:5%;display:grid;grid-template-columns:repeat(3,1fr);gap:56px;z-index:2;}
.l18-card{position:relative;color:#fff;}
.l18-card .quote{font-family:Georgia,serif;font-size:54px;color:var(--c-accent);line-height:1;margin-bottom:4px;}
.l18-card .num{font-size:56px;font-weight:700;color:var(--c-accent);font-style:italic;font-family:var(--serif);margin-bottom:10px}
.l18-card .title{font-size:25px;font-weight:700;margin-bottom:12px;}
.l18-card .desc{font-size:18px;color:rgba(255,255,255,.8);line-height:1.8;}
```

---

## 六、build-part 结构模板

```html
<section class="slide">
  <!-- 包装层是 section 里的第一个 div，不要把 l18-wrap 加到 <section> 上 -->
  <div class="l18-wrap">
    <!-- 全幅背景图（左上角那行模块名由代码统一贴，这里不要写） -->
    <div class="l18-bg"><img src="/ppt-cases/ph-16x9.svg" data-img-prompt="这一格要什么图（中文一句话）" alt=""></div>

    <!-- 顶部双标题 -->
    <div class="l18-headline">
      <div class="l18-en">{{en_title_line1}}<br>{{en_title_line2}}</div>
      <!-- 波浪线：这个 <svg> 必须写出来，CSS 里没有伪元素版本（漏了就是一条线都没有） -->
      <div class="l18-cn">{{cn_title_line1}}<br>{{cn_title_line2}}
        <svg viewBox="0 0 600 14" preserveAspectRatio="none"><path d="M0 9 Q 50 0 100 8 T 200 8 T 300 8 T 400 8 T 500 8 T 600 8" fill="none" stroke="var(--c-accent)" stroke-width="4"/></svg>
      </div>
      <!-- 中文标题下的右对齐说明（2–4 行）。不需要就整块删掉；`grid-column:2` 由 CSS 给，别改成放进 .l18-cn 里 -->
      <div class="l18-lead">{{cn_lead_2_4_lines}}</div>
    </div>

    <!-- 底部 3 栏卡片（暗蒙版自然覆盖） -->
    <div class="l18-cards">
      <div class="l18-card">
        <div class="quote">&ldquo;</div>
        <div class="num">01</div>
        <div class="title">{{item1_title}}</div>
        <div class="desc">{{item1_desc}}</div>
      </div>
      <div class="l18-card">
        <div class="quote">&ldquo;</div>
        <div class="num">02</div>
        <div class="title">{{item2_title}}</div>
        <div class="desc">{{item2_desc}}</div>
      </div>
      <div class="l18-card">
        <div class="quote">&ldquo;</div>
        <div class="num">03</div>
        <div class="title">{{item3_title}}</div>
        <div class="desc">{{item3_desc}}</div>
      </div>
    </div>
  </div>
</section>
```

> **design 提示**：波浪线只有内嵌 `<svg>` 这一种写法（`.l18-cn svg` 是 template 里唯一那条规则）。

---

## 七、图槽位

- `pXX_hero`（必填 · 1 个） · 全幅图，1920×1080，**深色氛围图**（森林光束 / 暗海面 / 星空 / 雾林），禁用浅色明亮图与产品 closeup

---

## 八、变体（6 个）

- **V1 镜像**：英文改右中文改左（适合中文为主英文为辅的语境）
- **V2 浅底版**：去掉全幅图，背景改浅米 + 文字改深色（接近 L17 但保留双标题）
- **V3 单语 + 单巨字**：去掉右侧中文，只保留英文巨字（更克制）
- **V4 直线代替波浪线**：用 1 根 4px 直线穿过中文（更工业感）
- **V5 5 栏卡片**：从 3 栏改 5 栏（适合 5 个论点）
- **V6 2 栏卡片**：从 3 栏改 2 栏（适合 2 个论点）
- **V7 不 fullbleed**：背景改 `.slide-inner` 内的暗色块（减弱全幅视觉重量）
- **V8 去掉波浪线**：只保留双语对照（更学术风）

---

## 九、design 提示

- **视觉**：重（暗 bg + 大字 + 暗蒙版三栏，气场最强之一）
- **是否全幅**：是（**不包 `.slide-inner`**，与 L11/L13/L19/L21/L22 同级 fullbleed）
- **build-part 决策**：section 标注 `fullbleed:true`，build-part 决定性跳过 `.slide-inner` 包裹
- **关键约束**：
  - 暗 bg 上禁止用浅灰字（`var(--c-ink-soft)`），所有正文必须用 `rgba(255,255,255,.78)` 这种带透明度的白色
  - 双语双标题必须中英对仗工整（行数对齐、字号比例约 1:1.2）
  - 波浪线的位置由 `.l18-cn svg`（top:48%）定死，build-part 里只管把那个 `<svg>` 写出来
  - 3 栏卡片间距 ≥ 40px（暗底上卡片靠得近会糊在一起）

---

## 十、气质关键词

- 暗氛围 · 议题重量 · 双语对照 · 灵动 + 严肃并存
- 适合：文化议题、品牌宣言、概念章节扉页、生活方式品牌主张

---

> 与 L13 区别：L13 是"全幅+居中垂直堆叠+径向渐变"；L18 是"全幅+横向双标题+暗蒙版三栏"，是"双视角/双主张"版式。
> 与 L21 区别：L21 是"全幅+左文+右数据栏"；L18 是"全幅+顶双语双标题+底 3 支撑点"，更"议题感"少"数据感"。
