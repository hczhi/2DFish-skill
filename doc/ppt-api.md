# PPT 模块接口文档

Base path：**`/api/ppt`**（所有路由都挂在这个前缀下，含 SDK 与后台管理）。
来源：`server/src/api/ppt.ts`（业务）、`server/src/api/pptSdk.ts`（SDK 与 key 管理）。
共 **41 条路由**（含 1 条 CORS 预检）。

## 0. 通用约定

### 0.1 请求

- 请求体一律 `application/json`，全局上限 **512 KB**（只有素材上传是 `multipart/form-data`）。
- 鉴权：`Authorization: Bearer <JWT>`。三档见 §0.3。
- 整个 `/api/ppt` 前缀上有一层限流：**300 次 / 60 秒**，按 `user:<用户id>` 计（没登录按 IP）。
  超限回 `429 { "error": "rate_limit_exceeded", "retry_after_ms": <毫秒> }`，并带响应头 `X-RateLimit-Limit` / `X-RateLimit-Remaining` / `X-RateLimit-Reset`。

### 0.2 响应与错误

成功一律 `200`（少数是 `204`），响应体是 JSON 对象。错误体的**基本形状**：

```json
{ "error": "一句中文说明（要原样显示给用户）" }
```

部分错误多带一个 `code` 字段供前端分支（见下表）。**错误文案是产品的一部分**：这套代码里每一句错误都写明了"这次没执行 / 已经执行了但没存上 / 下一步该干什么"，合成一句通用"操作失败"会让用户一路重试，而每次重试真扣一次 AI 额度。

| 状态码 | 场景 | 体 |
| --- | --- | --- |
| 400 | 参数校验不通过、`planRev` 缺失、AI 回来的内容不合规 | `{error}` |
| 401 | 没带 token / token 过期 | `{error:'Authentication required'}` / `{error:'Invalid or expired token'}`；业务层自己那句是 `{error:'请先登录'}` |
| 403 | 非管理员访问 `/admin/*`；scope 越界；SDK key 被停用 | `{error:'Admin access required'}` / `{error, scope}` / `{error:'接口已关闭，请联系管理员', code:'sdk_key_disabled'}` |
| 404 | 稿子/页/素材/版式不存在或不是你的 | `{error}` |
| 409 | `planRev` 不匹配（页序在别处变过） | `{error}`（文案里同时给出两个版本号） |
| 429 | 平台 AI 额度用尽 / SDK 稿子数上限 / SDK 当日 AI 上限 / 前缀限流 | 见 §0.5 |
| 500 | 生成/编辑成功但落库失败等 | `{error}` |
| 503 | 专属渠道缺档位（`DedicatedChannelError`） | `{error}` |

### 0.3 三档鉴权

| 档 | 路由 |
| --- | --- |
| PUBLIC（不校验） | `POST /api/ppt/sdk/token`、`OPTIONS /api/ppt/sdk/token`、`GET /api/ppt/demo-deck.html` |
| ADMIN | `/api/ppt/admin/*`（`requireAdmin`） |
| PROTECTED（其余全部） | 需要有效 JWT |

**中间件注册顺序是有约束的**（换顺序会静默改变行为）：

```
registerPptSdkRoutes(router)        // sdk/token 必须在 requireAdmin 之前
router.use('/admin', requireAdmin)
registerPptSdkAdminRoutes(router)
router.use(pptSdkLimits)            // 只对带 sdkPk 的请求生效
...业务路由
```

### 0.4 两种调用者：平台用户 vs SDK 嵌入

同一批业务接口有两种调用方：

1. **平台用户**：普通登录 JWT。`sdkPk = null`、`externalUid = null`。
2. **第三方嵌入**：先用 `pk` 换一个 15 分钟的 scoped JWT（`scope: 'ppt:embed'`），后续请求带它。此时 `sdkPk` / `externalUid` **只从签名后的 token 里读**，绝不从 body/query 读。

scoped token 只能访问白名单里的路径（`ppt:embed`）：

```
GET    /api/ppt/(layouts|styles|design-options|edit-palette)
GET    /api/ppt/layouts/:id
GET|POST|PATCH|DELETE  /api/ppt/decks/**
GET|POST|DELETE        /api/ppt/assets/**
```

不在白名单里的一律 `403 { error: 'This token is scoped to "ppt:embed" and cannot access <METHOD> <path>', scope }`。**故意排除**：`/api/ppt/admin/*`、`PUT /api/ppt/layouts/:id/enabled`（那是全站开关）、`GET /api/ppt/library/assets`。

### 0.5 配额相关的 429

平台 AI 额度用尽（`QuotaExceededError`）：

```json
{ "error": "quota_exceeded", "remaining": 0, "daily_limit": 10, "app": "ppt", "detail": "……" }
```

SDK key 的两种上限（`pptSdkLimits` 中间件，只在带 `sdkPk` 时生效）：

