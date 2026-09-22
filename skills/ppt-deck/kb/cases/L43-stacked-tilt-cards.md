# L43 · `stacked-tilt-cards`（层叠微旋转卡片：3 张带投影的图文卡，各自歪一点）

> **📄 详情**：本文件供 design 阶段匹配到 L43 时**必读**。
> **★ 核心原则**：结构是灵魂，颜色/内容不绑死。所有配色必须用 `var(--c-*)` 变量。

---

## 一、结构速览

- **比例**：16:9，浅底，标准 `.slide-inner` 排版；文字容量中等偏大（3 张卡各「小标签 + 小标题 + 2–3 行」，约 300–380 字）
- **核心手法**：整库唯一的**层叠微旋转** —— 3 张 460px 宽的白卡横排、彼此**负 16px 叠压**，每张各自 `rotate(-3° / +1.6° / -1.2°)` 并带 `0 26px 60px` 的大投影；中间那张 `z-index:2` 压在两侧上面，像三张照片摊在桌上
- **是否全幅**：否（全部内容包在 `.slide-inner` 里）
- **底色**：默认不加类（`tinted` 也好看，暖底上白卡更立体）
- **什么时候用**：三个案例 / 三个交付物 / 三张实拍图 + 说明 —— 需要"有手感"而不是"整齐"的三并列（作品集、案例三选、三个交付样张）

---

## 二、结构拆解（由上到下）

### 1. 标题 + 引言

- 直接用全局 `<h1 class="page-title">` + `.l43-lead`（21px，最多 2 行）。**不要用 `.rp-head`**：那条 2px 深色横线是报告风八条共用的，配上歪着的卡片会一半严肃一半随性。
- 引言里最好交代**这三张的排序依据**（时间 / 规模 / 阶段）—— 卡片是歪的，看不出顺序时读者会以为它们是平行的。

### 2. 卡片叠 · `.l43-deck`

- `flex:1` + `align-items:center` + `justify-content:center`：三张在剩余高度里垂直居中、水平居中。
- 叠压靠 `.l43-card + .l43-card{margin-left:-16px}`。**负值别超过 -16px**：卡内左右 padding 是 30px，而 ±3° 旋转本身就让上层卡的边往外偏十几像素 —— 再叠下去上面那张会**盖住下一张正文的左端一两个字**，而那几行看起来只是“排得紧了点”，一处都不报错。
- **只能 3 张**：`460×3 - 16×2 = 1348`，还在 1640 的内容区里；第四张之后总宽 1808 > 1640，最右那张被裁掉一半，而前三张排得整整齐齐（没有一处会报错）。
- 卡片宽度写死 `460px` + `flex:none`：改成 `1fr` 的话四张也"排得下"（各自被压窄），于是上面那条硬约束静默失效，出来是四张挤扁的卡。

### 3. 单张卡 · `.l43-card`

- 旋转角**只能 ±3° 以内**。再大卡片的角就伸出内容区、被 `.slide` 的 `overflow:hidden` 裁掉一块 —— 而那张卡片本身看起来是完整的，只是"缺了个角"。
- **投影和 1px 边一起承重**：只旋转不投影的话三张纸糊在一起，看起来像排版错位而不是层叠；只投影不旋转就退化成普通三卡（那种用 L10 / L38）。
- 中间那张 `nth-child(2){z-index:2}` 必须压在两侧上面。**不给的话最后一张最上层**，视觉重心跑到第三张，读的人以为那才是重点 —— 而画面上一切正常。
- 卡内四层：`.l43-fig`（4:3 图）→ `<b>`（加宽字距小标签，`var(--num)` 品牌色）→ `<h3>`（**10 字以内**，460px 卡宽换行会顶高整张卡）→ `<p>`（**最多 3 行**）。
- 三张的文字长度要接近：一张两行一张五行的时候，三张卡高度差一大截，层叠看起来像没排好。

---

## 三、CSS 骨架

```css
/* L43 层叠微旋转卡片（3 张） */
.l43-lead{margin-top:16px;max-width:1180px;font-size:21px;line-height:1.75;color:var(--c-ink)}
.l43-deck{flex:1;display:flex;align-items:center;justify-content:center;min-height:0;margin-top:26px}
.l43-card{position:relative;flex:none;width:460px;padding:26px 30px 30px;background:var(--c-card);border:1px solid var(--c-hairline);border-radius:18px;box-shadow:0 26px 60px rgba(28,27,26,.14);transform:rotate(-3deg)}
.l43-card + .l43-card{margin-left:-16px}
.l43-card:nth-child(2){z-index:2;transform:rotate(1.6deg) translateY(24px)}
.l43-card:nth-child(3){z-index:1;transform:rotate(-1.2deg) translateY(-12px)}
.l43-fig{position:relative;aspect-ratio:4/3;overflow:hidden;border-radius:12px;background:var(--c-bg-alt)}
.l43-fig img{width:100%;height:100%;object-fit:cover;display:block}
.l43-card b{display:block;margin-top:20px;font-family:var(--num);font-size:14px;font-weight:700;letter-spacing:.2em;color:var(--c-brand)}
.l43-card h3{margin-top:10px;font-size:28px;font-weight:800;line-height:1.35;color:var(--c-ink-deep)}
.l43-card p{margin-top:12px;font-size:18px;line-height:1.75;color:var(--c-ink)}
```

