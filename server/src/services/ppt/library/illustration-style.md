# 插画与配图风格规范

> 核心原则：**每份 deck 内部笔触统一，但笔触本身随内容而变**。主色随 palette，画风随 styleId。换 deck 可换画风，同一份 deck 内画风保持一致。

## 1. 设计决策流

`ppt-design` 在 Phase 2 同时决定两件事：

1. **配色** → 从 `design-tokens.md` 调色板库选 `paletteId`（P-A ~ P-E 或自定义）。
2. **画风** → 从本文件风格库选 `styleId`（S-A ~ S-F 或自定义）。

两者写入 `design-spec.json`：`palette` 注入模板 `:root`，`style` 指引 `ppt-gen-images` 选择提示词模板。

## 2. 风格库（Style Library）

每套风格都包含：名称、适用内容、渲染技法、构图、禁忌、三个 mode（concept / case / data）的专用提示词模板。

---

### S-A 现代 SaaS 等距（默认）

- **适用**：B2B 科技、数字化、AI、互联网、SaaS
- **渲染**：干净的企业科技风、等距/扁平混合、清晰线条、轻微投影、现代 SaaS 插画质感
- **构图**：留白充分、主体居中偏一侧、几何化元素（齿轮/箭头/仪表盘/数据流）
- **禁忌**：暗黑区域、文字水印（生成后裁掉）、UI 边框噪点、写实照片

#### concept 模板
```
High-quality concept isometric vector illustration for an enterprise keynote.
Theme: <本页主题，1句>.
<本页专属场景描述>.
Limited palette: vibrant {{BRAND}}, {{ACCENT}}, soft {{BG}} / {{BG_ALT}} background, dark gray accents.
Clean corporate tech style, isometric/flat mix, crisp lines, subtle shadows, light airy background, no dark areas, no text, no UI chrome, no watermark.
High visual impact. <size>.
```

#### case 模板
```
High-quality case semi-realistic product mockup illustration for an enterprise keynote.
Theme: <本页主题，1句>.
<产品界面/业务场景描述，截图感但保持插画统一笔触>.
Limited palette: {{BRAND}}, {{ACCENT}}, soft {{BG}} / {{BG_ALT}}, dark gray accents.
Clean SaaS illustration style, crisp UI shapes, light shadows, no photographic realism, no text, no watermark.
<size>.
```

#### data 模板
```
High-quality data flat infographic illustration for an enterprise keynote.
Theme: <本页主题，1句>.
Rising curves, token flows, grid charts, geometric shapes arranged into a clear visual hierarchy.
Limited palette: {{BRAND}}, {{ACCENT}}, {{BG}} / {{BG_ALT}}, dark gray accents.
Flat corporate tech style, clean lines, minimal shadows, no 3D, no text, no watermark.
<size>.
```

---

### S-B 商务扁平插画

- **适用**：管理咨询、培训、人力资源、企业服务、流程改造
- **渲染**：简洁人物、几何图形、无透视、色块分明、亲和力
- **构图**：人物动作清晰、信息层级扁平、图标化元素
- **禁忌**：复杂透视、暗黑、写实照片、过多细节

#### concept 模板
```
Friendly business flat illustration for an enterprise keynote.
Theme: <本页主题，1句>.
<场景描述，突出人物协作与流程>.
Limited palette: {{BRAND}}, {{ACCENT}}, {{BG}} / {{BG_ALT}}, dark gray accents.
Flat design, simple human figures, geometric shapes, clean color blocks, no perspective, no text, no watermark, light background.
<size>.
```

#### case 模板
```
Friendly business flat illustration showing a product/service scenario.
Theme: <本页主题，1句>.
<具体业务场景，人物使用产品/服务>.
Limited palette: {{BRAND}}, {{ACCENT}}, {{BG}} / {{BG_ALT}}, dark gray accents.
Flat illustration style, simple characters, clean UI-like shapes, no photorealism, no text, no watermark.
<size>.
```

#### data 模板
```
Flat business infographic illustration for an enterprise keynote.
Theme: <本页主题，1句>.
Clean charts, human icons, process arrows, percentage circles arranged in a flat composition.
Limited palette: {{BRAND}}, {{ACCENT}}, {{BG}} / {{BG_ALT}}, dark gray accents.
Flat design, no 3D, minimal shadows, no text, no watermark.
<size>.
```

---

### S-C 国风水墨

- **适用**：文化、历史、中国品牌、文旅、非遗、东方哲学
- **渲染**：留白、水墨晕染、书法笔触、淡雅配色、纸质肌理
- **构图**：大面积留白、主体偏于一隅、山水/云纹/建筑轮廓
- **禁忌**：西式几何、3D 写实、高饱和荧光、现代 UI 元素

