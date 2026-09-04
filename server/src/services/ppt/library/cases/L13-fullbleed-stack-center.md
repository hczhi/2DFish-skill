# L13 · fullbleed-stack-center（全幅图叠字·居中垂直堆叠） 📄 详情

> 命名按结构不按内容（铁律）：只锁排版结构，颜色与内容场景均不固定。

- **适用内容类型**：封面页（年度报告/季度发布/主题发布）、扉页（章节开场/节目标签/主讲人开场）、宣言页（战略宣言/主题金句/行业承诺）、双语发布页（跨境发布/国际合作/海外项目启动）、倒计时页（活动倒计时/上线启动/周年纪念）、章节分隔页（长 deck 中的章节扉页）
- **来源**：用户截图（2026-08-27），原内容为"城市油田"环保计划年度发布页（日能公司）。演示见 `cases/L13-demo.html`，原件 `cases/img/L13-ref.jpg`。
- **截图参考**：`img/L13-ref.jpg`

---

## 结构拆解

```
┌─────────────── 上半（全幅背景图 + 文字叠图）───────────────┐
│  ● 胶囊标签(右上)                                            │  ← 顶部元信息
│                                                              │
│  年份大字(轻量)                                              │  ← 文字垂直居中
│  "主标题"大字(含引号重磅)                                      │
│  中文副标(一行)                                                │
│                                                              │
├───────────── 下半（浅底信息区 · 双栏文字）──────────────────┤
│  浅底（deck 的 var(--c-bg)）                                   │
│                                                              │
└────────── 中心径向亮边缘暗渐变覆盖在上半图上 ──────────────┘
```

**关键手法（结构层面，学得到的部分）：**

1. **全幅图 + 中心径向亮边缘暗渐变**：保证中央白字可读，又不遮挡边角的氛围细节。**与 L11 底部单向黑色渐变形成对比**——L11 是数据型仪表板思维（横向分栏），L13 是发布页思维（径向聚焦中心）。
2. **文字垂直居中堆叠**：罕见于中文场景（多数版式左对齐），但仪式感强，适合"宣言"氛围（封面、双语发布、主题页）。三层堆叠：① 年份大字（轻量）→ ② 主标题（粗体含引号）→ ③ 单行副标 → ④ 双语脚注（中上英下）。
3. **顶部右上胶囊小标签**：出戏元信息（演讲单位 / 日期 / 主讲人 / 节目标签），让封面有叙事语境。
4. **标题用引号包裹主题词**：原标题自带中文引号——结构信号，版式适合有"主题词"的发布会型标题。
5. **双语脚注居中收尾**：上下两行（中文上行英文下行），形成完整"宣发节奏"。

---

## 配色归一（仅提示骨架，不锁颜色）

| 结构角色 | 实现方式 |
|---------|----------|
| 背景 | 全幅图（任何色系均可，由 ImageGen 决定） |
| 文字主色 | `var(--c-card)`（通常白/浅，确保压暗渐变上可读） |
| 渐变遮罩 | `radial-gradient(ellipse at center, transparent 30%, rgba(0,0,0,.6) 100%)` —— 椭圆形（非纯圆形）贴合 16:9 |
| 顶部胶囊 | `rgba(255,255,255,.13)` 半透白底 + 毛玻璃 + `var(--c-card)` 字 |
| 主标引号字色 | `var(--c-accent)`（推荐但不强制，可保持白字） |

> 关键：截图的深绿色不是被学习的一部分——任何色系都成立。案例只抓"中心径向渐变"这个**结构手法**。

---

## CSS 骨架（已固化进 template.html）

