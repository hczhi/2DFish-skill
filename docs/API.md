# API Reference

Base URL: `http://localhost:3001`

## Authentication

所有请求使用 Bearer token 鉴权：
```
Authorization: Bearer <jwt_token_or_module_token>
```

**两种认证方式：**
| 方式 | 格式 | 来源 | 用途 |
|------|------|------|------|
| JWT Token | `eyJ...` | 用户登录获取 | Web 前端交互 |
| 模块 Token | `mmPla_...` | Admin 后台为用户生成 | 第三方 API 调用 |

模块 Token 绑定到 (用户, 模块)，只能访问该模块白名单内的 API 路径。

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
返回当前用户信息（id、username、role）。

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

所有用户统一使用平台 API Key，受每日额度限制。Admin 可为单个用户调整额度上限。

---

## AI Endpoints

所有 AI 端点为 `PROTECTED`，每次调用消耗 1 额度。

### POST /api/ai/fish/decide
Fish tank AI 决策。

### POST /api/ai/fish/knowledge
根据兴趣生成知识卡片。

### POST /api/ai/fish/story-event
生成鱼缸故事事件。

### POST /api/ai/board/chat
智慧板 AI 回复。
```json
{ "message": "我很迷茫", "mode": "wisdom" | "dark" }
```

---

## Chat (Synap)

### GET /api/chat/messages `PROTECTED`
### DELETE /api/chat/messages `PROTECTED`
### POST /api/chat/stream `PROTECTED`
SSE 流式端点，消耗额度。

---

## Consultant

### GET /api/consultant/messages `PROTECTED`
### DELETE /api/consultant/messages `PROTECTED`
### POST /api/consultant/stream `PROTECTED`
SSE 流式端点，消耗额度。

---

## 品牌咨询工作台 (/consult)

一个品牌 = 一个项目，14 步（四看 / 四问 / 四大成 / 第二层内容营销 / 第三层数字化营销）。全部 `PROTECTED`。
`lane` 有三个值，决定这一步走哪条接口：`fast` 和 `plan` 都走 `/draft`，`slow` 走
`/decisions` → `/decisions/apply` → `/draft`（先拍板方向，再照它出**一份**正文）。
`slow` 的老路 `/directions`（AI 出 2–4 份完整方案给他挑）接口还在，但**界面上已经没有入口** ——
只用来恢复老项目里已经出过的方向卡。
前端分组顺序**按 `GET /stages` 返回的顺序推**，不写死分组名清单 —— 写死的话新增的分组
在左栏里完全不存在，而进度数和解锁全是对的，界面上看不出少了几步。

### GET /api/consult/stages
阶段清单（key / label / group / lane / question / requires / **method** / deliverables）。前端不写第二份。
`method` 是这一步的**分析操法**（方法论规定的推导顺序与判断标准）—— 和进 prompt 的是同一份，
界面上要照原样显示：正文对不上它的顺序就是没照方法论推，而那种正文和推出来的长得一样。

### GET /api/consult/projects
每行带 `decided_count / stale_count / total_stages / brief_chars` 和
`intake_pending`（还没提交的问卷轮数）+ `intake_rounds`（已补进资料的轮数）。
`intake_pending` 前端必须显示出来 —— 那一轮没提交就意味着客户资料还缺一块，
而这一行的进度数照样在涨，和资料齐全的项目长得一模一样。

### POST /api/consult/extract-file
`multipart/form-data`，字段名 `file`，一次一个（前端逐个传，最多 5 个）。**不落库、不存原文件**
（图片也是 base64 直接进请求，不转存 COS —— `file.qiaonan.vip` 是公开的）。
按**文件头**分派两条路，回 `{ filename, ext, kind, text, chars, notes, aiCalls, tidied,
briefLimit, budgetChars, fileLimit, maxFiles, maxImageBytes, tidyPlan:{calls,chunkChars,maxChars} }`
（`fileLimit` = 单份字数上限，**0 = 不限**；咨询这条回 3500）：

- `kind:'file'`（.txt/.md/.docx/.doc/.pptx/.pdf）：程序提取，`aiCalls: 0`、`tidied: false`，
  另带 `emptyPages` = 有几页一个字都没读到（整页是图）。前端把它显示在卡片的字数那一行
  （`· N 页没读到`）而**不是**塞进 `notes` 的黄框；一个字不说也不行 —— 剩下那些页拼起来读着完整，
  没人会发现少了几页，而这几页的解法是导成图片单独传。
  PDF 只读**文字层**，最多 200 页（截了页要看 `notes`）；
  整份没有文字层（扫描件）→ **400 并让用户把那几页导出成 PNG/JPG 当图片传**（不做服务端栅格化）。
- `kind:'image'`（.png/.jpg/.jpeg/.webp/.gif，单张 ≤ `maxImageBytes` 5MB）：**一次 AI 调用**，
  `aiCalls: 1`、`tidied: true`（读图那一次已经按同一套 `##` 类目归好，前端**不要**再调
  `/tidy-text`，那是白花第二次额度），另带 `overBudget`、`truncated`、`reasoningTokens`。
  模型回 `NO_IMAGE`（网关把图悄悄丢了、default 档配的是纯文本模型）→ **502 并点名成因**；
  图里一个字都没有（纯产品照）→ **照样 200**，`text` 是模型对画面的描述，`notes` 里那一条
  明说「这是描述，不是图里的原文」（模型连描述都没给才 400）。`.heic/.bmp/.tiff/.avif`
  在**花额度之前**拒掉并说怎么转成 JPG。

`notes` 是「**这一份的结果和你以为的不一样**」，只放真出了问题的那几条（文本框漏字、GBK 乱码、
扩展名和真实格式不一致、截断、图里没字只有描述）。顺利读完的那一份 `notes` 是**空数组** ——
「每份都提醒一句」的那些话已经删掉了（每次上传一片黄框，真出问题的那条就淹在里面）。前端必须显示。
`aiCalls` 必须显示在卡片上 —— 一次「提取」静默扣掉他今天 10 次里的一次是这条路最容易发生的静默扣费。
`tidyPlan.calls` 是**服务端算的**整理调用次数，前端不许自己按字数除（会和真实扣费漂开）。

### POST /api/consult/tidy-text
`{ filename, text }` → 交给模型提炼（只删不编）。回 `{ text, chars, rawChars, truncated,
addedNumbers, notes, calls, fallbackChunks, budgetChars, overBudget }`。
`calls` 是真花了几次额度（长文本分段 = 多次，**超预算时再压一遍也算一次**）；`addedNumbers` 是整理后
多出来、原文里没有的数字（模型编了东西时唯一露馅的地方）。
**结果必然 ≤ `budgetChars`（3500）**：压不进去时服务端最多再让 AI 压 2 遍，还超就按小节切尾巴
（**不回提示**，那一刀只写服务端日志）—— 不再回一句「请自己删掉 N 字」。所以 `overBudget` 只剩一种真值：有段落整理失败
退回了原文（那时故意不压不切，理由见 `docs/modules/consult.md`），前端要出声，否则提交那一下才被拒。

### POST /api/consult/projects
`{ brandName, brief, attachments?: [{filename, text, variant:'tidy'|'raw'}] }`（最多 5 份）。
`attachments` 是上传文件整理出来的正文，**由服务端合成进 brief**（`briefCompose.ts`），
用户不再手动插入。单份 > 3500 字、合计 > 20000 字、有空的那份 → 一律 **400 并点名是哪个文件**，
**不截断也不跳过**（少一份在资料里就是少一节，而剩下的读起来完全正常）。
新建后前端**先去 `/consult/projects/:id/intake`**（补料问卷页）而不是工作台，
第一轮提交前进工作台会被送回那一页（只挡第一轮）。

### GET /api/consult/projects/:id
`{ project, stages, entries, sources, intake, intakeRounds, searchEnabled, runs, batch }`。
`intake` 是**还没补进资料的那一轮问卷**（含已填答案），刷新页面靠它恢复。`searchEnabled=false` 表示这个部署
没配搜索 key，前端必须显示出来（否则用户以为 AI 会上网）。
`runs` 同 `GET …/runs`：刷新/重进之后靠它把「还在跑的那次分析」接回来，前端不处理的话那一步看起来从没跑过，
而额度已经扣了。`batch` 同 `GET …/runs`（整份报告那条链，见下）。

### GET /api/consult/projects/:id/runs
`{ runs: [{ id, stage_key, kind: 'draft'|'decisions'|'directions', status: 'running'|'failed'|'interrupted',
error, message_id, started_at }], batch, stages }` —— 正在跑的那些 + 还没跟用户说过的失败/中断（`consult_runs`，109）。
`stages` 同 `GET /projects/:id` 那一份（十四行，便宜），**必须和 `batch` 在同一个响应里**：
进度页用 `batch.cursor` 算「第几步」、用 `stages[].hasEntry` 标「已定稿」，分两次取的话中间那一步
刚好跑完就对不上（症状是刚跑完的几步显示「没有定稿」，刷新一次全变 ✅）。
`batch`（`consult_batches`，111）是「一键生成整份报告」那条链：
`{ id, status: 'running'|'done'|'failed'|'interrupted', cursor, total, stageKeys, labels, current, error,
searchNote, startedAt, finishedAt }`，没有在跑也没有未 ack 的失败时是 `null`。
**十四步全定稿之后一律 `null`**（`activeBatchFor`）：那句「剩下 N 步没有跑、再点一次接着跑」这时是假警报，
而它指的动作只会回 409。
**前端必须单独显示它**：串行这条链任何时候只有一步在 `runs` 里，只显示 `runs` 的话用户当成单步
（于是跑去点别的步骤，撞上链条中间），而「后面还排着 N 步」「跑到第 6 步停了」只存在这一份里。
`error` 是**上游原文整段**，前端要原样显示（合成一句「分析失败」的话空返回/截断/上游忙三种成因就全没了）。
上面那三个 POST 在同一步已经有一次在跑时回 **409 + `code: 'stage_running'`**（同一步不许同时跑两次，
挡的是「两个标签页各点一次」= 两次真调用）。

### POST /api/consult/projects/:id/runs/:rid/ack
那条失败/中断提示已经跟用户说过了，别再回在 `runs` 里。回 `{ runs }`；还在跑的那条 ack 不动（404）。

### POST /api/consult/projects/:id/batches/:bid/ack
整份报告那条失败/中断提示已经跟用户说过了，别再回在 `batch` 里。回 `{ batch }`；还在跑的那条 ack 不动（404）。

### POST /api/consult/projects/:id/full-report
「一键生成整份报告」：把**还没定稿**的那几步按阶段顺序**串着**跑完，每一步都是
`…/stages/:key/auto` 那条路（联网 → 慢车道 AI 按建议拍板 → 出正文 → 自动定稿）。
一整份 ≈ 23 次额度（出检索词 1 + 慢车道八步各 2 + 其余各 1，`aiCallsEstimate` 现算回给前端 ——
按钮上要写出来，默认配额是 10 次/天）。**立刻返回**（只等联网那十几秒）：
`{ batch, stageKeys, labels, skipped, search, aiCallsEstimate, sources, stages }`，
进度按 `GET …/runs` 里的 `batch` 轮询。六条边界：

- 待跑清单的判据是**没有定稿**（不是「没跑过」），顺序直接用阶段清单（它本身是拓扑序）。
  所以「接着跑」= 再 POST 一次，天然从断点继续，已定稿的不重跑 —— 前端不需要任何额外状态。
- 联网**只做一次**、覆盖这一批全部待跑步骤（每步各搜一遍的话多花十三次出词额度，
  而界面上只是「慢了一点」）。`search` 四种状态同 `/four-views/run`，都要显示。
- **中间任何一步失败就停**（不接着跑）：下游每一步都要上游的定稿，接着跑的话后面十几步
  一路抛「未解锁」，十几条失败记录成因全一样，而真正的成因埋在第一条里；额度用完那一种
  还会在每一步上再撞一次（每次都是真调用）。那条 `batch.error` 里必须有**停在第几步、
  上游原文、后面 N 步一步都没跑** —— 少了最后半句，界面上和「他压根没点过」一模一样。
- 有单步正在跑时回 **409**（在扣任何额度之前拦住）；同一项目已经有一批在跑回 **409**
  （`consult_batches` 上那条只对 `running` 生效的唯一索引）；客户资料为空回 **400**
  （二十多次调用一路编）；十四步全定稿回 **409**。
- 链条跑到某一步时那一步**已经被别人定稿了就跳过、不覆盖**（另一个标签页 / SDK / 他手动
  跑完的）：覆盖的话他刚核过的那一版被没人看过的一版顶掉，界面上只是「已定稿」。
- 服务重启后**不自动接着跑**：启动收尸把遗留的 `running` 标成 `interrupted` 并写明
  「跑到第几步、剩几步没跑」。自动重来等于凭空花掉二十多次额度（而让进程挂掉的原因
  很可能就在那一步上）；不收尸的话那条唯一索引把项目永久锁在「已经有一批在跑」。

### POST /api/consult/projects/:id/four-views/run
四看那四步**同时**开跑并各自**自动定稿**，开跑前先自动联网查一遍资料，一共 5 次额度
（1 次出检索词 + 4 步分析）。**这个请求要等十几秒到一分钟**（联网那一段在请求里 await，
搜到的必须在四步 prompt 拼起来之前落库），四步本身不等：
`{ runs: [ConsultRun], skipped: [{ stageKey, label, reason }], search, sources, stages }`。
`search: { status: 'off'|'ok'|'empty'|'failed', added, queries, note }` —— **四种状态都要显示 `note`**
（没配 Tavily key / 搜到了 / 搜了没结果 / 搜失败），四种在界面上一模一样：四看照样跑完四份通顺的正文，
差别只在那几节数字是查来的还是编的。自动搜来的资料是 `auto=1`「未人工核对」，证据级别只到 `L1?`。
`sources` 顺带回整份列表，前端要立刻更新右栏（否则显示「已采纳 0 条」而 prompt 里带着它们）。
进度按 `GET …/runs` 轮询（`runs` 里那几条跑完就不再出现，失败的带 `error` 原文）。
客户资料为空回 **400**（四步会一起编）；四步全都已定稿/已在跑时回 **409**（`skipped` 里的原因写在那句话里）。
`skipped` 前端必须显示 —— 少跑一步和跑完一步在进度上都是「不在 running 里」。
**这四份谁也没读到另外三份的定稿**（并行的含义），每一步定稿记录里带了这句；被截断/超长的那一版
**不自动定稿**，那条 run 标 `failed` 并说明，草稿留在该步对话里。

### PUT /api/consult/projects/:id/brief
### PUT /api/consult/projects/:id/name
### DELETE /api/consult/projects/:id

### POST /api/consult/projects/:id/stages/:key/draft
快车道（`fast`）、执行层（`plan`）和慢车道（`slow`）都走这里，三者 system prompt 不同
（找事实 / 承接结论出方案 / 照顾问拍板的方向写一份完整方案）。
`plan` 不要求客户资料非空（它的依据是上游定稿），`fast` 要求。
**`slow` 必须先有一条 `kind='decided'` 记录**（见 `/decisions/apply`），没有回 **400**、
拍板之后又重出过一版岔路口清单回 **409** —— 不拦的话这条路就是「AI 替他把取舍定了再写
一份完整正文」，而它的产出和照他定的方向写出来的一模一样。
**不落库**，返回 `{ draft, truncated, discussion, message, search, searchMessage, stages }`。
**这三条分析端点（`/draft`、`/decisions`、`/directions`）都会先自动联网查一批资料**
（`autoSourceService`，没有开关），所以一次请求 = **2 次 AI 额度**（1 次出检索词 + 1 次分析），
响应也比以前多等十几秒。`search` 是那次联网的结论（`{status,added,queries,aiCalls,note}`，
四种 status 的 `note` 都要显示），`searchMessage` 是已经落库的那条 `kind='search'` 消息 ——
前端要把它和 `message` 一起贴进对话（只回不贴的话刷新之后才看得见，而「这次没联网」
和「查到 8 条」在正文里读起来一模一样）。
`discussion: { used, dropped }` 是这一版带进 prompt 的本步对话条数（只算 `kind='text'` 的），
前端必须显示 —— 带上和没带上出来的草稿读起来一模一样。
`draft.body` 固定以 `## 0. 方法论速览` 开头、以 `## 写作建议` 结尾（两节不在输出物清单里，
但每次都有）；`draft.aiOpportunities` 是 1–2 条 AI 赋能机会，**独立字段不在正文里** ——
报告最后那一章「AI 转型机会清单」按它取数。

### POST /api/consult/projects/:id/stages/:key/directions
慢车道出 2–4 个互斥方向，每个带 `markdown`（三件套整段，选中后即定稿正文）+ `writingTip`
+ `aiOpportunities`，外层带 `verdict` 和 `methodBrief`（方法论速览，已拼进每个方向的 markdown
开头；模型没给时那一节写明「没给」而不是消失），以及和 `/draft` 同义的 `discussion: { used, dropped }`
和 `search` / `searchMessage`（这一屏也先自动联网，一次 2 次额度）。

### POST /api/consult/projects/:id/stages/:key/decisions
慢车道**动笔之前**先把「必须由顾问（或客户）拍板的取舍」列出来。只有 `lane='slow'` 能调，
不产出正文、不定稿、不 `incRound`。返回
`{ points, noFork, missing, dropped, truncated, discussion, message, search, searchMessage, stages }`
（`search` / `searchMessage` 同 `/draft`：这一屏也先自动联网，一次 2 次额度）：

- `points[]`：`{ id, question, methodRef, basis, options[{label,detail,cost}], recommend }`，
  最多 4 个。`id`（`d1..dN`）由服务端生成，`methodRef` 指向 `GET /stages` 里那条 `method`
  的第几条 —— 顾问对着操法数得出来这个岔路口是不是编的。
- **`dropped[]` 必须显示**：缺 `basis` 或凑不出 2 个带 `cost` 的选项的那几处被服务端丢掉了，
  而少一处的卡片和「这一步只有两处要定」在屏幕上一模一样，那一处最后就是 AI 自己定的。
- `points` 为空且 `noFork` 有话说 = 这一步真的没有取舍要拍板；两个都空、或者模型给的几处
  全被丢掉，一律 **502**（一屏空白读起来就是「这一步不用你定，直接出方案吧」）。
- `missing[]` 是缺事实、不是取舍 —— 那要走补料问卷，做成选项等于让客户猜一个数字。
- 同时在这一步的对话里追加一条 `kind='decisions'`（`payload` 是整份清单），刷新靠它恢复。
  **前端认 kind 的那条 `v-if` 链必须加这一支**：认不出的 kind 会落到 `v-else`，被画成
  一张「已生成候选方向」的卡片而右栏是空的，读起来像那一版丢了。

### POST /api/consult/projects/:id/stages/:key/decisions/apply
把顾问在那几处岔路口上的选择记下来 —— 它就是这一步出正文时的**地基**（`/draft` 读它）。
请求体 `{ sheetMessageId, picks: [{ id, label, note? }] }`，返回
`{ picks, noFork, sheetMessageId, message, stages }`（`message.kind='decided'`，
`role='user'` —— 那几处是**他**定的，记成 assistant 读起来就是「AI 说它定了」）。
**不花 AI 额度**（所以不在 `sdkLimits.AI_SPEND_ROUTES` 里），但必须落这条记录。四道闸：

- `sheetMessageId` 必须是**最新那一条** `kind='decisions'`，否则 **409**：清单里的 id
  是按顺序生成的（`d1..dN`），重出一版之后同一个 `d2` 已经是另一个问题 —— 存下来的是
  「问题 A + 答案 B」，而它在对话里、在正文的方法论速览里都读得通。
- **每一处都要有 `label`**，少一处 **400** 并点名是哪几处：留空的那几处 AI 会在写正文时
  自己定，而定完的正文读起来一样完整。
- `label` 只能是那个岔路口摆出来的选项之一，否则 **400**：自由发挥的答案配不上任何
  `cost`，进正文之后「放弃了什么」那一段就是模型编的。要补充就写 `note`（≤300 字，
  超了**只拒不截** —— 截掉的正是他刚写的那句要求）。
- `points` 为空的那种（`noFork`）**照样要提交一次**，落一条 `picks: []` 的记录：
  出正文那条路要求它存在，不然「没有取舍」和「还没拍板」在服务端分不开。

存下来的每一处是 `{ id, question, methodRef, label, detail, cost, note, by }` ——
问题和 `cost` **原样存**，不只存 id（同上一条：id 会随重出而漂），而 `cost` 要跟着进正文
（正文只会讲选中那条路的好处，「放弃了什么」是这一步唯一不可逆的信息）。
`by` 是「这一处是谁定的」（`consultant` / `ai-recommend` / `ai-fallback`，见下一条端点），
**只由服务端填，请求体里给了也不认** —— 收下的话下游可以把 AI 掷硬币定的那几处标成
「顾问已拍板」，而正文里唯一能看出地基是谁定的那一段就此说了假话。老记录里没有这一列，
前后端**一律按 `consultant` 读**（默认成 AI 的话，他过去亲手拍的板全变成「AI 替你定的」）。

### POST /api/consult/projects/:id/stages/:key/decisions/auto
「我不定，让 AI 按它的建议定」。请求体空，返回和 `/decisions/apply` 同一份
（`{ picks, noFork, sheetMessageId, message, stages }`）外加 `fallbacks`。
**不花 AI 额度**：它读的是上一次 `/decisions` 已经花过钱出来的那份清单，只是替他挑
（挑的规则在代码里 —— 拿 `recommend` 那句自由文本去比对选项 `label`，见
`autoDecideService.autoPicksFor`；让模型另回一个「推荐第几项」是又开一个它会算错的格式）。
存在的理由是「填完问卷一次出整份报告」：慢车道 8 步动笔之前都要一条 `kind='decided'` 记录，
而全自动跑的时候没人在屏幕前点卡片。三条边界：

- 每一处的 `by` 是 `ai-recommend`（`recommend` 指到唯一一个选项）或 `ai-fallback`
  （**指不到**，代码拿了第一个选项）。**两者必须分开**：`ai-fallback` 那几处等于掷了个硬币，
  是他回头第一个要看的；混成一句「AI 定的」的话，它们和有理由的选择长得一模一样。
- `fallbacks` 是 `ai-fallback` 的处数，**前端必须单独说出来**，而且不能塞进那条会被下一次
  请求清掉的报错位（这里是降级不是失败，见 `ConsultProject.vue` 的 `autoPickNote`）。
- `message.role` 是 `assistant`（手动那条路是 `user`）—— 存成 user 的话，过两天回来看
  对话里是「他说他定了这几处」，而他一处都没看过。

### POST /api/consult/projects/:id/stages/:key/auto
「这一步全自动跑完」：**联网 → （慢车道）出那几处取舍 → AI 按建议拍板 → 出正文 → 自动定稿**，
中间不停。慢车道 3 次额度（出检索词 1 + 出取舍 1 + 写正文 1），快车道/执行层 2 次。
这是「填完问卷一次出整份报告」的单步零件（那条驱动器就是照阶段顺序把它调 14 遍）。
**立刻返回**（同 `/four-views/run`，只等联网那十几秒）：
`{ run, search, searchMessage, sources, stages }`，进度按 `GET …/runs` 轮询。四条边界：

