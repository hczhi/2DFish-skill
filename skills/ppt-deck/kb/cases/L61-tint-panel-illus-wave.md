# L61 · `tint-panel-illus-wave`（内容页：顶部浅调插画面板 + 波形下沿 + 左侧领句/两行标题/一段正文 + 底部并列小要点）

> **📄 详情**：本文件供 design 阶段匹配到 L61 时**必读**。
> **★ 核心原则**：结构是灵魂，颜色/内容不绑死。所有配色必须用 `var(--c-*)` 变量。

---

## 一、结构速览

- **比例**：16:9，上面 702px 是一块**通宽的浅蓝调面板**（下沿被一道波形弧线切开），面板里左边是领句 + 两行 62px 衬线标题 + 一段正文、右边是一张**插画/示意图**；面板下面的白区里排 2–4 条小要点。文字容量中等（约 200–320 字）
- **核心手法**：**一张插画撑住右半**（不是照片、不是数据图），左边一段话把这一页讲完；面板的波形下沿把「讲什么」和「分几条」分成两层
- **是否全幅**：**是** —— 不包 `.slide-inner`（面板和那道弧都要通宽贴边）
- **页眉照旧贴**：内容页，左上角那行模块名由代码贴（`.slide-header`，44–100px，落在面板里），**md 和模型都不要自己写**
- **什么时候用**：**要用一段话（而不是几条要点）把一件事讲清楚**，而这件事有插画/示意图可配 —— 产品说明、机制介绍、服务流程的总述；手上只有实拍照片时换 L1/L3（`contain` 摆照片会留两条空边）

---

## 二、结构拆解（自上而下）

### 1. 浅调面板 · `.l61-panel`

- `left:0;right:0;top:0;height:702px`，底色 `var(--hl-b)`（浅蓝调），`overflow:hidden`（那道弧靠它裁）。
- **面板必须是浅色的**：代码贴的那行模块名走 `.slide-header .kicker`，颜色写死在 `var(--c-accent-deep)` 上，而它落在 44–100px —— 正好落在这块面板里。换成深色实底之后模块名是深蓝压深蓝，**两处都在、看不见**（库里 L50 把色块贴右、L48 把白卡压到 `top:150px`，是同一件事的另两种解法）。真要深底的整幅页，用 L18/L19/L21 那一族。

### 2. 波形下沿 · `.l61-wave`

- 它是一块**页面底色**（`var(--c-bg)`）的方块，压在面板里、靠不对称的椭圆圆角（`58% 42% 0 0 / 128px 84px 0 0`）切出弧线，下半被面板的 `overflow:hidden` 裁掉。
- **两个圆角值不一样才有「波」的走势**：写成一样就是一个正圆顶（对称的弧看起来像气泡，不像分隔）。
- 它占的是 562–702px 这一段，所以**上面的正文必须在 560px 之前结束**（见下一条）。

### 3. 左侧文字 · `.l61-txt`

- `left:var(--pad-x);top:170px;width:42%`（806px），`z-index:3`（压在面板和那道弧之上）。
- `.l61-kicker`：一行领句/英文小字（`var(--num)` 16px、字距 .26em、`var(--c-accent-deep)`），**≤26 个字符**。
- 标题**必须写成 `<h1 class="page-title">`**（页脚目录面板靠 `h1.page-title` 取标题）。**一行 ≤12 个汉字、最多 2 行**（62px 在 806px 里 13 字顶到右边缘，而右边 49px 之外就是插画）。题眼用 `<em>`（非斜体，转 `var(--c-accent-deep)`），只标一处。
- `<p>` 一段正文，**≤110 字、最多 4 行**（20px/1.85 一行约 40 字，起点 170px + 领句 + 标题两行 + 间距，第 4 行落到 535px）：**第 5 行起那一行落到弧线下面的白区里**，看着像另起了一段（它 `z-index` 比弧高，所以不是被裁掉而是「掉出来」）。
- 这一段是**整页的主体**，别拆成 `<ul>` 要点 —— 拆了就该换并列版式，这一条的骨架给不了它对齐。

