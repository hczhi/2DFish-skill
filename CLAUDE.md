# QiaoNan Platform (mmPla)

多模块平台：各子应用独立可用，共用一套鉴权和 AI 网关，聚合在一个导航页下。

## 协作方式（优先级高于本文件其余部分）

作者是唯一的测试者，独立开发。这里的规则是为了让他**每 15 分钟就有东西可点**，
而不是一小时后收到 8000 行改动。历史提交曾经单次 16192 行插入 —— 那不是高效，
那是把该分十次交付的活压成一次，中间他什么都测不了，出问题也无法二分定位。

### 切片交付

- **一次只做一个能单独验证的切片，目标 15 分钟。** 判据不是行数，是「他现在能打开哪个
  页面 / 在群里发哪句话，看到什么变化」。说不出这句话的，就不是一个切片。
- **做完就停，报告怎么测，等他确认。** 不要自动接着做下一片。
- **超过 3 个文件要新建、或需要新 migration + 新 action + 新页面同时落地，先说切法再动手。**
  给 2-4 条的顺序清单，第一条必须是能独立验证的。不要写完整设计方案。
- **切片顺序按「能不能被看见」排，不按依赖漂亮度排。** 后端 service 写完但没有入口 =
  零个可测切片。宁可先接一个粗糙的按钮/命令，再回头补内部结构。
- 探索性任务（读代码、查坑、定位 bug）不受 15 分钟约束 —— 直接给结论。

### 测试

只写一种测试：**出错时会伪装成成功的路径。**

判据是「这个 bug 发生时，他在界面/群里看到的是不是一句正常的成功回复」。是 → 写测试。
本文件下面记的坑几乎全是这类：派给错的人、改了别人的任务却回「已完成」、
总结了错的日期窗口却回「本周（08-03 至 08-09）」、两人同时 @ 时静默丢一条、
allowlist 拒绝时完全不出声。这些手测测不出来，所以必须有测试。

**默认不写测试**的：CRUD、参数校验、UI 渲染、happy path、「调了 A 就会调 B」这种 mock
转述、错误路径中会明确报错给用户的那些（他手测就看到了）。

写法约束：

- 一个行为一个 `it`，断言那个会骗人的**结果**（回复文案 / 落库的那一行 / 传给
  Feishu 的那个 open_id），不是中间调用次数。
- **不铺场景矩阵。** 同一条逻辑不要「有值/空值/超长/特殊字符」排四遍 —— 挑最容易出错的一个。
- 单个测试文件超过 300 行就停下来问，是不是在测不该测的东西。
  现有的 `diary.test.ts`(2316) / `dispatcher.test.ts`(897) 是历史包袱，
  **不要照着它们的密度写新测试**，改动它们时只删不加。
- 全量测试 33 秒（`nvm use 21.7.3 && cd server && npx vitest run`）。改完跑一次全量，
  别为单个功能反复跑。

### 文档

- **不新建设计文档。** 新增能力写成一条 bullet：**这个决定是什么 + 改错了会怎样静默出错**。
  平台级的（鉴权 / DB / AI 网关 / 部署）写本文件，模块内的写 `docs/modules/<模块>.md`
  —— 模块的坑写进本文件会让它继续超 40k 而被整份丢掉（那时**每一条**约定都不生效，
  而对话里看不出任何异常）。可从代码或 git log 读出来的事实不要写。
- `docs/` 下已有的长文档（FEISHU_ASSISTANT / FEISHU_DIARY / MODULE_DEVELOPMENT）
  **只在行为变了导致它说谎时才改**，不做例行同步。
- 不写变更日志、不写实现总结、不写 PR 描述式的收尾文档。
- 例外：`docs/API.md` 的新端点要补 —— 前端要照它调。

### 回复

改完直接报「做了什么 / 你现在测什么 / 有什么没做」，三句话量级。不复述代码，
不列文件清单，不写小结章节。不问要不要 commit —— 他自己提交。

## 三条贯穿全文的硬规则

