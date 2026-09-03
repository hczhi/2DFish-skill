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

## HTML 展示稿 (ppt)

一份稿子的完整链路（每一步的产出**都落库**，前端不回传 html / 规划行 —— 回传的话它内存里
那份就是事实上的输入，产出每一页都好看、只是和这份稿子对不上，四条路径全不报错）：

```
POST /decks                    建一份（进工作台会自动规划一次）
POST /decks/:id/plan           提纲 → 每页一个版式（1 次 AI 调用，清掉已生成的页）
POST /decks/:id/prepare-images 逐格备图（可选，AI 生一张 = 一次真实花费）
POST /decks/:id/pages          生成第 N 页 HTML（1 次 AI，顺手把备好的图贴进去）
POST /decks/:id/images         给第 N 页配图（按图位逐张生图）
POST /decks/:id/edit-text      就地改第 N 页的一段文字（不调 AI、不花额度）
POST /decks/:id/edit-style     改第 N 页某一块的颜色/字号/字重/对齐（不调 AI）
POST /decks/:id/edit-region-style  改第 N 页某一整块（容器）的 align-items（不调 AI）
GET  /edit-palette             浮动条能用的那几个颜色（服务端白名单，前端不自己写一份）
POST /decks/:id/ai-edit        让 AI 改选中那一块的结构（1 次真实调用，文案打码后发出去）
POST /decks/:id/deck           拼整份（不调 AI，缺页 400）
POST /decks/:id/export         导出 .html（不调 AI）
```

`/api/ppt` 下限流 **300 次/分钟**（案例库一页就是 22 个 iframe，60 的话翻两页就被 429 挡住，
而卡片上照样挂着「效果 demo」）。除 `GET /demo-deck.html`（public，`<iframe src>` 带不了
Authorization 头）以外全是 `PROTECTED`，且**每一条 deck/page/素材查询都带 `user_id`** ——
少了它，换个账号带上别人的 deck id 读到/改到的是他那份稿子，而响应完全正常。

### GET /api/ppt/decks `PROTECTED`
我的演示稿列表（按 `updated_at` 倒序）。

```json
{
  "decks": [
    {
      "id": "uuid", "title": "云启数科 AI 转型",
      "outline_chars": 3200, "planned_total": 12,
      "built_count": 7, "imaged_count": 3,
      "brand_cn": "云启数科", "style_id": "S-A",
      "created_at": "2026-09-03T…", "updated_at": "2026-09-03T…"
    }
  ]
}
```

`planned_total / built_count / imaged_count` 三个数是他判断「这份稿子干到哪了」的唯一依据。
`imaged_count` 是**图真的配齐了的页数**（html 里已经没有占位图），不是「跑过配图的页数」：
跑过但全失败的那一页在预览里只是「这版设计得比较空」，算进去的话他以为图都好了，
转给别人才发现半份是占位图。

### POST /api/ppt/decks `PROTECTED`
```json
{ "outline": "整份提纲（≤12000 字）", "title": "可选，缺省取提纲第一行", "brandCn": "", "brandEn": "", "styleId": "S-A" }
```
回 `{ "deck": { …完整 deck… } }`。名字缺省取提纲第一行但**存下来**，不每次现算 ——
现算的话改一次提纲第一行，列表里那份稿子就换了名字，读起来像另一份。

400：名字空着（提纲也空）、名字超 80 字、提纲超 12000 字。提纲**只拒不截**：截掉的是后半段，
而规划出来的那份「完整」规划里压根没有那几页，界面上看不出少了什么。
上限和 `planService.MAX_OUTLINE_CHARS` 是同一个数（两处两个数的话存得进去而一点「开始规划」
就被拒，他看不出是哪一边的限制）。

### GET /api/ppt/decks/:id `PROTECTED`
`{ "deck": { "id", "title", "outline", "brand_cn", "brand_en", "style_id", "notes",
"plan_json", "planned_total", "status", "created_at", "updated_at" } }`；不是自己的回 404。

`plan_json` 是 `POST /decks/:id/plan` 那次的**整份返回原样存的字符串**（空串 = 还没规划过），
前端的规划面板读它 —— 逐页的 `layoutId` / `alts` / `why` / `imageSpecs` 都在里面。

### PATCH /api/ppt/decks/:id `PROTECTED`
```json
{ "title": "", "outline": "", "brandCn": "", "brandEn": "", "styleId": "S-A", "notes": "整份要求（≤500 字）" }
```
回 `{ "deck": {…} }`。**只改传了的那几个字段**：缺省成空串的话，任何一次只改名字的保存都会
把提纲清空，而两边都回「已保存」。

**一个字段都没传回 404**（不是 200）—— 静默成功的话前端那句「已保存」是假的。
400：名字空/超 80 字、提纲超 12000 字、`notes` 超 500 字（整份那段和页级那段**同一个上限**，
两处都是拒不是截 —— 截掉的半句照样发给模型，而他写在后面那几条要求每页都不生效）。
改 `notes` / `styleId` **不会重排或重做已经生成的页**（那是真实花过钱的），界面上要写明
「要逐页重新生成才会按新要求排」。

### DELETE /api/ppt/decks/:id `PROTECTED`
`{ "ok": true }`；不是自己的回 404。同一个事务里把它的页一起删（`ppt_deck_pages`），
生成过的图**留在素材库里**（那些是真花过钱的），COS 上的文件也不动。