#### concept 模板
```
Elegant Chinese ink-wash style illustration for a keynote.
Theme: <本页主题，1句>.
<场景描述，突出东方意境：山水、云雾、建筑、人物剪影>.
Color palette: muted {{BRAND}} as accent, {{ACCENT}} for subtle highlights, soft {{BG}} / {{BG_ALT}} rice-paper background, charcoal gray ink.
Traditional Chinese painting aesthetic, ink wash gradients, calligraphic brush strokes, generous negative space, no text, no watermark.
<size>.
```

#### case 模板
```
Chinese ink-wash style illustration showing a cultural/business scene.
Theme: <本页主题，1句>.
<具体场景，如品牌故事、非遗工艺、文旅场景>.
Color palette: muted {{BRAND}} accents, {{ACCENT}} highlights, {{BG}} / {{BG_ALT}} paper texture, charcoal ink lines.
Elegant traditional style, soft ink diffusion, minimal color, no photorealism, no text, no watermark.
<size>.
```

#### data 模板
```
Chinese ink-wash infographic illustration for a keynote.
Theme: <本页主题，1句>.
Ink-brush charts, seal stamps, scroll-like layouts, delicate mountain/river motifs as decorative frames.
Color palette: {{BRAND}} accents, {{ACCENT}} details, {{BG}} / {{BG_ALT}} paper background, charcoal ink.
Traditional style, flat ink strokes, no 3D, no text, no watermark.
<size>.
```

---

### S-D 3D 黏土风

- **适用**：消费、教育、母婴、生活方式、年轻化品牌
- **渲染**：圆润立体、柔和光影、亲和可爱、微缩场景感
- **构图**：微缩角色与物件、饱满构图、暖光氛围
- **禁忌**：尖锐边缘、暗黑写实、复杂金属质感、商务严肃感

#### concept 模板
```
Cheerful 3D claymorphism illustration for a keynote.
Theme: <本页主题，1句>.
<场景描述，圆润角色与物件互动>.
Color palette: soft {{BRAND}}, {{ACCENT}}, {{BG}} / {{BG_ALT}} background, warm shadows.
Clay 3D style, rounded forms, soft diffused lighting, matte surfaces, friendly characters, no text, no watermark.
<size>.
```

#### case 模板
```
Cheerful 3D clay-style product/usage scene illustration.
Theme: <本页主题，1句>.
<具体使用场景，人物/角色与产品互动>.
Color palette: {{BRAND}}, {{ACCENT}}, {{BG}} / {{BG_ALT}}, warm shadows.
Clay 3D style, rounded shapes, soft lighting, no photorealism, no text, no watermark.
<size>.
```

#### data 模板
```
Cheerful 3D clay-style infographic illustration for a keynote.
Theme: <本页主题，1句>.
Rounded 3D charts, chunky icons, clay numbers and progress bars arranged playfully.
Color palette: {{BRAND}}, {{ACCENT}}, {{BG}} / {{BG_ALT}}, warm shadows.
Clay 3D style, no sharp edges, no text, no watermark.
<size>.
```

---

### S-E 写实摄影风

- **适用**：高端地产、制造、汽车、医疗、实体产品、奢侈品
- **渲染**：真实摄影 + 轻量图形叠加、自然光影、质感强烈
- **构图**：真实场景为主体，图形元素仅作点缀/标注
- **禁忌**：纯卡通、等距插画、荧光色、水印

#### concept 模板
```
High-end realistic photography-based visual for an enterprise keynote.
Theme: <本页主题，1句>.
<真实场景描述，如工厂/城市/产品/人物工作场景>.
Color treatment: warm highlights in {{BRAND}}, cool accents in {{ACCENT}}, clean {{BG}} / {{BG_ALT}} negative space.
Real photography aesthetic, natural lighting, subtle graphic overlays, no cartoon, no watermark, no text.
<size>.
```

#### case 模板
```
High-end realistic photography showing a product/business scenario.
Theme: <本页主题，1句>.
<具体场景，产品/服务在真实环境中的应用>.
Color treatment: {{BRAND}} warm accents, {{ACCENT}} cool accents, {{BG}} / {{BG_ALT}} negative space.
Real photography style, shallow depth of field, natural light, minimal graphic overlays, no text, no watermark.
<size>.
```

#### data 模板
```
Realistic photography-based infographic visual for an enterprise keynote.
Theme: <本页主题，1句>.
Clean data overlays on a real photography background: percentage labels, thin lines, minimal charts.
Color treatment: {{BRAND}}, {{ACCENT}}, {{BG}} / {{BG_ALT}} overlays.
Photo-real base, flat data graphics, no cartoon, no watermark, no text.
<size>.
```

---

### S-F 极简线条

- **适用**：金融、数据、学术、高端咨询、极简品牌
- **渲染**：单色线稿、无填充或轻填充、信息密度高、理性克制
- **构图**：网格、流程图、抽象符号、精确对齐
- **禁忌**：复杂阴影、写实、卡通、高饱和多色

