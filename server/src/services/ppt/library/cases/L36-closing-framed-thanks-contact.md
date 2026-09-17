# L36 · `closing-framed-thanks-contact`（结尾：全幅暗底气氛图 + 中央细框巨字 + 底部三栏联系信息）

> **📄 详情**：本文件供 design 阶段匹配到 L36 时**必读**。
> **★ 核心原则**：结构是灵魂，颜色/内容不绑死。所有配色必须用 `var(--c-*)` 变量。

---

## 一、结构速览

- **比例**：16:9，暗底（`var(--c-ink-deep)` + 压到 `.32` 的气氛图），视觉重但极简
- **核心手法**：① 一张**压暗到 .32 的全幅气氛图**当底（`.l36-bg`，上面再叠一层上下浓中段淡的纵向蒙版）；② 中央一个**1px 细线框**（`.l36-frame`，左右各缩 16%，半透白底 `.04`）里三层居中：104px 衬线巨字（「谢谢」/「以上」/一句收尾）→ 加宽字距英文小字 → 一段 2–3 行收尾话；③ 底部一条细线上的**三栏联系信息**（`.l36-contact`，单位 / 联系方式 / 日期或场合）
- **是否全幅**：**是** —— 不包 `.slide-inner`
- **只当最后一页用**（`归属` 只写结尾）
- **底色**：默认不加类（暗调由 `.l36-wrap` 自己给）

---

## 二、结构拆解（由后到前）

### 1. 气氛底 · `.l36-bg`

- 图是**压到 `.32` 的底**，不是主角。不压的话「谢谢」两个字压在一张实景照片上，而那张照片什么都没在说 —— 页面照样渲染，只是最后一页看起来像一张没做完的图片页。
- 蒙版是**上下浓、中段淡**（`.72 → .4 → .88`）：中段留给细框，上下两端沉下去托住页眉和联系信息。
- 没有配图时整个 `.l36-bg` 删掉即可（纯 `var(--c-ink-deep)` 底，V4）—— 这一条**不配图也完整**，别为了凑图硬塞。

### 2. 细框 · `.l36-frame`

- **1px + `rgba(255,255,255,.26)` 是这一条的高级感来源**。加粗到 2–3px 或换成实色块之后它立刻变成一条横幅广告，而画面照样是一页正常的结尾页。
- 半透白底只有 `.04`：它的作用是让框内比框外亮**一点点**，让人看出这是一块"取景框"。调到 `.1` 以上就成了毛玻璃卡片（那是别的语言）。
- 巨字**必须写成 `<h1 class="page-title">`**（页脚目录面板靠它取标题；换成 `<div>` 之后最后一页在目录里只剩一个页码，画面完全正常）。
- 巨字**最多 4 个汉字**（104px + `.06em` 字距）：写成一句话之后它会换行，两行 104px 把框撑到盖住底部的联系信息，而两者都还在渲染。真要写一句话就用 V2（字号降到 64px）。
- 收尾话 `.l36-say` 2–3 行、居中、`max-width:820px`。写成 5 行以上同样会把框撑下去。

### 3. 联系信息 · `.l36-contact`

- **正好三栏**（`repeat(3,1fr)`）：每栏 = `<b>`（加宽字距小标签）+ `<span>`（一行内容）。两栏时右侧空一块、四栏时每栏挤到两行，两种都照样渲染。
- 内容是**能被联系到的东西**（单位 / 邮箱或电话 / 日期或场合），不是再总结一遍观点 —— 总结用上面那段 `.l36-say`。
- 它固定在 `bottom:78px`，在页脚色带之上。**别改成 `bottom:0`**（会掉进页脚里，和页码叠在一起）。

---

## 三、CSS 骨架

```css
/* L36 暗底细框致谢 + 底部三栏联系信息（全幅结尾） */
.l36-wrap{position:absolute;inset:0;overflow:hidden;background:var(--c-ink-deep)}
.l36-bg{position:absolute;inset:0;z-index:0}
.l36-bg img{width:100%;height:100%;object-fit:cover;display:block;opacity:.32}
.l36-bg::after{content:"";position:absolute;inset:0;background:rgba(0,0,0,.75)}
.l36-frame{position:absolute;left:16%;right:16%;top:27%;z-index:2;padding:64px 72px;border:1px solid rgba(255,255,255,.26);background:rgba(255,255,255,.04);text-align:center}
.l36-frame .page-title{font-family:var(--serif);font-size:104px;font-weight:900;line-height:1.1;letter-spacing:.06em;color:#fff;margin-top:0}
.l36-en{margin-top:24px;font-family:var(--num);font-size:17px;font-weight:700;letter-spacing:.38em;color:var(--c-brand)}
.l36-say{margin:30px auto 0;font-size:22px;line-height:1.85;color:rgba(255,255,255,.76);max-width:820px}
.l36-contact{position:absolute;left:var(--pad-x);right:var(--pad-x);bottom:78px;z-index:2;display:grid;grid-template-columns:repeat(3,1fr);gap:40px;padding-top:26px;border-top:1px solid rgba(255,255,255,.2)}
.l36-contact b{display:block;font-family:var(--num);font-size:14px;font-weight:700;letter-spacing:.22em;color:rgba(255,255,255,.5);margin-bottom:10px}
.l36-contact span{display:block;font-size:21px;line-height:1.6;color:#fff}
```