### POST /api/ppt/decks/:id/plan `PROTECTED`
排版规划：这份稿子的提纲 → 每页挑一个版式（**不生成 HTML**），一次 AI 调用，结果落库。
**不收 body 里的 outline**，提纲取库里那一份 —— 收 body 的话前端那个还没保存的编辑框成了
事实上的提纲，「库里存的」和「刚规划的」是两份，而两边都正常返回。

```json
{
  "pages": [
    {
      "page": 3, "section": "第二部分 · 落地路径", "title": "三阶段路径",
      "points": ["试点", "复制", "平台化"],
      "layoutId": "L7", "alts": ["L3", "L9"], "why": "挑它的理由（一句话）",
      "images": 2,
      "imageSpecs": [{ "subject": "画什么", "mode": "concept", "ratio": "16:9" }],
      "layoutName": "tri-narrative-photo", "layoutTitle": "三栏并列叙事 · 全幅图叠字",
      "fullbleed": false, "demoUrl": "/api/ppt/demo-deck.html?only=L7"
    }
  ],
  "problems": ["每一处「结果能用但有话要说」"],
  "usage": { "prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0 },
  "clearedPages": 7, "clearedImages": 4, "clearedNotes": 2
}
```

`page` 和 `images`（张数）由**代码**算（硬规则 3）：模型编一个页码会跳号、`images` 另存一份的话
面板上写着「要 2 张」而下面列着 3 条规格，两处都读起来正常（`images === imageSpecs.length`，
只有模型压根没给规格时才用它给的那个数字，那时 `problems` 里有一条）。`imageSpecs` **没有
`index` 字段** —— 「第几格」就是数组位置（从 1 起），`prepare-images` 的 `index` 对齐它。
`alts` 是校验过的备选版式（不在库里的、和 `layoutId` 重复的已经丢掉，最多 3 条）。

`problems` **必须逐条显示**，这一步的失败形态全是「一份看起来完整的规划」：
模型给了库里没有的版式（那一页被丢掉并点名，绝不静默替换成某一条）、被截断只规划到第 N 页
（断点前那几页救回来了）、连续 ≥3 页同版式（只报不改）、图的规格被归一、备选被丢掉。

`clearedPages` / `clearedImages` / `clearedNotes` 是这次规划**扔掉的东西**，三个都要说出来：
已经生成的那几页、逐格备好的图、他手写的那几段要求 —— 全是花过钱或写过字的，不说的话
他只看到一句「规划好了」。备好的图那句要补「图还在素材库里可以挑回来」。

400：提纲空 / 超上限、规划出来超 40 页、拿不到 JSON、全部页都用了库里没有的版式
（一律带原文，**不回 `{pages:[]}`** —— 空规划和「这份提纲拆不出页」在界面上分不开）。
500：规划出来了但没存上（那次调用已经花掉了，话术里要写「刷新看看，别直接重试」）。

### GET /api/ppt/decks/:id/pages `PROTECTED`
这份稿子已经生成/已经备过图的那几页。

```json
{
  "pages": [
    {
      "page": 3, "layoutId": "L12",
      "html": "<section …>",
      "previewHtml": "单页 deck（现拼，不带页脚）；html 为空时是空串",
      "problems": ["生成那次留下的问题"],
      "images": [{ "index": 1, "url": "…", "ratio": "16:9 landscape" }],
      "imageStyleId": "S-A",
      "pendingImages": [{ "index": 1, "url": "…", "from": "ai | library" }],
      "setupLayoutId": "他挑的版式（空 = 照规划）",
      "notes": "这一页那段要求",
      "updatedAt": "2026-09-03T…"
    }
  ]
}
```

`previewHtml` **服务端现拼**（`deckShell`，不存也不让前端拼一遍）：存下来的话改过骨架之后
老 deck 用旧骨架渲染、导出用新的，两边都不报错。**`html === ''` 的行会出现**（先备了图、
还没生成 HTML），那种行的 `previewHtml` 是空串，前端**不许**把它当成「已生成」——
照拼一份空 deck 的话右边是一块白，读起来像那一页排版塌了。

`images`（配图跑完的结果 / 贴进去的备图）和 `pendingImages`（备着、还没贴）**分开回**：
合成一个的话「这一页图配好了」和「图只是备着」分不开，他会直接去拼整份（那几格还是占位图）。
`setupLayoutId`（他挑的）和 `layoutId`（这份 html 实际用的）不一样 = 换了版式还没重新生成，
前端必须显眼说出来 —— 两版都是一页正常的幻灯片。
**这条读不出来（请求挂了）也要出声**：静默当成「还没生成」的话界面上是「生成全部 12 页」，
而那十几次调用已经花过了。

### GET /api/ppt/layouts `PROTECTED`
22 条版式案例。**不带 `buildText`**（12 份详情 md 近 2000 行，列表页一个也用不上），
只回 `buildLines` 行数；要完整骨架走 `GET /layouts/:id`。

```json
{
  "layouts": [
    {
      "id": "L11", "num": 11, "name": "tri-narrative-photo", "title": "三栏并列叙事 · 全幅图叠字",
      "applicable": "适用场景原文", "structure": "", "imageSlots": "3 个（pXX_col1/col2/col3）",
      "designHint": "", "variants": "", "fullbleed": true, "hasCard": false,
      "hasDetail": true, "refImage": "/ppt-cases/L11-ref.png", "demoUrl": "/api/ppt/demo-deck.html?only=L11",
      "buildLines": 220
    }
  ],
  "total": 22
}
```

