# QiaoNan Platform (mmPla)

## Project Overview

A multi-module platform with independent sub-apps aggregated under a single navigation page. Each module is independently functional but shares a unified auth system and AI gateway.

## 协作方式（优先级高于本文件其余部分）

作者是唯一的测试者，独立开发。这里的规则是为了让他**每 15 分钟就有东西可点**，
而不是一小时后收到 8000 行改动。历史提交曾经单次 16192 行插入 —— 那不是高效，
那是把该分十次交付的活压成一次，中间他什么都测不了，出问题也无法二分定位。

### 切片交付

- **一次只做一个能单独验证的切片，目标 15 分钟。** 判据不是行数，是「他现在能打开哪个
  页面 / 在群里发哪句话，看到什么变化」。说不出这句话的，就不是一个切片。
- **做完就停，报告怎么测，等他确认。** 不要自动接着做下一片。他确认后才继续。
- **超过 3 个文件要新建、或需要新 migration + 新 action + 新页面同时落地，先说切法再动手。**
  给 2-4 条的顺序清单，第一条必须是能独立验证的。不要写完整设计方案。
- **切片顺序按「能不能被看见」排，不按依赖漂亮度排。** 后端 service 写完但没有入口 =
  零个可测切片。宁可先接一个粗糙的按钮/命令，再回头补内部结构。
- 探索性任务（读代码、查坑、定位 bug）不受 15 分钟约束 —— 那本来就没有可交付物，
  直接给结论。

### 测试

只写一种测试：**出错时会伪装成成功的路径。**

判据是「这个 bug 发生时，他在界面/群里看到的是不是一句正常的成功回复」。是 → 写测试。
本文件下面记的坑几乎全是这类：派给错的人、改了别人的任务却回「已完成」、
总结了错的日期窗口却回「本周（08-03 至 08-09）」、两人同时 @ 时静默丢一条、
allowlist 拒绝时完全不出声。这些手测测不出来，所以必须有测试。

**默认不写测试**的：CRUD 增删改查、参数校验、UI 渲染、happy path、
「调了 A 就会调 B」这种 mock 转述、错误路径中会明确报错给用户的那些（他手测就看到了）。

写法约束：

- 一个行为一个 `it`，断言那个会骗人的**结果**（回复文案 / 落库的那一行 / 传给
  Feishu 的那个 open_id），不是中间调用次数。
- **不铺场景矩阵。** 同一条逻辑不要「有值/空值/超长/特殊字符」排四遍 —— 挑最容易
  出错的一个。
- 单个测试文件超过 300 行就停下来问，是不是在测不该测的东西。
  现有的 `diary.test.ts`(2316) / `dispatcher.test.ts`(897) 是历史包袱，
  **不要照着它们的密度写新测试**，改动它们时只删不加。
- 全量测试 33 秒（`cd server && npx vitest run`），跑之前先 `nvm use 21.7.3`。
  改完跑一次全量，别为单个功能反复跑。

### 文档

- **不新建设计文档。** 新增能力写成 CLAUDE.md 里的一条 bullet：**这个决定是什么 +
  改错了会怎样静默出错**。可从代码或 git log 读出来的事实不要写。
- `docs/` 下已有的长文档（FEISHU_ASSISTANT 1012 行 / FEISHU_DIARY 937 行 /
  MODULE_DEVELOPMENT 732 行）**只在行为变了导致它说谎时才改**，不做例行同步。
- 不写变更日志、不写实现总结、不写 PR 描述式的收尾文档。完成情况在回复里说。
- 例外：`docs/API.md` 的新端点要补 —— 前端要照它调。

### 回复

改完直接报「做了什么 / 你现在测什么 / 有什么没做」，三句话量级。不复述代码，
不列文件清单，不写小结章节。不问要不要 commit —— 他自己提交。

## Quick Start

```bash
# Install dependencies
cd server && npm install
cd ../client && npm install
cd ..

# Run both (from root)
npm run dev
# Or separately:
# cd server && npm run dev
# cd client && npm run dev
```

Server runs on `http://localhost:3001`, Client on `http://localhost:5173`.

Default admin credentials: `admin / 123456` (change after first login).

## Architecture

```
├── client/                   # Vue 3 + Vite frontend
│   └── src/
│       ├── components/       # UI components by module (fish/, board/, common/)
│       ├── lib/              # Shared utilities (api.ts, auth.ts, quota.ts)
│       ├── views/            # Pages by module
│       └── router/           # Route definitions
├── server/                   # Express + TypeScript backend
│   └── src/
│       ├── api/              # Route handlers (thin: validate → call service → respond)
│       ├── auth/             # Middleware, guards, rate limiting, scopes
│       ├── core/llm/         # AI gateway (THE entry point for all LLM calls)
│       ├── db/               # Database init + migration system
│       └── services/         # Business logic
├── skills/                   # AI skill definitions (markdown prompts)
├── workspaces/               # User workspace files
└── docs/                     # Architecture & API documentation
```

## Key Conventions

### Backend

- **ESM modules** — all imports use `.js` extension
- **Express routers** — one file per module in `server/src/api/`
- **AI calls MUST go through `server/src/core/llm/gateway.ts`** — never instantiate OpenAI client directly
- **Database** — SQLite via `better-sqlite3`. Schema evolution via migration files in `server/src/db/migrations/`
- **Auth** — three-tier: PUBLIC / OPTIONAL / PROTECTED (configured in `auth/middleware.ts`)

### Frontend

- **Vue 3 Composition API** — `<script setup lang="ts">`
- **API calls** — always use `client/src/lib/api.ts` (auto-attaches auth token, handles 429 quota errors)
- **Route guards** — `meta.requiresAuth` for login-required, `meta.requiresAI` for AI-feature pages, `meta.requiresAdmin` for admin

### Database Migrations