```json
{ "error": "……", "code": "sdk_deck_cap", "used": 50, "limit": 50 }
{ "error": "……", "code": "sdk_ai_quota", "used": 120, "limit": 120 }
```

**会被计入 SDK 当日 AI 次数的路由**（`AI_SPEND_ROUTES`，router 相对路径，全是 POST）：
`/decks/:id/clean-outline`、`/plan`、`/pages`、`/replan-images`、`/prepare-images`、`/ai-edit`、`/ai-remake`、`/images`。
计数是**先加后放行**的；一次请求生成多张图时事后用 `chargeExtraPptSdkAiCalls` 补差额。其余纯代码路由（编辑文字/样式/画布/删节点/拼整份/导出）**不计**。

### 0.6 `planRev` 页序版本号

所有**按页码定位**的写操作都必须带 `planRev`（body 字段，整数）：

- 没带 → `400`（文案："这次请求没带 planRev（页序版本号），没执行…"）
- 带了但不是整数、或和库里 `ppt_decks.plan_rev` 不一致 → `409`（文案里同时给出你带的和库里的两个数）

涉及的接口：`POST /pages`、`DELETE /pages/:page`、`PATCH /pages/:page/veil`、`replan-images`、`prepare-images`、`images`、`edit-text`、`edit-style`、`edit-region-style`、`delete-node`、`canvas`、`ai-edit`、`ai-remake`。
`plan_rev` 在 `savePlan` / `deletePage` / `insertPage` 三处 +1，这三个接口的响应里都会回新的 `planRev`。

---

## 1. SDK Token 交换（公开）

### 1.1 `OPTIONS /api/ppt/sdk/token`

CORS 预检。带 `Origin` 时回 `204` + CORS 头（`Access-Control-Allow-Origin`、`Vary: Origin`、`Allow-Methods`、`Allow-Headers`、`Max-Age: 600`）。

### 1.2 `POST /api/ppt/sdk/token` — 用 pk 换 15 分钟 token

**公开路由，无需鉴权。**

请求（body，也接受同名 query）：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `pk` | string | ✔ | 必须以 `pk_ppt_` 开头 |
| `externalUid` | string | ✔ | 第三方那边的用户标识。≤ 64 字符，字符集 `[A-Za-z0-9_.:@-]` |

**`externalUid` 不是隔离键**：它只做记录，不进任何 WHERE。同一把 pk 下的所有 `externalUid` 看到的是同一批稿子。要隔离两个客户 → **发两把 pk**。

成功 `200`：

```json
{ "token": "<JWT>", "token_type": "Bearer", "expires_in": 900, "external_uid": "u_123" }
```

JWT payload：`{ id, username, role: 'user', scope: 'ppt:embed', pk, euid }`，有效期 **900 秒**。

校验顺序与错误（顺序不能换，否则报错会指错方向）：

| 条件 | 状态 | 体 |
| --- | --- | --- |
| `pk` 缺失或前缀不对 | 400 | `{error:'Missing or invalid pk'}` |
| 缺 `externalUid` | 400 | `{error:'…（并明确说明它不是隔离键，要隔离请用两把 pk）'}` |
| `externalUid` 格式不对 | 400 | `{error:'externalUid must be <= 64 chars of [A-Za-z0-9_.:@-]'}` |
| pk 不存在或 `enabled=0` | 401 | `{error:'Invalid or disabled key'}` |
| Origin 不在 `allowed_origins` 里 | 403 | `{error:'Origin not allowed for this key (received: <origin\|none>)'}` |
| 超过 `rate_limit`（默认 60/分钟） | 429 | `{error:'Too many token requests, slow down'}` |
| key 绑的用户已被删 | 500 | `{error:'Key is bound to a missing user'}` |

成功时更新 `last_used_at` 并回 CORS 头。Origin 取自 `Origin` 头，缺失时退到 `Referer` 的 origin 部分。

---

## 2. SDK Key 管理（管理员）

全部走 `requireAdmin`，非管理员 `403 {error:'Admin access required'}`。

### 2.1 `GET /api/ppt/admin/sdk-keys`

无参数。响应是**数组**：

```json
[{
  "pk": "pk_ppt_xxx", "user_id": "u1", "name": "某客户官网",
  "allowed_origins": ["https://a.com"], "enabled": true,
  "rate_limit": 60, "daily_ai_limit": 120, "max_decks": 50,
  "created_at": "…", "last_used_at": "…",
  "username": "zhang", "ai_used_today": 7, "decks": 12
}]
```

`ai_used_today` 在 `ai_used_date != 今天` 时回 0；`decks` 是这把 key 名下的稿子数。

### 2.2 `POST /api/ppt/admin/sdk-keys`