`imageSlots` 是原文（张数和构图要求都在里面，**别在前端拆**）。`demoUrl` 是那条版式的效果
demo，卡片缩略图和「生成前改一下」那个下拉都用它 —— 原始截图（`refImage`）只能标成
「原图参考」放在抽屉里：那是别人家 deck 的截图，用户照它期待颜色，拿到自己品牌色那一版
会以为生成质量不行。

### GET /api/ppt/layouts/:id `PROTECTED`
`{ "layout": { …上面那些字段 + "buildText": "详情 md 全文" } }`；没这条版式回 404。
列表和这条都带 `selectText`（挑版式那次 22 条一起进 prompt 的短文本），`buildText` 只有这条有 ——
生成某一页时只带**那一条**（单条近 8000 字，22 条一起带会把客户内容挤到上下文末尾，
出来照样是一份完整的 HTML，只是内容开始跑偏）。

### GET /api/ppt/styles `PROTECTED`
配图画风库（S-A ~ S-F，唯一来源是 `library/illustration-style.md`）。

```json
{
  "styles": [{ "id": "S-A", "name": "现代 SaaS 等距", "isDefault": true, "applicable": "", "render": "", "composition": "", "taboo": "" }],
  "defaultStyleId": "S-A",
  "colors": { "brand": "#…", "accent": "#…", "bg": "#…", "bgAlt": "#…" }
}
```

前端下拉照它渲染，**不写死一份清单**：md 里加了一套画风之后界面上完全看不见，
而选中的那几套照旧能用（读起来像「这个平台就这几种风格」）。`colors` 是 deck 外壳
`:root` 里的真色值 —— 图的配色跟着它走，界面上要能看到是哪几个（图和 deck 不是一套色
是唯一症状，而每张图单看都好）。**已存的 `styleId` 必须在拿到这份清单之后再覆盖下拉**，
反过来缺省那套会盖掉他存过的画风，而下拉里显示的是缺省值，看起来像他自己选的。

### GET /api/ppt/demo-deck.html `PUBLIC`
版式效果 demo，整份 deck；`?only=L7` 只出那一页。回 **html**（不是 JSON），`no-store`。
案例库的卡片缩略图和抽屉都 iframe 它。

三件事少一件页面上就是一块白而接口全是 200：它在 `auth/middleware.ts` 里登记成 **public**
（`<iframe src>` 带不了 Authorization 头，而 `/api/` 下默认 protected，iframe 里会显示一句
`Authentication required`）；`app.ts` 对这条路径单独发 `X-Frame-Options: SAMEORIGIN`
（全局那句 `DENY` 连同源 iframe 一起拦）；找不到片段回 **404 纯文本原文**并列出现有片段 ——
`{"error":…}` 在 iframe 里就是一行花括号，空 deck 则是一块白加一个「1 / 1」页脚，
读起来像那个版式渲染塌了。

### GET /api/ppt/library/assets `PROTECTED`
deck 级共享资料：`{ "template": "外壳 html 全文", "design_tokens": "", "illustration_style": "" }`。
和 `GET /api/ppt/assets`（用户自己的配图）不是一回事。

### GET /api/ppt/assets `PROTECTED`
配图素材库：当前用户生成过的每一张配图（每张都是一次真实的生图调用）。
和 `GET /api/ppt/library/assets` 不是一回事 —— 那条是 deck 外壳的共享 CSS / 配色资料。

```json
{
  "assets": [
    {
      "id": "uuid",
      "url": "https://cos/…png",
      "prompt": "槽位那句 data-img-prompt（不是渲染完的整段画风提示词）",
      "mode": "concept | case | data",
      "style_id": "S-A",
      "ratio": "16:9 landscape",
      "model": "wanx-v1",
      "storage": "cos | local",
      "deck_id": "出自哪份稿子",
      "page": 3,
      "created_at": "2026-09-03T…"
    }
  ],
  "total": 137,
  "pageSize": 120
}
```

`total` 是库里的总数，`assets` 最多 `pageSize` 条（按时间倒序）。
**前端要把两个数都显示出来**：只显示列表的话「素材库里就这些」和「这一页装不下」
分不开，用户会以为剩下的图丢了。`storage: "local"` 的那几张要标出来（COS 没配好时图落在
本机磁盘，换机器/多实例之后是 404，而生成那一刻预览里一切正常）。

### DELETE /api/ppt/assets/:id `PROTECTED`
`{ "ok": true }`；不是自己的或不存在回 404。

**只删这条记录**：COS 上的文件不动，已经用了这张图的那几页 html 也不动。
前端确认框里必须写清楚这一点 —— 不写的话用户以为这是「把这张图从稿子里去掉」，
删完去翻那份 deck 图还在，而这边刚回了一句「已删除」。

### POST /api/ppt/decks/:id/prepare-images `PROTECTED`
「先备图」：给规划里第 `index` 格备一张图。**这一页还没生成 HTML 也能备。**

```json
{
  "page": 3, "index": 2,
  "from": "library | ai | clear | subject",
  "assetId": "素材 id（from=library 时必填）",
  "subject": "可选：用户改写的提示词（≤300 字）"
}
```

`from=library` 从素材库挑一张（**不花额度**），`from=ai` 现生一张（**一次真实花费**），
`from=clear` 清掉这一格（只是不再备着，图还在素材库里），`from=subject` **只存提示词、不生图**。

