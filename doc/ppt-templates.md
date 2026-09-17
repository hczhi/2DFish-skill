# 版式案例库：数据怎么记的，怎么快速录一条新版式

**案例库是文件，不在数据库里。** 65 条版式全部记在 `server/src/services/ppt/library/` 下的几份 md/html 里，启动时解析进内存。

为什么不做成表：这批数据的每一次改动都要**和 `template.html` 的 CSS 对账**（类名、变量名、字号下界、`.slide-inner` 包不包），而对账是 `caseLibrary.test.ts` 那 13 条断言干的 —— 放进库里之后 git diff 看不见、测试跑不到，改错一个类名的表现是"那一块掉回默认流式布局"，页面照样渲染、接口 200。
所以 Python 版**原样搬这几个文件**，不要建表。

---

## 1. 文件与职责

| 文件 | 行数量级 | 谁读它 | 缺了会怎样 |
| --- | --- | --- | --- |
| `layout-library.md` | 832 | `layoutLibrary.loadLibrary()` | **抛错**（整个 /ppt 起不来）—— 这是唯一来源，缺了它生成出来的版式全是模型自己编的 |
| `cases/L<n>-<name>.md` | 65 个文件 | 同上，作为那一条的 `buildText` | 那一条静默变成"无详情"，生成时拿不到 CSS 骨架，页面结构自由发挥，而列表上看不出区别 |
| `template.html` | 1534 | `deckShell`（外壳 + `templateClasses()` / `templateVars()`） | 读不到就是空串 → 所有类名都判"未定义" |
| `design-tokens.md` | 104 | 生成一页的 prompt | 空串（prompt 里少一段） |
| `illustration-style.md` | 317 | `styleLibrary.parseStyles()` | **抛错**（0 套画风） |
| `demo-slides.html` | 2219 | `demoDeck.demoFragments()` | **抛错**（案例库页面上每张卡的效果图都来自它） |
| `client/public/ppt-cases/L<n>-ref.{jpg,png}` | 静态图 | `GET /layouts` 的 `refImage` | 卡片上没有参考图（不报错） |

**缓存按 mtime 失效**（`libraryVersion()` 取这几个文件 mtime 的最大值）：改完 md **不用重启**，下一次请求就是新的。
派生缓存（`styleLibrary` 的画风、`deckShell` 的类名/变量集合）跟着同一个版本号一起作废 —— 不跟的话"md 改了一半生效"，而两边都不报错。

---

## 2. 索引条目的字段规范（`layout-library.md`）

### 2.1 条目标题

```
## L12 · circle-float-card（圆形浮卡）📄 详情
```

解析正则（照抄，别"优化"）：

```
/^##\s+L(\d+)\s*[·•]\s*`?([A-Za-z0-9-]+)`?\s*(?:[（(]([^）)]*)[）)])?/
```

- `L(\d+)` → `id` / `num`；名字可以被反引号包着（L17 起有）；括号里那段是中文标题 `title`（可省）。
- 一条的正文从标题下一行开始，遇到 **`---` 单独一行**或 **`> **★` 开头的行**就结束（文末那几句 ★ 总结段不属于任何一条）。
- 标题写错格式（少了 `·`、编号写成 `L 12`）→ 那一条**静默消失**，而列表上其余 64 条都在。解析出 0 条时才抛错。

### 2.2 字段行

一律 `- **标签**：内容` 一行（正则 `^-\s*\*\*标签\*\*\s*[：:]\s*(.*)$`，取第一处匹配，**多行内容只取第一行**）。

