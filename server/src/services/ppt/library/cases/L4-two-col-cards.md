# L4 · `two-col-cards`（双卡对比 · 左橙右蓝）

> **📄 详情**：design 阶段匹配到 L4 时**必读**。
> **★ 核心原则**：结构是灵魂，颜色/内容不绑死 —— 所有配色只用 `var(--c-*)`。
> **★ CSS 在 `library/template.html` 的公共段里（`.two-col` / `.card.orange` / `.card.blue`），这份 md 不抄一份。**

---

## 一、结构速览

- **比例**：16:9 横版，标题在上、两张等宽卡片居中占满剩下的高度
- **是否全幅**：否 —— 全部内容包在 `.slide-inner` 里
- **核心手法**：① 两块对立的内容各占一半；② 左橙右蓝是**语义**不是装饰（见下）；③ 每张卡只有"小标题 + 一段"，不放列表
- **一页一个主角**：主角是"两者的差别"，所以两张卡的字数要接近 —— 一张三行一张八行的话，
  读起来像"右边那个才是我们推荐的"，而那可能不是他的意思

---

## 二、结构拆解

1. **主标题**（`.page-title`）—— 写出**对比的维度**（"两种落地路径，代价不一样"），不要只写"方案对比"
2. **色条**（`.title-bar`）
3. **双卡**（`.two-col` + inline `style="flex:1;align-content:center"`；不给 `flex:1` 的话两张卡贴在标题下面、下半页空一大块）
   - 左卡 `.card orange`（品牌色左边框 + 暖底）
   - 右卡 `.card blue`（强调色左边框 + 冷底）
   - 每张卡里：`<h3>`（30px，`var(--c-ink-deep)`，`margin-bottom:18px`）+ `<p>`（19px，`line-height:1.9`）

**左橙右蓝的语义是固定的**：左 = 先发生的 / 我们主张的 / 正面，右 = 后发生的 / 代价 / 对照。
反着放不报错，但整份 deck 里别的页也在用同一套色（`.data-card` 的数字是品牌色、`.point-bar` 是暖底），
颜色的含义一旦在某一页翻过来，读者要重新学一遍，而那一页看起来完全正常。

---

## 三、build-part 结构模板

```html
<section class="slide">
  <!-- 左上角那行模块名由代码统一贴，这里不要写 -->
  <div class="slide-inner">
    <h1 class="page-title">{{写出对比的维度}}</h1>
    <div class="title-bar"></div>
    <div class="two-col" style="flex:1;align-content:center">
      <div class="card orange">
        <h3 style="font-size:30px;color:var(--c-ink-deep);margin-bottom:18px">{{左侧小标题}}</h3>
        <p style="font-size:19px;line-height:1.9">{{左侧一段，2–3 句}}</p>
      </div>
      <div class="card blue">
        <h3 style="font-size:30px;color:var(--c-ink-deep);margin-bottom:18px">{{右侧小标题}}</h3>
        <p style="font-size:19px;line-height:1.9">{{右侧一段，2–3 句}}</p>
      </div>
    </div>
  </div>
</section>
```

---

## 四、图槽位

0 个（这是纯文字版式）。想配图的话每张卡顶部加一个 ≤200px 的小图标位：

| 槽位 | 必填? | 模式 | 比例 | 构图要求 |
|------|-------|------|------|----------|
| `pXX_ic1` / `pXX_ic2` | 可选 | concept | 1:1 | 单色扁平图标感，两张必须同一路画风（一张扁平一张写实的话，两张卡看起来不是一组） |

---

## 五、变体

| 编号 | 变化 | 用途 |
|------|------|------|
| V1 | 三卡（`.two-col` 换成 inline `grid-template-columns:repeat(3,1fr)`） | 三个并列选项 —— 但 3 个同构单元优先用 L10/L15 |
| V2 | 卡里的段落换成 2–3 条 `.point-bar` | 每边有多个要点 |
| V3 | 上下堆叠（inline `grid-template-columns:1fr`） | 前后两个阶段而非左右对立 |
| V4 | 两张卡都用 `.card`（不加 orange/blue） | 两边是平等的两个模块，不是对立 |

---

## 六、design 提示

- **视觉轻**：纯文字页，前后可以直接接图重的版式（L2 / L11 / L13）
- **字数铁律**：每张卡 ≤ 4 行（约 80 字）。放不下就说明这不是"对比"而是"两个章节"，该拆成两页
- **与 L9 的区别**：L9 是**图**的前后对比（两张图 + 箭头），L4 是**文字**的对立
- **与 L15 的区别**：L15 是三栏克制排版（无卡片描边），L4 有明确的卡片边界和色彩语义