- **顺序是先 `startRun` 占位、再联网**：反过来的话联网那十几秒里按钮还可点，连点两次
  就是两次出词调用（两次额度），而第二次点完照旧只跑一批分析。
- **联网这一段自己挂了要把占住的位子 `failRun` 还回去** —— 不还的话这一步永远显示
  「正在分析」而压根没有人在跑它，重点一次还被 109 那条唯一索引挡住（这一步就此点不动）。
- 这一步**已经定稿**回 **409**：这条路跑完直接盖上「已定稿」，而他核过的那一版是下游
  每一步的依据。重做要他自己在那一步上手动跑。
- 被截断 / 超过定稿上限的那一版**不自动定稿**（同 `/four-views/run`），那条 run 标 `failed`
  并说出是哪一种，草稿留在该步对话里。定稿那条 `kind='entry'` 记录里还要写明
  「这一版没有人看过」以及**有几处取舍是 AI 定的、其中几处是掷硬币的** ——
  只写在拍板那条记录里的话，跑完之后他读的是一句「✅ 已自动定稿」。

### POST /api/consult/projects/:id/stages/:key/draft/discard
丢弃这一版草稿 / 候选方向。请求体 `{ kind?: 'draft' | 'directions' }`（默认 `draft`），
返回 `{ message }`（`kind='discard'`，前端追加到对话末尾）。草稿本身不落库，所以这个接口
只做「留一条痕」这一件事 —— 但它是必需的：那一版存在对话里 `kind='draft'` 那条消息的
`payload` 里，前端光把本地状态清掉的话，切走再切回来会从那条消息恢复出来，用户点过的
「丢弃」等于没生效，而两次操作都显示成功。前端还要靠这条记录把它之前那张产出卡片置灰
（留着「查看 →」的话点了什么都不发生）。同 `entry`，它**不会**进下一次 prompt。

### GET /api/consult/projects/:id/stages/:key/messages
### POST /api/consult/projects/:id/stages/:key/chat
阶段内对话，只写 `consult_messages`（**改不了草稿也改不了定稿**）。它影响的是下一次
`/draft` / `/directions` —— 那两个接口会把本步最近 16 条 `kind='text'` 的对话带进 prompt。

### PUT /api/consult/projects/:id/stages/:key/entry
定稿进知识库。返回 `{ entry, message, staled, stages, entries }` —— `staled` 是被标成「待重跑」
的下游步骤，前端必须显示。`source_level` **由服务端按实际依据算**（有联网资料 → L1，
只有客户资料 → L2，都没有 → L3），请求体里传的会被忽略。
请求体可带 `aiOpportunities: string[]`（每步最多 2 条、每条 200 字，超了 **400 只拒不截**），
落在 `entry.ai_opportunities`（JSON 数组字符串，老定稿是 `'[]'`）。老定稿前端要显示成
「没标 AI 机会」而不是留空 —— 留空和「这一步确实没有」长得一样。
`message` 是同时写进这一步对话记录的那条定稿留痕（`kind='entry'`，前端直接追加到对话末尾）：
不留的话对话永远以「已生成草稿」那张卡片收尾，回头看不出最终定的是哪一版。
它**不会**进下一次 prompt（`discussionBlock` 只取 `kind='text'`）—— 定稿本来就以定稿身份
进下游 prompt，同一段出现两遍会被模型当成两处独立印证。

### GET /api/consult/projects/:id/report
把十四步的定稿合并成一份可交付的 markdown → `{ filename, markdown, stale, noBody, chapters, chars }`。
**不调 AI**（正文原样搬），前端拿 `markdown` 自己存文件。章节顺序来自 `STAGES` 而不是定稿时间。
有任何一步没定稿一律 **400 + `missing: string[]`**（缺哪几步的 label）：少两章的文档在屏幕上
和完整的一模一样，而它是要发给客户的东西。`stale`（上游改过之后没重跑的章节）/ `noBody`
（只存了结论、没有正文的老定稿）**同时写在文档开头和对应章节里**，接口再回一份给前端提示 ——
只回接口的话用户下载完就再也看不到了，而这份 md 会被直接转出去。

### POST /api/consult/projects/:id/intake
让 AI 读客户资料出一份补料问卷 → `{ gaps, questions: [{ id, section, question, why, placeholder, type, options }], truncated, round, rounds }`。
`type` 是 `'choice'`（可点选，`options` 里 2-4 个互斥的**类型划分**）或 `'text'`（只能手填）；
数字、金额、名单类的题服务端一律标 `text` 且清空 `options` —— 给那种题配选项等于让模型编几个
区间、客户挑最接近的那个，而它进资料之后和客户亲口说的一模一样。选项不足 2 条降级成 `text`
（不丢题）。「其他」「说不准」由前端固定补，不占 `options` 的名额（靠模型给它会漏，漏掉之后
客户只能在几个都不对的选项里挑一个最像的）。老轮次没有这两个字段，前端要缺省当 `text` 渲染。
落库（migration 080，一轮一行），**会删掉这个项目里上一轮没提交的问卷** —— 前端在
已经填了答案时要先确认。题数太少（模型没按格式回）时 502 + 说明 —— 绝不回空问卷
（空问卷读作「资料已经够了」）；出的题全是之前问过并且答过的时候 409 + 说明。

### PUT /api/consult/projects/:id/intake/answers
`{ roundId, answers: { <questionId>: text } }` 暂存填了一半的答案（前端逐题失焦时调）。
那一轮不在了 / 已提交时 **409**，不静默 200 —— 一路显示「已暂存」而其实没存，
用户关掉页面才发现是空的。

### POST /api/consult/projects/:id/intake/apply
`{ roundId, answers: [{ id, question, answer, section }] }` → `{ applied, brief, briefChars, rounds }`。
服务端**追加**到客户资料末尾并落库（不收整份 brief —— 整段替换会覆盖用户在别处的编辑）。
空答案的题连题目一起丢掉；超过 20000 字直接 400，不截断；同一 `roundId` 补第二遍 **409**
（补两遍 = 同一批答案在资料里两份，AI 会当成两处独立印证）。

### POST /api/consult/projects/:id/stages/:key/search
`{ query }` → `{ query, results: [{ title, url, content, published }] }`。**不落库**。
没配搜索 key 时 503 + 说明，检索失败 502 + 原文 —— 都不回空列表（空列表读成「网上没这家公司的资料」）。

### POST /api/consult/projects/:id/stages/:key/sources
采纳勾选的结果：`{ query, items: [{ title, url, snippet, published }] }` →
`{ added, skipped, sources }`。同一 url 重复采纳被挡掉并计入 `skipped`；
超过 40 条上限直接 400，**不只存前几条**。
`sources[].auto`：1 = 一键四看自动搜来的「未人工核对」（`L1?`），0 = 用户逐条采纳的（L1）。
手动采纳一条已经自动搜到的 url 会把那一行升级成 `auto=0` 并计入 `added`（他亲自核过了）。

### POST /api/consult/projects/:id/sources/:sid/verify
「这条我点开看过了」：把自动搜来的那一行升级成人工核对过的（`auto=0`）→ `{ sources }`。
本来就是用户采纳的那些回 404 + 说明（不回 ok —— 那会让「点错了行」读成「已确认」）。
不复用上面那个采纳端点：它有 40 条上限校验，满了的时候确认一条已经在库里的资料会回「还能加 0 条」。

### DELETE /api/consult/projects/:id/sources/:sid

### POST /api/consult/sdk/token `PUBLIC`
第三方**纯前端**页面换一把 15 分钟短 token，用来 iframe 嵌入 /consult 工作台（084）。
Body：`{ pk, externalUid }`。回 `{ token, token_type, expires_in, external_uid }`。

- **必须由第三方页面自己发这个请求**，不能由 iframe 里的页面发：iframe 里发出的
  Origin/Referer 是**我们自己的**域名，那道白名单于是对每个 pk 都成立，等于没配。
- `externalUid` **必填**（第三方那边的终端用户 id，签进 token，之后每个请求的租户只从
  签名过的 token 里取）。缺省成空串的话这个接入方所有终端用户共用一个归属键 ——
  A 客户的品牌资料会出现在 B 客户的项目列表里，而那就是一列正常的项目。
- 它是第三方页面传的，**不可信**：纯前端下任何人都能改掉它读到同一把 key 下别人的项目。
  只是**展示隔离，不是安全边界**。要真隔离，接入方得出一个最小后端来签这个值。
- Origin 不在 pk 白名单里回 403，**错误里带上收到的那一行** —— 接入方最常见的错是配了
  https 用了 http，只回一句 not allowed 的话他核对的是自己配的那一行。
- 换出的 token `scope=consult:embed`，能碰哪些端点由全局 `auth/scopeGuard.ts` 管（默认拒绝）：
  只放行 `GET /api/consult/stages` 和 `/api/consult/projects` 子树。**其余一律 403**，
  包括下面那几个发 key 的后台接口。

### GET|POST|PATCH|DELETE /api/consult/admin/sdk-keys `ADMIN`
pk 的 CRUD（绑账号 / 配 Origin 白名单 / 启停 / 换取限流 / 每把 key 的天花板）。
`allowedOrigins` **不许为空**：空清单的 key 换不到 token，而后台那一行看起来是建好的。

- `dailyAiLimit`（缺省 50）/ `maxProjects`（缺省 200）：**新 key 一定有上限**，和
  `ai_app_quota` 的「没配就不限」相反 —— 绑定账号开了专属渠道时它绕过 `ai_quota`，
  「不限」就是拿他自己那把 key 无上限烧真钱，而每次返回的都是一份正常的草稿。
  两个字段都必须是 >= 0 的整数（不是就 400），**`0` 是合法值** = 把这把 key 冻住。
- GET 每行额外回 `ai_used_today` / `projects`：只回上限不回用量的话，接入方那边被 429
  挡住时后台这一行看起来完全正常，管理员判断不出该调额度还是有人在滥用。
- 停用/删掉 key 立刻生效（`consultSdkLimits` 每个请求查一次），不用等那把短 token 过期；
  对外统一回 403 `{ code: 'sdk_key_disabled' }`「接口已关闭，请联系管理员」。

### 上限被触发时的两种 429（带 `code`，都写着真实数字）
- `sdk_project_cap`：`POST /projects` 超过 `maxProjects`。
- `sdk_ai_quota`：会花 AI 的端点（`/stages/:key/{draft,directions,chat,search}`、`/intake`）
  超过 `dailyAiLimit`，服务器时间 0 点重置。**先扣再放行** —— 等 AI 返回了再扣的话，
  同时打进来的一批请求读到同一个 used，上限形同不存在（而每条都返回正常结果）。

### iframe 嵌入的响应头
`/consult` 和 `/consult/*` 的响应**不发 `X-Frame-Options`**，改用
`Content-Security-Policy: … ; frame-ancestors <所有启用中的 pk 的域名之和>`
（`X-Frame-Options` 只有 DENY/SAMEORIGIN，多域名做不到；留着 DENY 的话第三方页面上是一块白，
而我们这边每个接口都 200）。没有任何启用的 key 时**照旧 DENY**。名单是**所有 key 的并集**而
不是按 pk 算：只有 iframe 那第一个文档请求带得上 pk，SPA 内跳和手动刷新都不带。

---

## Module Tokens (用户只读)

### GET /api/tokens `PROTECTED`
列出当前用户的模块 Token（只读，不含完整 token 值）。

```json
{
  "tokens": [
    {
      "id": "uuid",
      "module_id": "fish",
      "module_name": "Fish Tank",
      "token_prefix": "mmPla_abc123...",
      "enabled": 1,
      "expires_at": null,
      "created_at": "2026-07-01T...",
      "last_used_at": "2026-07-03T..."
    }
  ]
}
```

Token 的创建、启用/禁用、删除均由 Admin 操作（见 Admin Endpoints）。

---

## Discover (文章) Endpoints

### GET /api/discover/articles `PUBLIC`
获取已发布文章列表。

Query: `?locale=zh` (默认 `zh`)

### GET /api/discover/articles/:slug `PUBLIC`
获取单篇文章详情（含推荐文章）。

Query: `?locale=zh`

---

## Topics (专题) Endpoints

### GET /api/discover/topics `PUBLIC`
获取已发布专题列表。

Query: `?locale=zh`

返回值含 `article_count`（该专题下已发布文章数）。

### GET /api/discover/topics/:slug `PUBLIC`
获取单个专题详情（含所属文章列表）。

Query: `?locale=zh`

---

## Admin Endpoints

所有 Admin 端点需要 `role: "admin"`，未满足返回 403。

### 用户管理

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/admin/users | 用户列表 |
| POST | /api/admin/users | 创建用户 |
| PATCH | /api/admin/users/:id/role | 修改角色 |
| POST | /api/admin/users/:id/reset-password | 重置密码 |

### 额度管理

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/admin/quotas | 所有用户额度 |
| PATCH | /api/admin/quotas/:userId | 调整用户每日额度 |

```json
{ "daily_limit": 50 }
```

### AI 用量

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/admin/ai-usage?days=7 | 按用户/模块/日期维度的调用统计 |

### 对外中转接口（专属 AI 渠道下发的 key）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/admin/users/:id/relay-keys | 为该用户的某条接入点生成一把对外 key |
| DELETE | /api/admin/relay-keys/:keyId | 吊销（软删，行保留） |

```json
// POST — provider 必须是这个用户自己的、kind=llm 的接入点，否则 400
{ "provider_id": "...", "label": "给某个下游用" }
// Response — key 明文只在这里出现一次，库里只有 sha256
{ "key": "sk-mmpla-...", "relay_key": { "id": "...", "key_prefix": "sk-mmpla-ab12…cd34", "provider_id": "...", "enabled": 1, "revoked_at": null, "revoke_reason": "", "last_used_at": null }, "provider": { "...": "已脱敏" } }
```

下游调用的是 `/api/v1/*`（OpenAI 兼容，**无需平台 JWT**，用上面那把 key）：

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/v1/chat/completions | 非流式对话补全 |
| GET | /api/v1/models | 只列绑定的那一个模型 |

```bash
curl https://<域名>/api/v1/chat/completions \
  -H "Authorization: Bearer sk-mmpla-..." -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"你好"}]}'
```

- `model` 由接入点决定，body 里传什么都忽略；返回里的 `model` 是**真实**用到的那个。
- `stream: true` / `tools` / `functions` 一律 400（无声忽略会让客户端等一个永不到来的 SSE）。
- 只转发 `messages` + `temperature`/`top_p`/`max_tokens`/`presence_penalty`/`frequency_penalty`/`stop`/`response_format`/`seed`/`n`。
- 错误体是 OpenAI 形状 `{ "error": { "message", "type", "code" } }`：
  `401 invalid_api_key`（key 对不上）、`403 endpoint_closed`（吊销/接入点停用或删除/专属开关关了，
  对外只这一句）、`429 quota_exceeded`（撞的是该用户的 `relay` 应用额度）、`502 upstream_error`（带上游原文）。
- 用量记在绑 key 的那个用户头上，`ai_logs.source = 'relay'`；限流用
  `PUT /api/admin/users/:id/app-quota` 的 `app: "relay"`。

`GET /api/admin/users/:id/dedicated-ai` 的返回里多两个字段：`relay_keys: RelayKeyPublic[]`
（含已失效的：下游收到「接口已关闭」时，管理员要能看出是哪一把、为什么废）和
`relay_usage: { today_calls, today_tokens, week_calls, week_tokens }`
—— 这是该用户**所有 key 的合计**（`ai_logs` 没有 key 维度），界面上不能摆到某一行 key 旁边。
`DELETE /api/admin/providers/:id` 返回 `{ success, revoked_relay_keys }` —— 删接入点会把
绑在它上面的 key 一起标废，这个数必须显示出来。

### 系统配置

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/admin/config | 获取配置（API Key 已脱敏） |
| POST | /api/admin/config | 设置配置项 |
| DELETE | /api/admin/config/:key | 删除配置项 |

可设置的 key：`platform_api_key`、`platform_api_base_url`、`platform_model`

```json
{ "key": "platform_api_key", "value": "sk-..." }
```

### 模块管理

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/admin/modules | 列出所有模块配置 |
| POST | /api/admin/modules | 创建模块 |
| PATCH | /api/admin/modules/:id | 更新模块配置（name、allowed_paths、enabled） |

```json
// POST /api/admin/modules
{ "id": "my-module", "name": "我的模块", "description": "...", "allowed_paths": ["/api/my-module"] }
```

### Token 管理

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/admin/users/:id/tokens | 查看用户的模块 Token |
| POST | /api/admin/users/:id/tokens | 为用户生成模块 Token |
| PATCH | /api/admin/tokens/:id | 启用/禁用 Token |
| DELETE | /api/admin/tokens/:id | 删除 Token |

```json
// POST 生成 Token
{ "module_id": "fish", "expires_in_days": 30 }
// Response 201 — token 仅此时展示一次
{ "id": "...", "module_id": "fish", "token": "mmPla_full_token_value", "token_prefix": "mmPla_abc123...", "expires_at": "...", "warning": "Save this token now. It will not be shown again." }
```

约束：一个用户一个模块只能有一个有效 Token。

### Token 访问日志

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/admin/users/:id/token-logs | 查看用户 Token 访问记录 |

Query: `?module_id=fish&days=7&limit=100`

```json
{
  "logs": [
    { "id": "...", "token_id": "...", "module_id": "fish", "module_name": "Fish Tank", "method": "POST", "path": "/api/ai/fish/decide", "status_code": 200, "ip": "1.2.3.4", "created_at": "..." }
  ]
}
```

### 文章管理 (Discover Admin)

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/discover/admin/articles | 所有文章列表（含多语言内容） |
| GET | /api/discover/admin/articles/:id | 文章详情 |
| POST | /api/discover/admin/articles | 创建文章 |
| PATCH | /api/discover/admin/articles/:id | 更新文章 |
| DELETE | /api/discover/admin/articles/:id | 删除文章 |
| PUT | /api/discover/admin/articles/sort | 批量排序 |
| POST | /api/discover/admin/articles/:id/offline | 下线并删除静态页 |
| POST | /api/discover/admin/articles/:id/generate | 生成 SSG 静态页 |

文章字段：`slug`、`author`、`icon`、`cover_image`、`bg_color`、`avatar_color`、`sort_order`、`status`、`visible_locales`、`topic_id`、`contents`、`recommendations`

详细字段说明参见 `docs/skill-create-article.md`。

### 专题管理 (Topics Admin)

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/discover/topics/admin/list | 所有专题列表 |
| GET | /api/discover/topics/admin/:id | 专题详情（含所属文章） |
| POST | /api/discover/topics/admin | 创建专题 |
| PATCH | /api/discover/topics/admin/:id | 更新专题 |
| DELETE | /api/discover/topics/admin/:id | 删除专题 |
| POST | /api/discover/topics/admin/:id/offline | 下线并删除静态页 |
| POST | /api/discover/topics/admin/:id/generate | 生成 SSG 静态页 |

```json
// POST 创建专题
{
  "slug": "ai-weekly",
  "icon": "🤖",
  "bg_color": "#f0f5ff",
  "cover_image": "",
  "template": "default",
  "sort_order": 0,
  "status": "published",
  "visible_locales": ["zh", "en"],
  "contents": [
    { "locale": "zh", "title": "AI 周刊", "description": "每周精选 AI 资讯", "seo_title": "", "seo_description": "", "seo_keywords": "" },
    { "locale": "en", "title": "AI Weekly", "description": "Weekly AI news picks", "seo_title": "", "seo_description": "", "seo_keywords": "" }
  ]
}
```

---

## Feishu Assistant Endpoints

飞书助理的管理接口。全部 `PROTECTED` —— 事件通过长连接进来，
**没有对外的回调端点**（详见 `docs/FEISHU_ASSISTANT.md`）。

管理员在这些接口上天然看到全平台数据，普通用户只看到自己的，所以后台页面复用同一批接口。

### GET /api/feishu-assistant/capabilities `PROTECTED`
助理支持的动作，以及需要在飞书开发者后台开通的权限点。前端直接渲染成接入指引。
```json
{
  "actions": [
    { "name": "create_task", "description": "...", "examples": ["..."], "scopes": ["task:task:write"] }
  ],
  "scopes": ["im:message", "task:task:write", "bitable:app", "drive:drive", "im:message.group_at_msg:readonly"],
  "directory_scopes": ["contact:user.base:readonly", "contact:department.base:readonly", "im:chat:readonly"],
  "events": ["im.message.receive_v1"],
  "default_supplement": "以下规则用于帮助助理听懂本企业的说话方式…"
}
```
`actions` 和 `scopes` 都是**从动作注册表生成的**（`ACTIONS` + `allRequiredScopes()`），
加一个动作不用改本接口，接入指引里的权限清单也会自动多一项。

`scopes` 里已经包含 `directory_scopes`（接入指引让用户一次配齐）；单独再列一份是因为
它们的性质不同：**不开也能用助理**，只是每次都必须在群里 @ 到人，
说一个没 @ 的同事的名字会失败。前端据此把它们渲染成「可选，但强烈建议」
而不是硬性前置条件。

`bitable:app` / `drive:drive` 相反，是**项目日记的硬前置**：少了前者建不出项目的
多维表格（「新建项目」直接报错），少了后者表能建出来但群里谁都打不开、
链接分享也关不掉（见 FEISHU_DIARY.md 第一节）。

`params` 的值是**给 LLM 看的自然语言说明**，不是 JSON Schema，前端原样展示。
涉及人的参数（`create_task.assignee`、`update_task.followers`）收的是**姓名**，
服务端查 mentions 和名册换成 open_id —— 所以指名一个没 @ 过的人依赖
`directory_scopes` 那一组权限，没同步过名册时用不了。

`default_supplement` 是**应用没填自己的补充规则时实际生效的那份**（skill slot
`feishu-intent`，migration 056 播的示例模板）。前端「填入示例模板」按钮读它 ——
客户端自己抄一份的话，平台改了模板之后按钮填出来的还是旧的，而用户以为那就是当前默认。

面向用户的读动作只有项目日记那两个（`list_diary_projects` / `review_diary`），
它们读的是**我们自己的库**，不是飞书。飞书那侧的读基本做不到：「列出我的任务」
要 user token（见 FEISHU_ASSISTANT.md 第五节），本模块没有，也就不存在对应动作。

`update_task` 会顺带读一点东西，但那是**按 guid 读一条已知的记录**而不是列举 ——
guid 只可能来自我们自己的执行日志，所以这个动作只对**助理自己建过的**任务有效。
用户在飞书里手动建的，助理既查不到也改不动，回帖会明说这一点
（见 FEISHU_ASSISTANT.md 八·三）。

