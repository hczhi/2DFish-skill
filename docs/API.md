# API Reference

Base URL: `http://localhost:3001`

## Authentication

所有请求使用 Bearer token 鉴权：
```
Authorization: Bearer <jwt_token_or_module_token>
```

**两种认证方式：**
| 方式 | 格式 | 来源 | 用途 |
|------|------|------|------|
| JWT Token | `eyJ...` | 用户登录获取 | Web 前端交互 |
| 模块 Token | `mmPla_...` | Admin 后台为用户生成 | 第三方 API 调用 |

模块 Token 绑定到 (用户, 模块)，只能访问该模块白名单内的 API 路径。

---

## Auth Endpoints

### POST /api/auth/login `PUBLIC`
```json
// Request
{ "username": "admin", "password": "123456" }
// Response
{ "token": "eyJ...", "user": { "id": "...", "username": "admin", "role": "admin" } }
```

### POST /api/auth/register `PUBLIC`
```json
// Request
{ "username": "newuser", "password": "password123" }
// Response 201
{ "token": "eyJ...", "user": { "id": "...", "username": "newuser", "role": "user" } }
```

### GET /api/auth/me `PROTECTED`
返回当前用户信息（id、username、role）。

### POST /api/auth/change-password `PROTECTED`
```json
{ "oldPassword": "...", "newPassword": "..." }
```

---

## Quota

### GET /api/quota `PROTECTED`
```json
{ "used": 3, "limit": 10, "remaining": 7 }
```

所有用户统一使用平台 API Key，受每日额度限制。Admin 可为单个用户调整额度上限。

---

## AI Endpoints

所有 AI 端点为 `PROTECTED`，每次调用消耗 1 额度。

### POST /api/ai/fish/decide
Fish tank AI 决策。

### POST /api/ai/fish/knowledge
根据兴趣生成知识卡片。

### POST /api/ai/fish/story-event
生成鱼缸故事事件。

### POST /api/ai/board/chat
智慧板 AI 回复。
```json
{ "message": "我很迷茫", "mode": "wisdom" | "dark" }
```

---

## Chat (Synap)

### GET /api/chat/messages `PROTECTED`
### DELETE /api/chat/messages `PROTECTED`
### POST /api/chat/stream `PROTECTED`
SSE 流式端点，消耗额度。

---

## Consultant

### GET /api/consultant/messages `PROTECTED`
### DELETE /api/consultant/messages `PROTECTED`
### POST /api/consultant/stream `PROTECTED`
SSE 流式端点，消耗额度。

---

## 品牌咨询工作台 (/consult)

一个品牌 = 一个项目，14 步（四看 / 四问 / 四大成 / 第二层内容营销 / 第三层数字化营销）。全部 `PROTECTED`。
`lane` 有三个值，决定这一步走哪条接口：`fast` 和 `plan` 都走 `/draft`，`slow` 走
`/decisions` → `/decisions/apply` → `/draft`（先拍板方向，再照它出**一份**正文）。
`slow` 的老路 `/directions`（AI 出 2–4 份完整方案给他挑）接口还在，但**界面上已经没有入口** ——
只用来恢复老项目里已经出过的方向卡。
前端分组顺序**按 `GET /stages` 返回的顺序推**，不写死分组名清单 —— 写死的话新增的分组
在左栏里完全不存在，而进度数和解锁全是对的，界面上看不出少了几步。

### GET /api/consult/stages
阶段清单（key / label / group / lane / question / requires / **method** / deliverables）。前端不写第二份。
`method` 是这一步的**分析操法**（方法论规定的推导顺序与判断标准）—— 和进 prompt 的是同一份，
界面上要照原样显示：正文对不上它的顺序就是没照方法论推，而那种正文和推出来的长得一样。

### GET /api/consult/projects
每行带 `decided_count / stale_count / total_stages / brief_chars` 和
`intake_pending`（还没提交的问卷轮数）+ `intake_rounds`（已补进资料的轮数）。
`intake_pending` 前端必须显示出来 —— 那一轮没提交就意味着客户资料还缺一块，
而这一行的进度数照样在涨，和资料齐全的项目长得一模一样。

### POST /api/consult/projects
`{ brandName, brief }`。超长直接 400，**不截断**。
新建后前端**先去 `/consult/projects/:id/intake`**（补料问卷页）而不是工作台，
第一轮提交前进工作台会被送回那一页（只挡第一轮）。

### GET /api/consult/projects/:id
`{ project, stages, entries, sources, intake, intakeRounds, searchEnabled }`。
`intake` 是**还没补进资料的那一轮问卷**（含已填答案），刷新页面靠它恢复。`searchEnabled=false` 表示这个部署
没配搜索 key，前端必须显示出来（否则用户以为 AI 会上网）。

### PUT /api/consult/projects/:id/brief
### PUT /api/consult/projects/:id/name
### DELETE /api/consult/projects/:id

### POST /api/consult/projects/:id/stages/:key/draft
快车道（`fast`）、执行层（`plan`）和慢车道（`slow`）都走这里，三者 system prompt 不同
（找事实 / 承接结论出方案 / 照顾问拍板的方向写一份完整方案）。
`plan` 不要求客户资料非空（它的依据是上游定稿），`fast` 要求。
**`slow` 必须先有一条 `kind='decided'` 记录**（见 `/decisions/apply`），没有回 **400**、
拍板之后又重出过一版岔路口清单回 **409** —— 不拦的话这条路就是「AI 替他把取舍定了再写
一份完整正文」，而它的产出和照他定的方向写出来的一模一样。
**不落库**，返回 `{ draft, truncated, discussion, message, stages }`。
`discussion: { used, dropped }` 是这一版带进 prompt 的本步对话条数（只算 `kind='text'` 的），
前端必须显示 —— 带上和没带上出来的草稿读起来一模一样。
`draft.body` 固定以 `## 0. 方法论速览` 开头、以 `## 写作建议` 结尾（两节不在输出物清单里，
但每次都有）；`draft.aiOpportunities` 是 1–2 条 AI 赋能机会，**独立字段不在正文里** ——
报告最后那一章「AI 转型机会清单」按它取数。

### POST /api/consult/projects/:id/stages/:key/directions
慢车道出 2–4 个互斥方向，每个带 `markdown`（三件套整段，选中后即定稿正文）+ `writingTip`
+ `aiOpportunities`，外层带 `verdict` 和 `methodBrief`（方法论速览，已拼进每个方向的 markdown
开头；模型没给时那一节写明「没给」而不是消失），以及和 `/draft` 同义的 `discussion: { used, dropped }`。

