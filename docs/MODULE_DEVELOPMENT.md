# 子模块开发规范

本文档规范 mmPla（QiaoNan Platform）中子模块的开发与对接流程。适用于新增子模块或修改现有模块的所有开发者和 AI Agent。

---

## 1. 平台架构概览

```
请求链路:
Client → Router Guard（前端登录检查）→ api.ts（统一请求封装）→ Express Server
  → authMiddleware（JWT/Token 鉴权）
  → moduleGuard（模块 Token 白名单校验）
  → rateLimiter（接口限流）
  → Router Handler（业务逻辑）
  → aiGateway / aiGatewayStream（AI 调用入口）
  → 响应返回
```

**核心原则：**
- 所有 AI 调用必须通过 `aiGateway()` / `aiGatewayStream()`，禁止直接实例化 OpenAI 客户端
- 所有 API 路由默认 PROTECTED（需登录），无需额外配置
- 前端所有请求必须通过 `api.ts` 封装函数，禁止直接 `fetch`
- 数据隔离：所有业务表必须有 `user_id`，查询必须过滤

---

## 2. 目录结构

```
server/src/
  api/myModule.ts          ← 后端路由（一个模块一个文件）
  services/myModule.ts     ← 可选：复杂业务逻辑提取
  db/migrations/NNN_xxx.ts ← 数据库变更

client/src/
  views/myModule/           ← 前端页面
    MyModuleView.vue
  components/myModule/      ← 可选：模块专用组件

skills/
  my-module/
    SKILL.md               ← 可选：AI 技能定义
    references/            ← 可选：知识库补充
```

**命名约定：**
| 位置 | 命名风格 | 示例 |
|------|----------|------|
| 后端文件名 | camelCase | `myModule.ts` |
| 前端组件 | PascalCase | `MyModuleView.vue` |
| 路由路径 | kebab-case | `/api/my-module` |
| 数据库字段 | snake_case | `user_id`, `created_at` |
| 模块 ID | kebab-case | `my-module` |

---

## 3. 后端开发规范

### 3.1 创建 Router

```typescript
// server/src/api/myModule.ts
import { Router, Request, Response } from 'express';
import { aiGateway, aiGatewayStream, QuotaExceededError } from '../core/llm/gateway.js';

export const myModuleRouter = Router();

myModuleRouter.post('/generate', async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { prompt } = req.body;

  try {
    const { response, usage } = await aiGateway(
      {
        messages: [
          { role: 'system', content: 'You are a helpful assistant.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.7,
        max_tokens: 1000,
      },
      { userId, source: 'my-module', operation: 'generate', requestSummary: prompt.slice(0, 50) }
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
});
```

### 3.2 注册到 app.ts

```typescript
// server/src/app.ts
import { myModuleRouter } from './api/myModule.js';
import { rateLimit } from './auth/rateLimit.js';

// 在其他路由注册区域添加：
app.use('/api/my-module', rateLimit(30, 60000)); // 30次/分钟
app.use('/api/my-module', myModuleRouter);
```

**注意事项：**
- 限流放在 Router 之前
- `authMiddleware` 和 `moduleGuard` 已全局挂载，无需重复添加
- 路由默认 PROTECTED，未登录返回 401

### 3.3 鉴权配置

默认所有路由需要登录。如果某个端点需要公开访问，在 `server/src/auth/middleware.ts` 的 `ROUTE_AUTH_CONFIG` 数组中添加：

```typescript
const ROUTE_AUTH_CONFIG: RouteAuthConfig[] = [
  // 现有配置...
  { path: /^\/api\/my-module\/public/, method: 'GET', level: 'public' },
];
```

**三种鉴权级别：**
| 级别 | 行为 | 使用场景 |
|------|------|----------|
| `public` | 无需 token，有 token 也会解析 | 公开内容展示 |
| `optional` | 有 token 解析，没有也放行 | 可选登录增强体验 |
| `protected` | 无有效 token 返回 401 | **默认值**，AI 功能必须 |

### 3.4 AI Gateway 接口

#### 非流式调用 `aiGateway()`

```typescript
import { aiGateway, QuotaExceededError } from '../core/llm/gateway.js';

const { response, usage, duration_ms } = await aiGateway(
  params,   // OpenAI ChatCompletionCreateParamsNonStreaming（不含 model）
  options   // GatewayOptions
);
```