1. **静默失败优先。** 下面每一条记的都是同一种事故：出错时用户看到的是一句正常的成功
   回复。任何丢弃、降级、部分成功、回落都必须出声，并且要说出**真实成因** —— 合成一句
   通用错误 = 指错方向，用户会一路重试/改 prompt，每次扣一次额度。
2. **`max_tokens` 是留给思维链的空间，不是正文长度。** 差额全在 `reasoning_content`：它算进
   `max_tokens` 却不出现在 `content` 里（库里同一个 deepseek-v4-flash，这个差额在 0 到
   9700 之间乱跳），所以症状是**「有时」格式错误、「有时」空返回**，完全指不到额度上。
   吐 JSON 的端点一律走 `core/llm/parseJson.ts` 的 `jsonGateway`（平台唯一实现，不要再
   写 `/\{[\s\S]*\}/`），报错一律走同一份 `jsonFailMessage`（consult 的 `gateFailMessage`
   就是它 —— 各写一份的话改了一边另一边照旧，而两边是同一个模型的同一个毛病）：
   **空返回 / 截断 / 没按 JSON 回**三种成因解法完全不同，且报错里必须带思维链 token 数
   —— 不带的话用户只会一路调高
   `max_tokens`，而那个数字永远调不完。`finish_reason=length` **不重试**（同样的 body 断
   在同一处，只是把 token 和时间花两遍）。调低这些数不省钱（按实际用量计费），只是把偶发
   的长思维链变成确定性失败。
3. **会算错的格式不交给 LLM。** id、时间窗口、数据源级别一律在代码里算，prompt 里连示例
   都不出现（有测试断言 `/ou_[a-z0-9]{4,}/` 不出现在意图 prompt 里）。模型编一个 guid 可
   能撞上别人的任务、编一个日期窗口会总结错的几天、说自己是「L1 联网检索」的那一刻那句话
   就是免费的 —— 三种都不报错，输出读起来完全正常。

## Quick Start

```bash
cd server && npm install && cd ../client && npm install
cd .. && npm run dev          # server :3001, client :5173
```

默认管理员 `admin / 123456`（首次登录后改）。Node 必须 21.7.3（`better-sqlite3` 原生模块）。

## 架构与约定

```
client/src/{components,views}/<module>/  lib/api.ts  router/
server/src/{api,auth,core/llm,db,services}/
skills/  workspaces/  docs/
```

- **后端** ESM，import 带 `.js`；`api/` 一个模块一个 Router 且要薄（校验 → service → 响应），
  业务逻辑在 `services/`。
- **所有 AI 调用走 `core/llm/gateway.ts`**，不要自己 new OpenAI。
- **DB** better-sqlite3。改表加 `db/migrations/NNN_x.ts` 并在 `migrations/index.ts` 注册，
  启动自动跑。**迁移里不能调飞书/网络接口** —— 一次网络抖动会让服务起不来；需要建远端结构的，
  做成「下次用到时补建」（见任务管理表）。
- **鉴权** 三档在 `auth/middleware.ts` 配：PUBLIC 不校验 / OPTIONAL 有 token 才解析 /
  PROTECTED 无 token 回 401。所有调 AI 的端点都是 PROTECTED。**不在 `/api/` 下的路径一律
  OPTIONAL**（那是 client/dist 和 SPA fallback）：浏览器的文档请求从不带 Authorization 头，
  跟着默认值判成 PROTECTED 的话整站在 Express 上是一句 `Authentication required`
  （RELEASE.md 的方案 A 就是全部转发给 Node），而 iframe 嵌入死得更隐蔽 —— 第一个文档请求
  就 401，第三方页面上是一块白，而 pk / 白名单 / frame-ancestors 全是配好的、每个接口都
  200。页面级权限在前端路由守卫和各 API 端点上，不在这里。
- **前端** Vue 3 `<script setup lang="ts">`；请求一律走 `lib/api.ts`（自动带 token、处理 429）；
  路由 `meta.requiresAuth / requiresAI / requiresAdmin`。
