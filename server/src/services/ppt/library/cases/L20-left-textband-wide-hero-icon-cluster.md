# L20 · `left-textband-wide-hero-icon-cluster`（左 30% 浮文带 + 右 70% 宽 hero + 底部三圆图标）

> **📄 详情**：本文件供 design 阶段匹配到 L20 时**必读**，获取完整 CSS 骨架、build-part 结构模板、图槽位与变体说明。
> **★ 核心原则**：结构是灵魂，颜色/内容不绑死。下方"原色"仅为还原参考，**所有配色必须用 `var(--c-*)` 变量**，"适用内容类型"列出多种场景。

---

## 一、结构速览

- **比例**：16:9 横版，横向分割 **左 30% 文字带 + 右 70% 全幅图**
- **是否全幅**：否（在 `.slide-inner` 内，用 grid 30/70）
- **文带过渡**：`linear-gradient(to right, var(--c-card) 70%, transparent)` 自然过渡到图
- **核心手法**：① 30/70 横向分割（与 L1 的 54/46 反向）；② 文带五层堆叠（英巨→中副→数字锚点→正文→三圆图标）；③ 大号衬线数字 + 行内标签；④ 三圆图标横排收尾
- **原色（仅供还原参考）**：黄色品牌色 / 深灰文字 / 浅米文带底 / 集装箱船 hero 图

---

## 二、结构拆解（由上至下、左→右）

### 左 30% 文字带（`.l20-textband`，padding 80px 56px 80px 96px）

1. **英文巨字标题** 2 行（`.l20-en`，60–72px，无衬线 Bold，行高 1.05，letter-spacing -0.01em）
2. **中文副标**一行（`.l20-cn`，32–40px，weight 500）
3. **大数字锚点** + 行内小标签（`.l20-stat`，flex baseline gap 10px，margin-top 36px）
   - 数字（`.num`，衬线 96–120px，weight 700，`var(--c-brand)`，line-height 1）
   - 标签（`.lab`，16px，`var(--c-ink-soft)`；可带 `<small>` 二级标签 13px）
4. **双行正文**（`.l20-body`，14–16px，`var(--c-ink-soft)`，行高 1.7，max-width 92%）
5. **底部三圆图标横排**（`.l20-icons`，flex gap 32px，margin-top auto + padding-top 48px）
   - 每组（`.l20-icon`，flex column center gap 8px）：圆点 56–72px + 中间 24px brand 图标 + 下方 13px 中文标签
   - 圆点背景 `rgba(255,255,255,.85)`，1px `var(--c-hairline)` 描边

### 右 70% 全幅 hero 图（`.l20-hero`，overflow hidden）

- `img` 全 cover，1920×1080，`object-position: center`
- 无遮罩、无文字、无渐变（图本身即视觉）

---

## 三、CSS 骨架

```css
/* L20 左浮文带 + 宽 hero + 三圆图标 — 详情见 cases/L20-left-textband-wide-hero-icon-cluster.md */
.l20-wrap{position:absolute;inset:0;display:grid;grid-template-columns:30% 70%;overflow:hidden}
.l20-textband{position:relative;z-index:2;padding:170px 56px 80px 96px;background:linear-gradient(to right,var(--c-card) 75%,transparent);display:flex;flex-direction:column;color:var(--c-ink-deep)}
.l20-en{font-size:64px;font-weight:800;color:var(--c-ink-deep);line-height:1.05;letter-spacing:-.01em}
.l20-cn{font-size:34px;font-weight:500;color:var(--c-ink-deep);margin-top:14px}
.l20-stat{display:flex;align-items:baseline;gap:10px;margin-top:36px}
.l20-stat .num{font-size:104px;font-weight:700;color:var(--c-brand);font-family:var(--serif);line-height:1}
.l20-stat .lab{font-size:16px;color:var(--c-ink-soft)}
.l20-stat .lab small{display:block;font-size:13px;margin-top:4px}
.l20-body{font-size:15px;color:var(--c-ink-soft);line-height:1.7;margin-top:24px;max-width:92%}
.l20-icons{display:flex;gap:32px;margin-top:auto;padding-top:48px}
.l20-icon{display:flex;flex-direction:column;align-items:center;gap:8px}
.l20-icon .dot{width:60px;height:60px;border-radius:50%;background:rgba(255,255,255,.85);border:1px solid var(--c-hairline);display:flex;align-items:center;justify-content:center}
.l20-icon .dot svg{width:24px;height:24px;color:var(--c-brand)}
.l20-icon .lab{font-size:13px;color:var(--c-ink-deep);font-weight:500}
.l20-hero{position:relative;overflow:hidden}
.l20-hero img{width:100%;height:100%;object-fit:cover;display:block}
```

---

## 四、build-part 结构模板

```html
<section class="slide" data-layout="L20">
  <div class="slide-inner">
  <div class="l20-wrap">
    <div class="l20-textband">
      <div class="l20-en">INTEGRITY BASED<br>TRADE VOYAGE</div>
      <div class="l20-cn">诚信为基 贸易远航</div>
      <div class="l20-stat">
        <span class="num">55</span>
        <span class="lab">余年<small>品牌建立时间</small></span>
      </div>
      <p class="l20-body">{{双行正文}}</p>
      <div class="l20-icons">
        <div class="l20-icon"><span class="dot">{{SVG图标}}</span><span class="lab">{{标签1}}</span></div>
        <div class="l20-icon"><span class="dot">{{SVG图标}}</span><span class="lab">{{标签2}}</span></div>
        <div class="l20-icon"><span class="dot">{{SVG图标}}</span><span class="lab">{{标签3}}</span></div>
      </div>
    </div>
    <div class="l20-hero"><img src="/ppt-cases/ph-16x9.svg" data-img-prompt="这一格要什么图（中文一句话）" alt=""></div>
  </div>
  </div>
</section>
```

---

## 五、图槽位

| 槽位 | 必填? | 模式 | 尺寸 | 构图要求 |
|------|-------|------|------|----------|
| `pXX_hero` | ✅ 必填 | case | 1920×1080 | 场景/产品/环境图，**主体偏右**（左 30% 文带会遮住左部） |

**禁用**：人物 closeup、抽象插画、数据图表、纯色背景

---

## 六、变体

| 编号 | 变化 | 用途 |
|------|------|------|
| V1 | 镜像（右文左图） | 视觉重心右移 |
| V2 | 文带改顶部条状 | 标题横贯 |
| V3 | 三圆改横排卡片 | 信息密度更高 |
| V4 | 大数字改小数字 + chip | 弱化时间锚点 |
| V5 | 双语（中为主 + 小英文） | 国际化场景 |
| V6 | 文带宽度 40% | 长文本场景 |

---

## 七、design 提示

- **视觉重**：hero 占 70% 主导，前后页用 L7/L2/L12 缓冲
- **配色**：仅 `var(--c-brand)` 用于大数字与图标，hero 图不带蒙版
- **间距铁律**：三圆与正文间距 ≥ 48px；大数字与副标间距 36px
- **字号铁律**：英文巨字 ≥ 60px；中文副标 ≥ 32px；正文 ≤ 16px
- **与 L1 的区别**：L1 是 54/46（文多图少），L20 是 30/70（文少图多）+ 三圆图标收尾
- **与 L3 的区别**：L3 是"左文+右图+编号徽章"，L20 是"文带+宽图+数字锚点+三圆"
- **与 L15 的区别**：L15 是上下分屏克制风，L20 是横向分屏商务风