| 字段 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `userId` | string | ✔ | — | 花费和稿子归到这个账号 |
| `name` | string | | `''` | 备注（后台辨认用） |
| `allowedOrigins` | string[] \| string | ✔ | — | 字符串时按 `[\s,;]+` 切；**不能为空** |
| `rateLimit` | int ≥ 0 | | 60 | token 交换每分钟上限 |
| `dailyAiLimit` | int ≥ 0 | | 120 | 每天 AI 次数上限 |
| `maxDecks` | int ≥ 0 | | 50 | 稿子总数上限 |

origin 规范化：去首尾空格、去尾部 `/`、转小写；必须是 http/https，**不能带 path/query/hash**。
三个数值 **0 是合法值**（= 禁用那一类），非整数或负数 → 400。

`400` 场景：缺 `userId` / 用户不存在 / `allowedOrigins` 为空 / origin 格式非法 / 数值非法。

成功 `200`：

```json
{ "pk": "pk_ppt_…", "user_id": "u1", "name": "…", "allowed_origins": ["https://a.com"],
  "enabled": true, "daily_ai_limit": 120, "max_decks": 50 }
```

副作用：清掉 `frame-ancestors` 缓存（`invalidatePptFrameAncestors`），否则新加的域名要等 30 秒才能嵌。

### 2.3 `PATCH /api/ppt/admin/sdk-keys/:pk`

只更新传了的字段：`name`、`allowedOrigins`（**不能改成空**）、`enabled`（boolean）、`rateLimit`、`dailyAiLimit`、`maxDecks`。
key 不存在 → `404`。成功 → `{ "success": true }`。同样清 `frame-ancestors` 缓存。

### 2.4 `DELETE /api/ppt/admin/sdk-keys/:pk`

成功 → `{ "success": true }`。
**不删这把 key 名下的稿子**（删了的话第三方那边的历史内容一次性消失，而这边只显示"已删除"）。删 key 之后那些稿子变成"没有入口但还在库里"，需要时可以把 key 重建回同名再取。

---

## 3. 演示稿

### 3.1 `GET /api/ppt/decks` — 列表

无参数。按 `updated_at DESC`。

```json
{ "decks": [{
  "id": "d1", "title": "季度汇报", "outline_chars": 3200, "planned_total": 18,
  "built_count": 12, "imaged_count": 7,
  "brand_cn": "示例企业", "style_id": "S-A", "design_json": "{…}",
  "created_at": "…", "updated_at": "…"
}] }
```

### 3.2 `POST /api/ppt/decks` — 新建

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `title` | string | | 空则取 `outline` 第一行；上限 **80** 字 |
| `outline` | string | | 上限 **12000** 字 |
| `brandCn` / `brandEn` | string | | 各上限 **24** 字 |
| `styleId` | string | | 配图画风；不传用默认 |
| `design` | `DesignSpec` | | 四个 id 都要给全，认不出**直接 400**（不回落） |

`400`：标题为空（且提纲也推不出标题）、标题超 80、提纲超 12000、design 不合法。
带 `sdkPk` 时还可能 `429 sdk_deck_cap`。

成功：`{ "deck": PptDeck }`（`PptDeck` = `ppt_decks` 的全部列）。

### 3.3 `GET /api/ppt/decks/:id` — 详情

```json
{ "deck": PptDeck, "design": DesignSpec, "designProblems": ["…"] }
```

`design` 是解析后的规范（老稿子回默认那套），`designProblems` 是回落时的说明，**必须显示出来**。
不存在或不是你的 → `404 {error:'这份演示稿不存在（或不是你的）'}`。

### 3.4 `PATCH /api/ppt/decks/:id` — 改提纲与设置

只改传了的字段：`title`、`outline`、`brandCn`、`brandEn`、`styleId`、`notes`（≤ 500 字）、`design`。
上限同 3.2。改 `design` **不需要重新生成任何页面** —— 配色/字体/疏密/页眉全靠覆盖 `:root` 变量生效，已生成的十几页刷新就变。

成功 `{ "deck": PptDeck }`。
一个字段都没变（或稿子不存在）→ `404 {error:'没保存上：这份演示稿不存在（或这次没有要改的字段）'}`。

### 3.5 `DELETE /api/ppt/decks/:id`

无 body。成功 `{ "ok": true }`。会连页面行一起删（代码里手工级联，外键是关的）。

---

## 4. 设计规范与调色板

### 4.1 `GET /api/ppt/design-options`

```json
{
  "palettes":  [{ "id": "P-A", "name": "想象橙（默认）", "hint": "橙 + 天青，暖底。…" }, …],
  "fonts":     [{ "id": "F-A", "name": "…", "hint": "…" }, …],
  "densities": [{ "id": "D-B", "name": "标准（默认）", "hint": "上下 100 / 左右 140" }, …],
  "headers":   [{ "id": "H-A", "name": "…", "hint": "…" }, …],
  "default":   { "palette": "P-A", "font": "F-A", "density": "D-B", "header": "H-A" }
}
```

