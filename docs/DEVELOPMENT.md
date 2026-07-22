# 开发规范

## 新模块开发 Checklist

### 后端

- [ ] 在 `server/src/api/` 下创建路由文件，导出 Router
- [ ] 在 `server/src/app.ts` 中注册路由（含限流）
- [ ] 如果需要 AI 功能，使用 `aiGateway()` 或 `aiGatewayStream()`
- [ ] 如果需要新表，创建 migration 文件并注册
- [ ] 所有业务表必须包含 `user_id` 字段
- [ ] 路由默认 PROTECTED，不需要额外配置
- [ ] 如需公开路由，在 `ROUTE_AUTH_CONFIG` 中声明

### 前端

- [ ] 在 `client/src/views/模块名/` 下创建页面组件
- [ ] 在 `router/index.ts` 添加路由，设置适当的 `meta`
- [ ] 在 admin 后台「首页内容」中添加导航卡片（或 migration seed）
- [ ] API 调用使用 `client/src/lib/api.ts` 中的 `apiGet/apiPost/apiDelete`
- [ ] 不要直接使用 `fetch`，否则不会自动处理 token、401 弹窗和 429

### 第三方对接

- [ ] 在 admin「模块管理」中注册模块并配置 `allowed_paths`
- [ ] 通知 admin 为需要的用户生成模块 Token
- [ ] 第三方使用 `Authorization: Bearer mmPla_xxxxx` 调用

> 💡 除了模块 Token，还有两类对外集成模式见 [INTEGRATION_PATTERNS.md](./INTEGRATION_PATTERNS.md)：
> **纯前端 SDK**（第三方无后端，pk + Origin 白名单 + scope 只读 token）与
> **外部消息推送**（平台事件 → 飞书等 IM 群机器人）。

## 代码风格

### TypeScript

- 使用严格类型，避免 `any`
- ESM 导入使用 `.js` 后缀（后端）
- 接口定义放在使用它的文件中，除非被多个文件共享

### Vue 组件

- 使用 `<script setup lang="ts">`
- 使用 Composition API
- 样式使用 `<style scoped>`

### 命名

- 文件名：camelCase (ts), PascalCase (Vue)
- 路由路径：kebab-case
- API 端点：kebab-case
- 数据库字段：snake_case

## AI Gateway 使用示例

```typescript
// 非流式调用
import { aiGateway, QuotaExceededError } from '../core/llm/gateway.js';

try {
  const { response, usage } = await aiGateway(
    {
      messages: [
        { role: 'system', content: '...' },
        { role: 'user', content: message },
      ],
      temperature: 0.7,
      max_tokens: 500,
    },
    { userId: req.user!.id, source: 'my-module', operation: 'generate', requestSummary: message.slice(0, 50) }
  );
  const content = response.choices[0]?.message?.content || '';
  res.json({ result: content, usage });
} catch (err) {
  if (err instanceof QuotaExceededError) {
    res.status(429).json({ error: 'quota_exceeded', remaining: 0, daily_limit: err.dailyLimit });
    return;
  }
  throw err;
}
```

```typescript
// 流式调用
import { aiGatewayStream, QuotaExceededError } from '../core/llm/gateway.js';

try {
  const { stream, model, onComplete } = await aiGatewayStream(
    { messages: [...], tools: [...], stream_options: { include_usage: true } },
    { userId: req.user!.id, source: 'my-module', operation: 'stream' }
  );

  for await (const chunk of stream) {
    // ... process chunks
  }

  onComplete(totalInput, totalOutput, duration);
} catch (err) {
  if (err instanceof QuotaExceededError) {
    sendEvent('error', { error: 'quota_exceeded' });
    return;
  }
}
```

## Migration 示例

```typescript
// server/src/db/migrations/013_my_new_table.ts
import type { Migration } from '../migrator.js';

export const migration_013: Migration = {
  id: '013_my_new_table',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS my_table (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_my_table_user ON my_table(user_id);
    `);
  },
};
```

然后在 `server/src/db/migrations/index.ts` 中注册。

## 第三方 API 对接

平台使用 **模块 Token** 为第三方系统提供 API 访问：

1. Admin 在「模块管理」(`/admin/modules`) 中注册模块并配置 API 路径白名单
2. Admin 在「用户管理」中为指定用户生成模块 Token（一个用户一个模块一个 Token）
3. 第三方使用 `Authorization: Bearer mmPla_xxxxx` 调用
4. Token 自动关联用户身份，共享该用户的 AI 额度
5. 请求路径必须在模块白名单内，否则返回 403
6. 所有 Token 请求自动记录访问日志（方法、路径、状态码、IP）

### 路径白名单匹配规则

| 模式 | 示例 | 匹配 |
|------|------|------|
| 精确匹配 | `/api/my-module/generate` | 仅该路径 |
| 前缀匹配 | `/api/my-module` | 该前缀下所有路径 |
| 通配符 | `/api/my-module*` | 以该前缀开头的所有路径 |

### 安全模型

- **Token 隔离**：每个 Token 绑定 (user_id, module_id)，不能跨用户或跨模块
- **路径白名单**：即使拥有 Token，也只能访问该模块配置的白名单路径
- **Admin 管控**：用户不能自行创建/销毁 Token，只有 Admin 有权操作
- **审计日志**：所有 Token 请求自动记录到 `token_access_logs`
- **JWT 不受影响**：Web 前端使用 JWT 登录，不受模块路径限制；模块白名单只约束 Token 认证的请求
