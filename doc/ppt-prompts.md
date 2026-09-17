# PPT 模块的六处 prompt 与全部校验规则

**这一份是照抄件，不是参考件。**

接口签名可以用 Python 的写法重写，prompt **一个字都不要改**：不要翻译、不要精简、不要"顺手改通顺"、不要把语气改客气、不要把中文换成英文、不要把"硬规则"合并成几条。
这几段话里的每一句都是对着一种"输出完全正常但内容是错的"改出来的 —— 删掉一句之后，Python 版每个接口都 200、每一页都渲染得漂漂亮亮，而里面的内容悄悄变了。
下面每段 prompt 底下都注了那句话在挡什么。

原文位置（照它核对，以代码为准）：

| # | prompt | 位置 |
| --- | --- | --- |
| 1 | 清洗提纲 | `services/ppt/outlineCleanService.ts` `buildPrompt` |
| 2 | 规划整份 | `services/ppt/planService.ts` `buildPrompt` |
| 2b | 重排图位 | `services/ppt/planService.ts` `buildReplanPrompt` |
| 3 | 生成一页 | `services/ppt/pageService.ts` `buildPrompt`（+ `imageSpecBlock` / `notesBlock`） |
| 4 | AI 编辑（微调） | `services/ppt/aiEditService.ts` `buildPrompt` |
| 5 | AI 改造（自由重排） | `services/ppt/aiRemakeService.ts` `buildPrompt` |
| 6 | 生图提示词 | `services/ppt/styleLibrary.ts` `renderStylePrompt` + `library/illustration-style.md` |

---

## 0. 六处调用参数一览

| prompt | operation | temperature | max_tokens | 出口 | 截断时 |
| --- | --- | --- | --- | --- | --- |
| 清洗提纲 | `clean-outline` | 0.2 | `MAX_CLEAN_TOKENS = 3000` | `jsonGateway`，`mode:'array'`, `attempts:2` | **抢救**断点前那几条 + 出声 |
| 规划整份 | `plan-deck` | 0.3 | `MAX_PLAN_TOKENS = 10000` | `jsonGateway`，`mode:'array'`, `attempts:2` | **抢救** + 出声 |
| 重排图位 | `replan-images` | 0.3 | `MAX_REPLAN_TOKENS = 2000` | `jsonGateway`，`mode:'array'`, `attempts:2` | **不抢救**，直接报错 |
| 生成一页 | `build-page` | 0.6 | `MAX_PAGE_TOKENS = 6000` | `aiGateway`（回的是 HTML，不是 JSON） | 报错（带 `finish` / `reasoningTokens`） |
| AI 编辑 | `ai-edit-region` | 0.3 | `MAX_EDIT_TOKENS = 6000` | `jsonGateway`（对象） | 报错 |
| AI 改造 | `ai-remake-region` | 0.5 | `MAX_REMAKE_TOKENS = 9000` | `jsonGateway`（对象） | 报错 |

六处共同的：

- `source: 'ppt'`、`userId` = deck 的 `user_id`、**`noThinking: true`**。
- **都不指定 `tier`**（走 `default`）。平台渠道可能压根没有 `strong` 那一档（回落 `default`），指定它只是让人以为"换成强模型了"。
- **都不发 `response_format`**。格式靠 prompt + `jsonGateway` 的解析与重试。
- 解析失败一律走**同一份** `jsonFailMessage(什么任务, {raw, finish, reasoningTokens, budget, noThinkingRequested})`：空返回 / 截断 / 没按 JSON 回三种成因解法完全不同，且报错里必须带思维链 token 数 —— 不带的话用户只会一路调高 `max_tokens`，而那个数字永远调不完。
- `finish_reason = 'length'` **不重试**（同一个 body 断在同一处，只是把 token 和时间花两遍）。

---

## 1. 清洗提纲（`outlineCleanService.buildPrompt`）

输入：`lines = outline.split('\n')`。**行号由代码编好写进 prompt**（`${i+1}| ${line}`），不让模型自己数。

````text
你在帮人整理一份演示稿提纲。任务：**只找出哪几行是无效信息**，把它们的行号列出来。

无效信息指的是：他写给自己的备注和待办（「这里要补一张图」「记得改数字」「TODO」）、
会议记录里的口头语和寒暄、文件名／路径／链接堆、重复的标题行、「以下内容来自 XX 文档」
这类元信息、纯装饰的分隔符。

## 硬规则（违反其中任何一条，这次整理就是废的）
1. 你**只输出行号**，删除的动作由程序做。不许改写、合并、润色、重排、补写任何一行 ——
   留下来的每一行都会逐字进入成稿。
2. **宁可少删。** 一行里有任何实质信息就绝对不许列：数字、金额、比例、日期、人名、
   机构名、产品名、条款、要点、结论都算实质信息。删错一行的后果是那句话再也不会出现在
   成稿里，而整理后的提纲读起来完全通顺，没有人看得出少了什么。
3. 一整段都是备注时，把那几行**逐行**列出来（不认区间写法）。
4. 空行不用管，程序自己处理。
5. `why` 要具体到能核对（「他自己的待办：这里要补一张图」），不许写「无关内容」这种话。
6. 一行都不用删就输出 `[]`。

## 提纲（每行开头的数字是行号，只用它）
${numbered}

## 输出格式
只输出一个 JSON 数组，不要任何解释文字。每个元素：
{"line":12,"why":"为什么这一行是无效信息"}
````

代码侧的配套约定（漏一条这个功能就变危险）：

- 行号越界 / 重复 / 非整数的一律丢掉，别信模型给的下标。
- 删除**不落库**：接口只回"建议删这几行 + 每行原文 + 理由"，删不删由用户点。
- 截断时抢救断点前那几条**但要说出来** —— 不说的话他以为整理完了，而后半截的备注一条都没动。

---

## 2. 规划整份（`planService.buildPrompt`）

输入：`outlineLines`（编号后的提纲）+ `lib`（**已过滤停用版式**的 `PptLayout[]`）。

````text
你是演示稿的排版设计师。任务：把下面这份提纲拆成逐页，并**从给定的版式清单里**给每页挑一个版式。

## 硬规则（违反其中任何一条，这次规划就是废的）
1. `layoutId` **只能**是清单里出现过的编号（只有 ${lib.map(l => l.id).join(' / ')} 这几个，停用的已经不在里面），**原样照抄**。清单里没有的版式一律不许用，也不要自己发明版式或写 CSS。
2. 相邻页不要撞版式：**连续最多 2 页**用同一个版式。整份用到的版式种类越丰富越好，但每页仍要选最贴合内容的那个。
   **整份还要有节奏**：连着 5 页以上都是 `并列` / `数据` 这种密集页的话，每一页单看都对、整份翻起来像一叠表格 —— 每 4–6 页要留一页「喘气的」（`章节` 扉页 / 全幅图页 / `聚焦` 金句页）；数字堆完要接一页给落点的（结论或金句），不要连着三页都是指标；全幅图页别超过整份的三分之一（那一页的图是真花钱生成的）。
