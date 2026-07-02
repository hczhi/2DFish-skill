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
- If user configures their own API key in Settings → quota is bypassed
- Platform key is set by admin in Admin > System Config
- Quota resets daily at midnight (server time)
- HTTP 429 returned when quota exceeded

## Environment Variables

```
PORT=3001
JWT_SECRET=your-random-secret-here
```

Platform API key is stored in the database `system_config` table, NOT in .env.
