# PPT 模块的贯穿契约（移植时必须原样复现的部分）

这一份写的不是"有哪些接口"（那在 `doc/ppt-api.md`），而是**跨接口的行为约定**。
每一条底下都注明了"改错了会怎样静默出错"—— 这些是踩过的坑，接口签名照抄一遍但漏掉这些约定的话，Python 那版每个接口都 200，而用户看到的是一份读起来完全正常但内容是错的演示稿。

---

## 1. 租户模型（谁能看到哪份稿子）

```python
@dataclass
class PptOwner:
    user_id: str
    sdk_pk:  str | None       # None = 平台自己
    external_uid: str | None  # 只记录，永不进 WHERE
```

- **租户 = 一个第三方公司 = `(user_id, sdk_pk)`**。所有 `ppt_decks` / `ppt_assets` 的查询都按这两列过滤。
- **`external_uid` 绝不进 WHERE。** 它只是"这份稿子是那边哪个用户建的"的记录。要隔离两个客户 → **发两把 pk**。
  按它过滤的话第三方那边的协作场景（同公司两个人看同一份稿）直接断掉，而现象只是"我的稿子不见了"。
- **比较必须 NULL 安全**：SQLite `user_id IS ? AND sdk_pk IS ?`，Postgres 用 `IS NOT DISTINCT FROM`。
  写成 `=` 的话平台自己那批 `sdk_pk IS NULL` 的稿子全部查不出来 —— 列表是空的、接口 200。
- **钱永远记在 `user_id` 上**，不记在租户三元组上。AI 额度、生图额度、`ai_logs` 全按 `user_id`。

`sdk_pk` / `external_uid` 的取值**只能来自签名后的 JWT**（`payload.pk` / `payload.euid`），绝不从 body/query 读。
从请求里读的话第三方页面上的 JS 改一个字段就能读到别家公司的稿子，而请求完全合法、鉴权也过了。

---

## 2. 鉴权三档与 scope

### 2.1 三档

| 档 | 行为 |
| --- | --- |
| PUBLIC | 不校验 |
| OPTIONAL | 有 token 才解析，没有也放行 |
| PROTECTED | 无 token / token 无效 → 401 |

**默认值的分界是 `/api/` 前缀**：`/api/` 下的路径默认 PROTECTED，**不在 `/api/` 下的一律 OPTIONAL**。
后者是 SPA 静态文件和 fallback：浏览器的文档请求从不带 `Authorization` 头，跟着 PROTECTED 走的话整站是一句 `Authentication required`；iframe 嵌入死得更隐蔽 —— 第一个文档请求就 401，第三方页面上是一块白，而 pk / 白名单 / `frame-ancestors` 全是配好的、每个接口都 200。

PPT 的 PUBLIC 名单只有三条：`POST /api/ppt/sdk/token`、`OPTIONS /api/ppt/sdk/token`、`GET /api/ppt/demo-deck.html`。

401 的两句体：`{error:'Authentication required'}`（压根没 token）、`{error:'Invalid or expired token'}`（有但无效）。这两句必须分开 —— 合成一句的话下游只会去核那把没错的 key。

### 2.2 scoped token 的默认拒绝

scoped token（`scope: 'ppt:embed'`）走一层独立的 **default-deny** 白名单守卫，白名单见 `doc/ppt-api.md` §0.4。
默认拒绝这一条不能反过来（改成"黑名单"的话，以后每加一个新端点第三方都自动能调，而没有任何一处会提醒）。

scoped token 还会被强制：`role = 'user'`（哪怕绑的是管理员账号）、`authMethod = 'sdk'`。
不强制的话把 key 绑到管理员账号上等于把后台开给第三方。

### 2.3 中间件顺序

```
authMiddleware → scopeGuard → rateLimit(300/60s) → pptRouter
```

router 内部：

```
sdk/token 路由 → use('/admin', requireAdmin) → admin 路由 → use(pptSdkLimits) → 业务路由
```

`sdk/token` 必须注册在 `requireAdmin` 之前（否则换 token 要管理员权限）；`pptSdkLimits` 必须在业务路由之前（否则配额是"事后统计"而不是"事前拦截"）。

---

## 3. SDK 嵌入（第三方页面里跑 PPT）

### 3.1 pk 是公开字符串