- 新模块：`api/` 建 Router → `app.ts` 注册 → `views/<module>/` → `router/index.ts` 加 meta
  → `Home.vue` 加卡片。

## AI 网关与配额

- 登录用户 10 次/天（管理员可按人调），匿名 3 次/天按 IP+UA 指纹隔离（`auth/requester.ts`），
  超了 429，每天 0 点（服务器时间）重置。平台 key 存库里的 `system_config`，不在 .env。
- 文本调用一律 `resolveLLMProvider(tier, userId)` 从 `ai_providers` 解析，两条互斥的路：
  **平台渠道**（`owner_user_id IS NULL`）按 请求 tier → `default` → 旧的
  `system_config.platform_*` 回落；**专属渠道**（管理员在 用户管理 > 专属 AI 打开
  `use_dedicated_ai`）只用该用户自己的接入点，**没有平台回落**，缺档位抛
  `DedicatedChannelError`(503) 而不是悄悄花平台的钱 —— 也因此三档必须齐（不齐管理员 API
  不让开这个开关）。专属渠道**绕过账号总配额**（烧自己的 key），但仍受应用额度限制。
- 档位：`strong` = 要 `response_format: json_object` 的结构化任务（xhs
  structure/validate/diagnose、标讯画像、飞书意图解析），`fast` = 大段散文，`default` =
  其余（chat / 咨询 / ui-review / fish）。平台渠道**可能压根没有 strong 那一档**（回落
  default），所以「换成强模型」不是格式错误的解法。
- **解析通道 `GatewayOptions.channel`（`core/llm/apps.ts` 的 `AI_CHANNELS`，目前只有
  `extract` = 文件/图片内容提取）只影响「用哪条接入点」，配额和 `ai_logs.source` 一律还记在
  `source` 上。** 存在的理由是「应用」这一维太粗：给 consult 配一条就把对话和出草稿一起换掉了，
  而想换的只有提取那两步（`consult:extract-image` / `consult:tidy-file`）。三条不能动的边界：
  ① 通道**不进 `AI_APPS`** —— 没有任何调用点写 `source: 'extract'`，进去会让 `aiAppRegistry`
  反向断言变红，更要紧的是后台「按应用额度」会多出一个配了永远不触发的选项（界面显示
  「已限 10 次/天」而实际不限）。所以 provider 的 scope_app 校验用 `isValidProviderScope`（宽），
  额度校验仍用 `isValidAppScope`（严）；② 扣额度/写日志**不能**跟着 channel 走，跟了的话提取
  变成不计任何应用额度的免费调用，而后台那条限额看起来还配着；③ 解析只在
  `gateway.ts` 的 `resolveForCall` 一处（两个入口共用）—— 各写一遍的话新加的维度永远只加在
  一个入口上，漏掉的那个静默解析成另一条接入点（流式那条的症状只是「首字慢一点」）。
  没配这条通道时行为和以前完全一样（回落到按应用+档位解析）。
- `ai_logs.provider_id / provider_owner` 记哪把 key 付了这次的钱。
- **`maxRetries: 0` 关掉的只该是「重试超时」，别把「上游忙」也关掉。** 那几条写死 0 的路径
  （consult 出草稿/整理、图片识别）是因为同一个 body 第二次还在同一处超时，重试只把等待翻倍；
  但上游回的 `503 system cpu overloaded (current: 97.5%)` 是另一回事，隔几秒重发基本就过。
  用 `GatewayOptions.retryOnBusy`（429/5xx 才算，连接超时的 status 是 undefined 所以不算），
  **重发在扣额度之后、在同一次 `aiGateway` 里，所以额度只扣一次** —— 调用方自己 catch 再来一遍
  的话那是新的一次调用，会再扣一次。这类失败的话术必须和「配置错了」分开：透原文出去读起来
  像我们坏了，用户会去改文件、调参数、一分钟点五次（每次真扣一次），而问题压根不在他那边。
