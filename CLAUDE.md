# QiaoNan Platform (mmPla)

## Project Overview

A multi-module platform with independent sub-apps aggregated under a single navigation page. Each module is independently functional but shares a unified auth system and AI gateway.

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
See `docs/FEISHU_ASSISTANT.md` for the full design. The load-bearing facts:

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
- **Adding a Feishu feature** = one file in `services/feishuAssistant/actions/`
  exporting an `ActionDef` + one entry in `actions/index.ts`. The LLM prompt and the
  permission checklist in the UI are both generated from the registry — nothing else
  to touch, except `dispatcher.ts`'s `FALLBACK_REPLY` (the hand-written 「我目前会…」
  list shown when nothing parsed) and the hand-written caveats on
  `views/feishu/FeishuHome.vue`'s 接入指引 tab. Those two are the only places that
  restate capabilities in prose, so they're the two that silently go stale.
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
- **Nor does it emit `guid` / `event_id` — same rule, same reason.** `update_task`,
  `update_calendar_event` and `delete_calendar_event` resolve "which one" by
  reverse-lookup from `feishu_commands.result` (`commandLog.findRecentActionResults`
  → `actions/recent.ts:findRecentTarget`), scoped to app + speaker, 7 days, 50 rows.
  A fabricated guid mostly 404s, but *if it hits* the assistant modified someone
  else's task and replied 「已完成」. Ambiguity is **always** refused with the
  candidates listed — including the no-keyword case, where it deliberately does
  **not** fall back to the most recent (「那个任务」 means the one they had in mind).
  Consequences that must stay visible: the not-found wording is
  「**我只能改我自己帮你建的那些**」 (not 「没找到」 — `task.list` returns only the
  calling identity's items, so a user-created task is silently *absent*, and
  「没找到」 sends them off re-phrasing forever); the `actions` list must include the
  update action itself (a renamed item is called by its **new** name, which only
  exists on the update row); and `deletedBy` tombstones deleted events (else
  「再取消一次」 fires a second cancellation notice to every attendee).
- **RRULE is built in code, not by the LLM** (`actions/recurrence.ts`; the model
  answers a 4-value enum). A wrong RRULE doesn't error — it creates an event with
  the wrong recurrence while the reply says 「已创建」, and 「每周一早会」 turning
  daily means 29 extra meetings on 30 calendars. Same shape as the id rule: the
  model never emits a format it can silently get wrong. Unbounded series and
  「改/删作用于整个系列」 must both be stated in the reply.
- **`update_task` spans four endpoints** (`patch` / `addMembers` / `addReminders` /
  `comment.create` — the last takes the guid in `data.resource_id`, not a path
  param), so partial success is unavoidable: do everything possible, then say which
  parts landed. `patch`'s `update_fields` is strictly paired with the values —
  a field named but not supplied is **cleared**. Calendar `patch` is the opposite
  ("changed only if sent"), so unmentioned fields are omitted entirely.
  Task reminders use `relative_fire_minute`, calendar ones use `minutes`; a task
  needs a `due` before a reminder can exist, and supports only one.
- **The LLM emits names, never open_ids.** The prompt contains no `ou_xxx` at all
  (there's a test asserting `/ou_[a-z0-9]{4,}/` never appears in it), and actions take
  `to` / `assignee` / `attendees` as **names**. `actions/people.ts:resolvePerson()` is
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
  page. This is what makes "DM the bot: 给张三发消息" work, since DMs have no `@`.
  Two sources: `contact/v3` department-tree BFS (full company), falling back to
  `im.chat.list` + `chatMembers.get` (zero contact scopes, group members only).
  **Downgrade only on Feishu code 99991672** — degrading on a network error hands the
  user a partial roster that looks complete. A failed sync never wipes the old roster.
- **Timestamp units differ**: task `due.timestamp` is **milliseconds**, calendar
  `start_time.timestamp` is **seconds**. Use `actions/time.ts` helpers.
- **AI quota** is charged to `feishu_apps.user_id` (the platform account that bound
  the app), so the dedicated-channel mechanism above applies unchanged. The person
  speaking in Feishu needs no platform account.

## Environment Variables

```
PORT=3001
JWT_SECRET=your-random-secret-here
```

Platform API key is stored in the database `system_config` table, NOT in .env.