### POST /api/consult/projects/:id/stages/:key/decisions
慢车道**动笔之前**先把「必须由顾问（或客户）拍板的取舍」列出来。只有 `lane='slow'` 能调，
不产出正文、不定稿、不 `incRound`。返回
`{ points, noFork, missing, dropped, truncated, discussion, message, stages }`：

- `points[]`：`{ id, question, methodRef, basis, options[{label,detail,cost}], recommend }`，
  最多 4 个。`id`（`d1..dN`）由服务端生成，`methodRef` 指向 `GET /stages` 里那条 `method`
  的第几条 —— 顾问对着操法数得出来这个岔路口是不是编的。
- **`dropped[]` 必须显示**：缺 `basis` 或凑不出 2 个带 `cost` 的选项的那几处被服务端丢掉了，
  而少一处的卡片和「这一步只有两处要定」在屏幕上一模一样，那一处最后就是 AI 自己定的。
- `points` 为空且 `noFork` 有话说 = 这一步真的没有取舍要拍板；两个都空、或者模型给的几处
  全被丢掉，一律 **502**（一屏空白读起来就是「这一步不用你定，直接出方案吧」）。
- `missing[]` 是缺事实、不是取舍 —— 那要走补料问卷，做成选项等于让客户猜一个数字。
- 同时在这一步的对话里追加一条 `kind='decisions'`（`payload` 是整份清单），刷新靠它恢复。
  **前端认 kind 的那条 `v-if` 链必须加这一支**：认不出的 kind 会落到 `v-else`，被画成
  一张「已生成候选方向」的卡片而右栏是空的，读起来像那一版丢了。

### POST /api/consult/projects/:id/stages/:key/decisions/apply
把顾问在那几处岔路口上的选择记下来 —— 它就是这一步出正文时的**地基**（`/draft` 读它）。
请求体 `{ sheetMessageId, picks: [{ id, label, note? }] }`，返回
`{ picks, noFork, sheetMessageId, message, stages }`（`message.kind='decided'`，
`role='user'` —— 那几处是**他**定的，记成 assistant 读起来就是「AI 说它定了」）。
**不花 AI 额度**（所以不在 `sdkLimits.AI_SPEND_ROUTES` 里），但必须落这条记录。四道闸：

- `sheetMessageId` 必须是**最新那一条** `kind='decisions'`，否则 **409**：清单里的 id
  是按顺序生成的（`d1..dN`），重出一版之后同一个 `d2` 已经是另一个问题 —— 存下来的是
  「问题 A + 答案 B」，而它在对话里、在正文的方法论速览里都读得通。
- **每一处都要有 `label`**，少一处 **400** 并点名是哪几处：留空的那几处 AI 会在写正文时
  自己定，而定完的正文读起来一样完整。
- `label` 只能是那个岔路口摆出来的选项之一，否则 **400**：自由发挥的答案配不上任何
  `cost`，进正文之后「放弃了什么」那一段就是模型编的。要补充就写 `note`（≤300 字，
  超了**只拒不截** —— 截掉的正是他刚写的那句要求）。
- `points` 为空的那种（`noFork`）**照样要提交一次**，落一条 `picks: []` 的记录：
  出正文那条路要求它存在，不然「没有取舍」和「还没拍板」在服务端分不开。

存下来的每一处是 `{ id, question, methodRef, label, detail, cost, note }` ——
问题和 `cost` **原样存**，不只存 id（同上一条：id 会随重出而漂），而 `cost` 要跟着进正文
（正文只会讲选中那条路的好处，「放弃了什么」是这一步唯一不可逆的信息）。

### POST /api/consult/projects/:id/stages/:key/draft/discard
丢弃这一版草稿 / 候选方向。请求体 `{ kind?: 'draft' | 'directions' }`（默认 `draft`），
返回 `{ message }`（`kind='discard'`，前端追加到对话末尾）。草稿本身不落库，所以这个接口
只做「留一条痕」这一件事 —— 但它是必需的：那一版存在对话里 `kind='draft'` 那条消息的
`payload` 里，前端光把本地状态清掉的话，切走再切回来会从那条消息恢复出来，用户点过的
「丢弃」等于没生效，而两次操作都显示成功。前端还要靠这条记录把它之前那张产出卡片置灰
（留着「查看 →」的话点了什么都不发生）。同 `entry`，它**不会**进下一次 prompt。

### GET /api/consult/projects/:id/stages/:key/messages
### POST /api/consult/projects/:id/stages/:key/chat
阶段内对话，只写 `consult_messages`（**改不了草稿也改不了定稿**）。它影响的是下一次
`/draft` / `/directions` —— 那两个接口会把本步最近 16 条 `kind='text'` 的对话带进 prompt。

### PUT /api/consult/projects/:id/stages/:key/entry
定稿进知识库。返回 `{ entry, message, staled, stages, entries }` —— `staled` 是被标成「待重跑」
的下游步骤，前端必须显示。`source_level` **由服务端按实际依据算**（有联网资料 → L1，
只有客户资料 → L2，都没有 → L3），请求体里传的会被忽略。
请求体可带 `aiOpportunities: string[]`（每步最多 2 条、每条 200 字，超了 **400 只拒不截**），
落在 `entry.ai_opportunities`（JSON 数组字符串，老定稿是 `'[]'`）。老定稿前端要显示成
「没标 AI 机会」而不是留空 —— 留空和「这一步确实没有」长得一样。
`message` 是同时写进这一步对话记录的那条定稿留痕（`kind='entry'`，前端直接追加到对话末尾）：
不留的话对话永远以「已生成草稿」那张卡片收尾，回头看不出最终定的是哪一版。
它**不会**进下一次 prompt（`discussionBlock` 只取 `kind='text'`）—— 定稿本来就以定稿身份
进下游 prompt，同一段出现两遍会被模型当成两处独立印证。

### GET /api/consult/projects/:id/report
把十四步的定稿合并成一份可交付的 markdown → `{ filename, markdown, stale, noBody, chapters, chars }`。
**不调 AI**（正文原样搬），前端拿 `markdown` 自己存文件。章节顺序来自 `STAGES` 而不是定稿时间。
有任何一步没定稿一律 **400 + `missing: string[]`**（缺哪几步的 label）：少两章的文档在屏幕上
和完整的一模一样，而它是要发给客户的东西。`stale`（上游改过之后没重跑的章节）/ `noBody`
（只存了结论、没有正文的老定稿）**同时写在文档开头和对应章节里**，接口再回一份给前端提示 ——
只回接口的话用户下载完就再也看不到了，而这份 md 会被直接转出去。

