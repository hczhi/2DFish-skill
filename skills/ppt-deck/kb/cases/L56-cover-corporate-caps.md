# L56 · `cover-corporate-caps`（封面：亮调实景 + 中文口号 + 两行英文巨字 + 一排能力标签 + 深色署名块）

> **📄 详情**：本文件供 design 阶段匹配到 L56 时**必读**。
> **★ 核心原则**：结构是灵魂，颜色/内容不绑死。所有配色必须用 `var(--c-*)` 变量。

---

## 一、结构速览

- **比例**：16:9，**一张亮调实景照**（厂区、车间、办公楼、产线那一路），左侧一层浅色幕帘压住照片，文字全部是**深色**的（约 60–120 字）
- **核心手法**：左侧一列从上到下 —— ① 一句 32px 中文口号（`h1.page-title`）② **两行 82px 全大写英文**（这一条的主角）③ 一道 88px 品牌色粗杠 ④ 一排 3–5 个能力标签（中文粗体 + 下面一行英文小字，用竖细线隔开）⑤ 一块深色实底 + 白字的公司署名；右上角一行英文标记；画面底部一条 12px 品牌色通栏
- **是否全幅**：**是** —— 不包 `.slide-inner`（照片和幕帘要铺满，文字用 `var(--pad-x)` 对齐）
- **只当整份第 1 页用**（`归属` 只写封面）
- **什么时候用**：**企业形象/实力**类开场（制造、装备、工程、供应链、品牌总览），主题能拆出 3–5 个并列能力词，而且手上有一张亮的实景照

---

## 二、结构拆解（由后到前）

### 1. 照片与幕帘 · `.l56-bg`

- `<img>` 铺满 + `object-fit:cover`；`::after` 是一层 **92deg、从左几乎不透明（.94）到 84% 处全透明** 的浅底幕帘。
- **L55 是暗照片压白字，这一条是亮照片压深色字 —— 幕帘的方向和明度都反过来**。把它换成深色蒙版之后，深色文字压在深色蒙版上，出来是一页「文字若隐若现」的封面，一处都不报错。
- 照片主体（楼/设备/产线）必须在**右半**：主体在左半的话它整块被幕帘洗白，右边空着，看起来像「这张图没加载好」。

### 2. 右上标记 · `.l56-mark`

- 一行英文/字母标记（`var(--num)` 16px、字距 .26em、深墨色），右对齐到 `var(--pad-x)`。
- 这一条不贴统一页眉，`top:96px` 就是给它留的位置。**里面不要放 `<img>` 当 logo**（template 里没有给它定尺寸的规则，图会按原始宽度铺开压住整个右上角）。

### 3. 中文口号 · `h1.page-title`（在 `.l56-main` 里）

- **必须写成 `<h1 class="page-title">`**（页脚目录面板靠 `h1.page-title` 取标题）—— 也就是说**中文那一行才是标题**，虽然它只有 32px、比下面的英文小得多。写在英文那一块上的话目录面板里出现的是一串英文。
- 一行 ≤22 字，可以用 ` · ` 把两个短句连起来。字距 .08em 是它读起来「像口号」的原因。

### 4. 两行英文巨字 · `.l56-caps`

- **这一条的视觉主角**：`var(--num)` 82px、两个 `<span>`（每个自己一行，`display:block`），**全大写**。
- **每行 ≤16 个字符**（含空格）：82px 下 17 个字符就顶到右边缘，被 `overflow:hidden` 从右侧静默切掉半个字母。
- 想强调某个词用 `<em>`（非斜体，转 `var(--c-brand)`），**只标一处**。
- **不要把中文写大、英文写小**。这一条的样子全在「小中文 + 巨英文」这个反差上，倒过来之后它就是一页普通的照片封面（和 L2 / L34 撞脸），而画面完全正常。
- **两行都要写**（只写一行的话下面那道粗杠会贴到英文上，中间的呼吸没了）。

### 5. 能力标签 · `.l56-tags`

- `3–5 个 <div>`，每个里面 `<b>`（中文 2–6 字）+ `<span>`（一行英文小字，`var(--num)` 12px）。
- 竖细线是每个 `<div>` 的 `border-left`，**`:first-child` 那条必须靠 `.l56-tags div:first-child` 清掉**（这条规则已经在 template 里了，不要在 md 或 inline 里再写一份）。
- **最多 5 个**：第 6 个之后整排从右边缘被 `overflow:hidden` 切掉，而前 5 个排得好好的 —— 看起来像「就设计了 5 个」。
- 中文和英文两行都要有（只写中文的话每一格高度掉一半，整排看起来像一行普通的面包屑）。

### 6. 深色署名块 + 底部通栏 · `.l56-org` / `.l56-rail`

- `.l56-org` 是 `display:inline-block` 的深墨实底 + 白字（公司/团队全称，≤18 字）：**`inline-block` 是它只包住文字的原因**，改成 `block` 之后那块深色会横贯整个左栏，压掉画面下半的照片。
- `.l56-rail` 是贴着画面底沿的 12px 品牌色通栏，是**唯一把这张淡照片和整份稿子的品牌色绑在一起的东西**（另一处是那道 88px 粗杠）。去掉之后这一页看起来像别人家的模板。

---

## 三、CSS 骨架