**参数 `params`：** 标准 OpenAI 参数（messages, temperature, max_tokens, tools 等），不需要传 `model`（gateway 自动读取平台配置）。

**参数 `options` (GatewayOptions)：**
```typescript
interface GatewayOptions {
  userId: string;        // req.user!.id —— 用于扣额度和日志
  source: string;        // 模块名，如 'fish', 'board', 'my-module'
  operation: string;     // 操作类型，如 'generate', 'decide', 'chat'
  requestSummary?: string; // 可选，请求内容摘要（记录到日志）
}
```

**返回值：**
```typescript
{
  response: ChatCompletion;    // OpenAI 完整响应
  usage: { input_tokens, output_tokens, total_tokens };
  duration_ms: number;
}
```

#### 流式调用 `aiGatewayStream()`

```typescript
import { aiGatewayStream, QuotaExceededError } from '../core/llm/gateway.js';

const { stream, model, onComplete } = await aiGatewayStream(
  params,   // OpenAI ChatCompletionCreateParamsStreaming（不含 model 和 stream）
  options   // GatewayOptions
);

// 处理流数据...
for await (const chunk of stream) {
  // chunk.choices[0]?.delta?.content
}

// 流结束后必须调用 onComplete 记录用量
onComplete(inputTokens, outputTokens, durationMs);
```

**重要：** `onComplete()` 必须在流结束后调用，否则 AI 用量日志不完整。

### 3.5 SSE 流式响应规范

如果模块需要流式输出（如聊天），请遵循以下事件格式：

```typescript
// 设置 SSE 响应头
res.setHeader('Content-Type', 'text/event-stream');
res.setHeader('Cache-Control', 'no-cache');
res.setHeader('Connection', 'keep-alive');

// 发送事件的 helper
function sendEvent(event: string, data: any) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

// 标准事件类型
sendEvent('content', { text: '...' });           // 文本内容片段
sendEvent('tool_call', { name, arguments });     // AI 调用工具
sendEvent('tool_result', { name, result });      // 工具执行结果
sendEvent('skills_activated', { skills: [] });   // 激活的技能
sendEvent('error', { error: 'message' });        // 错误
sendEvent('done', { usage: {...} });             // 流结束
```

前端使用 `client/src/lib/sse.ts` 的 `streamSSE()` 消费这些事件。

### 3.6 数据库迁移

**Step 1：创建迁移文件**

```typescript
// server/src/db/migrations/012_my_module.ts
import type { Migration } from '../migrator.js';

export const migration_012: Migration = {
  id: '012_my_module',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS my_module_items (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT,
        status TEXT DEFAULT 'active',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_my_module_items_user ON my_module_items(user_id);
    `);
  },
};
```

**Step 2：注册到迁移列表**

```typescript
// server/src/db/migrations/index.ts
import { migration_012 } from './012_my_module.js';

export const allMigrations: Migration[] = [
  // ... 现有迁移
  migration_012,
];
```

**强制要求：**
- 所有业务表必须有 `user_id TEXT NOT NULL`
- 必须为 `user_id` 创建索引
- 时间字段使用 `TEXT` 存储 ISO 格式
- ID 使用 `TEXT PRIMARY KEY`（推荐 UUID）
- Migration ID 格式：`NNN_描述`，编号递增

### 3.7 数据隔离

所有涉及用户数据的查询**必须**带 `user_id` 过滤：

```typescript
// ✅ 正确
db.prepare('SELECT * FROM my_items WHERE user_id = ?').all(req.user!.id);

// ❌ 错误 —— 可能泄露其他用户数据
db.prepare('SELECT * FROM my_items WHERE id = ?').get(itemId);

// ✅ 正确 —— 双重过滤
db.prepare('SELECT * FROM my_items WHERE id = ? AND user_id = ?').get(itemId, req.user!.id);
```

---

## 4. 前端开发规范

### 4.1 组件规范

```vue
<template>
  <div class="my-module-page">
    <!-- 内容 -->
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { apiGet, apiPost } from '../../lib/api'

// 使用 TypeScript 定义接口
interface MyItem {
  id: string
  title: string
}

const items = ref<MyItem[]>([])

onMounted(async () => {
  const data = await apiGet<{ items: MyItem[] }>('/api/my-module/items')
  items.value = data.items
})
</script>