### GET /api/feishu-assistant/apps `PROTECTED`
已绑定的飞书应用。`app_secret` 已脱敏；`live_state` 是内存里的实时连接状态
（`conn_state` 是库里最后一次记录的）。管理员额外拿到 `owner_username`。
```json
{
  "apps": [{
    "id": "...", "name": "市场部助理", "app_id": "cli_xxx",
    "app_secret": "abc1234...wxyz", "enabled": true, "allowed_chats": ["oc_xxx"],
    "conn_state": "connected", "conn_error": null, "conn_at": "2026-08-04T10:00:00.000Z",
    "live_state": "connected",
    "dir_sync_state": "ok", "dir_sync_error": null, "dir_sync_at": "2026-08-04T10:01:00.000Z",
    "dir_user_count": 128, "dir_source": "contact",
    "intent_supplement": "「过一下方案」= 开一个评审会\n「早会」默认指 09:30"
  }]
}
```
`dir_*` 是组织架构名册的同步状态（057）。`dir_source` 为 `"chats"` 表示通讯录权限
没开、走的是群成员兜底 —— **前端不能把它渲染成绿色的"已同步"**，那份名册只覆盖
机器人所在的群。

`intent_supplement`（059）是这个应用自己的「本企业补充规则」，空串表示走
`capabilities.default_supplement` 那份平台默认。**只能由
`PUT /apps/:id/intent-supplement` 修改**，`POST /apps` 不碰它（见下）。

### POST /api/feishu-assistant/apps `PROTECTED`
新增或编辑（传 `id` 即编辑）。保存后立刻按 `enabled` 建连或断连。

请求体：`{ id?, name, app_id, app_secret?, enabled, allowed_chats: string[] }`

- 编辑时 `app_secret` 留空 = 保留原密钥。
- **归属账号不接受请求体指定**，编辑时保持原归属 —— 否则能把应用挂到别人名下消耗其额度。
- `allowed_chats` 为空数组 = 不限群聊。候选群名来自
  `GET /apps/:id/chats`；**提交时要把该接口没列出来的已配置 id 一起带上**，
  否则一次保存就静默删掉它们（表现是一个本来正常的群突然不响应了）。
- **`intent_supplement` 不在这个接口的语义里**，本接口不会修改它。
  本接口是整行替换，而前端有好几处只带部分字段调它（启停、一键放行某个群）——
  规则要是挂上来，任何一次这种调用都会把用户写的那段话清成空串。

响应里的 `conn_error` 表示"配置存下来了但连接没建起来"（通常是凭证填错）：
```json
{ "app": { "...": "..." }, "conn_error": "建立飞书长连接失败：invalid app_secret" }
```

错误：`400` 新增时缺 app_id/app_secret · `403` 他人的应用 · `404` id 不存在 ·
`409` app_id 已被绑定（同一应用绑两次 = 两条连接 = 消息被处理两遍）

### DELETE /api/feishu-assistant/apps/:id `PROTECTED`
先断连再删行。`{ "ok": true }`

### POST /api/feishu-assistant/apps/:id/reconnect `PROTECTED`
手动重连。凭证没改但连接掉了（网络抖动、飞书侧重启）时的自助入口。
```json
{ "ok": true, "live_state": "connected" }
```
错误：`400` 应用已停用 · `403` 他人的应用 · `404` 不存在 · `502` 建连失败（含原因）

### POST /api/feishu-assistant/apps/:id/directory/sync `PROTECTED`
同步组织架构名册（指名一个没被 @ 到的同事的前提）。**绑定成功后会自动跑一次**，
这个接口是之后「有人入职/离职/调岗」时的手动更新入口。

**返回 `202` 就走**，不等同步完成 —— 全公司通讯录要几十到几百次 API 调用，
几十秒是常态。进度和结果写在 `feishu_apps.dir_*` 上，前端轮询 `GET /apps` 拿状态。
```json
{ "ok": true, "state": "syncing" }
```
错误：`400` 凭证没填全 · `403` 他人的应用 · `404` 不存在 ·
`409` **已经在同步中**（两次并发同步会互相 DELETE 对方刚写入的行，最后剩哪一半取决于时序）

同步本身的失败**不通过 HTTP 返回**（那时响应早发出去了），而是写进 `dir_sync_error`。
两条数据源：通讯录接口（主）→ 群成员（兜底）。**只有飞书 code 99991672（缺权限）
才降级**；网络/限流/5xx 直接判失败，否则用户会拿到一份不完整的名册却以为同步成功了。
失败时**不清空已有名册**。

### GET /api/feishu-assistant/apps/:id/directory `PROTECTED`
名册内容。用于搜人、看部门归属、确认某个人在不在里面。

Query：`q`（模糊搜姓名/部门/职位）· `page` · `page_size`（默认 50，上限 200）
```json
{
  "users": [{
    "open_id": "ou_xxx", "name": "张三", "en_name": "Tom Lee",
    "department_names": "销售部 / 华东组", "job_title": "销售经理",
    "is_resigned": 0, "source": "contact"
  }],
  "total": 128,
  "departments": [{ "department_id": "od_xxx", "name": "销售部", "parent_id": "0", "member_count": 12 }],
  "sync": { "state": "ok", "error": null, "at": "...", "user_count": 128, "source": "contact" }
}
```
这里的 `q` **允许模糊匹配**，因为结果由人来挑。指令执行路径上的 `findByName`
恰恰相反 —— 只做归一化后的精确相等，见 `docs/FEISHU_ASSISTANT.md` 第六节。

错误：`403` 他人的应用 · `404` 不存在

### GET /api/feishu-assistant/apps/:id/chats `PROTECTED`
机器人见过的会话。前端用它把群白名单从「手打 chat_id」变成「勾选群名」——
`oc_xxx` 在飞书客户端里**没有任何地方能看到**，没有这个接口时唯一的配法是
先留空（真的不设防）跑一遍、再去指令日志里抄 id。

```json
{
  "chats": [{
    "chat_id": "oc_xxx", "name": "产品群", "chat_type": "group",
    "source": "bot_added", "reject_count": 0,
    "last_seen_at": "...", "last_rejected_at": null,
    "in_allowlist": true
  }],
  "allowlist_empty": true
}
```

- `source`：`bot_added` = 机器人被拉进群时记的（有群名）；`rejected` = 只在白名单外
  被拦时见过（只有 id）。`name` 可能是空串 —— 群名要 `im:chat:readonly` 才拿得到。
- `reject_count > 0` = 这个群 @ 过机器人但被白名单拦下了。被拦时机器人**不回话**
  （回了等于向任意群暴露自己），所以这个计数是用户唯一能知道"@ 了没反应是因为白名单"的地方。
- **`in_allowlist` 由服务端算**（白名单为空 = 全部放行）。这条规则不交给前端：
  用户侧和后台各实现一遍迟早有一个算错，而算错的方向是"显示已放行"，
  用户会以为自己设好防护了。
- 排序把被拦过的放最前面。

错误：`403` 他人的应用（群名等于公司内部信息）· `404` 不存在

### 项目日记：三个只读接口

下面四个接口是 `/feishu` >「项目日记」那一页的数据源，**除最后一个（删整个项目）之外只读**。
只读是设计不是没做完：同步到多维表格是**只追加**的（推上去就置状态位、永不重推），
所以网页上删掉一条，表格里那行删不掉 —— 开一个写入口就等于让库和表永久不一致，
而用户看的是表。所有写路径都走群里 @ 助理（每一步都带记录人、时间、原始 `message_id`）。

四者共用 `appForDiary()` 做归属校验，且 `:projectId` **必须同时匹配 `app_id`**：
光按 id 查的话，拿到一个别家公司的 `project_id` 就能读到那家公司的全部项目日志，
不匹配一律 `404`。403 的文案是「无权查看」—— 日志正文就是那家公司的项目进展，
越权读这里比越权改配置更糟。

#### GET /api/feishu-assistant/apps/:id/diary/projects `PROTECTED`
项目清单 + 项目总表链接。
```json
{
  "index": { "url": "https://…/base/bascn…", "link_share_closed": true },
  "projects": [{
    "id": "...", "name": "印度纪录片",
    "chat_id": "oc_xxx", "chat_name": "印度纪录片项目群",
    "url": "https://…?table=tbl…", "review_url": "https://…?table=tbl…",
    "link_share_closed": true, "in_index": true,
    "created_by_name": "张三", "created_at": "...",
    "record_count": 37, "unsynced_count": 0,
    "last_record_ms": 1786000000000, "summary_count": 3, "last_summary_at": "..."
  }]
}
```
- **`index` 可能是 `null`**（第一个项目建出来之前总表还不存在，或当初建总表那步失败了），
  `url` 也可能是空串。前端要区分这两种和"有链接"，别渲染成一个点不动的空链接。
- **`review_url` 单独给**：复盘存在 base 的第二张表里，群里发的那条被截到 1500 字，
  完整版在表里。不给这个链接的话用户点进去只看到「记录」表。
- **`unsynced_count` 必须显示出来。** 补推是跟着**下一次记录**发生的（没有定时任务），
  所以一个不再活跃的群会永久停在"库里有、表里少几条"。不显示这个数字，那种缺失查不出原因。
- `in_index: false` = 当初写进总表那一步失败了，下次在群里记录时会自动补登记。
- `link_share_closed: false` 是**信息泄露面**，不是观感问题：链接分享没关成功意味着
  组织内任何拿到链接的人都能看这个项目的全部日志，而链接是发在群里的。
- 计数用两条 `GROUP BY` 一次算完（`projectStats`），不是每个项目查四次 —— 这页一打开就调。

#### GET /api/feishu-assistant/apps/:id/diary/projects/:projectId/records `PROTECTED`
一个项目的日志正文，最新在前。Query：`page` · `page_size`（默认 50，上限 200）
```json
{
  "project": { "id": "...", "name": "印度纪录片", "url": "…", "review_url": "…" },
  "records": [{
    "id": "...", "content": "今天和导演对了分镜，第三场要重拍",
    "author_name": "张三", "created_ms": 1786000000000, "created_at": "...",
    "synced": true
  }],
  "total": 37
}
```
`synced: false` 是「这条在表里看不到」的唯一提示，含义同上面的 `unsynced_count`。

#### GET /api/feishu-assistant/apps/:id/diary/projects/:projectId/summaries `PROTECTED`
一个项目的复盘记录。Query：`page` · `page_size`（默认 20，上限 100）
```json
{
  "project": { "id": "...", "name": "印度纪录片", "review_url": "…" },
  "summaries": [{
    "id": "...", "range_label": "本周（08-03 至 08-09）", "record_count": 12,
    "summary": "（完整版 markdown，不截断）",
    "created_by_name": "张三", "created_at": "...", "synced": true
  }],
  "total": 3
}
```
`summary` 是**完整版** —— 群里那条被截到 1500 字，这也是这个接口的主要价值。

#### DELETE /api/feishu-assistant/apps/:id/diary/projects/:projectId `PROTECTED`
删掉一个项目。**只删库里的关联，飞书那侧一个字都不动。**
```json
{
  "ok": true,
  "deleted": {
    "name": "印度纪录片", "chat_id": "oc_xxx",
    "record_count": 37, "summary_count": 3,
    "log_url": "https://…?table=tbl…", "review_url": "https://…?table=tbl…",
    "task_url": "https://…?table=tbl…",
    "still_in_index": true
  }
}
```
- 库里删掉的是**日志记录 + 复盘 + 项目行**；`feishu_project_tasks` 只置空 `project_id`
  （那些任务在负责人的飞书待办里真实存在，删掉库里的行会让「改一下那个任务」再也找不到它）。
- **飞书的多维表格不删、项目总表那一行也不动。** 删除是一次网页点击，而我们既没有回收站
  也没有第二份（070 之后任务**只存在**于表格里）—— 顺手删云文档的话按错一下就没了全部历史。
- 所以 `log_url` / `review_url` / `task_url` **必须显示给用户**，而且不能用 alert
  （点掉就没了）：那些表建的时候没传 `folder_token`、链接分享也是关掉的，飞书里搜不到，
  而项目行一删助理就不再认识它们、群里问「有哪些项目」也不会再列出来 ——
  **这是最后一次能拿到链接的机会**。空串 = 当初那张表就没建出来。
- `still_in_index: true` 表示总表里那一行还在（它也是事后找回上面链接的途径），
  于是总表会继续列着这个项目。要说出来，否则用户打开总表会以为没删掉。
- 群和项目的绑定（`chat_id` 的 UNIQUE）随项目行消失，这个群之后可以重新「新建项目」——
  但**新项目会另建一套表**，和老表没有关系。

错误（四个都一样）：`403` 他人的应用 · `404` 应用不存在 / 项目不存在（含跨应用的 projectId）

### PUT /api/feishu-assistant/apps/:id/intent-supplement `PROTECTED`
保存这个应用的「本企业补充规则」（migration 059）—— 让助理听懂本公司的术语、简称、
时间习惯。请求体 `{ text: string }`，响应是更新后的整行（同 `GET /apps` 的形状）。

- **空串是合法值**，语义是「回落到平台默认那份」，不是「忽略本次请求」。
- 上限 **4000 字**，超了 `400`。这段话每解析一条指令就随 prompt 发一次：
  太长会让每条指令都更慢更贵，而且会把后面的硬性规则（open_id 只许照抄、
  输出必须是 JSON）压下去 —— 表现是助理"忽然开始把任务派给错的人"。
- **按应用存，不按账号**。一个应用 = 一个飞书租户，一个账号能绑多个应用。
- **改完不用重连**，下一条指令就生效（dispatcher 每条消息都重取应用行）。
- 只影响"怎么听懂人话"。动作清单、JSON 格式、open_id 约束都在代码里，
  写在这里无效，详见 `docs/FEISHU_ASSISTANT.md` 第八·二节。

错误：`400` 超长 · `403` 他人的应用 · `404` 不存在

### GET /api/feishu-assistant/commands `PROTECTED`
指令执行日志，排障的唯一依据。

Query：`status` (`pending`/`running`/`done`/`failed`/`ignored`) · `app_id` · `page` · `page_size`（默认 50，上限 100）

非管理员的结果被钉死在自己的记录上；传他人的 `app_id` 筛选返回 `403`
（否则能读到别人在飞书群里说过的原话）。
```json
{
  "commands": [{
    "id": "...", "app_id": "cli_xxx", "chat_id": "oc_xxx", "chat_type": "group",
    "sender_name": "张三", "text": "记一下：客户要把 logo 改大",
    "action": "add_diary_record", "params": "{\"content\":\"客户要把 logo 改大\"}",
    "status": "done", "error": null, "error_detail": null,
    "result": "{\"summary\":\"📝 已记到 印度纪录片…\"}",
    "duration_ms": 2840, "created_at": "...", "completed_at": "..."
  }],
  "total": 1
}
```

一句话里说了两件事时（「记一下客户要改 logo，顺便派给张三」），`action` 是
`"add_diary_record + create_task"`，`params` 存的是步骤数组；一步时和以前逐字节相同。
`result` 里 `summary` 是**做成了的那几步**的回复拼起来（前端详情页直接读它），
`steps[]` 逐步给 `action` + `summary` + 该动作自己的 `data`：
```json
{
  "summary": "📝 已记到 印度纪录片：客户要把 logo 改大\n✅ 任务已创建：把 logo 改大（张三）",
  "steps": [
    { "action": "add_diary_record", "summary": "📝 已记到 印度纪录片…", "project": "印度纪录片", "record_id": "...", "synced": true },
    { "action": "create_task", "summary": "✅ 任务已创建…", "guid": "...", "title": "把 logo 改大", "url": "https://…" }
  ]
}
```
**做成了一半算 `failed`**（有一件事没办到不能记成成功），此时 `result` 里只有成功的步骤，
没做成的那一步在 `error` / `error_detail` 里。用户收到的回帖会明确说「前面的已经生效了」——
否则他整条重下，成功的那部分会再做一遍。

`error_detail` 是**已解析的对象**（库里存 JSON 字符串，接口解开后返回；坏数据返回 `null`）。
缺权限时前端据此渲染「一键补权限」按钮，而不是去正则解析 `error` 文本：

```json
{
  "kind": "scope_denied",
  "message": "飞书应用缺少权限。\n需要开通以下任一项：task:task:write 或 task:task:writeonly\n…",
  "code": 99991672,
  "log_id": "20260804185909A15E80512A3691A0BCA3",
  "scopes": ["task:task:write", "task:task:writeonly"],
  "apply_url": "https://open.feishu.cn/app/cli_xxx/auth?q=task%3Atask%3Awrite&op_from=openapi&token_type=tenant"
}
```

`kind` 为 `api_error` 时只有 `message` / `code` / `log_id`。
`scopes` 多项时语义是**任一即可**。migration 055 之前的历史记录该字段为 `null`。

---

## 小红书写作台 (xhs)

### POST /api/xhs/rewrite `PROTECTED`
整篇正文改写（流式 SSE）。和 `/api/xhs/revise`（改选中片段、返回 JSON）是两件事。

```json
{
  "body": "要重写的整篇正文（纯文本，必填）",
  "message": "作者的诉求（必填）",
  "skillId": "写作风格 skill id（可选，不传/无权访问则不加风格）",
  "persona": "作者人设（可选）",
  "niche": "赛道/人群（可选）"
}
```

响应是 `text/event-stream`，逐条 `data: {"delta":"…"}`，以 `data: [DONE]` 结束。
两个必须处理的非 delta 事件（xhs 下所有流式接口同一套）：

- `{"error":"…"}` —— 上游报错/空返回，前端要抛出去，不能当流结束。
- `{"truncated":true}` —— 撞上模型输出上限，**前面的内容都是好的，但结尾断在半句话上**。
  不读这个事件的话，被截断的稿子和写完的稿子长得一模一样，用户会直接采纳/发布。

输出是**纯正文、不含标题**（标题在前端是单独的输入框；混进流里前端就得猜第一行是不是标题，
猜错的表现是标题被塞进正文第一段而原标题还留在框里）。

### GET /api/xhs/skills/templates `PROTECTED`
内置写作 skill 模板列表（写死在代码里，不查库，和用户自己的 skill 无关）。

```json
{
  "templates": [
    {
      "id": "human-writing",
      "name": "活人感写作",
      "description": "一句话说明这份规范管什么",
      "origin": "出处说明（字段叫 origin 不叫 source）",
      "chars": 3000
    }
  ]
}
```

### POST /api/xhs/skills/import-template `PROTECTED`
把某个模板复制成当前用户的一个 skill，返回 `201 { skill }`（结构同
`POST /api/xhs/skills`）。模板不存在回 404。**每次调用都新建一份，不查重** ——
导第二份通常就是想拿一份干净的重来。

```json
{ "templateId": "human-writing" }
```

---

## HTML 展示稿 (ppt)

一份稿子的完整链路（每一步的产出**都落库**，前端不回传 html / 规划行 —— 回传的话它内存里
那份就是事实上的输入，产出每一页都好看、只是和这份稿子对不上，四条路径全不报错）：

```
POST /decks                    建一份（进工作台会自动规划一次）
POST /decks/:id/plan           提纲 → 每页一个版式（1 次 AI 调用，清掉已生成的页）
POST /decks/:id/replan-images  按真实内容 + 现在挑的版式重排图位清单（1 次 AI，不生图）
POST /decks/:id/prepare-images 逐格备图（可选，AI 生一张 = 一次真实花费）
POST /decks/:id/image-prompt    预览这一格真正会发出去的整条提示词（不生图、不写库）
POST /decks/:id/craft-image-prompt  AI 润色这一格的「画什么」那句（1 次 AI 调用，不生图、不写库）
POST /decks/:id/rewrite-image-prompt  AI 重写这一格的整条提示词（1 次 AI，回来那条要存成自定义）
POST /decks/:id/pages          生成第 N 页 HTML（1 次 AI，顺手把备好的图贴进去）
POST /decks/:id/images         给第 N 页配图（按图位逐张生图）
POST /decks/:id/edit-text      就地改第 N 页的一段文字（不调 AI、不花额度）
POST /decks/:id/edit-style     改第 N 页某一块的颜色/字号/字重/对齐（不调 AI）
POST /decks/:id/edit-region-style  改第 N 页某一整块（容器）的 align-items（不调 AI）
POST /decks/:id/delete-node    删掉第 N 页选中的那一整块（不调 AI；含图的一律 400）
POST /decks/:id/canvas         空白页画布上摆东西：加文字框/加图 / 拖动缩放 / 删一块（不调 AI）
PATCH /decks/:id/pages/:page/veil  调第 N 页那层黑蒙版的透明度（不调 AI）
GET  /edit-palette             浮动条能用的那几个颜色（服务端白名单，前端不自己写一份）
POST /decks/:id/ai-edit        让 AI 改选中那一块的结构（1 次真实调用，文案打码后发出去）
POST /decks/:id/ai-remake      自由改造选中那一块（1 次真实调用，可重排/加图/新写文案，逐条报出来）
POST /decks/:id/deck           拼整份（不调 AI，缺页 400）
POST /decks/:id/export         导出 .html（不调 AI）
```

`/api/ppt` 下限流 **300 次/分钟**（案例库一页就是 65 个 iframe，60 的话翻两页就被 429 挡住，
而卡片上照样挂着「效果 demo」）。除 `GET /demo-deck.html`（public，`<iframe src>` 带不了
Authorization 头）以外全是 `PROTECTED`，且**每一条 deck/page/素材查询都带 `user_id`** ——
少了它，换个账号带上别人的 deck id 读到/改到的是他那份稿子，而响应完全正常。

### GET /api/ppt/decks `PROTECTED`
我的演示稿列表（按 `updated_at` 倒序）。

```json
{
  "decks": [
    {
      "id": "uuid", "title": "云启数科 AI 转型",
      "outline_chars": 3200, "planned_total": 12,
      "built_count": 7, "imaged_count": 3,
      "brand_cn": "云启数科", "style_id": "S-A",
      "created_at": "2026-09-03T…", "updated_at": "2026-09-03T…"
    }
  ],
  "layoutTotal": 76
}
```

`layoutTotal` 是案例库里的版式条数（列表页那颗「版式案例库（N 个）」用它，前端**不许写字面量**
—— 库里加了十几条之后那颗按钮上还是老数字，页面完全正常而他以为案例库一直没长）。
案例库读不出来时它回 `0`，前端就不显示那个数（库坏了由 `GET /api/ppt/layouts` 去报，
在这条路上 500 的话现象是「演示稿列表打不开」，指向完全另一个地方）。

`planned_total / built_count / imaged_count` 三个数是他判断「这份稿子干到哪了」的唯一依据。
`imaged_count` 是**图真的配齐了的页数**（html 里已经没有占位图），不是「跑过配图的页数」：
跑过但全失败的那一页在预览里只是「这版设计得比较空」，算进去的话他以为图都好了，
转给别人才发现半份是占位图。

### POST /api/ppt/decks `PROTECTED`
```json
{ "outline": "整份提纲（≤12000 字）", "title": "可选，缺省取提纲第一行", "brandCn": "", "brandEn": "", "styleId": "S-A",
  "design": { "palette": "P-B", "font": "F-A", "density": "D-B", "header": "H-A" } }
```
回 `{ "deck": { …完整 deck… } }`。名字缺省取提纲第一行但**存下来**，不每次现算 ——
现算的话改一次提纲第一行，列表里那份稿子就换了名字，读起来像另一份。

400：名字空着（提纲也空）、名字超 80 字、提纲超 12000 字。提纲**只拒不截**：截掉的是后半段，
而规划出来的那份「完整」规划里压根没有那几页，界面上看不出少了什么。
上限和 `planService.MAX_OUTLINE_CHARS` 是同一个数（两处两个数的话存得进去而一点「开始规划」
就被拒，他看不出是哪一边的限制）。

