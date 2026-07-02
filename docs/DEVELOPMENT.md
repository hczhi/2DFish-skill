# 开发规范

## 新模块开发 Checklist

### 后端

- [ ] 在 `server/src/api/` 下创建路由文件，导出 Router
- [ ] 在 `server/src/app.ts` 中注册路由
- [ ] 如果需要 AI 功能，使用 `aiGateway()` 或 `aiGatewayStream()`
- [ ] 如果需要新表，创建 migration 文件
- [ ] 所有业务表必须包含 `user_id` 字段
- [ ] 路由默认 PROTECTED，不需要额外配置

### 前端

- [ ] 在 `client/src/views/模块名/` 下创建页面组件
- [ ] 在 `router/index.ts` 添加路由，设置适当的 `meta`
- [ ] 在 `Home.vue` 的 `navItems` 中添加导航卡片
- [ ] API 调用使用 `client/src/lib/api.ts` 中的 `apiGet/apiPost/apiDelete`
- [ ] 不要直接使用 `fetch`，否则不会自动处理 token 和 429

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
// server/src/db/migrations/004_my_new_table.ts
import type { Migration } from '../migrator.js';

export const migration_004: Migration = {
  id: '004_my_new_table',
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

为第三方工具提供 API 时：

1. 用户在「设置 > Token 管理」中创建 API Token
2. 指定 scopes 限制访问范围
3. 第三方使用 `Authorization: Bearer mmPla_xxxxx` 调用
4. Token 自动关联用户身份，共享该用户的 AI 额度

如需新增 scope，在 `server/src/api/tokens.ts` 的 `VALID_SCOPES` 中添加。
