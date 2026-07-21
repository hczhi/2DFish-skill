# Skill 系统开发规范

后台可管理、DB 驱动的多文件 skill 系统。**所有 AI 功能的提示词都应该通过它管理，不要再硬编码 prompt 或直接读 `skills/*.md` 文件。**

## 三个概念

| 概念 | 是什么 | 存在哪 | 谁能改 |
|------|--------|--------|--------|
| **skill** | 一段可复用的提示词知识，可由「主文件 + 多个引用文件」组成 | DB (`prompt_skills` / `prompt_skill_files`) | 后台「Skill 管理」页 |
| **slot（功能位）** | 前台某个 AI 功能调用点的命名锚点 | 代码里写死 (`KNOWN_SLOTS`) + 调用处 `getSkillForSlot('slot名')` | 开发（改代码） |
| **binding（绑定）** | slot → skill 的映射 | DB (`prompt_skill_bindings`) | 后台下拉选择 |

核心思想：**代码只问「这个功能位该用哪个 skill？」，答案由后台配置。** 换 prompt 不用改代码、不用发版。

## 数据表（注意 `prompt_` 前缀）

> `server/src/db/index.ts` 里已有一张用途无关的旧 `skills` 表（UI style skills），所以本系统所有表都用 `prompt_` 前缀，切勿混淆。

- `prompt_skills` — skill 元信息：`id / key / name / description / body(主文件镜像) / enabled`
- `prompt_skill_files` — 组成文件：`kind`(`main` 每 skill 一条 / `reference` 多条) `/ filename / body / sort_order`
- `prompt_skill_bindings` — 绑定：`slot(PK) / skill_id`

## 多文件与 `{{ref:xxx}}`

平台**不是 agent 环境**，LLM 拿不到文件工具、不会自己读引用文件。所以引用文件必须在服务端拼进 prompt：

- 在主文件里写 `{{ref:文件名}}`（可带或不带 `.md`）占位符
- `assembleSkillBody()` 运行时把占位符展开成对应引用文件的内容
- 未被主文件引用的 reference 会兜底追加到末尾；拼错的占位符原样保留（便于排查）

---

## 规范：如何给新功能接入 AI（3 步）

### 第 1 步：登记一个 slot（代码）

在 `server/src/services/skillRegistryService.ts` 的 `KNOWN_SLOTS` 加一行：

```ts
export const KNOWN_SLOTS: Array<{ slot: string; label: string }> = [
  // ...已有的
  { slot: 'your-feature', label: '你的功能 · 中文说明（后台展示用）' },
];
```

- `slot` 命名约定：`模块-动作`，全小写连字符，如 `xhs-ask`、`seo-score`。
- `label` 是后台「功能位绑定」表里显示的中文名。

### 第 2 步：在调用处取 skill（代码）

在你的 API/service 里，把原本硬编码的 prompt 换成：

```ts
import { getSkillForSlot } from '../services/skillRegistryService.js';

// 有绑定就用后台配置的 skill；没绑定返回 null，务必给一个兜底默认值
const prompt = getSkillForSlot('your-feature') || DEFAULT_PROMPT;

await aiGateway(
  { messages: [{ role: 'system', content: prompt }, { role: 'user', content: userInput }] },
  { userId, source: 'your-module', operation: 'your-feature' }
);
```

**必须遵守：**
- **一定要有 fallback**（`|| DEFAULT_PROMPT`）。`getSkillForSlot` 在未绑定 / skill 被禁用 / 组装为空时返回 `null`，功能不能因此挂掉。
- **所有 LLM 调用仍走 `aiGateway` / `aiGatewayStream`**，不要直接 new OpenAI（见 CLAUDE.md）。
- prompt 只负责“怎么做”，具体待处理的数据（文章正文、笔记内容等）作为 `user` 消息或拼在后面，不要塞进 skill。

### 第 3 步：在后台建 skill 并绑定（无需改代码）

1. 进 `/admin/skills`「所有 Skill」→ 新建 Skill（填 key / 名称 / 简介，创建后编辑主文件，可加引用文件）。
2. 回到「功能位绑定」，找到第 1 步登记的功能位，下拉选中刚建的 skill。
3. 立即生效，无需重启。

---

## 现有功能位一览（截至当前）

| slot | 功能 | 调用位置 | fallback |
|------|------|----------|----------|
| `xhs-ask` | 小红书 AI 陪写 | `server/src/api/xhs.ts` `/ask` | 内置 systemPrompt |
| `xhs-score` | 小红书爆款评分 | `server/src/services/xhs/scoringService.ts` | `SCORING_PROMPT` 常量 |
| `seo-score` | 文章 SEO 评分 | `server/src/api/discover.ts` | `skills/SEO_SCORE_SKILL.md` |
| `ai-detection` | 文章 AI 味检测 | `server/src/api/discover.ts` | `skills/AI_DETECTION_SKILL.md` |

## 后台能做 / 不能做

- ✅ 后台可做：给**已登记的** slot 换绑/解绑 skill；新建/编辑/删除 skill 及其多文件；预览展开后的最终 prompt。
- ❌ 后台不能做：凭空新增 slot。slot 必须由代码里的真实调用点定义，否则绑了也没有任何功能会读取它。

## 相关文件

- service: `server/src/services/skillRegistryService.ts`
- admin API: `server/src/api/skillRegistry.ts`（挂载于 `/api/admin/skill-registry`）
- 后台页: `client/src/views/admin/SkillRegistry.vue`（路由 `/admin/skills`）
- migrations: `030_skill_registry` / `031_skill_files` / `032_seed_more_skills`
