# PPT 模块独立化：后端交接文档

这个目录是给**另一个 Python 项目**用的：把 HTML 展示稿（PPT）这个模块从 mmPla 里拆出去，用 Python 重写后端。
所以这里写的是**契约**（表结构、接口、跨接口的行为约定），不是现有 TypeScript 代码的说明书 —— 语言无关，照着能重新实现一遍。

## 文档清单

**契约三份**（先读这三份，它们说的是"要做成什么样"）：

| 文件 | 内容 |
| --- | --- |
| [`ppt-database.md`](./ppt-database.md) | 完整数据库结构：4 张表的全部列/索引/唯一约束、JSON 列的载荷结构、14 个迁移逐条清单 |
| [`ppt-api.md`](./ppt-api.md) | 全部 **41 条接口**：请求字段（类型/必填/上限）、响应体、错误码、鉴权档位、末尾有速查表 |
| [`ppt-contracts.md`](./ppt-contracts.md) | 跨接口的行为约定：租户隔离、三档鉴权与 scope、SDK 嵌入、`plan_rev` 并发、AI/生图网关、案例库、派生物不落库、编辑定位机制、全部上限、文件对照、验收清单 |

先读 `ppt-contracts.md` 的第 1、2、4、9 节，再看接口 —— 那四节是"接口签名照抄一遍但漏掉就会静默出错"的部分。

**照抄件三份 + 验收样本**（这几份不是参考，是要一个字不改地搬过去的东西）：

| 文件 | 内容 | 怎么验收 |
| --- | --- | --- |
| [`ppt-prompts.md`](./ppt-prompts.md) | 六段 prompt **原文** + `checkPage` / `validateEditedRegion` / `validateRemadeRegion` / `checkRegionGuards` / 图表归一的全部规则表 | 逐条比对，规则数量对得上 |
| [`ppt-messages.md`](./ppt-messages.md) | 全部错误与提示文案（含状态码映射、`jsonFailMessage` 的完整算法、SDK 的英文文案） | 和 Python 侧做 diff，插值位置也要一样 |
| [`ppt-templates.md`](./ppt-templates.md) | 版式案例库怎么记的、怎么快速录一条新版式（字段规范 / 要改的 5 处 / 全部抛错条件 / 可直接粘的 AI 录入提示词） | 录一条新版式，跑那三个测试文件全绿 |
| [`ppt-fixtures/`](./ppt-fixtures/) | **黄金样本**：23 份纯函数的输入输出（外壳拼装 / 设计规范→CSS / 图表重算 / eid 注入 / 导出 / 案例库解析 / 生图提示词）+ 生成脚本 + `compare.py` | `python3 doc/ppt-fixtures/compare.py doc/ppt-fixtures/golden ./out` 一个字节都不许差 |

为什么后面这几份要单独存在：这个模块的每一处"移植错了"都长得一样 —— **接口 200，出来一份读起来完全正常的演示稿**。
prompt 少一条硬规则、文案合成一句通用错误、案例库的类名对不上、`--bar-max` 少算一次，都不会抛异常、不会进日志、也没有一处提示。契约文档管不到这一层，只有原文照抄 + 字节对比能管。

## 这个模块是什么

一份"演示稿"= `ppt_decks` 里一行 + 每页一行 `ppt_deck_pages`。整条链路：

```
提纲（纯文本）
  → 清洗提纲（AI，可选）
  → 规划整份（AI，一次）：每页排什么、用哪条版式、要几张图
  → 逐页生成（AI，每页一次）：出一段 <section> HTML
  → 配图（生图，每格一次）：AI 生图 / 素材库挑图
  → 就地编辑（纯代码）：改字、改样式、删块、空白页画布
  → AI 编辑 / AI 改造（AI，每次一次）
  → 拼整份 / 导出单文件 HTML
```

产物是**真 HTML**（1920×1080 的舞台，一页一个 `<section>`），不是 pptx。版式来自一个 **65 条**的案例库（`services/ppt/library/`，是文件不是数据库）。

## 需要一起搬过去的东西

| 东西 | 位置 | 说明 |
| --- | --- | --- |
| 案例库 | `server/src/services/ppt/library/` | `layout-library.md`、`cases/L*.md`（65 个）、`template.html`、`design-tokens.md`、`illustration-style.md`、`demo-slides.html`。**原样搬，它们是数据**（解析规则和录入规范见 [`ppt-templates.md`](./ppt-templates.md)） |
| 占位图 | `client/public/ppt-cases/ph-16x9.svg`、`ph-1x1.svg`、`ph-3x4.svg` | 图还没配上时页面里放的就是它们；导出时要按它们计 `placeholders` |
| 版式参考图 / demo 片段 | `client/public/ppt-cases/L*-ref.{jpg,png}`、`L*-demo.html` | `GET /layouts` 的 `refImage`、`GET /demo-deck.html` 用；静态托管即可 |
| 前端 | `client/src/views/ppt/`、`components/ppt/` | 不在这份文档范围内（这份只写后端契约） |

## 不属于 PPT、但 PPT 依赖的平台能力

Python 项目要么自己实现一份，要么继续调 mmPla：

| 能力 | 现位置 | PPT 用它干什么 |
| --- | --- | --- |
| LLM 网关（含关思维链、JSON 解析、配额、专属渠道） | `core/llm/` | 全部 AI 调用 |
| 生图网关（含对象存储落桶） | `core/image/imageGateway.ts` | 配图、上传素材 |
| 鉴权中间件 + scope 守卫 | `auth/` | 三档鉴权、scoped token |
| 限流 | `auth/rateLimit.ts` | `/api/ppt` 300 次/60 秒 |
| `system_config` | 平台表 | 平台 API key、`ppt_disabled_layouts` |
| `users` / `ai_providers` / `ai_logs` / `ai_app_quota` | 平台表 | 归属、接入点、日志、额度 |

契约细节见 `ppt-contracts.md` §6（文本）和 §7（生图）—— 那两节把"必须复现的行为"和"可以换实现的部分"分开写了。

## 文档准确性

全部按当前代码逐处核对写的（`ppt-fixtures/golden/` 是**跑出来的**，不是手写的期望值），来源：

- `server/src/db/migrations/089_*.ts` ~ `102_*.ts`
- `server/src/api/ppt.ts`（2016 行）、`server/src/api/pptSdk.ts`（270 行）
- `server/src/services/ppt/*.ts`（25 个实现文件，另有 20 个测试文件）
- `server/src/auth/{middleware,scopeGuard,guards,rateLimit}.ts`、`server/src/app.ts`

模块内的历史坑（每一条都是"改错了会怎样静默出错"）在 `docs/modules/ppt.md`（177 KB），这里没有重复，只把影响接口契约的那些提炼进了 `ppt-contracts.md`。
