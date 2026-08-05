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
  "scopes": ["im:message", "task:task:write", "im:message.group_at_msg:readonly"],
  "directory_scopes": ["contact:user.base:readonly", "contact:department.base:readonly", "im:chat:readonly"],
  "events": ["im.message.receive_v1"],
  "default_supplement": "以下规则用于帮助助理听懂本企业的说话方式…"
}
```
`actions` 和 `scopes` 都是**从动作注册表生成的**（`ACTIONS` + `allRequiredScopes()`），
加一个动作不用改本接口，接入指引里的权限清单也会自动多一项。

`scopes` 里已经包含 `directory_scopes`（接入指引让用户一次配齐）；单独再列一份是因为
它们的性质不同：**不开也能用助理**，只是必须 @ 到人，私聊里按姓名找同事会失败。
前端据此把它们渲染成「可选，但强烈建议」而不是硬性前置条件。

`params` 的值是**给 LLM 看的自然语言说明**，不是 JSON Schema，前端原样展示。
带部门参数的动作（`send_message.departments` /
`create_calendar_event.attendee_departments`）收部门名，服务端查名册展开成人 ——
所以按部门群发依赖 `directory_scopes` 那一组权限，没同步过名册时用不了。

`default_supplement` 是**应用没填自己的补充规则时实际生效的那份**（skill slot
`feishu-intent`，migration 056 播的示例模板）。前端「填入示例模板」按钮读它 ——
客户端自己抄一份的话，平台改了模板之后按钮填出来的还是旧的，而用户以为那就是当前默认。

动作绝大多数是写操作。唯一**面向用户**的读动作是 `query_freebusy`（查某人什么时候有空，
权限点 `calendar:calendar.free_busy:read`）—— 忙闲是少数几个 tenant token 能读的东西，
因为它只回时间区间、不回日程内容。「列出我的任务」「今天有什么日程」这类要 user token，
本模块没有，也就不存在对应动作。

`update_task` / `update_calendar_event` / `delete_calendar_event` 会顺带读一点东西
（改时间前读原时长、删之前读原定时间），但那是**按 id 读一条已知的记录**，
而不是列举——id 只可能来自我们自己的执行日志，所以这几个动作只对**助理自己建过的**
任务/日程有效。用户在飞书里手动建的，助理既查不到也改不动，回帖会明说这一点
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
同步组织架构名册（私聊里按姓名找同事的前提）。**绑定成功后会自动跑一次**，
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

### PUT /api/feishu-assistant/apps/:id/intent-supplement `PROTECTED`
保存这个应用的「本企业补充规则」（migration 059）—— 让助理听懂本公司的术语、简称、
时间习惯。请求体 `{ text: string }`，响应是更新后的整行（同 `GET /apps` 的形状）。

- **空串是合法值**，语义是「回落到平台默认那份」，不是「忽略本次请求」。
- 上限 **4000 字**，超了 `400`。这段话每解析一条指令就随 prompt 发一次：
  太长会让每条指令都更慢更贵，而且会把后面的硬性规则（open_id 只许照抄、
  输出必须是 JSON）压下去 —— 表现是助理"忽然开始乱发消息"。
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
    "sender_name": "张三", "text": "明天下午三点开个评审会",
    "action": "create_calendar_event", "params": "{\"summary\":\"评审会\"}",
    "status": "done", "error": null, "error_detail": null,
    "result": "{\"summary\":\"📅 日程已创建…\"}",
    "duration_ms": 2840, "created_at": "...", "completed_at": "..."
  }],
  "total": 1
}
```

一句话里说了两件事时（「给他们发消息，并建个日程」），`action` 是
`"send_message + create_calendar_event"`，`params` 存的是步骤数组；一步时和以前逐字节相同。
`result` 里 `summary` 是**做成了的那几步**的回复拼起来（前端详情页直接读它），
`steps[]` 逐步给 `action` + `summary` + 该动作自己的 `data`：
```json
{
  "summary": "已通知 12 人（销赞云事业部 等 12 人）：周五九点半开会\n📅 日程已创建…",
  "steps": [
    { "action": "send_message", "summary": "已通知 12 人…", "sent": [{ "open_id": "ou_x", "name": "张三" }], "failed": [] },
    { "action": "create_calendar_event", "summary": "📅 日程已创建…", "event_id": "..." }
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
