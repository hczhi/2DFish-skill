# HTML 展示稿工作流（ppt-deck skill）

给**没有界面**的 agent 工具用：和用户聊出提纲 → 逐页写 `<section>` → 该配图的页生图 →
拼成一个自包含的单文件 `.html`（后面再补一条转 pptx 的路）。

这份 skill 里**没有任何模型调用**。生文字、生图都用你自己那套 —— 这里给的是排版知识库
（76 个版式案例 + 骨架 CSS）、每一步的提示词写法，和把它们拼成文件的脚本。

## 目录

```
kb/layout-library.md      版式索引（先读它挑版式；240KB，别整份贴进上下文）
kb/cases/L<编号>-*.md     挑中那一个版式的详细约束（一次只读用到的那几个文件）
kb/template.html          骨架：全部版式 CSS + 翻页脚本。页面里只许用它定义过的 class
kb/demo-slides.html       每个版式的 demo 片段（想看「照这套骨架跑出来长什么样」就查这里）
kb/design-tokens.md       颜色/字号/间距令牌
kb/design-options.json    整份稿子的五个档位（配色/字体/疏密/页眉/视觉母题）的 id 和它们注入的 CSS
kb/outline-craft.md       提纲怎么写
kb/illustration-style.md  生图的画风规范（写图片提示词前必读）
kb/image-prompt-craft.md  图片提示词的写法
tools/assemble.mjs        拼装：deck.json → 单文件 .html（零依赖，Node 18+）
example/sample-deck.json  可直接跑的样例
```

## 三条不能绕的规则

1. **`class` 只用 `kb/template.html` 里定义过的。** 写一个不存在的类名不会报错，那一块只是
   回到默认流式布局 —— 出来仍是一页完整、能翻的幻灯片，看起来像「这个版式本身不行」。
   临时调整用 inline style，别造新类名。
2. **颜色一律写 `var(--c-*)`，不写死色值。** 写死的那一处换配色时不会跟着变，而它看起来完全正常。
3. **舞台是固定的 1920×1080，`overflow:hidden`。** 内容塞不下时不要靠压字号解决
   （最小 14px，见 `kb/design-options.json` 的 `minFontPx`）—— 压过头出来是一页排得满满当当、
   每个字都在的幻灯片，而被切掉的那一行在画面上不留任何痕迹。拆成两页。

## 现在能跑的一步：拼装

```bash
node tools/assemble.mjs example/sample-deck.json out.html
# 已生成 out.html
#   3 页，内联了 2 张图，文件 0.19 MB
#   ⚠ 还有格子停在占位图（第 3 页 1 格）：产物里它们是灰块。
```

`deck.json` 的形状（照 `example/sample-deck.json`）：

| 字段 | 说明 |
| --- | --- |
| `meta.brandCn` / `brandEn` / `topic` | 页眉页脚上的署名和主题，三个都必填（空着画面上是一块空白页眉） |
| `design` | 五个档位 id，见 `kb/design-options.json`；不给就是默认那套。**id 打错直接报错，不回落** |
| `imageBase` | 图片路径相对谁算，默认是 deck.json 所在目录 |
| `pages[]` | 数组顺序 = 页码顺序。`html` 是那一页的 `<section>`；`veil` 是这一页照片上那层黑蒙版（0–1，不给=0） |

脚本会把图片**读成字节内联进 html**，所以产物换一台机器、换一个目录都还是那一份稿子。
它在这几处**大声失败**（每一处不喊的话，产物都是「打开一看很正常」）：

- 某页里没有 `<section>` → 少一页的 deck 翻起来和完整的一模一样，只是内容跳了一段。
- 图片文件找不到 → 那一格是空白，而文字、版式、翻页全对，读起来像这一页本来就没配图。
- `design` 的 id 认不出 → 回落的话整份是另一套颜色，而每一页单看都正常。
- 输出里还留着 `{{...}}` 记号 → 那几个字会原样印在画面上。
- 还有格子停在占位图 → 报告里把页号列出来（产物里它们是灰块）。

占位图记号是固定字符串 `/ppt-cases/ph-16x9.svg`（还有 `ph-1x1` / `ph-3x4`），**不是真实地址**：
没生图的格子先写它，拼装时会换成内联的灰底 SVG。

一处已知的外部依赖：骨架的标题字体走 Google Fonts CDN。取不到时会掉回系统字体，
字重和字距变一点（版面看着松一些），不影响内容。

## 还没落地的几步

- 提纲 → 每页 `<section>` 的完整提示词和自检清单
- 图片工作流（什么时候生图、提示词怎么写、装饰背景图那一张）
- 转 pptx