3. 每页都要给 `kind`（这一页是什么页）：`封面` / `章节` / `内容` / `结尾`。**第 1 页固定是 `封面`**；每个章节开头是 `章节`；最后一页通常是 `结尾`。
4. `layoutId` **只能从下面「页型 → 可用版式」里这一页页型那一行挑**。标了 `章节` 却挑一条只归 `内容` 的版式，那一页会排成一页正文 —— 每一页单看都合法，整份就是少了过渡感。
5. `内容` 页按这一页内容的**形状**挑（清单里每条都写了 `形状：…`）：3–4 个同构小块 → `并列`；两块对立 → `对比`；大数字 / 指标 → `数据`；阶段推进 / 时间线 → `时序`；图文各占一半 → `分屏`；单一主角（金句 / 人物 / 产品） → `聚焦`。
   **挑之前先核这一页有没有那条版式要的东西**（按门槛分四类，每条的 `形状` + `图槽位` 就是它属于哪一类）：
   - **要素材**：图槽位里有整页背景图或半屏 hero 的那几条 —— 这一页得真有一张值得占半屏的图可画。没有的话它就是一整块占位灰，而每一张真图都要单独花一次生图的钱。
   - **要形状**：`并列`（正好 3–4 个同构小块）/ `对比`（两块真的对立）/ `时序`（一串时间点或阶段）/ `数据`（有一个能当主角的数字）—— 内容不是这个形状的时候，后面那一步会**编**出第 4 块、或者把一件事劈成对立两栏：那一页排得整整齐齐、一处都不报错，而多出来的那块是它自己想的。
   - **要篇幅刚好**：`聚焦`（金句 / 人物 / 一句大标题）—— 这一页只能放一句话加三五行注解，一节六行数据塞进去只会被压字号或者切掉最后一行。
   - **通用**：`分屏` 里不带 hero 的、表格和长文那几条 —— 内容多寡都成立，是退路。
   核不上就退到**同一页型里通用那一条**，不要硬凑一个形状出来。
6. 每页只有一个视觉主角：图多的版式不要配大段文字，文字密的版式不要塞满图。
7. `why` 要写出**为什么这一页配这个版式**（这一页的内容结构是什么、版式的哪一处正好装得下），一句话，不要复述版式描述。
8. 不要输出页码 —— 顺序就是页码，由程序自己算。
9. `images` 是**这一页要哪几张图**的清单（不配图就给 `[]`）。每张写清三样：
   - `subject`：**画什么**，一句话、具体到能直接照着画（「等距视角的城市算力机房，蓝紫冷色」），不要写「一张配图」「相关插图」这类空话；
   - `mode`：`concept`（抽象概念插画）/ `case`（具体场景、产品、人物）/ `data`（信息图、图表感）；
   - `ratio`：`16:9`（横幅、全幅背景）/ `1:1`（方块图标位）/ `3:4`（竖图、人物卡）—— 按你挑的那个版式里图位的形状选，选错的图会被裁掉两边。
   张数要和版式装得下的图位数一致，一页最多 ${MAX_SLOTS_PER_PAGE} 张。
10. `lines` 是这一页对应**提纲原文的行号区间** `[起始行, 结束行]`（含两端，就是「## 提纲」里每行开头那个数字）：
   - **提纲的每一行都要被某一页认领**：整份下来 `lines` 要连成 `[1,x] [x+1,y] …` 一直到最后一行，不许跳过、不许两页认领同一行。
   - 后面写这一页的时候，程序会按这个区间把**提纲原文逐字**交给它 —— 所以区间给漏了，那几行内容一个字都不会出现在成稿里（而页面看起来仍然是完整的一页）。
   - 一节内容太多装不进一页时，**拆成两页各认领一半**，不要把整节压给一页。
   - `points` 照旧要给（它是这一页的骨架），但不要因为写了 points 就少认领行 —— points 是摘要，原文才是内容。
11. `alts` 是这一页的**备选版式**：从清单里再挑 2-3 个也装得下这一页内容的编号（**同样要在这一页页型那一行里**），按「越合适排越前」的顺序给。不许重复 `layoutId`、不许给清单里没有的编号（清单里没有的会被丢掉）。

## 页型 → 可用版式（`layoutId` 和 `alts` 只能从这一页页型对应的那一行里挑）
${roleBlock()}

## 版式清单（${lib.length} 个）
${lib.map(l => l.selectText).join('\n\n')}

## 提纲（每行开头的数字是行号，`lines` 要用它）
${numbered}

## 输出格式
只输出一个 JSON 数组，不要任何解释文字。每个元素：
{"kind":"内容","section":"所属模块名（如「第二部分 · 落地路径」，封面页可留空）","title":"这一页的标题","lines":[12,18],"points":["要点1","要点2"],"layoutId":"L7","alts":["L3","L9"],"why":"挑它的理由（一句话）","images":[{"subject":"画什么，一句话","mode":"concept | case | data","ratio":"16:9 | 1:1 | 3:4"}]}
````

三处插值：

| 插值 | 怎么算 |
| --- | --- |
| `roleBlock()` | 每个 `PageRole` 一行：`- 封面：L2（形状：聚焦） / L13（形状：聚焦） / …`，来源是 `enabledLayoutsForRole(role)` |
| `lib.map(l => l.selectText)` | **短文本**（`selectText`），不是 `buildText`。给全文的话一次规划的 prompt 就上万 token |
| `numbered` | `${i+1}| ${line}` 逐行 |

`selectText` 的实际样子（`doc/ppt-fixtures/golden/layoutLibrary.selectTexts.txt` 里是全部 65 条的原文，照它核）：

```text
L1 hero-right-visual（右侧全高视觉）
归属：内容 · 形状：分屏
适用：强观点页 / 金句页 / 单点强调
结构：左侧 54% 文字区（kicker+标题+金句+正文），右侧 46% 全高背景图（绝对定位 right:0 top/bottom:0），左向浅色渐变过渡。
图槽位：1 个（hero）。
fullbleed：否
```

代码补的、**不许信模型给的**那几样（硬规则 3）：`page`（顺序就是页码）、`layoutName` / `layoutTitle` / `fullbleed` / `demoUrl`（从案例库按 id 查）、`outlineText`（按 `lines` 从提纲原文切）、`images = imageSpecs.length`。
模型编一个版式 id 会撞上另一条版式，而出来是一页完整正常的幻灯片。