```css
/* L56 封面：亮调实景 + 中文口号 + 英文巨字 + 能力标签 + 深色署名块（全幅） */
.l56-wrap{position:absolute;inset:0;overflow:hidden}
.l56-bg{position:absolute;inset:0;z-index:0}
.l56-bg img{width:100%;height:100%;object-fit:cover;display:block}
.l56-bg::after{content:"";position:absolute;inset:0;background:rgba(250,248,244,.80)}
.l56-mark{position:absolute;right:var(--pad-x);top:96px;z-index:2;font-family:var(--num);font-size:16px;font-weight:800;letter-spacing:.26em;color:var(--c-ink-deep)}
.l56-main{position:absolute;left:var(--pad-x);top:50%;transform:translateY(-50%);z-index:2;max-width:1120px}
.l56-main .page-title{font-family:var(--sans);font-size:32px;font-weight:800;line-height:1.4;letter-spacing:.08em;color:var(--c-ink-deep);margin-top:0}
.l56-caps{margin-top:26px;font-family:var(--num);font-size:82px;font-weight:800;line-height:1.14;letter-spacing:.04em;color:var(--c-ink-deep)}
.l56-caps span{display:block}
.l56-caps em{font-style:normal;color:var(--c-brand)}
.l56-rule{margin-top:30px;width:88px;height:5px;background:var(--c-brand)}
.l56-tags{display:flex;margin-top:34px}
.l56-tags div{padding:0 26px;border-left:1px solid var(--c-hairline)}
.l56-tags div:first-child{padding-left:0;border-left:0}
.l56-tags b{display:block;font-size:21px;font-weight:800;line-height:1.3;color:var(--c-ink-deep)}
.l56-tags span{display:block;margin-top:8px;font-family:var(--num);font-size:14px;font-weight:700;letter-spacing:.16em;color:var(--c-ink-soft)}
.l56-org{display:inline-block;margin-top:38px;padding:15px 30px;background:var(--c-ink-deep);font-size:20px;font-weight:800;letter-spacing:.1em;color:#fff}
.l56-rail{position:absolute;left:0;right:0;bottom:0;z-index:2;height:12px;background:var(--c-brand)}
```

---

## 四、build-part 结构模板

```html
<section class="slide" data-layout="L56">
  <!-- 全幅：不包 .slide-inner。封面页不贴统一页眉（代码不贴，这里也不要写） -->
  <div class="l56-wrap">
    <div class="l56-bg">
      <img src="/ppt-cases/ph-16x9.svg" alt="" data-img-prompt="封面实景图要什么（中文一句话：亮调、厂区/车间/办公楼、主体在右半）" data-img-mode="case">
    </div>
    <div class="l56-mark">{{右上角一行英文标记}}</div>
    <div class="l56-main">
      <h1 class="page-title">{{中文口号，22 字内，可用 · 连接两句}}</h1>
      <div class="l56-caps">
        <span>{{英文第一行，16 字符内}}</span>
        <span><em>{{要上品牌色的那个词}}</em>{{余下部分}}</span>
      </div>
      <div class="l56-rule"></div>
      <div class="l56-tags">
        <div><b>{{能力一}}</b><span>{{ENGLISH}}</span></div>
        <div><b>{{能力二}}</b><span>{{ENGLISH}}</span></div>
        <div><b>{{能力三}}</b><span>{{ENGLISH}}</span></div>
      </div>
      <div class="l56-org">{{公司/团队全称}}</div>
    </div>
    <div class="l56-rail"></div>
  </div>
</section>
```

---

## 五、图槽位

| 槽位 | 必填? | 模式 | 比例 | 构图要求 |
|------|-------|------|------|----------|
| `pXX_cover` | **必填**（没有图这一页左边一列字浮在米底上） | case | 16:9 | 亮调实景：厂区/车间/办公楼/产线，**主体在右半**、天光充足；**不要暗调夜景、不要人脸特写、不要带文字的图** |

---

## 六、变体

| 编号 | 变化 | 用途 |
|------|------|------|
| V1 | `.l56-tags` 放 5 个 | 能力词多、想铺满左栏 |
| V2 | 去掉 `.l56-mark` | 右上角不放标记 |
| V3 | 英文不写 `<em>` | 整句是一体的，挑不出词 |
| V4 | `.l56-rule` / `.l56-rail` 改 `var(--c-accent)` | 照片偏暖、想让点缀色更冷 |
| V5 | 去掉 `.l56-org`（署名放在末页） | 封面不署名 |
| V6 | `.l56-tags` 只放 3 个 | 能力词少，别硬凑 |

---

## 七、design 提示

- **只当整份第 1 页**：它没有页眉、也没有留给正文的空间；章节扉页用 L2 / L41
- **必须有一张亮调实景照、主体在右半**：暗照片进来深色文字就读不出来（幕帘是浅色的），而那一页照样渲染
- **主角是那两行 82px 英文巨字**：中文口号只有 32px，倒过来写这一条就和普通照片封面撞脸了
- **`h1.page-title` 是中文那一行**（页脚目录面板取它），别写在英文块上
- **英文每行 ≤16 字符、能力标签 3–5 个、口号 ≤22 字**：超了从右边缘被 `overflow:hidden` 静默切掉
- **`.l56-org` 保持 `inline-block`**；`.l56-rail` 和那道粗杠是这一页唯一的品牌色，别都去掉
- **配色**：文字 `var(--c-ink-deep)` / 小字 `var(--c-ink-soft)`，粗杠、通栏、`<em>` 走 `var(--c-brand)`，署名块底 `var(--c-ink-deep)` + `#fff` 字
- **同一份里封面只能一条**：和 L55 / L34 / L35 / L2 / L13 里任何一条并存都会变成「连着两页都在开场」
- **与 L55 的区别**：L55 是**暗气氛照压白字**、主角是中文衬线巨标题（文旅/意境）；L56 是**亮实景照压深色字**、主角是英文巨字 + 一排能力标签（企业形象）
- **与 L35 的区别**：L35 是左右分栏、右边一整张竖图；L56 是一张整幅照片被浅幕帘洗出左栏