---

## 四、build-part 结构模板

```html
<section class="slide" data-layout="L36">
  <!-- 全幅：不包 .slide-inner -->
  <div class="l36-wrap">
    <div class="l36-bg">
      <img src="/ppt-cases/ph-16x9.svg" alt="" data-img-prompt="收尾气氛图要什么（中文一句话，远景/夜景，会被压到 .32 当底）" data-img-mode="concept">
    </div>
    <div class="l36-frame">
      <h1 class="page-title">{{最多 4 个字，如 谢谢}}</h1>
      <div class="l36-en">{{英文小字，如 THANK YOU}}</div>
      <div class="l36-say">{{2–3 行收尾话：留下一个可以往下推的动作，不要再总结观点}}</div>
    </div>
    <div class="l36-contact">
      <div><b>{{标签，如 TEAM}}</b><span>{{单位 / 团队}}</span></div>
      <div><b>{{标签，如 CONTACT}}</b><span>{{邮箱 / 电话}}</span></div>
      <div><b>{{标签，如 DATE}}</b><span>{{日期 / 场合}}</span></div>
    </div>
  </div>
</section>
```

---

## 五、图槽位

| 槽位 | 必填? | 模式 | 比例 | 构图要求 |
|------|-------|------|------|----------|
| `pXX_bg` | 可选（没有就走 V4，纯深底同样完整） | concept | 16:9 | 全幅气氛底（1920×1080，会被压到 `.32` + 上下浓蒙版）：**远景 / 夜景 / 天际线 / 抽象肌理**，中段不要有主体（细框压在那儿）；不要人物特写、不要图表 |

**禁用**：人脸特写（压到 .32 之后是一团看不清的脸）、带文字的图、高饱和亮图（压不下去，白字发糊）、中央有主体的图

---

## 六、变体

| 编号 | 变化 | 用途 |
|------|------|------|
| V1 | 巨字改成中英双行（英文在下，`.l36-en` 提到 22px） | 双语场合 |
| V2 | 巨字降到 64px、写成一句收尾金句 | 想以一句话收场（这时去掉 `.l36-say`） |
| V3 | 细框改只有上下两条边（`border-left:0;border-right:0` 用 inline style） | 想更开阔 |
| V4 | 去掉气氛图（`.l36-bg` 删掉，纯深底） | 找不到能压暗的远景图时 |
| V5 | 联系信息改两栏 + 右侧放二维码图槽 | 需要扫码跟进 |
| V6 | 浅底版（`.l36-wrap` 改 `var(--c-bg)`，字色转深，框线用 `var(--c-hairline)`） | 整份禁用暗底页时 |

---

## 七、design 提示

- **只当最后一页**：中间用它会读成"讲完了"，后面的页翻出来像多余的
- **视觉重但极简**：前一页别再放暗底页（L29 / L32 都是暗的，连着两页会分不出这是最后一页）
- **巨字最多 4 个汉字**：换行之后框被撑到盖住底部联系信息，而两者都还在渲染
- **细框不许加粗**：1px + `.26` 白是这一条的全部气质，2px 起就是横幅广告
- **配色**：暗底上的字直接写 `#fff` / `rgba(255,255,255,…)`（**不要用 `var(--c-ink)` 系**，那几个在暗底上直接看不见）；英文小字走 `var(--c-brand)` —— 整页唯一的品牌色
- **与 L7 的区别**：L7 是浅底整页金句（还在说观点），L36 是收场（谢谢 + 怎么联系）
- **与 L2 / L13 的区别**：那两条也能当结尾，但它们是"章节封面的语气"；L36 有联系信息这一层，是**整份的最后一页**
- **与 L29 的区别**：L29 是暗底金句 + 四步回环（还在讲方法），L36 不讲任何内容