---

## 2b. 重排图位（`planService.buildReplanPrompt`）

换过版式之后点"生成这一页"会先自动跑一次这个（**只重排这一页的图位，不重新规划**）。

````text
你是演示稿的排版设计师。任务：给**这一页**定下要哪几张图（图位清单）。

## 硬规则
1. **张数按这一页的真实内容定，不是照版式案例抄。** 版式里那几个图位只是参考：内容分成 4 块就给 4 张，只有一个主视觉就给 1 张，纯文字页给 `[]`。一页最多 ${MAX_SLOTS_PER_PAGE} 张。
2. 顺序 = 图在这一页里从上到下、从左到右出现的顺序（后面按这个序号把图贴进去，顺序换了就会贴到讲别的事情的那一格）。
3. 每张写清三样：
   - `subject`：**画什么**，一句话、具体到能直接照着画（「等距视角的城市算力机房，蓝紫冷色」），不要写「一张配图」「相关插图」这类空话；
   - `mode`：`concept`（抽象概念插画）/ `case`（具体场景、产品、人物）/ `data`（信息图、图表感）；
   - `ratio`：`16:9` / `1:1` / `3:4` —— 按这个版式里那个位置的形状选（竖位配横图会被裁掉两边）。
4. 不要写页码、不要写 HTML、不要解释。

## 这一页的内容
所属模块：${input.section || '（无）'}
标题：${input.title}
要点：
${input.points.map(p => `- ${p}`).join('\n') || '（没有给要点，按标题判断）'}

## 这一页用的版式（**只作排版参考**：它的图位数量不是硬要求）
${layout.selectText}

〔notes 非空时：〕
## 额外要求（他自己写的，优先于上面的建议）
整份统一：${deckNotes}
这一页额外（和上一条冲突时按这一条）：${notes}

## 输出格式
只输出一个 JSON 数组，不要任何解释文字。每个元素：
{"subject":"画什么，一句话","mode":"concept | case | data","ratio":"16:9 | 1:1 | 3:4"}
不要图就输出 `[]`。
````

**这条路不抢救半截数组**（和 `planDeck` 不同）：一页最多 6 条，断在中间意味着后面几格丢了，而丢掉的那几格在界面上和"这一页就只要 2 张图"一模一样。

备选版式（`alts`）归一：**不在库里的丢掉、和主版式重复的丢掉**。编出来的编号留在下拉里的话，他挑中之后是一句 400（读起来像"这个版式坏了"）；和主版式重复的留着的话，"规划挑的"那一条会出现两遍，看起来像模型只给了一条备选。

---

## 3. 生成一页（`pageService.buildPrompt`）

这是最长的一段，也是唯一**不吐 JSON**的（直接回 HTML）。整段的拼接顺序是承重的：

```
开场（你的活是排版和设计，不是编辑）
→ ## 输出格式（硬规则）8 条
→ ## 这一页的内容（section / title / points / 提纲原文 / 图位）
→ ## 版式（layout.buildText —— 那一条的详情 md 全文）
→ ## 配色与排版 token（library().designTokens + designPromptBlock(design)）
→ ## 额外要求（他自己写的，优先于上面所有建议）   ← 必须在最后
```

**`notesBlock` 必须接在整份 prompt 最后。** 夹在版式骨架前面的话，后面近 8000 字的骨架说明会把它盖过去 —— 模型照旧按版式建议排，出来是一页完整正常的幻灯片，而他写的"语气克制、别用感叹号"一处都没生效，也没有一处会说（他只会再写一遍、再花一次额度）。

````text
你是演示稿的前端实现。把下面这一页的内容，用指定的版式排成**一个** `<section>`。

**你的活是排版和设计，不是编辑。** 给你的内容已经是他要上屏的那份了：一条都不要精简、
不要挑重点、不要「为了版面干净」少排两块 —— 你要做的是把它们**全部**漂亮地排上去
（装不下就收字号、拆小块、加栏，见第 7 条）。少排的那一块不会有任何地方报错，
出来是一页干干净净的幻灯片，而他要逐字对提纲才发现。

## 输出格式（硬规则）
1. 只输出一个 `<section class="slide" …>…</section>`，前后不要任何解释、不要 markdown 围栏。
2. **不要**输出 `<html>` / `<head>` / `<style>` / `<script>` —— 骨架 CSS 已经在 deck 外壳里了，这一页只能**用已有的类名**。要微调用 inline `style="…"`。
3. 颜色只能用 `var(--c-*)` / `var(--bg-*)` 这些变量，不要写死色值 —— 同一个版式要能在橙/蓝/双色系的 deck 里都成立。
4. **不要写页码**：不要当前页码、不要总页数、不要 `01 / 17` 这种角标，也不要 `page-badge` / `wm` / `hc-no` / `bio-page-num`（这几个类已经删了，写了只会在正文里多出一行数字）。放映器页脚会显示进度。
   **左上角那行模块名（`.slide-header`）也不要写** —— 整份统一由代码贴（版式案例里那一行是给你看整体效果的）。你写了会被摘掉，而**正文里再出现一次模块名**就会和它重复显示。
   〔当 input.section 非空且这条版式 noHeader=false 时追加：〕
   所属模块「${input.section}」这几个字**在这一页的正文里一次都不要出现**：不要写成 `.kicker` 小标签、不要写进标题、不要放在顶栏或 pill 里。这一页的标题要写这一页自己的信息，不是它属于哪个模块。
   **领句和标题不许写同一句话**：`.kicker` / `-eyebrow` 那行小字是**另一个维度**的信息（这一页属于哪一类、第几步、什么口径、对应的英文名），不许是标题的复制或标题的前半句。想不出来写什么就**不写这一行**，宁可空着 —— 同一句话上下出现两遍在画面上看起来像版式自带的装饰，一处都不会报错。
5. 〔三选一，按这条版式：〕
   〔fullbleed：〕${layout.id} 是**全幅**版式：内容**不要**包进 `.slide-inner`（包进去会变成一张四边留白的「全幅」图）。
   〔hasCard：〕${layout.id} 是**出血**版式：内容**不要**包进 `.slide-inner`（浮卡和色带要脱离标准页边距），照案例那样直接用它自己的外层容器。
   〔其余：〕${layout.id} 不是全幅版式：正文必须包在 `<div class="slide-inner">…</div>` 里（不包的话内容会贴到画面边缘）。
   〔hasCard 时再追加：〕另外 section 上要加 `has-card` 类（色带要溢出卡片边缘）。