<style scoped>
.my-module-page {
  /* 模块页面样式 */
}
</style>
```

**强制要求：**
- 使用 `<script setup lang="ts">`
- 使用 Composition API
- 样式必须 `<style scoped>`
- 定义 TypeScript 接口

### 4.2 路由注册

```typescript
// client/src/router/index.ts
{
  path: '/my-module',
  name: 'my-module',
  component: () => import('../views/myModule/MyModuleView.vue'),
  meta: { requiresAI: true },
},
```

**Meta 标志说明：**
| 标志 | 效果 |
|------|------|
| `requiresAuth: true` | 未登录跳转首页 + 弹登录窗 |
| `requiresAI: true` | 同上，但登录窗显示「需要登录以使用 AI 功能」 |
| `requiresAdmin: true` | 需 admin 角色，否则跳首页 |
| 无 meta | 公开访问 |

**多语言路由：** 如需英文版本，添加 `/en/my-module` 路由指向同一组件。

### 4.3 API 调用

**必须使用 `client/src/lib/api.ts` 提供的函数：**

```typescript
import { api, apiGet, apiPost, apiDelete } from '../../lib/api'

// GET
const data = await apiGet<{ items: Item[] }>('/api/my-module/items')

// POST
const result = await apiPost<{ id: string }>('/api/my-module/create', { title: 'xxx' })

// DELETE
await apiDelete('/api/my-module/items/123')

// 自定义请求（如 PATCH）
await api('/api/my-module/items/123', {
  method: 'PATCH',
  body: JSON.stringify({ title: 'new title' }),
})
```

**封装提供的自动处理：**
- 自动附加 `Authorization: Bearer <token>` 头
- 401 响应 → 自动弹出登录窗
- 429 + `quota_exceeded` → 自动弹额度耗尽提示
- 自动设置 `Content-Type: application/json`

**禁止直接使用 `fetch()`**，否则以上自动处理全部失效。

### 4.4 SSE 流式调用

```typescript
import { streamSSE } from '../../lib/sse'

const { abort } = streamSSE({
  url: '/api/my-module/stream',
  body: { prompt: userInput },
  onContent(text) {
    // 实时文本内容
    result.value += text
  },
  onToolCall(call) {
    // AI 工具调用
  },
  onError(err) {
    // 错误处理
  },
  onDone(usage) {
    // 流结束
  },
})

// 取消流
abort()
```

### 4.5 首页入口

模块在首页的展示通过 admin 后台 **「首页内容」** 管理（`/admin/home`）。也可通过数据库 migration 直接 seed：

```sql
INSERT INTO home_modules (id, title, description, icon, path, category, require_auth, featured, sort_order, created_at)
VALUES ('my-module', '模块名称', '模块描述', '🎯', '/my-module', 'ai-tools', 1, 0, 10, datetime('now'));
```

字段说明：
- `path`: 点击卡片跳转的路由路径
- `require_auth`: 1=需要登录才能使用
- `featured`: 1=首页高亮展示
- `category`: 分类标签
- `grid_span`: 卡片尺寸（`1x1`, `2x1`, `1x2`, `2x2`）

---

## 5. 模块 Token 与第三方 API 对接

### 5.1 概述

第三方系统通过 **模块 Token** 调用平台 API。每个 Token 绑定到一个用户 + 一个模块，只能访问该模块白名单内的 API 路径。

```
第三方请求 → Authorization: Bearer mmPla_xxxxx
  → authMiddleware（识别为模块 Token，解析 user + module）
  → moduleGuard（检查请求路径是否在模块白名单内）
  → 业务逻辑
```

### 5.2 为新模块配置白名单

在 `server/src/db/migrations/011_module_tokens.ts` 中已 seed 了默认模块。新模块需要在 admin 后台 **「模块管理」** (`/admin/modules`) 中添加，或通过新迁移 seed：

```sql
INSERT INTO module_configs (id, name, description, allowed_paths, enabled, created_at)
VALUES ('my-module', '我的模块', '模块描述', '["\/api\/my-module"]', 1, datetime('now'));
```

### 5.3 路径匹配规则

`allowed_paths` 是 JSON 数组，支持三种匹配方式：

| 模式 | 示例 | 匹配 |
|------|------|------|
| 精确匹配 | `/api/my-module/generate` | 仅该路径 |
| 前缀匹配 | `/api/my-module` | 该前缀下所有路径 |
| 通配符 | `/api/my-module*` | 以该前缀开头的所有路径 |

推荐使用前缀匹配 `/api/my-module`，覆盖模块下所有端点。

### 5.4 Token 管理流程

1. Admin 在 **用户管理** 页面点击「Token管理」
2. 选择模块 → 生成 Token（一个用户一个模块只能有一个 Token）
3. Token 仅生成时展示一次，保存的是 SHA-256 哈希
4. 第三方使用 `Authorization: Bearer mmPla_xxxxx` 调用
5. 所有 Token 请求自动记录到 `token_access_logs`（方法、路径、状态码、IP）

---

## 6. 技能系统（Skills）

技能是注入到 AI 系统提示中的 Markdown 文件，用于增强特定场景下的 AI 回答能力。

### 6.1 创建技能文件

```markdown
---
name: my-module-skill
description: 我的模块专用技能
keywords:
  - 关键词1
  - 关键词2