### GET /api/ppt/decks/:id `PROTECTED`
`{ "deck": { "id", "title", "outline", "brand_cn", "brand_en", "style_id", "notes",
"plan_json", "planned_total", "status", "created_at", "updated_at" } }`；不是自己的回 404。

`plan_json` 是 `POST /decks/:id/plan` 那次的**整份返回原样存的字符串**（空串 = 还没规划过），
前端的规划面板读它 —— 逐页的 `layoutId` / `alts` / `why` / `imageSpecs` 都在里面。

还回 `design`（这份稿子的设计规范，096 `design_json` 解析过的那份 `{palette,font,density,header}`）和
`designProblems`（认不出的 id 回落到默认那档时的那几句话）。**前端要用这个 `design` 而不是自己
去解析 `deck.design_json`**：两处各解析一遍的话，画面按服务端那份渲染、下拉显示前端那份，
认不出的 id 上两边不一样而一处都不报错。`designProblems` **必须显示出来** —— 不显示的话他打开
一份「墨绿」的稿子看到的是橙的，而下拉里也显示成默认那档，看起来像他从来没选过。

### PATCH /api/ppt/decks/:id `PROTECTED`
```json
{ "title": "", "outline": "", "brandCn": "", "brandEn": "", "styleId": "S-A", "notes": "整份要求（≤500 字）",
  "design": { "palette": "P-B", "font": "F-A", "density": "D-B", "header": "H-A" } }
```
回 `{ "deck": {…} }`。**只改传了的那几个字段**：缺省成空串的话，任何一次只改名字的保存都会
把提纲清空，而两边都回「已保存」。

**一个字段都没传回 404**（不是 200）—— 静默成功的话前端那句「已保存」是假的。
400：名字空/超 80 字、提纲超 12000 字、`notes` 超 500 字（整份那段和页级那段**同一个上限**，
两处都是拒不是截 —— 截掉的半句照样发给模型，而他写在后面那几条要求每页都不生效）。
改 `notes` / `styleId` **不会重排或重做已经生成的页**（那是真实花过钱的），界面上要写明
「要逐页重新生成才会按新要求排」。

`design`（096）反过来：改了**已经生成的页立刻跟着变**（规范是靠拼装时覆盖 `:root` 生效的，
一次调用都不花）—— 所以前端存完要**重读一遍那几页**（`previewHtml` 是服务端现拼的），
不重读的话画面上一点变化都没有，他会以为这个下拉坏了、或者以为得重新生成十几页。
三项**必须整段传**，任一项认不出或缺失一律 **400**（不回落）：回落的话下拉里写着「墨绿」而整份是
橙的，两处对不上而一处都不报错。

### DELETE /api/ppt/decks/:id `PROTECTED`
`{ "ok": true }`；不是自己的回 404。同一个事务里把它的页一起删（`ppt_deck_pages`），
生成过的图**留在素材库里**（那些是真花过钱的），COS 上的文件也不动。

### POST /api/ppt/outline-chat `PROTECTED`
「生成提纲」那个对话页的一轮（新建演示稿**之前**用，所以**不带 deck id、不写任何库**）。
一次 AI 调用。

```json
{
  "turns": [{ "role": "user", "content": "给客户讲我们的 AI 转型方案，30 分钟，要他们批预算" }],
  "currentOutline": "（可选）他在提纲框里已经有的那一份，这次在它基础上改",
  "attachments": [{ "filename": "产品资料.pptx", "text": "…", "variant": "tidy" }]
}
```
回 `{ "reply": "聊天气泡里那段话（提纲那一整块已经摘掉）", "outline": "整份提纲或 null", "problems": [], "usage": {…} }`。

**整段对话由前端带全，服务端不存**：漏带历史的话模型每一轮都从头问一遍听众和场合，
而界面上只是「它怎么老在问同样的问题」。

提纲正文靠一对标记（`===提纲开始===` / `===提纲结束===`）抠出来，**标记由服务端写进 prompt、
也由服务端认**（硬规则 3；两边各写一份的话改了一边之后每次都「聊得很好但一直不出提纲」）。
不让它整段当提纲：它那句「好的，我按招标场合写了一份：」会跟着进提纲输入框，然后被分页那一步
当成第一页的要点逐字排上去。不用 JSON：这条路的正文是一大段多行纯文本，偶发的转义会把整次
对话变成一句「解析失败」，而他要的只是聊天。

**`outline` 为 null 时 `problems` 里必有话，前端必须逐条显示**：最要紧的一种是
「只贴了开始标记、没有结束标记」（提纲天生是写到哪算哪的东西，把后半截当提纲带回去的话，
他看到一份读起来完整的提纲、排出来的稿子也完整，只是少了后面几章，一处都不报错）。
提纲超 12000 字同样不带回去（**只拒不截**，和提纲输入框那道闸门同一个口径）。

后台可在 skill 管理里给 `ppt-outline` 这个 slot 绑一份 skill，它**追加**在
`library/outline-craft.md` 后面（不覆盖 —— 覆盖掉的话「不许编数字」「提纲是纯文本行」
这两条要看他写的 skill 里有没有，而编出来的数字会被逐字排上页面）。

`attachments`（最多 5 份，来自下面那两条上传路）**由服务端合成成资料那一段**
（`composeMaterials`，和 `briefCompose` 同一口径），前端不许自己拼好整段传上来 ——
拼的话「第 3 份没进去」在界面上完全看不出来（卡片还在），而提纲是照着少一份资料写的，
读起来一样通顺。它**每一轮都会带上**（字数算在那 20000 字上限里）。

**单份资料不限字数**（咨询那边是 3500 —— 这条路上一份七千字的产品资料是常事，拒掉之后他
唯一的出路是自己进卡片删掉一半，而删掉的正是排在后面那几节）。拦人的只有合计那道闸门。

400：`turns` 为空 / 超 40 条 / 单条超 4000 字 / 资料合计超 20000 字（只拒不截，并点名每份
多少字）、那份 md 读不到、模型一个字都没返回（带 `finish_reason` 和思维链 token 数）。

### POST /api/ppt/extract-file · POST /api/ppt/tidy-text `PROTECTED`
「生成提纲」页上传参考资料用的两条路。**请求和响应与
`/api/consult/extract-file` · `/api/consult/tidy-text` 逐字相同**（同一份实现
`server/src/api/extractRoutes.ts`，前端也是同一个面板 `components/common/FileExtractPanel.vue`），
差别只有三处：① 额度和 `ai_logs.source` 记在 **`ppt`** 上（不是 `consult`）；
② `briefLimit` 回的是提纲对话那条 20000 字上限；③ `fileLimit` 回 **0 = 单份不限**
（咨询那边回 3500）。`fileLimit` 和 `budgetChars` 是两件事：后者是 AI 提炼的**目标**字数，
两条路都还是 3500。前端卡片上那行「N / M 字」按 `fileLimit` 显示，0 时只报字数 ——
拿 `budgetChars` 当上限显示的话，提纲页上一份 7442 字的资料会标红成「7442 / 3500」，
而服务端压根不拦它，他会照着那个假上限自己删掉正文。

**接新页面时 `apiBase` 必须跟着换**：图省事沿用 `/api/consult` 的话，传上去、提取出来、
整理好，界面上一切正常，只是那几次调用记在了品牌咨询的应用额度和日志上 ——
管理员把咨询限成 5 次/天之后，这个页面会回一句说咨询额度用完了（他压根没在用咨询）。

### POST /api/ppt/decks/:id/clean-outline `PROTECTED`
先整理、再分页：把提纲里的无效信息（他写给自己的备注/待办、会议记录的口头语、文件路径、
重复标题）挑出来删掉。一次 AI 调用，body 不用带东西（**提纲取库里那一份**，同 `/plan`）。

```json
{
  "cleaned": "整理后的提纲全文（原文逐字去掉下面那几行，其余一个字没动）",
  "removed": [{ "line": 12, "text": "（备注：这里要补一张图）", "why": "他自己的待办" }],
  "problems": ["删掉的行里有 2 行带数字，逐行核一遍…"],
  "changed": true,
  "chars": { "before": 3120, "after": 2870 }
}
```

**模型只输出行号，删的动作在代码里**（硬规则 3）。让它回一份「整理好的提纲全文」的话，
那份文本读起来更顺、层级更整齐，而中间某个数字被改了、两行被合成一行、一句结论被换了
说法 —— 一处都对不出来（和原文没有任何可校验的对应关系）。只回行号的话留下来的每一行
都是逐字的，`removed` 里每一行都能原样列给他核。

**服务端不写回库**（`deck.outline` 一个字没动）：前端拿 `cleaned` 替换编辑框的内容，
存进库是后面 `PATCH /decks/:id` 那一次的事 —— 于是「撤销整理」做得到，而删错一行时
整理后的提纲读起来完全通顺。`changed`（= `removed.length > 0`）要单独用：**「模型认为没有
要删的」和「这次调用其实失败了」在界面上必须分得开**，不然按钮点下去什么都不变，而额度
已经扣了。`problems` 逐条显示 —— 里面是「删掉的行里有几行带数字」（唯一真会造成损失的
事故：`营收 12.4 亿` 被判成备注，整理后读起来完全通顺）、「删掉的字数占了三成」（那是
精简、不是去备注）、以及被截断时「后半截没看过」。模型给的行号越界时**不夹到边界**
（夹一下删的是别的一行），忽略并在 `problems` 里说有几个用不了。

400：提纲空 / 超 12000 字（**只拒不截**）、拿不到 JSON（带思维链 token 数）、
模型把整份都当成无效信息（整理后是空的，这时**不改动他的提纲**）。404：不是自己的稿子。

### POST /api/ppt/decks/:id/plan `PROTECTED`
排版规划：这份稿子的提纲 → 每页挑一个版式（**不生成 HTML**），一次 AI 调用，结果落库。
**不收 body 里的 outline**，提纲取库里那一份 —— 收 body 的话前端那个还没保存的编辑框成了
事实上的提纲，「库里存的」和「刚规划的」是两份，而两边都正常返回。

```json
{
  "pages": [
    {
      "page": 3, "kind": "内容", "section": "第二部分 · 落地路径", "title": "三阶段路径",
      "points": ["试点", "复制", "平台化"],
      "layoutId": "L7", "alts": ["L3", "L9"], "why": "挑它的理由（一句话）",
      "images": 2,
      "imageSpecs": [{ "subject": "画什么", "mode": "concept", "ratio": "16:9" }],
      "layoutName": "tri-narrative-photo", "layoutTitle": "三栏并列叙事 · 全幅图叠字",
      "fullbleed": false, "demoUrl": "/api/ppt/demo-deck.html?only=L7"
    }
  ],
  "problems": ["每一处「结果能用但有话要说」"],
  "usage": { "prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0 },
  "clearedPages": 7, "clearedImages": 4, "clearedNotes": 2
}
```

`page` 和 `images`（张数）由**代码**算（硬规则 3）：模型编一个页码会跳号、`images` 另存一份的话
面板上写着「要 2 张」而下面列着 3 条规格，两处都读起来正常（`images === imageSpecs.length`，
只有模型压根没给规格时才用它给的那个数字，那时 `problems` 里有一条）。`imageSpecs` **没有
`index` 字段** —— 「第几格」就是数组位置（从 1 起），`prepare-images` 的 `index` 对齐它。
`alts` 是校验过的备选版式（不在库里的、和 `layoutId` 重复的已经丢掉，最多 3 条）。
`kind` 是模型标的页型（`封面` / `章节` / `内容` / `结尾`，认不出来的词回空串 —— 老 deck 里存着的 `目录` 现在就走这条，读出来是空串），
只用来核对版式挑得对不对（对不上时 `problems` 里有一条，页型和版式**都不会被改**）——
老 deck 的 `plan_json` 里没有这个字段。

每一页还有 `outlineText`（代码按模型给的行号从提纲里**逐字**切出来的那几行，生成时它才是
真正上屏的内容）和 `outlineRange`。**没有任何一页认领的提纲段落由代码并进相邻页**
（接在前面那一页的原文末尾，保持阅读顺序），并在那一页上留一句 `coverNote` —— 前端必须
把它显示在「本页内容」旁边：并进来的位置不一定对，而并进来之后那一段读起来和模型自己认领
的一模一样。老 deck 的 `plan_json` 里没有 `coverNote`。

`problems` **落库和日志，前端那块 deck 级清单已经去掉了**（十几条一起涌出来时一条都不会被
读）。里面唯一真会让用户内容丢掉的那一条（提纲有几段没进任何一页）就是上面那个硬校验；
剩下的这些照旧只在 `plan_json` 里 —— 这一步的失败形态全是「一份看起来完整的规划」：
模型给了库里没有的版式（那一页被丢掉并点名，绝不静默替换成某一条）、被截断只规划到第 N 页
（断点前那几页救回来了）、连续 ≥3 页同版式（只报不改）、`kind` 和版式的 `归属` 对不上
（封面那一页排出来是四栏矩阵，而编号完全合法）、图的规格被归一、备选被丢掉。

响应里还有 `planRev`（098，重新规划把旧页全清了所以它也 +1）：**前端必须换上** ——
不换的话规划完点第一次生成就是一句 409，而他刚刚才在这里成功规划过。

`clearedPages` / `clearedImages` / `clearedNotes` 是这次规划**扔掉的东西**，三个都要说出来：
已经生成的那几页、逐格备好的图、他手写的那几段要求 —— 全是花过钱或写过字的，不说的话
他只看到一句「规划好了」。备好的图那句要补「图还在素材库里可以挑回来」。

400：提纲空 / 超上限、规划出来超 45 页、拿不到 JSON、全部页都用了库里没有的版式
（一律带原文，**不回 `{pages:[]}`** —— 空规划和「这份提纲拆不出页」在界面上分不开）。
500：规划出来了但没存上（那次调用已经花掉了，话术里要写「刷新看看，别直接重试」）。

### GET /api/ppt/decks/:id/pages `PROTECTED`
这份稿子已经生成/已经备过图的那几页。

```json
{
  "pages": [
    {
      "page": 3, "layoutId": "L12",
      "html": "<section …>",
      "section": "这一页那一段（贴好蒙版、剥掉页码）；html 为空时是空串",
      "problems": ["生成那次留下的问题"],
      "images": [{ "index": 1, "url": "…", "ratio": "16:9 landscape" }],
      "imageStyleId": "S-A",
      "pendingImages": [{ "index": 1, "url": "…", "from": "ai | library" }],
      "setupLayoutId": "他挑的版式（空 = 照规划）",
      "notes": "这一页那段要求",
      "veilOpacity": 0,
      "imageMode": "split | backdrop | poster",
      "backdropMask": 0.3,
      "posterText": ["我们的能力", "十年行业经验"],
      "backdropBlock": "这一页的底是 .l67-wrap 上的 var(--c-ink-deep)…（能改就是 null）",
      "decor": false,
      "decorAlpha": null,
      "updatedAt": "2026-09-03T…"
    }
  ],
  "shell": "这份稿子所有页共用的预览外壳（约 85KB），里面留一个插入点",
  "previewSlot": "<!--PPT_PREVIEW_SLIDE-->"
}
```

单页预览 = `shell.replace(previewSlot, () => page.section)`，**外壳整份只回一次**：原来给每页
都回一整份拼好的 deck，也就是把同一份外壳抄了 N 遍 —— 那份 41 页的稿子响应 3658KB，而库里
那些页的 html 合计只有 51.5KB，改成这样是 141KB。这件事界面上看不出来，只是「打开有点慢」。

**前端只做字符串替换、不重算任何东西**（一律用函数形式的 `replace`：字符串形式下正文里的
`$&` 会被当引用展开，悄悄吃掉几个字符）。蒙版（097）和页码剥离都在服务端的 `previewSection`
里，也就是仍然只有 `deckShell` 这一份实现 —— 前端自己贴蒙版的话预览和导出是两种深浅，
而两边各自都是一页正常的幻灯片。外壳和每一页现拼、都不存：存下来的话改过骨架之后老 deck 用
旧骨架渲染、导出用新的，两边都不报错。

`shell` / `previewSlot` 缺失或对不上时前端**必须出声并且不要重新生成**：拿一份对不上的外壳去
replace，出来的是一份没有幻灯片的 deck —— 页脚、缩放全正常，只是一块白，读起来像那一页塌了。
**`html === ''` 的行会出现**（先备了图、还没生成 HTML），那种行的 `section` 是空串，前端
**不许**把它当成「已生成」。

`images`（配图跑完的结果 / 贴进去的备图）和 `pendingImages`（备着、还没贴）**分开回**：
合成一个的话「这一页图配好了」和「图只是备着」分不开，他会直接去拼整份（那几格还是占位图）。
`setupLayoutId`（他挑的）和 `layoutId`（这份 html 实际用的）不一样 = 换了版式还没重新生成，
前端必须显眼说出来 —— 两版都是一页正常的幻灯片。
**这条读不出来（请求挂了）也要出声**：静默当成「还没生成」的话界面上是「生成全部 12 页」，
而那十几次调用已经花过了。
`veilOpacity` 是那层黑蒙版（097，0 = 没有）：前端的滑块**照它画**，不在本地记 ——
只在本地记的话刷新一次全部归零，而画面上那一页真的还是暗的。

`imageMode` / `backdropMask` / `posterText`（103、104）**全是服务端按 html 里的记号现算的，
库里没有对应的列**（`backdropMask` 不是背景图模式时回 `null`，`posterText` 不是单图模式时是空数组）。
前端同样**照它画、不在本地记**：只在本地记的话刷新之后按钮写着「改成背景图」而这一页已经是背景图了，
点下去回一句「已经是背景图模式了」，看起来像功能坏了。`posterText` 是**会印进那张单图里**的几行字
（代码从这一页扒的，超长的和超出 6 行的已经丢掉了），必须显示出来 —— 不显示的话「怎么少了一句」
要等图生出来才发现，而那是一次真实花费。

`backdropBlock` 是**这一页能不能改成背景图**：`null` = 能，有值 = 那句真实原因（服务端
`backdropBlocker` 真试了一次 `toBackdrop` 再把结果丢掉，纯代码不花钱）。前端照它决定
「改成背景图」那个按钮画不画，**不在前端另写一份「哪些版式不行」的清单** —— 库里加一条深底
版式那天按钮又会出现在它上面，点下去还是同一句红字。按钮藏起来时**必须把这个原因显示出来**
（光消失的话「这一条版式不支持」和「这个功能坏了」在界面上分不开），而且**要原样显示**：
成因有好几种（底是深墨底 / 是品牌色 / 版式自带整页背景图 / 图位不是正好一格），合成一句
「这一页不支持」的话他会去换配色、去改这一页的底，那几条路都没用。**只有分屏页会算**
（别的模式上压根没有这个按钮），所以背景图/单图页一律回 `null`。

`decor` / `decorAlpha`（装饰底图那一层）同样是按 html 上的 `data-decor` 现算的，
**`decor` 要无条件写进前端那个 map**（不是「true 才写」）：去掉那一层之后留着旧的 true 的话，
按钮一直写着「去掉装饰背景」，点下去回一句「这一页没有装饰背景」。`decorAlpha` 不带那一层时是
`null`（前端缺省值要和服务端 `imageModes.DECOR_ALPHA` 一个数，见下面那条）。
**装饰层不是第四种 `imageMode`**：它是加在 `split` 页上的一层，`imageMode` 照旧回 `split` ——
硬塞一个 `decor` 进去的话「改成背景图 / 改成单图」那两个按钮的判据（`imageMode === 'split'`）全乱。

上面这六个字段（`imageMode` / `backdropMask` / `backdropBlock` / `decor` / `decorAlpha` /
`posterText`）**`POST /decks/:id/pages`（生成这一页）的响应里也照样回一份**（服务端同一个
`pageModeState`），前端生成完当场接回来、**不等下一次刷新**：这一页的图模式可能刚被版式自带的
默认值（`applyDefaultImageMode`）变成整页背景图，不接的话那一栏写着「分屏」而画面是整页背景图、
底下唯一的按钮是「改回分屏」（重新生成一页时反过来：库里已经退回分屏，界面还留着上一版的
「单图」和「改回原版」）—— 两句话互相矛盾，各自又都是正常文案，刷新一下就对了。

### DELETE /api/ppt/decks/:id/pages/:page `PROTECTED`
删掉这一页（规划里那一条 + 库里那一行），后面的页码整体往前挪一位。**不调 AI。**

```json
{
  "plan": { "pages": ["改完的整份规划，page 已按数组顺序重编"], "problems": ["…"] },
  "planRev": 4,
  "removed": { "html": true, "images": 2, "prepared": 1, "notes": true, "veil": false },
  "shifted": 3
}
```

`removed` 要**逐类显示出来**：那一页的 html 是一次真实调用、每张图各一次，只显示「已删除」
的话他不知道刚扔掉了什么（少掉的那一页在界面上只是少了一张卡）。备好的图仍在素材库里能挑回来，
这半句也要说。整份只剩一页时 **400 不给删**（删完之后界面上和「还没规划过」一模一样，
而提纲还在，他会以为规划丢了）；`plan_json` 读不出来时同样 400 —— 只改一边会让页码和规划错开一位。

**前端拿到之后要按 `plan` 重画并把按页码索引的本地状态全部清掉重读，不要本地 splice**：
备图/蒙版/额外要求/已生成的画面那十几个 map 的 key 都是页码，不清就整体错位一位，
而每一页渲染出来都是一页正常的幻灯片。`planRev` 要换上（见下面那条）。

### POST /api/ppt/decks/:id/insert-page `PROTECTED`
在第 `after` 页后面插一页（`after: 0` = 插到最前面），后面的页码整体往后挪一位。**不调 AI、不花额度**
（提纲是他自己写的）。库里**不建行** —— 新页还没生成。

```json
// 请求
{ "after": 3, "title": "三个行业的实战案例", "points": ["制造：排产", "金融：风控"], "layoutId": "L17" }
// 响应
{
  "plan": { "pages": ["改完的整份规划，page 已按数组顺序重编"], "problems": ["…"] },
  "planRev": 5, "page": 4, "shifted": 8,
  "layoutId": "L17", "section": "五、行业实践", "layoutInherited": false, "blank": false
}
```

**`blank: true`（103）= 插一页空白页**（他自己往上摆文字和图那种）：`layoutId` 是 `BLANK`
（不在案例库里、没有 demo），库里**当场就建行并写好 html**（一个空的 `.bl-canvas`），所以它一插进来
就是「已生成」。请求里同时给 `points` 或 `layoutId` 一律 **400**：空白页不走 AI 生成，那几条要点
一个字都不会出现在页面上，而插进来那一下是成功的、左边列表里那一页也在。只认 `blank === true`，
`"true"` / `1` 都当没传（当成普通插页的话，回来的是一页要挑版式、要点还在的普通页）。
**对空白页调 `POST /decks/:id/pages`（生成/重新生成）一律 400** —— 生成会按案例库的版式把整页换掉，
他摆的文字和图全没了，而返回的是一页读得通的幻灯片。前端也要据 `layoutId === 'BLANK'` 藏掉生成按钮。