`pk_ppt_` + 24 字节随机 hex，会写进第三方页面的 JS 里。**它不是密钥**，所以保护只有两样：

1. **来源白名单** `allowed_origins`（token 交换时校验，Origin 缺失时退到 Referer 的 origin）
2. **三个上限**：`rate_limit`（换 token 次数/分钟）、`daily_ai_limit`（AI 次数/天）、`max_decks`（稿子总数）

三个上限**都允许填 0**（= 禁用那一类），所以校验只拒非整数和负数，不能把 0 当"没填"。把 0 当没填回落成默认的话，管理员以为封住了而对方照旧能调。

### 3.2 15 分钟 token

`POST /sdk/token` 回一个 900 秒的 JWT。短有效期是刻意的：pk 是公开的，token 才是凭据，泄露一份 token 的窗口只有 15 分钟。
前端 SDK 需要自己在过期前重新换（换 token 走 `rate_limit` 那条内存滑窗，60 秒窗口）。

### 3.3 配额中间件的四条判定

`pptSdkLimits` 在 `req.sdkPk` 为空时**直接放行**（平台用户不受这一层影响）。带 pk 时：

| 条件 | 结果 |
| --- | --- |
| key 查不到 / `enabled=0` | `403 {error:'接口已关闭，请联系管理员', code:'sdk_key_disabled'}` |
| `POST /decks` 且稿子数 ≥ `max_decks` | `429 {error, code:'sdk_deck_cap', used, limit}` |
| 命中 AI 路由且当日次数 ≥ `daily_ai_limit` | `429 {error, code:'sdk_ai_quota', used, limit}` |
| 其余 | **先给 `ai_used_today` 加 1，再放行** |

"先加后放行"是为了并发下不超发。一次请求生成多张图时（`POST /decks/:id/images`）事后用 `charge_extra(pk, extra)` 补差额。
`ai_used_date` 用**服务器本地日期** `YYYY-MM-DD`；和今天不一致时读作 0（不必先写回）。

停用 key **不删稿子**：删了的话第三方那边历史内容一次性消失，而这边只显示"已停用"。

### 3.4 CSP `frame-ancestors`

`/ppt*` 这些页面的 CSP `frame-ancestors` = **所有 enabled key 的 `allowed_origins` 的并集**，缓存 30 秒，增删改 key 时主动失效。

三条边界：

- 含 `[\s;,'"]` 的 origin **跳过**（那些字符会把 CSP 头截断，等于把整条策略废掉，而页面照旧显示）。
- 查库失败时返回**空列表**（= 谁都不能嵌），不是"允许所有"。
- 这批页面**不发 `X-Frame-Options`**（那个头没有多域名语法，发了等于把 `frame-ancestors` 覆盖掉；老浏览器上现象是第三方页面一块白）。
  `GET /api/ppt/demo-deck.html` 单独一档：`frame-ancestors 'self' + 合作方域名`，且**只有在列表就是 `'self'` 时**才补 `X-Frame-Options: SAMEORIGIN`。其余路径一律 `X-Frame-Options: DENY`。

---

## 4. `plan_rev` 乐观并发

所有**按页码定位**的写操作都要对账（见 `doc/ppt-api.md` §0.6）。

- 缺 `planRev` → **400**，不是"当作 0"。当作 0 的话老前端一次都对不上，或者更糟：全部放行。
- 不匹配 → **409**，文案里同时给出两个数。
- `plan_rev` 只在页序真的变了的三处 +1：`save_plan`（重新规划）、`delete_page`、`insert_page`。

理由：这些接口全按**页码**写库。他在另一个标签页删了第 3 页，这边这次"改第 5 页的文字"落在了另一页上 —— 页面照样渲染、接口 200，只有内容对不上。

`insert-page` **不收** `planRev`（它按 `after` 定位而不是按页码写），但它会 +1 并在响应里回新值。

---

## 5. `plan_json` 与页表必须同事务

- 规划、删页、插页都要同时改 `ppt_decks.plan_json` / `planned_total` / `plan_rev` 和 `ppt_deck_pages` 的页码。
  **必须一个事务**。分两次提交的话中间崩掉留下"规划说 12 页、页表 11 页"，界面上照旧能翻。