6. 图槽位：一律先用占位图 /ppt-cases/ph-16x9.svg / /ppt-cases/ph-1x1.svg / /ppt-cases/ph-3x4.svg（按构图比例挑），并给每个图元素加两个属性：
   - `data-img-prompt="这一格要什么图（中文一句话）"` —— 真图是下一步按这句话生成后替换进来的，**漏了这个属性那一格就永远配不上图**；
   - `data-img-mode="concept|case|data"` —— concept 是概念/框架/阶段/趋势，case 是案例/产品/业务场景，data 是数据/图表。填错的话这一格会用错一路画风模板（出来的图是漂亮的概念插画，而这一页要的是信息图）。
   - **并排的那几张图必须一样高**：同一行/同一个网格里的图，要么都不写高度（跟骨架走），要么每一张都写**同一个** `height` / `aspect-ratio`。写了两张漏了第三张、或者三张写三个值，出来是一行参差不齐的图、下面那几行小字跟着错开 —— 现在看占位图看不出来（占位图是同一个文件），真图配上来才露出来。〔imageSpecBlock〕
7. 文案照给定的内容写，不要编数字、不要编客户名。要点可以润色成更适合上屏的短句。
   〔有 outlineText 时追加：〕**下面「提纲原文」那一段是这一页真正要上屏的内容**（「要点」只是它的骨架）：里面的每一个数字、机构名、年份、条款都要出现在页面上，一条都不许合并、不许省略、不许改写成「等多项」「若干」。装不下的时候用 inline `style` 把字号收小一档、或者把段落拆成更多小块，**不要删内容**。
8. **下面那个版式是排版参考，不是模子。** 它的结构、类名、间距节奏照它来，但**重复单元的数量按这一页的真实内容定**：案例里画 3 栏而这一页有 4 块内容，就照同一个单元的结构、同一批类名排 4 栏（**不要**自己发明类名、不要把第 4 块塞进第 3 栏、更不要把它丢掉）；只有 2 块就排 2 栏，不要为了填满案例的格子编内容。单元数量变了就用 inline `style` 顺手调宽度/间距（例如 4 栏时把每栏的 flex/width 收窄一点），别让它挤出画面。
   图位那一段（第 6 条）**不受这一条影响**：图位的条数和顺序仍然照给定的规格来（备好的图是按序号贴的）—— 内容块比图位多的时候，多出来那几块就不配图。

## 这一页的内容
所属模块：${input.section || '（无）'}
标题：${input.title}
要点（骨架，用来定这一页分成哪几块）：
${input.points.map(p => `- ${p}`).join('\n') || '（没有给要点，按标题自己组织，宁可少写也不要编事实）'}

〔有 outlineText 时：〕
提纲原文（**这一页要上屏的内容就是这一段**，照它写：数字、机构名、条款一条都不要丢，见第 7 条）：
"""
${input.outlineText.trim()}
"""

〔有 imageSpecs 时：〕图位（**必须按这个顺序、就这 ${n} 个**）：
1. ${ratio} / ${mode} / data-img-prompt 就写「${subject}」
〔否则：〕建议配图张数：${input.images}

## 版式（**排版参考**：结构和类名照它，单元数量按上面第 8 条按内容定）
${layout.buildText}

## 配色与排版 token
${library().designTokens}
${designPromptBlock(input.design || DEFAULT_DESIGN)}
〔notesBlock〕
````

`imageSpecBlock`（只在有 `imageSpecs` 时插在第 6 条末尾）：

```text
   - **图位的条数和顺序照下面「图位」那一段来**（正好 ${n} 个，多写少写都不行）：第 n 个图元素就是那一段的第 n 条，`data-img-prompt` 照抄它那句话，占位图按它给的比例挑。这几张图可能已经提前生成好了，是**按序号**贴进图位的 —— 顺序换了就会贴到讲别的事情的那一格。
```

`notesBlock`（`deckNotes` / `notes` 至少一个非空时才有）：

````text

## 额外要求（他自己写的，**优先于上面所有建议**）
整份统一：${deckNotes}
这一页额外（和上一条冲突时按这一条）：${notes}

上面「输出格式（硬规则）」那 7 条不受这一段影响：还是只输出一个 `<section>`、不写页码、
不写 `<style>` / `<script>`、颜色只用 `var(--…)`。要改字号/间距/字重就写 inline `style="…"`。
````

两段分开写、各带标签：合成一段的话"整份统一"和"这一页额外"在模型眼里没有轻重，两条冲突时（整份说"不要图标"、这一页说"用图标分栏"）它挑哪条全凭运气，而出来是一页完整正常的幻灯片。
末尾那句"7 条不受这一段影响"是挡"顺着他的要求破坏输出格式"那一路：他写"字体大一点"时模型很容易回一段 `<style>`，而那玩意儿改的是整份 deck 的每一页。

### 生成之后代码要做的四件事（**顺序固定**）

```
extractSection(raw)                  # 从回复里抠出那一个 <section>（带 finish / reasoningTokens 报错）
→ stripPageNumber(html)              # 摘掉模型写的页码类和占位符
→ injectEids(…)                      # 给「只装着一段文字」的元素注 data-eid
→ applyHeader(…, input, layout)      # 摘掉模型自己写的 .slide-header，按 noHeader 决定贴不贴统一页眉
→ normalizeChartData(…)              # 见 §9
→ checkPage(fixed, layout, input)    # 见 §7
problems = extractSection 的 + applyHeader 的 + normalizeChartData 的 + checkPage 的
存库的是 normalizeChartData 之后那份 html
```

`data-eid` **要在这里注、跟着 html 一起存**：编辑时再算一遍的话，前端手上那份预览里的 `t3` 和库里的 `t3` 可能是两个不同的元素，于是他改的是这一块、变的是隔壁那一块 —— 两块都是正常的文字，一处都不报错。
统一页眉也由代码贴：模块名交给模型写的话它会顺手改写成"案例""第二章"，于是每一页左上角那行字都不太一样（硬规则 3）。

---

## 4. AI 编辑 · 微调（`aiEditService.buildPrompt`）

### 4.1 先打码（`maskRegion`）

发给模型之前，这一块里的**文案、`<img>` 整个标签、含中文的属性值**全换成记号：

| 记号 | 换掉的东西 |
| --- | --- |
| `@@T<n>@@` | 标签之间那段有字的文本（纯空白的缩进换行原样留着，那是模型读结构的线索） |
| `@@IMG<n>@@` | 整个 `<img …>` 标签（地址和 `data-img-prompt` 因此不经过模型） |
| `@@A<n>@@` | 属性值里含中文的那些（`data-img-prompt="…"` 那批） |

编号是**一个共用计数器**（`@@T1@@ @@IMG2@@ @@T3@@` 这样），不是每类各自从 1 开始。HTML 注释先整段删掉。
这一块里有 `<script>` / `<style>` 时**直接拒**，不打码不发送。

