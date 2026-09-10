# L41 · `outline-mega-number-chapter`（描边空心巨数字章节页：420px 空心序号 + 压在上面的衬线标题 + 底部三条导览）

> **📄 详情**：本文件供 design 阶段匹配到 L41 时**必读**。
> **★ 核心原则**：结构是灵魂，颜色/内容不绑死。所有配色必须用 `var(--c-*)` 变量。

---

## 一、结构速览

- **比例**：16:9，浅底（`var(--c-bg)`），**纯排版不放图**，文字很少（一个序号 + 标题 + 一行英文 + 一句导语 + 3 条小标题，约 90–140 字）
- **核心手法**：整库唯一的**描边空心巨字** —— `.l41-num` 是 420px 的 `var(--num)` 数字，`color:transparent` + `-webkit-text-stroke:2px var(--c-brand)`，只剩一圈品牌色轮廓；92px 衬线标题**压在它右下方**（z-index 2 盖 1），实心黑字穿过空心线条
- **是否全幅**：**是** —— 不包 `.slide-inner`（巨字要贴左边距起排、三块各自绝对定位）
- **底色**：默认不加类（想更暖可给 section 加 `tinted`）
- **什么时候用**：章节扉页（第几部分开始），底部三条导览写这一章接下来的三个小节（**不是整份目录** —— 整份目录用 L17 / L33，那两条才列得下 4–6 条）

---

## 二、结构拆解（由后到前）

### 1. 空心巨数字 · `.l41-num`

- **`-webkit-text-stroke` 必须配 `color:transparent`。** 少了那一句是一个 420px 的**实心**品牌色数字，把标题和底部三条全压死 —— 而它照样渲染，看起来像"这条版式设计得就是这么重"。
- **只能 1–2 位**（`01`…`09` / `1`…`12`，或者 `Ⅲ` 这种罗马数字）。三位数在 420px 下将近 1000px 宽，右半截钻到标题底下，再被 `.l41-wrap` 的 `overflow:hidden` 静默裁掉一截。
- 别用它写汉字：衬线汉字描边之后笔画糊成一团（数字和罗马字母的笔画少，才撑得起 2px 描边）。
- 描边**只能 2px**：1px 在投影仪上直接消失（近看正常，会场里那一页看起来是空的），4px 起就变成实心块。

### 2. 标题块 · `.l41-txt`

- `left:calc(var(--pad-x) + 210px)`：故意**只偏 210px**，让标题左端压在巨数字的第二位上 —— 这个交叠就是这一条的全部设计。改成 `var(--pad-x)` 之后两者左对齐、上下堆着，读起来像"数字是个装饰背景"，一处都不报错。
- 标题**必须写成 `<h1 class="page-title">`**（页脚目录面板靠它取标题）。92px 衬线，**8 个汉字以内**：写长了换第二行会压到底部那条细线上，两层字叠在一起。
- `.l41-en` 一行加宽字距英文/年份（`var(--num)` 品牌深色，**24 字符内**）。
- `.l41-say` 一句导语，**最多 2 行**：这一页是扉页，写成三四行就该用 L7（整页金句）或者干脆放到下一页。

### 3. 底部导览 · `.l41-sub`

- **只能 3 格**（`repeat(3,1fr)`）。写第四条会换到栅格第二行，而那一行在 `bottom:var(--pad-bottom)` 之下 —— 直接被裁掉，页面上就是"第四个小标题没了"，没有一处会说。
- 每格 = `<b>`（`01` / `SECTION` 这类小标签）+ `<span>`（**一行**小节名，10 字以内；换行会把这一行整块顶高、压到导语上）。
- 三条写的应该是**这一章接下来真的会讲的那三件事**：写成三句口号的话，翻到下一页发现对不上，而这一页本身很好看。

---

## 三、CSS 骨架