- 页码重排是**两阶段**的（先写负页码，再写回正数），因为 `UNIQUE(deck_id, page)` 会在中途撞上。
- 最后一页不允许删；插入受 `MAX_PAGES = 45` 限制。
- 提纲变了但没重新规划时，`markStalePlan` 往规划上挂一句 `STALE_PLAN_NOTE` —— 不挂的话他改完提纲直接逐页生成，出来的是按旧结构排的内容。

---

## 6. AI 调用（文本）

### 6.1 统一网关

所有 LLM 调用走一个网关（`core/llm/gateway.ts`），**吐 JSON 的一律走 `jsonGateway`**（不要自己写 `/\{[\s\S]*\}/` 抓 JSON）。

调用参数（`GatewayOptions`）里 PPT 用到的：

| 键 | PPT 的值 |
| --- | --- |
| `userId` | 扣谁的额度 |
| `source` | 一律 `'ppt'`（应用 id，界面上叫"HTML 展示稿"） |
| `operation` | `'plan-deck'` / `'replan-images'` / `'clean-outline'` / `'gen-page'` / `'ai-edit'` / `'ai-remake'` 等，只进日志 |
| `noThinking` | **一律 `true`** |
| `temperature` | 规划 0.3；其余按预设（`brainstorm`/`creative`/`rewrite`/`analytic`） |
| `max_tokens` | 见 §6.3 |

### 6.2 `noThinking: true` 不是"为了快"，是为了防截断

思维链算进 `max_tokens` 却不出现在 `content` 里（同一条接入点这个差额在 0 到 9700 之间乱跳），所以症状是**"有时"格式错误、"有时"空返回**，完全指不到额度上。实测同一条接入点 36.6 秒 → 3.5 秒，而正文还长了一点。

移植时要保留的三条：

1. 四个"关思维链"的键**一起发**（各家网关认的不是同一个）；严格的网关回 400 就**摘掉重发并喊一句**。
2. 发出去 ≠ 生效（宽松网关对不认识的键既不报错也不照办），所以还要**回头核 `reasoning_tokens`**，没关掉时出声。
3. 上游 400 有两种，退法不同：①"不认识这几个键" → 摘干净重发；②"这个模型始终思考、关不掉" → 退到**只发 `reasoning_effort: 'low'` 一个键**，连 low 都 400 才抛错。第二种要是也摘干净，换来的是一次**思维链全开**的调用，而现象只是"抄到一半就断了"。

`finish_reason = length` **不重试**（同样的 body 断在同一处，只是把 token 和时间花两遍）。
规划那条例外：`finish === 'length'` 时**允许从截断的数组里抢救出已完整的那几项**；`replan-images` **不抢救**。

### 6.3 各路径的 token 上限

| 路径 | 常量 |
| --- | --- |
| 规划整份 | `MAX_PLAN_TOKENS = 10000` |
| 重算图位 | `MAX_REPLAN_TOKENS = 2000` |
| 清洗提纲 | `MAX_CLEAN_TOKENS = 3000` |
| 生成一页 | `MAX_PAGE_TOKENS = 6000` |
| AI 编辑 | `MAX_EDIT_TOKENS = 6000` |
| AI 改造 | `MAX_REMAKE_TOKENS = 9000` |

**调低这些数不省钱**（按实际用量计费），只是把偶发的长思维链变成确定性失败。

### 6.4 两种错误必须分开

| 异常 | HTTP | 体 |
| --- | --- | --- |
| `QuotaExceededError` | 429 | `{error:'quota_exceeded', remaining:0, daily_limit, app, detail}` |
| `DedicatedChannelError`（专属渠道缺档位） | 503 | `{error}` |

专属渠道（某个用户用自己的 key）**没有平台回落** —— 缺档位要抛 503，不能悄悄花平台的钱。

### 6.5 会算错的格式不交给模型

id、页码、时间窗口一律在代码里算，prompt 里连示例都不出现。
规划返回里的 `layoutName` / `layoutTitle` / `fullbleed` / `demoUrl` 全是**代码从案例库补的**；提纲行号是代码编好再喂进去的。
模型编一个版式 id 会撞上另一条版式，而出来是一页完整正常的幻灯片。

---

## 7. 生图

统一走一个生图网关（`core/image/imageGateway.ts`）：