`layoutId` 可以不传 —— 那时跟着插入位置**前一页**那条（`layoutInherited: true`）。前端必须据此催他去挑
一条：继承来的那条会让连着两页同一个版式（规范是 ≤2 页），而规划里那几条跨页提示是上一次算的
（这次插页已经把它们标成「可能不准」），不催的话出来是一份翻起来「有点单调」的稿子，没有一处会说。
传了但库里认不出的版式一律 **400**，不回落成前一页那条（他挑了 L12 而插进来的是 L07，往后翻回来
读起来完全正常）。`section`（模块名）跟着前一页，`kind` 留空、`alts` 空、`images: 0`：凭空给几格图位的话
备图面板上挂着没人定过内容的格子，他备完图生成出来贴不进去。

到 `MAX_PAGES`（45）时 400。`title` / `points` 的上限和「生成前改提纲」那条完全一致（60 字 / 12 条 /
每条 200 字），超了一律拒不截断。响应和删页同形状，**前端同样要重读整份、换上 `planRev`、
清掉按页码索引的本地状态**（见上一条）。

#### `planRev`（098）：按页码写库的**每一条**都要带
`POST /decks/:id/pages`、`POST /decks/:id/images`、`POST /decks/:id/prepare-images`、
`POST /decks/:id/replan-images`，以及**就地编辑那十条**（`edit-text`、`edit-style`、
`edit-region-style`、`delete-node`、`canvas`、`ai-edit`、`ai-remake`、`image-mode`、
`page-decor`、`PATCH …/pages/:page/veil`）的 body
**必须带 `planRev`**（`GET /decks/:id` 的 `deck.plan_rev`，删页和重新规划的响应里都会回新值）。
**不带 400，对不上 409，两种都不执行。**

这几条都按页码写库：这期间页数/页序变过的话，结果会落在**现在的**那个页码上 —— 出来是一页
完整的幻灯片，只是照着别的一页的提纲排的，两边都不报错。要等上游几十秒的那几条还多花了一次
真实费用。**不花钱的那几条同样要带**：他在另一个标签页删了一页之后，这边双击改一句字 /
拖蒙版拿到的是 200 加一句「已修改」，而改的是隔壁那一页 —— 手测测不出来（`pptPlanRev.test.ts`
逐条核 409/400 时库里那一行一个字都没动）。不带时当成「跳过检查」的话，任何一处前端漏传都会
让这道保护静默失效。**这道检查排在「第 N 页还没生成」前面**：反过来的话旧页序的客户端会被
那句 400 引去点「生成这一页」，而那是一次真花钱、落在错的页码上。
409 的文案里两个版本号都要有，不然和网络错误在界面上是同一句话。

### PATCH /api/ppt/decks/:id/pages/:page/veil `PROTECTED`
调这一页那层黑蒙版的透明度。**不调 AI、不花额度。**

```json
{ "opacity": 0.4, "planRev": 4 }
```

```json
{ "page": 3, "veilOpacity": 0.4, "previewHtml": "重拼过的单页 deck（这一页还没生成时是空串）" }
```

`opacity` 要是 **0~1 的数**，超范围/不是数字一律 **400 且不存**（夹到边界的话他拖到 120%
拿到的是 100%，而界面上的数字是他拖的那个 —— 下次刷新才变，看起来像「保存偶尔会跳」）。

蒙版**每一页都有、由代码固定贴**（`deckShell.applyVeil`，`<section>` 里的第一个孩子，
`z-index:1` 夹在背景图和内容之间），**html 一个字都不改** —— 写进 html 的话「重新生成这一页」
会把它带走，而滑块还停在他调的位置。前端必须换成返回的 `previewHtml`，**不要在 iframe 上
自己叠一层半透明黑**：本地那层压在文字上面，而真 deck 里它在文字下面，照本地效果调完导出的
文件是另一副样子。改完整份预览和「已导出」那句话都要作废（拼整份是现拼的）。

### POST /api/ppt/decks/:id/image-mode `PROTECTED`
这一页的图怎么用：`split`（版式原样）/ `backdrop`（那一格铺成整页背景 + 一层幕帘，103）/
`poster`（整页换成一张把文字印在里面的图，104）。**纯代码搬 DOM，不调 AI、不花额度**
（真正那张图要他再点一次 `POST /decks/:id/images`）。

```json
// 请求（mask 只在 mode=backdrop 时有意义：0~1，缺省 0.3）
{ "page": 3, "mode": "backdrop", "mask": 0.3, "planRev": 4 }
```

```json
{
  "page": 3, "mode": "backdrop", "mask": 0.3,
  "notes": ["这一页现在是…（必须显示出来）"],
  "text": ["会印进单图里的那几行字；别的模式是空数组"],
  "imageSpecs": [{ "subject": "…", "mode": "poster", "ratio": "16:9" }],
  "html": "<section …>", "previewHtml": "重拼过的单页 deck"
}
```

**`notes` 必须显示出来**：改成背景图之后铺上去的那张图还是按「版式里那一格」的构图生的
（画面里留着文字那一侧的空白），满屏看就是「这个功能效果很差」，而真正的成因只是还没用
背景图那套提示词重画一张。前端要把返回的 `html` **和** `previewHtml` 都接回去：不接 html 的话
本地那份还是变形前那一版，这一页接下来的配图/就地编辑以它为底 —— 变形被下一次编辑悄悄撤掉。

`mode=backdrop` 时**已经是背景图 + 带了 `mask`** = 他在拖幕帘滑块（只改浓度，不再变形一次）。
深底/品牌色的页、以及压在图上面那一层不是定位元素的页一律 **400 并说出是哪个类名上的哪个值**
—— 硬把底改透明的话那种页上的白字直接压在照片上读不出来（字确实在那儿，投影时才发现）。

**`mode=split` 在单图页上是「改回原版」**：从库里那两列（`poster_from_html` /
`poster_from_images`，104）整份取回来，不是再变形一次 —— 原来的文字、版式和那几张图都回来。
那两列空了（这一页在变成单图之后重新生成过）时 **500 并说清唯一的出路是重新生成这一页**：
静默回一句成功的话画面上还是那张单图，他会反复点那个按钮。变成单图那一下 `images_json` 会被清空
（画面上只剩一张占位图），所以前端在这一进一出之后要**重读这一页的配图**：不重读的话
「配图 3/3 张」还挂着，点开是三张已经不在这一页上的图；改回原版后不重读则写着「还没配过图」
而画面上图都在 —— 他会照着按钮再花一次钱。

**真的换了模式时 `imageSpecs` 回的是按新 html 上的图槽对齐过的那份清单**（`specsFromSlots`，
已经写进 `plan_json`），前端要拿它**就地换掉内存里那一页的清单**。一格图都没有的页改成
`poster` 时服务端会给它加一格整页的图 —— 清单不跟着变成 1 格的话备图那一栏一个格子都不出现，
**那张图压根没有按钮可以生成**，这一页从此停在占位图上，而画面、`notes` 和接口全是正常的；
反过来改回原版退到一页没有图槽的版式时，清单里留着那一格会让他在那儿点「AI 生成」（真花一次），
生出来的图没有槽位可贴。对齐时清单变了的那几句在 `notes` 里（备图、换图、素材库都认这份清单）。
拖幕帘浓度那一路模式没变，`imageSpecs` 就是库里原来那份。

「这一页有几格图」**不另回一个数**：前端按 `html` 里 `data-img-prompt` 现数
（和 `findImageSlots` 同一个正则）。「改成背景图」只在**正好 1 格**时给按钮（0 格 / 多格
服务端一律 400），另存一份计数的话换过模式之后按钮的出没和画面差一拍，而两边都读起来正常。

认不出的 `mode` 一律 400（不回落成 backdrop：前端拼错一个字之后这一页被改成了背景图，
而按钮显示的是另一件事）。要带 `planRev`。

**这一页有装饰底图时 `backdrop` / `poster` 一律 400**，话术要指到「先去掉装饰背景」：
不拒的话背景图那一页留着两格图（下一次生成的图贴进看不见的那一格），单图那一路则是把刚生成的
装饰图连版式一起换掉 —— 两种都 200、画面也渲染正常。

### POST /api/ppt/decks/:id/page-decor `PROTECTED`
给这一页**加/去掉一层装饰底图**，或者只改它的浓度。那一层垫在这一页**全部文字和图的下面**
（`.page-decor{z-index:-1}`），纹样由那一格自己的图槽生成。**纯代码搬 DOM，不调 AI、不花额度**
（真正那张图要他再点一次 `POST /decks/:id/images`）。

```json
// 请求：on=true 加（已经有那一层 + 带 alpha = 只改浓度）、on=false 去掉、只带 alpha = 只改浓度
{ "page": 3, "on": true, "alpha": 0.18, "planRev": 4 }
```

```json
{
  "page": 3, "decor": true, "alpha": 0.18,
  "notes": ["这一页多了一层装饰背景（第 2 格…）（必须显示出来）"],
  "imageSpecs": [{ "subject": "…", "mode": "decor", "ratio": "16:9" }],
  "html": "<section …>", "previewHtml": "重拼过的单页 deck"
}
```

`alpha` 缺省 **0.18**（`imageModes.DECOR_ALPHA`）—— 骨架里 `.page-decor img` 那条 CSS 的
`--decor-a` 缺省值、前端滑块的缺省值、这一行三处**必须是同一个数**：对不上的话滑块写着 30% 而画面上是 18%，
他往回拖的那一下才真的改了库里的值（画面跟着变，看起来像滑块自己跳了一下）。`alpha: 0` 不报错，
但 `notes` 里会说「这一层现在完全看不见」：不说的话他刚点过「AI 生成」（真扣过一次额度）。
那一格**还是占位图时不跟着压淡**（骨架里 `img[src^="/ppt-cases/ph-"]{opacity:1}`）—— 压了的话
刚加完这一层画面上一个像素都没变，而这个接口 200、按钮也翻成了「去掉装饰背景」。

三种 **400**：这一页不是 `split`（背景图/单图整页已经是一张图，这一层垫在它下面完全看不见，
而备图栏会多一格、还能点「AI 生成」花一次真钱）、已经有一层（再加的话这一页有两个装饰图槽，
序号往后的记录全错位，而画面上只是「颜色好像深了一点」）、已经满 6 格
（第 7 格会被 `specsFromSlots` 截掉 —— 那一格在备图面板上压根不出现）。

**`imageSpecs` 必须回、前端必须就地换掉内存里那一页的清单**：不换的话备图那一栏还是原来那几格，
装饰那一格**压根没有按钮可以生成**，这一页永远停在淡淡的占位图上（画面、`notes`、接口全正常）。
装饰图槽一律排在**最后一格**，而且**这一页原来那几格的图和备好的图一个字都不动**
（跟 `image-mode` 不一样，那条会清）—— 清掉的话他点一下「加装饰背景」，这一页配好的图全变回
占位图，每张都是真花过钱的。

铺满整页又刷了实底的那几层（`.l71-wrap{inset:0;background:var(--c-bg)}` 这种）会**就地改成透明**
并在 `notes` 里说一句（去掉装饰背景时原样放回）：不改的话装饰层整片被挡住，「加完一点变化都没有」
而接口 200；底色不是页面本来那几个浅色时 **400 并说出是哪个类名上的哪个值**（硬改透明的话那种页
上的白字直接压在照片上读不出来）。那一格的「画什么」由**代码按这一页的标题**拼（硬规则 3）——
交给模型看着页面编的话每页编一个方向，而全份统一正是这条路的全部意义（统一那件事归母题那一档）。
要带 `planRev`。

### PUT /api/ppt/decks/:id/decor `PROTECTED`
**整份共用的那一层**装饰底图（106）：一张图垫到**所有分屏页**的文字和图下面。**不占任何一格图位、
不调 AI、不花额度**，也**不改任何一页的 html**（贴在拼装那一步，`deckShell.applyDeckDecor`）——
所以它和上面那条 `page-decor` 是两套东西，**不带 `planRev`**（写的是 deck 上那三列，跟页码无关）。

```json
// 请求：三种都可以单独发，全都不带 = 400
{ "fromPage": 3 }                          // 拿第 3 页自己那层装饰图的地址当整份的（推荐入口）
{ "url": "/uploads/x.png", "prompt": "…" } // 直接给地址（素材库里挑的那张）；url: "" = 关掉这一层
{ "alpha": 0.24 }                          // 只改整份浓度
```

```json
{
  "decor": { "url": "/uploads/x.png", "alpha": 0.18, "prompt": "…" },
  "applied": 14, "total": 17,
  "skipped": [{ "page": 5, "applied": false, "reason": "这一页是单图模式（整页就是一张图）。" }],
  "notes": ["整份 17 页里有 14 页垫上了这一层底图（浓度 18%…）", "第 5 页没垫上：…", "导出的 .html 和 .pptx 里都有这一层…"]
}
```

`alpha` 缺省 **0.18**，和页内那层同一个数（四处：migration 106 的列默认值、骨架里
`--deck-decor-a`、`imageModes.DECOR_ALPHA`、前端 `DECOR_ALPHA_DEFAULT`）。`alpha: 0` 不报错，
但 `notes` 里会说「完全看不见」。

**`notes` / `skipped` 必须显示出来。** 垫不上去的页（背景图 / 单图那两路、**自己加过装饰背景的页**
以那一层为准、底上有一层铺满整页的不透明色块挡着的页、还没生成的页）在画面上和「浓度太低」
长得一模一样 —— 不说的话他会翻到那几页反复点这个按钮，或者把浓度拉到 100%。被挡住的那几页
**只报告、不就地改透明**（跟 `page-decor` 那条正好相反：那条动的是他刚点的一页，这条一次动几十页）。

`fromPage` 那条**地址由服务端从那一页的 html 现读**（硬规则 3）：让前端传的话它另写一遍
「装饰层是哪一格」，换过模式/删过一格之后挑中的是正文里的一张配图，而接口 200、图也确实在。
那一页还没生成 / 还是占位图 / 压根没有装饰层各是一句**不同**的 400。`url` 里有引号、括号、空白
一律 400（它拼进 `style="…url(…)"`，会把整条 style 属性截断 —— 那一页的背景图和蒙版跟着一起消失，
而页面照旧渲染）。

### GET /api/ppt/layouts `PROTECTED`
22 条版式案例。**不带 `buildText`**（12 份详情 md 近 2000 行，列表页一个也用不上），
只回 `buildLines` 行数；要完整骨架走 `GET /layouts/:id`。

```json
{
  "layouts": [
    {
      "id": "L11", "num": 11, "name": "tri-narrative-photo", "title": "三栏并列叙事 · 全幅图叠字",
      "applicable": "适用场景原文", "structure": "", "imageSlots": "3 个（pXX_col1/col2/col3）",
      "designHint": "", "variants": "", "fullbleed": true, "hasCard": false,
      "hasDetail": true, "refImage": "/ppt-cases/L11-ref.png", "demoUrl": "/api/ppt/demo-deck.html?only=L11",
      "buildLines": 220, "disabled": false
    }
  ],
  "total": 22,
  "disabledCount": 0
}
```

`disabled` = 在案例库里被停用了（**规划时给模型的清单里没有它**，但它照旧在这个列表里、
`GET /layouts/:id` 也照旧认它 —— 老稿子里用过它的那几页要能重新生成）。列表里**不过滤掉
停用的**：过滤掉的话他再也没有地方把它开回来。

`imageSlots` 是原文（张数和构图要求都在里面，**别在前端拆**）。`demoUrl` 是那条版式的效果
demo，卡片缩略图和「生成前改一下」那个下拉都用它 —— 原始截图（`refImage`）只能标成
「原图参考」放在抽屉里：那是别人家 deck 的截图，用户照它期待颜色，拿到自己品牌色那一版
会以为生成质量不行。

### GET /api/ppt/layouts/:id `PROTECTED`
`{ "layout": { …上面那些字段 + "buildText": "详情 md 全文" } }`；没这条版式回 404。
列表和这条都带 `selectText`（挑版式那次 22 条一起进 prompt 的短文本），`buildText` 只有这条有 ——
生成某一页时只带**那一条**（单条近 8000 字，22 条一起带会把客户内容挤到上下文末尾，
出来照样是一份完整的 HTML，只是内容开始跑偏）。

### PUT /api/ppt/layouts/:id/enabled `PROTECTED`
开 / 关一条版式。`{ "enabled": true | false }`（不是布尔回 400）。
回 `{ "disabled": ["L5", "L10"], "warnings": [] }` —— **停用后的完整清单**，前端照它重画，
不在本地取反：取反的话下面那种拒绝会表现成「开关动了一下、刷新又弹回去」，而理由一个字都看不到。

这份状态**全站共用一份**（存 `system_config.ppt_disabled_layouts`，不分用户、不分稿子），
而且**只影响往后的规划**。两种情况必须显示出来：

- **400**：把某个页型（封面/章节/内容/结尾）停到一条不剩 —— 直接拒。放过去的话规划到
  那种页时清单里没有可挑的，模型会挑一条别的页型的版式：编号合法、每一页单看都完整正常，
  整份就是没有目录/没有封面了。
- **`warnings`**：内容页少了一整种「形状」（聚焦/分屏/并列/对比/数据/时序）—— 只提醒不拦，
  那之后遇到这种结构的内容只能挑一条形状不对的版式，那一页仍然是一页正常的幻灯片。

### GET /api/ppt/design-options `PROTECTED`
整份设计规范的可选项（096）：`{ "palettes": [{ "id": "P-A", "name": "想象橙（默认）", "hint": "一句话" }],
"fonts": […], "densities": […], "headers": […], "motifs": […], "default": { "palette": "P-A", "font": "F-A", "density": "D-B", "header": "H-A", "motif": "M-A" } }`。
`motifs` 是**整份统一的视觉母题**（M-A = 跟着画风、不额外加一层）：它只进背景图 / 单图 /
装饰底图那三路的提示词（`{{MOTIF}}`），**一行 CSS 都不发**。`PATCH /decks/:id` 的 `design.motif`
存进 `design_json`：这个键**少了不算错**（新建页和老前端压根不发它，一起硬卡的话整段设计规范
存不进去 —— 现象是新建稿子时挑的配色字体全丢了），但**认不出的 id 一律 400**（回落的话他挑的
那套母题一页都没生效，唯一症状是「全份图风格还是散的」，而这条路的全部意义就是统一那件事）。
前端还必须说一句**换母题不影响已经生成的那几张图**（图是像素）：跟着另外四档一起说成
「改完立刻跟着变」的话，他换完翻一遍稿子一张都没变，而下拉、保存、接口全是正常的。
`headers` 是左上角那行模块名的样式（H-A 小字加宽字距 / H-B 细宋体 / H-C 品牌色块 / H-D 不显示）——
**页眉的样式是这里的一档，不是让模型写页眉代码**：一进 prompt 模型就会顺手改写模块名和字号，
于是每页左上角那行字都不太一样，而每页单看都正常（硬规则 3）。

前端**不写死这份清单**：库里加了一套配色它不出现，删了一套的话他挑到一个存不进去的 id
（保存时才 400，那一刻看起来像网络问题）。`hint` 也要显示 —— 只有 id 的话他得一个个试，
每试一次要重看整份。拿不到时要出声：静默的话三个下拉是空的，看起来像「这一版没有设计规范这回事」，
而库里存着的那份照旧在生效。

### GET /api/ppt/styles `PROTECTED`
配图画风库（S-A ~ S-F，唯一来源是 `library/illustration-style.md`）。

```json
{
  "styles": [{ "id": "S-A", "name": "现代 SaaS 等距", "isDefault": true, "applicable": "", "render": "", "composition": "", "taboo": "" }],
  "defaultStyleId": "S-A",
  "colors": { "brand": "#…", "accent": "#…", "bg": "#…", "bgAlt": "#…" }
}
```

前端下拉照它渲染，**不写死一份清单**：md 里加了一套画风之后界面上完全看不见，
而选中的那几套照旧能用（读起来像「这个平台就这几种风格」）。`colors` 是**默认那套（P-A）**的色值，只作参考：
这个端点不带 deck id，而每份稿子实际发给生图模型的颜色是**它自己那套设计规范**解析出来的
（096 `deckColors(design)`）—— 蓝色系的稿子配出一堆橙图是唯一症状，而每张图单看都好。**已存的 `styleId` 必须在拿到这份清单之后再覆盖下拉**，
反过来缺省那套会盖掉他存过的画风，而下拉里显示的是缺省值，看起来像他自己选的。

### GET /api/ppt/demo-deck.html `PUBLIC`
版式效果 demo，整份 deck；`?only=L7` 只出那一页。回 **html**（不是 JSON），`no-store`。
案例库的卡片缩略图和抽屉都 iframe 它。

三件事少一件页面上就是一块白而接口全是 200：它在 `auth/middleware.ts` 里登记成 **public**
（`<iframe src>` 带不了 Authorization 头，而 `/api/` 下默认 protected，iframe 里会显示一句
`Authentication required`）；`app.ts` 对这条路径单独发 `X-Frame-Options: SAMEORIGIN`
（全局那句 `DENY` 连同源 iframe 一起拦）；找不到片段回 **404 纯文本原文**并列出现有片段 ——
`{"error":…}` 在 iframe 里就是一行花括号，空 deck 则是一块白加一个「1 / 1」页脚，
读起来像那个版式渲染塌了。

### GET /api/ppt/library/assets `PROTECTED`
deck 级共享资料：`{ "template": "外壳 html 全文", "design_tokens": "", "illustration_style": "" }`。
和 `GET /api/ppt/assets`（用户自己的配图）不是一回事。

### GET /api/ppt/assets `PROTECTED`
配图素材库：当前**租户**生成过的每一张配图（每张都是一次真实的生图调用）。
租户 = 网页登录的这个账号，或者（嵌入模式下）那把 pk 代表的**那家公司** —— 同一把 key 下的
员工共用一个素材库，`POST /assets/upload`、`DELETE /assets/:id` 同一个边界。
和 `GET /api/ppt/library/assets` 不是一回事 —— 那条是 deck 外壳的共享 CSS / 配色资料。

```json
{
  "assets": [
    {
      "id": "uuid",
      "url": "https://cos/…png",
      "prompt": "槽位那句 data-img-prompt（不是渲染完的整段画风提示词）",
      "mode": "concept | case | data",
      "style_id": "S-A",
      "ratio": "16:9 landscape",
      "model": "wanx-v1",
      "storage": "cos | local",
      "deck_id": "出自哪份稿子",
      "page": 3,
      "created_at": "2026-09-03T…"
    }
  ],
  "total": 137,
  "groups": [
    { "deckId": "deck-uuid", "title": "甲方汇报", "deckGone": false, "count": 42, "lastAt": "2026-09-10T…" },
    { "deckId": "已删掉的那份", "title": "", "deckGone": true, "count": 7, "lastAt": "…" },
    { "deckId": "", "title": "", "deckGone": false, "count": 1, "lastAt": "…" }
  ],
  "deckId": "这次筛的是哪一份（原样回）",
  "note": "筛了一份一张图都没有的稿子时那句话（否则是一屏空白）",
  "pageSize": 120
}
```

`total` 是**这次筛出来那一组**的总数，`assets` 最多 `pageSize` 条（按时间倒序）。
**前端要把两个数都显示出来**：只显示列表的话「素材库里就这些」和「这一页装不下」
分不开，用户会以为剩下的图丢了。`storage: "local"` 的那几张要标出来（COS 没配好时图落在
本机磁盘，换机器/多实例之后是 404，而生成那一刻预览里一切正常）。