### 4. 插画 · `.l61-illus`

- `right:80px;top:96px;width:44%;height:450px`，`<img>` 一律 `object-fit:contain` + `object-position:bottom center`。
- **不能改成 `cover`**：示意图被裁掉一角之后画面上仍然是一张完整的图，只是主体缺了一块（少了一个箭头、少了半个流程节点），谁都看不出是版式裁的。
- 插画底边停在 546px（96 + 450），**不进那道弧**：往下拉的话主体下半压在弧线上，两层都在、看着像图没对齐。
- 给的是**插画/示意图**（线稿、等距图、结构示意），不是实拍照片：照片用 `contain` 摆出来左右两条空边，看起来像「图没铺满」。

### 5. 底部小要点 · `.l61-foot`

- 贴 `bottom:var(--pad-bottom)`，`display:flex` + 每格 `flex:1`，格顶一条 2px `var(--c-accent)` 的线。
- 一格 = `<b>`（小标题，**≤14 字**）+ `<span>`（一行说明，**≤26 字**）。**2–4 格**：4 格时每格 368px；5 格起每格只剩 265px，小标题换到三行，整排往上顶、和正文之间那口气没了。
- 这一排是「这件事分成哪几块」，**不是数据卡**（要摆数就换指标卡那一族）。

---

## 三、CSS 骨架

```css
/* L61 内容页：顶部浅调插画面板 + 波形下沿 + 左侧领句/两行标题/一段正文 + 底部并列小要点（全幅） */
.l61-wrap{position:absolute;inset:0;overflow:hidden;background:var(--c-bg)}
.l61-panel{position:absolute;left:0;right:0;top:0;height:702px;z-index:0;background:var(--hl-b);overflow:hidden}
.l61-illus{position:absolute;right:80px;top:96px;width:44%;height:450px;z-index:1}
.l61-illus img{width:100%;height:100%;object-fit:contain;object-position:bottom center;display:block}
.l61-wave{position:absolute;left:-8%;right:-8%;bottom:-30px;height:170px;z-index:2;background:var(--c-bg);border-radius:58% 42% 0 0 / 128px 84px 0 0}
.l61-txt{position:absolute;left:var(--pad-x);top:170px;width:42%;z-index:3}
.l61-kicker{font-family:var(--num);font-size:16px;font-weight:800;letter-spacing:.26em;color:var(--c-accent-deep)}
.l61-txt .page-title{margin-top:22px;font-family:var(--serif);font-size:62px;font-weight:900;line-height:1.2;letter-spacing:-.01em;color:var(--c-ink-deep)}
.l61-txt .page-title em{font-style:normal;color:var(--c-accent-deep)}
.l61-txt p{margin-top:26px;font-size:20px;line-height:1.85;color:var(--c-ink)}
.l61-foot{position:absolute;left:var(--pad-x);right:var(--pad-x);bottom:var(--pad-bottom);z-index:3;display:flex;gap:56px}
.l61-foot div{flex:1;padding-top:18px;border-top:2px solid var(--c-accent)}
.l61-foot b{display:block;font-size:21px;font-weight:800;line-height:1.35;color:var(--c-ink-deep)}
.l61-foot span{display:block;margin-top:9px;font-size:16px;line-height:1.65;color:var(--c-ink)}
```

---

## 四、build-part 结构模板

