# L5 · `stat-grid`（数据网格 · 2×2 或 1×3 大数字）

> **📄 详情**：design 阶段匹配到 L5 时**必读**。
> **★ 核心原则**：结构是灵魂，颜色/内容不绑死 —— 所有配色只用 `var(--c-*)`。
> **★ CSS 在 `library/template.html` 的公共段里（`.data-card` / `.data-card .v`），这份 md 不抄一份。**

---

## 一、结构速览

- **比例**：16:9 横版，标题在上、数字卡网格居中占满剩下的高度
- **是否全幅**：否 —— 全部内容包在 `.slide-inner` 里
- **核心手法**：① 一页只放 3–4 个数；② 每个数配一句**说明它是什么**的话；③ 数字用等宽数字字体 + 品牌色渐变，是这一页唯一的视觉重量
- **底色**：section 上可以加 `cool`（成效/盘点类的页通常走冷色），也可以不加

---

## 二、结构拆解

1. **主标题**（`.page-title`）—— 写出这几个数**是哪个时间窗口的**（"上线 9 个月的四个数"）。
   不写窗口的话读者会当成"当前值"，而那可能差一年 —— 页面上看不出任何异常。
2. **色条**（`.title-bar`）
3. **网格**（一个 `<div>` 用 inline style，不需要类名）
   - 2×2：`flex:1;display:grid;grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;gap:46px 64px;align-content:center`
   - 1×3：`flex:1;display:grid;grid-template-columns:repeat(3,1fr);gap:64px;align-content:center`
4. **每格**（`.data-card`，左边一道品牌色粗线）
   - 数字（`.v`）：**不要给它写 `color`** —— 它是 `background-clip:text` 的渐变文字，
     写了 `color` 就把渐变盖成纯色，而画面上只是"这版数字没有渐变"，一处都不报错。
   - 单位和符号直接写在数字里（`62%` / `2.4h` / `0.7‰`），**≤ 5 个字符**：再长会换行，
     那一格的数字掉到第二行、和下面的说明挤在一起，读起来像"这一格没排好"。
   - 说明（`<p>`，20px，`margin-top:12px`）—— 一句话，可以带上对照值（"平均响应时长（原 11.6 小时）"）

---

## 三、build-part 结构模板

```html
<section class="slide cool">
  <!-- 左上角那行模块名由代码统一贴，这里不要写 -->
  <div class="slide-inner">
    <h1 class="page-title">{{标题，写出时间窗口}}</h1>
    <div class="title-bar"></div>
    <div style="flex:1;display:grid;grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;gap:46px 64px;align-content:center">
      <div class="data-card"><div class="v">{{62%}}</div><p style="font-size:20px;margin-top:12px">{{这个数是什么}}</p></div>
      <div class="data-card"><div class="v">{{2.4h}}</div><p style="font-size:20px;margin-top:12px">{{这个数是什么}}</p></div>
      <div class="data-card"><div class="v">{{18}}</div><p style="font-size:20px;margin-top:12px">{{这个数是什么}}</p></div>
      <div class="data-card"><div class="v">{{0.7‰}}</div><p style="font-size:20px;margin-top:12px">{{这个数是什么}}</p></div>
    </div>
  </div>
</section>
```

---

## 四、图槽位

0 个（数字本身就是视觉主角）。**不要给这一页配图** —— 一张概念插画会和四个大数字抢，
而两者都不弱，翻起来是一页"哪儿都想看"的幻灯片。要图表感的页用 L21（全幅图 + 右侧三数据栏）。

---

## 五、变体

| 编号 | 变化 | 用途 |
|------|------|------|
| V1 | 1×3 横排 | 只有 3 个数 |
| V2 | 1×2 大格（数字提到 80px inline） | 只有 2 个数，要更压场 |
| V3 | 每格加一行 `.kicker` 当英文标签 | 双语/国际化场景 |
| V4 | 2×3 六格（数字收到 44px inline） | 指标看板 —— 6 个是上限，再多没人记得住 |

---

## 六、design 提示

- **视觉中等**：数字重但页面空，前后可以接图重的版式
- **数字铁律**：3–4 个最好，1 个用 L7/L2（整页一句话），≥ 6 个说明这该是一张表而不是一页 PPT
- **不要编数**：拿不到真实数字时宁可少放一格 —— 编出来的数在这个版式里是整页最显眼的东西
- **与 L21 的区别**：L21 是全幅图 + 左文右数据（气场强），L5 是浅底纯数据（清晰、好读）
- **与 L6 的区别**：L6 是阶段推进（有时间顺序），L5 的四个数之间**没有顺序**
