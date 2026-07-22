# 对外集成开发规范

本文档沉淀两类「平台与外部系统对接」的通用模式，供后续开发同类功能时参考：

1. **前端 SDK 封装** —— 让第三方纯前端项目安全地调用平台能力（以「标讯智能推荐 SDK」为范例）
2. **外部消息推送** —— 平台事件触发后推送到外部 IM（以「评分完成 → 飞书群机器人」为范例）

两者的共同哲学：**对外开放能力时，安全边界不能依赖"保密"，而要依赖"绑定 + 白名单 + 最小权限"，且失败必须降级、绝不拖垮主流程。**

相关文档：[MODULE_DEVELOPMENT.md](./MODULE_DEVELOPMENT.md)（子模块开发）、[API.md](./API.md)（鉴权模型）、[SECURITY_FIXES.md](./SECURITY_FIXES.md)。

---

## 一、前端 SDK 封装规范

### 1.1 适用场景

第三方希望在**自己的页面里**展示/调用平台的某项能力，且第三方**只有前端、没有后端**（无法安全保存密钥）。

典型代表：标讯智能推荐 SDK（`sdk/`）。

### 1.2 核心安全模型

纯前端场景下，任何写进第三方页面的凭证都是公开的（F12 可见）。因此**不能用"藏密钥"来保证安全**，而是靠三道防线：

```
Publishable Key (pk)   公开，写在第三方页面 JS 里，不怕看
    ├─ 绑定固定 user_id       ← 推荐/数据归属，后端写死，前端改不了
    └─ 绑定 allowed_origins   ← 域名白名单
         ↓
POST /sdk/token   校验 pk + Origin/Referer 白名单 → 签发短期 token
    └─ 短 token scope=xxx:read   ← 最小权限，只读，碰不到写/别的用户/admin
         ↓
SDK 用短 token 调只读接口，到期前自动续期
```

**三道防线：**

| 防线 | 作用 | 实现位置 |
|------|------|----------|
| pk 绑定 user_id | 数据归属固定，前端无法冒充其他账号 | 签发 pk 时写死在 DB |
| Origin 域名白名单 | 别的网站盗用 pk 也换不到 token | 换取 token 时校验 `Origin`/`Referer` |
| scope 最小权限 | 短 token 只能访问白名单只读端点 | 鉴权中间件 + 端点闸门 |

> ⚠️ **已知边界**：`Origin`/`Referer` 头可被非浏览器请求伪造，因此此模式**只适用于只读、低敏感数据**。短 token 必须锁死为只读；即使被滥用，最坏也只是多读了绑定账号的只读数据，改不了任何东西。敏感/可写能力**不得**用纯前端 SDK 暴露。

### 1.3 后端实现要点（对照 `server/src/api/tenderSdk.ts`）

**A. 数据表** —— 存 pk（参考迁移 `034_sdk_keys.ts`）

```sql
CREATE TABLE sdk_keys (
  pk TEXT PRIMARY KEY,              -- pk_live_<hex>，公开
  user_id TEXT NOT NULL,           -- 绑定归属账号
  name TEXT DEFAULT '',            -- 备注
  allowed_origins TEXT DEFAULT '[]', -- JSON 数组白名单
  enabled INTEGER DEFAULT 1,
  rate_limit INTEGER DEFAULT 60,   -- 每分钟换取上限
  created_at TEXT NOT NULL,
  last_used_at TEXT
)
```

**B. Token 换取接口** —— `POST /sdk/token`，级别 **PUBLIC**

- 校验 `pk` 存在且 `enabled`
- 校验请求 `Origin`（退回 `Referer`）归一化后命中 `allowed_origins`
- 按 pk 内存限流
- 用 `getJwtSecret()` 签发短 JWT：`{ id: userId, username, role: 'user', scope: 'xxx:read', exp: 15min }`

**C. 鉴权中间件识别 scope**（对照 `server/src/auth/middleware.ts`）

解析出带 `scope` 的 JWT 时：
- **强制 `role = 'user'`** —— scope 短 token 永远不能触及 admin 门槛
- 记录 `req.tokenScope`，标记 `authMethod = 'sdk'`

**D. 端点闸门** —— 挂在模块 router 最前面

带 scope 的短 token 只放行白名单只读端点，其余一律 403：

```ts
if (req.tokenScope === SDK_SCOPE) {
  const allowed = SDK_ALLOWED_PATHS.some(re => re.test(req.path));
  if (!allowed) return res.status(403).json({ error: '...read-only...' });
}
```