| 标签 | 必填 | 进哪 | 写错的后果 |
| --- | --- | --- | --- |
| `归属` | **是，缺了抛错** | `roles: PageRole[]`（`封面` / `章节` / `内容` / `结尾`，可多选，分隔符 `/ 、,，空格·`） | **认不出来的词一律抛错，不是跳过。** 跳过的话这一条从某个页型的清单里消失，而规划照样出一份挑得"都对"的清单 |
| `形状` | **是，缺了抛错** | `shape: LayoutShape`（`聚焦` / `分屏` / `并列` / `对比` / `数据` / `时序`，**单选**） | 缺了它规划时"四块并列的内容"和"两块对立的内容"在模型眼里没有区别，挑出来的版式装不下这一页而不报错 |
| `是否全幅` | 否（缺了按文末集合判） | `fullbleed` | 值必须以 `是` / `否` 开头，否则**抛错**。先剥掉 markdown 的 `**`（写成 `**是**（…）` 时 `startsWith('是')` 是 false，那一条静默变成普通页）。"视情况"这种写法会被当成"否"，同样一个字都不报 |
| `适用` | 否 | `applicable` → `selectText` | 少了它模型按场景词匹配的线索变少 |
| `结构` | 否 | `structure` → `selectText`（**截到 160 字一行**） | — |
| `图槽位` | 否 | `imageSlots` → `selectText` | 原文照抄，**张数和构图要求都在里面，别拆成数字** |
| `design 提示` | 否 | `designHint` → `selectText`（截 160 字） | — |
| `变体` | 否 | `variants`（目前只存着，不进 prompt） | — |
| `来源` | 否 | 从里面抽参考图：`/cases\/img\/(L\d+-ref\.\w+)/` → `/ppt-cases/<文件名>` | 抽不到就没有 `refImage`（不报错） |

`demoUrl` **一律是** `/api/ppt/demo-deck.html?only=L<n>`，不指静态文件。库文件"来源"里那几个 `cases/L11-demo.html` 是当初随案例抄来的独立 html，各自复制了一份版式 CSS —— 改了 template 之后那几页照旧好看，而生成出来的页面已经变了。

### 2.3 文末三句 `★` 是**被代码解析**的（其余几句只是给人看的）

正则：`★\s*<标签>[（(]([^）)]*)[）)]`，括号里按 `/ 、,，空格` 切，每段认 `L?\d+`。

| 那一句 | 进哪 | 漏了会怎样 |
| --- | --- | --- |
| `★ 不贴统一页眉的版式（L2 / L13 / L23 / L34 / L35 / L55 / L56）` | `noHeader` | **这一句解析成空集合直接抛错**：空集的表现是"每一页都贴页眉"，封面上凭空多出一行模块名，那一页照样是完整的幻灯片 |
| `★ 全幅版式集合（L11 / L13 / L18 / …25 条）` | `fullbleed`（条目自己写了 `是否全幅` 时以条目为准） | 新条目漏进集合就会被包进 `.slide-inner`，出来是一张四边留白的"全幅"图 |
| `★ 出血版式（L12）` | `hasCard` | section 少了 `has-card` → `overflow` 挡住色带，出来是一张"卡片四周留白"的正常页 |

另外几句（`★ 上下分屏版式` / `★ 横向分屏版式` / `★ 全幅浮信息版式` / `★ 报告风版式集合`）**代码不读**，是给人和 AI 看的分类说明 —— 但"报告风那十七条共用 `.rp-head` / `.rp-foot`，各案例 md 里那段 CSS 是抄过来对账用的"这条约定是 `caseLibrary.test.ts` 在管。

**"背景图铺满整页"不算全幅。** L2 / L3 / L23 的图是绝对定位铺满的，文字照旧在 `.slide-inner` 里。判据只有一条：**demo 片段里有没有 `.slide-inner`**（`demoDeck.test.ts` 拿它和这一句对账）。算进来的话它们生成出来的文字贴着画面边缘，且疏密档（D-A/D-C 改的就是 `.slide-inner` 的 padding）在它们身上一个像素都不动 —— 而 L2 是整份里用得最多的那条章节封面。

### 2.4 两份文本，不能混用

| | 内容 | 给谁 |
| --- | --- | --- |
| `selectText` | 6–7 行：`L1 hero-right-visual（右侧全高视觉）` / `归属：… · 形状：…` / `适用：` / `结构：`（≤160字） / `图槽位：` / `fullbleed：是\|否` / `提示：`（≤160字） | **规划**那一次，65 条全带 |
| `buildText` | 详情 md **全文**；没有详情时回落索引条目原文（`entry.raw`，含标题行） | **生成一页**那一次，只带那一条 |

`归属` / `形状` 必须排在 `selectText` 最前面：埋在"适用"后面的话模型只按那一串场景词匹配，于是章节扉页拿到四栏矩阵。

全部 65 条的 `selectText` 原文在 `doc/ppt-fixtures/golden/layoutLibrary.selectTexts.txt`，Python 版解析完拿它逐字节对。

### 2.5 详情 md 按 **`L<编号>-` 前缀**找，不按版式名

