# L21 · `fullbleed-perspective-info-split`（全幅中央透视 + 左文字 + 右三数据栏）

> **📄 详情**：本文件供 design 阶段匹配到 L21 时**必读**。
> **★ 核心原则**：结构是灵魂，颜色/内容不绑死。所有配色必须用 `var(--c-*)` 变量。

---

## 一、结构速览

- **比例**：16:9 横版，**全幅图**（不包 `.slide-inner`）
- **核心手法**：① 全幅中央透视构图（图本身即焦点）；② **不带蒙版**（原来那层烙死的 `rgba(0,0,0,.38)` 已删）—— 白字全靠图自己暗；③ 左 1/3 文字（英巨 + 中副 + 品牌色短线 + 双语正文）；④ 右 1/3 三栏数据（衬线大数字 + 中英小标）；⑤ 底部居中 4 点分页指示
- **是否全幅**：是（**不包 `.slide-inner`**，与 L11/L13/L18/L19/L22 同级 fullbleed 处理）
- **原色（仅供还原参考）**：暗调实景图 / 白色文字 / 黄色品牌色短线 / 衬线大数字

---

## 二、结构拆解

1. **全幅背景图**（`.l21-bg`，中央透视构图——栈道/桥/船头/隧道/走廊延伸感）
2. **没有蒙版**（原来 `.l21-bg::after` 那层 `rgba(0,0,0,.38)` 已删 —— 和「这一页的蒙版」滑块叠起来整页发灰）。
   压暗只剩那个滑块（`--veil`，缺省 0），所以**图必须自己是暗的**：亮图进来就是左右两组白字压在亮部、
   读不出来，而页面一处不报错。读不清时把滑块拉到 20–35%
3. **左 1/3 文字**（`.l21-left`，absolute **垂直居中** `top:50%+translateY(-50%)`，left 80px，max-width 42%）
   - 英文巨字 2 行（`.l21-en`，56–64px 白色，weight 800，行高 1.05）
   - 中文副标一行（`.l21-cn`，30–36px 白色）
   - 品牌色短线（`.l21-rule`，4px × 56–80px，`var(--c-brand)`）
   - 双语正文（`.l21-body`，14–16px，`rgba(255,255,255,.85)`，行高 1.7，max-width 480px）
4. **右 1/3 数据三栏**（`.l21-right`，absolute **垂直居中**（同上），right 80px，flex gap 56px）
   - 每栏（`.l21-stat`）：大数字（`.num`，衬线 56–72px 白色）+ 中文小标（`.lab`，14–18px 白色）+ 英文小字 italic（`.lab-en`，12–14px `rgba(255,255,255,.7)`）
5. **底部居中分页指示**（`.l21-nav`，absolute bottom 40px center，flex gap 8px）
   - 半透白点 8×8px；当前态拉长 24×8px 圆角 4px

---

## 三、CSS 骨架

```css
/* L21 全幅中央透视 + 左文字 + 右三数据栏 — 详情见 cases/L21-fullbleed-perspective-info-split.md */
.l21-wrap{position:absolute;inset:0;overflow:hidden}
.l21-bg{position:absolute;inset:0}
.l21-bg img{width:100%;height:100%;object-fit:cover;display:block}
.l21-left{position:absolute;top:50%;transform:translateY(-50%);left:80px;max-width:42%;z-index:2}
.l21-en{font-size:60px;font-weight:800;color:#fff;line-height:1.05}
.l21-cn{font-size:32px;color:#fff;margin-top:14px}
.l21-rule{width:64px;height:4px;background:var(--c-brand);margin:20px 0 16px}
.l21-body{font-size:15px;color:rgba(255,255,255,.85);line-height:1.7;max-width:480px}
.l21-right{position:absolute;top:50%;transform:translateY(-50%);right:80px;display:flex;gap:56px;z-index:2}
.l21-stat .num{font-size:64px;font-weight:700;color:#fff;font-family:var(--serif);line-height:1}
.l21-stat .lab{font-size:14px;color:#fff;margin-top:10px;font-weight:500}
.l21-stat .lab-en{font-size:14px;color:rgba(255,255,255,.7);margin-top:4px;font-style:italic}
.l21-nav{position:absolute;bottom:40px;left:50%;transform:translateX(-50%);display:flex;gap:8px;align-items:center;z-index:2}
.l21-nav .dot{width:8px;height:8px;border-radius:50%;background:rgba(255,255,255,.4)}
.l21-nav .dot.on{width:24px;border-radius:4px;background:#fff}
```

---

## 四、build-part 结构模板

```html
<section class="slide" data-layout="L21">
  <div class="l21-wrap">
    <div class="l21-bg"><img src="/ppt-cases/ph-16x9.svg" data-img-prompt="这一格要什么图（中文一句话）" alt=""></div>
    <div class="l21-left">
      <div class="l21-en">Powerful supply<br>chain system</div>
      <div class="l21-cn">中国市场发展</div>
      <div class="l21-rule"></div>
      <p class="l21-body">{{双语正文}}</p>
    </div>
    <div class="l21-right">
      <div class="l21-stat"><div class="num">88%</div><div class="lab">{{中文小标}}</div><div class="lab-en">{{English label}}</div></div>
      <div class="l21-stat"><div class="num">78%</div><div class="lab">{{中文小标}}</div><div class="lab-en">{{English label}}</div></div>
      <div class="l21-stat"><div class="num">60%</div><div class="lab">{{中文小标}}</div><div class="lab-en">{{English label}}</div></div>
    </div>
    <div class="l21-nav"><span class="dot on"></span><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>
  </div>
</section>
```

---

## 五、图槽位

| 槽位 | 必填? | 模式 | 尺寸 | 构图要求 |
|------|-------|------|------|----------|
| `pXX_hero` | ✅ 必填 | case | 1920×1080 | **必须中央透视构图**——栈道/桥/船头/隧道/走廊/钢架延伸感，视觉焦点居中 |

**禁用**：人物 closeup、抽象插画、数据图表、纯色背景、左/右单侧构图

---

## 六、变体

| 编号 | 变化 | 用途 |
|------|------|------|
| V1 | 数据下移到底部 | 顶部留白更多 |
| V2 | 数据四栏 | 指标更多 |
| V3 | 拉「这一页的蒙版」滑块到 25% | 图太亮、白字读不清 |
| V4 | 左改三行叠字 | 标题更长 |
| V5 | 数据用进度条样式 | 强调完成度 |
| V6 | 加左下小说明 | 双语注释 |
| V7 | 无分页指示 | 极简 |

---

## 七、design 提示

- **视觉重**：全幅图压场，前后页用 L7/L12/L15 缓冲
- **构图铁律**：图**必须中央透视**——左右两侧**自身就要偏暗**（没有蒙版帮忙了，字压在那儿），中央亮、有景深延伸感
- **蒙版铁律**：版式里一层都没有；要压暗只有「这一页详情」里那个滑块（整页均匀压黑，压不到文字）
- **配色**：仅 `var(--c-brand)` 用于短线；数据用纯白衬线大数字
- **与 L13 的区别**：L13 是居中垂直堆叠（年份→主标→副标→双语脚注），L21 是横向分置（左文字+右数据）
- **与 L3 的区别**：L3 是"左文+右图+编号徽章"，L21 是"全幅图+左右浮信息"
- **与 L11 的区别**：L11 是三栏并列全幅图，L21 是单图+三数据栏