---

## 四、build-part 结构模板

```html
<section class="slide" data-layout="L43">
  <div class="slide-inner">
    <!-- 页眉由代码贴，这里不要写 -->
    <h1 class="page-title">{{标题}}</h1>
    <p class="l43-lead">{{引言，交代这三张的排序依据，最多两行}}</p>
    <div class="l43-deck">
      <div class="l43-card">
        <div class="l43-fig"><img src="/ppt-cases/ph-16x9.svg" alt="" data-img-prompt="第一张卡的图要什么（中文一句话）" data-img-mode="case"></div>
        <b>{{小标签}}</b>
        <h3>{{小标题，10 字内}}</h3>
        <p>{{说明，最多 3 行}}</p>
      </div>
      <div class="l43-card">
        <div class="l43-fig"><img src="/ppt-cases/ph-16x9.svg" alt="" data-img-prompt="第二张卡的图要什么" data-img-mode="case"></div>
        <b>{{小标签}}</b>
        <h3>{{小标题}}</h3>
        <p>{{说明}}</p>
      </div>
      <div class="l43-card">
        <div class="l43-fig"><img src="/ppt-cases/ph-16x9.svg" alt="" data-img-prompt="第三张卡的图要什么" data-img-mode="case"></div>
        <b>{{小标签}}</b>
        <h3>{{小标题}}</h3>
        <p>{{说明}}</p>
      </div>
    </div>
  </div>
</section>
```

---

## 五、图槽位

| 槽位 | 必填? | 模式 | 比例 | 构图要求 |
|------|-------|------|------|----------|
| `pXX_c1` / `pXX_c2` / `pXX_c3` | 可选，但**要么三张全有要么整页不放**（只有一两张有图时三张卡高度差一截，层叠散了） | case | 4:3 | 主体居中、构图简单（卡内只有 400×300）；**三张同一路调性**（一张实拍一张插画会让三张卡看起来不是一组） |

**禁用**：竖构图（会被 4:3 裁掉上下）、带文字的截图（400px 宽下认不出字）、四角有关键信息的图

---

## 六、变体

| 编号 | 变化 | 用途 |
|------|------|------|
| V1 | 旋转方向全反（`+3° / -1.6° / +1.2°`） | 同一份里已经用过一次 |
| V2 | 去掉图（`.l43-fig` 删掉，卡内只有标签 + 标题 + 4–5 行） | 没有可用的实拍图，文字更多 |
| V3 | 图换 1:1 方图 | 产品图/头像类 |
| V4 | 中间那张放大到 520px（`.l43-card:nth-child(2)` 上加 inline `style="width:520px"`） | 三张里有一张是主角 |
| V5 | 底色改 `tinted`（暖光底纹） | 想让白卡更跳 |
| V6 | 只放 2 张（各 520px，叠 -16px） | 只有两个案例 |

---

## 七、design 提示

- **一份里最多一页**：歪着的卡片出现两次就成了小把戏，第二处换 L10 / L38
- **只能 3 张、宽度写死 460px、叠压 -16px**：改成 `1fr` 之后四张也"排得下"（各自压窄），那条硬约束就静默失效了
- **旋转角 ±3° 以内**：再大卡片的角伸出内容区被裁掉，而卡片本身看起来是完整的
- **中间那张必须 `z-index:2`**：不给的话视觉重心跑到第三张，画面上一切正常
- **三张的文字长度要接近**：高度差一大截时层叠看起来像没排好
- **配色**：卡面 `var(--c-card)`、边 `var(--c-hairline)`、小标签 `var(--c-brand)`；投影用 `rgba(28,27,26,.14)`（和 `#stage` 那层同一路），**别用纯黑高透明度**（浅底上会发灰一片）
- **与 L10 的区别**：L10 是规整的图标行（N 个等宽卡，正正方方），L43 是三张歪着叠压的照片卡（有手感、只能 3 张）
- **与 L8 的区别**：L8 是图廊网格（只有图 + 一句说明，2–4 格），L43 每张卡有标签/标题/说明三层
- **与 L38 的区别**：L38 是纵向行表（4–6 行小图 + 说明，可扫），L43 是横向三张（要一张张看）
