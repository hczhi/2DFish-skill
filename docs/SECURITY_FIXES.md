# 安全修复说明 (2026-07-04)

本次修复覆盖了全面安全审计中发现的所有问题，按严重程度从高到低排列。

---

## CRITICAL 级修复

### 1. 文件服务竞态条件 — 跨用户文件访问

**问题：** `fileService.ts` 使用模块级全局变量 `currentUserId` 追踪当前用户，并发请求时会导致 User A 的文件操作在 User B 的 workspace 中执行。

**修复：** 所有文件操作函数增加显式 `userId` 参数，不再依赖全局状态。

**影响文件：**
- `server/src/services/fileService.ts` — 所有导出函数新增 `userId?` 参数
- `server/src/core/tools/executor.ts` — `executeTool` 传入 `userId`
- `server/src/core/streaming.ts` — `StreamContext` 接口新增 `userId`
- `server/src/api/chat.ts` — 传入 `userId` 到文件操作
- `server/src/api/consultant.ts` — 传入 `userId`
- `server/src/api/files.ts` — 从 `req.user!.id` 提取并传入
- `server/src/services/journalService.ts` — 新增 `userId` 参数

---

### 2. JWT Secret 硬编码回退值

**问题：** `JWT_SECRET` 未设置时使用公开的默认值，任何人都能伪造 token。

**修复：** 生产环境 (`NODE_ENV=production`) 启动时强制检查，缺失或为默认值时 `process.exit(1)` 拒绝启动。开发环境保留但输出明显警告。

**影响文件：**
- `server/src/app.ts` — 启动时环境检查逻辑

---

### 3. CORS 允许所有来源

**问题：** `origin: true` 配合 `credentials: true` 允许任意网站代替用户发起认证请求。

**修复：** 
- 支持 `CORS_ORIGIN` 环境变量（逗号分隔的域名列表）
- 生产环境未设置时默认 `false`（拒绝跨域）
- 开发环境默认 `['http://localhost:5173', 'http://localhost:3001']`

**影响文件：**
- `server/src/app.ts` — CORS 配置重写

---

## HIGH 级修复

### 4. 公开页面存储型 XSS（文章内容）

**问题：** 文章 HTML 内容通过 `v-html` 直接渲染，无任何消毒处理。

**修复：** 
- 前端安装 `dompurify`，ArticleView 使用 `DOMPurify.sanitize()` 处理后再渲染
- SSG 输出中 icon 字段用 `escapeHtml()` 转义

**影响文件：**
- `client/package.json` — 新增 `dompurify` + `@types/dompurify`
- `client/src/views/discover/ArticleView.vue` — sanitizedContent computed
- `server/src/services/ssgService.ts` — 所有 icon 输出添加 `escapeHtml()`

---

### 5. Chat/Consultant Markdown XSS

**问题：** `renderMarkdown()` 不做 HTML 转义就用 `v-html` 渲染，AI 输出含恶意 HTML 可直接执行。

**修复：** 在 markdown 替换前先对文本做 `escapeHtml()` 转义。

**影响文件：**
- `client/src/views/synap/ChatView.vue`
- `client/src/views/synap/ConsultantView.vue`

---

### 6. 认证端点无限流

**问题：** `/api/auth/login` 和 `/api/auth/register` 无 rate limiting，允许暴力破解。

**修复：** 添加 `rateLimit(10, 60_000)` 到 `/api/auth`（每分钟最多 10 次）。

**影响文件：**
- `server/src/app.ts`

---

### 7. SSG 路径穿越

**问题：** slug 直接拼入文件路径，`../../` 式 slug 可在服务器任意位置写文件。

**修复：** 
- API 层强制校验 slug 格式：`/^[a-z0-9][a-z0-9-]*$/`
- SSG 层 `path.resolve()` 后检查是否仍在 `CLIENT_DIST` 目录内

**影响文件：**
- `server/src/api/discover.ts` — POST/PATCH 添加 slug 校验
- `server/src/api/topics.ts` — POST/PATCH 添加 slug 校验
- `server/src/services/ssgService.ts` — 路径解析安全检查

---

### 8. SSG json_ld 注入

