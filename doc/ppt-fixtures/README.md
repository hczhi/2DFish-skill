# 黄金样本：Python 版拿它逐字节对

这个目录是**移植验收用的**。里面全是**纯函数**的输入和输出 —— 不联网、不调 AI、不读库、不看时间。
所以对不上就是移植错了，没有第二种解释。

为什么要有这一层：PPT 这个模块的每一处"移植错了"都长得一样 —— **接口 200，出来一份读起来完全正常的演示稿**。
一个类名拼错就是那一块掉回默认流式布局；`--bar-max` 少算一次就是"40% 画成满格"；`data-eid` 少注一个就是那一句从此双击改不动。
这些都不会抛异常、不会进日志、也没有一处提示。跑一遍字节对比是唯一能在上线前抓到它们的办法。

---

## 1. 怎么重新生成（改了 TS 侧实现之后）

```bash
nvm use 21.7.3                       # 必须 21.7.3，better-sqlite3 是原生模块
cd server
DB_PATH=/tmp/ppt-fixture.db npx tsx ../doc/ppt-fixtures/generate.ts
```

**`DB_PATH` 一定要写在命令行前缀里。** 在脚本里 `process.env.DB_PATH = …` 是无效的：ESM 的 import 在脚本第一行执行之前就跑完了，那时 db 模块已经打开了**真库**。
（`exportService` → `pageService` → `layoutState` → `db` 这条链把 better-sqlite3 拖了进来，所以哪怕这些函数一个字都不碰库，进程照样会开一个连接。）

跑完 `golden/` 里那 **23 个样本**全部覆盖重写，另加一份 `MANIFEST.json`（每个样本的 sha256 前 16 位；它自己不进 `MANIFEST.json`，不然哈希永远对不上自己）。

---

## 2. 目录

### `input/` —— 喂给两边的同一份输入

| 文件 | 是什么 |
| --- | --- |
| `deck-meta.json` | 固定的 deck 元信息：`brandCn=示例企业` / `brandEn=SAMPLE` / `topic=2026 年度业务复盘` / `design={P-B, F-C, D-C, H-C}`。**故意不用默认那套**，默认那套下"设计规范根本没生效"和"生效了"输出一模一样 |
| `page-L1.html` | 横向分屏 + hero 图位（普通页：要包 `.slide-inner`、要贴页眉、有 5 段可编辑文字） |
| `page-L47.html` | 横条图表页（`l47-rows` / `--bar-max` / `--bar-v`） |
| `page-L13.html` | 全幅封面（不包 `.slide-inner`、不贴页眉） |
| `chart-percent.html` | 一组百分比，`--bar-max` 写成 40 —— 上限必须钉到 **100** |
| `chart-abs.html` | 一组绝对值（3.7 / 12.4 / 21 亿），`--bar-max` 写成 1 —— 必须走 `niceMax` 算成 **25** |

三页 demo 片段是从 `demo-slides.html` 里取出来的，所以**换了案例库文件就要重跑一遍**（`layoutLibrary.*` 那几个更是直接跟着变）。

### `golden/` —— 期望输出

