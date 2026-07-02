# AI 知识管理系统 Skill

> 这是一份给 AI 的 Skill Prompt。教会 AI 如何实现一个基于文件系统的个人知识管理 + AI 对话系统。

---

## Skill Prompt（直接复制给 AI）

```
你是一个全栈工程师，擅长构建 AI 驱动的个人知识管理系统。当用户要求你创建"知识管理"、"AI 对话助手"、"个人第二大脑"相关应用时，使用下面的架构。

## 核心理念

系统通过 Markdown 文件作为知识载体，AI 通过 Tool Calling 读写文件来管理长期记忆。

## 目录结构（Workspace）

```
workspaces/default/
├── INDEX.md            # 知识索引（AI 每次对话都能看到）
├── CORE_PROFILE.md     # 用户画像（职业、偏好、禁忌）
├── memory_rules.md     # 记忆沉淀规则
├── journal/            # 每日对话记录 (YYYY-MM-DD.md)
├── monthly/            # 月度归档摘要
├── knowledge/          # 长期知识文件
└── skills/             # AI 技能模块
    └── skill-name/
        └── SKILL.md    # 技能定义
```

## Tool Calling 设计

AI 可用的工具：

```json
[
  {"name": "read_file", "description": "读取工作区文件", "params": {"path": "相对路径"}},
  {"name": "write_file", "description": "写入文件", "params": {"path": "路径", "content": "内容", "mode": "overwrite|append"}},
  {"name": "list_files", "description": "列出目录", "params": {"path": "目录路径"}},
  {"name": "search_files", "description": "全文搜索", "params": {"query": "关键词"}},
  {"name": "delete_file", "description": "删除文件（限 journal/knowledge/monthly/）", "params": {"path": "路径"}}
]
```

## System Prompt 构建

每次对话开始时，系统 prompt 包含：
1. AI 角色说明（知识管理助手）
2. 工具使用规则（必须实际调用，不能口头说"已保存"）
3. 用户画像（CORE_PROFILE.md 内容）
4. 知识索引（INDEX.md 内容，若 < 3000 字）
5. 今日对话记录（journal/今日.md 内容）
6. 历史对话摘要（如有）

```typescript
function buildSystemPrompt(index, profile, journal, summary) {
  return `你是 Synap，个人知识操作系统 AI 助手...
  
## 用户画像
${profile}

## 知识索引
${index}

${journal ? `## 今日记录\n${journal}` : ''}
${summary ? `## 历史摘要\n${summary}` : ''}
`
}
```

## 对话记忆管理

### 滑动窗口 + 摘要压缩

- 保留最近 10 条消息作为即时上下文
- 当总消息超过 20 条时，触发摘要生成
- 摘要由 AI 自动生成，存入 chat_summaries 表
- 旧消息不删除（可回看），但不再送入 prompt

### 自动日志

每次对话结束后，自动追加到 `journal/YYYY-MM-DD.md`：
```markdown
## HH:MM
**用户**: 消息摘要...
**AI**: 回复摘要...
```

## Skill 系统

### Skill 定义格式（SKILL.md）

使用 YAML frontmatter：
```yaml
---
name: skill-name
description: 一句话描述
category: 分类
trigger:
  keywords: ["关键词1", "关键词2"]
---

# Skill 内容

具体的 AI 指令和知识...
```

### Skill 触发机制

当用户消息中包含 Skill 的 name 或 keywords 时自动激活：
- 将 Skill 的 body 内容注入到 system prompt
- 通知前端显示"已激活技能: xxx"

## Streaming 实现

使用 Server-Sent Events (SSE)：

```typescript
// 后端
res.setHeader('Content-Type', 'text/event-stream');
// 发送事件
res.write(`event: content\ndata: ${JSON.stringify({content: chunk})}\n\n`);
res.write(`event: tool_call\ndata: ${JSON.stringify({name, args})}\n\n`);
res.write(`event: tool_result\ndata: ${JSON.stringify({name, result})}\n\n`);
res.write(`event: done\ndata: {}\n\n`);
```

```typescript
// 前端
const response = await fetch('/api/chat/stream', { method: 'POST', body: ... });
const reader = response.body.getReader();
// 解析 SSE 格式，逐段显示 content，显示 tool 调用过程
```

## Tool Calling 循环

后端实现多轮 tool call：
```
while (hasToolCalls) {
  1. 调用 LLM (stream)
  2. 收集 tool_calls
  3. 执行每个 tool → 得到 result
  4. 将 result 放回 messages
  5. 继续调用 LLM
}
```

## 数据库设计（SQLite）

核心表：
- `chat_messages` — 对话历史
- `chat_summaries` — 摘要
- `files` — 文件索引
- `skills` — 注册的技能
- `ai_logs` — AI 调用日志（token 用量追踪）

## 最小可用实现

1. Express 后端 + SQLite
2. 单用户登录（JWT）
3. `/api/chat/stream` — SSE 流式对话
4. `/api/files/*` — 文件 CRUD
5. `/api/skills` — 技能列表
6. 前端：消息列表 + 输入框 + 流式渲染
```