category: tools
---

# 技能内容

你是一个专业的 xxx 助手...

## 规则
- 规则1
- 规则2
```

放置位置：`skills/my-module/SKILL.md`

### 6.2 工作原理

- Chat/Consultant 模块在处理用户消息时，自动匹配 `keywords`
- 匹配成功后，技能 Markdown 内容被注入到 system prompt
- `references/` 子目录下的文件作为补充知识库一并注入
- 技能在前端通过 `/api/skills` 端点展示，用户可在 Skill Builder 中查看

### 6.3 知识库补充

```
skills/my-module/
  SKILL.md              ← 主技能定义
  references/
    knowledge.md        ← 补充知识（自动注入）
```

---

## 7. SEO 与多语言

### 7.1 多语言路由

为模块同时创建中文和英文路由：

```typescript
// 中文（默认）
{ path: '/my-module', name: 'my-module', component: () => import('...') },
// 英文
{ path: '/en/my-module', name: 'my-module-en', component: () => import('...') },
```

### 7.2 SEO 配置

在 admin 后台 **「SEO 管理」** (`/admin/seo`) 中为每个路径配置：
- `title` / `description` / `keywords`
- 可按 `locale`（`zh` / `en`）分别配置

前端使用 `useSeo()` composable 自动加载并应用：

```typescript
import { useSeo } from '../../lib/useSeo'
useSeo() // 自动检测当前路径和语言，设置 document.title 和 meta
```

---

## 8. 新模块上线 Checklist

### 后端

- [ ] 创建 `server/src/api/myModule.ts`，导出 Router
- [ ] 在 `server/src/app.ts` 中注册路由（含限流）
- [ ] AI 调用通过 `aiGateway()` / `aiGatewayStream()`
- [ ] 传入正确的 `GatewayOptions`（userId、source、operation）
- [ ] `QuotaExceededError` 处理（返回 429）
- [ ] 数据库迁移文件创建并注册
- [ ] 所有业务表包含 `user_id`，查询带 `user_id` 过滤
- [ ] 如需公开路由，在 `ROUTE_AUTH_CONFIG` 中声明
- [ ] ESM 导入使用 `.js` 后缀

### 前端

- [ ] 创建 `client/src/views/myModule/` 目录和组件
- [ ] 路由注册，设置正确的 `meta`（`requiresAI` 或 `requiresAuth`）
- [ ] API 调用使用 `apiGet` / `apiPost` / `apiDelete`（禁止直接 fetch）
- [ ] 流式场景使用 `streamSSE()`
- [ ] 首页添加模块入口（通过 admin 后台或 migration seed）
- [ ] 如需英文版，添加 `/en/xxx` 路由

### 第三方对接

- [ ] 在 `module_configs` 中添加模块记录
- [ ] 配置 `allowed_paths` 白名单
- [ ] 通知 admin 为需要的用户生成 Token

### 可选

- [ ] 编写 Skill 文件（`skills/my-module/SKILL.md`）
- [ ] 配置 SEO 元数据
- [ ] 添加多语言路由

---

## 9. 常见模式参考

### 模式 A：非流式 AI 请求（Fish / Board）

适用于一问一答型交互：用户提交 → AI 生成 → 返回 JSON 结果。

参考文件：`server/src/api/ai.ts`

### 模式 B：流式 SSE（Chat / Consultant）

适用于实时对话：用户发送消息 → 建立 SSE 连接 → AI 逐步输出 → 流结束。

特点：
- 需要维护对话历史（独立表）
- 支持 tool calling 多轮
- 使用 `streamWithToolCalls()` 工具

参考文件：`server/src/api/chat.ts`、`server/src/api/consultant.ts`

### 模式 C：带状态管理的模块（Synap）

适用于多子页面模块：使用父级 Layout 组件 + 子路由。

```typescript
{
  path: '/my-app',
  component: () => import('../views/myApp/MyAppLayout.vue'),
  meta: { requiresAuth: true },
  children: [
    { path: '', redirect: '/my-app/main' },
    { path: 'main', component: () => import('../views/myApp/MainView.vue') },
    { path: 'settings', component: () => import('../views/myApp/SettingsView.vue') },
  ],
}
```

参考文件：`client/src/views/synap/SynapApp.vue`

### 模式 D：内容管理 + SSG（Discover / Topics）

适用于内容发布类模块：Admin 后台管理内容 → 前端公开展示 → SSG 生成静态页用于 SEO。

特点：
- 区分公开路由（无需登录）和管理路由（admin only）
- 支持多语言内容（`zh` / `en`）
- 可选 SSG 生成静态 HTML 文件
- 支持专题分组和自定义模版

参考文件：`server/src/api/discover.ts`、`server/src/api/topics.ts`、`server/src/services/ssgService.ts`

---

## 10. 专题自定义模版开发

### 10.1 概述

专题（Topics）支持自定义前端模版。每个专题可以在后台选择使用哪个模版渲染。系统提供一个默认模版 `DefaultTopic.vue`，也可以为特定专题编写专属模版。

### 10.2 模版文件位置

```
client/src/views/discover/topics/
  DefaultTopic.vue      ← 默认模版（必须存在）
  TechWeekly.vue        ← 示例：技术周刊专属模版
  AiResearch.vue        ← 示例：AI 研究专属模版
