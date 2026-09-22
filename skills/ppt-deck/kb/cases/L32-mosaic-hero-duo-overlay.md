# L32 · `mosaic-hero-duo-overlay`（全幅三图拼贴：左一张主图通高 + 右两张辅图，文字压在各自图上）

> **📄 详情**：本文件供 design 阶段匹配到 L32 时**必读**。
> **★ 核心原则**：结构是灵魂，颜色/内容不绑死。所有配色必须用 `var(--c-*)` 变量。

---

## 一、结构速览

- **比例**：16:9，**整页三张图拼满**（左 1.34fr 通高 + 右上/右下各一张），6px 缝隙，信息密度中等
- **核心手法**：① 左侧主图 `grid-row:1 / span 2` 占满两行，图上压 kicker + 56px 衬线主标题 + 一段说明；② 右侧两张辅图各压一个小标题 + 一行说明；③ 三张图统一一层**上淡下浓**的暗蒙版（`.1 → .86`），文字全部压在各自图块的**下缘**
- **是否全幅**：**是** —— 内容不包 `.slide-inner`（三张图要拼满整页）
- **主次是靠面积给的**：左图是主角、右两张是并列的两个变体/两个侧面。三张等重的图请用 L11
- **底色**：默认不加类（缝隙露出 `var(--c-bg)`）

---

## 二、结构拆解

### 1. 拼贴网格 · `.l32-wrap`

- `grid-template-columns:1.34fr 1fr` + 两行，`.l32-a` 靠 `grid-row:1 / span 2` 占满左列。**漏了这一句三张图会变成"上二下一"**，主次关系反过来，而页面照样渲染。
- 缝隙 6px 露出 deck 底色，是"拼贴"这件事的唯一信号 —— 改成 0 之后三张图糊成一张。

### 2. 主图块 · `.l32-a`

- 图上依次：`.l32-kick`（英文/编号小标，字距 `.22em`，品牌色）→ `<h1 class="page-title">`（56px 衬线，**必须是 h1.page-title**，页脚目录面板靠它取标题）→ `<p>`（一段说明，`max-width:660px`）。
- 三者都包在 `.l32-txt` 里（绝对定位压在图块下缘）。不包的话文字回到网格流里，会把图挤出格子。

### 3. 辅图块 · `.l32-b` / `.l32-c`

- 各一个 `.l32-txt` > `<h3>`（小标题）+ `<p>`（**一行**，17px）。写成两三行的话文字会顶到图块上沿，把那张图看不见了。
- 两张辅图是**并列关系**（两个版本、两个侧面），不是"第二第三步" —— 有顺序的用 L25 / L29。

### 4. 蒙版

- 三块都要 `::after` 蒙版（上 `.1` → 下 `.86`）。少给一块的话那一块的白字在亮图上直接看不见 —— 而另两块完全正常，看起来像"这张图选得不好"。

---

## 三、CSS 骨架

```css
/* L32 不等宽三图拼贴（全幅） */
.l32-wrap{position:absolute;inset:0;overflow:hidden;display:grid;grid-template-columns:1.34fr 1fr;grid-template-rows:1fr 1fr;gap:6px;background:var(--c-bg)}
.l32-a{position:relative;grid-row:1 / span 2;overflow:hidden}
.l32-b{position:relative;overflow:hidden}
.l32-c{position:relative;overflow:hidden}
.l32-wrap img{width:100%;height:100%;object-fit:cover;display:block}
.l32-a::after,.l32-b::after,.l32-c::after{content:"";position:absolute;inset:0;background:rgba(0,0,0,.65)}
.l32-txt{position:absolute;left:0;right:0;bottom:0;z-index:2;padding:52px 58px;color:#fff}
.l32-kick{font-size:16px;font-weight:700;letter-spacing:.22em;color:var(--c-brand);margin-bottom:14px}
.l32-a .page-title{font-family:var(--serif);font-size:56px;font-weight:900;line-height:1.2;color:#fff;margin-top:0}
.l32-txt h3{font-size:30px;font-weight:800;line-height:1.3;color:#fff}
.l32-txt p{margin-top:14px;font-size:19px;line-height:1.75;color:rgba(255,255,255,.8)}
.l32-a .l32-txt p{max-width:660px}
.l32-b .l32-txt p,.l32-c .l32-txt p{font-size:17px}
```

