# 设计系统 · 设计令牌

> 活文档。design 阶段从「调色板库」按内容选/微调一套，产出 `design-spec.json`，由 assemble 注入模板 `:root`。**配色不写死**——每个 deck 随内容选 palette。
>
> **默认品牌基线**：未指定特殊配色/画风时，按 `references/brand-defaults.md`（想象数科 v2.0）执行——底色三态、卡片三色、关键词高亮、字体/网格、单视觉主角等硬约束。P-A 即该品牌实测定色。

## 令牌变量（角色语义，注入 :root）
模板与组件类统一引用以下角色变量，不写死具体色值，因此任意调色板都能套：
```
--c-brand        主色（最大面积强调：角标、标题强调、渐变起点、编号徽章）
--c-brand-deep   主色深版（渐变末端点、hover、下划线）
--c-accent       点缀色（第二色：kicker、次强调、渐变终点）
--c-accent-deep  点缀色深版
--c-bg           页面底色（浅）
--c-bg-alt       区块/卡片底（浅，可带微色相）
--c-ink          正文
--c-ink-deep     标题
--c-ink-soft     次要/水印
--c-card         卡片底
--c-hairline     描边
--mask-rgb       全幅背景遮罩用的底色 RGB（= --c-bg 的 rgb，透明度梯度由 CSS 控制）
--mask-rgb-alt    cool 页遮罩底色 RGB（= --c-bg-alt 的 rgb）
```

**硬约束**：所有底色明度 ≥ `#EBF6FC`（浅色无暗黑）；正文/标题对比度达标（AA）。

## 调色板库（按内容选，可微调）
每套给全部角色变量值。新增调色板直接在此追加条目。

### P-A 企业科技橙蓝（默认 · 想象数科品牌实测定色）
```
--c-brand:#F0861A; --c-brand-deep:#E07A10;
--c-accent:#2DB9ED; --c-accent-deep:#1E9BD0;
--c-bg:#FAF8F4; --c-bg-alt:#EFF7FB;
--c-ink:#595656; --c-ink-deep:#2E2C2C; --c-ink-soft:#969696;
--c-card:#FFFFFF; --c-hairline:rgba(0,0,0,.10);
--bg-warm:#FFF7EF; --bg-cool:#EFF7FB; --bg-plain:#FAF8F4;
--card-o:#FFF4E8; --card-b:#EBF6FC;
--hl-o:rgba(240,134,26,.14); --hl-b:rgba(45,185,237,.14);
--mask-rgb:250,248,244; --mask-rgb-alt:239,247,251;
```
适用：AI / B2B 科技 / 互联网 / 数字化转型（即想象数科品牌默认色）。

### P-B 金融深蓝金
```
--c-brand:#C8A24B; --c-brand-deep:#A8842F;   /* 金为主色 */
--c-accent:#1B3A5B; --c-accent-deep:#122945; /* 深蓝为点缀 */
--c-bg:#F7F8FA; --c-bg-alt:#EEF2F6;
--c-ink:#23262B; --c-ink-deep:#14171C; --c-ink-soft:#5C626B;
--c-card:#FFFFFF; --c-hairline:rgba(20,40,70,.12);
--mask-rgb:247,248,250; --mask-rgb-alt:238,242,246;
```
适用：金融 / 银行 / 保险 / 咨询 / 律所。

### P-C 可持续墨绿
```
--c-brand:#1F7A5C; --c-brand-deep:#0E5C45;
--c-accent:#4FC3A1; --c-accent-deep:#2FA386;
--c-bg:#F5F8F5; --c-bg-alt:#EBF4EF;
--c-ink:#23302B; --c-ink-deep:#15211C; --c-ink-soft:#56655E;
--c-card:#FFFFFF; --c-hairline:rgba(20,80,60,.12);
--mask-rgb:245,248,245; --mask-rgb-alt:235,244,239;
```
适用：ESG / 制造 / 环保 / 农业 / 医疗健康。

### P-D 消费暖橙活力
```
--c-brand:#FF6B35; --c-brand-deep:#E8500F;
--c-accent:#7B5EA7; --c-accent-deep:#5E4585; /* 紫为点缀，制造活泼对比 */
--c-bg:#FFF8F4; --c-bg-alt:#FDEEE6;
--c-ink:#2A2522; --c-ink-deep:#1A1614; --c-ink-soft:#6A605A;
--c-card:#FFFFFF; --c-hairline:rgba(230,100,50,.14);
--mask-rgb:255,248,244; --mask-rgb-alt:253,238,230;
```
适用：消费 / 零售 / 快消 / 母婴 / 餐饮 / 文旅。

### P-E 高级中性灰（极简/高端）
```
--c-brand:#2D2D2D; --c-brand-deep:#1A1A1A;
--c-accent:#B08D57; --c-accent-deep:#8C6E3F; /* 古铜金为点缀 */
--c-bg:#FAFAFA; --c-bg-alt:#F0F0F0;
--c-ink:#2A2A2A; --c-ink-deep:#141414; --c-ink-soft:#6B6B6B;
--c-card:#FFFFFF; --c-hairline:rgba(0,0,0,.12);
--mask-rgb:250,250,250; --mask-rgb-alt:240,240,240;
```
适用：高端 / 奢侈品 / 艺术 / 极简品牌 / 建筑。

## 推导规则（ppt-design 用）
1. 读内容：**行业 / 主题 / 受众 / 情绪 / 是否已有品牌主色**。
2. 映射（命中即选）：
   - AI·B2B 科技·互联网·数字化 → **P-A**
   - 金融·银行·保险·咨询·律所 → **P-B**
   - ESG·制造·环保·农业·医疗 → **P-C**
   - 消费·零售·快消·母婴·餐饮·文旅 → **P-D**
   - 高端·奢侈·艺术·极简·建筑 → **P-E**
   - 都不明显 → 默认 **P-A**，并在 design-spec 注明理由。
3. 微调（写进 `design-spec.palette` 的 overrides）：
   - 受众偏年轻 → 主色提亮 5–8%；偏成熟/严肃 → 主色压暗。
   - 用户/品牌已有主色 → 以品牌色覆盖 `--c-brand`，accent 取同系浅色或互补色。
   - 避坑：避免红绿直接对比、低对比灰字、底色低于明度下限。
4. 输出 `design-spec.json`：
   ```json
   {"paletteId":"P-A","palette":{"--c-brand":"#F0861A","--c-accent":"#2DB9ED", ...},"overrides":{},"fonts":{...},"tokens":{...}}
   ```

## 字体（跨 palette 通用，不随配色变）
- 衬线（标题/企业名/金句）：Noto Serif SC
- 无衬线（正文/UI）：Noto Sans SC
- 禁止系统字体（Arial/Inter/Roboto）与白底紫渐变滥用方案。

## 字号阶梯（1920×1080 舞台）
- 页标题 54px / 章节封面 72px / 企业名 72px
- 金句 38–44px / 正文 22–24px / kicker 20px / 水印 20px
- 编号徽章 112×112，内部数字 48px

## 间距与圆角
- 页面内边距 96px 110px；标题下装饰条 90×6（主色→点缀渐变）
- 卡片圆角 12–14px；图圆角 12px；边框 1px hairline
- 顶部 5px 渐变色带（主色→点缀）

## 组件类（模板已内置）
`.slide` `.slide-inner` `.corners` `.wm` `.page-badge` `.page-title` `.title-bar` `.kicker`
`.case-bg`(+`::after`) `.has-bg` `.p5-visual` `.gallery(.g2/.g3/.g2x2)` `.hero-case`(L3) `.card(.orange/.blue)`