Adding a new migration:
1. Create `server/src/db/migrations/NNN_description.ts`
2. Export a `Migration` object with `id` and `up(db)` function
3. Register in `server/src/db/migrations/index.ts`
4. The migration runs automatically on next server start

### Adding a New Module

1. **Backend**: Create `server/src/api/yourModule.ts` with an Express Router
2. **Register** in `server/src/app.ts`
3. **AI calls**: Use `aiGateway()` or `aiGatewayStream()` from gateway
4. **Frontend**: Create views under `client/src/views/yourModule/`
5. **Router**: Add route in `client/src/router/index.ts` with appropriate `meta` flags
6. **Home**: Add navigation card in `client/src/views/Home.vue`

## Auth Model

| Level | Behavior |
|-------|----------|
| PUBLIC | No auth needed |
| OPTIONAL | Token parsed if present, not required |
| PROTECTED | 401 if no valid token |

All AI-calling endpoints are PROTECTED. Users must log in to use AI features.

## AI Quota System

- Each user gets 10 free AI calls per day (configurable per-user by admin)
- Anonymous visitors get 3/day, isolated per IP+UA fingerprint (`auth/requester.ts`)
- Platform key is set by admin in Admin > System Config
- Quota resets daily at midnight (server time)
- HTTP 429 returned when quota exceeded
- Users on a **dedicated AI channel** bypass quota entirely (they burn their own key)

## AI Model Resolution

All text calls resolve a provider from the `ai_providers` table via
`resolveLLMProvider(tier, userId)`. Two mutually exclusive paths:

**Platform channel** (default) — `owner_user_id IS NULL` rows:
requested `tier` → `default` tier → legacy `system_config.platform_*` keys.

**Dedicated channel** — set per user by an admin in Admin > User Management > 专属 AI.
When `user.use_dedicated_ai = 1`, only that user's own providers are used;
**there is no fallback to the platform**. A missing tier throws
`DedicatedChannelError` (HTTP 503) rather than silently spending the platform key.
Dedicated channels must have all three tiers configured (`default`/`strong`/`fast`) —
the admin API refuses to enable the switch until they do.

Tier usage: `strong` = structured/JSON tasks (xhs structure/validate/diagnose,
tender profile, feishu intent parsing — all require `response_format: json_object`),
`fast` = bulk prose, `default` = everything else (chat, consultant, ui-review, fish).

`ai_logs.provider_id` / `provider_owner` record which key paid for each call.

## Feishu Assistant (飞书助理)

Users bind a Feishu **self-built app**; the server opens an outbound **websocket
long connection** to Feishu and handles `@`-mentions as natural-language commands.
See `docs/FEISHU_ASSISTANT.md` for the full design and `docs/FEISHU_DIARY.md` for
项目日记, its main use. The load-bearing facts:

- **It is a project-group assistant, not a general Feishu bot.** Scope: one project
  per group, a log table + a review table per project, one company-wide project index,
  plus Feishu tasks. Five actions were **deleted outright** (create/update/delete
  calendar event, freebusy query, DM a colleague) — not for being unpopular, but
  because each cost twice: the action list goes into the prompt **verbatim**, so every
  semantically-adjacent action adds a mis-selection surface (「给张三派个任务，明天开始」
  used to split into task + calendar event when the user wanted one task); and their
  scopes (`calendar:calendar.event:*`, `calendar:calendar.free_busy:read`) are the
  hardest part of onboarding, so requiring them for capability nobody uses lengthens
  the step most likely to fail. Don't re-add them without a concrete need.

- **Long connection, not webhook** — `lark.createLarkChannel({transport:'websocket'})`
  in `services/feishuAssistant/connection.ts`. No public callback URL, no signature
  verification, no AES decryption, no URL-verification challenge. The module has
  **zero public routes**. Requires single-instance deployment (long connection is
  competing-consumption across a cluster), which matches `core/jobs.ts`'s assumption.
- **The 3-second rule** — Feishu times out events at 3s and retries on success too
  (at-least-once). `dispatcher.handleMessage()` therefore only dedups + logs
  synchronously, then fires `void execute(...)` and returns. Reply comes later.
  Because that promise is detached, nothing bounds concurrency: `concurrency.ts`
  gates **intent parsing only** (4 concurrent / 20 queued → `TooBusyError`).
  The gate's promise 「本次没有执行任何操作」 is only true at that position —
  moving it around `execute` makes the message a lie.
- **`safety.batch.text.delayMs = 0` is load-bearing.** LarkChannel's default merges
  same-chat messages within 600ms and keeps only the *last* message's metadata, so
  two people @-ing at once means one command silently vanishes (never `claimEvent`ed,
  no log row, reply threaded to the wrong message).
- **Anything dropped must be said out loud.** Steps past `MAX_STEPS` are reported via
  the required `ParsedIntent.droppedSteps` field; allow-list rejections increment
  `feishu_chats.reject_count` (the bot stays silent in unlisted groups, so this
  counter is the only way a user learns why nothing happened); zombie `pending`/
  `running` rows are reaped at startup. A silent drop reads as success.
- **Clarification carries exactly one turn back** (`findPriorClarification`), gated on
  same chat + same speaker + ≤10 min + previous action was `reply`. That last gate is
  the important one: carrying context past a *write* action lets 「再发一条」 replay a send.
- **Dedup on `message_id`, not `event_id`**, via `feishu_events` PK collision
  (`commandLog.claimEvent`). LarkChannel's own dedup is in-memory and dies on
  restart while Feishu retries for up to 6 hours, so the DB is authoritative.