`subject` 一带上就**写回 `plan_json` 里那一格的 `imageSpecs[index-1].subject`**（`from=clear` 除外）：
不写回的话界面上是他改过的那句，而下一次「AI 生成」/配图用的还是模型原来那句 —— 生出来是一张
正常的图，只是不是他要的那张。空的 / 超 300 字**一律 400**（空的生不出任何东西，那一格会一直停在
占位图上；截断的话他写在后面那几个条件一处都不生效）。`from=subject` 时那一格**已经备好的图不动**，
但会回一条 problems 说「那张是照上一句提示词生的，要按新的重画得点 AI 生成」。

```json
{
  "page": 3,
  "images": [
    {
      "index": 2, "url": "https://cos/…png", "prompt": "画什么（规划里那句 subject）",
      "mode": "concept", "ratio": "16:9", "styleId": "S-A", "model": "wanx-v1",
      "storage": "cos | local", "from": "ai | library", "at": "2026-09-03T…"
    }
  ],
  "problems": ["没地方贴、图落在本机磁盘、哪几格还是占位图之类的话"],
  "imageSpecs": [{ "subject": "画什么", "mode": "case", "ratio": "1:1" }],
  "pasted": {
    "html": "<section …>（备好的图已经贴进去的那一版）",
    "previewHtml": "单页 deck（不带页脚）",
    "images": [{ "index": 1, "url": "…", "ratio": "16:9 landscape" }],
    "styleId": "S-A"
  }
}
```

`pasted` **只在这一页已经生成过 HTML 时出现**：备好的图当场贴进库里那份 html（纯代码替换，
不调 AI、不花钱），前端必须用它覆盖那一页的 html/预览并作废拼好的整份 —— 不覆盖的话屏幕上
还是旧图而库里已经换了，他会照着屏幕再点一次「重新生成这一页」（那才是一次真实调用）。
里面的 `images` 是**合并后**的整页配图记录（贴上去的那几格覆盖同序号那条，之前 `POST /images`
真花钱配的别的格子留着 —— 整份覆盖的话那几张在界面上凭空变成「没配图」，他会再点一次
「换一批图」= 重花一遍）。存不上时 `pasted` 缺席，并且 `problems` 里会有一条说画面里还是旧图。

`imageSpecs` 是这一页**现在库里那份**规格（带上刚存进去的提示词），前端拿它覆盖内存里那份规划 ——
不覆盖的话对话框关掉再开是模型原来那句，而库里已经是新的，两处不一样而界面上一处都不说。

`images` 是**这一页备好的全部图**（不是刚改的那一格），前端整份覆盖 —— 只改动过的那一格
的话两边数组会漂开，而界面上每一格都显示着一张图（只是和库里存的不是同一张）。

`problems` 里的话一条都不能吞：第 n 格备的图没地方贴（模型少排了一个图位）、
图落在本机磁盘（换机器 404）、清掉之后画面里那张还留着 —— 都不报错，出来只是「这批图不太对」。
**比例和画风与这一格不一套都不在这里报**（他是看着那张卡上的「16:9 landscape · 画风 S-B」
自己挑的，报成「要注意」会把上面那几条冲下去），改成界面上那一格的标签一直显示着
（比例不一致时跟一句「会裁掉一块」）。

400：这一页的规划里没有 `imageSpecs`（老规划或模型只给了张数，要重新规划一次）、
`index` 超出规划的格数（备了也没有位置贴 = 白花钱）、`from` 不认识、挑的素材已被删。
429 额度用完，503 专属渠道缺 kind=image 那一档。

备好的图存在那一页上，`GET /api/ppt/decks/:id/pages` 里按 `pendingImages` 单独回，
和配图结果 `images` 分开 —— 合成一个的话「图配好了」和「图只是备着」在界面上分不开，
而用户会直接去拼整份（拼出来那几格还是占位图）。**贴进画面是在 `POST /decks/:id/pages`
那一步**（见下），所以已经生成过 HTML 的那一页备完图必须提示他重新生成那一页，
不然界面上多了一张缩略图而画面里什么都没变。
`POST /decks/:id/plan` 重新规划会连它们一起删，删了几张在返回的 `clearedImages` 里
（手写的那几段要求同理，在 `clearedNotes` 里）—— 两个都必须显示出来。

### POST /api/ppt/decks/:id/pages `PROTECTED`
生成（或重新生成）第 `page` 页的 HTML。一页一次 AI 调用。

```json
{
  "page": 3,
  "layoutId": "L12（可选，换版式）",
  "notes": "可选，字体/排版/语气那段要求（≤500 字）",
  "title": "可选，改这一页的标题（≤60 字）",
  "points": ["可选，改这一页的要点（≤12 条，每条 ≤200 字）"]
}
```

`title` / `points` 是「生成前改提纲」：**带了就先写回 `plan_json` 里那一条，再按新的那份生成**
（两件事必须同一次做完 —— 只生成不写回的话下次打开又是模型那句原话，只写回不用新的话出来
是一页照旧提纲排的完整幻灯片，而列表和标题栏写的是新提纲，两种都不报错）。
**没传 `title` 就是没改**（用库里那份，所以「逐页生成」只传 `page` 不受影响）；传了 `title`
就整条提纲都按这次传的算 —— 两个字段各自可选的话，「只改了标题」那一次会把要点存成空数组。
写回**不走重新规划那条路**（那个会把这份稿子已生成的页全删掉 = 改一句标题扔掉十几次调用）。
空标题、一条要点都不剩、超 12 条、单条超 200 字**一律 400**：只给标题的话模型会自己编这一页
的内容，出来那一页排版完整、读着通顺、而内容不是他的；截掉的那几条同样一个字都不出现在页面上。