### POST /api/consult/projects/:id/intake
让 AI 读客户资料出一份补料问卷 → `{ gaps, questions: [{ id, section, question, why, placeholder, type, options }], truncated, round, rounds }`。
`type` 是 `'choice'`（可点选，`options` 里 2-4 个互斥的**类型划分**）或 `'text'`（只能手填）；
数字、金额、名单类的题服务端一律标 `text` 且清空 `options` —— 给那种题配选项等于让模型编几个
区间、客户挑最接近的那个，而它进资料之后和客户亲口说的一模一样。选项不足 2 条降级成 `text`
（不丢题）。「其他」「说不准」由前端固定补，不占 `options` 的名额（靠模型给它会漏，漏掉之后
客户只能在几个都不对的选项里挑一个最像的）。老轮次没有这两个字段，前端要缺省当 `text` 渲染。
落库（migration 080，一轮一行），**会删掉这个项目里上一轮没提交的问卷** —— 前端在
已经填了答案时要先确认。题数太少（模型没按格式回）时 502 + 说明 —— 绝不回空问卷
（空问卷读作「资料已经够了」）；出的题全是之前问过并且答过的时候 409 + 说明。

### PUT /api/consult/projects/:id/intake/answers
`{ roundId, answers: { <questionId>: text } }` 暂存填了一半的答案（前端逐题失焦时调）。
那一轮不在了 / 已提交时 **409**，不静默 200 —— 一路显示「已暂存」而其实没存，
用户关掉页面才发现是空的。

### POST /api/consult/projects/:id/intake/apply
`{ roundId, answers: [{ id, question, answer, section }] }` → `{ applied, brief, briefChars, rounds }`。
服务端**追加**到客户资料末尾并落库（不收整份 brief —— 整段替换会覆盖用户在别处的编辑）。
空答案的题连题目一起丢掉；超过 20000 字直接 400，不截断；同一 `roundId` 补第二遍 **409**
（补两遍 = 同一批答案在资料里两份，AI 会当成两处独立印证）。

### POST /api/consult/projects/:id/stages/:key/search
`{ query }` → `{ query, results: [{ title, url, content, published }] }`。**不落库**。
没配搜索 key 时 503 + 说明，检索失败 502 + 原文 —— 都不回空列表（空列表读成「网上没这家公司的资料」）。

### POST /api/consult/projects/:id/stages/:key/sources
采纳勾选的结果：`{ query, items: [{ title, url, snippet, published }] }` →
`{ added, skipped, sources }`。同一 url 重复采纳被挡掉并计入 `skipped`；
超过 40 条上限直接 400，**不只存前几条**。

### DELETE /api/consult/projects/:id/sources/:sid

### POST /api/consult/sdk/token `PUBLIC`
第三方**纯前端**页面换一把 15 分钟短 token，用来 iframe 嵌入 /consult 工作台（084）。
Body：`{ pk, externalUid }`。回 `{ token, token_type, expires_in, external_uid }`。

- **必须由第三方页面自己发这个请求**，不能由 iframe 里的页面发：iframe 里发出的
  Origin/Referer 是**我们自己的**域名，那道白名单于是对每个 pk 都成立，等于没配。
- `externalUid` **必填**（第三方那边的终端用户 id，签进 token，之后每个请求的租户只从
  签名过的 token 里取）。缺省成空串的话这个接入方所有终端用户共用一个归属键 ——
  A 客户的品牌资料会出现在 B 客户的项目列表里，而那就是一列正常的项目。
- 它是第三方页面传的，**不可信**：纯前端下任何人都能改掉它读到同一把 key 下别人的项目。
  只是**展示隔离，不是安全边界**。要真隔离，接入方得出一个最小后端来签这个值。
- Origin 不在 pk 白名单里回 403，**错误里带上收到的那一行** —— 接入方最常见的错是配了
  https 用了 http，只回一句 not allowed 的话他核对的是自己配的那一行。
- 换出的 token `scope=consult:embed`，能碰哪些端点由全局 `auth/scopeGuard.ts` 管（默认拒绝）：
  只放行 `GET /api/consult/stages` 和 `/api/consult/projects` 子树。**其余一律 403**，
  包括下面那几个发 key 的后台接口。

### GET|POST|PATCH|DELETE /api/consult/admin/sdk-keys `ADMIN`
pk 的 CRUD（绑账号 / 配 Origin 白名单 / 启停 / 换取限流 / 每把 key 的天花板）。
`allowedOrigins` **不许为空**：空清单的 key 换不到 token，而后台那一行看起来是建好的。

- `dailyAiLimit`（缺省 50）/ `maxProjects`（缺省 200）：**新 key 一定有上限**，和
  `ai_app_quota` 的「没配就不限」相反 —— 绑定账号开了专属渠道时它绕过 `ai_quota`，
  「不限」就是拿他自己那把 key 无上限烧真钱，而每次返回的都是一份正常的草稿。
  两个字段都必须是 >= 0 的整数（不是就 400），**`0` 是合法值** = 把这把 key 冻住。
- GET 每行额外回 `ai_used_today` / `projects`：只回上限不回用量的话，接入方那边被 429
  挡住时后台这一行看起来完全正常，管理员判断不出该调额度还是有人在滥用。
- 停用/删掉 key 立刻生效（`consultSdkLimits` 每个请求查一次），不用等那把短 token 过期；
  对外统一回 403 `{ code: 'sdk_key_disabled' }`「接口已关闭，请联系管理员」。

### 上限被触发时的两种 429（带 `code`，都写着真实数字）
- `sdk_project_cap`：`POST /projects` 超过 `maxProjects`。
- `sdk_ai_quota`：会花 AI 的端点（`/stages/:key/{draft,directions,chat,search}`、`/intake`）
  超过 `dailyAiLimit`，服务器时间 0 点重置。**先扣再放行** —— 等 AI 返回了再扣的话，
  同时打进来的一批请求读到同一个 used，上限形同不存在（而每条都返回正常结果）。

