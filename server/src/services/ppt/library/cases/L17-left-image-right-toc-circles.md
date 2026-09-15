# L17 · `left-image-right-toc-circles`

> 50/50 横向分屏：左全幅图叠中英巨字 + 右浅米底圆圈数字目录

**截图原件**：`cases/img/L17-ref.png`（GNYS 品牌介绍页 · 在路上章节扉页）

---

## 一、适用场景

- **章节扉页 / 目录页**（强气质版）：**5 个以内**的章节（多了装不下，且多出来的会被静默裁掉），每章给一个圆圈数字 + 标题 + 一段引言
- **品牌系列入口**：5 款产品/5 条主张/5 个故事
- **跨主题导览页**：左图定调 + 右目录导览
- ❌ 不适合：单主题深挖（用 L14）、数据展示（用 L4）、封面（用 L13）

---

## 二、结构拆解（由上至下，由左至右）

### 整体 16:9 横向 50/50 分屏

- 中间无明显分界，靠色温切换（左饱和/右米底）
- 顶部通栏：左侧小 logo（GNYS） · 右侧胶囊 pill（如 "01 / 02"）

### 左 50% · 全幅图

1. 全幅背景图（场景图，**占满左半**）
2. 图正中央偏上：**白色毛笔字中文巨字**（2–4 个字，约 200–280px，行高 0.95，靠毛笔质感传达"在路上"的态度）
3. 图底部 1/3 处：**英文大写小字**（"ON THE ROAD" 风，48–64px，半透或带 1px 白色描边，深色字配白字 + 浅字配白字，按图色温灵活切换）

### 右 50% · 浅米底圆圈数字目录

1. 顶部右侧：胶囊 pill（黑色或 brand 色填充，浅色字）
2. 大标题："**CONTENTS 目录**"（CONTENTS 黑色无衬线 + 目录 brand 色衬线/手写感，约 48–64px）
3. 5 个圆圈数字纵列（每行 ≈ 16–18% 高度）：
   - 圆形直径 56–72px
   - **左：描边圆 + 数字居中**（数字粗体 24–28px，描边 brand 色，背景透明）
   - 右：标题（中文 18–22px 粗体，brand 色或深色） + 描述段（12–14px 浅灰，3–4 行，行高 1.7）

---

## 三、视觉手法（结构信号）

| 手法 | 作用 | 何时去掉 |
|------|------|----------|
| **左中毛笔字 + 左底英文小字** | 营造"在路上"的诗意感，是气质核心 | 改成 V2 左大标题居中 / V3 去掉英文小字 |
| **右圆圈 + 数字 + 标题 + 描述** | 5 段纵列=目录感 | 改成 V4 矩形 chip / V5 横排卡片 |
| **左右色温切换无分界** | 整体气质"画面感+秩序感"并存 | 改成 V6 加 1px 竖线 / V7 加竖向色带 |
| **圆圈描边（不填充）** | 视觉轻盈不抢戏 | 改成 V8 圆圈填充（用 brand 色） |

---

## 四、配色归一表（必须照此归一为变量）

| 截图原色 | 归一变量 | 出现位置 |
|----------|----------|----------|
| 蓝色毛笔字 | `var(--c-brand)` | 中文毛笔字 |
| 红色 "目录" | `var(--c-accent)` | 右半大标题"目录"二字 + 圆圈描边 |
| 浅米背景 | `var(--c-card)` | 右半底色 |
| 分隔细线 | `var(--c-hairline)` | 目录项 border-top |
| 深色描述字 | `var(--c-ink-soft)` | 描述段小字 |
| 白色毛笔字（按图色温） | `#fff` 或 `var(--c-ink-deep)` | 中文毛笔字（深色背景时） |

> **铁律**：截图原色 = 一次性的"灵感"；归一变量 = 可换肤的"工具"。**禁止硬编码色值。**

---

## 五、CSS 骨架