`?deckId=<稿子 id>` 按稿子筛（素材库那页的 tab 条），`groups` 是每份稿子的张数。
**筛和计数都在 SQL 里做**：前端拿这 120 张自己分组/过滤的话，每个 tab 上的数字和点进去
那一屏都读起来完全正常（「这个项目 3 张」），而那个项目真正的四十张在第 120 张之后 ——
一个看起来完整的项目图库，他要重用的那几张一处都看不到。三条配套：
`deckId=__none__` 才是「没记归属」那一组（`deck_id = ''`）—— 空串一律当「不筛」，
当成那一组的话点那个 tab 会回全库素材，而 tab 是选中的；
`deckGone: true` 是**稿子已经删了、图还在库里**的那一组，**照旧要列出来**（过滤掉的话
那几十张从每个 tab 里都消失，看起来像被删过），前端标一句而不是显示成空名字；
筛到一张都没有时回 `note` 而不是空对象（一屏空白和「素材库是空的」长得一样）。
`deckGone` 按 deck 行**在不在**判、不按标题空不空判：标题本来就可能是空的，
混成一个之后「稿子删了」和「这份稿子没名字」在界面上是同一句话。

### POST /api/ppt/assets/upload `PROTECTED`
上传一张**本地图片**进素材库（`multipart/form-data`；字段 `file`，可带 `deckId` 记归属）。
不花 AI 额度，之后就能像 AI 生成的图一样挑进任一图槽。

```json
{
  "asset": { "id": "uuid", "url": "https://cdn/ppt-uploads/…png", "ratio": "3:4", "mode": "", "model": "本地上传", "storage": "cos | local", "…": "同 GET /assets 那一行" },
  "ratio": "3:4",
  "pixels": "1080×1920",
  "note": "storage=local 时那句话（说清为什么没进对象存储），否则空串"
}
```

上限 10MB（超了 400）。四件事是承重的：

- **比例在服务端按图片字节算**（`imageSize` + `nearestRatio`，只在 `16:9 / 1:1 / 3:4`
  里挑最近的一档），不信前端量的那个数、读不出尺寸时**直接 400 而不缺省成 16:9**。
  这一档是「贴进这一格会被裁掉两边」那句提醒的唯一依据 —— 记错时那张图照旧贴得进去、
  照旧是一页完整的幻灯片，只是主体被裁掉一半，接口全程 200。
- **`mode` 存空串**（不是 `concept`）：挑进图槽时 `asset.mode || spec.mode` 会回落成那一格
  本来要的画法。写死一个的话上传的图会被当成概念插画，数据页那一格的检查就放过去了。
- **转存走和生图同一条路**（`storeUploadedImage` → `persistImage`，PPT 专用桶 + 魔术字节
  核一遍是不是图）。COS 没配时落本机磁盘，`note` 必须带出来并说出成因 —— 那种图换机器 /
  多实例部署就 404，而那时页面上只是一张裂图。改名成 `.png` 的 pdf 一律 400（`mime`
  是浏览器按扩展名猜的，所以魔术字节优先）。
- **存进桶了但没记进素材库回 500**（带上那个 url）：库里没有这一行时素材库里看不到它，
  用户只会以为上传失败再传一遍，而每传一遍都在存储里多留一份孤儿文件。

前端（`PptPlan.vue` 的挑图抽屉）上传完**不自动贴进图槽**：贴进去会立刻关掉抽屉，
那句「只落在本机磁盘上」跟着消失。

### DELETE /api/ppt/assets/:id `PROTECTED`
`{ "ok": true }`；不是自己的或不存在回 404。

**只删这条记录**：COS 上的文件不动，已经用了这张图的那几页 html 也不动。
前端确认框里必须写清楚这一点 —— 不写的话用户以为这是「把这张图从稿子里去掉」，
删完去翻那份 deck 图还在，而这边刚回了一句「已删除」。

### POST /api/ppt/decks/:id/replan-images `PROTECTED`
按**这一页的真实内容 + 现在挑的那条版式**重排图位清单（一次 AI 调用，**不生图**）。
界面上没有单独的按钮：换过版式时前端在 `POST /pages` **之前**自动发一次这个（所以那一下是两次调用）。

```json
{ "page": 3, "layoutId": "可选：这次挑的版式（同 /pages，认不出回 400）", "notes": "可选：这一页的额外要求" }
```

```json
{
  "page": 3, "layoutId": "L11",
  "imageSpecs": [{ "subject": "画什么", "mode": "concept", "ratio": "3:4" }],
  "problems": ["落在新清单外面的备好的图 / 这一页已经生成过了 之类的话"],
  "usage": { "prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0 }
}
```

为什么要有这条：图位清单是**整份规划那一次**定的，版式是用户后来在生成前那个对话框里换的
—— 两者从此对不上而**一处都不报错**（备图面板照旧列着规划那几格，生成时 prompt 里的
「正好 N 个图位」又压着案例里的图位数，出来是一页排得下但空了两格的幻灯片）。
张数**按内容定**（4 块分类就 4 张，案例里画 3 张也一样），比例按版式那个位置的形状定。

四条承重的：**版式取「这次传的 → 上次存的 → 规划那条」**（和 `/pages` 同一个顺序，传了就顺手
存进 `setup_layout_id`，不然重排按新版式算而下一次生成退回旧版式）；**写回 `plan_json` 时
`images` 那个数跟着一起改**（它是「这一页要几张图」的唯一显示来源）；**落在新清单外面的
备好的图要点名**（那几张花过钱，重排之后从面板上消失而库里还留着 —— 不删，只说）；
**这一页已经生成过 HTML 的话回一条 problems 说「要重新生成才生效」**（html 里的图位还是旧的
那几个，新清单第 4 格备的图贴不进去，而面板上那一格挂着缩略图）。存不上回 500 并说明这次调用
已经花掉了。前端**不做成「换版式就自动重排」**：那是一次真实调用，点一下下拉就扣一次额度。

### POST /api/ppt/decks/:id/prepare-images `PROTECTED`
「先备图」：给规划里第 `index` 格备一张图。**这一页还没生成 HTML 也能备。**

```json
{
  "page": 3, "index": 2,
  "from": "library | ai | clear | subject",
  "assetId": "素材 id（from=library 时必填）",
  "subject": "可选：用户改写的提示词（≤300 字）",
  "fullPrompt": "可选：他自己改写的**那一整条**（≤4000 字，\"\" = 恢复自动拼的那条）"
}
```

`from=library` 从素材库挑一张（**不花额度**），`from=ai` 现生一张（**一次真实花费**），
`from=clear` 清掉这一格（只是不再备着，图还在素材库里），`from=subject` **只存提示词、不生图**。

`subject` 一带上就**写回 `plan_json` 里那一格的 `imageSpecs[index-1].subject`**（`from=clear` 除外）：
不写回的话界面上是他改过的那句，而下一次「AI 生成」/配图用的还是模型原来那句 —— 生出来是一张
正常的图，只是不是他要的那张。空的 / 超 300 字**一律 400**（空的生不出任何东西，那一格会一直停在
占位图上；截断的话他写在后面那几个条件一处都不生效）。`from=subject` 时那一格**已经备好的图不动**，
但会回一条 problems 说「那张是照上一句提示词生的，要按新的重画得点 AI 生成」。

`fullPrompt` 写回 `imageSpecs[index-1].fullPrompt`，从此这一格**原样发它**（画风模板、`mode`、
配色、留白、`subject` 一概不再拼进去），备图和 `POST /decks/:id/images`（换一批图）两条路都按它发。
三件事不能省：**前端只在他真改过的时候带这个字段** —— 一律带（把取回来那条原样回传）的话，
他只是打开看了一眼，这一格就从此不跟画风/模式走，之后换画风图纹丝不动而界面上一处都不说；
`""` = 删掉那一格的自定义（恢复自动拼的那条）；`problems` 里那两句（改成自定义 / 恢复了）
和界面上那一格的「整条已自定义」标记都必须显示出来。超 4000 字**只拒不截**。

```json
{
  "page": 3,
  "images": [
    {
      "index": 2, "url": "https://cos/…png", "prompt": "画什么（规划里那句 subject）",
      "mode": "concept", "ratio": "16:9", "styleId": "S-A", "model": "wanx-v1",
      "storage": "cos | local", "from": "ai | library", "at": "2026-09-03T…"
    }
  ],
  "problems": ["没地方贴、图落在本机磁盘、哪几格还是占位图之类的话"],
  "imageSpecs": [{ "subject": "画什么", "mode": "case", "ratio": "1:1" }],
  "pasted": {
    "html": "<section …>（备好的图已经贴进去的那一版）",
    "previewHtml": "单页 deck（不带页脚）",
    "images": [{ "index": 1, "url": "…", "ratio": "16:9 landscape" }],
    "styleId": "S-A"
  }
}
```

`pasted` **只在这一页已经生成过 HTML 时出现**：备好的图当场贴进库里那份 html（纯代码替换，
不调 AI、不花钱），前端必须用它覆盖那一页的 html/预览并作废拼好的整份 —— 不覆盖的话屏幕上
还是旧图而库里已经换了，他会照着屏幕再点一次「重新生成这一页」（那才是一次真实调用）。
里面的 `images` 是**合并后**的整页配图记录（贴上去的那几格覆盖同序号那条，之前 `POST /images`
真花钱配的别的格子留着 —— 整份覆盖的话那几张在界面上凭空变成「没配图」，他会再点一次
「换一批图」= 重花一遍）。存不上时 `pasted` 缺席，并且 `problems` 里会有一条说画面里还是旧图。

`imageSpecs` 是这一页**现在库里那份**规格（带上刚存进去的提示词），前端拿它覆盖内存里那份规划 ——
不覆盖的话对话框关掉再开是模型原来那句，而库里已经是新的，两处不一样而界面上一处都不说。

`images` 是**这一页备好的全部图**（不是刚改的那一格），前端整份覆盖 —— 只改动过的那一格
的话两边数组会漂开，而界面上每一格都显示着一张图（只是和库里存的不是同一张）。

`problems` 里的话一条都不能吞：第 n 格备的图没地方贴（模型少排了一个图位）、
图落在本机磁盘（换机器 404）、清掉之后画面里那张还留着 —— 都不报错，出来只是「这批图不太对」。
**比例和画风与这一格不一套都不在这里报**（他是看着那张卡上的「16:9 landscape · 画风 S-B」
自己挑的，报成「要注意」会把上面那几条冲下去），改成界面上那一格的标签一直显示着
（比例不一致时跟一句「会裁掉一块」）。

400：这一页的规划里没有 `imageSpecs`（老规划或模型只给了张数，要重新规划一次）、
`index` 超出规划的格数（备了也没有位置贴 = 白花钱）、`from` 不认识、挑的素材已被删。
429 额度用完，503 专属渠道缺 kind=image 那一档。

备好的图存在那一页上，`GET /api/ppt/decks/:id/pages` 里按 `pendingImages` 单独回，
和配图结果 `images` 分开 —— 合成一个的话「图配好了」和「图只是备着」在界面上分不开，
而用户会直接去拼整份（拼出来那几格还是占位图）。**贴进画面是在 `POST /decks/:id/pages`
那一步**（见下），所以已经生成过 HTML 的那一页备完图必须提示他重新生成那一页，
不然界面上多了一张缩略图而画面里什么都没变。
`POST /decks/:id/plan` 重新规划会连它们一起删，删了几张在返回的 `clearedImages` 里
（手写的那几段要求同理，在 `clearedNotes` 里）—— 两个都必须显示出来。

### POST /api/ppt/decks/:id/image-prompt `PROTECTED`
预览第 `index` 格**真正会发出去的那整条**生图提示词。**不生图、不写库、不花额度。**

```json
{ "page": 3, "index": 2, "subject": "可选：他此刻在框里改的那句（不带就用库里那句）" }
```

```json
{
  "page": 3, "index": 2,
  "prompt": "（拼完的整条：画风模板 + 主题 + 这句 subject + 留白方向 + 配色 + 尺寸那一句）",
  "styleId": "S-A", "styleName": "写实摄影",
  "mode": "backdrop", "ratio": "16:9", "size": "1536x1024",
  "custom": false,
  "problems": ["提示词里还剩没换掉的占位符之类"]
}
```

`custom=true` 表示这一条是他自己改写过的（`imageSpecs[index-1].fullPrompt` 有值），原样回给他、
**不再套模板**。这个字段要显示出来（配一个「恢复成自动拼的那条」的入口）：两种情况下框里都是
一大段通顺的中文，不说的话他不知道这一格已经不跟画风/模式/配色走了。

`mode` / `ratio` / （单图那一路要印的字）**按这一页已生成的 html 现算**，不是规划里那两个字段：
「改成背景图 / 改成单图」只改 html 上的 `data-img-mode`，跟着规划走的话他切完模式再看这条预览、
再点「AI 生成」，拿到的还是概念插画那套模板（而界面上这一页明明写着「整页背景图」）。
`mode` 必须显示出来 —— 两套模板都是通顺的中文，不写出来的话「切了没生效」只能靠逐句读。

这条提示词由服务端**用生图那条路的同一个函数**（`imageService.buildImagePrompt`）拼出来，
前端把它贴进那个**唯一的可编辑框**里（改完由 `prepare-images` 的 `fullPrompt` 存回去）。
前端自己拼一份近似的话，他照着那份把留白/配色/画风调到满意，
而真发出去的是另一条 —— 图回来还是不对，两边一处都不报错，他只会一张张重生（每张真花钱）。
`subject` 走**请求体里这一句**（不是库里那句）并且**一个字都不写库**：写库在
`prepare-images` 那一步（带 `planRev`），这里写的话「只是看看」会静默改掉规划里那一格。

`problems` 是模板里没换掉的占位符（画风库改坏了会原样把 `{{…}}` 发给模型），必须原样显示。
`size` 是真发给上游的那个值 —— 他唯一能发现「这一格按方图生」的地方。

400：这一页不在规划里、`index` 超出 `imageSpecs` 的格数、`subject` 是空的或超 300 字
（和 `prepare-images` 同一套判据，所以「预览能出、生成 400」不会发生）。

### POST /api/ppt/decks/:id/craft-image-prompt `PROTECTED`
让 AI 润色第 `index` 格的「画什么」那**一句**，整条由服务端重新拼一遍回来。
**1 次真实 AI 调用（扣一次额度）、不生图、不写库。**

```json
{ "page": 3, "index": 2, "subject": "可选：他此刻在框里那句（不带就用库里那句）" }
```

```json
{
  "page": 3, "index": 2,
  "subject": "（润色后的那一句 —— 前端必须收着，点确定时一起提交）",
  "before": "（润色前那一句，给他对照）",
  "prompt": "（用新那句重新拼出来的整条，和 /image-prompt 同一个函数）",
  "styleId": "S-A", "styleName": "写实摄影",
  "mode": "backdrop", "ratio": "16:9", "size": "1536x1024",
  "problems": ["模型回了 3 段，这里只采用了最长的那一段", "润色回来那句里自己写了构图位置…"],
  "usage": { "input_tokens": 500, "output_tokens": 60, "total_tokens": 560 }
}
```

**模型只改那一句，整条是代码拼的**：留白方向（`imageSpace` 按版式几何算）、尺寸、单图那一路要
印在图上的原文、写死的禁忌尾巴都不进这次请求 —— 把整条交给模型润一遍的话它会顺手把「左边
0–50% 留给文字」改成自己想的那个方位、把要印的字改写得更顺口，出来的提示词比原来专业，
而图回来主体压在标题底下 / 印的是模型编的文案（硬规则 3），一处都不报错。
润色用的创作规范是 `server/src/services/ppt/library/image-prompt-craft.md`（改那份 md 即可，
不用改代码；读不到会 400 而不是静默发一条没有规范的请求）。

**返回的 `subject` 必须被前端收下并在 `prepare-images` 时一起提交**：不收的话库里那句还是旧的，
下次打开那个框又是没润色过的那条（而界面上一处都不说，他只会再润一次、再扣一次）。
前端还要把框里那条的「原文基线」一起换掉 —— 不换的话他什么都没再改，点确定却把这一条存成
「他改写的整条」（`fullPrompt`），这一格从此不跟画风/模式/配色走了。
这一格**原来**有 `fullPrompt` 时，确定那一下要显式传 `fullPrompt: ""` 把它清掉：不清的话生图
发的是那条旧的自定义，而框里显示的是润色后的新那条。

`problems` 里那几条是**降级要出声**（硬规则 1）：模型回了好几段（只采用最长那一段）、
回来那句里自己写了留白/尺寸/「画面上的字」（会和代码拼的那几段打架）、句子被截断。

400：这一页不在规划里、`index` 超出格数、这一格还没写「画什么」、模型一个字都没返回
（报错里带思维链 token 数 —— 不带的话他只会一路调高 `max_tokens`）、润色回来那句超 300 字
（只拒不截：截一半照样能生图，而他以为润色成功了）。429/503 同其它 AI 端点。

### POST /api/ppt/decks/:id/rewrite-image-prompt `PROTECTED`
让 AI 重写第 `index` 格**会原样发出去的那一整条**（不是那一句）。
**1 次真实 AI 调用（扣一次额度）、不生图、不写库。**

```json
{ "page": 3, "index": 2, "subject": "可选：他此刻在框里那句「画什么」", "draft": "可选：他此刻框里那一整条" }
```

```json
{
  "page": 3, "index": 2,
  "prompt": "（重写后的那一整条 —— 前端点确定时要作为 fullPrompt 存下来）",
  "before": "（这次拿去重写的基线，就是 draft 或代码现拼的那条）",
  "styleId": "S-A", "styleName": "写实摄影",
  "mode": "poster", "ratio": "16:9", "size": "1536x1024",
  "problems": ["重写回来那条里少了（或被改写了）「不许出现任何文字」那条尾巴 —— 已经把代码算的那几句原样接在末尾了…"],
  "usage": { "input_tokens": 900, "output_tokens": 300, "total_tokens": 1200 }
}
```

**和 `/craft-image-prompt` 是两件事，前端那两个按钮的话术必须分开写**：润色改的是「画什么」那一句、
整条照旧由代码拼（换画风还跟着走）；这里回来那条要被存成这一格的 `fullPrompt` —— 从此换画风、
切背景图/单图、改配色、改那句「画什么」都不再影响它。写成「重写完还跟着画风走」的话，他换完画风
回来发现这一格纹丝不动，而一处都不报错。

**`draft` 要带上他此刻框里那一整条**：不带的话服务端拿库里/现拼的那条重写，他刚在框里逐句调好的
那几句全丢了，而回来那条读起来更专业 —— 丢在哪一步看不出来。

**代码算的那几段（禁忌尾巴、比例那句、单图要印进画面的那几行原文、留白方向）会被核对，
少了或被改写就原样接回末尾并在 `problems` 里点名**（`requiredPromptParts` / `pinRequired`）：
不核的话那一整条读起来比原来专业，而图回来主体压在标题底下 / 比例不对被裁掉一半 / 印在图上的是
模型编的文案（硬规则 3），接口 200、缩略图也好看。重写的规范是
`server/src/services/ppt/library/image-prompt-craft.md` 的「## 重写整条」那一节（同一份 md 按那一行
切成两半，**两半不许合着发** —— 上半写着「只回一句话」、下半写着「回整条」）。

**那一节末尾的三小节（`### slot / backdrop / poster 重写要求`）由代码按这一格现在是哪一路挑一节发**，
路数是从这一页 html 现算的（不是规划里那个可能还写着 concept 的字段）。三节的要求互斥：
普通图「一个字都不许有」对上单图「那几行字要印在画面里」、普通图「主体离四边留一点」对上背景图
「四边直接出血」。一起发或挑错一节的话模型自己挑一边，回来那条读起来更专业 —— 而背景图缩在中间
围一圈白边 / 单图里一个字都没印 / 普通图里多出一堆乱码假字，一处都不报错（有测试）。
缺哪一节就 400，**不拿公共那几节凑**。

`problems` 里其余几条同样是降级要出声（硬规则 1）：像是回了好几个方案、被截断、
回来那条比原来短一半（画风/机位那几段被压掉了，那几段接不回来）、里面还剩占位符。

400：这一页不在规划里、`index` 超出格数、框里那条或重写回来那条超 4000 字（只拒不截）、
模型一个字都没返回（报错里带思维链 token 数）、那份 md 里找不到「## 重写整条」那一节。
429/503 同其它 AI 端点。

### POST /api/ppt/decks/:id/pages `PROTECTED`
生成（或重新生成）第 `page` 页的 HTML。一页一次 AI 调用。

```json
{
  "page": 3,
  "layoutId": "L12（可选，换版式）",
  "notes": "可选，字体/排版/语气那段要求（≤500 字）",
  "title": "可选，改这一页的标题（≤60 字）",
  "points": ["可选，改这一页的要点（≤12 条，每条 ≤200 字）"],
  "outlineText": "可选，改这一页的提纲原文（≤4000 字，多行）"
}
```

`title` / `points` 是「生成前改提纲」：**带了就先写回 `plan_json` 里那一条，再按新的那份生成**
（两件事必须同一次做完 —— 只生成不写回的话下次打开又是模型那句原话，只写回不用新的话出来
是一页照旧提纲排的完整幻灯片，而列表和标题栏写的是新提纲，两种都不报错）。
**没传 `title` 就是没改**（用库里那份，所以「逐页生成」只传 `page` 不受影响）；传了 `title`
就整条提纲都按这次传的算 —— 两个字段各自可选的话，「只改了标题」那一次会把要点存成空数组。
写回**不走重新规划那条路**（那个会把这份稿子已生成的页全删掉 = 改一句标题扔掉十几次调用）。
空标题、一条要点都不剩、超 12 条、单条超 200 字**一律 400**：只给标题的话模型会自己编这一页
的内容，出来那一页排版完整、读着通顺、而内容不是他的；截掉的那几条同样一个字都不出现在页面上。

`outlineText` 是这一页的**提纲原文**（规划那一步按行号切出来的那几行，`plan_json.outlineText`）——
上面 `points` 是摘要，**逐字进 prompt 的是这一段**，所以它才是「提纲上的数字/机构名丢了」的
真正入口。和 `title`/`points` 不同，它**自己按「传了才动」算**（老前端不带这个字段时一律不动库里
那份），传空串 = 他有意清空（那一页往后只按要点生成）。超 4000 字**一律 400 不截断**：截掉的
后半段照样生成出一页完整的幻灯片，而他粘进去的那些数字一个都没进 prompt。只 trim 首尾，
**中间的换行原样留着**（那就是提纲的分条，规范化掉之后模型会把几条并成一句）。
写回时**不重算 `outlineRange`**（行号只在规划那一步的覆盖检查里用，和改过的原文对不上不影响生成）。

整份那段要求（`PATCH /api/ppt/decks/:id` 的 `notes`，093）**每页都带，和页级那段一起发，
不是二选一** —— 页级有就顶掉整份那段的话，他在某一页补一句「这里的表格用等宽字体」，
整份定的「语气克制」就在这一页悄悄失效了（只有那一页语气不一样，没有一处会说）。
两段上限同一个数（500 字），超了都是 400 而不是截断。