### iframe 嵌入的响应头
`/consult` 和 `/consult/*` 的响应**不发 `X-Frame-Options`**，改用
`Content-Security-Policy: … ; frame-ancestors <所有启用中的 pk 的域名之和>`
（`X-Frame-Options` 只有 DENY/SAMEORIGIN，多域名做不到；留着 DENY 的话第三方页面上是一块白，
而我们这边每个接口都 200）。没有任何启用的 key 时**照旧 DENY**。名单是**所有 key 的并集**而
不是按 pk 算：只有 iframe 那第一个文档请求带得上 pk，SPA 内跳和手动刷新都不带。

---

## Module Tokens (用户只读)

### GET /api/tokens `PROTECTED`
列出当前用户的模块 Token（只读，不含完整 token 值）。

```json
{
  "tokens": [
    {
      "id": "uuid",
      "module_id": "fish",
      "module_name": "Fish Tank",
      "token_prefix": "mmPla_abc123...",
      "enabled": 1,
      "expires_at": null,
      "created_at": "2026-07-01T...",
      "last_used_at": "2026-07-03T..."
    }
  ]
}
```

Token 的创建、启用/禁用、删除均由 Admin 操作（见 Admin Endpoints）。

---

## Discover (文章) Endpoints

### GET /api/discover/articles `PUBLIC`
获取已发布文章列表。

Query: `?locale=zh` (默认 `zh`)

### GET /api/discover/articles/:slug `PUBLIC`
获取单篇文章详情（含推荐文章）。

Query: `?locale=zh`

---

## Topics (专题) Endpoints

### GET /api/discover/topics `PUBLIC`
获取已发布专题列表。

Query: `?locale=zh`

返回值含 `article_count`（该专题下已发布文章数）。

### GET /api/discover/topics/:slug `PUBLIC`
获取单个专题详情（含所属文章列表）。

Query: `?locale=zh`

---

## Admin Endpoints

所有 Admin 端点需要 `role: "admin"`，未满足返回 403。

### 用户管理

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/admin/users | 用户列表 |
| POST | /api/admin/users | 创建用户 |
| PATCH | /api/admin/users/:id/role | 修改角色 |
| POST | /api/admin/users/:id/reset-password | 重置密码 |

### 额度管理

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/admin/quotas | 所有用户额度 |
| PATCH | /api/admin/quotas/:userId | 调整用户每日额度 |

```json
{ "daily_limit": 50 }
```

### AI 用量

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/admin/ai-usage?days=7 | 按用户/模块/日期维度的调用统计 |

### 对外中转接口（专属 AI 渠道下发的 key）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/admin/users/:id/relay-keys | 为该用户的某条接入点生成一把对外 key |
| DELETE | /api/admin/relay-keys/:keyId | 吊销（软删，行保留） |

```json
// POST — provider 必须是这个用户自己的、kind=llm 的接入点，否则 400
{ "provider_id": "...", "label": "给某个下游用" }
// Response — key 明文只在这里出现一次，库里只有 sha256
{ "key": "sk-mmpla-...", "relay_key": { "id": "...", "key_prefix": "sk-mmpla-ab12…cd34", "provider_id": "...", "enabled": 1, "revoked_at": null, "revoke_reason": "", "last_used_at": null }, "provider": { "...": "已脱敏" } }
```

下游调用的是 `/api/v1/*`（OpenAI 兼容，**无需平台 JWT**，用上面那把 key）：

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/v1/chat/completions | 非流式对话补全 |
| GET | /api/v1/models | 只列绑定的那一个模型 |

```bash
curl https://<域名>/api/v1/chat/completions \
  -H "Authorization: Bearer sk-mmpla-..." -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"你好"}]}'
```

- `model` 由接入点决定，body 里传什么都忽略；返回里的 `model` 是**真实**用到的那个。
- `stream: true` / `tools` / `functions` 一律 400（无声忽略会让客户端等一个永不到来的 SSE）。
- 只转发 `messages` + `temperature`/`top_p`/`max_tokens`/`presence_penalty`/`frequency_penalty`/`stop`/`response_format`/`seed`/`n`。
- 错误体是 OpenAI 形状 `{ "error": { "message", "type", "code" } }`：
  `401 invalid_api_key`（key 对不上）、`403 endpoint_closed`（吊销/接入点停用或删除/专属开关关了，
  对外只这一句）、`429 quota_exceeded`（撞的是该用户的 `relay` 应用额度）、`502 upstream_error`（带上游原文）。
- 用量记在绑 key 的那个用户头上，`ai_logs.source = 'relay'`；限流用
  `PUT /api/admin/users/:id/app-quota` 的 `app: "relay"`。

`GET /api/admin/users/:id/dedicated-ai` 的返回里多两个字段：`relay_keys: RelayKeyPublic[]`
（含已失效的：下游收到「接口已关闭」时，管理员要能看出是哪一把、为什么废）和
`relay_usage: { today_calls, today_tokens, week_calls, week_tokens }`
—— 这是该用户**所有 key 的合计**（`ai_logs` 没有 key 维度），界面上不能摆到某一行 key 旁边。
`DELETE /api/admin/providers/:id` 返回 `{ success, revoked_relay_keys }` —— 删接入点会把
绑在它上面的 key 一起标废，这个数必须显示出来。

### 系统配置

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/admin/config | 获取配置（API Key 已脱敏） |
| POST | /api/admin/config | 设置配置项 |
| DELETE | /api/admin/config/:key | 删除配置项 |

可设置的 key：`platform_api_key`、`platform_api_base_url`、`platform_model`

```json
{ "key": "platform_api_key", "value": "sk-..." }
```

### 模块管理

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/admin/modules | 列出所有模块配置 |
| POST | /api/admin/modules | 创建模块 |
| PATCH | /api/admin/modules/:id | 更新模块配置（name、allowed_paths、enabled） |

```json
// POST /api/admin/modules
{ "id": "my-module", "name": "我的模块", "description": "...", "allowed_paths": ["/api/my-module"] }
```

### Token 管理

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/admin/users/:id/tokens | 查看用户的模块 Token |
| POST | /api/admin/users/:id/tokens | 为用户生成模块 Token |
| PATCH | /api/admin/tokens/:id | 启用/禁用 Token |
| DELETE | /api/admin/tokens/:id | 删除 Token |

```json
// POST 生成 Token
{ "module_id": "fish", "expires_in_days": 30 }
// Response 201 — token 仅此时展示一次
{ "id": "...", "module_id": "fish", "token": "mmPla_full_token_value", "token_prefix": "mmPla_abc123...", "expires_at": "...", "warning": "Save this token now. It will not be shown again." }
```