```css
/* L41 描边空心巨数字章节页（全幅） */
.l41-wrap{position:absolute;inset:0;overflow:hidden;background:var(--c-bg)}
.l41-num{position:absolute;left:var(--pad-x);top:17%;z-index:1;font-family:var(--num);font-size:420px;font-weight:800;line-height:.82;letter-spacing:-.04em;white-space:nowrap;color:transparent;-webkit-text-stroke:2px var(--c-brand)}
.l41-txt{position:absolute;left:calc(var(--pad-x) + 210px);right:var(--pad-x);top:44%;z-index:2}
.l41-txt .page-title{font-family:var(--serif);font-size:92px;font-weight:900;line-height:1.14;letter-spacing:-.02em;color:var(--c-ink-deep);margin-top:0}
.l41-en{margin-top:20px;font-family:var(--num);font-size:16px;font-weight:700;letter-spacing:.34em;color:var(--c-brand-deep)}
.l41-say{margin-top:24px;max-width:880px;font-size:22px;line-height:1.8;color:var(--c-ink)}
.l41-sub{position:absolute;left:var(--pad-x);right:var(--pad-x);bottom:var(--pad-bottom);z-index:2;display:grid;grid-template-columns:repeat(3,1fr);gap:44px;padding-top:26px;border-top:1px solid var(--c-hairline)}
.l41-sub b{display:block;font-family:var(--num);font-size:15px;font-weight:700;letter-spacing:.2em;color:var(--c-brand);margin-bottom:10px}
.l41-sub span{display:block;font-size:20px;line-height:1.6;color:var(--c-ink-deep)}
```

---

## 四、build-part 结构模板

```html
<section class="slide" data-layout="L41">
  <!-- 全幅：不包 .slide-inner；页眉由代码贴，这里不要写 -->
  <div class="l41-wrap">
    <div class="l41-num">{{序号，1–2 位}}</div>
    <div class="l41-txt">
      <h1 class="page-title">{{章节名，8 个汉字内}}</h1>
      <div class="l41-en">{{英文/年份，24 字符内}}</div>
      <p class="l41-say">{{一句导语，最多两行}}</p>
    </div>
    <div class="l41-sub">
      <div><b>01</b><span>{{小节名，10 字内}}</span></div>
      <div><b>02</b><span>{{小节名，10 字内}}</span></div>
      <div><b>03</b><span>{{小节名，10 字内}}</span></div>
    </div>
  </div>
</section>
```

---

## 五、图槽位

0 个 —— **这一条不放图**。空心巨字全靠底色对比，衬上任何一张照片（哪怕压到 `.1`）那圈 2px 轮廓就断断续续看不出形状了，而页面照样渲染、看起来只是"这个数字有点脏"。需要气氛图的章节页用 L2 / L13。

---

## 六、变体

| 编号 | 变化 | 用途 |
|------|------|------|
| V1 | 数字改罗马数字（`Ⅰ`–`Ⅴ`） | 整份走更正式的语气 |
| V2 | 描边改 `var(--c-accent)`，标题不变 | 冷色调整份 / 区分正副章节 |
| V3 | 去掉 `.l41-sub`（只留巨字 + 标题 + 导语） | 这一章的小节还没定 |
| V4 | 去掉 `.l41-say`，标题升到 108px | 章节名本身就是全部信息 |
| V5 | 数字换成年份（`2026`，字号降到 300px、`left` 不变） | 时间线式的分章 |
| V6 | section 加 `tinted`（暖光底纹） | 连着两页章节页时区分 |

---

## 七、design 提示

- **只当章节扉页**：中间拿它讲内容的话，那一页只有百来个字，看起来像"这一页没写完"
- **同一份里每章一页、序号必须连着**（`01` / `02` / `03`）：跳号或重号没人报错，而这一页最大的那个东西就是那个数字
- **`color:transparent` 不能少**：少了是实心 420px 数字压死整页，而它照样渲染
- **序号 1–2 位、标题 8 字内、底部 3 格**：三条都是硬约束，超了全是"静默裁掉一截"
- **别和 L2 连着用**：L2 也是章节封面（全幅图 + 遮罩），两页都在说"新的一章开始了"
- **配色**：描边和小标签走 `var(--c-brand)`，英文行走 `var(--c-brand-deep)`，标题 `var(--c-ink-deep)`；细线 `var(--c-hairline)`
- **与 L2 的区别**：L2 靠一张气氛图定调（有图才成立），L41 是纯字体设计（**没有图**也很满）
- **与 L23 / L34 / L35 的区别**：那三条是**整份封面**（不贴页眉、只有一句主标题），L41 是章节页，页眉那行模块名照旧由代码贴
- **与 L17 的区别**：L17 是完整目录（左图右圆圈数字清单，一次列 4–6 条），L41 只列 3 条、主角是章节序号