只回 `id/name/hint` 三个字段（**不回 CSS 变量和规则**：那些是服务端注进去的，回给前端等于让前端有第二份可能对不上的真相）。

### 4.2 `GET /api/ppt/edit-palette`

就地改字色时那个调色板：

```json
{ "colors": ["var(--c-ink-deep)","var(--c-ink)","var(--c-ink-soft)","var(--c-brand)",
             "var(--c-brand-deep)","var(--c-accent)","var(--c-accent-deep)","#fff"] }
```

全是**角色变量**而不是色值 —— 写死色值的那一处换配色时不会跟着变，而它看起来完全正常。

---

## 5. 版式库与画风库

### 5.1 `GET /api/ppt/layouts`

```json
{ "layouts": [{
    "id": "L1", "num": 1, "name": "…", "title": "…", "applicable": "…",
    "roles": ["内容"], "shape": "分屏", "structure": "…",
    "imageSlots": 1, "designHint": "…", "variants": "…",
    "fullbleed": false, "hasCard": true, "noHeader": false, "hasDetail": true,
    "refImage": "…", "demoUrl": "/api/ppt/demo-deck.html?only=L1",
    "selectText": "…",           // 给规划用的短描述
    "buildLines": 42,            // buildText 的行数（正文本身不回，太大）
    "disabled": false
  }],
  "total": 65, "disabledCount": 2 }
```

现有 **65 条版式**（`services/ppt/library/layout-library.md` 的 `## L*` 段 + `library/cases/L*.md`）。
`buildText`（生成一页时喂给模型的完整案例代码）**不出现在响应里**，只回行数。
`system_config.ppt_disabled_layouts` 坏了 → `500`。

`roles` 取值：`封面 / 章节 / 内容 / 结尾`（**没有「目录」这一档**）。`shape` 取值：`聚焦 / 分屏 / 并列 / 对比 / 数据 / 时序`。

### 5.2 `GET /api/ppt/layouts/:id`

`{ "layout": PptLayout }`（这条带完整 `buildText`）。不存在 → `404`。

### 5.3 `PUT /api/ppt/layouts/:id/enabled`

**全站开关**（存在 `system_config`，不分用户；scoped token 禁止访问）。

Body：`{ "enabled": true | false }` —— **必须是严格布尔**，其他值 400（收 `"false"` 当真值的话他点了"停用"而它照旧被规划选中）。

```json
{ "disabled": ["L13","L47"], "warnings": ["停用之后「对比」这一类内容页只剩 1 条了…"] }
```

拒绝的两种：把某个 `role` 的最后一条版式停掉（400/500 带说明）；某个内容页版型整类消失时**照做但给 warning**。

### 5.4 `GET /api/ppt/styles`

```json
{ "styles": [{ "id": "S-A", "name": "…", "isDefault": true,
               "applicable": "…", "render": "…", "composition": "…", "taboo": "…" }],
  "defaultStyleId": "S-A",
  "colors": { "brand": "#…", "accent": "#…", "bg": "#…", "bgAlt": "#…" } }
```

`templates`（三种 `ImageMode` 的提示词模板）**不回**。`colors` 是按 deck 设计规范算出来的实际色值，生图提示词要用它 —— 一直读模板默认值的话蓝色系的稿子配出来的图全是橙的。

### 5.5 `GET /api/ppt/library/assets`

`{ "template": "<html…>", "design_tokens": "…", "illustration_style": "…" }`
三份库文件原文（`template.html` / `design-tokens.md` / `illustration-style.md`）。**scoped token 禁止访问。**

### 5.6 `GET /api/ppt/demo-deck.html?only=L7`（公开）

单条版式的 demo 页，直接回 **HTML**（不是 JSON），`Cache-Control: no-store`。
可选 query `only`：某条版式 id；不传回全部 demo。
错误回 `text/plain`：`版式 demo 出不来：… 现有片段：…`，找不到那条 id 时 `404`。

这条是公开的，因为它要能在第三方页面里用 `<iframe>` 直接嵌（CSP `frame-ancestors` 见 `doc/ppt-contracts.md` §3）。

---

## 6. 提纲与规划

### 6.1 `POST /api/ppt/decks/:id/clean-outline` — 清洗提纲（**一次 AI 调用**）

无 body（提纲从库里读）。**结果不落库**，等用户确认后再走 `PATCH /decks/:id`。

```json
{
  "cleaned": "清洗后的提纲全文",
  "removed": [{ "line": 12, "text": "（此处插入图表）", "why": "排版指令，不是内容" }],
  "problems": ["…"],
  "usage": { "prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0 },
  "changed": true,
  "chars": { "before": 3200, "after": 2980 }
}
```

`removed` 最多列 12 条。`changed=false` 时前端不该弹确认框。

### 6.2 `POST /api/ppt/decks/:id/plan` — 规划整份（**一次 AI 调用**）