- **Group chats only.** `dispatcher.handleMessage` rejects `chatType !== 'group'`
  before anything else (returns `'p2p_rejected'`). DMs had **no gate at all** — the
  allowlist is group-only, so anyone in the tenant could burn the bound account's AI
  quota invisibly (DMs aren't in `feishu_chats` either). And a DM can do strictly less
  than a group message while failing in more ways (no project to bind, no `@` to
  resolve people from). `policy.dmMode` stays **`'open'`** even so: the SDK's
  `'disabled'` drops DMs *silently*, and silence reads as 「助理坏了」. Messages are
  received and refused with 「请到群里 @ 我」 — before intent parsing, so no quota is
  spent. Still goes through `claimEvent` (Feishu retries would otherwise deliver five
  identical refusals). Unlike the allowlist path, which stays silent on purpose
  (replying would expose the bot to any group) and only bumps `reject_count`.
- **Adding a Feishu feature** = one file in `services/feishuAssistant/actions/`
  exporting an `ActionDef` + one entry in `actions/index.ts`. The LLM prompt, the
  permission checklist in the UI, **and** the 「我目前会…」 list in
  `dispatcher.ts:fallbackReply()` are all generated from the registry
  (`ActionDef.hint` → `capabilityHints()`). `hint` is **required** for exactly this
  reason: that list used to be hand-written prose, and after the five deletions it was
  still advertising 建日程/发消息 — a reply that says 「我不会这个，但我会建日程」 to a
  request to create an event, with no test failing. What still restates capabilities in
  prose and therefore still goes stale: `intent.ts`'s `diaryHint()`, the
  `<ul class="caveats">` in `views/feishu/FeishuHome.vue`, and the docs.
- **`ACTIONS` order is behavior, not formatting.** It goes into the prompt verbatim and
  the model reads top-down, taking the first action that fits. So: keep create next to
  its update/delete, *and* keep semantically-confusable groups apart with the more
  commonly wanted one first. The diary block used to sit last (9-12) with `create_task`
  at 3, so 「添加新项目，X」 selected `create_task` and replied 「✅ 任务已创建」 — the
  worst kind of failure, one that looks like success. Order alone isn't enough: it
  changes *which is seen first*, never *why it isn't the other one*. That's
  `intent.ts`'s `PROJECT_VS_TASK_RULE` plus the exclusion written into `create_task` /
  `update_task`'s **own** descriptions — it has to live on the mis-selected action,
  since by the time the model reads it, `create_diary_project`'s text is far above.
  Both halves are required; `intent.test.ts` 「「项目」和「任务」不能串味」 guards them.
- **The intent prompt is generated, not authored.** The 本企业的补充规则 section only
  **appends** company jargon and time habits. The action list, JSON format, and
  open_id constraint stay in code — each fails silently if edited away (unselectable
  action / `null` intent / message to the wrong person). The priority disclaimer
  (last hard rule) appears and disappears together with the supplement block.
- **That supplement is per-app (`feishu_apps.intent_supplement`, migration 059), not
  per-platform.** `prompt_skill_bindings`'s PK is `slot` alone, so the skill slot is
  one copy for the whole platform — with several companies on one deployment, A's
  jargon lands in B's prompt. The app column wins; the slot (seeded by 056) is the
  **fallback, not a base layer** — 056 is an illustrative template whose invented
  jargon must not be taken as real. Users edit it at /feishu > 助理规则.
  It has its **own** `PUT /apps/:id/intent-supplement` because `POST /apps` is
  whole-row replace and several frontend callers pass partial fields (enable/disable,
  one-click allow a chat) — hanging it there blanks the user's text days before
  anyone notices ("the assistant suddenly stopped understanding us"). 4000-char cap:
  the text ships with every single command, and a long one pushes the hard rules down.
- **Nor does it emit `guid` / `record_id` — same rule, same reason.** `update_task`
  resolves "which one" by reverse-lookup,三条路按这个顺序：**任务管理表（070）→
  `feishu_project_tasks`（068）→ 执行日志**（`feishu_commands.result` 经
  `commandLog.findRecentActionResults` → `actions/recent.ts:findRecentTarget`，
  scoped to app + speaker, 7 days, 50 rows）。表排在最前面是因为它是开放编辑的、
  而且 `list_tasks` 只读它 —— 用户在表里把标题改成「Q3 报告」之后，只按库反查会
  回一句「我只能改我自己帮你建的那些」，而那一行就在他打开的表里。走表这条路时
  guid 从「飞书任务」那格链接的 query 参数里取（`taskBase.guidFromUrl`，取不到的行
  直接不作为候选 —— 空 guid 去 patch 只会撞一句飞书原文），行号直接用 `record_id`
  写回（`writeTaskRow`，不再按「助理标记」查一次：那一列用户也能改），库里那行
  按标记回查后一并更新（按标题回查会静默漏掉库和甘特图两处）。**表这条路也要筛
  「我负责的 或 我派出去的」**，和库那条一个口径：整个群都看得见这张表，不筛的话
  「周报做完了」会撞上同名的、别人那一行，改掉它再回一句「✅ 已标记完成」。
  「我派出去的」现在只能靠库里那行的 `created_by` 认 —— 库那份砍掉之前，表里得先
  有一列记下派活人，否则派活人从此改不动自己派的活。表**读失败**时退回库那条路，
  但最终那句「找不到」里必须带上「任务管理表这次没读出来」：不说的话用户会照着
  「我只能改我自己帮你建的那些」去手动改，而真实原因是权限掉了/接口挂了。
  A fabricated guid mostly 404s, but *if it hits* the assistant modified someone
  else's task and replied 「已完成」. Ambiguity is **always** refused with the
  candidates listed — including the no-keyword case, where it deliberately does
  **not** fall back to the most recent (「那个任务」 means the one they had in mind).
  Consequences that must stay visible: the not-found wording is
  「**我只能改我自己帮你建的那些**」 (not 「没找到」 — `task.list` returns only the
  calling identity's items, so a user-created task is silently *absent*, and
  「没找到」 sends them off re-phrasing forever); and the `actions` list must include the
  update action itself (a renamed item is called by its **new** name, which only
  exists on the update row). The `deletedBy` tombstone param was removed along with the
  delete actions (an unused param reads as "this is handled"), so **deleted things now
  stay in the candidate pool** — any future delete action must restore it, because every
  failure on that path looks like success: a dead id gets patched, or 「再删一次」 really
  runs a second deletion while the reply says 「已删除」.
  Keyword matching normalizes away **all** whitespace on both sides (`recent.ts:norm`) —
  Chinese spacing is optional, so 「xzy8 月飞书 skill 开发」 vs 「xzy8月飞书skill开发」
  is the same thing to the user, and a raw `includes` produced a self-contradicting
  reply that listed the very item it claimed not to find. Whitespace only — widening it
  to fuzzy matching reintroduces the "modified the wrong one, replied 已完成" failure.
- **Computed formats are built in code, not by the LLM** — review time windows are a
  7-value enum the model picks from, and `diary/range.ts` turns it into the actual
  window (`localDate` / `wallToMs`, Asia/Shanghai, Monday-first). Same shape as the id
  rule: the model never emits a format it can silently get wrong, because a wrong
  window doesn't error — it summarizes the wrong days while the reply says
  「本周（08-03 至 08-09）」. An unrecognized range degrades to `today` **and says so**.
- **`update_task` spans four endpoints** (`patch` / `addMembers` / `addReminders` /
  `comment.create` — the last takes the guid in `data.resource_id`, not a path
  param), so partial success is unavoidable: do everything possible, then say which
  parts landed. `patch`'s `update_fields` is strictly paired with the values —
  a field named but not supplied is **cleared**. A task needs a `due` before a reminder
  can exist, and supports only one (`relative_fire_minute`).
- **A task lives in three places, and `list_tasks` reads exactly one of them.**
  Native Feishu task + `feishu_project_tasks` + 任务管理表（070）。
  读回只走 070 那张（`taskBase.queryTasks`），所以任何写路径
  漏掉它都是假成功：`update_task` 一度只写前两处，于是「把 X 标记完成」回
  「✅ 已标记完成」，紧接着「还有什么没做完」照样列出 X，两句都不报错。定位那一行
  只能靠建它时写进「助理标记」列的 `<message_id>#<step_index>`（标题会被改），
  找不到行时**必须说出来**而不是静默返回成功。完成/重新打开还要一并写/清
  「实际完成日期」—— 只改进展会让那两列互相矛盾。
- **任务管理表的结构是「下次派活时补建」出来的**（迁移里不能调飞书接口 ——
  一次网络抖动会让服务起不来）。所以 `taskBase.upgradeTaskBase` 会被反复执行，
  幂等只靠两个存下来的值：列看 `task_field_map` 里有没有那个键（**不是**看表里有没有
  那一列 —— 用户手动删掉的列会被无限重建），甘特视图看 `task_gantt_view_id`（072）
  是否为空。少任何一半，每次派活都多建一个同名视图 / 多加一列，而每次都成功、
  回帖里看不出异常。公式列（是否延期）故意不补：它缺失就是当初公式被拒过，
  补也补不上，只会每次派活挂一句永远不会好的 warning。甘特图用哪两列当起止是飞书
  自己认的（表里有三个日期列，接口指定不了），所以建完必须提示用户扫一眼 ——
  认错了不报错，只是横条画在别的区间上。
- **补出来的列对老行是空的，所以「飞书任务」这一列要回填一次**（073 的
  `task_url_backfilled`，同样挂在下次派活上）。这一列是库里那份任务砍掉之后
  **唯一**还能定位到飞书任务的东西（guid 藏在 applink 里），老行不补的话那些任务
  从此只剩一个标题、点不进飞书也改不动，而没有任何一处会报错。对齐只认「助理标记」
  （`<message_id>#<step_index>`）：按标题对齐会把链接贴到另一个任务上，那一格看着
  完全正常，点进去是别人的活。已经有值的格子不覆盖（用户手填的比库里那份新）。
  失败**不置位**（下次再试），所以置位只能在真写成之后；提前置位 = 那批链接永远是空的。
- **老「任务」表（068，日记 base 里那张带甘特图的 tab）已经删掉了**（074）。任务只剩
  任务管理表那一份，`create_task` 写不进它就**整条抛错**：以前那是个 warning，因为库里
  还有一份；现在回一句「✅ 已创建」而表里没有那行，下一句「还有什么没做完」就不提它，
  两句都不报错。抛错的话飞书任务**已经建出来了**，所以话术必须带上链接并明说
  **「别重说一遍」**（`client_token` 按 message_id 算，新消息就是新 token，挡不住）。
  库里 `feishu_project_tasks` 那份从此只用于两件事：判「这活是我派出去的」（`update_task`
  的授权）和统计未同步数 —— 后者靠 `appendTaskRow` 之后那次 `markTaskSynced`，
  不置位的话后台会永远显示一个不存在的缺口。
- **删老表之前必须先把老任务搬进任务管理表**（`taskBase.importLegacyTasks`，
  返回 `ok` 才允许 `bitable.dropTaskTable`）。070 之前派的活只存在于库和老表里，
  而 `list_tasks` 只读任务管理表 —— 老表一删，那些任务在飞书里就只剩各人任务中心那一条，
  「还有什么没做完」从此漏掉它们，一句错都不报。搬不完（查重列读不到 / 表超过扫描上限 /
  写到一半失败）就**不删**，下次派活接着搬；查重和写入共用「助理标记」那一列，
  没有它就整个放弃（否则每次派活把同一批老任务再写一遍，而每次都成功）。
- **三张表之间的互跳入口是「一张表」，不是文档里的一句话**（074，`diary/crossLinks.ts`）。
  多维表格没有「插一句话」这种能力，所以两个 base 各建一张一行的「🔗 相关链接」表
  （tab 栏上看得见），项目总表多一列「任务表」。做这件事的原因是两个 base 都不在任何人的
  云文档空间里（建表没传 folder_token）且链接分享是关的 —— 群消息一刷走，用户手上有哪张
  表就只剩哪张。幂等全靠库里存的四个值：`link_table_id` / `task_link_table_id` /
  `task_col_added` / `task_col_backfilled`，**不去飞书看现状**（用户手动删掉那张表之后，
  看现状的写法会他删一次我们建一次，而每次都成功）。表建出来了但那一行没写进去也要存
  table_id，否则下次派活又多一张同名表。`ensureIndexTaskColumn` 是唯一的例外（会 list
  一次列）：飞书拒同名列，不看一眼就会每次派活挂一句永远不会好的 warning。
  回填**无论成败都置位**并在 warning 里点名失败的项目 —— 一个永久失效的 record_id
  会让这段每次派活重跑，而用户手填一次就解决了。补列必须在 `addToIndex` **之前**：
  老总表没这一列，而 `record.create` 遇到不认识的列名是**整行失败** ——
  新项目压根没进总表，回帖里只有一句「总表这次没更新」。
- **The LLM emits names, never open_ids.** The prompt contains no `ou_xxx` at all
  (there's a test asserting `/ou_[a-z0-9]{4,}/` never appears in it), and actions take
  `create_task.assignee` / `update_task.followers` as **names**.
  `actions/people.ts:resolvePerson()` is
  the only place a name becomes an open_id, from two code-controlled sources:
  the event's `mentions[]`, then the local directory. Resolution failure throws —
  it never picks one of several matches and never falls back to the speaker
  (a task silently created on yourself looks like success).
- **Chat registry (migration 058)** — `feishu_chats`, keyed by `app_id`. Exists because
  `oc_xxx` is invisible in the Feishu client, which made the allow-list unconfigurable
  in practice. `GET /apps/:id/chats` computes `in_allowlist` **server-side** (empty
  list = all allowed); don't reimplement that rule per page — the wrong answer reads
  as "protected". The edit form must also list already-configured ids the registry
  hasn't seen, or saving silently drops them.
- **Org directory (migration 057)** — `feishu_directory_users` / `_departments`, keyed
  by `app_id`. Synced once automatically after binding, refreshable from the 组织架构
  page. This is what makes 「派给张三一个任务」 work for people the speaker didn't `@`
  (including people not in this group) — `mentions[]` only covers who was `@`-ed.
  Two sources: `contact/v3` department-tree BFS (full company), falling back to
  `im.chat.list` + `chatMembers.get` (zero contact scopes, group members only).
  **Downgrade only on Feishu code 99991672** — degrading on a network error hands the
  user a partial roster that looks complete. A failed sync never wipes the old roster.
- **Task `due.timestamp` is in milliseconds** (a Feishu quirk — most of their time
  fields are seconds). Use `actions/time.ts` helpers, never raw arithmetic.
- **项目日记 (migration 066)** — `feishu_diary_indexes` / `_projects` / `_records` /
  `_summaries`, keyed by `app_id` like 057/058. One project per group
  (`(app_id, chat_id)` unique) and no duplicate names (`(app_id, name)` unique) — the
  two indexes map to two different refusal messages. `(app_id, message_id, step_index)`
  on records is the whole of replay idempotency. **DB first, bitable second**: the table
  is a mirror, sync is append-only, and a failed push only adds a warning to the reply
  (a failed command would make the user repeat it, ending with two rows). Backfill rides
  the *next* record — there is no cron — so `unsynced_count` must stay visible in the UI
  or the gap is undiagnosable. Web routes are **read-only** for the same reason: a web
  delete can't be un-pushed. Note `db/index.ts` doesn't set `PRAGMA foreign_keys`, so
  cascade declarations don't fire — `appStore.deleteApp` clears these tables by hand.
- **AI quota** is charged to `feishu_apps.user_id` (the platform account that bound
  the app), so the dedicated-channel mechanism above applies unchanged. The person
  speaking in Feishu needs no platform account. Note 复盘 costs **two** calls
  (parse + summarize) while everything else costs one, and it deliberately spends the
  second one only when the range actually has records.

## 标讯多维表格的可见范围

- **标讯表是「企业内获得链接的人可阅读」，日记表是「关闭分享」—— 两个模块故意不同。**
  `feishuBitable.ts:setTenantReadable` 发 `link_share_entity: 'tenant_readable'`；
  diary 的 `closeLinkShare` 发 `'closed'`。标讯表要在应用所属企业内全员可见（推送
  卡片发到群里，换个人或转给同事都该能直接打开），所以 `grantPermission` 不再是
  「能不能打开」的前提，只用来给编辑权。改回 `closed` 的后果不是报错，是企业内的人
  点卡片按钮全是「无权限访问」，而后台显示「✅ 已处理」。
- **`external_access` 是布尔，不是 `external_access_entity`。** `/drive/v1/permissions/
  :token/public` 是 v1 端点，v2 才用那个枚举。传错的字段被**静默忽略**且接口照样
  返回 `code=0` —— 于是「已设置」是真的，「不能转发到组织外」是假的，表里的预算/
  评分/AI 策略可以被转出公司。`bitableShare.test.ts` 断言请求体守这一条。
  同一个坑在 diary 的 `bitable.ts` / `taskBase.ts` 注释里也记着。
- 凭据只有一份：`tender_user_preferences.feishu_app_id/secret`（migration 045/050），
  建表、写记录、群推送共用它和同一份 token 缓存，没有任何写死的 app_id。

## 标讯手动推送与清空重灌

- **「现在该让用户看到哪些标讯」只定义在 `candidates.ts`。** 三个消费者：预览数、
  卡片条目、清空重灌的内容。三者不同源时的失败全是无声的 —— 卡片标题写 28 条、
  点按钮进表里只有 12 行；或者预览说 0 条不给推而表里一堆。它**不看**
  `bitable_synced_at` / `tender_bitable_sync`（那两个是「增量推到哪了」，
  和「现在该看到什么」无关；拿它当条件的话同步过一次之后手动推送永远是空的）。
  计数带着和取数**同一个 limit**：截断了却显示总数，用户以为漏推了一批。
- **手动推送 = 清空重灌 + 发卡片，顺序不能反，重灌失败就不发卡片。**
  写入路径是 append-only，一行写进去就再也不会变，而 `aiExtractService` 事后才补
  截止日期/预算、`status` 事后才变 scored —— 所以不重灌的话用户点开永远看到
  「待处理」和空的截止日期。重灌中途失败时表是**空的**，这时候照样发卡片，用户点
  按钮看到空表会以为数据丢了；群里没消息是看得见的，所以宁可不发
  （`pushService.ts:runManualPush`，`pushService.test.ts` 守这一条）。
- **清空重灌必须先把「跟进状态」读出来再写回去。** 那一列我们只建不写，是用户在
  飞书里自己点的 —— 整条链路当初做成 append-only 就是为了它（`toFields` 压根不写
  这一列）。改成重灌就得自己接住：不保的话用户的标记每次清零，而后台报「✅ 已重建」。
  `snapshotTable` 一趟同时取 record_id 和这一列，不分两趟：分两趟之间表可能被改过，
  读到的标记对应的行已经不是要删的那些。
- **重灌成功后状态位要对齐表里的内容**（先全清再按重灌进去的那批置位）。不重置的
  后果两个方向都有：留着「已同步」的行若已不在表里，增量同步再也不会补它；
  而 NULL 的行若其实在表里，下次增量同步会再追加一遍。
- **评分流程不发卡片，手动按钮是唯一入口。** 自动推送发的是「本轮新评出来的」，
  而那一刻行里的截止日期/预算/status 还没被 `aiExtractService` 补上 —— 卡片说的和
  用户点进去看到的不是一回事，且 append-only 意味着那行以后也不会变。评分里保留的是
  **增量同步**（表里有数据是随时能自己打开看的前提），去掉的只有推送。日志最后一行
  必须写「不再自动推送」：以前评分日志是以「📮 已推送 N 条」收尾的，不说的话管理员
  会等一条永远不会来的群消息，而日志显示「全部完成」。
- **`feishu_enabled` 列已无人读**（migration 035 建的，列留着）。它管的就是那次自动
  推送，所以自动推送去掉后 GET/PUT 都不再回显和写它，前端那个开关也删了 ——
  留着比删掉更糟：管理员关掉它以为不会再推，而按钮照样能推。
- **`tender_user_preferences.feishu_chat_id` 存的是逗号分隔的多个群 ID**（没有额外
  状态要存，不值得开表），所以每个读它的地方都必须过 `feishuNotify.parseChatIds`
  —— 整列当一个 chat_id 用的话飞书只回一句 230002「群不存在」，管理员盯着自己刚
  复制的两个 id 只会以为是复制错了。中英文逗号/分号/换行都当分隔符（手拼时这三种
  都很自然，只认半角的话另两种会静默变成一个怪 id）。前端 `TenderManagement.vue`
  里有一份同规则的拆分，改了这个正则要一起改，否则复选框显示没勾却照样推过去了。
- **多群推送逐群报成败，不合成一个 `ok`。** 部分成功是常态（最常见是机器人没被拉进
  某个群，230013）：合成成功会把那个群的失败吃掉（那群人从此收不到推送，后台一直
  显示 ✅），合成失败会让管理员重推（另外几个群于是收到两条一样的卡片）。
  `pushToChats` 返回 `ChatPushResult[]`，`ManualPushResult.ok` 的含义只是「至少推成
  一个群」，`chats` 才是真相，调用方必须逐条显示 —— 手动推送、测试消息、评分流程
  里的自动推送三处都得报。串行发不 `Promise.all`：同一应用并发发消息撞频控 230020。
- **群列表（`listBotChats`）是可选增强，拿不到必须退回手填。** `GET /im/v1/chats`
  要 `im:chat:readonly`，它**不在**推送必需权限里，所以那个接口永远返回 200 带
  `{available:false, reason}`，报 4xx 会让没开这个权限的用户连群都配不了。手填输入框
  也永远可见：机器人被移出群之后它就不在列表里了，只有输入框能看到「配了但列表里没有」
  的那些 id（前端把它们单独警告出来，否则那个群会稳定失败而没人知道）。

## 标讯的时效闸门（14 天，两个日期都算）

- **`retention.ts` 只在读的时候过滤，从不删行。** 爬虫的去重集合就是 `tenders` 表
  本身（`content_hash`），删了行等于让同一条标讯明天再抓一遍、再评一次分；
  `recommendService` 还要 JOIN 回来读用户反馈，`ai_reason` 也是花了 token 的。
- **`created_at` 和 `publish_date` 必须同时在窗口内，少一个都会漏一类。**
  只看入库时间：gdgpo 真有 `publish_date=2024-12-05` 的历史公告，今天抓进来就以
  「新标讯」身份挂满 14 天，还要花 token 评分；只看发布日期：很久以前入库、发布日期
  写成今天的行永远不过期。两类都不报错，只是列表里多出用户不想看的东西。
- **`created_at` 故意不容忍空值，`publish_date` 必须容忍。** 后者是爬虫写的
  `item.releaseTime || ''`，平台漏给时间就是空串，而 SQLite 里 `'' >= date(...)`
  为 false —— 不显式兜的话新抓的标讯会被判成过期，静默地不进列表、不评分、不推送。
  前者始终由代码写 `new Date().toISOString()`，容忍它等于开一个绕过闸门的后门。
- **`expiredSql` 是对整个表达式取 `NOT`，不是把每个条件分别取反。** 分别取反会让
  「入库很久 + 发布日期是今天」这类行两边都不落，后台的「已超期 N 条」于是比实际少，
  读起来像口径问题而不是漏了一批。`retention.test.ts` 用真 sqlite 断言两者互补。
- **`visibleSql(alias)` 收的是表别名不是列名**（各处查询都是 `FROM tenders t`）。
  传错不报错，只是 SQL 里少了一半条件。
- **后台列表也过闸门，并且要显示挡掉了多少条。** 只挡用户侧的话，后台看到 3000 条、
  用户侧 200 条，两边都写「全部标讯」，谁都不会想到是两套过滤条件；而后台突然从
  3000 变 200 又会读成数据丢了，所以 `/admin/tenders` 回 `hiddenExpired` +
  `visibleDays`，前端必须显示出来。列表按 `created_at DESC` 排而不是发布日期：
  按发布日期排的话今天新抓的一批散落在中间，管理员翻第一页看不到本次爬取的结果，
  只会以为爬虫没抓到东西。

## 标讯详情链接（各平台的参数不止 id）

- **szexgrp 的详情页要三个参数，少一个是「永远转圈」而不是报错。**
  `jyxxDetails.js` 用 `bidSectionNumber` 当 `sectionCode` 去调
  `/api/v1/rhgw/szjy/detail`，缺了就 `if (!contentCode) return;` ——
  而这行在 `$("#loading").show()` **之后**，所以页面标题正常、无 404、无报错，
  只是空白转圈；后台一路显示「✅ 已处理」。拼法照抄站内 `home.js`：
  `linkTo` 优先，否则 `jyxxDetails.htm?bidSectionNumber=..&contentId=..&code=<noticeTypeCode.split('_')[1]>`，
  `bidSectionNumber` 为空（实测 200 条里 5 条，含 3 条白名单内的意向征集）时换
  `details.htm?contentId=`（那个页面只认 contentId）。存进 `tenders.url` 的链接
  再没有第二次机会 —— 表是 append-only，多维表格的清空重灌也是从这一列读的，
  所以拼错了要靠迁移洗（见 071）。
- **验链接不能只看 HTTP 200。** 这三个平台的详情页都是 CMS 空壳 + JS 取数，
  参数错了返回的 HTML 和正确的**逐字节一样**（只差个缓存戳），
  `curl` 对比不出来。要判对错只能看它背后那个 XHR：参数缺了接口回
  `code:200` + `data.bid:null`。

## 标讯 AI 提取与相关性闸门

- **提取的失败形态就是「0 条已处理 + ✅ 已完成」，所以 0 条必须 `job.fail`。**
  一批 3 条的完整 JSON 要 1300+ 输出 token，`max_tokens` 原来是 2000 —— 顶格截断的
  数组括号配不平，`parseFirstJsonArray` 返回 null，整批静默变成 0 条结果，而草稿
  一条不少地留在原地（用户唯一能看出不对的地方就是草稿数没变）。现在：4000 token、
  走 `jsonGateway`（解析失败重试一次 + 带回 `finish_reason`），截断 / 解析失败 /
  「模型没原样回 id 于是按顺序对齐」三种情况各说一句话进运行日志，部分失败也要
  分开报数（只报成功数的话，剩下几条会被当成「本来就不该提取」）。
- **吃掉 `max_tokens` 的是思维链，不是 JSON，所以解法是拆批而不是调大那个数。**
  ai_logs 里有 `output_tokens=2001` 而 `content` 只有 476 字符、断在半个字段上的记录
  —— 差额全在 `reasoning_content`，它算进 `max_tokens` 却不出现在 `content` 里。
  三件事必须都在：截断的 raw 里救回断点前写完的对象（`parseJsonArrayItems`，只在
  `finish_reason=length` 时用 —— 正常路径下接受半截数组等于把模型胡说也当结果）；
  没救回来的逐条重试，**并且这一轮后面所有批次直接改成单条**（不改的话每批都要先
  白花一次调用才发现装不下，实测 7 批全中）；报错里带上思维链 token 数，
  不带的话用户只会一路调高 `max_tokens`，而那个数字永远调不完。
  `jsonGateway` 遇到 `finish_reason=length` **不再重试**：同样的请求会断在同一个
  地方，重发只是把 token 和时间花两遍（单批曾因此耗时 85 秒）。
- **相关性闸门判 false 的代价不对称，所以缺省是放行。** `relevant=false` 的标讯置
  `status='rejected'`（作废）：不进标讯列表、不参与评分。误放一条无关的用户划过去
  就完了；误杀一条相关的，它从此不在任何列表里，用户根本不知道有这条 —— 所以
  「字段缺失/拼错/拿不准」全按 true，`prompt` 里也明写这一条，关键词库为空时干脆
  不拼这段规则（否则「和全部关键词都无关」对每条都成立，整批作废）。
- **相关性规则写在代码里（`relevanceRule()` 拼在模板后面），不写进
  `DEFAULT_EXTRACT_PROMPT`。** `system_config.tender_extract_prompt` 里有一份用户可编
  辑的副本且**优先级更高**，只改默认值的话装着旧副本的部署里模型压根不返回
  `relevant`，而缺省放行 = 闸门形同不存在，全程零报错，用户只会以为「AI 判得不准」。
- **状态过滤一律写白名单 `status IN ('extracted','scored')`，不写 `!= 'draft'`。**
  后者会让任何新状态默认可见/默认参与评分：`/list` 会把作废的摆回用户面前；
  `loadUnscoredForUser` 会花 token 评它，而评完那行就进了 `tender_recommendations`
  —— 推荐列表和飞书卡片从那张表取数、不看 status，作废的于是绕过闸门重新出现。
- **作废可复查、可恢复，否则误杀是永久静默丢失。** 草稿库分「待提取 / 已作废」两个
  视图（两个数字都常显 —— 「已作废 37」这种异常值是发现闸门太狠的唯一线索），
  `reject_reason`（迁移 075）存一句理由。恢复走 `POST /admin/drafts/:id/restore`，
  必须连 `ai_extracted` 一起清掉：留着的话服务层按「已经提取过了」跳过它，那条标讯
  从此卡在草稿库进不了列表，而两次点击都显示成功。

## 标讯清空（按平台 / 全部）

- **「一条标讯」是四张表**：`tenders` + `tender_recommendations` + `tender_user_feedback`
  + `tender_bitable_sync`。`services/tender/purge.ts` 一个事务删完，子表先删、本体后删
  （反了的话子表的 `IN (SELECT id FROM tenders …)` 匹配不到任何行，孤儿全留）。
  留孤儿不会报错：用户侧三处的「总数」查询不带 JOIN、「明细」查询带 INNER JOIN，
  于是 `/recommendations`、`/feedback` 会显示「共 40 条」却渲染不出行、翻出空白页，
  而 `recommendService` 的 `feedbackCount`（<5 放宽预筛阈值）把孤儿反馈也算进去，
  于是用严格阈值配空的历史反馈段。按平台删时**子表条件也要带 platform**，
  漏了就是全表删而返回值只报本平台的条数 —— 后台一句「已清空 gdgpo 2 条」，
  别的平台的用户从此推荐列表是空的。`purge.test.ts` 守这两条。
- **确认框的条数只能来自 `GET /admin/tenders/stats`，不能用列表的 total。**
  后台列表过了 14 天闸门又叠着搜索/关键词筛选 —— 拿它当确认数就是写着
  「确认清空 12 条」然后删掉 3000 条，而用户是照那个数字点确认的。
- **清库不清多维表格**（表是 append-only，Web 侧删不掉已推送的行），也不清
  关键词/评分配置/爬取日志。而候选为 0 时手动推送**不重灌也不发卡片**，
  所以全清之后飞书表会停在旧数据上直到下一轮评分出来 —— 这句必须写在返回里，
  否则「✅ 已清空」和用户在飞书里看到的满表旧数据直接矛盾。
- 有爬取/提取/评分任务在跑时清空返回 **409**：那些任务攥着一批内存里的 id，
  清完会继续往 `tender_recommendations` 写已不存在的 `tender_id`（没有外键约束，
  写得进去），刚清干净的库立刻又有孤儿，而两边的日志都显示成功。

## 智慧看板（/board）拿不到答案时

- **`/ai/board/chat` 空手而归必须回 502，前端也绝不回落显示用户的问题。**
  看板只能显示它收到的东西：字段全空的 200 在屏幕上和「模型没回答」无法区分，而前端
  旧代码 `displayText(... || message)` 会把刚问的那句话翻上看板 —— 用户看到的是
  「今天下雨」四个大字，像是「答案就是问题」，没有一处报错。空返回的成因是思维链
  （`max_tokens` 原来 1000，reasoning_tokens 算进额度却不进 `content`），所以报错里
  要带上思维链 token 数，否则用户只会觉得「AI 变傻了」。
  这个端点也**不准**再用 `/\{[\s\S]*\}/`：走 `jsonGateway`（平台唯一实现）。

## 小红书写作台的改写路径

- **风格下拉只出现在真的会把它传给接口的地方。** `SelectionChat` 的
  `skills`/`skillId` 是可选 prop，结构阶段**故意不传**（`/structure/node-chat` 只吃
  `xhs-structure` 底座，读不到 styleSkill）。摆一个没人读的下拉出来，用户换了风格、
  AI 照旧改法，返回的东西看着完全正常 —— 他只会以为这个 skill 没什么效果。
  浮层里选的风格存在 `reviseSkillId`，空值 = 跟随①，且**从不回写①的 `skillId`**：
  改一段用了别的风格不该悄悄换掉下次「重新成文」的风格。
- **全文改写走流式，所以必须自己接住两件事。** 一是**截断**：`streamToSSE` 在
  `finish_reason === 'length'` 时补一个 `{"truncated":true}` 事件，成文和改写两处都要
  提示 —— 结尾断在半句话上的稿子和写完的长得一模一样，用户会直接采纳/发布。
  二是**回滚**：改写结果先进预览等采纳（流式 `setContent` 会冲掉 TipTap 的撤销栈），
  采纳时把旧正文存进 `preRewriteBody` 供「↩ 撤销改写」还原，而**换稿/新建/重新成文
  时必须清掉它**，否则那个按钮会把上一篇的正文贴进这一篇，两边都不报错。
- **内置 skill 模板（`services/xhs/skillTemplates.ts`）只能是一个主文件。**
  `uws.assembleSkillBody` 把**没被 `{{ref}}` 引用的引用文件也全部拼在末尾**，
  所以在这个平台上拆多文件不是懒加载，只是让人误以为省了 token。导入时
  `setMainBody` 失败要把空壳 `deleteSkill` 掉：列表里留一个空 skill，用户选它去生成，
  出来的东西和没挂 skill 一模一样，没有任何一处会报错。`GET /skills/templates`
  必须注册在 `/skills/:id` **之前**（Express 按注册顺序匹配，否则回一句
  「模板不存在」，读起来像模板没了而不是路由写错了）。模板里那个出处字段叫
  `origin` 不叫 `source` —— `aiAppRegistry.test.ts` 全仓扫 `source: '…'` 字面量核
  AI 应用白名单，占这个键名会让那个守卫报假失败。

## Environment Variables

```
PORT=3001
JWT_SECRET=your-random-secret-here
```

Platform API key is stored in the database `system_config` table, NOT in .env.