#### concept 模板
```
Minimalist line-art illustration for an enterprise keynote.
Theme: <本页主题，1句>.
<抽象概念描述，用线条、节点、箭头表达>.
Color palette: {{BRAND}} lines on {{BG}} background, {{ACCENT}} accent nodes, dark gray details.
Single-weight line art, no fills or very light fills, precise geometry, generous white space, no text, no watermark.
<size>.
```

#### case 模板
```
Minimalist line-art illustration showing a product/service structure.
Theme: <本页主题，1句>.
<产品结构/服务流程，用线稿表达>.
Color palette: {{BRAND}} lines, {{ACCENT}} highlights, {{BG}} / {{BG_ALT}} fills, dark gray details.
Line-art style, thin consistent strokes, minimal shading, no photorealism, no text, no watermark.
<size>.
```

#### data 模板
```
Minimalist line-art infographic for an enterprise keynote.
Theme: <本页主题，1句>.
Clean charts, axes, nodes, flow lines, thin grid — all rendered as precise line art.
Color palette: {{BRAND}} primary lines, {{ACCENT}} accent lines, {{BG}} / {{BG_ALT}} background, dark gray details.
Line-art style, no fills, no 3D, no text, no watermark.
<size>.
```

---

## 3. 画风推导规则（ppt-design 使用）

按以下优先级为 deck 选择 `styleId`：

1. 用户显式指定 `style_pref` → 直接选用对应 styleId，可在此基础上微调。
2. 未指定时，按内容主题/行业映射：
   - 科技/SaaS/AI/数字化 → **S-A 现代 SaaS 等距**
   - 咨询/培训/人力资源/流程 → **S-B 商务扁平插画**
   - 文化/历史/文旅/中国品牌 → **S-C 国风水墨**
   - 消费/教育/母婴/年轻化 → **S-D 3D 黏土风**
   - 高端地产/制造/汽车/医疗/实体 → **S-E 写实摄影风**
   - 金融/数据/学术/极简 → **S-F 极简线条**
3. 若一份 deck 跨越多个行业，以**主基调**为准，次要页也走同一风格（保证统一）。

### 3.1 自定义风格通道（库外）

当用户要求一套库外的独特画风（如"故障艺术 glitch""孟菲斯波普""蒸汽波 vaporwave""莫兰迪低饱和质感"），不要硬套 S-A ~ S-F。处理流程：

1. `ppt-design` 基于用户描述 + 设计判断，实时创作该 style 的：
   - 名称、适用描述、渲染技法、构图特征、禁忌；
   - `concept` / `case` / `data` 三套完整提示词模板（可直接用 `{{BRAND}}` 等占位符）。
2. 以 `styleId: U1 / U2 ...` 命名，把三套模板作为 **内联 `styleTemplates`** 写入 `design-spec.json`（见 ppt-design 输出契约），不依赖本库文件。
3. `ppt-gen-images` 执行时：**若 `design-spec.json` 含该 styleId 的内联 `styleTemplates`，优先使用内联模板**；否则回退到本文件风格库。
4. 若该风格预期会复用，沉淀进本文件新增一条风格条目（按 workflow.md 的沉淀机制），变成团队资产。

> 原则：库是起点不是终点。库内风格保证下限稳定，库外自定义满足上限创意。两者都通过同一套占位符与 mode 机制运行，互不冲突。

## 4. Mode 定义（不变）

每页配图在生成前需标注 mode，由 `ppt-design` 按内容判定：

- **concept**：概念/框架/阶段/趋势页，需要解释抽象关系。
- **case**：案例/产品/业务场景页，需要展示具体情境。
- **data**：数据/统计/趋势页，需要图表或信息图。

## 5. 占位符与尺寸规则

### 颜色占位符（gen-images 替换）

- `{{BRAND}}` ← `--c-brand`
- `{{ACCENT}}` ← `--c-accent`
- `{{BG}}` ← `--c-bg`
- `{{BG_ALT}}` ← `--c-bg-alt`

### 尺寸规则

- 生成 size：竖版 `1024x1536` / 横版 `1536x1024` / 方 `1024x1024`，由每页排版规划指定。
- 后处理（硬性）：
  1. 裁掉底部生成水印（约 70px）。
  2. 缩放最长边 ≤1080px。
  3. JPEG q85，文件 ≤200KB。
  4. 存 `cases/<页>_<槽位>.jpg`。
- 单张串行生成，避免文件名冲突与限流。

### 提示词构建流程

`ppt-gen-images` 执行：

1. 读 `design-spec.json` 得到 `palette` 和 `styleId`。
2. 从本文件找到 `styleId` 对应风格。
3. 根据该页 `mode` 取对应模板。
4. 替换 `<本页主题>`、`<场景描述>`、`<size>` 为规划中的内容。
5. 替换 `{{BRAND}}` / `{{ACCENT}}` / `{{BG}}` / `{{BG_ALT}}` 为实际色值。
6. 调用 ImageGen。