```ts
generateImage(prompt, {
  size?, n?, extra?, userId?, providerId?,
  timeoutMs?,               // 默认 180000
  bucketProfile?: 'ppt',
}) -> {
  url, provider, model,
  storage: 'cos' | 'local',
  storageReason?,           // 落本地磁盘的原因（必须显示）
  protocol, protocolInferred,
}

store_uploaded_image(bytes, mime?, bucket_profile?, key_prefix?) -> { url, storage, reason? }
```

两种上游协议：`openai`（同步返回）和 `dashscope`（异步任务，要轮询）。
**存储目标在调上游之前就要解析好** —— 图生出来了才发现桶没配，那张图只能落本地磁盘，而导出的 html 换台机器打开是裂图。

`storage = 'local'` 必须一路带到导出的 warnings 里（见 `doc/ppt-api.md` §11.2）。

配图的三条来路：规划给"图位说明"→ 逐格备图（`prepare-images`）→ 批量配全部（`images`）。
批量那条是**部分成功**语义：`quotaExceeded=true` 时前几格配上了、后面没有，必须原样说出来。

---

## 8. 案例库（文件，不在库里）

`services/ppt/library/` 下四份文件是**版本控制里的静态资源**，启动时解析进内存（带缓存 + `resetLibraryCache`）：

| 文件 | 内容 |
| --- | --- |
| `layout-library.md` | 65 条版式的元信息（`## L*` 段）—— 名字、适用场景、角色、版型、结构、图位数、设计提示 |
| `cases/L*.md` | 65 个文件，每条版式的完整案例代码（喂给模型的 `buildText`） |
| `template.html` | deck 外壳：`:root` 变量、全部 class、页眉页脚 |
| `design-tokens.md` | 设计令牌说明（进 prompt） |
| `illustration-style.md` | 插画风格说明（进生图 prompt） |
| `demo-slides.html` | 每条版式的 demo 片段（`GET /demo-deck.html` 用） |

每条版式有两份文本，**不能混用**：

- `selectText`（短）→ 只给**规划**用。给全文的话一次规划的 prompt 就上万 token。
- `buildText`（全）→ 只给**生成一页**用，一次只带那一条。

`PageRole`（版式能承担的角色）：`封面 / 章节 / 内容 / 结尾`（**没有「目录」这一档** —— 稿子里不排 agenda 页）。
`LayoutShape`（内容页版型）：`聚焦 / 分屏 / 并列 / 对比 / 数据 / 时序`。

**停用版式是全站的**（`system_config.ppt_disabled_layouts`），只有 `enabledLayouts()` / `enabledLayoutsForRole()` 这两个入口过滤 —— 别处直接读 `layouts` 的话停用的那条照旧被选中。
不允许停掉某个 `PageRole` 的最后一条；某个内容页版型整类消失时照做但给 warning。

---

## 9. 派生的东西一律不落库

**只有逐页的 `<section>` 片段存库。** 下面这些每次读的时候现算：

| 派生物 | 由什么拼 |
| --- | --- |
| 单页预览 `previewHtml` | `assemble_preview(html, shell_meta(deck), veil_opacity)` |
| 整份 `deck.html` | `assemble_deck(pages, meta)` |
| demo 页 | `demo_deck(only?)` |
| 导出文件 | `export_deck(pages, total, meta, base_url)` |

外壳元信息：

```python
shell_meta = {
  'brandCn': deck.brand_cn or '示例企业',
  'brandEn': deck.brand_en or 'SAMPLE',
  'topic':   deck.title,
  'design':  parse_design_spec(deck.design_json).spec,
}
```

理由：存下来的话改一次配色/品牌名/页眉之后那份存档还是旧的，**而它是一份完整正常的演示稿** —— 没有任何一处会说它过期了。

拼装里的三个细节：

- 设计规范那段 `<style id="deck-design" data-design="P-A/F-A/D-B/H-A">` **插进 body，不去找 `</head>`**：找不到那个标签时 replace 什么都不做，而现象是"配色没变"，和"我是不是没点保存"分不开。插在 body 里的 `<style>` 一样全局生效，且在 head 那份之后所以压得住。
- 幕帘（`veil_opacity`）是拼装时贴的，**html 一个字都不改**。
- 单页预览**不带页脚**、要 `strip_page_number`（预览里显示"第 3 / 18 页"而他看的是单页，对不上）。

