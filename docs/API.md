# API Reference

Base URL: `http://localhost:3001`

## Authentication

All requests use Bearer token auth:
```
Authorization: Bearer <jwt_token_or_api_token>
```

JWT tokens are obtained via `/api/auth/login`. API tokens (prefixed `mmPla_`) are created via `/api/tokens`.

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
Returns current user info including role.

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

---

## AI Endpoints

All AI endpoints are `PROTECTED` and consume 1 quota per call.

### POST /api/ai/fish/decide
Fish tank AI decision making.

### POST /api/ai/fish/knowledge
Generate trivia based on hobby.

### POST /api/ai/fish/story-event
Generate story event for fish tank.

### POST /api/ai/board/chat
Wisdom board AI response.
```json
{ "message": "我很迷茫", "mode": "wisdom" | "dark" }
```

---

## Chat (Synap)

### GET /api/chat/messages `PROTECTED`
### DELETE /api/chat/messages `PROTECTED`
### POST /api/chat/stream `PROTECTED`
SSE streaming endpoint. Consumes quota.

---

## Consultant

### GET /api/consultant/messages `PROTECTED`
### DELETE /api/consultant/messages `PROTECTED`
### POST /api/consultant/stream `PROTECTED`
SSE streaming endpoint. Consumes quota.

---

## API Tokens

### GET /api/tokens `PROTECTED`
List current user's active tokens.

### POST /api/tokens `PROTECTED`
```json
{ "name": "My Bot", "expires_in_days": 30, "scopes": ["fish:read", "board:chat"] }
// Response includes full token (shown only once)
```

### DELETE /api/tokens/:id `PROTECTED`
Revoke a token.

---

## Settings

### GET /api/settings `PROTECTED`
### POST /api/settings `PROTECTED`
```json
{ "apiKey": "sk-...", "baseURL": "https://...", "model": "gpt-4o" }
```

---

## Admin Endpoints

All admin endpoints require `role: "admin"`.

### GET /api/admin/users
### POST /api/admin/users
### PATCH /api/admin/users/:id/role
### POST /api/admin/users/:id/reset-password

### GET /api/admin/quotas
### PATCH /api/admin/quotas/:userId
```json
{ "daily_limit": 50 }
```

### GET /api/admin/ai-usage?days=7
### GET /api/admin/config
### POST /api/admin/config
```json
{ "key": "platform_api_key", "value": "sk-..." }
```

---

## Error Responses

### Standard Error
```json
{ "error": "Error message here" }
```

### Quota Exceeded (429)
```json
{ "error": "quota_exceeded", "remaining": 0, "daily_limit": 10 }
```

### Rate Limited (429)
```json
{ "error": "rate_limit_exceeded", "retry_after_ms": 45000 }
```

### Scope Denied (403)
```json
{ "error": "Token lacks required scope", "required": "chat:stream", "available": ["fish:read"] }
```

---

## Rate Limits

| Endpoint Group | Limit |
|---------------|-------|
| /api/ai/* | 30 req/min |
| /api/chat/* | 20 req/min |
| /api/consultant/* | 20 req/min |

Headers returned: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`

---

## Valid Token Scopes

`fish:read`, `board:chat`, `chat:stream`, `consultant:stream`, `files:read`, `files:write`

A token with no scopes has full access (equivalent to JWT auth).
