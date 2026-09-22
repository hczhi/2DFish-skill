# L3 · `case-hero`（左 54% 案例文字 + 右 64% 大图，两者重叠靠渐变过渡）

> **📄 详情**：design 阶段匹配到 L3 时**必读**。
> **★ 核心原则**：结构是灵魂，颜色/内容不绑死 —— 所有配色只用 `var(--c-*)`。
> **★ CSS 在 `library/template.html` 的公共段里（`.hero-case` / `.hc-name` / `.point-bar` …），这份 md 不抄一份。**

---

## 一、结构速览

- **比例**：16:9 横版。图占右 64%（绝对定位贴右边缘），文字区宽 54% —— **两者故意重叠**，
  重叠那一段由 `.hero-case::after` 的左向渐变吃掉。改成 36%+64% 不重叠的话，
  文字右边缘和图的硬边贴在一起，画面上是一条竖缝。
- **是否全幅**：**否** —— 文字包在 `.slide-inner` 里，并给它 `style="width:54%"`。
  不给宽度的话文字会一直排到图上面（`.slide-inner` 默认满宽），末尾几个字压在图的亮处，读起来只是「这行字有点糊」。
- **核心手法**：① 企业名当视觉主角（衬线 72px，关键词橙字下划线）；② 三条编号战绩（`.point-bar`）；③ 图给"现场感"
- **不放页码**：`.page-badge` / `.wm` / `.hc-no` 都已废弃，当前页和总页数都不要写

---

## 二、结构拆解（左侧文字区，由上至下）

1. **案例编号 + 行业**（`.kicker`）—— `CASE 01 · 精密制造` 这种，编号是内容的一部分（不是页码）
2. **企业名 / 项目名**（`.hc-name`，衬线 72px，line-height 1.1）
   - 里面用 `<b>` 包一个词就**自动**是品牌色 + 下划线（`.hc-name b`）。
     **不要自己写 `color` 或 `text-decoration`** —— 写死的那个色不跟 palette 变，
     整份换配色之后就剩这一处还是原来的橙，而它读起来只是"这两个字强调了"。
3. **三条战绩**（`.point-bar` × 3，22px，每条前面一个 `.ic` 圆点数字）
   - 每条一句话，**带数字**（"排产从 3 人 2 天压到 1 人 40 分钟"）。写成"效率大幅提升"这种的话
     这一页就没有信息，而版式看起来是满的。
   - 3 条最稳；4 条要把 `.slide-inner` 的 gap 收到 18px；5 条起换 L5 或 L10。

---

## 三、build-part 结构模板

```html
<section class="slide">
  <!-- 右侧大图（左上角那行模块名由代码统一贴，这里不要写） -->
  <div class="hero-case" style="background-image:url(/ppt-cases/ph-16x9.svg)" data-img-prompt="这一格要什么图（中文一句话）" data-img-mode="case"></div>
  <div class="slide-inner" style="width:54%;justify-content:center;gap:26px">
    <div class="kicker">{{CASE 01 · 行业}}</div>
    <div class="hc-name">{{企业名，关键词用 <b> 包起来自动橙字下划线}}</div>
    <div class="point-bar"><span class="ic">1</span>{{战绩一，带数字}}</div>
    <div class="point-bar"><span class="ic">2</span>{{战绩二，带数字}}</div>
    <div class="point-bar"><span class="ic">3</span>{{战绩三，带数字}}</div>
  </div>
</section>
```

---

## 四、图槽位

| 槽位 | 必填? | 模式 | 比例 | 构图要求 |
|------|-------|------|------|----------|
| `pXX_hero` | ✅ 必填 | case | 16:9 | 现场/产线/办公/产品实景，**主体偏右**（左边 1/3 被渐变吃掉）；半写实 mockup 也可以 |

图贴在 `.hero-case` 的 `background-image` 上，`data-img-prompt` 写在**同一个 div** 上。
**禁用**：抽象概念插画（案例页要"真的发生过"的感觉）、图表、人物 closeup。

---

## 五、变体

| 编号 | 变化 | 用途 |
|------|------|------|
| V1 | 镜像：`.hero-case` 加 `style="left:0;right:auto"`，`.slide-inner` 加 `margin-left:46%` | 连续两页案例时换气 |
| V2 | 战绩改 2 条 + 一段引语（`.quote-card`） | 客户原话比数字更有力时 |
| V3 | 企业名下加一行 `.kicker` 当一句话定位 | 对方不知名，需要一句介绍 |
| V4 | 图收到 54%（inline `width:54%`） | 战绩条太长 |

---

## 六、design 提示

- **视觉中等偏重**：一页只讲一个客户。两个客户同屏用 L9（前后对比）或 L8（图廊）
- **字号铁律**：`.hc-name` ≥ 60px（它是主角），`.point-bar` ≤ 24px；两者拉不开的话读起来像一份带标题的清单
- **与 L1 的区别**：L1 是**观点**页（金句主角），L3 是**案例**页（企业名主角 + 编号战绩）
- **与 L14 的区别**：L14 是上图下双栏信息（信息密度更高），L3 是左文右图单段式