- **关思维链是唯一让一条路径快起来的开关（`GatewayOptions.noThinking`），实测同一条接入点
  36.6 秒 → 3.5 秒，而正文还长了一点。** 耗时几乎全花在没人看得见的那一段思考上，「上下文太长」
  不是原因（输入拉 16 倍只多 2 秒），所以想快就动这个开关，不是砍 prompt。它在**吐 JSON 的
  路径上治的其实是截断**：思维链算进 `max_tokens` 却不进 `content`（硬规则 2），标讯抽取的
  「提取到 0 条」和评分的「解析失败」都是它。四个键一起发（各家网关认的不是同一个），严格的
  网关回 400 就**摘掉重发并喊一句** —— 不重发的话换条接入点之后整个模块变成一句 400；发出去
  也不等于生效（宽松网关对不认识的键既不报错也不照办），所以还要回头核 `reasoning_tokens`
  并在没关掉时喊出来。两处入口（`aiGateway` / `aiGatewayStream`）都要认，只在一处认的话
  流式那条静默照旧慢，而现象只是「首字来得慢」，看起来像网络。
- **上游 400 有两种，退法不同，别合成一支。** ①「不认识这几个键」（OpenAI 官方那句
  «Unrecognized request argument»）→ 把四个键**摘干净**重发；②「这个模型**始终思考、
  关不掉**」（实测 glm-5.3-flash：«该模型始终思考，不支持关闭思考；请使用 low、high 或
  max。» —— 它拒的是 `minimal` 这个值）→ 退到 `LOW_EFFORT_BODY`，也就是**只发
  `reasoning_effort: 'low'` 这一个键**，连 low 都被 400 才抛 `NoThinkingUnsupportedError`
  （`app.ts` 全局处理器透原文回 502 + `code: no_thinking_unsupported`）。第二种要是也摘干净，
  换来的是一次**思维链全开**的调用，而写 `noThinking: true` 的那几条路关它治的正是截断 ——
  悄悄退回全开之后现象只是「抄到一半就断了」「解析失败」，谁都想不到是模型选错了；
  选 low 不选 high/max 同理（这条退路的意义就是把思维链压到最短）。只发一个键是因为另外三个
  是不是也被拒无从判断，一起再发很可能换来第二次同样的 400。识别这条 400 的
  `isAlwaysThinking` 认不出新的文案时，退化成透传上游原文（读起来像我们坏了），
  所以碰到新的网关文案要往那两条正则里加，而不是回去改成「一律摘干净」。
- **退到 low 之后它还在想，所以 `aiGateway` 回一个 `noThinkingRefused`，调用方那句话必须跟着分岔。**
  这是个降级（硬规则 1）：跑成了，但思维链照旧和正文分同一份 `max_tokens`，症状是**偶发**的
  「抄到一半就断了」。不分岔的话报错/提示里写的是「去「AI 模型 Provider」勾上「关思维链」」——
  而那个勾选框在这条接入点上是死路：他勾了、列表上写着「已关闭」，现象一模一样，他只会
  反复回去核那个开关。目前分岔的两处都是**报错**话术（`imageExtractService` / `fileTidyService`
  的「模型一个字都没返回」）—— 成功态的 `notes` 里压根不再提思维链这件事（用户改不了，而它每次
  提取都会出现；管理员的线索在 `console.warn` 和后台那个「测试」按钮上）。
  流式入口不回这个标记（它压根不报 token 数），加新的 `noThinking: true` 路径时记得看一眼。