这是"AI 编辑不许改文案"唯一靠得住的做法：靠 prompt 说"不要改文字"的话，模型会顺手润色一两句、把"及"改成"和" —— 那是一页读起来完全正常的幻灯片，而他要的那句话变了，没有一处会说。
打完码之后**整段里一个中文都不剩**，于是"输出里有中文"就等于"它在编文案"，一条正则（`CJK_RE`）就能拦住。

```
CJK_RE = /[⺀-鿿　-〿︰-﹏＀-￯]/
```

### 4.2 prompt

````text
你在调整一页幻灯片里的**一小块** HTML。这一页是 1920×1080 的固定坐标系。

【这一块现在是这样】
${masked}

【他要你做的】
${instruction}

【硬规则，违反任何一条这次改动都会被整段丢掉】
1. `@@T1@@` `@@IMG1@@` `@@A1@@` 这种记号是被挡住的文案和图片。**每一个都必须恰好出现一次**，
   不能删、不能重复、不能改写、不能翻译。你可以挪动它们的位置。
2. **不许写任何中文。** 文案不是你的活（他要改文案会自己去改那句字）。
3. 类名只能用这一块里已经出现过的那些。要新样式就写 inline style（`style="…"`）。
4. 颜色只能用 `var(--c-…)` 这种变量（用这一块里已经出现过的那几个），**不许写 #hex / rgb()**
   —— 阴影和蒙版那种半透明黑白除外（`rgba(0,0,0,.08)` 可以）。
5. 不许写 `<script>` / `<style>` / `onclick` 这类事件属性，不许用 `position:fixed`。
6. `data-eid="…"` 属性原样留在它现在所在的那个元素上：一个都不能删、不能改、不能新增。
7. 只回这一块，最外层还是 `<${regionName}>`，不要多包一层、不要回整页。

【只回这个 JSON，不要别的字】
{"html":"改完的这一块（一整段 HTML，写成一行，不要换行）","summary":"一句话说你改了什么"}
````

`regionName` = 这一块根元素的标签名（`div` / `section` / `ul`…），由 `pickRegion` 给。

### 4.3 `validateEditedRegion` 逐条

**每一条都是"不拦就悄悄改错东西"，所以一律抛 `PageEditError`（→ 400），一个字都不写库。** 这一步已经花过一次额度，但把一段错的存进去要花的是"他后面照着这一页做完整份"的时间。

| # | 判定 | 拦的是什么 |
| --- | --- | --- |
| ① | `domTree(html)` 必须正好 1 个顶层标签、且覆盖整段（`start===0 && end===html.length`） | 多包一层 / 有标签没闭合。splice 回去就是"这一块被包进了一个没有样式的 div"，定位类挂在原来那一层上 |
| ① | 顶层标签名必须 `=== regionName` | 换掉之后这一块跑到别的位置（定位和尺寸挂在原来那一层） |
| ② | 每个原有记号**恰好出现一次**：`lost` / `dup` / `made`（编了不存在的）三者都不许 | 少一个 = 那句文案凭空消失（页面照样渲染，只是短了一截）；多一个 = 同一句话出现两遍；编一个 = 还原不回来，画面上留着 `@@T9@@` 这种字样 |
| ②b | `eidsIn(原文).sort()` 必须完全等于 `eidsIn(新文).sort()` | 掉一个的话那段文字还在、样子也对，只是**从此双击改不动**，而屏幕上一点异样都没有 |
| ③ | 出现任何中文（`CJK_RE`）→ 拒 | 它在自己写文案（打完码之后原文一个字都不在里面） |
| ④⑤⑥ | `checkRegionGuards`（见 §6） | 脚本 / 样式表 / 事件属性 / fixed / 编类名 / 写死颜色 / 不存在的变量 |

报错文案必须点名**丢/重/编了哪几个记号**（各列前 3 个）并给出下一步（"文案要改请双击那句字直接改"）。

---

## 5. AI 改造 · 自由重排（`aiRemakeService.buildPrompt`）

和微调**规则相反**的地方（这也是两份 prompt 不能合并的原因）：允许写中文、允许删掉原文、允许加新图、允许重排结构。

````text
你在**重新设计**一页幻灯片里的一块。这一页是 1920×1080 的固定坐标系，这一块的外层尺寸由页面给定。

【这一块现在是这样】
${masked}

【他要你做的】
${instruction}

【能用的样式变量（只有这些，别的都不存在）】
${palette.vars.join(' ')}

【这一页已经在用的类名（想复用现成卡片/栏目的样子就用这几个；别的类名一律不许写）】
${palette.classes.join(' ')}

【你可以自由做的】
- 重排结构：加/删/嵌套元素，改成多列、卡片、时间轴、叠图…… 不必照原来那条版式。
- 新样式一律写 inline style（`style="…"`），想怎么排都行。
- 需要新文字时可以写中文（会逐句列给他确认）。
- 需要新图时写 `<img src="/ppt-cases/ph-16x9.svg" data-img-prompt="这一格要什么图（中文一句话）" data-img-mode="case">`
  （比例三种：`ph-16x9.svg` 横 / `ph-1x1.svg` 方 / `ph-3x4.svg` 竖；`data-img-mode` 三种：case 实景 / concept 概念 / data 信息图）。
- 要**背景图**（图垫在文字下面）时写在容器上，`data-img-prompt` 一样不能少：
  `<div style="background-image:url(/ppt-cases/ph-16x9.svg);background-size:cover;background-position:center" data-img-prompt="要什么图" data-img-mode="case">…</div>`
  —— 少了 `data-img-prompt` 那一格生图那一步扫不到，永远停在占位图上。
〔当这一块里有「挂着占位图但没有 data-img-prompt」的元素时追加：〕
- 这一块里现在有 ${n} 处占位图挂在元素上却**没有** `data-img-prompt`（配图那一步扫不到它，
  所以它永远停在占位图上）。这次顺手给它补上 `data-img-prompt="这一格要什么图（中文一句话）" data-img-mode="case"`，
  写在带 `background-image` / `src` 那个元素本身上。

【硬规则，违反任何一条这次改造都会被整段丢掉】
1. `@@T1@@` `@@IMG1@@` `@@A1@@` 这种记号是他原来的文案和图片。可以挪位置、他要求删的可以删，
   但**不能改写、不能重复、不能编新的**。
2. 类名只能用上面列出来的那些。**要新样式就写 inline style，不许编类名**（模板里没有那条样式）。
3. 颜色只能用上面列出来的那几个变量（`var(--c-ink)` 这种），**不许写 #hex / rgb()，也不许用没列出来的变量名**
   （阴影和蒙版那种半透明黑白除外：`rgba(0,0,0,.08)` `rgba(255,255,255,.6)` 可以）
   —— 列表里没有 `--c-text` `--c-muted` 这类名字，写了浏览器会把整条声明丢掉。
