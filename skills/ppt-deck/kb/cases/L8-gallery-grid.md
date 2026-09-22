# L8 · `gallery-grid`（图廊网格 · 2–4 张图同屏）

> **📄 详情**：design 阶段匹配到 L8 时**必读**。
> **★ 核心原则**：结构是灵魂，颜色/内容不绑死 —— 所有配色只用 `var(--c-*)`。
> **★ CSS 在 `library/template.html` 的公共段里（`.gallery` / `.g2` / `.g3` / `.g2x2` / `.gallery img`），这份 md 不抄一份。**

---

## 一、结构速览

- **比例**：16:9 横版，标题在上、图网格居中占满剩下的高度
- **是否全幅**：否 —— 全部内容包在 `.slide-inner` 里
- **核心手法**：① 2–4 张同类图并排；② 每张图下面一行**说它是哪一个**的小字；③ 图的圆角/描边由 `.gallery img` 统一给，不要逐张写
- **底色**：默认不加类

---

## 二、结构拆解

1. **主标题**（`.page-title`）—— 写出**这几张图之间是什么关系**（"三家客户的同一块界面"）。
   只写"案例展示"的话，读者不知道该横向比还是逐张看，而三张图看起来完全正常。
2. **色条**（`.title-bar`）
3. **网格**（`.gallery` + 档位类 + inline `style="flex:1;align-content:center"`）
   - `g2` = 1×2，`g3` = 1×3，`g2x2` = 2×2。**这三个类必须挑一个**：只写 `.gallery` 的话
     `grid-template-columns` 没定义，所有图挤成一列（页面还是渲染出来的，只是竖着排、下半截出屏）。
   - 不给 `flex:1;align-content:center` 的话图贴在标题下面、底部空一大块。
4. **每格**（一个裸 `<div>`，不需要类名）
   - `<img src="/ppt-cases/ph-16x9.svg" alt="">` —— **宽度/圆角/描边都别写**，`.gallery img` 已经给了。
     自己写 `width` 之后换成 `g2x2` 那一版时那几张图不跟着变，画面上只是"这两张比另外两张大一点"。
   - `<p style="font-size:18px;margin-top:12px;color:var(--c-ink-soft)">` 一行说明，≤ 12 字，
     写**具体是谁/哪一块**（"恒益精密 · 排产看板"），不要写"示意图"。

---

## 三、build-part 结构模板

```html
<section class="slide">
  <!-- 左上角那行模块名由代码统一贴，这里不要写 -->
  <div class="slide-inner">
    <h1 class="page-title">{{标题，写出几张图之间的关系}}</h1>
    <div class="title-bar"></div>
    <div class="gallery g3" style="flex:1;align-content:center">
      <div>
        <img src="/ppt-cases/ph-16x9.svg" alt="" data-img-prompt="这一格要什么图（中文一句话）" data-img-mode="case">
        <p style="font-size:18px;margin-top:12px;color:var(--c-ink-soft)">{{是谁/哪一块}}</p>
      </div>
      <div>
        <img src="/ppt-cases/ph-16x9.svg" alt="" data-img-prompt="这一格要什么图（中文一句话）" data-img-mode="case">
        <p style="font-size:18px;margin-top:12px;color:var(--c-ink-soft)">{{是谁/哪一块}}</p>
      </div>
      <div>
        <img src="/ppt-cases/ph-16x9.svg" alt="" data-img-prompt="这一格要什么图（中文一句话）" data-img-mode="case">
        <p style="font-size:18px;margin-top:12px;color:var(--c-ink-soft)">{{是谁/哪一块}}</p>
      </div>
    </div>
  </div>
</section>
```

---

## 四、图槽位

| 槽位 | 必填? | 模式 | 比例 | 构图要求 |
|------|-------|------|------|----------|
| `pXX_g1` … `pXX_g4` | ✅ 全部必填 | case | 16:9（`g2x2` 用 4:3） | **几张必须同一路画风、同一个色调、同一种取景距离** |

`data-img-prompt` 写在 `<img>` 标签上（`src` 保留 `/ppt-cases/ph-*.svg` 占位）。

**同一路画风是这一页的全部**：一张实拍、一张扁平插画、一张界面截图放在一起时，读者读到的不是
"三个案例"而是"三种东西"，而三张图各自都好看、一处都不报错。所以三张的 `data-img-prompt`
要写成同一句话的三个变体（都是"界面截图感"或都是"车间实拍"），不要一格一个风格词。

**少于 2 张图不要用这个版式**：一张图的页用 L1 / L3 / L2。

---

## 五、变体

| 编号 | 变化 | 用途 |
|------|------|------|
| V1 | `g2`（1×2 大图） | 两张要看细节的截图 |
| V2 | `g2x2`（2×2 四张） | 四个案例；图要换成 4:3 |
| V3 | 说明行换成 `.kicker` + 一句 | 每张图要一个标签 + 一句解释 |
| V4 | 每格包一层 `.card` | 图和说明要"成卡"（图会小一圈） |
| V5 | 首格跨两列（inline `grid-column:span 2`） | 一主两次的主从关系 |

---

## 六、design 提示

- **视觉重**：三四张图同屏是整份里最"满"的页之一，前后接 L7 / L4（纯文字）缓冲
- **张数铁律**：2–4 张。5 张以上每张都看不清了 —— 那该分成两页，或者用 L16（四栏矩阵，图 + 中英标题）
- **图必须是真东西**：这一页的功能是"给证据"，用概念插画填满四格之后它就只是装饰，
  而读者以为看到的是真实截图
- **与 L16 的区别**：L16 每格是"图 + 中英标题 + 双语描述"的完整单元（纸面陈列风），L8 只有图 + 一行小字
- **与 L9 的区别**：L9 是两张图的**前后**对比（中间有箭头），L8 的几张之间是并列