- **连通测试（`POST /providers/:id/test`）在主请求之后**多发一次带那四个键的最小请求
  （`probeNoThinking`），把结论回在 `no_thinking.{verdict,note}` 里。理由是上面那种失败
  **在配置阶段完全看不出来** —— glm-5.3-flash 连通 ✓、回复正常，而管理员唯一的线索是用户来说
  「提取出来的资料不全」，而每次失败都真扣一次额度。四个 verdict 各对应一句不同的话（能关 /
  发了但它照旧想了 `reasoning_tokens` 个 / 这个模型关不掉=运行时退到 low、长文件有截断风险 /
  这条网关不认这几个键=运行时摘干净重发）。
  两条边界：① 键从 gateway 里 import（`NO_THINKING_BODY`/`NO_THINKING_KEYS`/`isAlwaysThinking`），
  在 admin 里另抄一份的话后台会显示一个和业务实际发的对不上的假结论；② 探测自己失败
  （超时等）**不改连通结论**，只说「没测出来」—— 让它翻红的话「key 错了」和「关不掉思考」
  会混成同一句。两个后台页面（`SystemConfig.vue` / `DedicatedAi.vue`）都要把 note 显示出来
  且 `.test-result` 要 `white-space: pre-line`，漏一个的话在那个页面上配的接入点照旧只有一句
  「连通 ✓」（专属接入点全在 DedicatedAi 那页配）。
- **后台那个开关是 `ai_providers.no_thinking`（087），和调用方传的值取「或」—— 只能强制关，
  开不回来。** 能强制开的话，标讯抽取/评分、consult 对话/草稿那几条写死 `noThinking: true` 的
  路径会被后台一个勾选框换回慢的那一版，而那几处关它治的是截断和「等四分钟」，退回去之后现象
  只是「怎么又解析失败了」。不放在 `extra_json` 里：那是个自由文本框，键名拼错完全静默
  （保存成功、界面和生效了一模一样）。列表/卡片上必须显示它，只在编辑表单里的话「这条为什么
  答得这么浅」得逐条点开才看得出来；`upsertProvider` 里按 `!== undefined` 保留旧值（写成
  `data.no_thinking ? 1 : 0` 的话，任何一次没带这个字段的编辑都会把它悄悄关掉）。
  旧 `system_config` 那条回落没有这一列，缺省 false —— 凭空给 true 等于升级之后全站悄悄不想了。
- **参考图（图生图）走 `generateImage(prompt, { refImages })`，图**在我们这边读成字节**再走
  `/images/edits` 的 multipart，不把地址转给上游。** 转地址的话 COS 没配时那种 `/uploads/...`
  上游压根拉不到，而**网关拉不到参考图基本不报错，直接当文生图出一张**：接口 200、图也好看，
  只是跟参考图无关（他会一路重生，每次真扣一次额度）。同理**认不了参考图的协议必须抛错**
  （dashscope 原生文生图端点就是）、**少一张参考图也抛错**，不许悄悄丢 —— 丢掉之后和上面那种
  回落成文生图一模一样。少数网关只认「generations 的 body 里塞 image」，那种在 extra_json 里写
  `{"ref_mode":"body"}`，而**拼错的值直接抛错**（静默回落成 edits 的话他会以为这条接入点就是
  不支持参考图，而真正的动作只是改一个字）。连通测试因此会**真生成 2 张图**：第 2 张
  （`probeRefImage`，拿第 1 张当参考图）只回在 `ref_image.{verdict,note}` 里，
  verdict 只说「接住了」**不说「照着画了」** —— 网关把参考图那一份丢掉时照样 200，
  这两件事我们区分不了，说满了他会去怀疑自己挑的参考图。探测自己失败不改连通结论
  （同 `probeNoThinking`），两个后台页面都要显示这条 note。

## 对外中转接口（专属渠道下发的 key，082）

- **一把 key 绑死一条 `provider_id`，不按档位解析。** 按档位解析时，同档有第二条接入点它会
  挑「最近更新的那条」—— 管理员停用第一条之后下游照样通，只是换了模型、换了付钱的 key，
  回复读起来完全正常。绑死这一行才做得到「接入点关了就访问不了」。模型因此由接入点决定，
  body 里的 `model` **明确忽略**（下游填错模型名不该整个调用失败），所以返回里必须回**真实**
  模型名 —— 那是他唯一能发现「答的不是我选的模型」的地方；`GET /v1/models` 同理只列绑定那一个。