外壳里两个插槽标记：整份用 `SLOT`，单页预览用 `PREVIEW_SLOT = '<!--PPT_PREVIEW_SLIDE-->'`（`GET /decks/:id/pages` 会把它回给前端）。

---

## 10. 就地编辑的定位机制

### 10.1 `data-eid`

生成一页之后代码给"只装着一段文字"的元素注入 `data-eid="e1" e2 …`（`inject_eids`）。
改文字、改字号字色按 eid 定位。**eid 是服务端注的，不是模型写的**（让模型写的话它会重编号，于是同一个 eid 在两次生成之间指向不同的元素）。

改文字时必须带 `oldText` 对账：对不上就 400。覆盖上去等于把另一处的改动悄悄擦掉。

### 10.2 `path` + `eids` 交叉核对

容器没有 eid（eid 只给文字元素），所以按"从 `<section>` 数下来的子节点下标数组"定位，**再拿这一块里那串 eid 交叉核对一遍**。

不核的话：浏览器修正过结构（少一个闭标签、`<p>` 里塞了 `<div>`）时两边差一层，这次改动落在他没选的那一块上 —— 页面照样渲染、接口 200，只是"他点的那一块没动、另一块动了"。

`path` **只收非负整数**。字符串进来的话 `children[?]` 取到 `undefined`，报的会是"这一块和库里对不上"—— 指错方向。

`edit-region-style` / `delete-node` / `ai-edit` / `ai-remake` 四条**共用同一份** `pick_region`。各写一份的话哪天只在一处加了校验，另一条路照旧改/删隔壁那一块。

### 10.3 只动 `html` 那一列

就地编辑一律走"只更新 html"的存法。走生成那条存法会把 `images_json` 和 `problems_json` 一起清掉：删一行字就把"3 张图都配好了"擦掉，而界面上只是"已删掉"。

---

## 11. 图表数据必须回头重算

页面里的条形图/柱状图的条长写在 inline style 的 `--bar-v` / `--bar-max` 上，**和印出来的那个数字是两处**。

所以**任何改过文字或结构的路径之后都要跑一遍 `rechart_edited(html)`**，并把它回的 `notes` 显示出来：

- `edit-text`：把 "40%" 改成 "85%" 之后是一条短条配一个大数字，接口 200、图表渲染完整，只有照条长读出来的结论是错的。
- `delete-node`：删掉的正好是最长那一行时，轨道上限还是按那个被删掉的数算的 —— 剩下几行永远到不了满格。
- `ai-edit` / `ai-remake`：模型改 inline style 时就会碰到那两个变量。

上限变了要出声（不说的话别的条突然变长，他会以为是自己删坏了）。

---

## 12. 各处字数/数量上限（一张表）

| 常量 | 值 | 用在 |
| --- | --- | --- |
| `MAX_TITLE_CHARS` | 80 | deck 标题 |
| `MAX_BRAND_CHARS` | 24 | `brand_cn` / `brand_en` |
| `MAX_OUTLINE_CHARS` | 12000 | deck 提纲 |
| `MAX_PAGES` | 45 | 一份稿子的页数 |
| `MAX_PAGE_TITLE_CHARS` | 60 | 单页标题 |
| `MAX_POINTS_PER_PAGE` | 12 | 单页要点条数 |
| `MAX_POINT_CHARS` | 200 | 单条要点 |
| `MAX_PAGE_OUTLINE_CHARS` | 4000 | 单页提纲原文 |
| `MAX_PAGE_NOTES_CHARS` | 500 | 单页 / 整份的额外要求 |
| `MAX_SLOTS_PER_PAGE` | 6 | 一页的图槽数 |
| `MAX_SUBJECT_CHARS` | 300 | 一格图"画什么" |
| `MAX_EDIT_TEXT` | 1000 | 就地改字 |
| `MAX_INSTRUCTION` | 400 | `ai-edit` 指令 |
| `MAX_REMAKE_INSTRUCTION` | 1000 | `ai-remake` 指令 |
| `MAX_ALTS` | 3 | 规划给的备选版式 |
| `MAX_LISTED_RANGES` | 8 | 问题里最多列几个提纲区间 |
| `CANVAS_W` × `CANVAS_H` | 1920 × 1080 | 空白页画布舞台 |
| `MAX_ELS` | 60 | 空白页元素数 |
| `MIN_FONT_PX` | 14 | 舞台上允许的最小字号 |
| `ASSETS_PAGE_SIZE` | 120 | 素材库每页 |
| 上传单文件 | 10 MB | `POST /assets/upload` |
| 请求体 | 512 KB | 全局 JSON |
| 前缀限流 | 300 次 / 60 秒 | `/api/ppt` |
| `TOKEN_TTL_SECONDS` | 900 | SDK token |
| `MAX_EXTERNAL_UID_CHARS` | 64 | `externalUid` |