```
cases/ 下第一个 f.startsWith(`L12-`) && f.endsWith('.md') 的文件
```

L12 的文件名还是 `L12-bio-portrait-card.md`，而条目名早就按结构改成了 `circle-float-card`。按名字找的话那一条被判成"无详情"，生成时拿不到 CSS 骨架，出来的页面结构自由发挥，而列表上看不出区别。

### 2.6 详情 md 内部**不被代码解析**

`cases/L*.md` 里那些小标题（`一句话定位` / `结构拆解` / `CSS 骨架` / `build-part 结构模板` / `图槽位` / `变体` / `design 提示`，有的还编着"一、二、三"）**没有一处进正则** —— 整份原样喂给模型。
被机器读的只有两种代码块，而读它们的是**测试**不是运行时：

- ` ```html ` 块 = build-part 结构模板（类名、`.slide-inner`、图片地址、字号、领句都从这里核）
- ` ```css ` 块 = CSS 骨架（和 `template.html` 逐条声明对账）

所以详情 md 的散文部分想怎么写就怎么写，**但那两种代码块必须和 `template.html` 一致**。

---

## 3. 录一条新版式：要改的 5 处

顺序照下面走（第 1 步做完就能在 `GET /layouts` 里看到它，第 5 步做完卡片上才有效果图）：

| # | 改什么 | 不做的后果 |
| --- | --- | --- |
| 1 | `layout-library.md` 加一段 `## L66 · <name>（<中文标题>）`，带齐 `适用` / **`归属`** / **`形状`** / `结构` / `图槽位` / `是否全幅`（+可选 `design 提示` / `变体` / `来源`） | `归属`/`形状`缺了直接抛错（起不来，好事）；整段格式写错则那一条静默不存在 |
| 2 | 文末 `★` 三句：全幅的加进"全幅版式集合"，封面不贴页眉的加进"不贴统一页眉的版式"，要出血的加进"出血版式" | 全幅漏了 → 四边留白的"全幅"图；页眉漏了 → 封面上多一行模块名 |
| 3 | `cases/L66-<name>.md`：`CSS 骨架`（```css）+ `build-part 结构模板`（```html）+ 图槽位说明 | 没这个文件那一条就"无详情"，`buildText` 回落成索引条目那六行 —— 模型没有 CSS 骨架可照，出来的结构自由发挥 |
| 4 | `template.html`：把新用到的类和变量**真的定义进去**（`<style>` 里的选择器 + `:root`） | 类名对不上 → 那一块掉回默认流式布局（页面照样渲染，看起来像"这个版式塌了"）；变量名编一个 → 浏览器把**整条声明**丢掉，看起来只是"这一版配色淡了点" |
| 5 | `demo-slides.html`：加一段 `<!-- @demo L66 -->` + 一个完整 `<section>`（**非全幅的要包 `.slide-inner`，全幅/出血的不能包**） | 缺片段 → `demoDeck` 抛错（`GET /demo-deck.html` 整个 500）；片段里没 `<section>` 或重复 → 同样抛错 |
| +可选 | `client/public/ppt-cases/L66-ref.png` + 条目里写 `- **来源**：… cases/img/L66-ref.png` | 卡片上没有参考图（不报错） |

**不用改任何代码、不用重启**（mtime 缓存）、**不用写 migration**。

---

## 4. 验收：跑测试，13 条断言就是验收表

```bash
nvm use 21.7.3
cd server && npx vitest run src/services/ppt/caseLibrary.test.ts src/services/ppt/layoutLibrary.test.ts src/services/ppt/demoDeck.test.ts
```

**录完一条新版式，这三个文件全绿就是通过。** 不绿的话报错里会直接点名"哪个文件的哪个类名/变量/声明对不上"。

### 4.1 `caseLibrary.test.ts`（13 条，只扫 `cases/*.md` 里的代码块）