无 body。**提纲一律从库里读，绝不从 body 读** —— 从 body 读的话他改了输入框没保存就点规划，规划出来的是另一份提纲的结构，而库里那份提纲和 `plan_json` 从此对不上。

```json
{
  "pages": [PlannedPage],       // 见 doc/ppt-database.md §6.1
  "problems": ["…"],
  "usage": {…},
  "planRev": 4,                 // 新的页序版本号，前端必须整份替换掉手里那个
  "clearedPages": 12,           // 重新规划清掉了几页已生成的 html
  "clearedImages": 5,           // 清掉几页的配图记录
  "clearedNotes": 3             // 清掉几页的页级设置
}
```

**重新规划是破坏性的**，三个 `cleared*` 必须显示出来（不说的话他以为只是"换了个结构"，而十几页生成好的内容和配好的图全没了）。

限制：提纲为空或超 12000 字 → 400；最多 **45 页**（`MAX_PAGES`）。

### 6.3 `GET /api/ppt/decks/:id/pages` — 取全部页

```json
{
  "pages": [{
    "page": 1, "layoutId": "L1", "html": "<section …>…</section>",
    "section": "开篇", "problems": ["…"], "images": [FilledImage],
    "imageStyleId": "S-A", "pendingImages": [PreparedImage],
    "veilOpacity": 0.35, "setupLayoutId": "", "notes": "",
    "updatedAt": "…"
  }],
  "shell": "<!doctype html>…<!--PPT_SLIDES-->…",
  "previewSlot": "<!--PPT_PREVIEW_SLIDE-->"
}
```

**外壳只回一份**，前端自己把某一页塞进 `previewSlot` 预览（一份 41 页的稿子这样从 3658 KB 降到 141 KB）。

### 6.4 `POST /api/ppt/decks/:id/pages` — 生成一页（**一次 AI 调用**）

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `page` | int | ✔ | 页码 |
| `planRev` | int | ✔ | 见 §0.6 |
| `layoutId` | string | | 覆盖规划里的版式；等于规划那个时按空串存 |
| `notes` | string | | 这一页的额外要求，≤ 500 字 |
| `title` | string | | 传了就同时改规划里这一页的提纲 |
| `points` | string[] | | 和 `title` 一起传；1~12 条，每条 ≤ 200 字 |
| `outlineText` | string | | ≤ 4000 字（只 trim 首尾） |

`title` 不是字符串时整个"改提纲"分支跳过（= 只生成，不动规划）。传了但为空 / 超长 / `points` 为空 → 400。版式 id 认不出 → 400。

```json
{
  "page": 3, "layoutId": "L12",
  "html": "<section …>", "previewHtml": "<!doctype html>…（可直接丢进 iframe）",
  "problems": ["…"], "images": [FilledImage],
  "style": { "id": "S-A", "name": "…" },
  "setup":   { "layoutId": "L12", "notes": "…", "deckNotes": "…" },
  "outline": { "title": "…", "points": ["…"], "outlineText": "…" },
  "plan":    { "images": 2, "imageSpecs": [PlannedImage] },
  "usage": {…}
}
```

`problems` 是"渲染出来了但不对"的清单，**每条都要显示**。空白页（`BLANK`）不能走这条接口。

### 6.5 `DELETE /api/ppt/decks/:id/pages/:page` — 删一页

Body：`{ "planRev": 4 }`（必填）。**最后一页不允许删。**

```json
{
  "plan": PlanResult,
  "planRev": 5,
  "removed": { "html": true, "images": 2, "prepared": 1, "notes": true, "veil": true },
  "shifted": 6
}
```

`removed` 逐项点名删掉了什么（有几张花过钱的图、有没有页级设置），`shifted` 是被往前挪了页码的页数。

### 6.6 `POST /api/ppt/decks/:id/insert-page` — 插一页

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `after` | int | ✔ | 插在第几页之后（0 = 插到最前） |
| `title` | string | ✔ | ≤ 60 字 |
| `points` | string[] | | 1~12 条，每条 ≤ 200 字 |
| `layoutId` | string | | 不传则继承前一页的版式（回 `layoutInherited: true`） |
| `blank` | boolean | | true = 建一张空白画布页（`layoutId` 记 `BLANK`） |

```json
{ "plan": PlanResult, "planRev": 5, "page": 4, "shifted": 8,
  "layoutId": "L12", "section": "第二章", "layoutInherited": true, "blank": false }
```

超过 45 页 → 400。**注意这条不收 `planRev`**（它是按 `after` 定位而不是按页码写库）。

---

## 7. 配图

一页最多 6 个图槽。图有三条来路：规划给的"图位说明"→ 备图（逐格换）→ 批量配全部图。

### 7.1 `POST /api/ppt/decks/:id/replan-images` — 重算这一页的图位说明（**一次 AI 调用**）

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `page` | ✔ | |
| `planRev` | ✔ | |
| `layoutId` | | 按这条版式重算 |
| `notes` | | 这一页的额外要求 |