> 下面这段和 `template.html` 里 `.l17-*` 那一段**必须一模一样**（`caseLibrary.test.ts` 会核类名和
> 变量名）。变量名尤其不能自己编：`var(--c-text)` / `var(--c-text-2)` / `var(--c-line)` 在
> `:root` 里压根不存在，浏览器会把那一条声明整条丢掉 —— 字色掉回继承色、pill 的填充直接透明，
> 而页面照样渲染，看起来只是「这一版配色淡了点」。深字用 `--c-ink-deep`、正文 `--c-ink`、
> 浅灰 `--c-ink-soft`、细线 `--c-hairline`。

```css
/* L17 · 50/50 左图右圆圈目录 */
.l17-wrap{position:absolute;inset:0;display:grid;grid-template-columns:1fr 1fr;overflow:hidden}
.l17-left{position:relative;overflow:hidden}
.l17-left img{width:100%;height:100%;object-fit:cover}
.l17-left::after{content:'';position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.05) 0%,rgba(0,0,0,.35) 70%,rgba(0,0,0,.6) 100%)}
.l17-logo{position:absolute;top:32px;left:32px;color:#fff;font-size:18px;letter-spacing:.18em;font-weight:600;z-index:2}
.l17-pill{position:absolute;top:32px;right:32px;background:var(--c-ink);color:#fff;padding:6px 14px;border-radius:99px;font-size:14px;letter-spacing:.2em;z-index:2}
.l17-cn{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);font-size:clamp(180px,18vw,260px);font-weight:900;color:var(--c-brand);font-family:'STKaiti','KaiTi','KaiTi_GB2312',serif;letter-spacing:.04em;z-index:2;line-height:.95;mix-blend-mode:screen}
.l17-en{position:absolute;bottom:14%;left:8%;color:#fff;font-size:clamp(40px,5vw,64px);font-weight:300;letter-spacing:.32em;text-transform:uppercase;z-index:2;opacity:.85}
.l17-right{background:var(--c-card);padding:80px 72px;display:flex;flex-direction:column}
.l17-head{font-size:clamp(40px,4.4vw,60px);font-weight:800;color:var(--c-ink-deep);letter-spacing:.02em;line-height:1;margin-bottom:48px}
.l17-head .accent{color:var(--c-accent);font-weight:500;margin-left:14px;font-family:var(--serif)}
.l17-list{flex:1;display:flex;flex-direction:column;gap:0}
.l17-item{display:flex;align-items:flex-start;gap:22px;padding:14px 0;border-top:1px solid var(--c-hairline)}
.l17-item:last-child{border-bottom:1px solid var(--c-hairline)}
.l17-num{width:56px;height:56px;border-radius:50%;border:1.5px solid var(--c-accent);color:var(--c-ink);display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:700;flex-shrink:0}
.l17-item .title{font-size:18px;font-weight:700;color:var(--c-ink-deep);margin-bottom:6px}
.l17-item .desc{font-size:16px;color:var(--c-ink-soft);line-height:1.7;max-width:480px}
```

---

## 六、build-part 结构模板

```html
<section class="slide">
  <!-- 左上角那行模块名（.slide-header）由代码统一贴，这里不要写 -->
  <div class="slide-inner">
    <div class="l17-wrap">
      <!-- 左半全幅图（logo / pill 浮在图上，都是绝对定位，不占列） -->
      <div class="l17-left">
        <img src="/ppt-cases/ph-16x9.svg" data-img-prompt="这一格要什么图（中文一句话）" data-img-mode="case" alt="">
        <div class="l17-logo">品牌名</div>
        <div class="l17-pill">2025</div>
        <div class="l17-cn">在路上</div>
        <div class="l17-en">ON THE ROAD</div>
      </div>

      <!-- 右半浅米底圆圈目录 -->
      <div class="l17-right">
        <div class="l17-head">CONTENTS<span class="accent">目录</span></div>
        <div class="l17-list">
          <div class="l17-item">
            <div class="l17-num">01</div>
            <div>
              <div class="title">这一章讲什么</div>
              <div class="desc">一句话说清这一章的落点</div>
            </div>
          </div>
          <!-- 重复，最多 5 条 -->
        </div>
      </div>
    </div>
  </div>
</section>
```