- **删接入点必须同时把绑上去的 key 标废**（`aiProviderService.deleteProvider` →
  `revokeRelayKeysByProvider`），不能只靠调用时「查不到那条 provider 就拒」：provider 的 id
  是外部可指定的（种子那条就叫 `default-llm`），删掉再建一条同 id 的之后，那把早该失效的 key
  会自己活过来 —— 所以 `revoked_at` 是一列而不是 DELETE。吊销条数要回给后台并显示出来：
  删接入点的人不一定知道有下游在用它，不说的话那几个下游明天开始收到「接口已关闭」，
  而这边只看到一句「已删除」。
- **对外一律回「接口已关闭，请联系管理员」**（停用 / 删除 / 专属开关关了都算），库里存
  `revoke_reason` 给管理员看。反过来 `findRelayKeyByRaw` 对已吊销的行**照样返回**：在那里当
  不存在的话，「key 抄错了」和「接口已关闭」会合并成一句「无效的 API Key」，下游只会一直去
  核对那把没抄错的 key。
- **`/api/v1/*` 是 public，校验全在 `relayService.authorizeRelay`。** 走 protected 的话
  authMiddleware 先回一句 401 «Invalid or expired token»，下游只会以为自己那把 key 废了。
  `providerId` 要在 `aiGateway` **和** `aiGatewayStream` 两处都认 —— 只在一处认的话另一处会
  静默用回按档位解析出来的那条。用量记 `ai_logs.source='relay'`，限流是 `ai_app_quota` 的
  `app='relay'`。
- **不支持的东西必须明确 400，不能悄悄丢**：`stream: true`（无声忽略 = 客户端等一个永不到来
  的 SSE，界面上是「AI 没回答」）、`tools`/`functions`（剥掉之后模型用普通文字回答，而客户端
  在等 tool_call，看起来像模型不肯调工具）。
- **错误体一律 OpenAI 形状 `{error:{message,type,code}}`。** 第三方客户端只认这个，回我们自己
  的 `{error:"…"}` 会被显示成空白或「未知错误」。上游失败要把原文带出去（502），否则
  「模型名不对 / 上游余额不足」只有我们日志里有。
- key 只存 sha256，明文只在生成那一次返回，另存一段 `key_prefix` 供辨认 —— 后台三把 key 长得
  一样时管理员会吊销错那一把，而两把都显示「已吊销/仍有效」，看不出挑错了。前端复制失败必须
  出声（静默失败 = 那把 key 只能重新生成）。

## 业务模块（改哪个模块，先读它那份）

每份文件里的每一条都是踩过一次的坑，写法和本文件一致：**这个决定是什么 + 改错了会怎样静默
出错**。不读就改的后果不是编译不过，是那一处退回旧行为而界面上一切正常。新增能力写成对应
文件里的一条 bullet，不新建设计文档。

| 模块 | 入口 | 文件 |
| --- | --- | --- |
| 飞书助理 | 群里 `@` 机器人（零公开路由） | `docs/modules/feishu-assistant.md` |
| 标讯 | `/tender`、多维表格推送 | `docs/modules/tender.md` |
| 智慧看板 | `/board` | `docs/modules/board.md` |
| 小红书写作台 | `/xhs` | `docs/modules/xhs.md` |
| HTML 展示稿 | `/ppt` | `docs/modules/ppt.md` |
| 品牌咨询 | `/consult`（含第三方 iframe 嵌入 084-086） | `docs/modules/consult.md` |

长文档另有：`docs/FEISHU_ASSISTANT.md`（飞书助理完整设计）、`docs/FEISHU_DIARY.md`（项目
日记）、`docs/MODULE_DEVELOPMENT.md`、`docs/API.md`（新端点必须补）、`docs/RELEASE.md`。

## 环境变量

```
PORT=3001
JWT_SECRET=your-random-secret-here
CONFIG_ENCRYPTION_KEY=...      # 库里第三方密钥用它做 AES-GCM；没配时别轮换 JWT_SECRET
```

平台 API key 存库里的 `system_config` 表，不在 .env。