约束：一个用户一个模块只能有一个有效 Token。

### Token 访问日志

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/admin/users/:id/token-logs | 查看用户 Token 访问记录 |

Query: `?module_id=fish&days=7&limit=100`

```json
{
  "logs": [
    { "id": "...", "token_id": "...", "module_id": "fish", "module_name": "Fish Tank", "method": "POST", "path": "/api/ai/fish/decide", "status_code": 200, "ip": "1.2.3.4", "created_at": "..." }
  ]
}
```

### 文章管理 (Discover Admin)

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/discover/admin/articles | 所有文章列表（含多语言内容） |
| GET | /api/discover/admin/articles/:id | 文章详情 |
| POST | /api/discover/admin/articles | 创建文章 |
| PATCH | /api/discover/admin/articles/:id | 更新文章 |
| DELETE | /api/discover/admin/articles/:id | 删除文章 |
| PUT | /api/discover/admin/articles/sort | 批量排序 |
| POST | /api/discover/admin/articles/:id/offline | 下线并删除静态页 |
| POST | /api/discover/admin/articles/:id/generate | 生成 SSG 静态页 |

文章字段：`slug`、`author`、`icon`、`cover_image`、`bg_color`、`avatar_color`、`sort_order`、`status`、`visible_locales`、`topic_id`、`contents`、`recommendations`

详细字段说明参见 `docs/skill-create-article.md`。

### 专题管理 (Topics Admin)

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/discover/topics/admin/list | 所有专题列表 |
| GET | /api/discover/topics/admin/:id | 专题详情（含所属文章） |
| POST | /api/discover/topics/admin | 创建专题 |
| PATCH | /api/discover/topics/admin/:id | 更新专题 |
| DELETE | /api/discover/topics/admin/:id | 删除专题 |
| POST | /api/discover/topics/admin/:id/offline | 下线并删除静态页 |
| POST | /api/discover/topics/admin/:id/generate | 生成 SSG 静态页 |

```json
// POST 创建专题
{
  "slug": "ai-weekly",
  "icon": "🤖",
  "bg_color": "#f0f5ff",
  "cover_image": "",
  "template": "default",
  "sort_order": 0,
  "status": "published",
  "visible_locales": ["zh", "en"],
  "contents": [
    { "locale": "zh", "title": "AI 周刊", "description": "每周精选 AI 资讯", "seo_title": "", "seo_description": "", "seo_keywords": "" },
    { "locale": "en", "title": "AI Weekly", "description": "Weekly AI news picks", "seo_title": "", "seo_description": "", "seo_keywords": "" }
  ]
}
```

---

## Feishu Assistant Endpoints

飞书助理的管理接口。全部 `PROTECTED` —— 事件通过长连接进来，
**没有对外的回调端点**（详见 `docs/FEISHU_ASSISTANT.md`）。

管理员在这些接口上天然看到全平台数据，普通用户只看到自己的，所以后台页面复用同一批接口。

### GET /api/feishu-assistant/capabilities `PROTECTED`
助理支持的动作，以及需要在飞书开发者后台开通的权限点。前端直接渲染成接入指引。
```json
{
  "actions": [
    { "name": "create_task", "description": "...", "examples": ["..."], "scopes": ["task:task:write"] }
  ],
  "scopes": ["im:message", "task:task:write", "bitable:app", "drive:drive", "im:message.group_at_msg:readonly"],
  "directory_scopes": ["contact:user.base:readonly", "contact:department.base:readonly", "im:chat:readonly"],
  "events": ["im.message.receive_v1"],
  "default_supplement": "以下规则用于帮助助理听懂本企业的说话方式…"
}
```
`actions` 和 `scopes` 都是**从动作注册表生成的**（`ACTIONS` + `allRequiredScopes()`），
加一个动作不用改本接口，接入指引里的权限清单也会自动多一项。

`scopes` 里已经包含 `directory_scopes`（接入指引让用户一次配齐）；单独再列一份是因为
它们的性质不同：**不开也能用助理**，只是每次都必须在群里 @ 到人，
说一个没 @ 的同事的名字会失败。前端据此把它们渲染成「可选，但强烈建议」
而不是硬性前置条件。

`bitable:app` / `drive:drive` 相反，是**项目日记的硬前置**：少了前者建不出项目的
多维表格（「新建项目」直接报错），少了后者表能建出来但群里谁都打不开、
链接分享也关不掉（见 FEISHU_DIARY.md 第一节）。

`params` 的值是**给 LLM 看的自然语言说明**，不是 JSON Schema，前端原样展示。
涉及人的参数（`create_task.assignee`、`update_task.followers`）收的是**姓名**，
服务端查 mentions 和名册换成 open_id —— 所以指名一个没 @ 过的人依赖
`directory_scopes` 那一组权限，没同步过名册时用不了。

`default_supplement` 是**应用没填自己的补充规则时实际生效的那份**（skill slot
`feishu-intent`，migration 056 播的示例模板）。前端「填入示例模板」按钮读它 ——
客户端自己抄一份的话，平台改了模板之后按钮填出来的还是旧的，而用户以为那就是当前默认。

面向用户的读动作只有项目日记那两个（`list_diary_projects` / `review_diary`），
它们读的是**我们自己的库**，不是飞书。飞书那侧的读基本做不到：「列出我的任务」
要 user token（见 FEISHU_ASSISTANT.md 第五节），本模块没有，也就不存在对应动作。

`update_task` 会顺带读一点东西，但那是**按 guid 读一条已知的记录**而不是列举 ——
guid 只可能来自我们自己的执行日志，所以这个动作只对**助理自己建过的**任务有效。
用户在飞书里手动建的，助理既查不到也改不动，回帖会明说这一点
（见 FEISHU_ASSISTANT.md 八·三）。

### GET /api/feishu-assistant/apps `PROTECTED`
已绑定的飞书应用。`app_secret` 已脱敏；`live_state` 是内存里的实时连接状态
（`conn_state` 是库里最后一次记录的）。管理员额外拿到 `owner_username`。
```json
{
  "apps": [{
    "id": "...", "name": "市场部助理", "app_id": "cli_xxx",
    "app_secret": "abc1234...wxyz", "enabled": true, "allowed_chats": ["oc_xxx"],
    "conn_state": "connected", "conn_error": null, "conn_at": "2026-08-04T10:00:00.000Z",
    "live_state": "connected",
    "dir_sync_state": "ok", "dir_sync_error": null, "dir_sync_at": "2026-08-04T10:01:00.000Z",
    "dir_user_count": 128, "dir_source": "contact",
    "intent_supplement": "「过一下方案」= 开一个评审会\n「早会」默认指 09:30"
  }]
}
```
`dir_*` 是组织架构名册的同步状态（057）。`dir_source` 为 `"chats"` 表示通讯录权限
没开、走的是群成员兜底 —— **前端不能把它渲染成绿色的"已同步"**，那份名册只覆盖
机器人所在的群。