**E. CORS —— 最容易踩的坑（务必看）**

第三方域名不在平台全局 CORS 白名单里，而全局 `cors()` 中间件会**短路 OPTIONS 预检并拒绝**，请求根本到不了模块路由。

✅ **正确做法**：在 `app.ts` 里、**全局 `cors()` 之前**，为 SDK 相关路径单独加 CORS 中间件，处理预检并回显 `Origin`：

```ts
// 必须在 app.use(cors({...})) 之前
app.use('/api/<mod>/sdk/token', (req, res, next) => {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  }
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  next();
});
```

> ⚠️ 浏览器发的**预检 OPTIONS 不带 `Authorization` 头**，所以不能靠 Bearer 判断是否放行 CORS，只要有 `Origin` 就回显。真正的准入靠 JWT + scope 闸门，CORS 放行 ≠ 授权。

### 1.4 SDK 产物规范（对照 `sdk/`）

- **独立目录 `sdk/`**，自带 `package.json` / `vite.config.ts` / `tsconfig.json`，不与主 app 构建耦合。
- **打包 ESM + UMD 双产物**：`tender-sdk.js`（`import` 用）、`tender-sdk.umd.cjs`（`<script>` 用）。UI widget 用动态 `import()` 分包，只用数据 API 时不加载 UI 代码。
- **SDK 内部职责**：用 pk 换 token → 缓存 → 到期前静默续期 → 401 自动重试一次；对外只暴露只读方法（`getXxx()`）和可选 `mountWidget()`。
- **交付方式**：不发 npm，由后端把 `sdk/dist` 静态托管在 `/sdk/`（`app.ts`），第三方 `<script>` 或 `import 'https://<host>/sdk/xxx.js'` 直接引用。
- **构建接入根脚本**：根 `package.json` 的 `build` 必须先 `build:sdk`，避免部署漏打包导致 `/sdk/*` 404。

### 1.5 Admin 管理 + 文档

- Admin 后台提供 pk 的 CRUD（创建/绑定账号/配白名单/启停/删除），对照 `TenderManagement.vue` 的「SDK 接入」tab。
- 用户端提供一个**只读文档页**（应用内路由，如 `/tender/sdk-docs`），说明如何接入；pk 由 admin 线下发放。

### 1.6 新建一个前端 SDK 的 Checklist

- [ ] 迁移：建 `<mod>_keys` 表（pk / user_id / allowed_origins / enabled / rate_limit）
- [ ] `POST /<mod>/sdk/token`：校验 pk + Origin 白名单 → 签发 scope 短 token；加入 `ROUTE_AUTH_CONFIG` 为 PUBLIC
- [ ] 中间件：识别 scope，强制降 role 为 user，记录 `tokenScope`
- [ ] 端点闸门：scope token 只放行白名单只读端点
- [ ] **CORS：全局 `cors()` 之前**为 `/api/<mod>/sdk/token` 和数据端点单独回显 Origin + 处理 OPTIONS
- [ ] Admin CRUD 接口 + 后台管理 UI
- [ ] SDK 产物：ESM+UMD 打包，token 自动续期，只读方法
- [ ] 后端静态托管 `sdk/dist` 到 `/sdk/`；根 `build` 接入 `build:sdk`
- [ ] 用户端文档页
- [ ] 生产验证：`NODE_ENV=production`（CORS_ORIGIN 未配）下跑通预检+换取+越权 403

---

## 二、外部消息推送规范

### 2.1 适用场景

平台某个事件发生后（评分完成、任务结束、审核通过……），把结果推送到外部 IM（飞书 / 企业微信 / 钉钉 / Slack）。

典型代表：评分完成 → 飞书群机器人推送高分标讯（`server/src/services/tender/feishuNotify.ts`）。

### 2.2 IM 机器人的两种形态（选型第一步）

| 形态 | 能力 | 能否点对点私聊 | 配置成本 |
|------|------|----------------|----------|
| **群自定义机器人（Webhook）** | 往一个群发消息 | ❌ 只能发到群 | 极低：群里加机器人拿一个 URL |
| **企业自建应用（App Token）** | 给指定用户私聊、发卡片 | ✅ 真正点对点 | 高：建应用 + 配权限 + 用户 ID 映射 |

**默认优先群 Webhook**：如果"发到某个团队群"可接受，就别上自建应用。标讯推送即采用群 Webhook，"指定用户"= 给每个用户配各自的群 webhook。

