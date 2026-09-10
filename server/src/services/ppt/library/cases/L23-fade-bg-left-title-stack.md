# L23 · `fade-bg-left-title-stack`（整页背景图横向渐隐 + 左侧标题/主体两段堆叠）

> **📄 详情**：本文件供 design 阶段匹配到 L23 时**必读**。
> **★ 核心原则**：结构是灵魂，颜色/内容不绑死。所有配色必须用 `var(--c-*)` 变量。

---

## 一、结构速览

- **比例**：16:9，整页背景图 + **横向**渐隐（左侧渐隐成页面底色，右侧留给整幅视觉）
- **核心手法**：① 背景图铺满整页（绝对定位 inset:0，`object-fit:cover`）；② `::after` 90deg 渐变把左侧压成近乎纯底色、右侧透出画面；③ 左侧一栏（≤58% 宽）垂直居中堆两段：**标题段**（主标题 + 副标题）和 **主体段**（署名 + 一枚胶囊标签）；④ 两段之间留一大段空白（96px），是这一条的节奏；⑤ 深色字压在左侧渐隐区上，不加任何文字阴影
- **是否全幅**：**否** —— 背景图铺满整页，但文字照旧包在 `.slide-inner` 里（同 L2 / L3）。脱出去的话标题贴着画面边缘，而疏密档（D-A/D-C 改的是 `--pad-*`）在这一页上一个像素都不动，它仍是一页完整的封面、一处都不报错。
- **不贴统一页眉**：这一条在库文件末尾的「★ 不贴统一页眉的版式」里（同 L2 / L13）—— 封面/结尾页左上角不出现模块名，主标题自己就是那一页的第一行字。
- **原色（仅供还原参考）**：浅色科技渲染图 / 深色主标题 / 品牌色副标题 / 浅色底胶囊标签

---

## 二、结构拆解（由左至右、由上至下）

### 背景 · `.l23-bg`（整页，z-index:0）

- `img` 全 cover。**视觉重心必须在右半边**：左侧被渐变压成底色，主体在那里的话整幅图只剩右边一半可读。
- `::after` 90deg 渐变（左 `.97` → 28% `.9` → 50% `.5` → 72% `.08` → 88% 透明），用 `rgba(var(--mask-rgb),…)`，所以换 palette 时渐隐色跟着整份底色走。

### 左栏 · `.l23-stack`（在 `.slide-inner` 内，`flex:1` 垂直居中，`max-width:58%`）

**标题段**
- 主标题（`.l23-mega`，82px，weight 800，`var(--c-ink-deep)`）—— 一行最多约 12 个中文字，超了就换行；两行以内。
- 副标题（`.l23-sub`，28px，weight 600，`var(--c-accent-deep)`，margin-top 22px）—— 一句话说清主标题的落点，不要第三行。

**主体段 · `.l23-meta`（margin-top 96px）**
- 署名（`.l23-owner`，22px，weight 700，`var(--c-ink-deep)`）—— 公司/团队/作者名。
- 胶囊标签（`.l23-tag`，16px，`var(--hl-b)` 底 + `var(--c-accent-deep)` 字，圆角 999px）—— 轮次、年份、场合、密级这类**短**元信息，一枚为准，最多两枚。

---

## 三、CSS 骨架

```css
/* L23 整页背景图横向渐隐 + 左侧标题/主体两段堆叠 — 详情见 cases/L23-fade-bg-left-title-stack.md */
.l23-bg{position:absolute;inset:0;z-index:0;overflow:hidden}
.l23-bg img{width:100%;height:100%;object-fit:cover;display:block}
.l23-bg::after{content:"";position:absolute;inset:0;background:linear-gradient(90deg,rgba(var(--mask-rgb),.97) 0%,rgba(var(--mask-rgb),.9) 28%,rgba(var(--mask-rgb),.5) 50%,rgba(var(--mask-rgb),.08) 72%,transparent 88%)}
.l23-stack{flex:1;display:flex;flex-direction:column;justify-content:center;max-width:58%}
.l23-mega{font-size:82px;font-weight:800;color:var(--c-ink-deep);line-height:1.14;letter-spacing:-.01em}
.l23-sub{font-size:28px;font-weight:600;color:var(--c-accent-deep);line-height:1.5;margin-top:22px}
.l23-meta{margin-top:96px}
.l23-owner{font-size:22px;font-weight:700;color:var(--c-ink-deep);letter-spacing:.02em}
.l23-tag{display:inline-block;margin-top:18px;padding:8px 20px;border-radius:999px;background:var(--hl-b);color:var(--c-accent-deep);font-size:16px;font-weight:600;letter-spacing:.08em}
```

---

## 四、build-part 结构模板

```html
<section class="slide" data-layout="L23">
  <div class="l23-bg">
    <img src="/ppt-cases/ph-16x9.svg" data-img-prompt="这一页要什么背景图（中文一句话，视觉重心在右半边）" alt="">
  </div>
  <div class="slide-inner">
    <div class="l23-stack">
      <h1 class="l23-mega">{{主标题，≤12 字一行、两行以内}}</h1>
      <div class="l23-sub">{{副标题，一句话}}</div>
      <div class="l23-meta">
        <div class="l23-owner">{{公司 / 团队 / 作者}}</div>
        <span class="l23-tag">{{短元信息，如轮次 · 年份}}</span>
      </div>
    </div>
  </div>
</section>
```

---

## 五、图槽位

| 槽位 | 必填? | 模式 | 尺寸 | 构图要求 |
|------|-------|------|------|----------|
| `pXX_bg` | ✅ 必填 | concept | 1920×1080 | 整页背景，**视觉重心在右半边**，左 1/3 留空/浅色（渐隐区要压深色字）；浅色调、通透，不要暗底 |

**禁用**：人物 closeup、密集文字截图、暗底大面积图（左侧渐隐后深色主标题读不出来）

---

## 六、变体

| 编号 | 变化 | 用途 |
|------|------|------|
| V1 | 左右镜像（图在左、文字在右，渐变方向翻转） | 视觉重心在图的左半边时 |
| V2 | 主体段去掉胶囊标签 | 没有轮次/年份这类元信息 |
| V3 | 主体段加第二枚标签 | 场合 + 日期 |
| V4 | 主标题两行 + 副标题去掉 | 标题本身就是一句话 |
| V5 | 主体段换成一行联系方式（结尾页） | 致谢 / 联系页 |

---

## 七、design 提示

- **视觉重量高**：整页图 + 82px 主标题，前后不要再接一页全幅图（L2 / L13 / L21）
- **横向渐隐是签名**：改成纵向渐变就退化成 L2（那时应该直接用 L2）
- **两段之间那段空白（96px）是节奏**：填满它（塞第三段信息、塞要点列表）之后这一条就变成一页普通的图文页，读起来只是「排得有点满」
- **不加文字阴影**：左侧已经被渐变压成底色，加了阴影反而像图上贴字（L11/L14 那种白字压图才需要）
- **配色**：主标题 `var(--c-ink-deep)`、副标题 `var(--c-accent-deep)`、标签 `var(--hl-b)` + `var(--c-accent-deep)`，一个色值都不写死
- **与 L2 的区别**：L2 是纵向遮罩 + 标题浮在浅色区（章节扉页，一句话），L23 是横向渐隐 + 左栏两段堆叠（封面/结尾，有署名和元信息）
- **与 L13 的区别**：L13 是暗底居中白字（气势），L23 是浅底左对齐深字（商务、克制）
- **当结尾页用**：主标题写「谢谢」/ 一句收尾金句，主体段换成联系方式（V5）