`intent_supplement`（059）是这个应用自己的「本企业补充规则」，空串表示走
`capabilities.default_supplement` 那份平台默认。**只能由
`PUT /apps/:id/intent-supplement` 修改**，`POST /apps` 不碰它（见下）。

### POST /api/feishu-assistant/apps `PROTECTED`
新增或编辑（传 `id` 即编辑）。保存后立刻按 `enabled` 建连或断连。

请求体：`{ id?, name, app_id, app_secret?, enabled, allowed_chats: string[] }`

- 编辑时 `app_secret` 留空 = 保留原密钥。
- **归属账号不接受请求体指定**，编辑时保持原归属 —— 否则能把应用挂到别人名下消耗其额度。
- `allowed_chats` 为空数组 = 不限群聊。候选群名来自
  `GET /apps/:id/chats`；**提交时要把该接口没列出来的已配置 id 一起带上**，
  否则一次保存就静默删掉它们（表现是一个本来正常的群突然不响应了）。
- **`intent_supplement` 不在这个接口的语义里**，本接口不会修改它。
  本接口是整行替换，而前端有好几处只带部分字段调它（启停、一键放行某个群）——
  规则要是挂上来，任何一次这种调用都会把用户写的那段话清成空串。

响应里的 `conn_error` 表示"配置存下来了但连接没建起来"（通常是凭证填错）：
```json
{ "app": { "...": "..." }, "conn_error": "建立飞书长连接失败：invalid app_secret" }
```

错误：`400` 新增时缺 app_id/app_secret · `403` 他人的应用 · `404` id 不存在 ·
`409` app_id 已被绑定（同一应用绑两次 = 两条连接 = 消息被处理两遍）

### DELETE /api/feishu-assistant/apps/:id `PROTECTED`
先断连再删行。`{ "ok": true }`

### POST /api/feishu-assistant/apps/:id/reconnect `PROTECTED`
手动重连。凭证没改但连接掉了（网络抖动、飞书侧重启）时的自助入口。
```json
{ "ok": true, "live_state": "connected" }
```
错误：`400` 应用已停用 · `403` 他人的应用 · `404` 不存在 · `502` 建连失败（含原因）

### POST /api/feishu-assistant/apps/:id/directory/sync `PROTECTED`
同步组织架构名册（指名一个没被 @ 到的同事的前提）。**绑定成功后会自动跑一次**，
这个接口是之后「有人入职/离职/调岗」时的手动更新入口。

**返回 `202` 就走**，不等同步完成 —— 全公司通讯录要几十到几百次 API 调用，
几十秒是常态。进度和结果写在 `feishu_apps.dir_*` 上，前端轮询 `GET /apps` 拿状态。
```json
{ "ok": true, "state": "syncing" }
```
错误：`400` 凭证没填全 · `403` 他人的应用 · `404` 不存在 ·
`409` **已经在同步中**（两次并发同步会互相 DELETE 对方刚写入的行，最后剩哪一半取决于时序）

同步本身的失败**不通过 HTTP 返回**（那时响应早发出去了），而是写进 `dir_sync_error`。
两条数据源：通讯录接口（主）→ 群成员（兜底）。**只有飞书 code 99991672（缺权限）
才降级**；网络/限流/5xx 直接判失败，否则用户会拿到一份不完整的名册却以为同步成功了。
失败时**不清空已有名册**。

### GET /api/feishu-assistant/apps/:id/directory `PROTECTED`
名册内容。用于搜人、看部门归属、确认某个人在不在里面。

Query：`q`（模糊搜姓名/部门/职位）· `page` · `page_size`（默认 50，上限 200）
```json
{
  "users": [{
    "open_id": "ou_xxx", "name": "张三", "en_name": "Tom Lee",
    "department_names": "销售部 / 华东组", "job_title": "销售经理",
    "is_resigned": 0, "source": "contact"
  }],
  "total": 128,
  "departments": [{ "department_id": "od_xxx", "name": "销售部", "parent_id": "0", "member_count": 12 }],
  "sync": { "state": "ok", "error": null, "at": "...", "user_count": 128, "source": "contact" }
}
```
这里的 `q` **允许模糊匹配**，因为结果由人来挑。指令执行路径上的 `findByName`
恰恰相反 —— 只做归一化后的精确相等，见 `docs/FEISHU_ASSISTANT.md` 第六节。

错误：`403` 他人的应用 · `404` 不存在

### GET /api/feishu-assistant/apps/:id/chats `PROTECTED`
机器人见过的会话。前端用它把群白名单从「手打 chat_id」变成「勾选群名」——
`oc_xxx` 在飞书客户端里**没有任何地方能看到**，没有这个接口时唯一的配法是
先留空（真的不设防）跑一遍、再去指令日志里抄 id。

```json
{
  "chats": [{
    "chat_id": "oc_xxx", "name": "产品群", "chat_type": "group",
    "source": "bot_added", "reject_count": 0,
    "last_seen_at": "...", "last_rejected_at": null,
    "in_allowlist": true
  }],
  "allowlist_empty": true
}
```

- `source`：`bot_added` = 机器人被拉进群时记的（有群名）；`rejected` = 只在白名单外
  被拦时见过（只有 id）。`name` 可能是空串 —— 群名要 `im:chat:readonly` 才拿得到。
- `reject_count > 0` = 这个群 @ 过机器人但被白名单拦下了。被拦时机器人**不回话**
  （回了等于向任意群暴露自己），所以这个计数是用户唯一能知道"@ 了没反应是因为白名单"的地方。
- **`in_allowlist` 由服务端算**（白名单为空 = 全部放行）。这条规则不交给前端：
  用户侧和后台各实现一遍迟早有一个算错，而算错的方向是"显示已放行"，
  用户会以为自己设好防护了。
- 排序把被拦过的放最前面。

错误：`403` 他人的应用（群名等于公司内部信息）· `404` 不存在

### 项目日记：三个只读接口

