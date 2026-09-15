# L65 · `toc-number-grid`（目录页：「目录 / CONTENTS」标题条 + 两列大编号条目）

> **📄 详情**：本文件供 design 阶段匹配到 L65 时**必读**。
> **★ 核心原则**：结构是灵魂，颜色/内容不绑死。所有配色必须用 `var(--c-*)` 变量。

---

## 一、结构速览

- **比例**：16:9，在 `.slide-inner` 里。标题条（左「目录」+ 右「CONTENTS」+ 2px 深线）→ 两列大编号条目，每条是「浅色巨字编号 + 章节名 + 一行说明 + 底部一条细线」
- **核心手法**：**没有图也能做目录** —— 分量全靠 96px 的幽灵编号和几条细线撑，当前章那一条把编号点成品牌色
- **是否全幅**：否（包 `.slide-inner`，留白由 `--pad-*` 给，这一层别写 padding）
- **页眉照旧贴**：目录页也贴左上角那行模块名（`.slide-header`），**由代码贴，md 和模型都不要写**
- **不放图**：图槽位 0 个
- **什么时候用**：**目录页 / 导览页，而且手上没有能用的图** —— 提案和报告的第 2 页、「本次要讲的 N 件事」、每章前重复出现的进度目录（`on` 挪到当前章）。**4–8 条**（偶数最齐，6 条最常用）。有一张好照片换 L17（≤5 章）或 L33；要露品牌色带换 L48

---

## 二、结构拆解（自上而下）

实测（1920×1080、`--pad-*` 默认那一档）：可用区 1640×862（y 100→962）。标题条 73px（100→173）、`.l65-grid` 207→962（755px）、每条 110px（编号 96px × `line-height:.9` = 86，加底部 22px 内距）、条目宽 780px（两列 `gap:80px`）、编号占 106px、文字区 648px。

### 1. 标题条 · `.l65-head`

- 左边 `h2.page-title`（46px 衬线）就写**「目录」**两个字，**必须是 `.page-title`**（页脚目录面板按它取这一页的标题）。
- 右边 `<span>` 是装饰性英文（`CONTENTS` / `AGENDA`），`var(--num)` 20px + `.28em` 字距，**别在这里写正文**。
- 两边 `align-items:baseline` 对齐在同一条基线上，下沿一条 2px 深线。

### 2. 编号条目 · `.l65-grid` / `.l65-item`

- **固定两列**（`1fr 1fr` + `gap:76px 80px`），**行高跟着内容走**，整块靠 `align-content:center` 摆在页面中间：6 条时上下各留 137px，4 条各 230px，8 条各 44px。
- **不要改成让行 `1fr` 平分高度**：平分之后每条的底细线被推到离它的字 130px 远的地方，那条线看起来是下一条的顶线 —— 六条目录读起来像三段互不相干的东西，而每一格都渲染正常。
- `.l65-num`：两位数编号（`01`–`08`），96px `var(--num)`，**色值是 `var(--c-hairline)`（很浅）**。六个 96px 的数字全用品牌色会把章节名压住，那一页读起来是一排数字。
- `.l65-txt`：`<b>` 章节名（**≤8 字、一行**）+ `<span>` 说明（**≤22 字、一行**）。文字区 648px，说明写两行会把整块顶高（上下留白变窄），四行开始压到细线上。
- **当前章那一条加 `on`**：编号转 `var(--c-brand)`、底细线变 2px 品牌色、章节名转 `var(--c-brand-deep)`。**只能有一条** —— 两条以上等于告诉观众「现在同时在讲两章」。
- **条数上限是硬的**：**奇数条最后一格空一个**（不裁不报错，看着像漏了一章）；10 条时细线已经顶到编号脚下（差 5px）；**12 条起行高被压到 63px，细线从编号身上横穿过去** —— 每一行的字都还在、一处都不报错，看起来像版式自带的删除线。

---

## 三、CSS 骨架

```css
.l65-wrap{flex:1;min-height:0;display:flex;flex-direction:column}
.l65-head{display:flex;align-items:baseline;justify-content:space-between;gap:40px;padding-bottom:18px;border-bottom:2px solid var(--c-ink-deep)}
.l65-head .page-title{font-family:var(--serif);font-size:46px;font-weight:900;line-height:1.15;letter-spacing:-.01em;color:var(--c-ink-deep);margin-top:0}
.l65-head span{flex:none;font-family:var(--num);font-size:20px;font-weight:700;letter-spacing:.28em;color:var(--c-ink-soft)}
.l65-grid{flex:1;min-height:0;margin-top:34px;display:grid;grid-template-columns:1fr 1fr;align-content:center;gap:76px 80px}
.l65-item{display:flex;align-items:flex-start;gap:26px;min-height:0;padding-bottom:22px;border-bottom:1px solid var(--c-hairline)}
.l65-num{flex:none;font-family:var(--num);font-size:96px;font-weight:800;line-height:.9;letter-spacing:-.03em;color:var(--c-hairline)}
.l65-txt{flex:1;min-width:0}
.l65-txt b{display:block;font-size:28px;font-weight:800;line-height:1.3;color:var(--c-ink-deep)}
.l65-txt span{display:block;margin-top:10px;font-size:17px;line-height:1.65;color:var(--c-ink-soft)}
.l65-item.on{border-bottom-width:2px;border-bottom-color:var(--c-brand)}
.l65-item.on .l65-num{color:var(--c-brand)}
.l65-item.on .l65-txt b{color:var(--c-brand-deep)}
```