> ⚠️ 三条硬的（这一页被「截断」过一次，三条各能单独造成它）：
> 1. **`l17-wrap` 只能出现在一个地方：`.slide-inner` 里那个 div 上。** 千万不要写成
>    `<section class="slide l17-wrap">` —— `.l17-wrap` 带着 `display:grid;grid-template-columns:1fr 1fr`，
>    加到 `<section>` 上等于把整张 `.slide` 变成两列，`.slide-inner` 掉进左边那一列，
>    左右两半再各砍一半宽 → 右半只剩 ~25% 宽，「CONTENTS」和目录项被 `overflow:hidden` 裁掉，
>    而画面里图还在、字也还在，看起来像「模型排版没排好」。**也不要两处都写**（外层 section
>    加一份、里面再套一个 div），那是同一个事故。
> 2. **目录项最多 5 条。** 圆圈 56px + 上下 14px + 分隔线 ≈ 每条 85px，加上 `.l17-head`（60+48）和
>    `.l17-right` 的 80px 上下内边距，第 6 条起就顶出 `.l17-wrap` 的 `overflow:hidden` ——
>    多出来的那几条**一个字都不显示、一处都不报错**，页面读起来就是一份「只有 5 章」的目录。
>    章节多于 5 个就合并同类项，或者换 L14。
> 3. 图片只写 `/ppt-cases/ph-16x9.svg` 占位 + `data-img-prompt`，配图是后面独立一步由代码换的。

> **design 提示**：左半毛笔字用 `font-family:'STKaiti','KaiTi','KaiTi_GB2312',serif`（macOS / Windows
> 自带楷体）还原截图的笔触感。`mix-blend-mode: screen` 让毛笔字自动适配底图明暗。

---

## 七、图槽位

- `pXX_hero`（必填 · 1 个） · 左半全幅图，1920×1080，**场景图为主**（人在路上/城市航拍/山野远眺），禁用纯产品 closeup 与抽象插画

---

## 八、变体（6 个）

- **V1 镜像**：右图左目录（左半放浅米目录，右半放全幅图+毛笔字）
- **V2 左改大标题居中**：去掉毛笔字，改成英文巨字 + 中文副标（接近 L13 但只占半幅）
- **V3 去掉英文小字**：只保留中文毛笔字（更克制）
- **V4 圆圈改矩形 chip**：每项用横排矩形数字 chip 代替圆形
- **V5 横排卡片**：5 项从纵列改成横排（适合每项 1–2 行短描述）
- **V6 加 1px 竖线**：左右 50/50 中间加细线分界
- **V7 圆圈填充**：用 brand 色填充圆圈，数字白色
- **V8 目录项数变 3/4**：项数不绑死 5，但**不能多于 5**（第 6 条起被裁掉且不报错，见「结构模板」下面那三条）

---

## 九、design 提示

- **视觉**：中重（毛笔字 + 大图并置，气场强）
- **是否全幅**：否（`.l17-wrap` 放在 `.slide-inner` **里面**，grid 50/50；`l17-wrap` 加到 `<section>` 上会把整页挤进左半列）
- **build-part 决策**：section 不加 `fullbleed` 类，不加 `has-card` 类，按默认排版
- **关键约束**：
  - 圆圈数字 01/02/03 必须从 1 开始递增
  - 目录项 ≤ 5 条（第 6 条起顶出 `overflow:hidden`，一个字都不显示也不报错）
  - 中文毛笔字必须用衬线/楷体（`STKaiti` / `KaiTi`），不能换无衬线
  - 圆圈描边 ≥ 1.5px，数字字重 ≥ 700（描边太细会糊）
  - 描述段行数控制在 3–4 行（多了会破坏右半视觉平衡）

---

## 十、气质关键词

- 在路上 · 章节扉页 · 诗意感 · 秩序感 · 5 项目录
- 适合：旅行品牌、文化项目、生活方式品牌、年度系列章节

---

> 与 L14 区别：L14 是"上图下信息"上下分屏；L17 是"左图右目录"左右分屏，且 L17 强调"诗意意象+秩序导览"并存。