下面四个接口是 `/feishu` >「项目日记」那一页的数据源，**除最后一个（删整个项目）之外只读**。
只读是设计不是没做完：同步到多维表格是**只追加**的（推上去就置状态位、永不重推），
所以网页上删掉一条，表格里那行删不掉 —— 开一个写入口就等于让库和表永久不一致，
而用户看的是表。所有写路径都走群里 @ 助理（每一步都带记录人、时间、原始 `message_id`）。

四者共用 `appForDiary()` 做归属校验，且 `:projectId` **必须同时匹配 `app_id`**：
光按 id 查的话，拿到一个别家公司的 `project_id` 就能读到那家公司的全部项目日志，
不匹配一律 `404`。403 的文案是「无权查看」—— 日志正文就是那家公司的项目进展，
越权读这里比越权改配置更糟。

#### GET /api/feishu-assistant/apps/:id/diary/projects `PROTECTED`
项目清单 + 项目总表链接。
```json
{
  "index": { "url": "https://…/base/bascn…", "link_share_closed": true },
  "projects": [{
    "id": "...", "name": "印度纪录片",
    "chat_id": "oc_xxx", "chat_name": "印度纪录片项目群",
    "url": "https://…?table=tbl…", "review_url": "https://…?table=tbl…",
    "link_share_closed": true, "in_index": true,
    "created_by_name": "张三", "created_at": "...",
    "record_count": 37, "unsynced_count": 0,
    "last_record_ms": 1786000000000, "summary_count": 3, "last_summary_at": "..."
  }]
}
```
- **`index` 可能是 `null`**（第一个项目建出来之前总表还不存在，或当初建总表那步失败了），
  `url` 也可能是空串。前端要区分这两种和"有链接"，别渲染成一个点不动的空链接。
- **`review_url` 单独给**：复盘存在 base 的第二张表里，群里发的那条被截到 1500 字，
  完整版在表里。不给这个链接的话用户点进去只看到「记录」表。
- **`unsynced_count` 必须显示出来。** 补推是跟着**下一次记录**发生的（没有定时任务），
  所以一个不再活跃的群会永久停在"库里有、表里少几条"。不显示这个数字，那种缺失查不出原因。
- `in_index: false` = 当初写进总表那一步失败了，下次在群里记录时会自动补登记。
- `link_share_closed: false` 是**信息泄露面**，不是观感问题：链接分享没关成功意味着
  组织内任何拿到链接的人都能看这个项目的全部日志，而链接是发在群里的。
- 计数用两条 `GROUP BY` 一次算完（`projectStats`），不是每个项目查四次 —— 这页一打开就调。

#### GET /api/feishu-assistant/apps/:id/diary/projects/:projectId/records `PROTECTED`
一个项目的日志正文，最新在前。Query：`page` · `page_size`（默认 50，上限 200）
```json
{
  "project": { "id": "...", "name": "印度纪录片", "url": "…", "review_url": "…" },
  "records": [{
    "id": "...", "content": "今天和导演对了分镜，第三场要重拍",
    "author_name": "张三", "created_ms": 1786000000000, "created_at": "...",
    "synced": true
  }],
  "total": 37
}
```
`synced: false` 是「这条在表里看不到」的唯一提示，含义同上面的 `unsynced_count`。

#### GET /api/feishu-assistant/apps/:id/diary/projects/:projectId/summaries `PROTECTED`
一个项目的复盘记录。Query：`page` · `page_size`（默认 20，上限 100）
```json
{
  "project": { "id": "...", "name": "印度纪录片", "review_url": "…" },
  "summaries": [{
    "id": "...", "range_label": "本周（08-03 至 08-09）", "record_count": 12,
    "summary": "（完整版 markdown，不截断）",
    "created_by_name": "张三", "created_at": "...", "synced": true
  }],
  "total": 3
}
```
`summary` 是**完整版** —— 群里那条被截到 1500 字，这也是这个接口的主要价值。

#### DELETE /api/feishu-assistant/apps/:id/diary/projects/:projectId `PROTECTED`
删掉一个项目。**只删库里的关联，飞书那侧一个字都不动。**
```json
{
  "ok": true,
  "deleted": {
    "name": "印度纪录片", "chat_id": "oc_xxx",
    "record_count": 37, "summary_count": 3,
    "log_url": "https://…?table=tbl…", "review_url": "https://…?table=tbl…",
    "task_url": "https://…?table=tbl…",
    "still_in_index": true
  }
}
```
- 库里删掉的是**日志记录 + 复盘 + 项目行**；`feishu_project_tasks` 只置空 `project_id`
  （那些任务在负责人的飞书待办里真实存在，删掉库里的行会让「改一下那个任务」再也找不到它）。
- **飞书的多维表格不删、项目总表那一行也不动。** 删除是一次网页点击，而我们既没有回收站
  也没有第二份（070 之后任务**只存在**于表格里）—— 顺手删云文档的话按错一下就没了全部历史。
- 所以 `log_url` / `review_url` / `task_url` **必须显示给用户**，而且不能用 alert
  （点掉就没了）：那些表建的时候没传 `folder_token`、链接分享也是关掉的，飞书里搜不到，
  而项目行一删助理就不再认识它们、群里问「有哪些项目」也不会再列出来 ——
  **这是最后一次能拿到链接的机会**。空串 = 当初那张表就没建出来。
- `still_in_index: true` 表示总表里那一行还在（它也是事后找回上面链接的途径），
  于是总表会继续列着这个项目。要说出来，否则用户打开总表会以为没删掉。
- 群和项目的绑定（`chat_id` 的 UNIQUE）随项目行消失，这个群之后可以重新「新建项目」——
  但**新项目会另建一套表**，和老表没有关系。

错误（四个都一样）：`403` 他人的应用 · `404` 应用不存在 / 项目不存在（含跨应用的 projectId）

### PUT /api/feishu-assistant/apps/:id/intent-supplement `PROTECTED`
保存这个应用的「本企业补充规则」（migration 059）—— 让助理听懂本公司的术语、简称、
时间习惯。请求体 `{ text: string }`，响应是更新后的整行（同 `GET /apps` 的形状）。

- **空串是合法值**，语义是「回落到平台默认那份」，不是「忽略本次请求」。
- 上限 **4000 字**，超了 `400`。这段话每解析一条指令就随 prompt 发一次：
  太长会让每条指令都更慢更贵，而且会把后面的硬性规则（open_id 只许照抄、
  输出必须是 JSON）压下去 —— 表现是助理"忽然开始把任务派给错的人"。