```

### 10.3 模版命名规则

- 文件名使用 **PascalCase**（如 `TechWeekly.vue`）
- 后台「模版」字段填写 **kebab-case**（如 `tech-weekly`）
- 系统自动转换：`tech-weekly` → 加载 `TechWeekly.vue`
- 特殊值 `default` → 加载 `DefaultTopic.vue`

### 10.4 Props 接口

所有模版组件必须接收以下 props：

```typescript
interface TopicProps {
  topic: {
    id: string
    slug: string
    cover_image: string
    icon: string
    bg_color: string
    title: string        // 当前语言的标题
    description: string  // 当前语言的描述
  }
  articles: Array<{
    slug: string
    icon: string
    bg_color: string
    avatar_color: string
    author: string
    title: string        // 当前语言的标题
    summary: string      // 当前语言的摘要
  }>
  locale: string         // 'zh' | 'en'
}
```

在组件中使用：

```vue
<script setup lang="ts">
defineProps<{
  topic: {
    id: string; slug: string; cover_image: string;
    icon: string; bg_color: string; title: string; description: string
  }
  articles: Array<{
    slug: string; icon: string; bg_color: string;
    avatar_color: string; author: string; title: string; summary: string
  }>
  locale: string
}>()
</script>
```

### 10.5 模版内链接处理

模版中的文章链接必须根据 `locale` 动态生成路径：

```vue
<template>
  <router-link
    v-for="article in articles"
    :key="article.slug"
    :to="locale === 'en' ? `/en/discover/${article.slug}` : `/discover/${article.slug}`"
  >
    {{ article.title }}
  </router-link>
</template>
```

### 10.6 动态加载机制

`TopicView.vue` 使用 `defineAsyncComponent` 动态加载模版：

```typescript
const templateComponent = computed(() => {
  const tpl = topic.value?.template || 'default'
  const fileName = tpl === 'default'
    ? 'DefaultTopic'
    : tpl.split('-').map(s => s[0].toUpperCase() + s.slice(1)).join('')

  return defineAsyncComponent({
    loader: () => import(`./topics/${fileName}.vue`),
    errorComponent: () => import('./topics/DefaultTopic.vue'),
  })
})
```

加载失败时自动 fallback 到 `DefaultTopic.vue`，不会导致页面崩溃。

### 10.7 模版开发要点

1. **不要引入额外依赖** — 模版应只使用 Vue 内置能力和项目已有的工具
2. **响应式设计** — 确保移动端适配（min-width 375px）
3. **样式隔离** — 使用 `<style scoped>`，避免全局污染
4. **SEO 无关** — 模版只控制 SPA 渲染效果；SSG 有独立的 HTML 生成逻辑（`ssgService.ts`），不依赖 Vue 模版
