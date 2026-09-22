# L59 · `quote-scene-nodes`（金句页：全幅远景 + 居中主张 + 一排 4–6 个圆形节点 + 底部英文小字）

> **📄 详情**：本文件供 design 阶段匹配到 L59 时**必读**。
> **★ 核心原则**：结构是灵魂，颜色/内容不绑死。所有配色必须用 `var(--c-*)` 变量。

---

## 一、结构速览

- **比例**：16:9，**一张远景照铺满整页**（山、海、城市天际线、园区全景），**没有蒙版**（暗调靠照片自己），全部文字白色居中（约 60–110 字）
- **核心手法**：画面正中一列居中堆叠 —— ① 一行加宽字距的英文/年份小字 ② 76px 衬线白色主张 ③ 一句 24px 说明 ④ 一排 **4–6 个圆形节点**（圆里一个字或序号，圆下一行标签）；画面底部居中一行英文小字
- **是否全幅**：**是** —— 不包 `.slide-inner`（照片要铺满）
- **页眉照旧贴**：这一条是过渡/内容页，左上角那行模块名由代码贴（`.slide-header`），**md 和模型都不要自己写**
- **什么时候用**：**章节之间收束** —— 一句主张 + 「这句话由哪几件事支撑」；也可以当结尾页（主张 + 几条承诺）

---

## 二、结构拆解（由后到前）

### 1. 照片 · `.l59-bg`

- `<img>` 铺满 + `object-fit:cover`；**上面没有任何蒙版**（原来 `.l59-bg::after` 那层 `rgba(8,18,28,.62)` 已删 —— 它和「这一页的蒙版」滑块叠起来整本发灰）。
- **于是「照片通篇都暗」是唯一的依赖**：金句在中间、节点在下三分之一，两处都是白字 ——
  要暮色、雨雾、夜景、深色山海那一路；天空一亮，下面那排圆的白字就压在亮处读不出来，
  而那一页照样渲染、一处不报错。不够暗时拉「这一页的蒙版」滑块到 20–35%。
- 照片要**远、开阔、上下干净**：天空/水面这种大片平坦区最好。特写图进来主张会落在杂乱处（要特写请换 L58）。

### 2. 居中堆叠 · `.l59-main`

- `top:50%` + `translateY(-50%)`，`text-align:center`，**不要给 `.l59-wrap` 写 padding**（全幅版式通例，`designSpec.test.ts` 拦这件事）。
- `.l59-kicker`：一行英文/年份小字（`var(--num)` 17px、字距 .34em、半透白），**≤26 个字符**。
- 主张**必须写成 `<h1 class="page-title">`**（页脚目录面板靠 `h1.page-title` 取标题）。**一行 ≤16 个汉字、最多 2 行**（76px 下 17 字顶到边缘；第 3 行会把整列往下推，那排圆压到底部英文上）。题眼用 `<em>`（非斜体，转 `var(--c-brand)`），**只标一处**。
- `.l59-sub`：一句 24px 说明，**≤40 字、最多 2 行**（`text-align:center` 是继承来的，别改成左对齐 —— 一句居中的主张下面挂一段左对齐的说明，看起来像排错了）。

### 3. 一排圆形节点 · `.l59-nodes` / `.l59-node`

- 每个节点 = `<b>`（92px 的圆，里面**一个汉字或一个序号**）+ `<span>`（圆下一行标签，2–6 字）。
- **圆里只能放文字，不能放图标**：库里没有图标字体，写 `<i class="icon-x">` 出来是一个空圆圈，而画面上看着就像「这排图标没加载」，一处都不报错。**也不要放 `<img>`**（template 里没有给它定尺寸的规则，图会按原始宽度把圆撑破）。
- **4–6 个**：`.l59-node` 是固定 150px + `gap:54px`，6 个占 1170px（画面 1920 装得下）；**7 个起两头被 `overflow:hidden` 切掉**，而中间五个排得好好的，看起来像「就设计了这几个」。少于 4 个的话一排圆稀稀拉拉飘在中间 —— 只有两三条支撑就直接用 L58（整页一句话）。
- 圆里那个字**只能 1 个汉字或 1–2 位数字**（3 个字起在 92px 的圆里换行，圆被撑成胶囊）。
- `<b>` 和 `<span>` 都要写：只写圆的话读的人不知道那个字指什么；只写标签的话这一排就是一行普通的面包屑。

### 4. 底部英文 · `.l59-en`

- 一行居中的英文全大写小字（15px、字距 .3em、半透白），**≤50 个字符**。它是画面下缘的收边，去掉之后底部空一大块。

---

## 三、CSS 骨架