```css
/* 全幅图叠字·居中堆叠 (L13) · 详情见 cases/L13-fullbleed-stack-center.md */
.l13-wrap{position:absolute;inset:0}
.l13-bg{position:absolute;inset:0;overflow:hidden}
.l13-bg img{width:100%;height:100%;object-fit:cover;display:block}
.l13-bg::after{
  content:'';position:absolute;inset:0;
  background:radial-gradient(ellipse 80% 70% at center,
    rgba(0,0,0,0) 0%, rgba(0,0,0,.18) 45%, rgba(0,0,0,.65) 100%);
}
.l13-pill{
  position:absolute;top:48px;right:48px;
  padding:10px 22px;
  background:rgba(255,255,255,.13);
  color:var(--c-card);
  border-radius:999px;
  font-size:14px;letter-spacing:1px;
  backdrop-filter:blur(10px);
  -webkit-backdrop-filter:blur(10px);
  border:1px solid rgba(255,255,255,.2);
  z-index:3;
}
.l13-stack{
  position:absolute;inset:0;
  display:flex;flex-direction:column;
  align-items:center;justify-content:center;
  text-align:center;gap:22px;
  padding:0 12%;
  z-index:2;
}
.l13-year{
  font-size:96px;font-weight:200;
  color:var(--c-card);opacity:.82;
  line-height:1;letter-spacing:-1px;
}
.l13-mega{
  font-size:78px;font-weight:800;
  color:var(--c-card);line-height:1.15;
  max-width:88%;letter-spacing:-1px;
}
.l13-mega em{
  color:var(--c-accent);font-style:normal; /* V4 变体：引号主题词改色 */
}
.l13-sub{
  font-size:22px;color:var(--c-card);opacity:.75;
  max-width:72%;line-height:1.6;
}
.l13-bilingual{margin-top:36px;color:var(--c-card)}
.l13-bilingual .zh{font-size:16px;opacity:.85;letter-spacing:1px}
.l13-bilingual .en{font-size:14px;opacity:.65;margin-top:6px;font-style:italic}
```

---

## 图槽位

- **1 张全幅图**（必填）：`pXX_hero`，建议 mode `case`（场景/氛围类实景，不要 case 人物的 closeup）
- 关键选材：**有"景深感"的全幅图**（山区航拍、跨海大桥、星空、城市远景），纯抽象插画会破坏仪式感
- 长宽比：1920×1080 满幅，不要裁切

---

## 变体

| 变体 | 调整点 | 适用 |
|------|--------|------|
| V1 · 左对齐堆叠 | 文字左对齐，胶囊也放左上 | 偏商务/严肃 |
| V2 · 单语无脚注 | 去掉双语脚注，年份+主标两层 | 简洁封面 |
| V3 · 双行主标 | 主标题分两行，居中堆叠 | 长标题 |
| V4 · 引号改色 | 主标正文白，引号 + 主题词 `var(--c-accent)` | 突出主题词（推荐默认） |
| V5 · 底部 cta | 脚注下方加一个 ghost 按钮 | 发布页带跳转 |
| V6 · 倒计时版 | 主标位置显示 倒计时数字 + 单位 | 启动页 |
| V7 · 暗底白字 | 无背景图，纯深色底 + 大字 + 少量装饰 | 极简宣言 |

---

## build-part 结构模板

```html
<section class="slide">  <!-- 全幅：不包 .slide-inner。根 section 上不要写 l13-cover / fullbleed 这类没有定义的类名 -->
  <div class="l13-wrap">
    <div class="l13-bg"><img src="/ppt-cases/ph-16x9.svg" data-img-prompt="这一格要什么图（中文一句话）" alt=""></div>
    <div class="l13-pill">{{演讲单位 · / 主讲人 / 节目标签}}</div>
    <div class="l13-stack">
      <div class="l13-year">{{YYYY年份}}</div>
      <div class="l13-mega">「<em>{{主标题主题词}}</em>」{{主标题}}</div>
      <div class="l13-sub">{{中文副标一行，30 字内}}</div>
      <div class="l13-bilingual">
        <div class="zh">{{中文双语脚注}}</div>
        <div class="en">{{English bilingual caption}}</div>
      </div>
    </div>
  </div>
</section>
```

> ⚠️ **全幅版式（fullbleed:true）**：build-part **不包** `.slide-inner`。section 需保证 `overflow:hidden` 让背景图满 1280×720 stage。

---

## design 提示

- **视觉重量**：重（封面应有"压场感"），前后页用 L7/L2/L12 缓冲。
- **颜色不固定**：本版式可承载任何色系。**配色骨架**遵循 deck palette，背景图由 `gen-images` 按 deck palette 同色系生成。
- **背景图选材**：必须是有"景深感"的全幅场景图。picsum 随机图质量不稳定，正式生成时建议 mode `case`（场景远景/航拍/地标）。
- **径向渐变参数**：用 `ellipse 80% 70% at center`（不是纯圆形），椭圆贴合 16:9 比例让暗角更自然。
- **引号区改色**：默认推荐 V4 变体（`var(--c-accent)` 强调主题词），如有 deck palette 不允许，可保持全白。
- **双语脚注**：英文在中文下方 6px，italic，opacity .65，不要压住主标视觉。
- **引号包裹主题词**：是结构信号，标题必须有"被引用感"才适合本版式（如"城市油田"环保计划）；普通陈述标题改用 V2 单语无脚注。
- **page 节选提示**：连续多页使用 L13 时，第二页起建议用 V6 倒计时版或 V3 双行主标，避免视觉重复。