```json
{ "page": 3, "layoutId": "L12", "imageSpecs": [PlannedImage], "problems": ["…"], "usage": {…} }
```

### 7.2 `POST /api/ppt/decks/:id/prepare-images` — 备一格图 / 换一格图

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `page` | int | ✔ | |
| `planRev` | int | ✔ | |
| `index` | int | ✔ | 第几格（1 起） |
| `from` | enum | ✔ | `'library'`（从素材库挑）\| `'ai'`（生一张，**花钱**）\| `'clear'`（清掉这一格备的图）\| `'subject'`（只改这一格的画什么，不生图） |
| `assetId` | string | `from='library'` 时必填 | 必须是自己的素材，否则 404 |
| `subject` | string | `from='subject'` 时必填 | ≤ 300 字 |

```json
{ "page": 3, "images": [PreparedImage], "problems": ["…"],
  "imageSpecs": [PlannedImage], "pasted": true }
```

`from='subject'` 那条分支**提前返回**，体里没有 `pasted`。`from` 认不出 → 400（静默当"什么都不做"的话界面上是"点了没反应"，而接口回 200）。

`from='ai'` 只贴给"这一格"，**只收 `assetId` 不收 url**（收 url 的话第三方能贴一个外站地址进来，导出那份 html 换台机器打开是裂图）。

### 7.3 `POST /api/ppt/decks/:id/images` — 配这一页全部图（**每格一次生图调用**）

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `page` | int | ✔ | |
| `planRev` | int | ✔ | |
| `force` | boolean | | true = 已经有图的格子也重做 |

```json
{
  "html": "<section …>", "previewHtml": "…",
  "images": [FilledImage],
  "problems": ["…"],
  "quotaExceeded": false,
  "provider": { "id": "p1", "model": "…" },
  "style": { "id": "S-A", "name": "…" }
}
```

`quotaExceeded=true` 时是**部分成功**：前几格配上了、后面的没有，必须原样说出来（合成一句"配图失败"会让他重来一次，而前面那几张已经花过钱了）。
带 `sdkPk` 时按实际生成张数补扣当日 AI 次数。

### 7.4 `PATCH /api/ppt/decks/:id/pages/:page/veil` — 照片页幕帘

Body：`{ "planRev": 4, "opacity": 0.35 }`。`opacity` 必须是 **0~1 的数**，超范围/非数字 → 400（**不夹到边界** —— 夹了的话他拖到 120% 拿到 100%，看起来像"保存偶尔会跳"）。

```json
{ "page": 3, "veilOpacity": 0.35, "previewHtml": "…" }
```

这一页还没生成时 `previewHtml` 是空串（值照旧存下来）。**html 一个字都不改。**

---

## 8. 就地编辑（全部不花 AI 额度）

这几条共用同一套前置检查（`editTarget`）：登录 → 稿子归属（404）→ `planRev`（400/409）→ 这一页生成过（否则 400 `第 N 页还没生成…`）。
落库全走 `savePageEditedHtml`，**只动 `html` 这一列**（走生成那条存法会把配图记录和 `problems` 一起清掉：删一行字就把"3 张图都配好了"擦掉，而界面上只是"已删掉"）。

定位有两套：

- **`eid`**：`data-eid` 属性，只给"只装着一段文字"的元素。
- **`path` + `eids`**：从 `<section>` 数下来的**子节点下标数组**，附带这一块里的 eid 列表做交叉核对。两边对不上（浏览器修正过结构、或这一页在别处重新生成过）→ 400 并列出两边的 eid。`path` 只收非负整数，字符串会被过滤掉。

### 8.1 `POST /api/ppt/decks/:id/edit-text`

Body：`{ page, planRev, eid, oldText, newText }`。

`oldText` 和库里对不上 → 400（这次编辑是拿着旧画面在改，覆盖上去等于把另一处的改动悄悄擦掉）。`newText` ≤ 1000 字。

```json
{ "page": 3, "eid": "e12", "text": "改后的文字", "html": "…", "previewHtml": "…",
  "chartNotes": ["这一页的条形图上限从 40 改成了 85 …"] }
```

`chartNotes` **必须显示**：改数字之后条长写在 style 里不会跟着变（"40" 改成 "85" 之后是一条短条配一个大数字，接口 200、图表渲染完整，只有照条长读出来的结论是错的）。

### 8.2 `POST /api/ppt/decks/:id/edit-style`

Body：`{ page, planRev, eid, style }`，`style` 是 `StylePatch`：

| 键 | 允许值 |
| --- | --- |
| `color` | 必须是 `GET /edit-palette` 里那 8 个之一 |
| `fontSize` | 8~400（px） |
| `fontWeight` | 300/400/500/600/700/800/900 |
| `textAlign` | `left` / `center` / `right` |
| `justifyContent` | `flex-start` / `center` / `flex-end` / `space-between` / `space-around` |