```css
/* L59 金句页：全幅远景 + 居中主张 + 一排圆形节点 + 底部英文小字（全幅） */
.l59-wrap{position:absolute;inset:0;overflow:hidden}
.l59-bg{position:absolute;inset:0;z-index:0}
.l59-bg img{width:100%;height:100%;object-fit:cover;display:block}
.l59-main{position:absolute;left:var(--pad-x);right:var(--pad-x);top:50%;transform:translateY(-50%);z-index:2;text-align:center}
.l59-kicker{font-family:var(--num);font-size:17px;font-weight:800;letter-spacing:.34em;color:rgba(255,255,255,.72)}
.l59-main .page-title{margin-top:26px;font-family:var(--serif);font-size:76px;font-weight:900;line-height:1.28;letter-spacing:.04em;color:#fff;text-shadow:0 8px 34px rgba(6,14,22,.46)}
.l59-main .page-title em{font-style:normal;color:var(--c-brand)}
.l59-sub{margin-top:26px;font-size:24px;font-weight:500;line-height:1.8;color:rgba(255,255,255,.86)}
.l59-nodes{display:flex;justify-content:center;gap:54px;margin-top:66px}
.l59-node{width:150px}
.l59-node b{display:flex;align-items:center;justify-content:center;width:92px;height:92px;margin:0 auto;border-radius:50%;border:1.5px solid rgba(255,255,255,.55);background:rgba(255,255,255,.14);font-family:var(--serif);font-size:34px;font-weight:700;color:#fff}
.l59-node span{display:block;margin-top:16px;font-size:18px;font-weight:700;line-height:1.4;color:rgba(255,255,255,.9)}
.l59-en{position:absolute;left:0;right:0;bottom:78px;z-index:2;text-align:center;font-family:var(--num);font-size:15px;font-weight:800;letter-spacing:.3em;color:rgba(255,255,255,.64)}
```

---

## 四、build-part 结构模板

```html
<section class="slide" data-layout="L59">
  <!-- 全幅：不包 .slide-inner。左上角那行模块名由代码统一贴，这里不要写 -->
  <div class="l59-wrap">
    <div class="l59-bg">
      <img src="/ppt-cases/ph-16x9.svg" alt="" data-img-prompt="这一页要配什么远景（中文一句话：山/海/天际线/园区全景，上下留白干净，整体偏暗）" data-img-mode="concept">
    </div>
    <div class="l59-main">
      <div class="l59-kicker">{{一行英文或年份小字}}</div>
      <h1 class="page-title">{{主张，一行 16 字内，题眼用 <em> 包起来}}</h1>
      <div class="l59-sub">{{一句说明，40 字内}}</div>
      <div class="l59-nodes">
        <div class="l59-node"><b>{{字}}</b><span>{{标签一}}</span></div>
        <div class="l59-node"><b>{{字}}</b><span>{{标签二}}</span></div>
        <div class="l59-node"><b>{{字}}</b><span>{{标签三}}</span></div>
        <div class="l59-node"><b>{{字}}</b><span>{{标签四}}</span></div>
      </div>
    </div>
    <div class="l59-en">{{一行英文全大写小字}}</div>
  </div>
</section>
```

---

## 五、图槽位

| 槽位 | 必填? | 模式 | 比例 | 构图要求 |
|------|-------|------|------|----------|
| `pXX_scene` | **必填**（没有图这一页是一块深灰底，那排圆没有任何依托） | concept | 16:9 | **远景/全景**：山、海、天际线、园区全景；**上下要有大片平坦干净区**（天空/水面）、整体偏暗；**不要特写**（特写换 L58）、不要带文字的图、不要人脸 |

---

## 六、变体

| 编号 | 变化 | 用途 |
|------|------|------|
| V1 | 节点放 6 个 | 支撑点多 |
| V2 | 圆里放序号（一、二、三…） | 这几件事有先后 |
| V3 | 去掉 `.l59-kicker` | 不带英文 |
| V4 | 去掉 `.l59-sub` | 主张自己就说完了 |
| V5 | 去掉 `.l59-en` | 底部不放英文 |
| V6 | 主张不写 `<em>` | 整句是一体的 |

---

## 七、design 提示

- **这一页只有「一句主张 + 几个支撑点」**：往里塞正文段落、数据卡、图表就把它变成一页普通内容页了（而画面完全正常）
- **图必须通篇都暗**（版式里一层蒙版都没有）：天空一亮，下面那排圆的白字就读不出来，不报错
- **圆里只放文字（1 个汉字或 1–2 位数字），不放图标、不放 `<img>`**
- **节点 4–6 个**：7 个起两头被 `overflow:hidden` 切掉，而中间几个排得好好的；不到 4 个就换 L58
- **每个节点 `<b>` 和 `<span>` 都要写**
- **主张一行 ≤16 字、最多 2 行；说明 ≤40 字；kicker ≤26 字符；底部英文 ≤50 字符**：超了被静默切掉或把整列往下推
- **别把 `text-align` 改成左对齐**：这一条的样子全在「居中对称」上
- **配色**：主张 `#fff`、题眼 `var(--c-brand)`、说明和标签 `rgba(255,255,255,.86)` / `.9`、kicker 和底部英文半透白
- **整份最多两页金句**（L7 / L58 / L59 加起来），而且**不要和另一张全幅照片页相邻**
- **与 L7 的区别**：L7 是**零图** + 暖底纹 + 引文卡；L59 是一张远景照打底、白字压图，而且带一排支撑点
- **与 L58 的区别**：L58 是**特写**照 + 两层水印、整页只有一句话；L59 是**远景**照 + 一排圆形节点（多了「由哪几件事支撑」这一层）
- **与 L13 / L55 的区别**：那两条是**封面**（不贴页眉、只能是整份第 1 页）；L59 是过渡/结尾页，页眉照旧贴
- **那排圆不是内容区**：每个节点只有一个字 + 一个标签，主角仍然是上面那句主张 —— 要展开讲这几件事就另起一页用「并列」形状的版式（L23 是封面那一档，别拿它当并列页用）
