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
  resolves "which one" by reverse-lookup from `feishu_commands.result`
  (`commandLog.findRecentActionResults`
  → `actions/recent.ts:findRecentTarget`), scoped to app + speaker, 7 days, 50 rows.
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

## Environment Variables

```
PORT=3001
JWT_SECRET=your-random-secret-here
```

Platform API key is stored in the database `system_config` table, NOT in .env.