整份那段要求（`PATCH /api/ppt/decks/:id` 的 `notes`，093）**每页都带，和页级那段一起发，
不是二选一** —— 页级有就顶掉整份那段的话，他在某一页补一句「这里的表格用等宽字体」，
整份定的「语气克制」就在这一页悄悄失效了（只有那一页语气不一样，没有一处会说）。
两段上限同一个数（500 字），超了都是 400 而不是截断。

`layoutId` / `notes` **带了就先存在那一页上**（092），所以下一次「重新生成」和「逐页生成」
只传 `page` 也照着改过的来 —— 不存的话它们会静默退回规划里那条版式、丢掉那段要求，
而生成出来照样是一页完整的幻灯片。没传的字段不动库里存着的那份（`notes: ""` 才是清空）。

可选的那几条备选版式来自规划行里的 `alts`（`POST /decks/:id/plan` 的返回、`GET /decks/:id`
的 `plan_json`，2-3 条，服务端已经把编出来的编号丢掉了）；前端把它们和规划挑的那条排在下拉
最前面，其余的排后面 —— 22 条平铺的话「换一个也合适的版式」等于自己认，挑一条装不下这一页
内容的出来照样是一页完整的幻灯片。老规划里没有这个字段（界面上要说明「重新规划一次才有」）。

认不出的 `layoutId` **一律 400**，不回落成规划那条（他选了 L12 拿到 L07 排的一页，读起来
完全正常）；`notes` 超 500 字**一律 400**，不截断（截掉的半句照样发出去，而他写在后面那条
要求不会生效）。要求那一段接在 prompt 最后、明写「优先于上面的建议」——夹在近 8000 字的
版式骨架前面的话模型照旧按建议排，一处都不说。

```json
{
  "page": 3, "layoutId": "L12",
  "html": "<section class=\"slide\">…</section>",
  "previewHtml": "整页可直接 iframe 的单页 deck",
  "problems": ["生成本身的问题 + 备好的图贴不上的那几条"],
  "images": [{ "index": 1, "url": "https://cos/…png", "prompt": "…", "ratio": "16:9 landscape" }],
  "style": { "id": "S-A", "name": "" },
  "setup": { "layoutId": "这次真的用了哪条版式", "notes": "这一页那段要求", "deckNotes": "整份那段要求" },
  "outline": { "title": "库里现在那份标题", "points": ["库里现在那几条要点"] }
}
```

`outline` 是**库里现在那份**（他改过就是新的）。前端要拿它更新左边列表和标题栏：不同步的话
那两处还写着模型原来那句标题，而画面是按新提纲生成的 —— 两处各自都读得通。

`setup.layoutId` 是**这次真的用了的**那条（`layoutId` 同一个值），前端要拿它更新界面上的
版式标签：写规划那条的话标签是 L07 而画面是 L12 排的，两版都是一页正常的幻灯片。
`GET /decks/:id/pages` 里 `setupLayoutId`（他挑的）和 `layoutId`（这份 html 实际用的）
**分开回**，两个不一样 = 换了版式还没重新生成，前端必须显眼说出来。

`html` / `previewHtml` 是**贴完备好的图之后**的那一版（回填在代码里做，地址从不经过模型 ——
让模型照抄 url 它会漏字符或复用上一页那张，而页面上是一张正常的图）。贴上去的那几张在
`images` 里回，前端要据此把这一页标成「已配图」并**在没有 `images` 时清掉旧的配图状态**：
不清的话重新生成过的那一页写着「图都配好了」，而画面里已经换回占位图。

`problems` 里那几条一条都不能吞：第 n 格备的图没地方贴（模型少排了一个图位）、
哪几个图位还是占位图 —— 两种都不报错，预览里只是「这一页设计得比较空」。
**比例不一致不在这里报**（改成挑图那一格的标签一直显示，见上面 `prepare-images`）。备好的图**贴完还留着**，所以再点一次「重新生成这一页」
会免费重贴一遍（不用再花钱生图）。

### POST /api/ppt/decks/:id/edit-text `PROTECTED`
就地改一段文字：他在预览里双击一段字改完失焦，这里改**库里那份 html**。不调 AI、不花额度。

```json
{ "page": 3, "eid": "t7", "oldText": "改之前那一块显示的那句", "newText": "他打的那句" }
```

```json
{ "page": 3, "eid": "t7", "text": "存下来的那句（折过换行、trim 过）", "html": "…", "previewHtml": "…" }
```

`eid` 是**生成那一页时由服务端写进 html 的 `data-eid`**（`pageEdit.injectEids`，每一段
「只装着一段文字」的元素一个）。**前端只回「哪一块 + 改前那句 + 改后那句」，不回整份 html**：
回整份的话一次 DOMParser 往返就可能把引号/自闭合标签/实体全换一遍（页面照样渲染），
而它内存里那份还可能是重新生成前的旧版 —— 于是「改一个标题」把整页退回上一版。
编号**不在编辑时按「第 N 个元素」重算**：重算的话改一次文字就可能让编号漂一位，
下一次编辑落到隔壁那一块上，而两块都是正常的文字。