---

## 四、build-part 结构模板

```html
<section class="slide" data-layout="L32">
  <div class="l32-wrap">
    <div class="l32-a">
      <img src="/ppt-cases/ph-1x1.svg" alt="" data-img-prompt="主图配什么（中文一句话，竖长方构图、主体在上半张、下缘留白给文字）" data-img-mode="case">
      <div class="l32-txt">
        <div class="l32-kick">{{英文小标或编号}}</div>
        <h1 class="page-title">{{主标题，一到两行}}</h1>
        <p>{{一段说明，≤ 60 字}}</p>
      </div>
    </div>
    <div class="l32-b">
      <img src="/ppt-cases/ph-16x9.svg" alt="" data-img-prompt="右上辅图配什么（中文一句话，横构图、主体在上半张）" data-img-mode="case">
      <div class="l32-txt">
        <h3>{{小标题}}</h3>
        <p>{{一行说明}}</p>
      </div>
    </div>
    <div class="l32-c">
      <img src="/ppt-cases/ph-16x9.svg" alt="" data-img-prompt="右下辅图配什么（中文一句话，横构图、主体在上半张）" data-img-mode="case">
      <div class="l32-txt">
        <h3>{{小标题}}</h3>
        <p>{{一行说明}}</p>
      </div>
    </div>
  </div>
</section>
```

---

## 五、图槽位

| 槽位 | 必填? | 模式 | 比例 | 构图要求 |
|------|-------|------|------|----------|
| `pXX_a` | **必填** | case | 1:1 | 左侧主图（约 1100×1080，`cover` 裁切）：主体在**上半张**，下缘 40% 会被蒙版压到 `.86` 给文字 |
| `pXX_b` / `pXX_c` | **必填**（两张一起） | case | 16:9 | 右侧两张辅图（各约 800×537）：主体在**上半张**；两张要同一路调性，且都别和主图撞构图 |

**禁用**：三张全都是特写（拼在一起没有主次）、主体压在下缘的图（被蒙版吞掉）、任何带文字的图（拼贴之后像三张海报）

---

## 六、变体

| 编号 | 变化 | 用途 |
|------|------|------|
| V1 | 主图在右（`grid-template-columns:1fr 1.34fr` + `.l32-a{grid-column:2}`） | 和上一页镜像 |
| V2 | 右列三张（`grid-template-rows:repeat(3,1fr)` + 加一个 `.l32-c` 同构块） | 三个侧面 |
| V3 | 辅图去掉文字（只留主图那块） | 辅图纯气氛 |
| V4 | 缝隙提到 14px（`gap:14px`） | 想更"卡片化" |
| V5 | 主标题改无衬线（`font-family:var(--sans)`） | 全份都是无衬线标题时 |

---

## 七、design 提示

- **视觉重**（整页三张图）：**不要和 L11 / L13 / L21 / L22 相邻**（连着全是图页，翻页时看不出换了页）
- **左图通高是结构签名**：三块等分之后这一页就变成"三图并列"，和 L11 重了
- **配色**：kicker `var(--c-brand)`；图上的字一律 `#fff` / `rgba(255,255,255,.8)`，**不要用 `var(--c-ink-soft)` 或 `var(--c-ink)`**（在图上糊成一团）
- **与 L11 的区别**：L11 是三图等宽叙事（三段并列），L32 是**一主两辅**
- **与 L22 的区别**：L22 是上下堆叠的两段"图 + 信息块"，L32 是左右拼贴、文字全压在图上
- **辅图那两行说明必须一行**：这一条最容易坏在这儿 —— 两行之后辅图只剩顶上一条边