| # | 断言 | 拦的是什么 |
| --- | --- | --- |
| 1 | 结构模板里用到的每个类名都在 `template.html` 里有定义（**根 `<section>` 那一行不算**） | 模型照 md 写出 `<div class="tri-head">`，template 里没这条 → 那一块掉回默认流式布局，屏幕上是"这个版式塌了"，而 `checkPage` 会建议"重新生成一次"（那句话此时是假的，他会一遍遍花钱重试） |
| 2 | 骨架里用到的每个 `var(--*)` 都在 `template.html` 的 `:root` 里有定义 | `--c-text` / `--c-text-2` / `--c-line` 这批编出来的名字在 5 份 md 里活了很久：浏览器把整条声明丢掉，看起来只是"这一版配色淡了点"。模型是照这几份 md 写 inline style 的，md 里编一个，生成的每一页就都带着它 |
| 3 | md 的 CSS 骨架和 `template.html` **逐条声明**一致 | 两边漂开时没有一处报错。改了 template 忘了改 md 会报错，反过来在 md 里加一条 template 没有的规则也报错 |
| 4 | 结构模板里**不写**统一页眉 | 页眉是代码贴的（`applyHeader`）。md 里写了 → 模型跟着写 → 被代码摘掉，而正文里那一行模块名重复显示 |
| 5 | 非全幅版式的结构模板**必须**包 `.slide-inner`；全幅和出血版式**必须不**包 | 包错了不报错，只是全幅变成四边留白的图（或普通页贴边） |
| 6 | 根 `<section>` 上只出现 `template.html` 里真有定义的类（包装层是里面的第一个 div） | 根那一层的语义标签不影响画面，但真正的拼写错误要在这里抓 |
| 7 | 配色归一表里不留十六进制色值 | 换 palette 时那几处不会跟着变 |
| 8 | 骨架和结构模板里没有低于 `MIN_FONT_PX = 14` 的字号 | 1920 舞台上的 12px 投屏后就是 12px，后排读不出来，而他自己电脑上看得清 |
| 9 | 结构模板里并排的那几张图是同一个高度（`imageGroupProblems`） | 一行里矮 40px 的那一格 → 图下面那几行小字全错开一行；混比例要等真图配上来才看得见，那时钱已经花了 |
| 10 | 结构模板里的领句不是标题的复制（`leadEchoProblem`） | 这一页占了两行却只说了一件事，而它渲染出来完全正常、类名全对 |
| 11 | 结构模板里的图片地址只用占位图，不编外链 | 编出来的地址是破图，而破图和"这一格本来是空的"长得一样 |

（表里合并了同一个 `it` 里的多条断言，代码里是 11 个 `it`。）

### 4.2 `layoutLibrary.test.ts`（4 条）

- **65 条**全部解析出来，且每条的 `selectText` / `buildText` 都非空。**新增一条要把这个数字改成 66** —— 改不动这个数字就说明第 1 步的格式写错了。
- `fullbleed` 只认"内容不包 `.slide-inner`"，"背景图铺满"不算。
- 详情按 L 编号找而不是按版式名（改过名的 L12 也要带上 CSS 骨架）。
- `library/` 目录里的文件一改就重读，派生缓存跟着作废。

### 4.3 `demoDeck.test.ts`（5 条）

- 每个版式都有一段 demo（**一一对应，不多不少**）。
- 片段里用到的每个类名都在 `template.html` 里有定义。
- 片段里有没有 `.slide-inner` 要和 `fullbleed` 标记一致（**L2 曾经两边相反**）。
- 拼出来的整份 deck 有 65 页且不留占位符。
- `?only=` 只出那一页；认不出的 id 抛 `DemoNotFoundError` 而不是回空 deck。

---

## 5. 全部抛错条件（Python 版必须一条不少地照抄）

启动/首次读库时抛，**宁可起不来也不要静默降级** —— 下面每一条静默之后的表现都是"一份完整正常的演示稿"：

| 抛错点 | 条件 |
| --- | --- |
| `loadLibrary` | `layout-library.md` 不存在 |
| `loadLibrary` | `★ 不贴统一页眉的版式（…）` 那一句解析出**空集合** |
| `loadLibrary` | 解析出 **0 条**案例 |
| `loadLibrary` | 某个 `PageRole`（封面/章节/内容/结尾）**一条版式都没有** |
| `parseRoles` | `归属` 里有认不出来的词 |
| `parseRoles` | 缺 `- **归属**：` 这一行 |
| `parseShape` | `形状` 认不出来 / 缺这一行 |
| `buildLayout` | `是否全幅` 的值不以 `是` / `否` 开头 |
| `loadFragments` | `demo-slides.html` 不存在 |
| `loadFragments` | 某段 demo 里没有 `<section>` |
| `loadFragments` | 同一个 id 有两段 demo |
| `loadFragments` | 解析出 0 个片段 |
| `parseStyles` | 解析出 0 套画风（缺三个 mode 之一的那套先被丢掉） |
| `demoDeck(only)` | `only` 认不出来 → `DemoNotFoundError`（404），不是回空 deck |
| `setLayoutEnabled` | 要停用的是某个 `PageRole` 的最后一条 → 拒绝；某个内容页形状整类消失 → 照做但回 warning |