四种情况一律 400、一个字都不写库：`eid` 找不到（这一页重新生成过，eid 换了一批）、
`oldText` 和库里现在那句对不上（拿着旧画面在改，覆盖上去等于把另一处的改动悄悄擦掉，
报错里带上「现在库里是哪句」）、改成空（那一块会缩成一条看不见的线，读起来像版式本来就这样）、
超 1000 字（顶出版式的 `overflow:hidden`，多出来的一个字都不显示也不报错）。
`<` `&` `>` 一律转义进 html —— 不转的话从那个字符到块尾会被浏览器当成标签吃掉，
页面照样渲染、接口 200，只是那一块少了半句话。换行折成空格（转 `<br>` 的话这一块多出个
子标签，下一次它就**不再能双击编辑**了，而没有一处会说为什么）。

只写 `html` 这一列（`deckStore.savePageEditedHtml`）：走生成那条存法会把
`images_json` / `problems_json` 一起清掉 —— 改一个标题就把「3 张图都配好了」和
「这一页版式有 2 处要注意」悄悄擦掉，界面上只是「已保存」。混排的那种块（`<div>CONTENTS<span>目录</span></div>`
的外层）**没有 `eid`，不给改** —— 按文本节点改它会把里面那个 span 连着样式一起吃掉。

### POST /api/ppt/decks/:id/edit-style `PROTECTED`
改一块字的**颜色 / 字号 / 字重 / 对齐**（写成那个开标签上的 inline style）。不调 AI、不花额度，
定位和存法都和 `edit-text` 同一套（`data-eid` + 只写 `html` 这一列）。

```json
{ "page": 3, "eid": "t7", "style": { "color": "var(--c-brand)", "fontSize": 40, "fontWeight": 700, "textAlign": "center" } }
```

```json
{ "page": 3, "eid": "t7", "style": { "color": "var(--c-brand)", "fontSize": 40 }, "html": "…", "previewHtml": "…" }
```

对齐收**两个键**：`textAlign`（`left`/`center`/`right`，普通文字块）和 `justifyContent`
（`flex-start`/`center`/`flex-end`，这一块本身是 flex/grid 时），前端按 `getComputedStyle().display`
挑 —— 只收 `textAlign` 的话，flex 那种块上浏览器**根本不认**这条声明：接口 200、库里写着
`text-align:center`，而画面一动不动。另外那一块的宽度就是文字宽度时（flex 里的项目常这样）
左中右三个键都不会有变化，前端量出来会跟着回一句「画面上看不出变化，要选到外层那一整块去改」
（那条走下面的 `edit-region-style`）。

四类键都可选，但**一个都不给是 400**。颜色只收 `GET /api/ppt/edit-palette` 那几个值
（`pageEdit.COLOR_PALETTE`，有测试核每个 `var(--…)` 在 `template.html` 的 `:root` 里真有定义）：
编出来的变量名会让浏览器把**整条 `color:` 声明**丢掉 —— 字色掉回继承色、接口 200，看起来
只是「这一块颜色没变」；硬编码色值同样拒（换肤那天它不跟着变，而那一块读起来完全正常）。
字号只收 **8–400 的整数 px**（前端拿 `getComputedStyle` 的 px 加减 —— 发 em/百分比的话它是
相对父级的，父级本来就大一号时「点大一点」会渲染得更小），字重只收 300–900 那几档。
**认不出的属性也一律 400**：静默忽略的话他点了按钮画面一点不变，看起来像按钮坏了，而接口回 200。

原来就有的 `style="…"` 属性是**改写**、不追加第二个 —— 追加的话浏览器只认第一个，
库里明明是新值而画面一点变化都没有；同一个属性里别的声明（`letter-spacing` 那些）留着。
只动 inline style，**不改那一页的 `<style>`**：改整份 CSS 的话一次「这行字大一点」会波及
每一页上同一个类。

### POST /api/ppt/decks/:id/edit-region-style `PROTECTED`
改**一整块（容器）自己**的对齐 —— 他「⤢ 选大一点」选到那个 `display:flex` 的块，点浮动条上
那三个键。不调 AI、不花额度，只写 `html` 这一列。

```json
{ "page": 3, "path": [1, 0], "eids": ["t7", "t8"], "style": { "alignItems": "center" } }
```

```json
{ "page": 3, "style": { "alignItems": "center" }, "region": "div",
  "prev": { "align-items": "flex-start" }, "html": "…", "previewHtml": "…" }
```

**`"alignItems": null` = 取消（把这一条 inline 声明删掉，回到这一页 `<style>` 里那个值）。**
写 `unset` / `initial` / `revert` / `normal` 一律 400 并指到 `null`：inline 的 `unset` 是**盖住**
版式那条、把它按成「拉满」，而版式里写的可能是 `center` —— 他点的是「取消」，得到的是第三种样子，
而页面照样渲染。**本来就没有这一条时也 400**（`没有 align-items …`）：删一个不存在的东西 html
一个字都不会变，而接口回 200 加一句「已存」，他看到的是「点了取消没反应」；真正的成因是这一块的
对齐来自这一页自己的 `<style>`。`prev` 回的是改之前那一条 inline 是什么 —— 界面要说出「取消掉的是
center」，不说的话那一整块变了样而他不知道该点回哪个键。

和 `edit-style` 的唯一区别是**定位**：容器没有 `data-eid`（eid 只给「只装着一段文字」的元素），
所以用**从 `<section>` 数下来的孩子下标路径**（同 `ai-edit` 的 `path`），再拿这一块里那串
`eids` **交叉核对**一遍（排序后逐字比，附上两边各是哪几个）—— 不核的话浏览器和库里差一层时
对齐写到了隔壁那一块上：页面照样渲染、接口 200，只是他点的那一块没动、另一块动了。