传 `null` = 清掉这条 inline 声明。`unset/initial/revert/normal/inherit/auto` 这类 CSS 关键字**一律拒**（要清就传 `null`）。调色板外的颜色、越界字号、认不出的属性一律 400（静默忽略的话他点了按钮画面一点不变，看起来像按钮坏了而接口回 200）。

```json
{ "page": 3, "eid": "e12", "style": { "color": "var(--c-brand)" }, "html": "…", "previewHtml": "…" }
```

### 8.3 `POST /api/ppt/decks/:id/edit-region-style`

Body：`{ page, planRev, path: number[], eids: string[], style }`，`style` 是 `RegionStylePatch`：
`alignItems`（`flex-start`/`center`/`flex-end`/`stretch`/`baseline`/`null`）、`justifyContent`（同上五档 + `null`）。

```json
{ "page": 3, "style": { "alignItems": "center" }, "region": "左栏",
  "prev": "flex-start", "html": "…", "previewHtml": "…" }
```

`prev` 是改之前那条 inline 是什么 —— 界面上要说出"取消掉的是 center"，不说的话那一整块变了样而他不知道该点回哪个键。

### 8.4 `POST /api/ppt/decks/:id/delete-node`

Body：`{ page, planRev, path: number[], eids: string[] }`。

```json
{ "page": 3, "removed": "<div class=\"…\">…</div>", "html": "…", "previewHtml": "…",
  "chartNotes": ["…"] }
```

拒绝的四种（各自的成因要原样回给界面）：这一块里含图 / 选中的是整页 / 删完这一页空了 / 这是最后一段可编辑文字。
**没有撤销**，前端确认框必须写明"删错了只能重新生成这一页"。

### 8.5 `POST /api/ppt/decks/:id/canvas` — 空白页画布

Body：`{ page, planRev, op, … }`。舞台是 **1920×1080**，一页最多 60 个元素。

| `op` | 额外字段 | 响应额外字段 |
| --- | --- | --- |
| `add-text` | — | `bel`, `eid`, `box` |
| `add-image` | `assetId`（必须是自己的素材，否则 404） | `bel`, `box`, `ratio`, `url` |
| `box` | `bel`, `left`, `top`, `width`, `height` | `bel`, `box` |
| `delete` | `bel` | `bel` |

统一体：`{ page, op, …上面那些, html, previewHtml }`。认不出的 `op` → 400。

**"是不是空白页"按 html 里有没有 `.bl-canvas` 判，不按 `layout_id`**：两处各判一次的话总有一处先放行，往普通版式页上写绝对定位的块，那一行别的内容跟着塌而接口 200。
`add-image` **只收 `assetId`**，理由同 §7.2。

---

## 9. AI 编辑（各一次真实调用）

### 9.1 `POST /api/ppt/decks/:id/ai-edit` — 改选中那一块的排版

Body：`{ page, planRev, path: number[], eids: string[], instruction }`。`instruction` ≤ 400 字。

模型**只能改结构和 inline style**：文案发出去之前全打了码（`maskRegion`），它碰不到。回来那一段过七条校验，**任何一条不过就整段丢掉并说出成因**（存一段错的进去，画面上是一页读起来完全正常的幻灯片，而他后面照着它做完整份）。

```json
{ "page": 3, "summary": "把这三条排成两列", "region": "内容区",
  "html": "…", "previewHtml": "…", "usage": {…}, "chartNotes": ["…"] }
```

### 9.2 `POST /api/ppt/decks/:id/ai-remake` — 自由改造选中那一块

Body 同 9.1，`instruction` ≤ 1000 字。

和 `ai-edit` **分成两个端点而不是一个 `mode` 开关**：那两条路放开的规则不一样（这边允许中文、允许删原文、允许加图槽），一个开关传错值会静默走另一条，现象是"AI 怎么没照我说的改"。

```json
{
  "page": 3, "summary": "…",
  "notes": ["丢掉了原来那句「…」", "新写了「…」", "这一页的条形图上限重算了", "第 3 格备好的图没地方贴了"],
  "region": "内容区", "html": "…", "previewHtml": "…",
  "images": [FilledImage],                       // 图记录重排过才有
  "plan": { "images": 2, "imageSpecs": [PlannedImage] },  // 图槽数变了才有
  "usage": {…}
}
```

`notes` **必须逐条显示**（丢掉的原文、AI 新写的文案、图表重算、孤立的备图都在这里，只显示 `summary` 的话那几条改动在画面上读起来完全正常）。
`images` / `plan` 只在变化时出现，**出现了就必须整份替换前端手里那份** —— 不换的话备图面板照旧按老清单画 1 格，而画面上已经是 2 个图槽。
图槽超过 6 格时会附一条 note：超出的那几格备不了图、也换不了图。

---

## 10. 素材库

### 10.1 `GET /api/ppt/assets`