**问题：** `seo_pages` 表的 `json_ld` 字段直接插入 `<script>` 标签，可通过 `</script>` 突破。

**修复：** 插入前将 `</` 替换为 `<\/`，防止脚本标签闭合。

**影响文件：**
- `server/src/services/ssgService.ts`

---

## MEDIUM 级修复

### 9. 安全响应头缺失

**问题：** 未设置 `X-Content-Type-Options`、`X-Frame-Options` 等安全头。

**修复：** 添加中间件设置：
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `X-XSS-Protection: 1; mode=block`
- `Referrer-Policy: strict-origin-when-cross-origin`

**影响文件：**
- `server/src/app.ts`

---

### 10. JWT 30 天无法撤销

**问题：** Token 有效期 30 天，密码被重置后旧 token 仍有效。

**修复：** 
- `user` 表新增 `token_version` 字段（migration 013）
- JWT payload 中携带 `tv`（token version）
- 验证时比对数据库中的 `token_version`，不匹配返回 401
- 修改密码时递增 `token_version`，使旧 token 失效

**影响文件：**
- `server/src/db/migrations/013_token_version.ts`（新文件）
- `server/src/db/migrations/index.ts` — 注册新迁移
- `server/src/api/auth.ts` — JWT 生成时包含 `tv`
- `server/src/auth/middleware.ts` — JWT 验证时检查 `tv`
- `server/src/api/admin.ts` — 重置密码时递增版本

---

### 11. 数据库查询无上限

**问题：** `days`、`limit` 等查询参数无上限，可导致内存耗尽。

**修复：** 所有分页参数加上限（days ≤ 365，limit ≤ 1000）。

**影响文件：**
- `server/src/api/admin.ts` — ai-usage、token-logs 端点
- `server/src/api/analytics.ts` — stats 端点

---

### 12. 401 未清除过期 Token

**问题：** 收到 401 时弹登录窗但不清 localStorage 中的旧 token。

**修复：** 401 时先调用 `clearToken()` 再弹窗。

**影响文件：**
- `client/src/lib/api.ts`

---

### 13. Analytics 端点无限流

**问题：** `/api/analytics/pageview` 可被刷虚假 PV。

**修复：** 添加 `rateLimit(60, 60_000)` 到 `/api/analytics`。

**影响文件：**
- `server/src/app.ts`

---

## LOW 级修复

### 14. 用户创建缺少角色校验

**问题：** `POST /api/admin/users` 接受任意 role 字符串。

**修复：** 添加 `['admin', 'user']` 白名单校验。

**影响文件：**
- `server/src/api/admin.ts`

---

### 15. 注册用户名无校验

**问题：** 可注册超长或含 HTML 的用户名。

**修复：** 用户名限制 2-30 字符，仅允许字母、数字、下划线、中文。

**影响文件：**
- `server/src/api/auth.ts`

---

## 部署注意事项

### 环境变量（生产环境必须设置）

```bash
JWT_SECRET=your-random-64-char-secret-here    # 必须设置，否则拒绝启动
CORS_ORIGIN=https://yourdomain.com            # 逗号分隔允许的域名
NODE_ENV=production                           # 触发生产安全检查
```

### 新增依赖

```
client/
  dompurify: ^3.x
  @types/dompurify: ^3.x (devDependencies)
```

### 新增数据库迁移

- `013_token_version` — 给 user 表添加 `token_version` 字段

服务器重启后自动执行，无需手动操作。迁移后所有已登录用户的 JWT 仍然有效（默认 version = 1，新 JWT 也携带 tv=1）。

### 破坏性变更

| 变更 | 影响 | 应对 |
|------|------|------|
| slug 格式校验 | 现有含大写/特殊字符的 slug 无法更新 | 检查数据库中现有 slug 是否符合 `^[a-z0-9][a-z0-9-]*$` |
| CORS 默认拒绝 | 生产环境未设 `CORS_ORIGIN` 将拒绝所有跨域 | 部署前设置环境变量 |
| JWT Secret 强制 | 生产环境未设 `JWT_SECRET` 将启动失败 | 部署前设置环境变量 |
| Auth 限流 | 每分钟最多 10 次登录/注册请求 | 正常使用不受影响 |
