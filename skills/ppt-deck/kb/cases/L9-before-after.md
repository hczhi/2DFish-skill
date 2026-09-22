# L9 · `before-after`（前后对比 · 两图 + 中间箭头）

> **📄 详情**：design 阶段匹配到 L9 时**必读**。
> **★ 核心原则**：结构是灵魂，颜色/内容不绑死 —— 所有配色只用 `var(--c-*)`。
> **★ CSS 在 `library/template.html` 的公共段里（`.kicker` / `.slide.cool`），两图的网格是 inline 写的，这份 md 不抄 CSS。**

---

## 一、结构速览

- **比例**：16:9 横版，标题在上、`1fr 96px 1fr` 三列（左图 / 箭头 / 右图）垂直居中
- **是否全幅**：否 —— 全部内容包在 `.slide-inner` 里
- **核心手法**：① 同一个东西的两个状态；② 中间一个大箭头把它们**连成一句话**；③ 每边的标签里带上那个状态的关键数
- **底色**：`cool`（成效/盘点类的页走冷色）是默认

---

## 二、结构拆解

1. **主标题**（`.page-title`）—— 必须写出**这是同一个东西**（"同一张工单，改造前后"）。
   写成"改造成效"的话，读者不知道左右两张图是同一个对象还是两个案例，而两张图看起来完全正常。
2. **色条**（`.title-bar`）
3. **三列网格**（inline `style="flex:1;display:grid;grid-template-columns:1fr 96px 1fr;align-items:center;gap:18px"`）
   - 中间那 96px 是**给箭头留的固定列**。写成 `1fr 1fr 1fr` 的话箭头列和两张图一样宽，
     一页上最显眼的东西变成了那个箭头。
   - `align-items:center` 要写：两边说明文字长短不一时，不写这一条两张图会顶对齐，
     看起来像"右边那张往上跳了一点"。
4. **每边**（一个裸 `<div>`）三层：
   - `<div class="kicker" style="margin-bottom:14px">` 标签 —— 写成 `改造前 · 11.6 小时`：
     **状态词 + 那个状态下的关键数**。只写"改造前"的话这一页就没有量化，读者只能凭图猜差别。
   - `<img src="/ppt-cases/ph-16x9.svg" alt="" style="width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:12px;border:1px solid var(--c-hairline)">`
     —— 这几条 inline 样式**必须写全、而且左右两张写得一模一样**：这里的 `<img>` **不在
     `.gallery` 里**，没有任何类兜住它（`.gallery img` 只管 L8）。不写 `width:100%` 的话图按
     原始像素铺开，一张 1920 宽的截图会把那一列撑爆、压掉另一边；不写 `aspect-ratio` 的话
     高度由图自己的比例决定 —— **改造前后两张图比例不一样时，那两张图一高一矮、下面两行说明
     错开一行**，而占位图阶段两边一样高（占位图是同一个文件），要等真图配上来才看得出来，
     那时图已经生成过、钱已经花了。两张写不同的值同样算错。
   - `<p style="font-size:18px;margin-top:14px;line-height:1.8">` 一句，说**这个状态下发生了什么**，≤ 30 字。
5. **中间箭头**（`<div style="text-align:center;font-size:76px;font-weight:800;color:var(--c-brand)">→</div>`）
   —— 用文本 `→`，不要用图片或 SVG。

---

## 三、build-part 结构模板

```html
<section class="slide cool">
  <!-- 左上角那行模块名由代码统一贴，这里不要写 -->
  <div class="slide-inner">
    <h1 class="page-title">{{标题，写出这是同一个东西}}</h1>
    <div class="title-bar"></div>
    <div style="flex:1;display:grid;grid-template-columns:1fr 96px 1fr;align-items:center;gap:18px">
      <div>
        <div class="kicker" style="margin-bottom:14px">{{改造前 · 关键数}}</div>
        <img src="/ppt-cases/ph-16x9.svg" alt="" style="width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:12px;border:1px solid var(--c-hairline)" data-img-prompt="改造前的画面（中文一句话）" data-img-mode="case">
        <p style="font-size:18px;margin-top:14px;line-height:1.8">{{这个状态下发生了什么}}</p>
      </div>
      <div style="text-align:center;font-size:76px;font-weight:800;color:var(--c-brand)">→</div>
      <div>
        <div class="kicker" style="margin-bottom:14px">{{改造后 · 关键数}}</div>
        <img src="/ppt-cases/ph-16x9.svg" alt="" style="width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:12px;border:1px solid var(--c-hairline)" data-img-prompt="改造后的画面（中文一句话）" data-img-mode="case">
        <p style="font-size:18px;margin-top:14px;line-height:1.8">{{这个状态下发生了什么}}</p>
      </div>
    </div>
  </div>
</section>
```

---

## 四、图槽位

| 槽位 | 必填? | 模式 | 比例 | 构图要求 |
|------|-------|------|------|----------|
| `pXX_before` | ✅ 必填 | case | 16:9 | 和 after **同一个取景**（同角度、同距离、同色调） |
| `pXX_after` | ✅ 必填 | case | 16:9 | 同上 |

**两张图必须是同一个取景**：换了角度之后读者比不出差别，只会以为"这是两个不同的地方"，
而这一页的整个论点就没了 —— 页面上一处都不报错。所以两条 `data-img-prompt` 除了状态词
（"堆满物料的" / "整理后的"）以外应该**逐字相同**。

---

## 五、变体

| 编号 | 变化 | 用途 |
|------|------|------|
| V1 | 上下堆叠（`grid-template-columns:1fr`，箭头改 `↓`） | 两张都是宽图（如长界面截图） |
| V2 | 三段（`1fr 64px 1fr 64px 1fr`） | 三个阶段的画面 —— 但更适合用 L6 / L11 |
| V3 | 图换成 `.data-card`（纯数字对比） | 拿不到真实截图时 |
| V4 | 箭头换成一行竖排小字（"6 周" / "投入 2 人"） | 想说明"中间付了什么代价" |
| V5 | 去掉 `cool`，两边分别包 `.card orange` / `.card blue` | 想强调左右的语义对立（这时更接近 L4） |

---

## 六、design 提示

- **视觉中等偏重**：两张图 + 一个大箭头，前后接 L7 / L4（纯文字）缓冲
- **数必须真实**：标签里那两个数是这一页的结论，编一个出来页面完全正常而结论是假的
- **拿不到 after 的图就别用这个版式**：只有一边有图的页用 L1（左文右图）
- **与 L4 的区别**：L4 是**文字**的对立（两种方案），L9 是**同一个对象**的前后
- **与 L8 的区别**：L8 是几张图的并列（多案例同屏），L9 只有两张且有因果方向