Query：`deckId`（可选；`__none__` = 只看不属于任何稿子的散图）。

```json
{ "assets": [PptAsset], "total": 231,
  "groups": [{ "deckId": "d1", "title": "季度汇报", "count": 40 }],
  "deckId": "d1", "note": "…", "pageSize": 120 }
```

每页 120 条。

### 10.2 `POST /api/ppt/assets/upload`

`multipart/form-data`：文件字段名 **`file`**（内存存储，单文件，**上限 10 MB**），可选表单字段 `deckId`。

```json
{ "asset": PptAsset, "ratio": "16:9", "pixels": "1920x1080", "note": "…" }
```

`400`：超过 10 MB / 没带文件 / 读不出图片尺寸。
`500`：图**已经存进对象存储但没记进库**（这条必须出声：文件在那儿而素材库里没有，他会以为上传失败又传一次）。

`ratio` 是按实际像素取的最近一档（`nearestRatio`）。

### 10.3 `DELETE /api/ppt/assets/:id`

`{ "ok": true }`。只能删自己的（带租户键查）。

---

## 11. 整份拼装与导出

### 11.1 `POST /api/ppt/decks/:id/deck` — 拼整份

无 body。`{ "html": "<!doctype html>…", "pages": 18 }`

**整份 html 不落库**，每次读的时候现拼（`assembleDeck`）：存下来的话改一次配色/品牌名之后那份存档还是旧的，而它是一份完整正常的演示稿。

### 11.2 `POST /api/ppt/decks/:id/export` — 导出单文件

Body：`{ "baseUrl": "https://example.com" }`（可选，默认取 `req.protocol://host`）。

```json
{
  "filename": "季度汇报.html",
  "html": "<!doctype html>…",
  "warnings": ["第 3 页还是占位图", "第 5 页的图存在本机磁盘上，换台机器打不开",
               "这份文件依赖 https://… 才能显示图", "baseUrl 是 localhost，发出去打不开"],
  "placeholders": 2
}
```

`warnings` 四类都必须显示（导出的文件在别人电脑上打开才发现图裂，那时已经发出去了）。

---

## 12. 接口速查表

| # | 方法 | 路径 | 鉴权 | AI |
| --- | --- | --- | --- | --- |
| 1 | OPTIONS | `/sdk/token` | public | |
| 2 | POST | `/sdk/token` | public | |
| 3 | GET | `/admin/sdk-keys` | admin | |
| 4 | POST | `/admin/sdk-keys` | admin | |
| 5 | PATCH | `/admin/sdk-keys/:pk` | admin | |
| 6 | DELETE | `/admin/sdk-keys/:pk` | admin | |
| 7 | GET | `/decks` | user | |
| 8 | POST | `/decks` | user | |
| 9 | GET | `/decks/:id` | user | |
| 10 | PATCH | `/decks/:id` | user | |
| 11 | DELETE | `/decks/:id` | user | |
| 12 | GET | `/design-options` | user | |
| 13 | GET | `/edit-palette` | user | |
| 14 | GET | `/layouts` | user | |
| 15 | GET | `/layouts/:id` | user | |
| 16 | PUT | `/layouts/:id/enabled` | user（scoped 禁止） | |
| 17 | GET | `/styles` | user | |
| 18 | GET | `/library/assets` | user（scoped 禁止） | |
| 19 | GET | `/demo-deck.html` | public | |
| 20 | POST | `/decks/:id/clean-outline` | user | ✔ |
| 21 | POST | `/decks/:id/plan` | user | ✔ |
| 22 | GET | `/decks/:id/pages` | user | |
| 23 | POST | `/decks/:id/pages` | user | ✔ |
| 24 | DELETE | `/decks/:id/pages/:page` | user | |
| 25 | POST | `/decks/:id/insert-page` | user | |
| 26 | POST | `/decks/:id/replan-images` | user | ✔ |
| 27 | POST | `/decks/:id/prepare-images` | user | ✔（`from='ai'`） |
| 28 | POST | `/decks/:id/images` | user | ✔（每格一次） |
| 29 | PATCH | `/decks/:id/pages/:page/veil` | user | |
| 30 | POST | `/decks/:id/edit-text` | user | |
| 31 | POST | `/decks/:id/edit-style` | user | |
| 32 | POST | `/decks/:id/edit-region-style` | user | |
| 33 | POST | `/decks/:id/delete-node` | user | |
| 34 | POST | `/decks/:id/canvas` | user | |
| 35 | POST | `/decks/:id/ai-edit` | user | ✔ |
| 36 | POST | `/decks/:id/ai-remake` | user | ✔ |
| 37 | GET | `/assets` | user | |
| 38 | POST | `/assets/upload` | user | |
| 39 | DELETE | `/assets/:id` | user | |
| 40 | POST | `/decks/:id/deck` | user | |
| 41 | POST | `/decks/:id/export` | user | |