---

## 6. 让 AI 帮你录：可以直接粘的一段提示词

手上有"一张截图 + 一段 HTML"的时候，把下面这段连同**这份文档的 §2 和 §3**一起发给写代码的 AI。它要产出的是 5 个 diff，不是解释。

````text
你在给一个 HTML 演示稿系统的版式案例库录一条新版式。案例库是文件不是数据库，规范见
doc/ppt-templates.md 的 §2（字段规范）和 §3（要改的 5 处）。

我给你：
1. 一张这一页的截图（或设计稿）
2. 这一页的 HTML（可能带自己的 <style>）

你要产出 5 个改动，**每个都给出可直接落盘的完整内容或精确 diff**：

① server/src/services/ppt/library/layout-library.md 末尾新增一条 `## L<下一个编号> · <kebab-name>（<中文标题>）`：
   - 必须有 `- **归属**：` （只能从 封面/章节/内容/结尾 里挑，可多选，用 ` / ` 分隔）
   - 必须有 `- **形状**：` （只能是 聚焦/分屏/并列/对比/数据/时序 里的一个）
   - 必须有 `- **是否全幅**：是` 或 `否`（值必须以「是」或「否」开头，不要写「视情况」）
   - 再写 `- **适用**` / `- **结构**` / `- **图槽位**` / `- **design 提示**` / `- **变体**`
   - 结构和 design 提示写在一行里（解析只取第一行）
② 同一份文件末尾那三句 ★ 集合：全幅的加进「全幅版式集合」，封面不贴页眉的加进「不贴统一页眉的版式」，
   需要色带溢出卡片的加进「出血版式」。不涉及的那几句不要动。
③ server/src/services/ppt/library/cases/L<编号>-<kebab-name>.md：
   - 一段 ```css 的「CSS 骨架」，逐条声明必须和 template.html 里那几条**完全一致**（不一致测试会逐条报错）
   - 一段 ```html 的「build-part 结构模板」：非全幅要包 <div class="slide-inner">，全幅/出血不要包；
     不要写 .slide-header（页眉由代码贴）；图片只用 /ppt-cases/ph-16x9.svg / ph-1x1.svg / ph-3x4.svg
     并各带 data-img-prompt 和 data-img-mode；并排的图高度写同一个值；不要出现小于 14px 的字号；
     领句（.kicker / *-eyebrow）不许和标题写同一句话；不要写页码
④ server/src/services/ppt/library/template.html：把 ③ 里新用到的类加进 <style>、新变量加进 :root。
   **不许发明 template.html 里没有的类名或 var(--…)**；能复用现有类的一律复用。
⑤ server/src/services/ppt/library/demo-slides.html：新增 `<!-- @demo L<编号> -->` + 一个完整 <section>，
   .slide-inner 的有无必须和 ① 里的「是否全幅」一致。

最后给出验收命令，并说明失败时该改哪个文件：
nvm use 21.7.3 && cd server && npx vitest run src/services/ppt/caseLibrary.test.ts src/services/ppt/layoutLibrary.test.ts src/services/ppt/demoDeck.test.ts

另外把 layoutLibrary.test.ts / demoDeck.test.ts 里写死的条数（现在是 65）改成新的条数。

不要改任何 .ts 业务代码，不要写 migration，不要新建文档。
````

---

## 7. 停用版式（全站，不是按用户）

录进来的版式**不删只停**：`system_config.ppt_disabled_layouts`（JSON 字符串数组）。

- 只有 `enabledLayouts()` / `enabledLayoutsForRole()` 两个入口过滤。**别处直接读 `layouts()` 的话停用的那条照旧被选中**（规划出来的每一页都合法，一处不报错）。
- 值坏了要抛 `LayoutStateError`，不能当成"没停用任何一条"。
- 不允许停掉任一 `PageRole` 的最后一条；某个内容页形状整类消失时照做但回 warning。

停用只影响**规划挑版式**这一步：已经生成好的页面照旧渲染（它们的 CSS 还在 `template.html` 里）。
