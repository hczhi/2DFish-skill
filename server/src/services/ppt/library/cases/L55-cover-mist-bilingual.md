# L55 · `cover-mist-bilingual`（封面：全幅气氛照 + 左侧竖线双语小字 + 衬线巨标题 + 中英副标题 + 左下落款）

> **📄 详情**：本文件供 design 阶段匹配到 L55 时**必读**。
> **★ 核心原则**：结构是灵魂，颜色/内容不绑死。所有配色必须用 `var(--c-*)` 变量。

---

## 一、结构速览

- **比例**：16:9，**一张全幅气氛照**（雾山、水面、园区远景那一路），深色斜向蒙版压住左半，全部文字是白的（约 60–110 字）
- **核心手法**：文字全部**左对齐、只占左 2/3**，右半让给照片主体；从上到下三块各自定位 —— ① 左上一竖条（2px 半透白竖线）后面两行双语小字 ② 画面纵向居中的标题组：104px 衬线巨标题 → 一道 62px 品牌色短杠 + 加宽字距的中文副标题 → 两行全大写英文 ③ 左下角落款（一枚品牌色小印 + 中文日期地点 + 一行英文小字）
- **是否全幅**：**是** —— 不包 `.slide-inner`（照片和蒙版要铺满，文字用 `var(--pad-x)` 对齐）
- **只当整份第 1 页用**（`归属` 只写封面）
- **什么时候用**：主题有**气氛/地域/意境**（文旅、康养、园区、城市更新、年度开篇），而且手上有一张淡的远景照片

---

## 二、结构拆解（由后到前）

### 1. 照片与蒙版 · `.l55-bg`

- `<img>` 铺满 + `object-fit:cover`；`::after` 是一层 **94deg 斜向、从左浓（.74）到右淡（.12）** 的深蓝黑蒙版。
- **蒙版是白字能不能读的唯一依赖**：气氛照本身很亮（天、雾、水面），去掉之后标题压在亮处，出来是一页「标题若隐若现」的封面，一处都不报错。别把方向改成从右往左（文字全在左半）。
- 照片要**淡、远、留白多**：主体（塔/山/楼）在**右半**。主体居中或偏左的照片进来，标题压在结构线上，那几个字就读不出来了。

### 2. 左上双语小字 · `.l55-eyebrow`

- 结构是 `<b>`（两行英文全大写，中间一个 `<br>`，`var(--num)` 21px、字距 .2em）+ `<span>`（一行中文小字，字距 .36em，可以用 `·` 隔开几个词）。
- 左边那道 2px 半透白竖线是 `border-left`，**不要改成一个 `<div>`**（多一个空块的话它和 `padding-left` 一起算，小字整体右移 24px 而竖线还在原处）。
- 这一条不贴统一页眉，所以顶部那条带子是空的：`top:104px` 就是给它留的位置，**别往上挪到 44px 以内**。

### 3. 标题组 · `.l55-main`

- `top:50%` + `translateY(-52%)` 钉在画面纵向中偏上，**不要给 `.l55-wrap` 写 padding**（全幅版式的通例：模型一句 inline `style="padding:40px"` 就把整条顶掉，三块一起挪，而那一页照样渲染 —— `designSpec.test.ts` 拦这件事）。
- 标题**必须写成 `<h1 class="page-title">`**（页脚目录面板靠 `h1.page-title` 取标题）。**一行 ≤14 个汉字、最多 2 行**：104px 下 15 个字就顶到右边缘，第 3 行会把中英副标题推到落款上。主题词可以用 `<em>`（非斜体，转 `var(--c-brand)`），**只标一处**。
- `.l55-cn` 是中文副标题：`::before` 那道 62px 品牌色短杠 + `letter-spacing:.34em`，**一行 ≤16 字**（字距很宽，18 个字就超出画面）。这道杠和这个字距是这一条的签名，去掉之后就是「一张图上写了行标题」。
- `.l55-en` 是**两行全大写英文**（`var(--num)` 23px、字距 .12em、`max-width:1240px`）：一行写不满就让它自己折，别手动断行。**中英两级都要写**（只留中文的话画面上半是中文、下半空一块，看起来像少了一段）。
- `text-shadow` 不要删（雾景亮处的白字会糊在一起，而画面看起来只是「有点飘」）。

### 4. 左下落款 · `.l55-sign`

- `<i>`（一枚 40px 品牌色小印，**空元素**，`border-radius:14px 4px 14px 4px` 是它的样子）+ 一个 `<div>` 里 `<b>`（中文地点/日期，19px）和 `<span>`（一行英文小字，`var(--num)` 13px）。
- `<b>` 和 `<span>` **必须包在同一个 `<div>` 里**：并列写在 `.l55-sign` 下面的话，flex 会把它们排成一横排，落款变成「印 · 中文 · 英文」一条线。
- `<i>` 里一个字都不要写（它是纯色块，写了字会被挤成一团）。

---

## 三、CSS 骨架

