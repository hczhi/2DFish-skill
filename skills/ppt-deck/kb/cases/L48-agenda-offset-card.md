# L48 · `agenda-offset-card`（目录页：底部品牌色带 + 上方错位白卡 + 两列章节条目）

> **📄 详情**：本文件供 design 阶段匹配到 L48 时**必读**。
> **★ 核心原则**：结构是灵魂，颜色/内容不绑死。所有配色必须用 `var(--c-*)` 变量。

---

## 一、结构速览

- **比例**：16:9，浅底、文字为主，底部一条品牌色带垫在白卡下面，视觉中等偏轻（约 150–320 字）
- **核心手法**：**横向错位叠压**（L35 是竖着错，这一条横着错）—— ① 一条品牌色实带贴底边通宽（`.l48-band`，高 38%）；② 一张白卡（`.l48-card`）从上方压下来盖住色带的上半（`top:150px` / `bottom:90px` / 左右各 `var(--pad-x)`），于是色带只在底部露出一条 90px、左右各露 140px；③ 卡里是「衬线大标题 + 右侧加宽字距英文」的一行标题条（`.l48-head`，2px 深色横线）+ **两列**章节条目（`.l48-rows` > `.l48-item`：编号 + 小标题 + 一句说明，每条上方一条细线）
- **是否全幅**：**是** —— 不包 `.slide-inner`（色带要贴到画面边缘）
- **底色**：默认不加类（卡片外那圈就是 deck 的 `var(--c-bg)`）
- **什么时候用**：整份的目录页 / 议程页 / 「今天讲三件事」。**不当内容页用**（它没有留给正文的地方，一条只放得下一句话）

---

## 二、结构拆解（由后到前）

### 1. 色带 · `.l48-band`

- 贴底边通宽，高 38%（=410px）。它的作用只有一个：**给白卡垫出一条露边**（底部 90px + 左右各 140px）。
- **把卡片改成贴边（`inset:0` 那种）之后色带一条都看不见**，这一页就退回「一张白卡列了几条」——
  而每一层都渲染正常、一处都不报错。三个值一起构成错位：色带的 38% + 卡片的 `top:150px` / `bottom:90px`。
- 整份走冷色时改 `var(--c-accent)`（V3）；**不要用 `var(--c-bg-alt)` 这种浅色**（和卡片外那圈浅底糊成一片，等于没有色带）。

### 2. 白卡 · `.l48-card`

- `top:150px` 是承重的：代码贴的统一页眉（`.slide-header`，占 44–100px 那条带）要落在**浅底**上。
  往上挪进 100px 以内的话模块名压在卡片边沿上 —— 蓝字压白卡读起来只是「有点挤」，看不出是错的。
- 阴影（`0 40px 90px`）是「浮在色带之上」的唯一线索，别去掉。
- 卡内是 `display:flex;flex-direction:column`：标题条固定高，条目区拿走剩下的（`flex:1`）。

### 3. 标题条 · `.l48-head`

- 左边标题**必须写成 `<h1 class="page-title">`**（页脚目录面板靠它取标题），右边 `.l48-en` 一行加宽字距英文
  （如 `CONTENTS · 06 CHAPTERS`）。标题写**这份稿子的目录标题**（「这份稿子怎么走」这种），
  不要只写「目录」两个字 —— 左上角那行模块名已经是「目录」了。
- 两者靠 `align-items:flex-end` 贴在同一条基线上；英文那段写长了会把标题挤窄（标题最多一行，18 字内）。

### 4. 条目 · `.l48-item` × 4–8

- **两列铺（`1fr 1fr`），按「先左后右」读**：条目在 HTML 里的顺序是 01 → 02 → 03…，grid 默认按行填，
  所以 01 / 02 是第一行、03 / 04 是第二行。**别按列去写**（左列写完再写右列的话，页面上读起来是
  01 03 05 / 02 04 06，编号乱跳，而每一格都正常）。