| 文件 | 对的是哪个函数 | 对不上说明什么 |
| --- | --- | --- |
| `assembleDeck.html` | `assembleDeck([L13,L1,L47], meta)` | 外壳拼装错了：页码、页脚、`data-design`、`:root` 覆盖、幕帘，任一处不同 |
| `assembleDeck.defaultDesign.html` | 同上，`design: undefined` | 老 deck（`design_json` 为空）那条回落路径 |
| `assemblePreview.veil0.html` / `.veil035.html` | `assemblePreview(page, meta, veil)` | 单页预览：**不带页脚**、摘掉页码、贴幕帘。`veil035` 那份必须真的有一层 0.35 的蒙版 |
| `previewShell.html` + `previewSlot.txt` | `previewShell(meta)` / `PREVIEW_SLOT` | 前端拿到的共享外壳（`GET /decks/:id/pages` 的 `shell`）和那个占位注释 `<!--PPT_PREVIEW_SLIDE-->`。占位串改一个字符前端就整页空白 |
| `designSpec.styleBlocks.json` | `designVars` / `designStyleBlock` / `designPromptBlock` | **每一个** palette / font / density / header 单独一组，加默认那套和一个组合（P-D+F-B+D-A+H-C）。这是 22 KB 里最值钱的一份：少算一个变量的表现只是"这一版配色淡了点" |
| `chartData.L47.after.html` + `.result.json` | `normalizeChartData(L47)` | demo 那一页本来就是对的，所以期望是 `{"problems":[],"changed":false}` —— **改动了就是多算**（把对的页面改坏，比不算更糟） |
| `chartData.percent.result.json` | 百分比那条 | 上限必须是 100，且 `problems` 里要有那句"上限按 100 算"。钉不住上限就是 40% 画成满格 |
| `chartData.abs.result.json` | 绝对值那条 | `niceMax` 从 `NICE_STEPS` 里挑出 25，三根条按 3.7/12.4/21 对 25 重算 |
| `chartData.rechartEdited.result.json` | `rechartEdited`（改完字之后那条入口） | 12.4 改成 30 之后上限要从 25 涨到 30，`notes` 里要说出来 —— 不说的话别的条突然变短，他以为是自己改坏了 |
| `pageEdit.injectEids.L1.html` + `.eids.json` | `injectEids` / `eidsIn` | 注出来必须正好是 `["t1","t2","t3","t4","t5"]`，**顺序也要一样**（前端双击定位靠它） |
| `pageEdit.injectEids.idempotent.json` | `injectEids(injectEids(x)) === injectEids(x)` | 必须 `{"same":true}`。不幂等的话每次编辑都重新编号，上一次拿到的 eid 立刻失效，而报错写的是"这一页重新生成过" |
| `export.html` + `export.result.json` | `exportDeck(3 页, 'https://example.com')` | 文件名、`placeholders` 计数、四类 warning。占位图算漏了就是导出一份带裂图的文件而没有一句提醒 |
| `export.localhost.result.json` | 同上但 `http://localhost:3001` | localhost 那一档**必须多一条 warning**（那份文件发给别人就是全裂） |
| `layoutLibrary.index.json` | `layouts()` | 65 条的 id/num/name/title/roles/shape/imageSlots/fullbleed/hasCard/noHeader/hasDetail/refImage/demoUrl + 两份文本的字符数 |
| `layoutLibrary.selectTexts.txt` | `layouts().map(l => l.selectText)` | **规划 prompt 里那一整段**，模型真正读到的东西。72 KB，逐字节对 |
| `layoutLibrary.meta.json` | 库整体 | 总条数、`template.html` / `design-tokens.md` / `illustration-style.md` 的字符数、全部 demo id |
| `styleLibrary.styles.json` | `styles()` / `defaultStyleId()` / `deckColors()` | 画风库解析结果 + 默认和 P-B 两套色值 |
| `styleLibrary.renderedPrompts.json` | `renderStylePrompt(S-A, mode, ctx)` | concept / case / data 三个 mode 渲染后的生图提示词。占位符没换掉、`HARD_TAIL` 少一句、颜色没跟着 deck 规范走，都在这里露出来 |
| `MANIFEST.json` | — | 上面每个文件的 sha256 前 16 位 |

---

## 3. 怎么用（Python 侧）

1. Python 版实现完这些纯函数之后，写一个和 `generate.ts` **一一对应**的脚本，把 `input/` 里那几份喂进去，输出到 `out/`（同名）。
2. 跑 `compare.py`（下面那个），或者直接 `diff -ru golden out`。
3. 一个字节都不许差。

```bash
python3 doc/ppt-fixtures/compare.py doc/ppt-fixtures/golden ./out
```

**不要把"差异"降级成"警告"。** 这里每一处差异对应的都是一类线上静默事故，没有"差一点也行"的那一档。
真的要改行为（比如故意换了 `NICE_STEPS`），那就重跑 `generate.ts` 让 golden 跟着变，**并在提交里说清改了什么** —— 悄悄改 golden 等于把这一层验收关掉了。

### 建议的对比顺序

按"错了之后有多难发现"排，不按依赖顺序：

1. `designSpec.styleBlocks.json` —— 22 KB 的纯数据，最容易漏，且症状最轻（"配色淡了点"）
2. `chartData.*` —— 三条都是已经出过的事故
3. `layoutLibrary.selectTexts.txt` —— 这一段错了，往后每一次规划都在错的清单里挑
4. `pageEdit.injectEids.*` —— 编号或顺序错了，编辑接口整条链失效
5. `assembleDeck.html` / `export.*` —— 最大的两份，但错了肉眼看得见
6. `styleLibrary.*` —— 生图那条路

---

## 4. 这批样本**不覆盖**什么

跑绿了不等于移植完了。下面这几类不在这里（对应的验收办法写在括号里）：

- **所有 AI 调用**（prompt 原文和校验规则在 `doc/ppt-prompts.md`，那份是照抄件）
- **落库和租户隔离**（`doc/ppt-database.md` + `doc/ppt-contracts.md` §1）
- **鉴权、scope、SDK pk 白名单**（`ppt-contracts.md` §2、§3）
- **`plan_rev` 并发**（`ppt-contracts.md` §4）
- **错误文案**（`doc/ppt-messages.md`，那份也要逐字对）
- **案例库自身的正确性**（`doc/ppt-templates.md` §4 那三个测试文件）