4. 图片地址只能是上面那三个占位图，**不许写别的地址**（真图是下一步生成后替换进来的）。
5. `data-eid="…"` 原样留在它现在所在的元素上（那一段被删掉时它跟着删）；**新元素不要写 data-eid**。
6. 不许写 `<script>` / `<style>` / `onclick` 这类属性，不许用 `position:fixed`。
7. 只回这一块，最外层还是 `<${regionName}>` **且原来那几个类名一个不少**（它的位置和尺寸靠这几个类名），
   不要在外面多包一层、不要回整页。内容不能超出这一块原来的地盘。

【只回这个 JSON，不要别的字】
{"html":"改完的这一块（一整段 HTML，写成一行，不要换行）","summary":"一句话说你改成了什么样"}
````

**变量名和类名要列给它，不让它猜**（硬规则 3）：`palette.vars = [...templateVars()].sort()`、`palette.classes = [...new Set(classesIn(整页html))]`。
它猜 `--c-text` / `--c-muted` 这种名字，每猜一次就是一次"校验没过、白花一次额度"，而他看到的只是一句"用了不存在的样式变量"。

### 5.1 `validateRemadeRegion` 逐条

回的不只是"过/不过"：这一条路会**返回一串 `notes`**（降级要出声，硬规则 1）。

| # | 判定 | 结果 |
| --- | --- | --- |
| ① | 顶层必须 1 个标签、覆盖整段 | 抛错 |
| ① | **根元素原来那几个类名一个不能少**（`rootClasses`） | 抛错。只比标签名拦不住"原封不动地多包一层"（外面套一个 `<div class="col">` 之后顶层还是 `<div>`）—— 这一块的位置和尺寸是父级按类名给的 |
| ② | 记号**允许丢**，但不许重复、不许编 | 重复/编 → 抛错 |
| ② | 丢掉的 `@@T*@@`（文字） | **note**，列出前 3 段原文。丢掉的**图**不报（少一张图他一眼就看见）；丢掉三句里的一句，剩下两句照样排得整整齐齐 |
| ③ | `data-eid` 不许编新的、不许重复 | 抛错（会撞上这一页别处那一段，改一句字落到另一块上） |
| ③ | `eid` 少了、但**不是因为整段文字被删**（`eidLost.length !== lostText.length`） | **note**：那几段字留着但从此双击改不动 |
| ④⑤⑥ | `checkRegionGuards` | 抛错 |
| ⑦ | 图片地址只能是三个占位图、或原文里本来就有的那些 | 抛错（编一个地址出来在屏幕上和"这一格本来是空的"长得一样） |
| ⑧ | 没有任何 note 且 `squash(新) === squash(原masked)` | **note**：模型原样退回来了，这次额度已经花掉了，建议换一句更具体的说法 |

改造之后还要跑：`rechartEdited`（notes 合并进去）、`realignImageRecords`、`specsFromSlots` + `updatePlanPageImages`、`orphanedPreparedNotes`、图槽 > 6 时的提醒。

---

## 6. `checkRegionGuards`（两条 AI 改块路径**共用一份**）

原来这几条在两个文件里各抄了一遍，而它们拦的是同一个模型的同一批毛病 —— 于是踩到一次只会修一边，另一条路照旧。实际发生过的就是 `position:fixed`：自由改造那边拦着，微调那边没有（而微调的 prompt 第 3 条正让模型"要新样式就写 inline style"，写出 fixed 的概率更高）。走微调那条路写进去之后，预览里那一块位置只是差一点，**导出成文件之后飞到画面外** —— 接口 200、摘要写着"拉开了间距"、库里也存了。

上下文：`{original, allowedClasses, knownVars}`。`allowedClasses = templateClasses() ∪ classesIn(整页html)`；`knownVars = templateVars()`（`template.html` 的 `:root` 里真有的那些）。

| 判定 | 正则 / 算法 | 报错要说什么 |
| --- | --- | --- |
| `<script>` / `<style>` | `/<(script\|style)[\s>]/i` | 会影响整份 deck 的每一页，或者在导出的文件里真的执行 |
| 事件属性 | `/\son[a-z]+\s*=/i` | 会在预览和导出的文件里真的执行 |
| `position:fixed` | `/position\s*:\s*fixed/i` | 它脱出这一页 1920×1080 的缩放，预览里看着还行，导出之后那一块会飞到画面外；**改用 absolute** |
| 编出来的类名 | `classesIn(html)` 里任何一个不在 `allowedClasses` | 那几块会变成没排版的文字堆在一起；列出前 5 个 |
| 写死的颜色 | `hardcodedColors(html, original)`（原文里本来就有的不算） | 换一套配色时这一块不会跟着变，而它读起来完全正常 |
| 不存在的变量 | `/var\(\s*(--[a-z0-9-]+)/g` 里不在 `knownVars` 的 | 浏览器会把**整条声明**丢掉，颜色/间距直接没有，而页面照样渲染。**报错里必须把能用的变量全列出来** —— 只说"不存在"的话他只能再点一次让模型再猜一个名字（`--c-text` 猜完猜 `--c-muted`），而每一次都是一次真实花费 |

**别往这里搬两边规则相反的那几条**（记号丢失、中文、`data-eid`、图片地址）：搬进来就得加一个开关参数，而开关传错值就是静默走另一条规则 —— 现象是"AI 怎么把我的文案改了"。

---

## 7. `checkPage` 逐条判定（生成一页之后）

回的是 `string[]`，存进 `ppt_deck_pages.problems_json`，**每一条都要原样显示**。
每一条都是"页面照样渲染出来了，只是不对"—— 手测时看不出来的那些。