`layoutId` / `notes` **带了就先存在那一页上**（092），所以下一次「重新生成」和「逐页生成」
只传 `page` 也照着改过的来 —— 不存的话它们会静默退回规划里那条版式、丢掉那段要求，
而生成出来照样是一页完整的幻灯片。没传的字段不动库里存着的那份（`notes: ""` 才是清空）。

可选的那几条备选版式来自规划行里的 `alts`（`POST /decks/:id/plan` 的返回、`GET /decks/:id`
的 `plan_json`，2-3 条，服务端已经把编出来的编号丢掉了）；前端把它们和规划挑的那条排在下拉
最前面，其余的排后面 —— 22 条平铺的话「换一个也合适的版式」等于自己认，挑一条装不下这一页
内容的出来照样是一页完整的幻灯片。老规划里没有这个字段（界面上要说明「重新规划一次才有」）。

认不出的 `layoutId` **一律 400**，不回落成规划那条（他选了 L12 拿到 L07 排的一页，读起来
完全正常）；`notes` 超 500 字**一律 400**，不截断（截掉的半句照样发出去，而他写在后面那条
要求不会生效）。要求那一段接在 prompt 最后、明写「优先于上面的建议」——夹在近 8000 字的
版式骨架前面的话模型照旧按建议排，一处都不说。

```json
{
  "page": 3, "layoutId": "L12",
  "html": "<section class=\"slide\">…</section>",
  "previewHtml": "整页可直接 iframe 的单页 deck",
  "problems": ["生成本身的问题 + 备好的图贴不上的那几条"],
  "images": [{ "index": 1, "url": "https://cos/…png", "prompt": "…", "ratio": "16:9 landscape" }],
  "style": { "id": "S-A", "name": "" },
  "setup": { "layoutId": "这次真的用了哪条版式", "notes": "这一页那段要求", "deckNotes": "整份那段要求" },
  "outline": { "title": "库里现在那份标题", "points": ["库里现在那几条要点"], "outlineText": "库里现在那段提纲原文" },
  "plan": { "images": 4, "imageSpecs": [{ "subject": "…", "mode": "data", "ratio": "3:4" }] }
}
```

`plan` 是**按这一页真的排出来的图位对齐之后**那份清单（`specsFromSlots`，纯代码不调 AI，
存盘前做所以那几句提示进得了 `problems`）。前端必须拿它覆盖内存里那份规划：备图 / 换图 /
素材库全都按这份清单画，而服务端 `prepare-images` 也按 `imageSpecs.length` 卡格子号 ——
不覆盖的话规划里 0 格时备图那一整块干脆不出现（界面上写「这一页还没配过图」），
而画面上就是几张占位图、顶上还写着「配全部图（差 4 张）」，他只剩那条真花钱的路。
对齐**只在格数变了时发生**（换过版式、或者按真实内容多排了一块）：格数相同时哪怕文字不同
也不动，那是他改了提示词还没重新生成，覆盖等于把他的修改吞掉。已有那几格原样留着（保住
他改过的 `subject`），新加的格子从页面上的 `data-img-prompt` / `data-img-mode` / 占位图比例读，
改动和「空的 data-img-prompt 是哪几格」都在 `problems` 里点名。

`outline` 是**库里现在那份**（他改过就是新的）。前端要拿它更新左边列表和标题栏：不同步的话
那两处还写着模型原来那句标题，而画面是按新提纲生成的 —— 两处各自都读得通。
`outline.outlineText` 同理要覆盖手上那份：不覆盖的话下次打开「生成前确认」显示的是老原文，
看起来像上一次的修改没存上，他会再改一遍（而库里和画面上都已经是新的那一段）。

`setup.layoutId` 是**这次真的用了的**那条（`layoutId` 同一个值），前端要拿它更新界面上的
版式标签：写规划那条的话标签是 L07 而画面是 L12 排的，两版都是一页正常的幻灯片。
`GET /decks/:id/pages` 里 `setupLayoutId`（他挑的）和 `layoutId`（这份 html 实际用的）
**分开回**，两个不一样 = 换了版式还没重新生成，前端必须显眼说出来。

`html` / `previewHtml` 是**贴完备好的图之后**的那一版（回填在代码里做，地址从不经过模型 ——
让模型照抄 url 它会漏字符或复用上一页那张，而页面上是一张正常的图）。贴上去的那几张在
`images` 里回，前端要据此把这一页标成「已配图」并**在没有 `images` 时清掉旧的配图状态**：
不清的话重新生成过的那一页写着「图都配好了」，而画面里已经换回占位图。

`problems` 里那几条一条都不能吞：第 n 格备的图没地方贴（模型少排了一个图位）、
哪几个图位还是占位图 —— 两种都不报错，预览里只是「这一页设计得比较空」。
**比例不一致不在这里报**（改成挑图那一格的标签一直显示，见上面 `prepare-images`）。备好的图**贴完还留着**，所以再点一次「重新生成这一页」
会免费重贴一遍（不用再花钱生图）。

### POST /api/ppt/decks/:id/edit-text `PROTECTED`
就地改一段文字：他在预览里双击一段字改完失焦，这里改**库里那份 html**。不调 AI、不花额度。

```json
{ "page": 3, "eid": "t7", "oldText": "改之前那一块显示的那句", "newText": "他打的那句", "planRev": 4 }
```

```json
{ "page": 3, "eid": "t7", "text": "存下来的那句（折过换行、trim 过）", "html": "…", "previewHtml": "…", "chartNotes": [] }
```

**`chartNotes` 必须显示出来**（`edit-text` / `delete-node` / `ai-edit` 三条都回这个字段，
`ai-remake` 并进它那份 `notes`）：改完/删完之后这一页图表的量由代码重算了一遍
（`chartData.rechartEdited`，和生成那一步、migration 102 同一份计算）。生成时算对过一次不等于
以后一直对 —— 那个印出来的数被改了而条长写在 style 里不会跟着变（一条短条配一个大数字），
或者删掉最长那一行之后轨道上限还是按被删掉那个数算的（剩下几行永远到不了满格）。两种都是
接口 200、图表渲染完整、颜色单位结论条全在，只有照条长读出来的结论是错的。反过来重算之后
别的条会当场变长，不把这几条说出来的话他会以为是自己那一下把数据改坏了。没有图表的页
一律回 `[]`。

`eid` 是**生成那一页时由服务端写进 html 的 `data-eid`**（`pageEdit.injectEids`，每一段
「只装着一段文字」的元素一个）。**前端只回「哪一块 + 改前那句 + 改后那句」，不回整份 html**：
回整份的话一次 DOMParser 往返就可能把引号/自闭合标签/实体全换一遍（页面照样渲染），
而它内存里那份还可能是重新生成前的旧版 —— 于是「改一个标题」把整页退回上一版。
编号**不在编辑时按「第 N 个元素」重算**：重算的话改一次文字就可能让编号漂一位，
下一次编辑落到隔壁那一块上，而两块都是正常的文字。

四种情况一律 400、一个字都不写库：`eid` 找不到（这一页重新生成过，eid 换了一批）、
`oldText` 和库里现在那句对不上（拿着旧画面在改，覆盖上去等于把另一处的改动悄悄擦掉，
报错里带上「现在库里是哪句」）、改成空（那一块会缩成一条看不见的线，读起来像版式本来就这样）、
超 1000 字（顶出版式的 `overflow:hidden`，多出来的一个字都不显示也不报错）。
`<` `&` `>` 一律转义进 html —— 不转的话从那个字符到块尾会被浏览器当成标签吃掉，
页面照样渲染、接口 200，只是那一块少了半句话。换行折成空格（转 `<br>` 的话这一块多出个
子标签，下一次它就**不再能双击编辑**了，而没有一处会说为什么）。

只写 `html` 这一列（`deckStore.savePageEditedHtml`）：走生成那条存法会把
`images_json` / `problems_json` 一起清掉 —— 改一个标题就把「3 张图都配好了」和
「这一页版式有 2 处要注意」悄悄擦掉，界面上只是「已保存」。混排的那种块（`<div>CONTENTS<span>目录</span></div>`
的外层）**没有 `eid`，不给改** —— 按文本节点改它会把里面那个 span 连着样式一起吃掉。

### POST /api/ppt/decks/:id/edit-style `PROTECTED`
改一块字的**颜色 / 字号 / 字重 / 对齐**（写成那个开标签上的 inline style）。不调 AI、不花额度，
定位和存法都和 `edit-text` 同一套（`data-eid` + 只写 `html` 这一列）。

```json
{ "page": 3, "eid": "t7", "style": { "color": "var(--c-brand)", "fontSize": 40, "fontWeight": 700, "textAlign": "center" }, "planRev": 4 }
```

```json
{ "page": 3, "eid": "t7", "style": { "color": "var(--c-brand)", "fontSize": 40 }, "html": "…", "previewHtml": "…" }
```

对齐收**两个键**：`textAlign`（`left`/`center`/`right`，普通文字块）和 `justifyContent`
（`flex-start`/`center`/`flex-end`，这一块本身是 flex/grid 时），前端按 `getComputedStyle().display`
挑 —— 只收 `textAlign` 的话，flex 那种块上浏览器**根本不认**这条声明：接口 200、库里写着
`text-align:center`，而画面一动不动。另外那一块的宽度就是文字宽度时（flex 里的项目常这样）
左中右三个键都不会有变化，前端量出来会跟着回一句「画面上看不出变化，要选到外层那一整块去改」
（那条走下面的 `edit-region-style`）。

四类键都可选，但**一个都不给是 400**。颜色只收 `GET /api/ppt/edit-palette` 那几个值
（`pageEdit.COLOR_PALETTE`，有测试核每个 `var(--…)` 在 `template.html` 的 `:root` 里真有定义）：
编出来的变量名会让浏览器把**整条 `color:` 声明**丢掉 —— 字色掉回继承色、接口 200，看起来
只是「这一块颜色没变」；硬编码色值同样拒（换肤那天它不跟着变，而那一块读起来完全正常）。
字号只收 **8–400 的整数 px**（前端拿 `getComputedStyle` 的 px 加减 —— 发 em/百分比的话它是
相对父级的，父级本来就大一号时「点大一点」会渲染得更小），字重只收 300–900 那几档。
**认不出的属性也一律 400**：静默忽略的话他点了按钮画面一点不变，看起来像按钮坏了，而接口回 200。

原来就有的 `style="…"` 属性是**改写**、不追加第二个 —— 追加的话浏览器只认第一个，
库里明明是新值而画面一点变化都没有；同一个属性里别的声明（`letter-spacing` 那些）留着。
只动 inline style，**不改那一页的 `<style>`**：改整份 CSS 的话一次「这行字大一点」会波及
每一页上同一个类。

### POST /api/ppt/decks/:id/edit-region-style `PROTECTED`
改**一整块（容器）自己**的对齐 —— 他点两段字之间的空处选中那个 `display:flex` 的块，点浮动条上
那三个键。不调 AI、不花额度，只写 `html` 这一列。

```json
{ "page": 3, "path": [1, 0], "eids": ["t7", "t8"], "style": { "alignItems": "center" }, "planRev": 4 }
```

```json
{ "page": 3, "style": { "alignItems": "center" }, "region": "div",
  "prev": { "align-items": "flex-start" }, "html": "…", "previewHtml": "…" }
```

**`"alignItems": null` = 取消（把这一条 inline 声明删掉，回到这一页 `<style>` 里那个值）。**
写 `unset` / `initial` / `revert` / `normal` 一律 400 并指到 `null`：inline 的 `unset` 是**盖住**
版式那条、把它按成「拉满」，而版式里写的可能是 `center` —— 他点的是「取消」，得到的是第三种样子，
而页面照样渲染。**本来就没有这一条时也 400**（`没有 align-items …`）：删一个不存在的东西 html
一个字都不会变，而接口回 200 加一句「已存」，他看到的是「点了取消没反应」；真正的成因是这一块的
对齐来自这一页自己的 `<style>`。`prev` 回的是改之前那一条 inline 是什么 —— 界面要说出「取消掉的是
center」，不说的话那一整块变了样而他不知道该点回哪个键。

和 `edit-style` 的唯一区别是**定位**：容器没有 `data-eid`（eid 只给「只装着一段文字」的元素），
所以用**从 `<section>` 数下来的孩子下标路径**（同 `ai-edit` 的 `path`），再拿这一块里那串
`eids` **交叉核对**一遍（排序后逐字比，附上两边各是哪几个）—— 不核的话浏览器和库里差一层时
对齐写到了隔壁那一块上：页面照样渲染、接口 200，只是他点的那一块没动、另一块动了。

`alignItems` 只收 `flex-start` / `center` / `flex-end` / `stretch` / `baseline`，
`justifyContent` 只收 `flex-start` / `center` / `flex-end` / `space-between` / `space-around`，
**别的值和别的属性一律 400**：`align-items:left` 这种写法浏览器直接把整条声明丢掉 —— 接口 200、
库里写着新值，而画面一动不动。这一块**本身不是 flex/grid** 时前端就不发（那三个键 CSS 藏着，
硬点也只换回一句「这一块是 block 布局，align-items 在它身上浏览器根本不认」）——
放它过去的话同样是「存上了但一点没变」。

### POST /api/ppt/decks/:id/delete-node `PROTECTED`
把选中的那一整块（一段字也算一块）从第 N 页里**整段剪掉**。不调 AI、不花额度，只写 `html` 这一列。
定位和交叉核对与 `edit-region-style` 完全同一套（`path` + `eids`，同一份 `pickRegion`）。

```json
{ "page": 3, "path": [1, 2], "eids": ["t7"], "planRev": 4 }
```

```json
{ "page": 3, "removed": { "name": "div", "cls": "desc", "eids": ["t7"], "text": "一句话说清这一章的落点" },
  "html": "…", "previewHtml": "…", "chartNotes": [] }
```

`chartNotes` 同 `edit-text`（删掉图表里一行之后轨道上限跟着降，剩下几条当场变长）。

**剩下的 `data-eid` 一个都不重编号**（这条路上绝不调 `injectEids`）：重编一遍的话前端手上那份
预览里的 t5 和库里的 t5 会指向两个不同的元素，下一次双击改字落到隔壁那一块上，而两块都是正常
的文字。五种一律 400，且**成因要原样显示给用户**（合成一句「删不了」的话下一步完全不同）：

- **块里有 `<img>` 或图槽位** —— 图的序号是按 html 出现顺序扫的（`findImageSlots`），
  `images_json` / 备好的图 / `pasteIntoBuiltPage` 全按它贴：少一格之后下一次「换一批图」会把
  第 2 张贴进第 1 格，图文不符而页面渲染完全正常、面板上照旧写着「3/3 张有图」。要去掉这种块
  只能走「重新生成这一页」。
- **空 `path`（整页）** 和 **删完这一页没有任何看得见的内容** —— 空 `<section>` 在 iframe 里是
  一块白，和「这个版式渲染塌了」分不开，而拼整份那边只会说「缺第 N 页」。
- **删完一个 `data-eid` 都不剩** —— 前端 `canEditText` 按「html 里有没有 data-eid」算，界面会
  谎报「这一页还没有编辑标记，重新生成一次才能改文字」，他会为此花掉一次真实调用。
- **块里是统一页眉（`.slide-header`，096）** —— 那行模块名是整份每一页都有、由代码贴的。
  只删这一页的话整份里只有这一页左上角是空的，而它看起来只是「这一页比别的干净」。
  模块名要改是「改这一页的所属模块 + 重新生成」，不是删一块。
- 块里有 `<script>` / `<style>` 也拒：那段 CSS 改的是整份 deck 的每一页，从这里剪掉的话别的页
  也跟着变样，而这里只显示「已删掉」。

**撤销还没做**，所以前端删之前有一个确认框，写明「删错了只能重新生成这一页」。

### POST /api/ppt/decks/:id/canvas `PROTECTED`
**只对空白页**（`layoutId: "BLANK"`，见「插一页空白页」）：往画布上加一个文字框、放一张
素材库里的图、拖动/缩放一块、删掉一块。不调 AI、不花额度，只写 `html` 这一列，和别的就地
编辑同一套前置（`planRev` 对账 + 这一页已生成）。

```json
{ "page": 3, "op": "add-text", "planRev": 4 }
{ "page": 3, "op": "add-image", "assetId": "a_xxx", "planRev": 4 }
{ "page": 3, "op": "box", "bel": "b1", "left": 240, "top": 300, "width": 720, "height": 160, "planRev": 4 }
{ "page": 3, "op": "delete", "bel": "b1", "planRev": 4 }
```

```json
{ "page": 3, "op": "add-text", "bel": "b1", "eid": "t1",
  "box": { "left": 160, "top": 200, "width": 560, "height": 120 }, "html": "…", "previewHtml": "…" }
```

- **「是不是空白页」按 html 里有没有 `.bl-canvas` 算，不按 `layout_id`**（判据只有一处）：
  要改的东西是 html，两处各判一次的话总有一处先放行 —— 往普通版式页上写 `position:absolute`
  的块，那个元素当场从 flex 项变成脱离文档流的绝对定位块，**同一行里别的内容跟着塌**，
  而接口 200、那一块本身摆在他指的位置上，翻起来只是「这一页设计得有点怪」。
- 画布元素形状固定、只由服务端生成：
  `<div class="bl-el bl-text" data-bel="b1" data-eid="t1" style="left/top/width/height">字</div>`。
  **两个编号都得有**：`data-bel` 是这条接口定位用的，`data-eid` 是 `edit-text` / `edit-style`
  那套（双击改字、改字色字号）用的 —— 空白页永远不经过 `injectEids`（它只在生成那一步跑），
  不当场写上的话浮动条那几个键对着画布上的文字全部「点了没反应」，而这一页显示得好好的。
- `add-image` **只收 `assetId`（素材库里、他自己的那几张），不收 `url`**：收 url 的话贴进去的
  外站图在导出的那份 html 里换台机器打开是一张裂图/一块白，而这边显示得好好的；`getAsset`
  带 userId，别人的素材 id 一律 404。图元素**不带 `data-img-prompt`** —— 带上的话
  `findImageSlots` 会把他自己摆的这张数成「这一页的第 N 格」，下一次配图/换一批图直接盖上去
  （画面上还是一页有图的幻灯片，只是图换了，而面板照旧写着「1/1 张有图」）。落点按**这张图
  自己的比例**摆（`.bl-img img` 是 `object-fit:cover`，比例不对会裁掉两边，图本身没变、
  只是构图缺一块），响应里回 `ratio`，前端要把它显示出来。
- `eid` 按**整页现有最大号 +1**（`maxEidNumber`），不按画布上的块数：删过一块之后按块数算会
  撞上还在的那一块，于是改这一块的字落到另一块上（两块都是正常的文字，一处都不说）。
- 坐标一律夹进 1920×1080、宽高下限 40px，四个数**一起写**（响应里回夹过之后的 `box`，前端
  要把这几个数显示出来 —— 那是他唯一能看出「刚才那一下被夹回来了」的地方）。
- `bel` 找不到、`op` 认不出、这一页不是空白画布：**一律 400**。静默当成「什么都没做」的话，
  iframe 里那一块已经跟着鼠标挪好了、接口 200，而库里是旧坐标 —— 刷新之后它自己跳回去，
  看起来像「拖动有时候不保存」。
- 删画布上的块**必须走这条**、不能走 `delete-node`：那条一是「块里有图就拒」（画布上摆的图
  从此删不掉），二是「删完一个 `data-eid` 都不剩就拒」，而它的理由是「重新生成一次这一页」——
  对着空白页完全指错方向（空白页压根没有生成这一步）。画布**允许删成空的**。

### GET /api/ppt/edit-palette `PROTECTED`
`{ "colors": ["var(--c-ink-deep)", …] }` —— 浮动条上那几个色块。前端**不自己写一份**：
两份一漂开，他点的那个颜色会被 `edit-style` 400 拒掉，而界面上那个色块看着完全正常。

### POST /api/ppt/decks/:id/ai-edit `PROTECTED`
让 AI 改**选中那一块**的结构和 inline style（「这三条排成两列」）。**一次真实调用、花 1 次额度**，
改完直接覆盖库里那一页（和 `edit-text` 同一条存法，只写 `html` 这一列）。

```json
{ "page": 3, "path": [0, 1], "eids": ["t7", "t8"], "instruction": "这三条排成两列", "planRev": 4 }
```

```json
{ "page": 3, "summary": "把三条并排成两列（原文 6 处一字未动，3 段文字仍可双击编辑）",
  "region": "div", "html": "…", "previewHtml": "…", "usage": { "total_tokens": 1820 },
  "chartNotes": [] }
```

`chartNotes` 同 `edit-text`：模型改的 inline style 里就有 `--bar-v` / `--bar-max`，它把一根条的量
写成自己算的数之后，图表读起来完全正常而条长不是旁边那个数。

那一块用**从 `<section>` 数下来的孩子下标路径**定位（前端 `pathOf`），不是「几个 eid 的公共祖先」：
图和装饰条没有 eid，求公共祖先算出来的是他框住那一块**里面**的一层 —— 于是 AI 改的不是他框的
那一块，而摘要和画面都读得通。`eids` 是**交叉核对**用的：路径按浏览器那棵树数出来，服务端按
字符串扫出来，浏览器修正过结构（`<p>` 里的 `<div>` 会被挪出去）时两边差一层，那时一律 400
「你选中的那一块和库里那一页对不上」，**不花额度**。

**发出去那一段里一个中文都没有**：文字节点、整个 `<img>` 标签、带中文的属性值全换成 `@@T1@@`
`@@IMG1@@` `@@A1@@` 这种记号（`pageEdit.maskRegion`）。所以「不许改文案」不是 prompt 里那句话，
而是「输出里出现中文 = 它在自己编文案」这一条正则 —— 靠 prompt 拦的话模型会顺手把「及」改成
「和」、润色半句，出来是一页读起来完全正常的幻灯片而他写的那句变了。图的地址和
`data-img-prompt` 因此也不经过模型（硬规则 3）。打完码还剩中文（有一处文案在取不出来的属性里）
一律 400，不发出去。

回来那一段有**七条校验，任何一条不过就整段丢掉、一个字都不写库**（这次的钱已经花了，但存一段
错的要赔的是「他照着这一页做完整份」的时间）——每一条拦的都是「页面照样渲染、读起来完全正常」
的失败：不是一整块 / 换了最外层标签（定位类挂在原来那一层，这一块会跑到别的位置）、记号少了
或重复了（那句文案凭空消失 / 出现两遍）、`data-eid` 变了（那几段从此双击改不动，画面上一点异样
都没有）、出现中文、写了 `<script>`/`<style>`/`onclick`、用了这一页里没有的类名（那一块回到默认
流式布局，看起来像版式塌了）、写死品牌色（`#hex`/`rgb()` —— 但**阴影和蒙版那种半透明黑白放行**，
`rgba(0,0,0,.08)` 拦掉的话「加一点投影」这种要求照着做不可能，他只能一路重试）或用了 `:root` 里
没有的 `var(--x)`（浏览器把
整条声明丢掉，看起来只是「这一版配色淡了点」）。模型没按 JSON 回 / 被截断时报错走
`jsonFailMessage`（带思维链 token 数，硬规则 2）。

