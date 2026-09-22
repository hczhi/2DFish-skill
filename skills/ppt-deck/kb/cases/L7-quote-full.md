# L7 · `quote-full`（金句整页 · 居中大号衬线）

> **📄 详情**：design 阶段匹配到 L7 时**必读**。
> **★ 核心原则**：结构是灵魂，颜色/内容不绑死 —— 所有配色只用 `var(--c-*)`。
> **★ CSS 在 `library/template.html` 的公共段里（`.quote-card` / `.corners` / `.slide.tinted`），这份 md 不抄一份。**

---

## 一、结构速览

- **比例**：16:9 横版，一句话居中占满整页，没有标题、没有正文段
- **是否全幅**：否 —— 内容包在 `.slide-inner` 里（居中靠 `align-items/justify-content`，不是靠脱离 padding）
- **核心手法**：① 整页只有一句话；② 关键词用 `<b>` 包起来自动高亮；③ 四角细线（`.corners`）把这一句"框"成一块引文
- **底色**：`tinted`（暖底纹）是默认。冷色系的章节用 `cool`（`<b>` 的高亮会自动从暖橙换成冷蓝）

---

## 二、结构拆解

1. **section 上加 `tinted`**（或 `cool`）—— 不加的话这一页和前后的内容页同一个白底，
   而它的作用就是"换一口气"：底色不变的时候，翻到它只像是一页字特别大的内容页。
2. **四角线**（`.corners` + 四个 `<i class="tl/tr/bl/br">`）—— 四个 `<i>` 要写全，
   少一个是斜的（画面上只是"右下角好像空了一点"）。
3. **`.slide-inner` 加 inline `style="align-items:center;justify-content:center;text-align:center"`**
   —— 三个都要写：只写 `justify-content` 的话文字上下居中了但仍然左对齐，
   一句大字左贴边、右边空一大块，看起来像没排完。
4. **金句**（`.quote-card` + inline `style="font-size:58px;line-height:1.5;max-width:1240px;padding:64px 80px 58px"`）
   - 字号必须 inline 提到 **52–64px**：`.quote-card` 的默认是 34px（那是它在 L1 里当配角时的尺寸），
     不提的话这一页就是"一段居中的中等大小文字"，压不住场，而一处都不报错。
   - `max-width` 必须给：不给的话长句会拉到 `.slide-inner` 的整个宽度，一行 30 多字，读不动。
   - 关键词用 `<b>` 包 —— **自动上高亮底色**（`.quote-card b`，冷色页自动换 `--hl-b`）。
     所以**不要**自己给 `<b>` 写 `color` 或 `background`：写了就把那套自动配色盖掉，
     换 palette 之后只有这一处不跟着变。
   - 断行用 `<br>`，在**语义停顿处**断（"…不是模型，<br>是…"），不要按字数断。
   - **不要自己加中文引号**：`.quote-card::before` 已经有一个大引号，加了就是两个。
5. **出处/落点**（`<p style="margin-top:44px;font-size:22px;color:var(--c-ink-soft);letter-spacing:3px">`）
   —— 用 `—— 第二部分 · 组织与责任` 这种写法说明**接下来讲什么**。当过渡页时这一行是必须的：
   没有它，读者不知道这一页是在收上一段还是在开下一段。

---

## 三、build-part 结构模板

```html
<section class="slide tinted">
  <!-- 左上角那行模块名由代码统一贴，这里不要写 -->
  <div class="corners"><i class="tl"></i><i class="tr"></i><i class="bl"></i><i class="br"></i></div>
  <div class="slide-inner" style="align-items:center;justify-content:center;text-align:center">
    <div class="quote-card" style="font-size:58px;line-height:1.5;max-width:1240px;padding:64px 80px 58px">{{金句上半，}}<br>{{下半，关键词用 <b> 包起来}}</div>
    <p style="margin-top:44px;font-size:22px;color:var(--c-ink-soft);letter-spacing:3px">—— {{接下来讲什么}}</p>
  </div>
</section>
```

---

## 四、图槽位

0 个。**这一页配图就没有意义了** —— 它的功能是"空出一页只放一句话"，加一张图之后
它变成一页普通的图文页，而前后那两页图重的版式之间就再没有喘息的地方（画面上完全看不出问题）。

要"一句话 + 画面"的页用 L2（背景图铺满 + 浅遮罩）或 L13（全幅图叠字）。

---

## 五、变体

| 编号 | 变化 | 用途 |
|------|------|------|
| V1 | 去掉 `.corners` | 更干净；相邻页也用了四角线时 |
| V2 | 字号提到 72px、句子压到 12 字内 | 全场最重的一句（每份 deck 只用一次） |
| V3 | 出处那行换成人名 + 职务 | 真的引用了某个人的话 |
| V4 | `.quote-card` 换成裸 `<div>`（去掉卡片底和引号） | 极简风；这时 `<b>` 的自动高亮**也会没有**，要自己用 `var(--c-brand)` |
| V5 | 底部加一行小字 CTA | 当结尾页用 |

---

## 六、design 提示

- **视觉轻但气场重**：专门用来隔开两页图重的版式（L11 / L13 / L18 / L19 / L21 前后各放一页）
- **字数铁律**：≤ 28 字。超了就不是金句，是一段话 —— 那该用 L1（左文右图）
- **一份 deck 里最多 2–3 页**：金句页多了之后每一页都不重了
- **与 L2 的区别**：L2 有背景图（气氛靠画面），L7 是纯排版（气氛靠留白），一份里交替用
- **与 L13 的区别**：L13 是封面级压场（全幅图 + 96px 巨字），L7 是过渡级换气