```css
/* L55 封面：全幅气氛照 + 左侧竖线双语小字 + 衬线巨标题 + 中英副标题 + 落款（全幅） */
.l55-wrap{position:absolute;inset:0;overflow:hidden}
.l55-bg{position:absolute;inset:0;z-index:0}
.l55-bg img{width:100%;height:100%;object-fit:cover;display:block}
.l55-bg::after{content:"";position:absolute;inset:0;background:rgba(16,30,46,.62)}
.l55-eyebrow{position:absolute;left:var(--pad-x);top:104px;z-index:2;padding-left:24px;border-left:2px solid rgba(255,255,255,.55)}
.l55-eyebrow b{display:block;font-family:var(--num);font-size:21px;font-weight:700;line-height:1.5;letter-spacing:.2em;color:#fff}
.l55-eyebrow span{display:block;margin-top:12px;font-size:15px;font-weight:700;letter-spacing:.36em;color:rgba(255,255,255,.78)}
.l55-main{position:absolute;left:var(--pad-x);right:var(--pad-x);top:50%;transform:translateY(-52%);z-index:2}
.l55-main .page-title{font-family:var(--serif);font-size:104px;font-weight:900;line-height:1.16;letter-spacing:.02em;color:#fff;margin-top:0;text-shadow:0 8px 34px rgba(8,18,30,.42)}
.l55-main .page-title em{font-style:normal;color:var(--c-brand)}
.l55-cn{display:flex;align-items:center;gap:22px;margin-top:36px;font-size:30px;font-weight:700;letter-spacing:.34em;color:#fff}
.l55-cn::before{content:"";flex:none;width:62px;height:2px;background:var(--c-brand)}
.l55-en{margin-top:20px;max-width:1240px;font-family:var(--num);font-size:23px;font-weight:700;line-height:1.55;letter-spacing:.12em;color:rgba(255,255,255,.8)}
.l55-sign{position:absolute;left:var(--pad-x);bottom:96px;z-index:2;display:flex;align-items:center;gap:20px}
.l55-sign i{flex:none;width:40px;height:40px;border-radius:14px 4px 14px 4px;background:var(--c-brand);font-style:normal}
.l55-sign b{display:block;font-size:19px;font-weight:700;letter-spacing:.16em;color:#fff}
.l55-sign span{display:block;margin-top:7px;font-family:var(--num);font-size:14px;font-weight:700;letter-spacing:.2em;color:rgba(255,255,255,.62)}
```

---

## 四、build-part 结构模板

```html
<section class="slide" data-layout="L55">
  <!-- 全幅：不包 .slide-inner。封面页不贴统一页眉（代码不贴，这里也不要写） -->
  <div class="l55-wrap">
    <div class="l55-bg">
      <img src="/ppt-cases/ph-16x9.svg" alt="" data-img-prompt="封面气氛图要什么（中文一句话：远景、雾/天/水、主体在右半、整体偏淡）" data-img-mode="case">
    </div>
    <div class="l55-eyebrow">
      <b>{{英文第一行}}<br>{{英文第二行}}</b>
      <span>{{一行中文小字，可用 · 隔开}}</span>
    </div>
    <div class="l55-main">
      <h1 class="page-title">{{主标题，一行 14 字内，最多 2 行}}<em>{{要上品牌色的那个词，可省}}</em></h1>
      <div class="l55-cn">{{中文副标题，16 字内}}</div>
      <div class="l55-en">{{两行全大写英文，写满一行会自己折}}</div>
    </div>
    <div class="l55-sign">
      <i></i>
      <div>
        <b>{{地点 · 日期}}</b>
        <span>{{一行英文小字}}</span>
      </div>
    </div>
  </div>
</section>
```

---

## 五、图槽位

| 槽位 | 必填? | 模式 | 比例 | 构图要求 |
|------|-------|------|------|----------|
| `pXX_cover` | **必填**（没有图这一页就是一块深蓝底） | case | 16:9 | 远景气氛照：**主体（塔/山/楼/水面）在右半**、左半是天/雾/水这种干净的淡区；整体偏淡偏冷；**不要人脸特写、不要带文字的图、不要主体居中** |

---

## 六、变体

| 编号 | 变化 | 用途 |
|------|------|------|
| V1 | 去掉 `.l55-en`（只留中文副标题） | 这份稿子不带英文 |
| V2 | 去掉 `.l55-sign` 里的 `<span>`（只留中文落款） | 没有英文落款 |
| V3 | `<i>` 和短杠改 `var(--c-accent)` | 照片偏暖、想让点缀色更冷 |
| V4 | 标题不写 `<em>` | 整句是一体的，挑不出主题词 |
| V5 | `.l55-eyebrow` 只写 `<b>`（去掉中文小字） | 顶部只放英文 |
| V6 | 标题写 2 行（`<br>` 手动断行） | 一句 20 字左右、想控制断点 |

---

## 七、design 提示

- **只当整份第 1 页**：它没有页眉、也没有留给正文的空间；章节扉页用 L2 / L41
- **必须有一张淡的远景照片、主体在右半**：主体居中或很暗的照片进来，标题压在结构线上读不出来，而那一页照样渲染
- **蒙版一层都不能去**（`.l55-bg::after`）：白字压在亮天空上只是「若隐若现」，不报错
- **文字全部左对齐**：改成居中的话它就变成另一条封面（居中堆叠那一档），而这一条的样子全在「左 2/3 文字 + 右 1/3 照片主体」这个分配上
- **一行 14 字内、最多 2 行；中文副标题 16 字内**：超了从右边缘被 `overflow:hidden` 静默切掉
- **中英两级副标题都要写**，`.l55-cn` 前面那道品牌色短杠和 `.34em` 字距是签名
- **配色**：全部白字（`#fff` / `rgba(255,255,255,.8)` / `.62`），短杠和落款小印 `var(--c-brand)`，`<em>` 走 `var(--c-brand)`
- **同一份里封面只能一条**：和 L56 / L34 / L35 / L2 / L13 里任何一条并存都会变成「连着两页都在开场」
- **与 L13 的区别**：L13 是居中堆叠（年份 + 巨字 + 双语居中），四周收暗；L55 是**左对齐**、斜向蒙版、带落款
- **与 L34 的区别**：L34 是三条幕帘 + 一条横贯白带（字在白带里）；L55 是一张整图 + 字直接压在图上
- **与 L56 的区别**：L56 是**亮照片压深色字**、主角是两行英文巨字 + 一排能力标签（企业形象）；L55 是**暗照片压白字**、主角是中文衬线巨标题（气氛/意境）
