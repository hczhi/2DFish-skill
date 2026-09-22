# L58 · `quote-photo-stamp`（金句页：全幅实物特写 + 空心英文水印 + 巨幅居中宣言 + 巨型水印汉字）

> **📄 详情**：本文件供 design 阶段匹配到 L58 时**必读**。
> **★ 核心原则**：结构是灵魂，颜色/内容不绑死。所有配色必须用 `var(--c-*)` 变量。

---

## 一、结构速览

- **比例**：16:9，**一张实物/意象特写照铺满整页**（一颗番茄、一只手、一台设备的局部、一片水面），**没有蒙版**（暗调靠照片自己），整页只有**一句话**（约 20–60 字）
- **核心手法**：三层叠 —— ① 底层照片 ② 两层**水印**（左上一行 172px 的**空心**英文 + 右下角一个 460px 的**巨型汉字**，都只露一半、被画面裁掉）③ 最上层画面正中的 96px 衬线白色宣言 + 一行加宽字距的品牌色副题；左下角两行英文小字
- **是否全幅**：**是** —— 不包 `.slide-inner`（照片和两层水印都要出画）
- **页眉照旧贴**：这一条是过渡/内容页，左上角那行模块名由代码贴（`.slide-header`，44–100px），**md 和模型都不要自己写**
- **什么时候用**：章节之间**换一口气**、或者结尾立一句主张，而这句话有**具体的物**可以配图（产品、原料、现场、材料）

---

## 二、结构拆解（由后到前）

### 1. 照片 · `.l58-bg`

- `<img>` 铺满 + `object-fit:cover`；**上面没有任何蒙版**（原来 `.l58-bg::after` 那层 `rgba(10,16,22,.62)` 已删 —— 它和「这一页的蒙版」滑块叠起来整本发灰）。
- **于是「照片自己够暗」是整条唯一的可读性依赖**：实物特写通常有大片高光（果皮、金属、水面），
  要的是**暗调、逆光、深色背景**的那一路；亮底特写进来，白字压在亮部只是「若隐若现」，
  浏览器、`checkPage`、导出全都不报错。不够暗时拉「这一页的蒙版」滑块到 20–35%。
- 照片要**特写、简单、别有文字**：主体填满画面、背景干净。给一张远景图或构图很花的图，那句 96px 的字会落在杂乱处，那几个字就读不出来了（要远景请换 L59）。

### 2. 两层水印 · `.l58-echo` / `.l58-char`

- `.l58-echo` 是**空心英文**：`color:transparent` + `-webkit-text-stroke:2px rgba(255,255,255,.28)`。**两句必须同时在**——只写 `color:transparent` 是一整行看不见的字（画面上什么都没有，像「这一行没写」）；只写描边不写透明色是一行厚重的白字，直接和金句抢主角。
- `.l58-echo` 一行、`white-space:nowrap`、**≤12 个字符**（172px 下 13 个字符起就冲出右边缘被 `overflow:hidden` 切掉半个字母 —— 水印本来就出画一点，所以切多切少画面上都「像是故意的」）。写全大写的英文单词或年份，别写汉字（汉字描边糊成一团）。
- `.l58-char` 是右下角那个 460px 的**巨型汉字**，`rgba(255,255,255,.1)`：**只能一个字**（第二个字整个在画面外，白写了）。挑金句里的题眼（鲜 / 稳 / 快 / 准 / 新）。
- 两层都是 `z-index:1`、正文是 `z-index:2`。**别去动这两个值**：反过来是水印压在金句上，看起来只是「这一页有点脏」。
- `.l58-echo` 的 `top:128px` 是给页眉让位（代码贴的那条带在 44–100px）。往上挪的话模块名和水印叠在一起，而两行都在、看着像设计。

### 3. 宣言 · `.l58-main`

- `top:50%` + `translateY(-46%)`（比正中略低一点，给上方水印留呼吸），`text-align:center`，**不要给 `.l58-wrap` 写 padding**（全幅版式通例，`designSpec.test.ts` 拦这件事）。
- 宣言**必须写成 `<h1 class="page-title">`**（页脚目录面板靠 `h1.page-title` 取标题）。**一行 ≤14 个汉字、最多 2 行**：96px 下 15 字顶到边缘，第 3 行会压到左下那两行英文上。断行用 `<br>`，断在**语义停顿处**。
- 题眼用 `<em>`（非斜体，转 `var(--c-brand)`），**只标一处**。
- **不要自己加中文引号**（这一条靠尺寸和留白立住，不靠引号；加了之后 96px 的引号会把字数挤掉两个）。
- `.l58-sub` 是一行品牌色副题（26px、字距 .28em，**≤18 字**）：说这句话**接下来指向哪一段**。当过渡页时这一行是必须的 —— 没有它，读的人不知道这一页是在收上一段还是开下一段。

### 4. 左下英文小字 · `.l58-en`

- 两行英文全大写（用一个 `<br>` 断开），品牌色 16px、字距 .18em。**每行 ≤34 个字符**。
- 它是画面左下的配重：去掉之后整页只有正中一团字，四角全空，看起来像「没排完」。

---

## 三、CSS 骨架