`summary` 里那两个数是**代码数出来的**，不是模型说的：模型说「保持了原有文案」这句话是免费的，
而那恰好是他要确认的事。`instruction` 上限 400 字（更长的其实是「重写这一页」，那个走重新生成
—— 那一步才带着版式和要点）。

### POST /api/ppt/decks/:id/ai-remake `PROTECTED`
**自由改造**选中那一块：不套案例库那条版式，可以重排结构、加图槽、新写文案（「改成两列卡片，
每张配一张小图」）。**一次真实调用、花 1 次额度**，入参和上面那条一模一样（`page` / `path` /
`eids` / `instruction`，`instruction` 上限 1000 字），也是改完直接覆盖库里那一页。

```json
{ "page": 3, "summary": "拆成两列卡片，每张配一张小图（原文 6 处里留下 5 处）",
  "region": "div",
  "notes": [
    "丢掉了 1 段原文：「三年内完成全量迁移」 —— 不是你要的就再改一次（…）。",
    "AI 新写了 2 句文案：「效率提升」、「成本下降」 —— 双击就能改成你的说法。"
  ],
  "html": "…", "previewHtml": "…", "images": [{ "index": 2, "url": "…" }],
  "usage": { "total_tokens": 4210 } }
```

**和 `ai-edit` 是两个端点、不是一个 `mode` 开关**：这条放开了「删原文 / 新写中文 / 加图」，
串到另一条的现象是「AI 怎么没照我说的改」或者「它把我的文案换了」，而两边都已经花掉一次额度。
原文**照旧打码**（`@@T1@@`）：允许它**丢掉**某一句，但改写这件事它做不到 —— 手里只有记号
（硬规则 3，不是靠 prompt 求）。

放开的每一条都换成**出声**（`notes`，前端逐条显示），但**只报他看着屏幕发现不了的那几种**：
丢了哪几句原文（逐句列，最多 3 句）、AI 新写了哪几句文案（逐句列，最多 4 句）、有几段字的编辑
标记没了、模型原样退回、**这一页图表的量被代码重算了**（`chartData.rechartEdited`，别的三条编辑路
回的那个 `chartNotes` 在这里并进 `notes`：这条路会新写文案，也就会改那个印出来的数，而条长写在
style 里不会跟着变 —— 一条短条配一个大数字，图表读起来完全正常）。「删了几张图 / 新增了几个图槽 / 新文字拿到了哪几个编号」**一律不报** ——
那几件事他一眼就看见（占位图上印着「图槽位 16:9」），报出来只会让 `notes` 整体变成一堵他一律
略过的墙，于是上面那两条真会骗人的跟着被略过。

**加/删图槽之后这一页的配图记录（`images_json`）按新 html 的图槽顺序重排一次**，重排过才回
`images`（前端拿它换掉面板上那份「配图 x/y 张」；没变就不回这个字段）。对齐靠**地址**找它现在
在第几格、找不到的整条丢掉 —— 图的序号是按 html 里的出现顺序数的，不重排的话：删掉一张配好的
真图之后面板上照旧写着「配图 1/1 张」并挂着缩略图（他会当这一页配完直接去导出），在前面插一格
之后下一次贴备好的图会落到隔壁那一格上（图文不符，而页面渲染完全正常、接口 200）。

**规划里那份图位清单跟着对齐**（`specsFromSlots`，和「生成这一页」同一个函数：已有那几格连他
改过的提示词一起原样留着，只按格数增删），改过才回 `plan: { images, imageSpecs }`。不对齐的话
新加的那几格在界面上**根本不存在** —— 备图 / 素材库挑 / 换图 全按这份清单画（服务端也按
`specs.length` 卡格子号），于是画面上 2 个图槽而面板上只有 1 格，他只剩「配全部图」那条真花钱
的路、且换一张要重花一次。存不上、或者图槽超过一页 6 格的上限（清单按上限截）要进 `notes`：
那几格备不了图，而它们在画面上和别的格子长得一模一样。格数**变少**时落在新清单外面那几张
**备好的**图（花过钱的）当场点名（`orphanedPreparedNotes`）—— 不说的话它们从备图面板上消失而
库里还留着，下一次生成这一页才冒出一句「第 N 格备好的图没地方贴」，那时对不回是这次改造弄的。

**他点中的是一张图（或别的自闭合标签）时自动往外挪一层改**，并在 `summary` 末尾说出来（不进
`notes`：点图必然走这一支，当成提示会把要紧的那两条挤下去）。不挪的话
「把这张大图拆成三张」无论怎么改 prompt 都不可能成功（`<img>` 里装不了三个 `<img>`，每次都撞到
下面「还得是一整块、最外层标签不变」那两条），而他看到的是一句「模型回的不是一整块」—— 读起来像
模型不行，于是一直重试，每次花一次额度。模型**原样退回**时也要报「一个像素都没变」：那一条最像
成功（校验全过、摘要照样写着「重排了这一块」）。

收紧的那几条**一条不过就整段丢掉、不写库**：不是一整块 / 换了最外层标签或动了最外层的类名
（含「原封不动多包一层」—— 只比标签名拦不住，而位置和尺寸是父级按那几个类名给的）、记号重复或编了新的
（屏幕上留着 `@@T9@@`）、自己写 `data-eid`（撞上这一页别处那一段，改一句字落到另一块上）、
`<script>`/`<style>`/`onclick`、`position:fixed`（脱出 1920×1080 那层缩放，导出后飞到画面外）、
编类名（模板里没那条样式 —— 新样式一律 inline style）、写死品牌色（半透明黑白除外）或不存在的
`var(--x)`、自己写图片地址（破图和「这一格本来是空的」长得一样）、**有占位图没落进任何图槽**
（元素上少了 `data-img-prompt`：备图面板没有这一格、配全部图不算它、生图跳过它，那一处永远停在
占位图上而画面上它就是一张图 —— 按 `findImageSlots` 扫一遍比位置算，所以背景图那种
`background-image:url(占位图)` 也拦得住，而写在外层容器上的正确写法不会被误拒；比的是**比原来
多出来的处数**，页面本来就带着的那几处不拦 —— 拦了那一页每次改造都撞同一句「模型加了 1 处图」，
改成在 prompt 里让这次顺手补上 `data-img-prompt`）。新文字的
`data-eid` 由**代码**接着这一页最大那个往后排。

### POST /api/ppt/decks/:id/images `PROTECTED`
给这份稿子第 `page` 页配图：按每个图元素的 `data-img-prompt` **逐张生图**（每张一次真实花费），
把占位图换成转存后的地址，换好的 html **覆盖库里那一页**。

```json
{ "page": 3, "force": false }
```

html 从库里取、**不收 body** —— 收的话前端内存里那份（可能是重新生成前的旧版）会被配上图再存
回去，那一页于是回退成上一版内容而图是新的，两边都不报错。

```json
{
  "html": "配好图的那一页",
  "previewHtml": "单页 deck（不带页脚）",
  "images": [
    { "index": 1, "prompt": "槽位那句 data-img-prompt", "mode": "concept", "ratio": "16:9 landscape", "url": "https://cos/…png", "storage": "cos | local", "model": "…" },
    { "index": 2, "prompt": "…", "mode": "data", "ratio": "1:1", "error": "上游原文（这一格还是占位图）" },
    { "index": 3, "prompt": "…", "mode": "concept", "ratio": "16:9", "skipped": true }
  ],
  "quotaExceeded": false,
  "provider": { "id": "…", "model": "…" },
  "style": { "id": "S-A", "name": "现代 SaaS 等距" },
  "problems": ["失败的那几格 / storage=local / 图位配不上…"]
}
```

逐张回 `url` / `error` / `skipped` 三种结局中的一种，`error` 带**上游原文**（模型名不对 /
余额不足 / 配的是视频模型 / 回了 200 但没有图，四种解法完全不同，合成一句「生图失败」
等于指错方向）。整页**只解析一次接入点**并 `providerId` 绑死它、只解析一次画风并按 id 绑死 ——
按 kind/档位解析会挑「最近更新的那条」，于是一页里的图出自两个模型，每张单看都不错、
翻下来笔触不统一，而没有一处报错。

**部分成功是常态**（一张失败别的照样贴上去），成功那几张**照样落库** —— 那是真花过钱的，
不存等于让他再花一遍。失败的那几格**保留占位图**，绝不写回坏地址：占位图明显是「还没配图」，
而坏地址在屏幕上和「这一格本来是空的」长得一样。已经不是占位图的槽位**默认跳过**
（重做一次是一次真实花费），`force: true` 才重做（前端那个「换一批图」）。

前端**必须用返回的 `html` 覆盖那一页存着的 html 并作废拼好的整份**：不覆盖的话拼整份用的还是
占位图那一版，而预览里刚刚明明看到图了。`problems` 里 `storage: "local"` 那条不能吞（COS 没配好，
落在 /uploads 下，换机器就 404，而生成那一刻预览里一切正常）。

**撞额度不是 429，是 200 带 `quotaExceeded: true`** 并在那一张上停下：已经生成的那几张
**不回滚**（钱花了，抛掉整个结果等于让他再花一遍），接着往下跑只会拿到一串一样的错误、
中间夹着刚才那几张的成功。前端要把它当成「额度用完了」显眼提示，而不是「有几张失败」。

400：这一页还没生成 HTML（先生成再配图）；503：专属渠道缺 `kind=image` 那一档
（配置问题，合成 500 的话他以为服务坏了，而真实解法是去后台补一条接入点）。

### POST /api/ppt/decks/:id/deck `PROTECTED`
把这份稿子已生成的那几页拼成整份 deck，**不调 AI、不花额度**。无 body。

`{ "html": "整份 deck（带页脚）", "pages": 12 }`

页**从库里读**、只按 `page` 排（批量生成是逐页回来的，照前端传来的数组顺序拼的话每一页都对、
章节全乱）。**缺一页就 400 并点名缺哪几页**：缺页的 deck 翻起来和完整的一模一样，只是内容跳了
一段，而页脚那个「/ 12」是按**规划总页数**由代码写的，连页码都看不出缺口。
整份**必须带页脚**（放映靠它翻页/看进度），制作过程中的单页预览一律不带 ——
反了都不报错：单页预览里那条页脚压在画面底部 54px 上，挡掉的一行看起来像「这一页排版就是这样」。

**任何一页重新生成、或者重新规划之后，前端要把拼好的这份作废**：留着的话它翻起来完全正常，
只是那一页还是改之前的版本。

### POST /api/ppt/decks/:id/export `PROTECTED`
导出整份成一个 .html 文件（不调 AI，页同样从库里读，走同一个 `buildDeck`）。

```json
{ "baseUrl": "location.origin" }
```

```json
{ "filename": "AI转型-20260903.html", "html": "整份（图的地址已改成绝对地址）", "placeholders": 2, "warnings": ["…"] }
```

**回 JSON 让前端自己 Blob 下载，不回 attachment**：这份文件依赖什么必须显示在界面上 ——
还剩几格占位图（`placeholders`）、几张图落在 `/uploads`（换机器就 404）、字体走 Google Fonts
（取不到就掉回系统字体，字重字距变了像版面塌了）、导出地址是 localhost（发给别人打不开）。
这四样在导出那一刻的预览里全看不出来，用户是转给同事打开时才发现，而那时没有一处能说明成因。

图的相对地址**必须改成绝对地址**：`/ppt-cases/ph-*.svg` / `/uploads/x.png` 在 `file://` 下指向
磁盘根目录 —— 整份 deck 的图全是破图，而文字、版式、翻页全正常，看起来像「这份稿子设计上就
没配图」。`baseUrl` 由前端传 `location.origin`：服务端按 `req.protocol` 算的话反代后面拿到的是
http，混合内容被浏览器拦掉，那几格照样只是「没配图」。
文件名（主题 + 日期）已经洗掉路径分隔符（`a/b.html` 会让浏览器存到别处或者干脆不下载 =
那次点击什么都不发生，读起来像功能坏了），前端下载那几行的失败也要走错误横幅。
`baseUrl` **不是 `http(s)://host` 形状时 400**，不兜一个「看起来对」的值：兜了的话整份文件里
的图指向一个拼出来的假地址，而下载和打开都不报错 —— 只是每一格都是破图。
缺页照旧 400（同 `/deck`）。**任何一页改过之后「已导出 xxx.html」那句话要改口**，
留着的话他以为手上那个文件是最新的。

### POST /api/ppt/decks/:id/export-pptx `PROTECTED`
导出整份成一个**每一块都能单独编辑**的 .pptx（不调 AI，页同样从库里读，先走 `/export` 那份
html，再用 Playwright 逐页把 DOM 走一遍：有底色/描边的块 → pptx 形状，`<img>`/内嵌 svg/
纯 CSS 背景图的块 → 单独截那一个元素贴成图片，每一块文字 → 真的文本框）。**没有整页底图。**
**pptx 里没有页脚**（品牌 + 主题 + 进度条 + 「3 / 12」页码都不导，顶部那条品牌色带留着）——
`.html` 那份照旧有，两条路在这一点上故意不一样。

```json
{ "baseUrl": "location.origin" }
```

```json
{ "filename": "AI转型-20260917.pptx", "base64": "二进制的 base64", "bytes": 346521,
  "pages": 5, "textBlocks": 108, "shapes": 62, "images": 9, "warnings": ["…"] }
```

**这条路是有损的，所以 `warnings` 必须显示在界面上，而且「一切正常」时也有一条。**
那条常在的话说的是「位置是按服务器上量的字宽摆的」：客户机器上没装 Noto Sans/Serif SC 时会有
个别小标题挤在一起或多折一行 —— 不说的话那个错位会被当成导出坏了。另外几种更隐蔽：
服务器上没取到 Noto（整份的位置和宽度都是按回落字体量的）、图没取到（`broken`）、
某一页一块可编辑文本都没有（页号必须在话里 —— 那是客户当面双击才会发现的事）、整份大过
20 MB、以及**pptx 里压根画不出来的那十来类样式**（渐变退成第一个色、毛玻璃/混合模式/滤镜没了、
clip-path 变成完整矩形、竖排变横排、内嵌 svg 是贴图、CSS 背景图连遮罩一起贴成一张…）——
每一类都报「几处、哪几页」，因为这几种下载下来都是一份打开正常的 pptx，客户只会觉得
「这版设计有点素」。这几句在 `pptxNotes()` 里，有测试。

**回 base64 JSON 不回 attachment**：同上，那几句话得有地方显示；前端必须走
`atob → Uint8Array → Blob`，用文本存法会把二进制写坏（文件能下载下来，PowerPoint 说已损坏）。
`/export` 自己那几条 warning（图的地址、localhost）在这里**不转发** —— 图已经按字节嵌进去了，
说「换机器会 404」是指错方向。`textBlocks`/`shapes`/`images` 三个数**必须分开回**：
`images` 是唯一能看出「这份里还剩几块是贴图、改不了」的地方，合成一个总数的话，
「全页贴成一张图」和「全页可编辑」在回执上一模一样。

起不了浏览器（没 `npx playwright install chromium`）、渲染出来一页幻灯片都没有：都 400 报出成因，
不给导一份空文件。缺页照旧 400（同 `/deck`）。**任何一页改过之后那句「已导出 xxx.pptx」要改口。**
`::before/::after` 怎么变成真对象、pptx 的叠放顺序怎么算、量之前必须改哪几处 CSS，
见 `docs/modules/ppt.md`。

### GET|POST|PATCH|DELETE /api/ppt/admin/sdk-keys `ADMIN`
展示稿对外接入（migration 100）的 pk CRUD：绑账号 / 配 Origin 白名单 / 启停 / 换取限流 /
每把 key 的天花板。和 consult 那套（084）同一个 pk 模型、同一份 `core/sdkKeys.ts`
（Origin 归一化各写一份的话，同一个域名在一个模块放行、另一个 403，看起来像「配了不生效」）。

- `allowedOrigins` **不许为空**：空清单的 key 换不到 token，而后台那一行看起来是建好的。
- `dailyAiLimit`（缺省 **120**）/ `maxDecks`（缺省 50）：**新 key 一定有上限**。这里不照抄
  consult 的 50 —— ppt 一次操作不等于一次调用（规划 1 次、生成 12 页 12 次、每张图一次
  **生图**），50 在这条路上是「一份半稿子」，而接入方看到的只是「生成到第 8 页就一直失败」。
  两个字段必须是 >= 0 的整数（不是就 400），**`0` 是合法值** = 把这把 key 冻住。
- GET 每行额外回 `ai_used_today` / `decks`（用量按日期归零后再回，直接读那一列的话昨天打满的
  key 今天显示还是 120/120，管理员会去调高一个压根没满的上限）。
- **删 key 不删它名下的稿子**：那些是接入方真花钱做出来的，跟着 DELETE 掉的话管理员点一下
  就静默销毁几十份，而界面上只有一句「已删除」。删掉后没有入口能打开它们（归属键里的 pk
  再也换不到 token）。
- 停用/删掉 key 立刻生效（`pptSdkLimits` 每个请求查一次），不用等那把短 token 过期；
  对外统一回 403 `{ code: 'sdk_key_disabled' }`「接口已关闭，请联系管理员」。

### POST /api/ppt/sdk/token `PUBLIC`
第三方**纯前端**页面换一把 15 分钟短 token，用来 iframe 嵌入 /ppt 工作台（100）。
Body：`{ pk, externalUid }`。回 `{ token, token_type, expires_in, external_uid }`。
规则和 `POST /api/consult/sdk/token` 逐条相同（必须由第三方页面自己发、`externalUid` 必填且
只是展示隔离、Origin 不在白名单回 403 且带上收到的那一行），差别只在 scope 和放行清单：

- 换出的 token `scope=ppt:embed`，能碰哪些端点由全局 `auth/scopeGuard.ts` 管（默认拒绝）：
  放行 `GET /api/ppt/{layouts,layouts/:id,styles,design-options,edit-palette}`、
  `/api/ppt/decks` 子树（含写）和 `/api/ppt/assets*`（素材库，见下）。**其余一律 403**，
  被排除的三类是故意的：`/api/ppt/admin/*`（发 key）、`PUT /api/ppt/layouts/:id/enabled`
  （**账号级**开关，一个接入方关掉一个版式会让绑定账号和其他接入方都排不出它）、
  `GET /api/ppt/library/assets`（deck 外壳的共享 CSS/配色资料，前端一处都没在调）。
- **租户是「一家公司」= `(绑定账号, 那把 pk)`，稿子和素材库同一个边界（101）：同一把 key 下
  所有员工看到全部稿子和全部素材。** `externalUid` 只记「谁建的/谁生成的」，不参与筛选 ——
  参与的话公司里每个人各自一个空工作台 + 空素材库，接口全 200；反过来只按绑定账号筛就是
  另一家公司的稿子和客户产品图出现在这个列表里，同样读起来完全正常。

### 上限被触发时的两种 429（带 `code`，都写着真实数字）
- `sdk_deck_cap`：`POST /api/ppt/decks` 超过 `maxDecks`。
- `sdk_ai_quota`：会花钱的端点超过 `dailyAiLimit`（`/outline-chat`、`/extract-file`、`/tidy-text`，以及 `/decks/:id/` 下的 `clean-outline`、`plan`、
  `pages`、`replan-images`、`prepare-images`、`ai-edit`、`ai-remake`、`images`），服务器时间
  0 点重置。**先扣再放行**；纯代码那几条（改文字/改样式/画布/蒙版/拼整份/导出/插页删页）不计费。
  `/extract-file` 也在表里（传图片时它是一次真实的视觉调用）—— 代价是传文档也记 1 次，
  中间件跑在解析 body 之前，那时压根不知道这次传的是图还是文档。
  `POST /decks/:id/images` 一次可能生 4 张图，中间件只扣 1，差额由 `chargeExtraPptSdkAiCalls`
  **按张补扣** —— 不补的话生图那条路对第三方相当于打了 N 折，而后台显示的用量完全正常。

### /ppt 的 iframe 响应头
和 `/consult` 同一套（不发 `X-Frame-Options`，改用 `frame-ancestors`），但**两个模块各一份
名单、不取并集**：只接了咨询的伙伴不该顺带能把展示稿工作台套进自己页面。
`/api/ppt/demo-deck.html`（版式卡里那层同源 iframe）在嵌入模式下是**套两层**的，所以它的
`frame-ancestors` 是 `'self'` + ppt 那几个伙伴域名 —— 只写 `'self'` 的话第三方页面里版式那一格
是一块白，而我们自己打开一切正常。

- **接入方那一侧只有 `mountPpt`（`/sdk/ppt-sdk.umd.cjs`，UMD 全局名 `PptSDK`）**：iframe 指向
  `/ppt/embed?host=…&next=…`（引导页，无 `requiresAuth`），换 token 那一下**在宿主页面里发**。
  `POST /api/ppt/sdk/token` 的**预检**必须在全局 `cors()` 之前放行（`app.ts` 的 `sdkTokenCors`，
  三个模块共用）—— 漏了的话浏览器在预检就拦掉，接入方页面一块白而我们连日志都没有。
  消息通道是 `qn-ppt`（咨询是 `qn-consult`）：共用一个的话同页嵌两个工作台时展示稿会拿到一把
  `consult:embed` 的 token，握手看起来成功而每个接口都 403。样例页 `/sdk/ppt-demo.html`。

---

## Error Responses

### 标准错误
```json
{ "error": "Error message here" }
```

### 额度耗尽 (429)
```json
{ "error": "quota_exceeded", "remaining": 0, "daily_limit": 10 }
```
`error` 是**机器码**（`lib/api.ts` 认它来弹全局那个额度提示框），前端不要显示它本身。
consult / ppt 另带 `detail`（人话，说清撞的是账号总额还是这个应用的单独额度）和 `app`；
有 `detail` 就显示它 —— 前端自己写死一句「缺省 10 次/天」的话，对开了专属渠道
（后台显示「不限」）或被单独配了应用额度的账号是句假话。
**判「是不是额度用完」只许看 HTTP 429 + 这个机器码**，不许拿文案里有没有「额度」两个字去猜：
本平台的失败文案普遍带着「这次的 AI 额度已经扣了」（如实交代花掉的钱），拿文案匹配会把
空返回/超时显示成「额度用完，明天 0 点重置」，而真实成因完全是另一件事。

### 限流 (429)
```json
{ "error": "rate_limit_exceeded", "retry_after_ms": 45000 }
```

### 模块路径未授权 (403)
```json
{ "error": "This API path is not enabled for this module", "module": "fish", "path": "/api/chat/stream" }
```

### 模块已禁用 (403)
```json
{ "error": "Module is disabled", "module": "fish" }
```

---

## Rate Limits

| Endpoint Group | Limit |
|---------------|-------|
| /api/auth/login | 5 req/min |
| /api/auth/register | 3 req/min |
| /api/auth/* | 30 req/min |
| /api/ai/* | 30 req/min |
| /api/chat/* | 20 req/min |
| /api/consultant/* | 20 req/min |
| /api/analytics/* | 30 req/min |
| /api/ui-review/*、/api/tender/*、/api/xhs/*、/api/consult/*、/api/feishu-assistant/* | 60 req/min |
| /api/ppt/* | 300 req/min（案例库一页就是 65 个 iframe，60 的话翻两页就被 429 挡住，而卡片上照样挂着「效果 demo」） |

Headers: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`