- **条目数 4–8（推荐 6，偶数）。** 实测：条目区是 321–934 那 613px，一条一行说明约 99px、
  行距 30px。奇数条时最后一格空着，看起来像漏了一章（把那一条的说明写长一点也补不回来）。
  10 条（5 行）还塞得进去但每条只剩一行说明；**12 条（6 行）起从卡片下沿漏出去压在色带上**
  （这一层故意不加 `overflow:hidden` —— 裁掉的话最后一两章凭空消失，而前面十条排得整整齐齐）。
  说明写两行时上限是 8 条。真有十几章请先合并成 6 个大块（目录本来就该是大块）。
- **不写页码。** 整份的页码只由播放器页脚和目录面板按 section 顺序算，模型编的那个数字和实际页序
  **必然**对不上，而一页写着页码的目录读起来完全正常 —— 读的人照着它去翻，翻到的是别的章
  （硬规则 3；`.page-badge` 那一族已经全库废弃，别拿 `<em>`/`<i>` 现造一个）。
- 小标题 **12 字以内**（长了换行，把那一格的说明顶下去，两列的说明就不在一条线上了）；
  说明**一句话、24 字内**，是「这一章讲什么」而不是这一章的要点清单。
- 这一页要强调的那一章加 `class="on"`（细线换成 2px 品牌色 + 编号和小标题转深品牌色），**最多一条**。

---

## 三、CSS 骨架

```css
/* L48 目录页：底部品牌色带 + 上方错位白卡 + 两列章节条目 */
.l48-band{position:absolute;left:0;right:0;bottom:0;height:38%;background:var(--c-brand);z-index:0}
.l48-card{position:absolute;left:var(--pad-x);right:var(--pad-x);top:150px;bottom:90px;z-index:1;background:var(--c-card);box-shadow:0 40px 90px rgba(0,0,0,.22);padding:56px 72px;display:flex;flex-direction:column}
.l48-head{display:flex;align-items:flex-end;justify-content:space-between;gap:40px;padding-bottom:22px;border-bottom:2px solid var(--c-ink-deep)}
.l48-card .page-title{font-family:var(--serif);font-size:52px;font-weight:900;line-height:1.1;letter-spacing:-.02em;color:var(--c-ink-deep);margin-top:0}
.l48-en{font-family:var(--num);font-size:16px;font-weight:700;letter-spacing:.3em;color:var(--c-brand-deep);padding-bottom:8px}
.l48-rows{flex:1;min-height:0;display:grid;grid-template-columns:1fr 1fr;gap:30px 72px;align-content:stretch;margin-top:34px}
.l48-item{display:grid;grid-template-columns:76px 1fr;gap:22px;align-items:start;padding-top:20px;border-top:1px solid var(--c-hairline)}
.l48-no{font-family:var(--num);font-size:38px;font-weight:800;line-height:1;color:var(--c-brand)}
.l48-item h3{font-size:25px;font-weight:800;line-height:1.3;color:var(--c-ink-deep)}
.l48-item p{margin-top:8px;font-size:17px;line-height:1.7;color:var(--c-ink)}
.l48-item.on{border-top:2px solid var(--c-brand)}
.l48-item.on h3,.l48-item.on .l48-no{color:var(--c-brand-deep)}
```

---

## 四、build-part 结构模板