`alignItems` 只收 `flex-start` / `center` / `flex-end` / `stretch` / `baseline`，
`justifyContent` 只收 `flex-start` / `center` / `flex-end` / `space-between` / `space-around`，
**别的值和别的属性一律 400**：`align-items:left` 这种写法浏览器直接把整条声明丢掉 —— 接口 200、
库里写着新值，而画面一动不动。这一块**本身不是 flex/grid** 时前端就不发（那三个键 CSS 藏着，
硬点也只换回一句「这一块是 block 布局，align-items 在它身上浏览器根本不认」）——
放它过去的话同样是「存上了但一点没变」。

### GET /api/ppt/edit-palette `PROTECTED`
`{ "colors": ["var(--c-ink-deep)", …] }` —— 浮动条上那几个色块。前端**不自己写一份**：
两份一漂开，他点的那个颜色会被 `edit-style` 400 拒掉，而界面上那个色块看着完全正常。

### POST /api/ppt/decks/:id/ai-edit `PROTECTED`
让 AI 改**选中那一块**的结构和 inline style（「这三条排成两列」）。**一次真实调用、花 1 次额度**，
改完直接覆盖库里那一页（和 `edit-text` 同一条存法，只写 `html` 这一列）。

```json
{ "page": 3, "path": [0, 1], "eids": ["t7", "t8"], "instruction": "这三条排成两列" }
```

```json
{ "page": 3, "summary": "把三条并排成两列（原文 6 处一字未动，3 段文字仍可双击编辑）",
  "region": "div", "html": "…", "previewHtml": "…", "usage": { "total_tokens": 1820 } }
```

那一块用**从 `<section>` 数下来的孩子下标路径**定位（前端 `pathOf`），不是「几个 eid 的公共祖先」：
图和装饰条没有 eid，求公共祖先算出来的是他框住那一块**里面**的一层 —— 于是 AI 改的不是他框的
那一块，而摘要和画面都读得通。`eids` 是**交叉核对**用的：路径按浏览器那棵树数出来，服务端按
字符串扫出来，浏览器修正过结构（`<p>` 里的 `<div>` 会被挪出去）时两边差一层，那时一律 400
「你选中的那一块和库里那一页对不上」，**不花额度**。

**发出去那一段里一个中文都没有**：文字节点、整个 `<img>` 标签、带中文的属性值全换成 `@@T1@@`
`@@IMG1@@` `@@A1@@` 这种记号（`pageEdit.maskRegion`）。所以「不许改文案」不是 prompt 里那句话，
而是「输出里出现中文 = 它在自己编文案」这一条正则 —— 靠 prompt 拦的话模型会顺手把「及」改成
「和」、润色半句，出来是一页读起来完全正常的幻灯片而他写的那句变了。图的地址和
`data-img-prompt` 因此也不经过模型（硬规则 3）。打完码还剩中文（有一处文案在取不出来的属性里）
一律 400，不发出去。

回来那一段有**七条校验，任何一条不过就整段丢掉、一个字都不写库**（这次的钱已经花了，但存一段
错的要赔的是「他照着这一页做完整份」的时间）——每一条拦的都是「页面照样渲染、读起来完全正常」
的失败：不是一整块 / 换了最外层标签（定位类挂在原来那一层，这一块会跑到别的位置）、记号少了
或重复了（那句文案凭空消失 / 出现两遍）、`data-eid` 变了（那几段从此双击改不动，画面上一点异样
都没有）、出现中文、写了 `<script>`/`<style>`/`onclick`、用了这一页里没有的类名（那一块回到默认
流式布局，看起来像版式塌了）、写死 `#hex`/`rgb()` 或用了 `:root` 里没有的 `var(--x)`（浏览器把
整条声明丢掉，看起来只是「这一版配色淡了点」）。模型没按 JSON 回 / 被截断时报错走
`jsonFailMessage`（带思维链 token 数，硬规则 2）。

`summary` 里那两个数是**代码数出来的**，不是模型说的：模型说「保持了原有文案」这句话是免费的，
而那恰好是他要确认的事。`instruction` 上限 400 字（更长的其实是「重写这一页」，那个走重新生成
—— 那一步才带着版式和要点）。

### POST /api/ppt/decks/:id/images `PROTECTED`
给这份稿子第 `page` 页配图：按每个图元素的 `data-img-prompt` **逐张生图**（每张一次真实花费），
把占位图换成转存后的地址，换好的 html **覆盖库里那一页**。

```json
{ "page": 3, "force": false }
```

html 从库里取、**不收 body** —— 收的话前端内存里那份（可能是重新生成前的旧版）会被配上图再存
回去，那一页于是回退成上一版内容而图是新的，两边都不报错。

```json
{
  "html": "配好图的那一页",
  "previewHtml": "单页 deck（不带页脚）",
  "images": [
    { "index": 1, "prompt": "槽位那句 data-img-prompt", "mode": "concept", "ratio": "16:9 landscape", "url": "https://cos/…png", "storage": "cos | local", "model": "…" },
    { "index": 2, "prompt": "…", "mode": "data", "ratio": "1:1", "error": "上游原文（这一格还是占位图）" },
    { "index": 3, "prompt": "…", "mode": "concept", "ratio": "16:9", "skipped": true }
  ],
  "quotaExceeded": false,
  "provider": { "id": "…", "model": "…" },
  "style": { "id": "S-A", "name": "现代 SaaS 等距" },
  "problems": ["失败的那几格 / storage=local / 图位配不上…"]
}
```