```css
/* L58 金句页：全幅实物特写 + 空心英文水印 + 巨幅居中宣言 + 巨型水印汉字（全幅） */
.l58-wrap{position:absolute;inset:0;overflow:hidden}
.l58-bg{position:absolute;inset:0;z-index:0}
.l58-bg img{width:100%;height:100%;object-fit:cover;display:block}
.l58-echo{position:absolute;left:var(--pad-x);top:128px;z-index:1;font-family:var(--num);font-size:172px;font-weight:800;line-height:1;letter-spacing:.01em;white-space:nowrap;color:transparent;-webkit-text-stroke:2px rgba(255,255,255,.28)}
.l58-char{position:absolute;right:-30px;bottom:-120px;z-index:1;font-family:var(--serif);font-size:460px;font-weight:900;line-height:1;color:rgba(255,255,255,.1)}
.l58-main{position:absolute;left:var(--pad-x);right:var(--pad-x);top:50%;transform:translateY(-46%);z-index:2;text-align:center}
.l58-main .page-title{font-family:var(--serif);font-size:96px;font-weight:900;line-height:1.24;letter-spacing:.03em;color:#fff;margin-top:0;text-shadow:0 10px 40px rgba(6,12,20,.5)}
.l58-main .page-title em{font-style:normal;color:var(--c-brand)}
.l58-sub{margin-top:34px;font-size:26px;font-weight:700;letter-spacing:.28em;color:var(--c-brand)}
.l58-en{position:absolute;left:var(--pad-x);bottom:92px;z-index:2;font-family:var(--num);font-size:16px;font-weight:800;line-height:1.7;letter-spacing:.18em;color:var(--c-brand)}
```

---

## 四、build-part 结构模板

```html
<section class="slide" data-layout="L58">
  <!-- 全幅：不包 .slide-inner。左上角那行模块名由代码统一贴，这里不要写 -->
  <div class="l58-wrap">
    <div class="l58-bg">
      <img src="/ppt-cases/ph-16x9.svg" alt="" data-img-prompt="这一句金句要配什么特写（中文一句话：实物/局部特写、主体填满画面、背景干净）" data-img-mode="concept">
    </div>
    <div class="l58-echo">{{一个全大写英文单词或年份，12 字符内}}</div>
    <div class="l58-char">{{金句里的题眼，一个汉字}}</div>
    <div class="l58-main">
      <h1 class="page-title">{{金句上半，}}<br>{{下半，题眼用 <em> 包起来}}</h1>
      <div class="l58-sub">{{一行副题：接下来讲什么，18 字内}}</div>
    </div>
    <div class="l58-en">{{英文第一行}}<br>{{英文第二行}}</div>
  </div>
</section>
```

---

## 五、图槽位

| 槽位 | 必填? | 模式 | 比例 | 构图要求 |
|------|-------|------|------|----------|
| `pXX_hero` | **必填**（没有图这一页是一块深灰底 + 一句话，和 L7 撞脸还少了底纹） | concept | 16:9 | **实物/意象特写**：主体填满画面、背景干净、中间偏暗；**不要远景**（远景换 L59）、**不要带文字的图**、不要人脸特写 |

---

## 六、变体

| 编号 | 变化 | 用途 |
|------|------|------|
| V1 | 去掉 `.l58-char` | 金句里挑不出单字题眼 |
| V2 | 去掉 `.l58-echo` | 这份稿子不带英文 |
| V3 | `.l58-sub` / `.l58-en` 改 `var(--c-accent)` | 照片偏暖，想让点缀色更冷 |
| V4 | 宣言不写 `<em>` | 整句是一体的，挑不出题眼 |
| V5 | 宣言写一行（不写 `<br>`） | 一句 12 字以内 |
| V6 | 去掉 `.l58-en` | 左下不放英文（此时 `.l58-char` 一定要留，不然左下右下全空） |

---

## 七、design 提示

- **整页只有一句话**：这一条的功能就是「空出一页只放一句主张」，往里加要点列表、卡片、数据就把它变成一页普通的图文页了（而画面完全正常）
- **图必须自己是暗的**（版式里一层蒙版都没有）：白字压在实物高光上只是「若隐若现」，不报错
- **`-webkit-text-stroke` 和 `color:transparent` 必须成对**：少一句是「一整行看不见」或「一行厚白字抢主角」
- **`.l58-char` 只能一个汉字**；**`.l58-echo` 只能一行 ≤12 字符、不写汉字**
- **水印是 `z-index:1`、正文是 `z-index:2`**，别对调（水印压字，看起来只是「这一页有点脏」）
- **宣言一行 ≤14 字、最多 2 行；副题 ≤18 字**：超了从边缘被 `overflow:hidden` 静默切掉
- **不要自己加中文引号**
- **配色**：宣言 `#fff`、题眼和副题 `var(--c-brand)`、两层水印 `rgba(255,255,255,.28)` / `.1`
- **整份最多两页金句**（L7 / L58 / L59 加起来），而且**不要和另一张全幅照片页相邻**（连着两页整幅深色照片，翻起来像同一页没动）
- **与 L7 的区别**：L7 是**零图**、暖底纹 + 四角线 + 引文卡（手上没图、或者不想再来一张照片时用）；L58 是**一张实物特写照**打底、两层水印、白字压图
- **与 L59 的区别**：L59 是**远景**照 + 金句下面还挂一排圆形节点（「这句主张由哪几件事支撑」）；L58 整页只有一句话，一个支撑点都不给
- **与 L13 / L55 的区别**：那两条是**封面**（不贴页眉、位置固定在整份第 1 页）；L58 是过渡/结尾页，页眉照旧贴