```html
<section class="slide" data-layout="L61">
  <!-- 全幅：不包 .slide-inner。左上角那行模块名由代码统一贴，这里不要写 -->
  <div class="l61-wrap">
    <div class="l61-panel">
      <div class="l61-illus">
        <img src="/ppt-cases/ph-16x9.svg" alt="" data-img-prompt="这一页要配什么示意图（中文一句话：插画/等距示意图，主体居中、背景干净、浅色调）" data-img-mode="concept">
      </div>
      <div class="l61-wave"></div>
    </div>
    <div class="l61-txt">
      <div class="l61-kicker">{{一行领句或英文小字}}</div>
      <h1 class="page-title">{{标题上半，}}<br>{{下半，题眼用 <em> 包起来}}</h1>
      <p>{{一段正文，110 字内、最多 4 行}}</p>
    </div>
    <div class="l61-foot">
      <div><b>{{小标题一}}</b><span>{{一行说明}}</span></div>
      <div><b>{{小标题二}}</b><span>{{一行说明}}</span></div>
      <div><b>{{小标题三}}</b><span>{{一行说明}}</span></div>
    </div>
  </div>
</section>
```

---

## 五、图槽位

| 槽位 | 必填? | 模式 | 比例 | 构图要求 |
|------|-------|------|------|----------|
| `pXX_illus` | **必填**（没有图面板右半是一块空的浅蓝，整页只剩左边一段话贴在角上） | concept | 16:9 | **插画/示意图**（线稿、等距图、结构示意），主体居中、背景干净或透明、**浅色调**（面板本来就是浅底，深重的图会把左边那段话压下去）；`contain` 摆放所以比例不严格；不要实拍照片（换 L1/L3）、不要带文字的图 |

---

## 六、变体

| 编号 | 变化 | 用途 |
|------|------|------|
| V1 | 底部小要点放 2 格 | 只分两块 |
| V2 | 去掉 `.l61-kicker` | 不带领句 |
| V3 | 去掉 `.l61-foot` | 这一页只有一段话（此时正文可写到 6 行） |
| V4 | 标题不写 `<em>` | 整句是一体的 |
| V5 | 领句、题眼、格顶线改 `var(--c-brand)` | 这一份的点缀色是暖的 |
| V6 | 面板 inline style 改 `var(--hl-o)` | 暖色调的稿子（**只能换成同样浅的底**） |

---

## 七、design 提示

- **面板只能是浅底**（`var(--hl-b)` / `var(--hl-o)` 这类浅调）：换成深色实底之后，代码贴的那行模块名（`var(--c-accent-deep)`）压在深蓝上看不见，而两处都在、页面完全正常
- **插画一律 `object-fit:contain`**：改成 `cover` 会静默裁掉示意图的一角（少一个箭头、少半个节点），画面上仍是一张完整的图
- **图要插画不要照片**：`contain` 摆照片留两条空边，看起来像「图没铺满」
- **波形那道弧的两个圆角值不许写成一样**（一样是正圆顶，读起来像气泡不像分隔）
- **正文 ≤110 字、最多 4 行**：第 5 行掉到弧线下面的白区里，看着像另起了一段
- **标题一行 ≤12 字、最多 2 行；领句 ≤26 字符；小要点 2–4 格（小标题 ≤14 字、说明 ≤26 字）**
- **正文是一整段，不要拆成要点列表**（要拆就换并列版式）；底部那一排是「分成哪几块」，**不是数据卡**
- **别给 `.l61-wrap` 写 padding**（全幅版式通例，`designSpec.test.ts` 拦这件事）
- **配色**：标题 `var(--c-ink-deep)`、领句和题眼 `var(--c-accent-deep)`、正文 `var(--c-ink)`、面板 `var(--hl-b)`、弧线和页底 `var(--c-bg)`
- **与 L1 / L3 的区别**：那两条是左右分栏 + **实拍照片**铺满半页；L61 的右半是一张 `contain` 摆的插画，而且顶上是一整块浅色面板 + 波形下沿
- **与 L60 的区别**：L60 是三段横切、底部通宽照片条、文字很少；L61 是「一段话讲清一件事」，主体是正文和插画
- **与 L18 / L19 / L21 的区别**：那一族是**深底**全幅浮信息页（白字压暗图）；L61 是浅底面板 + 深色字，深色版要的是那三条
- **整份最多两页 L61**，且别和另一页浅蓝面板页相邻（连着两页看起来像同一页没动）