逐张回 `url` / `error` / `skipped` 三种结局中的一种，`error` 带**上游原文**（模型名不对 /
余额不足 / 配的是视频模型 / 回了 200 但没有图，四种解法完全不同，合成一句「生图失败」
等于指错方向）。整页**只解析一次接入点**并 `providerId` 绑死它、只解析一次画风并按 id 绑死 ——
按 kind/档位解析会挑「最近更新的那条」，于是一页里的图出自两个模型，每张单看都不错、
翻下来笔触不统一，而没有一处报错。

**部分成功是常态**（一张失败别的照样贴上去），成功那几张**照样落库** —— 那是真花过钱的，
不存等于让他再花一遍。失败的那几格**保留占位图**，绝不写回坏地址：占位图明显是「还没配图」，
而坏地址在屏幕上和「这一格本来是空的」长得一样。已经不是占位图的槽位**默认跳过**
（重做一次是一次真实花费），`force: true` 才重做（前端那个「换一批图」）。

前端**必须用返回的 `html` 覆盖那一页存着的 html 并作废拼好的整份**：不覆盖的话拼整份用的还是
占位图那一版，而预览里刚刚明明看到图了。`problems` 里 `storage: "local"` 那条不能吞（COS 没配好，
落在 /uploads 下，换机器就 404，而生成那一刻预览里一切正常）。

**撞额度不是 429，是 200 带 `quotaExceeded: true`** 并在那一张上停下：已经生成的那几张
**不回滚**（钱花了，抛掉整个结果等于让他再花一遍），接着往下跑只会拿到一串一样的错误、
中间夹着刚才那几张的成功。前端要把它当成「额度用完了」显眼提示，而不是「有几张失败」。

400：这一页还没生成 HTML（先生成再配图）；503：专属渠道缺 `kind=image` 那一档
（配置问题，合成 500 的话他以为服务坏了，而真实解法是去后台补一条接入点）。

### POST /api/ppt/decks/:id/deck `PROTECTED`
把这份稿子已生成的那几页拼成整份 deck，**不调 AI、不花额度**。无 body。

`{ "html": "整份 deck（带页脚）", "pages": 12 }`

页**从库里读**、只按 `page` 排（批量生成是逐页回来的，照前端传来的数组顺序拼的话每一页都对、
章节全乱）。**缺一页就 400 并点名缺哪几页**：缺页的 deck 翻起来和完整的一模一样，只是内容跳了
一段，而页脚那个「/ 12」是按**规划总页数**由代码写的，连页码都看不出缺口。
整份**必须带页脚**（放映靠它翻页/看进度/跳目录），制作过程中的单页预览一律不带 ——
反了都不报错：单页预览里那条页脚压在画面底部 54px 上，挡掉的一行看起来像「这一页排版就是这样」。

**任何一页重新生成、或者重新规划之后，前端要把拼好的这份作废**：留着的话它翻起来完全正常，
只是那一页还是改之前的版本。

### POST /api/ppt/decks/:id/export `PROTECTED`
导出整份成一个 .html 文件（不调 AI，页同样从库里读，走同一个 `buildDeck`）。

```json
{ "baseUrl": "location.origin" }
```

```json
{ "filename": "AI转型-20260903.html", "html": "整份（图的地址已改成绝对地址）", "placeholders": 2, "warnings": ["…"] }
```

**回 JSON 让前端自己 Blob 下载，不回 attachment**：这份文件依赖什么必须显示在界面上 ——
还剩几格占位图（`placeholders`）、几张图落在 `/uploads`（换机器就 404）、字体走 Google Fonts
（取不到就掉回系统字体，字重字距变了像版面塌了）、导出地址是 localhost（发给别人打不开）。
这四样在导出那一刻的预览里全看不出来，用户是转给同事打开时才发现，而那时没有一处能说明成因。

图的相对地址**必须改成绝对地址**：`/ppt-cases/ph-*.svg` / `/uploads/x.png` 在 `file://` 下指向
磁盘根目录 —— 整份 deck 的图全是破图，而文字、版式、翻页全正常，看起来像「这份稿子设计上就
没配图」。`baseUrl` 由前端传 `location.origin`：服务端按 `req.protocol` 算的话反代后面拿到的是
http，混合内容被浏览器拦掉，那几格照样只是「没配图」。
文件名（主题 + 日期）已经洗掉路径分隔符（`a/b.html` 会让浏览器存到别处或者干脆不下载 =
那次点击什么都不发生，读起来像功能坏了），前端下载那几行的失败也要走错误横幅。
`baseUrl` **不是 `http(s)://host` 形状时 400**，不兜一个「看起来对」的值：兜了的话整份文件里
的图指向一个拼出来的假地址，而下载和打开都不报错 —— 只是每一格都是破图。
缺页照旧 400（同 `/deck`）。**任何一页改过之后「已导出 xxx.html」那句话要改口**，
留着的话他以为手上那个文件是最新的。

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
| /api/auth/login | 5 req/min |
| /api/auth/register | 3 req/min |
| /api/auth/* | 30 req/min |
| /api/ai/* | 30 req/min |
| /api/chat/* | 20 req/min |
| /api/consultant/* | 20 req/min |
| /api/analytics/* | 30 req/min |
| /api/ui-review/*、/api/tender/*、/api/xhs/*、/api/consult/*、/api/feishu-assistant/* | 60 req/min |
| /api/ppt/* | 300 req/min（案例库一页就是 22 个 iframe，60 的话翻两页就被 429 挡住，而卡片上照样挂着「效果 demo」） |

Headers: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`