```html
<section class="slide" data-layout="L48">
  <!-- 全幅：不包 .slide-inner。模块名由代码贴（.slide-header），这里不要写 -->
  <div class="l48-band"></div>
  <div class="l48-card">
    <div class="l48-head">
      <h1 class="page-title">{{这份稿子的目录标题，18 字内，别只写"目录"}}</h1>
      <div class="l48-en">{{英文小字，如 CONTENTS · 06 CHAPTERS}}</div>
    </div>
    <div class="l48-rows">
      <div class="l48-item">
        <div class="l48-no">01</div>
        <div>
          <h3>{{第一章，12 字内}}</h3>
          <p>{{这一章讲什么，一句话 24 字内}}</p>
        </div>
      </div>
      <div class="l48-item">
        <div class="l48-no">02</div>
        <div>
          <h3>{{第二章}}</h3>
          <p>{{一句话}}</p>
        </div>
      </div>
      <div class="l48-item on">
        <div class="l48-no">03</div>
        <div>
          <h3>{{要强调的那一章，最多一条加 on}}</h3>
          <p>{{一句话}}</p>
        </div>
      </div>
      <div class="l48-item">
        <div class="l48-no">04</div>
        <div>
          <h3>{{第四章}}</h3>
          <p>{{一句话}}</p>
        </div>
      </div>
    </div>
  </div>
</section>
```

---

## 五、图槽位

| 槽位 | 必填? | 模式 | 比例 | 构图要求 |
|------|-------|------|------|----------|
| —    | —     | —    | —    | **这一条不放图**：色带和白卡已经把画面分完，卡里塞图只能占掉一格条目（出来是「少了一章」的目录）。要配图的目录用带缩略图的行表那一档 |

**禁用**：任何 `<img>` / 背景图（白卡上叠图之后编号和小标题的对比度不够，而它照样渲染）

---

## 六、变体

| 编号 | 变化 | 用途 |
|------|------|------|
| V1 | 色带改贴顶边（`top:0;bottom:auto`，卡片 `top:190px`） | 整份里第二页目录，避免和上一页看起来一样 |
| V2 | 单列（inline style 把 `.l48-rows` 改成 `grid-template-columns:1fr`，4–5 条） | 章节少、每条说明想写两行 |
| V3 | 色带改 `var(--c-accent)` | 整份走冷色调 |
| V4 | 色带改 `var(--c-ink-deep)` 深带 | 严肃场合 |
| V5 | 去掉每条的说明（只留编号 + 小标题） | 章节名自己说得清 |
| V6 | 去掉 `.l48-en`（标题条只剩标题） | 不想出现英文 |

---

## 七、design 提示

- **只当目录 / 议程页**：没有留给正文的地方，一条只放得下一句话
- **错位是结构签名**：色带贴底通宽 + 白卡从上方压下来（露出底 90px、左右各 140px）；把卡片改成贴边之后色带一条都看不见，这一页退回「一张白卡列了几条」，而每一层都渲染正常
- **卡片 `top` 不许小于 150px**：代码贴的模块名占 44–100px 那条带，卡片顶上去之后蓝字压在白卡边沿上，看起来只是「有点挤」
- **条目 4–8 条（推荐偶数）**：两列按「先左后右」读，奇数条最后一格空着像漏了一章；12 条起从卡片下沿漏出去压在色带上（故意不裁）；说明写两行时上限 8 条
- **不写页码**：页码只由播放器和目录面板按顺序算，模型编的那个数字必然对不上，而写着页码的目录读起来完全正常，读的人照它去翻会翻到别的章
- **小标题 12 字内**（换行会把说明顶下去，两列的说明不在一条线上）；说明一句话 24 字内
- **配色**：色带 `var(--c-brand)`（冷色 deck 用 `var(--c-accent)`），编号 `var(--c-brand)`，`on` 那条走 `var(--c-brand-deep)`，卡片底必须 `var(--c-card)`（用 `var(--bg-plain)` 的话卡片和外圈浅底同色，整张卡消失、只剩一条橙带和悬空的文字）
- **整份只放一页**（目录本来只有一页；第二页目录用 V1 换个方向）
- **与报告风议程那一条的区别**：那一条是标题条 + 一列条目的正文页，这一条是有色带和浮卡的独立目录页
- **与 L35 的区别**：同一族的错位手法，但 L35 是**竖着**错（色块贴右 + 竖图往左错）的封面，这一条是**横着**错（色带贴底 + 卡片往上错）的目录