| # | 判定 | 备注 |
| --- | --- | --- |
| ① | 内部元素上出现 `template.html` 里没有的 class | **根 `<section>` 那一行不算**（模型顺手多写的 `l13-cover` / `fullbleed` 这种语义标签一个字都不影响画面；报出来的话界面上是一条警告而那一页完全正常，用户只能盯着它猜）。判据：`html.replace(/^[\s\S]*?<section[^>]*>/, '')` 之后再扫 `class="…"`。措辞里**不出现** template.html / 类名这些词 —— 他能做的只有"重新生成一次" |
| ①b | 文字页码：`/>\s*0\d\s*\/\s*\d{1,3}\s*</` | `stripPageNumber` 只摘得掉那几个类名和占位符；模型把 `01 / 17` 写进某个 pill 里时代码分不出它是页码还是内容，而那个数字看起来完全像设计的一部分（这一页换个位置就对不上了） |
| ② | `/<style[\s>]/i` | 会盖掉共享骨架、影响整份 deck 的其他页 |
| ② | `/<script[\s>]/i` | 会在 deck 里真的执行 |
| ③ | `fullbleed` 版式却有 `slide-inner` | 出来是一张四边留白的"全幅"图 |
| ③ | 非 `fullbleed`、非 `hasCard`，却**没有** `slide-inner` | 内容会贴到画面边缘。**出血版式（`hasCard`，目前只有 L12）要放过** —— 不放过的话每一页 L12 都带着一条他照案例改不掉的警告，而真正要抓的"普通页贴边"会混在这种常态噪音里被一起忽略 |
| ③ | `hasCard` 但 section 上没有 `has-card` 类 | 色带要溢出卡片边缘 |
| ③b | 表格张数（按**类名**判，不按版式编号）：`dt-table` 计数；有 `l57-stack` = 双表版式 | 双表却只排 1 张 → 下面那一格空着，看起来只是"这一页留白多"；双表排了 3 张 / 单表排了 2 张 → 第 N 张从下沿漏出去压在脚注上（字叠字）。他在案例库里关掉某一条之后编号就不该再出现在代码里，而画面上真正决定这一页是几张表的是类名 |
| ③b | `tables > 1` 且 `dt-unit`/`l57-unit` 行数 < 表数 | 少的那张表，读的人只能拿另一张的单位去套（"3.2"是万元还是工作日） |
| ④ | 规划要图（`input.images > 0`）但 `<img>` + `background-image:` 计数为 0 | 出来是一块灰，读起来像"这一页本来就没图" |
| ④ | 图片地址不在 `PLACEHOLDERS` 里、也不以 `/uploads/` 开头（扫 `/(?:src\|url\()\s*["']?(\/[^"')\s]+)/g`） | 模型自己编的地址在预览里是破图，而破图和"这一格本来是空的"长得一样 |
| ④ | 图元素数 > `data-img-prompt` 数 | 缺的那几格生图那一步会跳过，永远停在占位图上 |
| ⑤ | `outlineFitProblem(layout, outlineText, …)` | 按**这次真的用的那条版式**再核一遍容量：他在"生成前改一下"里把 640 字那一页换成 L38（行表 4–6 行）之后，规划那条警告就过期了，而模型会把这一段悄悄压成 4 行 |
| ④b | `imageSpecs.length` 与实际 `data-img-prompt` 数不等 | 备好的图**按序号**贴，条数一变就有图没地方贴、或有格子空着。文案里必须说清"如果这一页内容本来就是 N 块，规划清单已经按画面对齐了（**不用再点什么**）" —— 否则他会一直重新生成同一页拿同一个数字，每次都花一次钱 |
| ⑥ | inline `style` 里 `font-size` < `MIN_FONT_PX = 14` | **压字号是模型最省力的那条路**：它不改结构、不删一个字，出来是一页排得满满当当、每个字都在的幻灯片 —— `overflow:hidden` 没触发、类名全对、图位数也对，`problems` 里一个字都没有。而 1920 舞台上的 12px 投到屏幕上就是 12px，后排根本读不出来，他在自己电脑上却看得清。**只认 inline style**（骨架里的字号是库里定好的，有测试按下界对账） |
| ⑦ | `imageGroupProblems(html)`：同一组图不等高 / 混比例 | 一行里矮 40px 的那一格，页面照样渲染，而图下面那几行小字全错开一行；混比例那种要等真图配上来才看得见，那时钱已经花了 |
| ⑧ | `leadEchoProblem(html, input)`：领句 = 标题 | `LEAD_CLASS = /(?:^\|-)(?:kicker\|eyebrow)$/`、`TITLE_CLASS = /(?:^\|-)(?:title\|headline)$/`。这一页占了两行却只说了一件事，而它渲染出来完全正常、类名全对，看起来就像这个版式本来就有一行小字（副标题和格子内小标题不算：那是另一回事，层级不同） |

写进 problems 的字符串要 `esc()`（`&` `<` `>`）：不转义的话带尖括号的内容会被浏览器当成标签吃掉 —— 页面照样渲染，只是那一块少了半句话。

---

## 8. 生图提示词（`styleLibrary.renderStylePrompt`）

模板来源是 `library/illustration-style.md`，**6 套画风（S-A ~ S-F）× 3 个 mode（concept / case / data）= 18 段模板**，从 md 里解析，不在代码里写死。
写死那一段的话"换画风"这个下拉换的是别的东西 —— 用户选了"国风水墨"，出来的还是等距 SaaS 插画，而每张图单看都不错、没有一处报错，他只会以为这个模型画不了水墨。

### 8.1 渲染规则（顺序固定）

```
body = templates[mode] || templates.concept        # 缺这个 mode 时回落 concept
  .replace(/<size>/g,           `${ratio} composition`)
  .replace(/<[^>\n]*>/g,        m => /主题/.test(m) ? theme : scene)   # 带「主题」字样的填主题，其余填场景
  .replace(/\{\{BRAND\}\}/g,    colors.brand)
  .replace(/\{\{ACCENT\}\}/g,   colors.accent)
  .replace(/\{\{BG_ALT\}\}/g,   colors.bgAlt)
  .replace(/\{\{BG\}\}/g,       colors.bg)

return `${body.replace(/\s*\n\s*/g, ' ').trim()} ${HARD_TAIL}`
```

- `HARD_TAIL = 'No text, no letters, no numbers, no watermark, no UI chrome.'` —— **一律带上**。模型很爱在图里写字，而带字的插画在 deck 里就是一处错别字。
- `{{BRAND}}` 那四个色值来自 `deckColors(design)` = 这份 deck 的 `DesignSpec` 对应的 `:root` 变量真值。**不传 design 就是默认那套**。留着 `{{BRAND}}` 原样发给模型的话，它会照自己的理解配色 —— 图和 deck 的品牌色不是一套，翻起来只是"这几张图有点跳"。
- `<size>` 必须在通用 `<…>` 之前替换（否则它会被当成场景描述吃掉）。
- 渲染完还要跑 `leftoverPlaceholders(prompt)`（`/\{\{[^}]*\}\}|<[^>\n]{2,40}>/g`）并把剩下的**喊出来**：那几个字会原样发给模型。

### 8.2 S-A 模板原文（其余五套照 md 抄，格式一样）

`### S-A 现代 SaaS 等距（默认）`，四行元信息 + 三段 fenced 模板：

```text
- **适用**：B2B 科技、数字化、AI、互联网、SaaS
- **渲染**：干净的企业科技风、等距/扁平混合、清晰线条、轻微投影、现代 SaaS 插画质感
- **构图**：留白充分、主体居中偏一侧、几何化元素（齿轮/箭头/仪表盘/数据流）
- **禁忌**：暗黑区域、文字水印（生成后裁掉）、UI 边框噪点、写实照片
```