- **按应用存，不按账号**。一个应用 = 一个飞书租户，一个账号能绑多个应用。
- **改完不用重连**，下一条指令就生效（dispatcher 每条消息都重取应用行）。
- 只影响"怎么听懂人话"。动作清单、JSON 格式、open_id 约束都在代码里，
  写在这里无效，详见 `docs/FEISHU_ASSISTANT.md` 第八·二节。

错误：`400` 超长 · `403` 他人的应用 · `404` 不存在

### GET /api/feishu-assistant/commands `PROTECTED`
指令执行日志，排障的唯一依据。

Query：`status` (`pending`/`running`/`done`/`failed`/`ignored`) · `app_id` · `page` · `page_size`（默认 50，上限 100）

非管理员的结果被钉死在自己的记录上；传他人的 `app_id` 筛选返回 `403`
（否则能读到别人在飞书群里说过的原话）。
```json
{
  "commands": [{
    "id": "...", "app_id": "cli_xxx", "chat_id": "oc_xxx", "chat_type": "group",
    "sender_name": "张三", "text": "记一下：客户要把 logo 改大",
    "action": "add_diary_record", "params": "{\"content\":\"客户要把 logo 改大\"}",
    "status": "done", "error": null, "error_detail": null,
    "result": "{\"summary\":\"📝 已记到 印度纪录片…\"}",
    "duration_ms": 2840, "created_at": "...", "completed_at": "..."
  }],
  "total": 1
}
```

一句话里说了两件事时（「记一下客户要改 logo，顺便派给张三」），`action` 是
`"add_diary_record + create_task"`，`params` 存的是步骤数组；一步时和以前逐字节相同。
`result` 里 `summary` 是**做成了的那几步**的回复拼起来（前端详情页直接读它），
`steps[]` 逐步给 `action` + `summary` + 该动作自己的 `data`：
```json
{
  "summary": "📝 已记到 印度纪录片：客户要把 logo 改大\n✅ 任务已创建：把 logo 改大（张三）",
  "steps": [
    { "action": "add_diary_record", "summary": "📝 已记到 印度纪录片…", "project": "印度纪录片", "record_id": "...", "synced": true },
    { "action": "create_task", "summary": "✅ 任务已创建…", "guid": "...", "title": "把 logo 改大", "url": "https://…" }
  ]
}
```
**做成了一半算 `failed`**（有一件事没办到不能记成成功），此时 `result` 里只有成功的步骤，
没做成的那一步在 `error` / `error_detail` 里。用户收到的回帖会明确说「前面的已经生效了」——
否则他整条重下，成功的那部分会再做一遍。

`error_detail` 是**已解析的对象**（库里存 JSON 字符串，接口解开后返回；坏数据返回 `null`）。
缺权限时前端据此渲染「一键补权限」按钮，而不是去正则解析 `error` 文本：

```json
{
  "kind": "scope_denied",
  "message": "飞书应用缺少权限。\n需要开通以下任一项：task:task:write 或 task:task:writeonly\n…",
  "code": 99991672,
  "log_id": "20260804185909A15E80512A3691A0BCA3",
  "scopes": ["task:task:write", "task:task:writeonly"],
  "apply_url": "https://open.feishu.cn/app/cli_xxx/auth?q=task%3Atask%3Awrite&op_from=openapi&token_type=tenant"
}
```

`kind` 为 `api_error` 时只有 `message` / `code` / `log_id`。
`scopes` 多项时语义是**任一即可**。migration 055 之前的历史记录该字段为 `null`。

---

## 小红书写作台 (xhs)

### POST /api/xhs/rewrite `PROTECTED`
整篇正文改写（流式 SSE）。和 `/api/xhs/revise`（改选中片段、返回 JSON）是两件事。

```json
{
  "body": "要重写的整篇正文（纯文本，必填）",
  "message": "作者的诉求（必填）",
  "skillId": "写作风格 skill id（可选，不传/无权访问则不加风格）",
  "persona": "作者人设（可选）",
  "niche": "赛道/人群（可选）"
}
```

响应是 `text/event-stream`，逐条 `data: {"delta":"…"}`，以 `data: [DONE]` 结束。
两个必须处理的非 delta 事件（xhs 下所有流式接口同一套）：

- `{"error":"…"}` —— 上游报错/空返回，前端要抛出去，不能当流结束。
- `{"truncated":true}` —— 撞上模型输出上限，**前面的内容都是好的，但结尾断在半句话上**。
  不读这个事件的话，被截断的稿子和写完的稿子长得一模一样，用户会直接采纳/发布。

输出是**纯正文、不含标题**（标题在前端是单独的输入框；混进流里前端就得猜第一行是不是标题，
猜错的表现是标题被塞进正文第一段而原标题还留在框里）。

### GET /api/xhs/skills/templates `PROTECTED`
内置写作 skill 模板列表（写死在代码里，不查库，和用户自己的 skill 无关）。

```json
{
  "templates": [
    {
      "id": "human-writing",
      "name": "活人感写作",
      "description": "一句话说明这份规范管什么",
      "origin": "出处说明（字段叫 origin 不叫 source）",
      "chars": 3000
    }
  ]
}
```

### POST /api/xhs/skills/import-template `PROTECTED`
把某个模板复制成当前用户的一个 skill，返回 `201 { skill }`（结构同
`POST /api/xhs/skills`）。模板不存在回 404。**每次调用都新建一份，不查重** ——
导第二份通常就是想拿一份干净的重来。

```json
{ "templateId": "human-writing" }
```

---

## Error Responses

### 标准错误
```json
{ "error": "Error message here" }
```

### 额度耗尽 (429)
```json
{ "error": "quota_exceeded", "remaining": 0, "daily_limit": 10 }
```

### 限流 (429)
```json
{ "error": "rate_limit_exceeded", "retry_after_ms": 45000 }
```

### 模块路径未授权 (403)
```json
{ "error": "This API path is not enabled for this module", "module": "fish", "path": "/api/chat/stream" }
```

### 模块已禁用 (403)
```json
{ "error": "Module is disabled", "module": "fish" }
```

---

## Rate Limits

| Endpoint Group | Limit |
|---------------|-------|
| /api/ai/* | 30 req/min |
| /api/chat/* | 20 req/min |
| /api/consultant/* | 20 req/min |
| /api/feishu-assistant/* | 60 req/min |

Headers: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`