`MIN_FONT_PX = 14` 是**底线不是目标**：压字号是"内容塞不下"时最省力的那条路，模型不改结构、不删一个字，出来是一页排得满满当当的幻灯片，`overflow:hidden` 没触发、`problems` 里一个字都没有，而后排读不出来。

---

## 13. 服务层文件 → Python 模块对照

| 现文件 | 职责 | 行数量级 |
| --- | --- | --- |
| `tenant.ts` | 租户三元组 + NULL 安全 SQL 片段 | 33 |
| `deckStore.ts` | 全部读写（稿子/页/规划/页序重排） | 974 |
| `assetStore.ts` | 素材库读写 + 分组 | — |
| `planService.ts` | 规划整份、重算图位 | 737 |
| `outlineCleanService.ts` | 清洗提纲 | 183 |
| `pageService.ts` | 生成一页、拼整份、页眉、`checkPage` | 759 |
| `pageEdit.ts` | eid 注入 / 改字 / 改样式 / 删节点 | 737 |
| `canvasEdit.ts` | 空白页画布 | 240 |
| `aiEditService.ts` / `aiRemakeService.ts` | 两条 AI 编辑 + 回来那段的校验 | — |
| `imageSpec.ts` | 图位说明的规范化、比例 | 171 |
| `imageService.ts` | 找图槽、生图、贴图、图记录重排 | 747 |
| `chartData.ts` | 图表量重算 | 540 |
| `designSpec.ts` | 四档设计规范 → CSS 变量 | 397 |
| `deckShell.ts` | 外壳拼装（整份 / 单页预览 / 幕帘） | 257 |
| `layoutLibrary.ts` | 解析 `library/` 那几份文件 | 455 |
| `layoutState.ts` | 全站停用版式 | 112 |
| `styleLibrary.ts` | 配图画风 + 提示词模板 | 199 |
| `exportService.ts` | 导出单文件 + warnings | 117 |
| `blankPage.ts` / `demoDeck.ts` / `outlineFit.ts` / `imageGroups.ts` / `regionGuards.ts` | 空白页、demo、提纲容量估算、图分组检查、区域守卫 | 小 |
| `sdkLimits.ts` | SDK 配额中间件 + `frame-ancestors` | 205 |
| `core/sdkKeys.ts` | pk 生成、origin 规范化、限流窗口、CORS | 134 |

建议的 Python 落法：`services/ppt/` 一个包，每个文件一个模块，**`library/` 那几份 md/html 原样搬过去**（它们是数据，不是代码）。

---

## 14. 移植验收清单（按"能不能被看见"排）

1. 建库 + `GET /decks` / `POST /decks` / `GET /decks/:id` 能跑通 → 页面上能建一份稿子、看到列表。
2. `GET /layouts` / `GET /styles` / `GET /design-options` → 设置面板能选版式和配色。
3. `POST /decks/:id/plan` → 规划出来的页列表能看到，`planRev` 回来了。
4. `POST /decks/:id/pages` + `GET /decks/:id/pages` → 单页预览能在 iframe 里显示（这一步要外壳拼装 + `previewSlot` 都对）。
5. 配图三条路 + 素材库上传。
6. 就地编辑六条（eid / path 两套定位 + `rechart` 重算）。
7. 两条 AI 编辑。
8. `POST /decks/:id/deck` / `export`。
9. SDK：建 key → 换 token → 用 scoped token 跑一遍上面 4 和 6 → 验证配额三种 429/403 都能触发、`frame-ancestors` 生效。

每一步都能单独在界面上看到结果，别攒到最后一起测。