`#### concept 模板`

```text
High-quality concept isometric vector illustration for an enterprise keynote.
Theme: <本页主题，1句>.
<本页专属场景描述>.
Limited palette: vibrant {{BRAND}}, {{ACCENT}}, soft {{BG}} / {{BG_ALT}} background, dark gray accents.
Clean corporate tech style, isometric/flat mix, crisp lines, subtle shadows, light airy background, no dark areas, no text, no UI chrome, no watermark.
High visual impact. <size>.
```

`#### case 模板`

```text
High-quality case semi-realistic product mockup illustration for an enterprise keynote.
Theme: <本页主题，1句>.
<产品界面/业务场景描述，截图感但保持插画统一笔触>.
Limited palette: {{BRAND}}, {{ACCENT}}, soft {{BG}} / {{BG_ALT}}, dark gray accents.
Clean SaaS illustration style, crisp UI shapes, light shadows, no photographic realism, no text, no watermark.
<size>.
```

`#### data 模板`

```text
High-quality data flat infographic illustration for an enterprise keynote.
Theme: <本页主题，1句>.
Rising curves, token flows, grid charts, geometric shapes arranged into a clear visual hierarchy.
Limited palette: {{BRAND}}, {{ACCENT}}, {{BG}} / {{BG_ALT}}, dark gray accents.
Flat corporate tech style, clean lines, minimal shadows, no 3D, no text, no watermark.
<size>.
```

渲染后的样子（S-A / `16:9` / `P-B` 配色）见 `doc/ppt-fixtures/golden/styleLibrary.renderedPrompts.json`，照它逐字节对。

### 8.3 解析规则（`parseStyles`）

- 画风段落头：`### S-X <名字>`，名字里带"（默认）"的那一套 `isDefault = true`。
- 三个 mode 各一段 `#### <mode> 模板` + fenced 代码块。**三个 mode 缺一个，这套画风整套丢掉**。
- **解析出 0 套必须抛错**（同 `layoutLibrary`）：回空列表的话下游会照空列表继续生成，症状是"画风选了没用"。
- 缓存跟着 `libraryVersion()` 一起作废：不跟的话改了 `illustration-style.md` / `template.html` 的 `:root` 之后，生成用的是新骨架、生图提示词还是旧画风旧色值 —— "md 改了一半生效"而两边都不报错。
- **一份 deck 只能一个 `styleId`**，换了画风之后已经配好的那几页**不会自动重做** —— 调用方必须把这件事说出来。

---

## 9. 图表量重算（`chartData.ts`）

页面里条形图/柱状图的**条长写在 inline style 的 CSS 变量上，和印出来的那个数字是两处**。四类事故：

1. 上限比最大值小 → 那一行的 `calc()` 变负数被夹成 0，于是它顶满整条轨道，读起来像"这一项到顶了"。
2. 一组百分比的上限不是 100 → 40% 画成满格。
3. 条长用的不是它旁边印着的那个数。
4. 删掉最长那一行之后上限还是按被删掉的那个数算的 → 剩下几行永远到不了满格。

两个入口：

| 函数 | 用在 | 回什么 |
| --- | --- | --- |
| `normalizeChartData(html)` | 生成一页之后、migration 102 | `{html, problems}` |
| `rechartEdited(html)` | **任何改过文字或结构的路径之后**（`edit-text` / `edit-style` / `edit-region-style` / `delete-node` / `ai-edit` / `ai-remake` / canvas） | `{html, notes}` |

两个都是**纯函数 + 幂等**（102 那次数据迁移就是直接重跑它）。

算法：

```python
NICE_STEPS = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]

def nice_max(mx: float, percent: bool) -> float:
    if percent and mx <= 100:
        return 100                      # 百分比的满格必须是 100
    exp = 10 ** floor(log10(mx))
    for s in NICE_STEPS:
        cand = round_to_precision(s * exp, 12)   # Number((s*exp).toPrecision(12))
        if cand >= mx:
            return cand
    return mx
```

`toPrecision(12)` 那一步不能省：`1.2 * 100` 这种浮点尾巴会写进 HTML（`--bar-max:120.00000000000001`）。

四档图表走**同一套** `--bar-v` / `--bar-max`，各自多算几样：

| 档 | 容器类名 / 单项 / 数字 | 额外由代码写的 |
| --- | --- | --- |
| L47 横条 | `l47-rows` / `l47-row` / `l47-val` | — |
| L52 竖柱 | `l52-cols` / `l52-col` / `l52-val` | — |
| L53 折线 | `l53-cols` / `l53-col` / `l53-val`（横轴 `l53-name`） | 每个点的高度 `--pt-y` **和**那条 polyline 的 `points`（缺 svg 时整层补上 `l53-svg` / `l53-line`）—— **两者必须来自同一次计算** |
| L54 环形 | `l54-plot` / `l54-item` / `l54-val`（环 `l54-ring`、图例 `l54-chip`） | 分母（`pieTotal`）、环那一圈 `--ring: conic-gradient(…)`、每一块的颜色 `--slice` —— 同样必须同一次计算，各写一份的话图例上的颜色和环上的对不上 |

组内每一行的数字**从它印出来的文字里解析**（`40%`、`3.7 亿`、`12.4`），再回填条长；一组里有任何一项带 `%`（`/[%％]/`）就按百分比处理。
折线的 x 取**格子中心** `(i+0.5)*100/n`（点是等分格里 `left:50%` 的元素）。

**上限变了、条长改了都要出声**（回进 `problems` / `notes`）：不说的话别的条突然变长，他会以为是自己删坏了。
四个成因四句不同的话（照 `doc/ppt-fixtures/golden/chartData.*.result.json` 里的原文抄），合成一句"图表数据已修正"等于指错方向。

---

## 10. 移植时怎么验这一份

1. 把 §1–§5 那五段 prompt 逐字节贴进 Python（用 `"""…"""` 原样存，别用 f-string 拼中文），插值点照表填。
2. 跑 `doc/ppt-fixtures/` 里的黄金样本：`styleLibrary.renderedPrompts.json`、`layoutLibrary.selectTexts.txt` 对得上，说明 §2 和 §8 的输入是对的。
3. `checkPage` / `checkRegionGuards` 拿现有页面 HTML 手工造几条反例（写一个 `<style>`、把字号压到 12px、编一个 `--c-text`），确认每一条都能报出来**且报的是表里那句话**。
4. 最后再对一次 `doc/ppt-messages.md`：报错文案是给用户看的，改一个字就等于换了一个指路方向。