---

## 四、build-part 结构模板

```html
<section class="slide" data-layout="L65">
  <!-- 左上角那行模块名由代码统一贴，这里不要写 -->
  <div class="slide-inner">
  <div class="l65-wrap">
    <div class="l65-head">
      <h2 class="page-title">目录</h2>
      <span>CONTENTS</span>
    </div>
    <div class="l65-grid">
      <div class="l65-item">
        <div class="l65-num">01</div>
        <div class="l65-txt">
          <b>{{第一章，8 字内}}</b>
          <span>{{这一章讲什么，22 字内一行}}</span>
        </div>
      </div>
      <div class="l65-item">
        <div class="l65-num">02</div>
        <div class="l65-txt">
          <b>{{第二章}}</b>
          <span>{{一行说明}}</span>
        </div>
      </div>
      <div class="l65-item">
        <div class="l65-num">03</div>
        <div class="l65-txt">
          <b>{{第三章}}</b>
          <span>{{一行说明}}</span>
        </div>
      </div>
      <div class="l65-item">
        <div class="l65-num">04</div>
        <div class="l65-txt">
          <b>{{第四章}}</b>
          <span>{{一行说明}}</span>
        </div>
      </div>
      <div class="l65-item">
        <div class="l65-num">05</div>
        <div class="l65-txt">
          <b>{{第五章}}</b>
          <span>{{一行说明}}</span>
        </div>
      </div>
      <div class="l65-item">
        <div class="l65-num">06</div>
        <div class="l65-txt">
          <b>{{第六章}}</b>
          <span>{{一行说明}}</span>
        </div>
      </div>
    </div>
  </div>
  </div>
</section>
```

> 当成「进度目录」用时（每章前重复出现），给当前那一条加 `on`：`<div class="l65-item on">`。

---

## 五、图槽位

**0 个** —— 这一条存在的理由就是「没有图也能做目录」。有一张好照片的话换 L17 / L33。

---

## 六、变体

| 编号 | 变化 | 用途 |
|------|------|------|
| V1 | 4 条（2×2） | 章节少；上下各留 230px |
| V2 | 8 条（2×4） | 章节多；上下各留 44px |
| V3 | 去掉各条的 `<span>` | 只有章节名的极简目录 |
| V4 | 当前章加 `on` | 每章前重复出现的进度目录 |
| V5 | 右上那句换成日期 / `PROPOSAL 2026` | 需要落年份或文件性质 |
| V6 | `.l65-num` inline 改品牌色 + `opacity:.18` | 想让编号带品牌色气质（**整页一起改**） |

---

## 七、design 提示

- **4–8 条，偶数最齐**：奇数条最后一格空一个（不裁不报错，看着像漏了一章）；**12 条起细线从编号上横穿过去**（行高被压到 63px，字都在、一处都不报错）—— 章节真有 10 个以上就先合并成大块
- **`on` 只能有一条**（两条以上是在说「现在同时在讲两章」）
- **编号色留 `var(--c-hairline)`**：六个 96px 的数字全上品牌色会把章节名压住，整页读起来是一排数字
- **别改成让行 `1fr` 平分高度**：细线会被推到离它的字 130px 远，看起来是下一条的顶线
- 章节名 ≤8 字一行、说明 ≤22 字一行（文字区 648px）；编号写两位数并走 `var(--num)`
- **左边那句就写「目录」且必须是 `h2.page-title`**（页脚目录面板按它取标题，换个类之后目录里这一页是空的）；右边那句是装饰性英文，别写正文
- **别给 `.l65-wrap` 写 padding**（留白由 `.slide-inner` 的 `--pad-*` 给）
- **配色**：标题 `var(--c-ink-deep)`、英文 `var(--c-ink-soft)`、标题条下沿 2px `var(--c-ink-deep)`、编号 `var(--c-hairline)`、章节名 `var(--c-ink-deep)`、说明 `var(--c-ink-soft)`、当前章 `var(--c-brand)` / `var(--c-brand-deep)`
- **与 L17 的区别**：L17 是左半幅照片 + 右侧圆圈数字（≤5 章、必须有图）；L65 一张图都不要
- **与 L33 的区别**：L33 是左侧编号行表 + 右侧一整列竖图（分屏）；L65 是两列铺满的编号条目
- **与 L48 的区别**：L48 靠底部品牌色带 + 错位白卡撑气质（色彩重）；L65 只有一条深线和几条细线（安静、字为主）
- **整份只有一页目录**，别和 L48 同时出现