### 2.3 核心设计原则

1. **配置 per-user 且可开关**：推送目标（webhook）、阈值、开关都存在用户维度（复用 `tender_user_preferences`，参考迁移 `035_tender_feishu.ts`），admin 后台配置。
2. **推送内容用富文本卡片**：飞书 `interactive` 卡片，带标题、明细行、**原文链接**、超出条数显示"共 N 条"。
3. **失败降级，绝不拖垮主流程**：推送整段 `try/catch`，失败只 `onLog` 记一行日志，评分/主任务照常完成。
4. **可选签名校验**：机器人开启加签时，用 secret 算 HMAC-SHA256 签名（`${timestamp}\n${secret}` 为 key 对空串摘要，Base64）。
5. **提供"发送测试消息"接口**：admin 配完能一键验证 webhook 是否可用。

### 2.4 推送触发点的挂载

在"一个逻辑单元完成"的边界挂推送，**汇总成一条**，而非每条结果发一次（避免刷屏）。

标讯的做法（对照 `recommendService.ts`）：
- 进入用户评分循环前，读该用户的 feishu 配置，建一个 `items` 收集器
- 每条评分达到阈值（`tier != filter` 且 `score >= min_score`）就收集
- 该用户所有标讯评完后，一次性推送收集到的 items

```ts
// 循环内收集
if (feishuOn && score.tier !== 'filter' && score.totalScore >= feishuMinScore) {
  feishuItems.push({ title, purchaserName, totalScore, tier, budgetAmount, regionName, url });
}
// 循环后推送（失败不影响主流程）
if (feishuOn && feishuItems.length > 0) {
  try {
    const r = await pushXxx(webhook, secret, feishuItems, Date.now());
    onLog?.(r.ok ? `已推送 ${feishuItems.length} 条` : `推送失败 code=${r.code}`);
  } catch (e) { console.error(...); onLog?.(`推送异常：${e.message}`); }
}
```

> 注意：**卡片里要带原文链接**，别忘了在数据源查询里 SELECT `url` 字段（标讯曾漏 SELECT `url` 导致链接缺失）。链接指向平台内详情页还是外部原文，按需选择。

### 2.5 推送服务的封装（对照 `feishuNotify.ts`）

- **独立 service 文件**，输入结构化 items，内部负责组卡片 + 签名 + POST + 解析返回码。
- **纯函数式，不依赖请求上下文**：`push(webhook, secret, items, nowMs)`，`nowMs` 由调用方传入（便于测试）。
- **卡片安全**：对标题等用户/外部内容做 markdown 转义（`[ ] ( )`），避免破坏卡片渲染。
- **限制条数**：单条消息最多列 N 条，超出显示汇总数，附"登录平台查看更多"。
- **返回统一结果**：`{ ok, code, msg }`，兼容飞书 `code` 与旧 `StatusCode` 两种返回格式。

### 2.6 新增一个外部推送的 Checklist

- [ ] 选型：群 Webhook（默认）还是自建应用
- [ ] 迁移：在用户偏好表加 `<im>_webhook` / `<im>_secret` / `<im>_enabled` / `<im>_min_score`（或对应阈值）
- [ ] 推送 service：组卡片 + 可选签名 + POST + 统一返回；内容转义、限条数、**带原文链接**
- [ ] 触发点：在逻辑单元完成边界收集并汇总推送；整段 `try/catch` 降级
- [ ] Admin 接口：`GET/PUT /<mod>/<im>/:userId` 读写配置 + `POST .../test` 测试消息
- [ ] 后台 UI：选用户 → 配 webhook/阈值/开关 → 保存 + 一键测试
- [ ] 数据源查询记得 SELECT 链接字段
- [ ] 用 mock 接收端验证卡片结构、签名、转义、返回码

---

## 三、两类功能的共性小结

以后做任何"对外开放能力"的功能，牢记：

1. **安全靠绑定 + 白名单 + 最小权限，不靠保密。**
2. **CORS 放行 ≠ 授权**——跨域头只影响浏览器能否读响应，真正的准入永远在鉴权层。
3. **对外调用/推送必须降级**——外部不可控，失败要 `try/catch` 并记录，不能拖垮主流程。
4. **配置进 DB、可后台管理、可测试**——不硬编码 webhook/密钥，提供测试入口。
5. **产物与主 app 解耦**——SDK 独立打包，推送逻辑独立 service。
