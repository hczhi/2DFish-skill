import { jsonGateway, jsonFailMessage } from '../../core/llm/parseJson.js';
import { SAMPLING } from '../../core/llm/gateway.js';
import { STAGES, stageByKey, unlockState, LANE_LABEL, type StageDef } from './stages.js';
import { listEntries, listMessages, type ConsultProject, type ConsultEntry } from './projectStore.js';
import { listSources, sourcesBlock } from './sourceStore.js';
// 只取类型（`import type` 在编译后整句消失），所以这里和 decisionService 之间没有运行时循环依赖。
import type { DecidedSheet } from './decisionService.js';

// 快车道（四看）的结论草稿。慢车道（四问/四大成）的候选方向是另一条路径，
// 不共用这里的 prompt —— 两者要的东西不一样：这里要「把资料里已有的事实梳理成一句判断」，
// 那里要「给几个人来选的取舍方向」。

/** 带 HTTP 状态的业务错误，路由层直接透出 message。 */
export class StageError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = 'StageError';
    this.status = status;
  }
}

export interface StageDraft {
  /** 一句话总结。它是唯一会跟着每一条定稿进下游 prompt 的那段。 */
  conclusion: string;
  /**
   * 正文 markdown，按 `stage.deliverables` 一项一节（含表格）。
   *
   * 没有这一栏的时候模型回的是一段 300 字综述 —— 读起来完全正常，
   * 但方案里真正要用的企业现状卡 / 痛点优先级矩阵 / 数据置信度表全都不在，
   * 而界面上「一段通顺的判断」和「该有的六节都在」看不出区别。
   */
  body: string;
  rationale: string;
  evidence: string;
  confidence: 'high' | 'mid' | 'low';
  /**
   * 本步的 AI 赋能机会，1-2 条，**只标不展开**（方法论 §4：各模块只标，最后合成
   * 独立的一章「AI 转型机会清单」）。存成结构化字段而不是 body 里的一节，见 migration 081。
   */
  aiOpportunities: string[];
  /**
   * 资料里没有、模型不敢编的缺口。**必须回显给用户**：
   * 快车道的结论完全取决于他贴的那段资料，缺料时模型编出来的结论
   * 和有依据的结论读起来一模一样 —— 这一栏是他唯一能看出「该去补料」的地方。
   */
  gaps: string[];
}

export const CONFIDENCE_VALUES = ['high', 'mid', 'low'] as const;

/**
 * max_tokens 的额度是按**思维链的方差**给的，不是按 JSON 的长度给的。
 *
 * 一份草稿的正文不到 1000 token，但带思维链的模型把 reasoning 也算进这个额度、
 * 又不放进 message.content —— 实测同一个 prompt 一次总输出 1214 token 就写完了，
 * 下一次思维链自己跑到 4000 顶格，content 是空的（finish_reason=length，
 * 界面上表现为「模型没有返回内容」）。
 *
 * 所以这两个数是「留给它想」的空间，不是「正文能有多长」。调低它不会省钱
 * （计费按实际用量），只会把偶发的思维链长跑变成一次白扣额度的报错。
 *
 * **但往上调也有天花板，而那个天花板不在我们这边。** 实测「看自己」在
 * deepseek-v4-flash 上思维链要 20501 / 22225 token（两次），24000 的额度于是刚够
 * 想完、正文断在第一节（finish_reason=length）；把它开到 36000 想给正文留位置，
 * 结果是那次请求跑到 300.2 秒被**上游网关**掐掉，回一句 nginx 的 `504 <html>`。
 * 也就是说这条接入点对单次请求有 ~300 秒的上限，而那条思维链撑不进去 ——
 * 继续加这个数只会把「截断」换成「网关 504」，两种都是白花一次额度。
 *
 * 所以这两条调用**关掉思维链**（`noThinking: true`，见 GatewayOptions 上的实测数据）：
 * 那之后 24000 是实打实留给正文的 24000，上面那两种失败一起消失，耗时也从四分钟量级
 * 掉到十几秒。这两个数因此现在是**宽松的上限而不是紧的**，不要因为「反正关了思维链」
 * 就调小它们 —— 关不掉的接入点（`withNoThinking` 会喊那一句）照旧要靠这个额度撑住。
 */
const MAX_TOKENS_DRAFT = 24000;
/**
 * 4 个方向 × 六栏 × 各带一份输出物清单正文，是这个模块最长的一次输出：六栏部分实测
 * 1500+ 字，清单正文按 `DIRECTION_BODY_MAX_CHARS` 封顶再乘 4，加起来 5000 字量级。
 * 上面那个天花板（~300 秒）在这里更近，所以约束写在 prompt 的字数区间上而不是这个数上
 * —— 这个数只是「别在写完之前被截断」，截断的表现是 JSON 配不平、整批方向一个都不剩。
 */
const MAX_TOKENS_DIRECTIONS = 16000;

/**
 * 出草稿 / 出方向的超时，**并且不重试**（平台默认是 120s + 重试 1 次）。
 *
 * 这两条调用要写的是好几张表 + 一整段思维链，实测「看自己」这一步在
 * deepseek-v4-flash 上 260 秒才回来（120 秒根本不够）—— 而默认那次重试把总等待
 * 变成 240 秒才报错，两次都白花（同样的资料、同样的 max_tokens，第二次断在同一个
 * 地方，见 GatewayOptions.maxRetries）。所以一次给足，不重试。
 *
 * 给的是 330 秒而不是「越大越好」，理由是**要让上游自己的那句报错先到**：实测这条
 * 接入点在 300 秒左右会自己掐掉长请求并回一句 nginx 504。我们的超时比它短的话，
 * 用户看到的是我们合成的「模型在超时时间内没有返回」—— 指向「换个快模型」，
 * 而真凶是网关的时间上限（同样的模型跑短一点的 prompt 就过了）。
 *
 * 这个数和前端那个轮询窗口是**一对**（ConsultProject.vue 的 POLL_MS × POLL_MAX_TICKS）：
 * 这里给得比它长的话，服务端还在写、界面已经说「超时了」，而那一版稍后会静默落进
 * 对话记录 —— 用户已经走了，下次进来看到一版没人要的草稿。改这个数要一起改那个。
 */
const AI_TIMEOUT_MS = 330_000;

/**
 * 正文的下限。低于这个数说明模型没按输出物清单写，而是回了一段综述。
 *
 * 直接抛错而不是存下来：一段通顺的综述在界面上和「六节都在」区别只在你逐节去数，
 * 用户会直接定稿，而这条定稿会作为依据进下游每一步 —— 错的地方在十步之后才显形。
 */
const MIN_BODY_CHARS = 400;

/**
 * 取阶段定义并校验能不能在这个阶段上写东西。
 *
 * 三道闸都会「静默成功」如果不拦：
 * - 不认识的 key：写进去的定稿谁也读不到（阶段栏按代码清单渲染），进度还是 0/14；
 * - 车道不对：慢车道走出草稿接口，拿到的是一句「梳理事实」式的结论，
 *   用户 review 一下就定稿了，四问该有的取舍过程整个消失，报告照样完整；
 *   反过来执行层走「出候选方向」接口，模型会为它编一句定位语（那是占位系统的活），
 *   编出来的和定稿过的不是一句话，而两处都读得通；
 * - 前提没定稿：这一步的判断本该引用上游结论，跳着做出来的东西读起来一样漂亮，
 *   只是依据是空的。
 */
export function requireStage(
  projectId: string,
  stageKey: string,
  opts: { lanes?: StageDef['lane'][] } = {}
): { stage: StageDef; entries: ConsultEntry[] } {
  const stage = stageByKey(stageKey);
  if (!stage) throw new StageError(`没有这个阶段：${stageKey}`, 404);

  const entries = listEntries(projectId);
  const { unlocked, missing } = unlockState(stage, new Set(entries.map((e) => e.stage_key)));
  if (!unlocked) {
    const labels = missing.map((k) => stageByKey(k)?.label || k).join('、');
    throw new StageError(`「${stage.label}」还没解锁：需要先定稿 ${labels}`, 409);
  }
  if (opts.lanes && !opts.lanes.includes(stage.lane)) {
    throw new StageError(`「${stage.label}」是${LANE_LABEL[stage.lane]}的阶段，走不了这条接口`, 400);
  }
  return { stage, entries };
}

/**
 * 同上，外加一道「这一步还没定稿」的闸门 —— 定稿之后这一步是**只读**的。
 *
 * 三条写路径（出草稿 / 出方向 / 阶段内对话）都要过这道闸，理由是它们全都以
 * 「花一次额度、看起来成功」收尾而实际什么都改不了：定稿接口已经不收第二版，
 * 于是重出的那一版右栏点「完成定稿」时才报错（额度已经花了），而在这一步聊的话
 * 更彻底 —— 定稿之后 `discussionBlock` 再也不会被读一次，那几句话进不了任何 prompt，
 * 而 AI 照样一句一句认真回，读起来完全像在推进这一步。
 *
 * 报错里必须说出「这一步锁了」和「下一步在哪」：只说「不能操作」的话用户会以为
 * 是权限或者故障，一路重试。
 */
export function requireOpenStage(
  projectId: string,
  stageKey: string,
  opts: { lanes?: StageDef['lane'][] } = {}
): { stage: StageDef; entries: ConsultEntry[] } {
  const out = requireStage(projectId, stageKey, opts);
  const done = out.entries.find((e) => e.stage_key === stageKey);
  if (done) {
    throw new StageError(
      `「${out.stage.label}」已经定稿（第 ${done.version} 版），这一步锁定了：定稿是下游每一步的依据，` +
        `所以不再改动，也不再接受这一步的对话（聊了也不会进任何 prompt）。接着往下走去下一步。`,
      409
    );
  }
  return out;
}

/**
 * 模型没给出能用的 JSON 时的报错文案。实现在 `core/llm/parseJson.ts`（xhs 那几个
 * JSON 端点用的是同一份）—— 各模块各写一份的话，改了这边的措辞另一边照旧，
 * 而两边的症状（空返回 / 截断 / 格式坏）是同一个模型的同一个毛病。
 */
const gateFailMessage = jsonFailMessage;

/**
 * 知识库块：按阶段顺序拼已定稿结论，作为这一步的依据。
 *
 * **只有直接依赖（`stage.requires`）带正文，其余只带一句话总结。** 十二个阶段的正文
 * 全带上的话，做到「品牌屋」那一步 prompt 已经被几万字的表格占满，客户资料被挤到
 * 最后面 —— 表现不是报错，是模型开始照自己的常识写，回来的东西格式完整、内容和这家
 * 企业无关。带哪几节由调用方按 requires 传，不在这里猜。
 */
export function knowledgeBlock(entries: ConsultEntry[], fullBodyFor: string[] = []): string {
  // 带哪几份正文由 `stage.contextBodies ?? stage.requires` 决定（见 bodyKeys）。
  const byKey = new Map(entries.map((e) => [e.stage_key, e]));
  const withBody = new Set(fullBodyFor);
  const lines: string[] = [];
  for (const s of STAGES) {
    const e = byKey.get(s.key);
    if (!e) continue;
    let block =
      `### ${s.label}（${e.stale ? '⚠ 上游已变，谨慎引用' : `置信度 ${e.confidence}`}）\n` +
      `一句话总结：${e.conclusion}` +
      (e.rationale ? `\n理由：${e.rationale}` : '');
    if (withBody.has(s.key) && e.body.trim()) block += `\n\n${e.body.trim()}`;
    lines.push(block);
  }
  return lines.length ? lines.join('\n\n') : '（还没有已定稿的结论，这是第一步）';
}

/**
 * 这一步要带整份正文的上游阶段。**默认跟 `requires` 一样，不许在调用点各写一份** ——
 * 出草稿和出方向两条路径漂开的话，同一步在快/慢车道下读到的依据不一样，而两边都不报错。
 * 为什么和 requires 分开：见 `StageDef.contextBodies`。
 */
export function bodyKeys(stage: StageDef): string[] {
  return stage.contextBodies ?? stage.requires;
}

/** 输出物清单进 prompt 的那一段。序号必须写出来 —— 用户界面上照同一个序号数缺了哪一项。 */
export function deliverablesBlock(stage: StageDef): string {
  return stage.deliverables.map((d, i) => `${i + 1}. ${d}`).join('\n');
}

/**
 * 分析操法进 prompt 的那一段（`stage.method`，方法论各模块的推导顺序与判断标准）。
 *
 * 两条 prompt 都要带：只给输出物清单的话模型会**把表格填满但推导是自己编的** ——
 * 价值主张三层都在却没做过三问检验、没判过卡在哪一层；竞品每家写的维度还不一样。
 * 这种正文和照方法论推出来的在界面上没有区别，顾问会直接拿去用。
 */
export function methodBlock(stage: StageDef): string {
  return stage.method.map((m, i) => `${i + 1}) ${m}`).join('\n');
}

/**
 * 进 prompt 的对话条数上限。和 chatService 那个是两个数：聊天每句都要重发一遍历史，
 * 这里一次调用只发一次，但正文要输出的那几张表已经占了大半上下文。
 */
const MAX_DISCUSSION_MESSAGES = 16;

export interface Discussion {
  text: string;
  used: number;
  dropped: number;
}

/**
 * 本步已经聊过的东西。**这是「重出一版」和「上一版」之间唯一的差别。**
 *
 * 不带它的话，用户在这一步聊了二十句再点「让 AI 重出一版 / 都不满意，重出一批」，
 * 出来的东西和没聊过时是同一个分布 —— 而它读起来完全正常，一句错都不报，
 * 界面上还写着「聊定了再去上面出草稿」。用户于是以为自己在调教 AI。
 *
 * **只带 kind='text' 的那些。** 方向卡 / 上一版草稿的气泡是模型自己的输出：
 * 带回去它会照抄上一版（用户以为聊天没生效，而两版都读得通），
 * 而且那几条是整段正文，带上就把客户资料挤到上下文末尾 —— 那时候模型开始照常识写。
 */
export function discussionBlock(projectId: string, stageKey: string): Discussion {
  const all = listMessages(projectId, stageKey).filter((m) => m.kind === 'text' && m.content.trim());
  const kept = all.slice(-MAX_DISCUSSION_MESSAGES);
  if (!kept.length) return { text: '', used: 0, dropped: 0 };
  const text = kept
    .map((m) => `${m.role === 'user' ? '客户说' : '你上次答'}：${m.content.trim()}`)
    .join('\n\n');
  return { text, used: kept.length, dropped: all.length - kept.length };
}

/**
 * 对话块对应的硬规则。**没聊过就整段不拼**（同 tender 那条 relevanceRule 的道理）——
 * 空着的「参考已经聊过的」会让模型顺着规则编一段共识出来，而那段读起来完全正常。
 *
 * 优先级必须写死在这里：不写的话模型会把客户随口一句「简单点」执行成少写两节，
 * 而少一节的正文照样完整；也会把它自己上次的猜测当成客户确认过的事实写进 body，
 * 那一句和有依据的一模一样。
 */
function discussionRule(d: Discussion): string {
  if (!d.used) return '';
  return `

最后一条硬规则（关于「写什么」，优先级高于上面任何一条关于「怎么写」的偏好）：
**【本步已经聊过的】里客户提的要求优先于你自己上一版的写法** —— 他已经排除掉的方向不要再提，
他要求换的角度就按他说的换，他指名要补的那一节要真的补上。但两件事不许因此松掉：
一是**操法和输出物清单照旧走完**（他说「简单点」不等于可以少一节，少一节的正文读起来一样完整）；
二是**他在对话里给的事实按【客户资料】同级采信，你自己在对话里推测过的东西仍然是推测** ——
把上次的猜测当成客户确认过的事实写进去，读起来和有依据的一模一样。`;
}

/**
 * 这一步顾问拍过的板（`kind='decided'` 那条记录）。**慢车道出正文的地基。**
 *
 * `restaked` = 拍板之后他又出了一版岔路口清单。这种情况**不能照旧写正文**：那批选择
 * 对的是旧那一版的问题（清单里的 id 每次重出都重排），照旧写出来的正文地基是他没看过的
 * 那几处取舍，而正文和方法论速览读起来完全正常。
 */
export function decidedContext(
  projectId: string,
  stageKey: string
): { sheet: DecidedSheet; restaked: boolean } | null {
  const msgs = listMessages(projectId, stageKey);
  const last = [...msgs].reverse().find((m) => m.kind === 'decided' || m.kind === 'decisions');
  if (!last) return null;
  const decided = [...msgs].reverse().find((m) => m.kind === 'decided');
  if (!decided) return null;
  try {
    const sheet = JSON.parse(decided.payload || '{}') as DecidedSheet;
    if (!Array.isArray(sheet.picks)) return null;
    if (!sheet.picks.length && !sheet.noFork) return null;
    return { sheet, restaked: last.id !== decided.id };
  } catch {
    return null;
  }
}

/**
 * 拍板结果进 prompt 的那一段。**代价（`cost`）必须带上**：不带的话模型只讲选中那条路的
 * 好处，而「放弃了什么」是这一步唯一不可逆的信息（定稿之后只读），也是定位边界那一节的原料。
 */
function decidedSection(sheet: DecidedSheet): string {
  if (!sheet.picks.length) {
    return `\n\n【顾问已经拍板（这一步没有取舍要定）】
${sheet.noFork}
所以照现有资料和上游定稿直接写完这一步，**不要**在正文里另摆几个方向让他再选一次。`;
  }
  const lines = sheet.picks
    .map(
      (p, i) =>
        `${i + 1}. ${p.question}${p.methodRef ? `（${p.methodRef}）` : ''}\n` +
        `   他定了：${p.label}${p.detail ? ` —— ${p.detail}` : ''}\n` +
        `   这一选择放弃的是：${p.cost}` +
        (p.note ? `\n   他另外交代：${p.note}` : '')
    )
    .join('\n');
  return `\n\n【顾问已经拍板的方向（这是这一步的地基，${sheet.picks.length} 处）】
${lines}`;
}

/**
 * 慢车道正文的硬规则（拍过板之后）。**「不要再给第二种方案」是这里最要紧的一条**：
 * 他已经定了，正文里再摆一句「或者也可以…」出来，这份方案就有两个互相矛盾的地基，
 * 而两段各自都通顺 —— 客户读到的是一份自相矛盾的定位。
 */
function decidedRule(sheet: DecidedSheet): string {
  const picked = sheet.picks.length;
  return `

关于【顾问已经拍板的方向】（优先级高于你自己的判断）：
- **照他定的那几条写，不要再给第二种方案、不要再问一次。** 你觉得另一条更好也不许写成
  「或者也可以…」——一份方案里两个地基，两段各自都通顺，而客户拿到的是自相矛盾的定位。
- **放弃的东西要真的写出来**（他选那一条时放弃的那些）：落到「边界 / 不做什么 / 不承诺」
  那几节里。只写好处的正文读起来更漂亮，而下一步会把被放弃的那些又拉回来。
- 他定的和你从资料里读到的冲突时，**照他定的写，并在 rationale 里点出冲突在哪**
  （悄悄按自己的判断改一版的话，他看不出这一节已经不是他定的那条路了）。
- \`## 0. 方法论速览\` 里**必须写出这${picked ? ` ${picked} ` : ''}处取舍是顾问定的、
  他选的是哪一条、放弃了什么**（一处一句）。这是整份方案里唯一能看出地基是谁定的地方 ——
  不写的话，他定的和你替他定的在正文里一模一样。`;
}

/** 对话块进 user prompt 的那一段。丢掉的条数要写给模型：不写它会以为手上是全部上下文。 */
function discussionSection(d: Discussion): string {
  if (!d.used) return '';
  return `

【本步已经聊过的（客户和你在这一步的对话，最近 ${d.used} 条${
    d.dropped ? `，更早的 ${d.dropped} 条这次没带上，别假设你知道全部经过` : ''
  }）】
${d.text}`;
}

/** 一条 AI 机会最长这么多字。它是「只标不展开」的一句话，长了就是把整节写进来了。 */
export const MAX_AI_OPPORTUNITY_CHARS = 200;
/** 每步最多 2 条（方法论 §4）。放宽的话最后那一章会变成十二步凑出来的几十条流水。 */
export const MAX_AI_OPPORTUNITIES = 2;

/** 模型给的 aiOpportunities → 干净的 1-2 条。多的直接丢（凑数的那几条本来也没用）。 */
export function parseAiOpportunities(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => String(x ?? '').trim().replace(/\s*\n\s*/g, ' '))
    .filter(Boolean)
    .slice(0, MAX_AI_OPPORTUNITIES)
    .map((x) => (x.length > MAX_AI_OPPORTUNITY_CHARS ? x.slice(0, MAX_AI_OPPORTUNITY_CHARS) : x));
}

/**
 * 两条 draft prompt 共用的几条硬规则。
 *
 * 抽出来是因为它们**改了必须两边一起改**：数据源分级只在一边改的话，
 * 内容营销那一节会把「抖音月活 X 亿」写成查过的口气（模型内置知识而已），
 * 而那一节和真查过的读起来一模一样。序号留在各自的 prompt 里（两边条数不同）。
 */
const RULE_BODY_SECTIONS = `**body 必须按【本步必须产出的东西】逐项成节，一项一个 \`## N. 标题\` 小节，一项都不许省。**
   清单里写了"表格"的必须真的输出 markdown 表格（\`| 列 | 列 |\` 带分隔行），不许改写成段落或者项目符号。
   某一项资料实在不支持时，那一节照样要在，里面写明「资料缺什么、补什么才能填」，并把它写进 gaps。
   **另外固定加两节，前后各一节**（它们不在清单里，但每次都要有）：
   - 开头 \`## 0. 方法论速览\`：2-3 句说清这一步用的是什么框架，。
     顾问对着这一节就能判断这份正文是推出来的还是套出来的 —— 缺了它，两者在屏幕上没有区别。
   - 结尾 \`## 写作建议\`：这一节进正式方案时怎么组织（用哪张图/表呈现、哪一句是主论点、
     还要配什么证据、哪里要留给顾问自己拍）。这是给内部顾问的，不是给客户的话术。`;

const RULE_SOURCE_LEVELS = `**每个硬数字都要标出它是第几级证据**（方法论 §8 的数据源分级，四档不许混）：
   能在【联网资料】里对上的写「（联网·域名·年份）」= L1；能在【客户资料】里对上原话/数字的写「（客户资料）」= L2；
   只能靠通用行业常识推的写「（模型内置知识·仅区间）」并且**给区间不给精确值** = L3；
   查不到也推不出的写「资料缺失」并写进 gaps = L4。
   把 L3 的推测写成 L1 的口气（「据公开数据」「行业报告显示」）是这里最严重的错误 ——
   它读起来和真数字一模一样，而客户会拿它去做决策。`;

const RULE_NO_JARGON = `不许出现这些空话：赋能、抓手、闭环、赛道、心智、生态化反、护城河（除非在讲具体是什么）、"有一定基础"、"较为完善"。
   写不出具体内容就写"资料未提供"，不要用形容词糊过去。`;

const RULE_AI_OPPS = `aiOpportunities 给 1-2 条**本步视角下的** AI 赋能机会，**只标不展开**（一条一句，说清「用 AI 做什么、
   替代掉现在的哪个动作」）。它们最后要汇成方案里独立的一章「AI 转型机会清单」——
   这一步不标的话那一章就少一个模块，而那一章读起来照样是完整的清单。
   写不出跟这一步真有关系的就给一条，不要凑数写「用 AI 提升效率」这种。`;

const RULE_METHOD_FIRST = `**先照【这一步的分析操法】把推导走完，再写 body。** 操法是方法论规定的思考顺序和判断标准
   （比如竞品必须用同一套维度逐家拆、用户需求必须上探到社会/自我实现层）。
   跳过操法直接填表格的结果是：该有的节都在、表格也满，但每一格写的是通用常识 ——
   这种正文和照方法论推出来的在屏幕上一模一样，而顾问会直接拿它进方案。
   rationale 里要写清关键判断是照操法第几条推出来的。`;

// aiOpportunities 必须出现在这个格式里：这一栏单独存一列（081），而方案最后那一章
// 「AI 转型机会清单」就是十四步的这一栏汇起来的。格式里不写它，模型就整个不给 ——
// 那一章于是漏掉这个模块，而它读起来照样是一份完整的清单。
const DRAFT_JSON_FORMAT = `{"conclusion":"一句话总结","body":"markdown 正文：## 0. 方法论速览 + 按输出物清单逐项成节 + ## 写作建议","rationale":"为什么这么判断（取舍理由，含关键判断出自操法第几条）","evidence":"依据来自资料里的哪几句/哪些数字","confidence":"high|mid|low","aiOpportunities":["本步的 AI 赋能机会 1（只标不展开）","（可选）机会 2"],"gaps":["资料里缺的东西，客户补上能提高置信度"]}`;

/** 四看（fast）的 system prompt：找事实，不许发挥。 */
function fastSystem(): string {
  return `你是品牌占位系统的资深咨询顾问，正在做「四看」阶段的事实梳理，产出的是能直接放进咨询方案的一节内容。
四看是"找事实"，不是"做判断"——你的任务是把客户给的资料里**已经存在**的东西梳理成方案可用的成节内容，不是发挥。

硬规则：
0. ${RULE_METHOD_FIRST}
1. ${RULE_BODY_SECTIONS}
2. 只能依据【客户资料】和【已定稿结论】。资料里没有的事实一律不许当成事实写，缺什么写进 gaps。
3. ${RULE_SOURCE_LEVELS}
4. 每条判断后面带置信度标记：🟢 高（资料直接支撑）/ 🟡 中（部分靠常识补）/ 🔴 低（资料严重不足）。
5. ${RULE_NO_JARGON}
6. confidence 按整节的支撑程度给：high / mid / low。拿不准给低的那一档 ——
   客户看到 low 会回来补料，看到 high 就直接采纳了。
7. conclusion 是**一句话总结**（40-120 字），不是正文的摘要，是把这家企业在这一步上真正是什么样说透的那一句。
8. ${RULE_AI_OPPS}
9. 只输出 JSON，不要任何解释文字。body 里的换行用 \\n。

输出格式：
${DRAFT_JSON_FORMAT}`;
}

/**
 * 慢车道（四问 / 四大成）**拍过板之后**出正文的 system prompt。
 *
 * 它替掉的是「AI 出 2-4 份完整方向、顾问挑一份」那条路：那条路上四份正文各自都通顺，
 * 顾问实际是在读四份写好的东西里挑文笔，而那几处取舍（竞品挑哪几家、画像分几类、
 * 定位取哪个角色）已经被模型替他定死在正文里了。现在取舍先单独问过了（decisionService），
 * 这一份的任务就是**照他定的那几条写完一份**。
 *
 * 不能复用 fastSystem：那份写着「四看是找事实，不是发挥」，拿它写定位共识书的话模型
 * 只敢复述上游结论，交出一份没有定位语、没有边界、没有落地校验的综述 —— 而它读起来完全正常。
 */
function slowSystem(stage: StageDef, sheet: DecidedSheet): string {
  return `你是品牌占位系统的资深咨询顾问，正在做「${stage.group} · ${stage.label}」。
这一步是**做判断**，而判断里那几处取舍**顾问已经拍过板了**（见【顾问已经拍板的方向】）——
所以现在不要再摆几个方向让他选，你的活是照他定的那条路，把这一步该交的东西一次写完。

硬规则：
0. ${RULE_METHOD_FIRST}
1. ${RULE_BODY_SECTIONS}
2. 依据是【已定稿结论】+【客户资料】+【联网资料】。资料撑不住的判断不许写成事实，缺什么写进 gaps。
3. ${RULE_SOURCE_LEVELS}
4. ${RULE_NO_JARGON}
5. **写死不写活**：定位语 / 一句话身份 / 边界 / 落地话术这类要给出**那一句原文**，
   不要写「建议围绕 X 提炼一句」——那种正文表格填得满满的，实际一个字的交付都没有。
6. confidence 按这一步的依据够不够给：high / mid / low。上游结论缺得多、客户资料薄的时候给低的那一档。
7. conclusion 是**一句话总结**（40-120 字）：这一步定下来的是什么，不是正文的摘要。
8. ${RULE_AI_OPPS}
9. 只输出 JSON，不要任何解释文字。body 里的换行用 \\n。

输出格式：
${DRAFT_JSON_FORMAT}${decidedRule(sheet)}`;
}

/**
 * 第二层 / 第三层（plan）的 system prompt：把已定稿的占位系统结论**往下翻译**成能上手做的方案。
 *
 * 不能复用四看那份：它写着「不是发挥，只梳理资料里已经存在的东西」，
 * 而这一层要产出的平台矩阵 / 排期 / 链路本来就不在客户资料里 —— 拿 fast 那份 prompt 出来的
 * 是一份把上游结论换个说法复述一遍的综述，没有平台、没有节奏、没有负责人，
 * 而它读起来完全正常（每一节都在，句句都对）。
 */
function planSystem(stage: StageDef): string {
  return `你是品牌咨询的资深顾问，正在做「${stage.group} · ${stage.label}」——
品牌占位系统（四看 / 四问 / 四大成）已经定稿了，这一层的任务是把那些结论**往下翻译成客户团队能直接上手做的方案**。

这一步既不是"找事实"（要产出的东西本来就不在客户资料里），也不是"二选一的取舍"，
所以：该拿主意的地方拿主意，但每一条都要能指回上游某一条已定稿结论，并且要说清「谁在什么时候做什么」。

硬规则：
0. ${RULE_METHOD_FIRST}
1. ${RULE_BODY_SECTIONS}
2. **每一条建议都必须能回溯到【已定稿结论】里的某一条**（品牌屋 / 价值主张 / 用户关系 / 核心沟通创意…），
   并在正文里写出来指的是哪一条。指不回去的直接删掉 —— 「为了完整而补上的那一条」读起来和
   推出来的一样专业，而客户照着它做不长任何品牌资产。
3. **量力而行比丰富重要**：客户团队的人力 / 能力（在【客户资料】和上游结论里）是硬约束。
   做不动的东西不要写进方案，要写就写清「先补什么能力才做得动」——
   推荐一堆客户三个月后一个都没动的东西，方案看着丰富，实际等于没做。
   客户团队的能力资料里没写清的，写进 gaps 让他去问，不要自己假设成"团队齐备"。
4. 走**战略框架粒度**：给角色分工、节奏、负责人角色、可验收的口径；不要编具体预算数字和 KPI 数值
   （编出来的数字和算过的一模一样，而客户会拿它去立项）。
5. ${RULE_SOURCE_LEVELS}
6. ${RULE_NO_JARGON}
7. confidence 按「这套方案的依据够不够」给：high / mid / low。上游结论缺得多、团队能力不明的时候给低的那一档。
8. conclusion 是**一句话总结**（40-120 字）：这一层的主张是什么，不是正文的摘要。
9. ${RULE_AI_OPPS}
10. 只输出 JSON，不要任何解释文字。body 里的换行用 \\n。

输出格式：
${DRAFT_JSON_FORMAT}`;
}

function buildMessages(
  project: ConsultProject,
  stage: StageDef,
  entries: ConsultEntry[],
  disc: Discussion,
  decided: DecidedSheet | null
) {
  const system =
    (decided ? slowSystem(stage, decided) : stage.lane === 'plan' ? planSystem(stage) : fastSystem()) +
    discussionRule(disc);

  const user = `【品牌 / 客户】${project.brand_name}

【当前这一步】${stage.group} · ${stage.label}
要回答的问题：${stage.question}

【这一步的分析操法（方法论规定的思考顺序与判断标准，照它推，不许跳步）】
${methodBlock(stage)}

【本步必须产出的东西（body 就照这个清单一项一节写，顺序不要变）】
${deliverablesBlock(stage)}${decided ? decidedSection(decided) : ''}

【已定稿结论（企业知识库）】
${knowledgeBlock(entries, bodyKeys(stage))}

【联网资料（L1）】
${sourcesBlock(listSources(project.id))}

【客户资料（L2）】
${project.brief || '（客户还没贴任何资料）'}${discussionSection(disc)}`;

  return [
    { role: 'system' as const, content: system },
    { role: 'user' as const, content: user },
  ];
}

/**
 * 让 AI 出一份结论草稿。**不落库** —— 定稿是另一个动作（用户改完再存）。
 *
 * 空返回 / 解析失败一律抛错，不回一份空草稿：界面上「空草稿」和「模型没话说」
 * 长得一样，用户会以为这个客户的资料确实分析不出东西。报错里必须带思维链 token 数，
 * 不带的话他只会一路怀疑资料写得不好（真实原因是 reasoning 吃光了 max_tokens）。
 */
export async function draftFastStage(
  userId: string,
  project: ConsultProject,
  stageKey: string
): Promise<{ draft: StageDraft; truncated: boolean; discussion: Discussion }> {
  // 三条车道共用这条接口（都是「出一份草稿 → 用户改 → 定稿」），system prompt 按车道分。
  // 慢车道走到这里的前提是**取舍已经拍过板**（下面那道闸），所以它用的是 slowSystem。
  const { stage, entries } = requireOpenStage(project.id, stageKey, { lanes: ['fast', 'plan', 'slow'] });
  // plan 不拦空资料：它的依据是上游那十二条定稿，而那些已经解锁校验过了。
  // fast 必须拦 —— 四看的结论全部来自这段资料，空着的话模型只能编，而编出来的读着一样。
  if (stage.lane === 'fast' && !project.brief.trim()) {
    throw new StageError('先在下面贴一段客户资料 —— 快车道的结论全部来自这段资料，空着的话 AI 只能靠编', 400);
  }

  // 慢车道**必须先拍过板**。不拦的话这条接口就是「AI 把那几处取舍替你定了，然后写一份
  // 完整正文」——那正是这条流程要替掉的东西，而它的产出和照他定的方向写出来的一模一样。
  let decided: DecidedSheet | null = null;
  if (stage.lane === 'slow') {
    const ctx = decidedContext(project.id, stageKey);
    if (!ctx) {
      throw new StageError(
        `「${stage.label}」要先定方向再出正文：点「开始分析」，把 AI 列出的那几处取舍拍完板，` +
          `我再照你定的那条路写。不先定的话这几处就是 AI 自己替你定的，而写出来的正文看不出这件事。`,
        400
      );
    }
    if (ctx.restaked) {
      throw new StageError(
        `你拍板之后又出了一版待定方向（问题和顺序都变了）—— 照旧那批选择写出来的正文，地基是你没看过的那几处取舍，` +
          `而正文读起来完全正常。请在右栏那一版上重新选一遍再出正文。`,
        409
      );
    }
    decided = ctx.sheet;
  }

  const discussion = discussionBlock(project.id, stageKey);
  const { parsed, raw, finish, reasoningTokens } = await jsonGateway<any>(
    () => ({
      messages: buildMessages(project, stage, entries, discussion, decided),
      ...SAMPLING.analytic,
      max_tokens: MAX_TOKENS_DRAFT,
      response_format: { type: 'json_object' },
    }),
    {
      userId,
      source: 'consult',
      operation: `draft:${stage.key}`,
      tier: 'strong',
      requestSummary: `${project.brand_name} · ${stage.label}`,
      timeoutMs: AI_TIMEOUT_MS,
      maxRetries: 0,
      // 见 MAX_TOKENS_DRAFT 的注释：这一步的耗时和截断都来自思维链，不是正文长度。
      noThinking: true,
    }
  );

  if (!parsed) {
    throw new StageError(
      gateFailMessage('草稿', { raw, finish, reasoningTokens, budget: MAX_TOKENS_DRAFT }),
      502
    );
  }

  const conclusion = String(parsed.conclusion || '').trim();
  if (!conclusion) {
    throw new StageError('模型返回的结论是空的，草稿没生成。再试一次（这次的 AI 额度已经扣了）', 502);
  }

  const body = String(parsed.body || '').trim();
  if (body.length < MIN_BODY_CHARS) {
    // 一段综述在界面上和「输出物都在」区别只在逐项去数，用户会直接定稿，
    // 而这条定稿会作为依据进下游每一步。所以宁可让他重点一次。
    const tail = finish === 'length' ? '（模型返回被截断了）' : '';
    throw new StageError(
      `这次模型只回了 ${body.length} 字的正文${tail}，「${stage.label}」该有的 ${stage.deliverables.length} 项输出物（企业现状卡、优先级矩阵、置信度表这些）没写出来，没法当一节方案用。再点一次；老是这样就把客户资料补厚一点（这次的 AI 额度已经扣了）`,
      502
    );
  }

  const confidence = (CONFIDENCE_VALUES as readonly string[]).includes(parsed.confidence)
    ? (parsed.confidence as StageDraft['confidence'])
    : 'low'; // 认不出来的档位按最低算：宁可让用户回来核一遍，也不要把编的东西标成 high
  const gaps = Array.isArray(parsed.gaps)
    ? parsed.gaps.map((g: unknown) => String(g).trim()).filter(Boolean).slice(0, 12)
    : [];

  return {
    draft: {
      conclusion,
      body,
      rationale: String(parsed.rationale || '').trim(),
      evidence: String(parsed.evidence || '').trim(),
      confidence,
      aiOpportunities: parseAiOpportunities(parsed.aiOpportunities),
      gaps,
    },
    // 截断了照样把救回来的那部分给用户看，但必须说出来 ——
    // 断在半句话上的结论和写完的长得一样，他会直接定稿。
    truncated: finish === 'length',
    // 这一版到底带没带上他刚聊的那几句，必须回给界面：带上和没带上的草稿
    // 读起来一模一样，不说的话「聊天有没有用」永远只能靠感觉。
    discussion,
  };
}

// ── 慢车道：候选方向 ─────────────────────────────────────────

export interface DirectionStrength {
  item: string;
  support: string;
}
/** 一条可执行动作。三个附加栏是方法论的硬要求 —— 少了它「核心解决方案」就是四条口号。 */
export interface DirectionSolution {
  action: string;
  deliverable: string;
  owner: string;
  goal90: string;
}
export interface DirectionRisk {
  risk: string;
  hedge: string;
}

/**
 * 一个候选方向。**三件套（reasons / strengths / solutions）缺一不可，顺序固定**
 * —— 品牌占位方法论 §1.2 的硬约束，且是这里唯一「缺了看不出来」的东西：
 * 只有定位语和一句话理由的卡片在界面上就是一张正常的选项卡，用户照样能点「就用这个」，
 * 而他实际上是在没有优势清单、没有落地动作、没有代价的情况下定下了后面十一步的地基。
 *
 * `risks` 也是必需的：只说好处的话几个方向读起来个个都成立，「选一个」退化成盲选。
 *
 * `markdown` 是**代码拼的**，不是模型给的（同「计算格式不交给 LLM」那条规矩）：
 * 它就是定稿的正文，交给模型拼的话某一栏漏了标题也不会报错，只是那一节从此消失。
 */
export interface StageDirection {
  title: string;
  /** 定位语：对外说的那一句 */
  tagline: string;
  /** 一句话身份：「我们是 XX 里唯一 YY 的那家」 */
  identity: string;
  reasons: string[];
  strengths: DirectionStrength[];
  solutions: DirectionSolution[];
  risks: DirectionRisk[];
  /**
   * 这个方向下、按**本步输出物清单**逐项成节写出来的正文（`## N. 清单项`）。
   *
   * 没有它的时候，慢车道八个阶段（四问 + 四大成）交出来的定稿正文**结构完全一样** ——
   * 定位语 + 三件套三张表，一个字都不提「定位共识书」「价值金字塔三层」「关系生命周期
   * 四阶段」这些各步真正要交的东西。而 `deliverables` 那份清单在界面上是显示着的，
   * 用户对着它数不出缺了什么：那几张表本身填得满满的，读起来就是一份做完的方案。
   * 快车道早就是按清单成节的（`RULE_BODY_SECTIONS`），慢车道漏掉这件事没有任何报错。
   */
  body: string;
  /** 选了这个方向之后，这一节进正式方案时怎么组织（给内部顾问，不是客户话术）。 */
  writingTip: string;
  /** 选了这个方向之后本步的 AI 赋能机会，1-2 条，只标不展开。见 StageDraft.aiOpportunities。 */
  aiOpportunities: string[];
  markdown: string;
}

const MIN_DIRECTIONS = 2;
const MAX_DIRECTIONS = 4;
/** 三件套各自的下限。低于这个数就是「有栏目没内容」，比缺栏目更难发现。 */
const MIN_REASONS = 2;
const MIN_SOLUTIONS = 2;
/**
 * 每个方向的输出物正文字数区间，**要写进 prompt**。
 *
 * 不给上限的话四个方向各写一份清单正文就是四份完整方案：实测慢车道单次输出已经
 * 1500+ 字，再乘上清单七八项 × 四个方向，输出直接翻到上万字 —— 那条接入点对单次
 * 请求有 ~300 秒的硬上限（`fail()` 里认的那个 nginx 504），撞上去的时候用户等满
 * 五分钟拿到一句「上游网关掐掉了」，而额度已经扣了。
 * 不给下限的话它会把每一节写成一句话，那种正文和真写了的一样有小节标题。
 */
const DIRECTION_BODY_MIN_CHARS = 400;
const DIRECTION_BODY_MAX_CHARS = 900;
/**
 * 低于这个数就当这个方向没写正文，整张丢掉（并点名）。
 *
 * 这道闸是这个切片的重点：模型漏给 `body` 时 `directionToMarkdown` 照样拼得出一张
 * 完整的卡片（三件套都在），用户点「就用这个」就把那份没有清单小节的正文定稿了 ——
 * 而定稿之后这一步是只读的，再也改不回来。
 */
const MIN_DIRECTION_BODY_CHARS = 200;

function directionMessages(
  project: ConsultProject,
  stage: StageDef,
  entries: ConsultEntry[],
  disc: Discussion
) {
  const system = `你是品牌占位系统的资深咨询顾问，正在做「${stage.group}」阶段。
这一步是**做判断**，不是找事实 —— 判断取决于人的取舍，所以你的任务不是给一个答案，
而是给客户 ${MIN_DIRECTIONS}-${MAX_DIRECTIONS} 个**互斥的**候选方向，让他来选。

硬规则：
0. **推导先行**：先依据【分析操法】推导，再输出方向。方向必须是从操法逻辑中推演出的取舍，并在 reasons 第一条说明对应操法的哪一条。
1. **方向互斥**：各方向必须互斥（选 A 必弃 B），没有折中。
2. **三件套必填**：每个方向必须包含 reasons、strengths、solutions。宁缺毋滥。
3. **选择理由 (reasons)**：${MIN_REASONS}-6 条，具说服力，说明对业务/市场的实际意义。
4. **现有优势 (strengths)**：仅限客户**当前已具备**的能力/资源，拒绝空泛形容词或主观推测。每条说明支撑点并标注出处（格式：联网·域名·年份 或 客户资料）。
5. **解决方案 (solutions)**：${MIN_SOLUTIONS}-6 条可执行动作，必须包含交付物 (deliverable)、负责人 (owner) 和 90天目标 (goal90)。
6. **风险对冲 (risks)**：每条风险必须配备对应的对冲策略 (hedge)。
7. **输出物正文 (body)：每个方向各写一份，按【本步定稿后应该产出的东西】那份清单逐项成节**，
   一项一个 \`## N. 清单项名\`（序号和清单一致），一项都不许省，写的是「选了这个方向，这一项就长这样」。
   清单里写了"表格 / 清单 / 矩阵"的必须真的输出 markdown 表格（\`| 列 | 列 |\` 带分隔行）。
   四个方向的这份正文必须**互不相同** —— 同一段话换个说法贴四遍，等于没有取舍。
   资料不支持某一项时那一节照样要在，里面写明缺什么、补什么才能填。
   **每个方向的 body 控制在 ${DIRECTION_BODY_MIN_CHARS}-${DIRECTION_BODY_MAX_CHARS} 字**：这是给客户选方向用的，不是终稿；
   写太长会超时（整次请求有时间上限），选定之后还能在这一步接着聊、接着改。
   不要在 body 里重复 methodBrief / tagline / reasons / strengths / solutions / risks / writingTip 的内容，那几栏已经单独有位置。
8. **身份定义**：tagline（对外 Slogan，<20字，拒用互联网黑话）；identity（"我们是 XX 里唯一 YY 的"句式）。两者互不重复。
9. **方向研判 (verdict)**：不推荐"最优解"，在 verdict 中客观分析各方向的适用场景与组合可能，将取舍权交还客户。
10. **方法论速览 (methodBrief)**：2-3句话总结使用的分析框架，以及各方向是如何从操法推导而来的。
11. **落地与延展**：
    - writingTip：面向内部顾问的方案落笔建议（主论点、缺失证据、需顾问定夺之处）。
12. 仅输出 JSON，禁止任何额外解释文字。

输出格式：
{"methodBrief":"方法论速览：这一步用什么框架 + 这几个方向照操法哪几条推的（2-3 句）","directions":[{"title":"方向名（6-14 字）","tagline":"定位语，对外说的那一句","identity":"一句话身份","reasons":["选择理由 1","选择理由 2"],"strengths":[{"item":"客户现在就有的东西","support":"它具体是什么 / 为什么能支撑这个方向"}],"solutions":[{"action":"关键动作","deliverable":"交付物","owner":"负责人角色","goal90":"90 天目标（带数字或可验证状态）"}],"risks":[{"risk":"代价 / 什么情况下站不住","hedge":"对冲做法"}],"body":"markdown 正文：按本步输出物清单逐项成节（## 1. 清单第一项 …… ## N. 清单第 N 项），清单里要表格的就输出 markdown 表格","writingTip":"选了它之后这一节进方案怎么组织","aiOpportunities":["AI 赋能机会 1","（可选）机会 2"]}],"verdict":"🧭 方向研判：这几个方向怎么选、哪些可以组合、哪个最契合他当前阶段（100-300 字，不替他下死结论）"}`;

  const user = `【品牌 / 客户】${project.brand_name}

【当前这一步】${stage.group} · ${stage.label}
要回答的问题：${stage.question} 

【这一步的分析操法（方法论规定的思考顺序与判断标准，方向要从这里推出来）】
${methodBlock(stage)}

【这一步定稿后应该产出的东西（**每个方向的 body 就照这份清单一项一节写**，序号和顺序不要变）】
${deliverablesBlock(stage)}

【已定稿结论（企业知识库，这是你做判断的依据）】
${knowledgeBlock(entries, bodyKeys(stage))}

【联网资料（L1）】
${sourcesBlock(listSources(project.id))}

【客户资料（L2）】
${project.brief || '（客户还没贴任何资料）'}${discussionSection(disc)}`;

  return [
    { role: 'system' as const, content: system + discussionRule(disc) },
    { role: 'user' as const, content: user },
  ];
}

/** 表格单元格：竖线和换行会把 markdown 表格拆散（那一行往后的列全错位）。 */
function cell(s: string): string {
  return s.replace(/\|/g, '｜').replace(/\s*\n\s*/g, ' ');
}

/**
 * 方向 → 定稿正文（markdown）。**在代码里拼，不让模型拼**（同「计算格式不交给 LLM」那条）。
 *
 * 这段就是用户点「就用这个方向」之后进定稿正文的东西 —— 以前只把 reason/risk 塞进
 * 「取舍理由」、strengths/solution 塞进「依据」，三件套的结构在定稿里就没了，
 * 下游看到的只是一句漂亮的定位表述，没人记得当初的落地动作和放弃了什么。
 */
export function directionToMarkdown(d: StageDirection, methodBrief = ''): string {
  const out: string[] = [
    // 方法论速览排在最前面，且**没给也要留着这一节并说出来**：
    // 少一节的正文读起来完整（下面三件套都在），而顾问从此没法判断这个方向是
    // 照操法推出来的还是听起来不错的说法 —— 而它已经是后面每一步的地基了。
    '## 0. 方法论速览',
    '',
    methodBrief.trim() ||
      '（这一轮模型没给方法论速览 —— 没法判断下面这个方向是照操法推的还是套出来的。要么重出一轮，要么自己补一句。）',
    '',
    `> **定位语：${d.tagline}**`,
    `> 一句话身份：${d.identity}`,
    '',
    '**🎯 选择理由**',
    '',
    ...d.reasons.map((r, i) => `${i + 1}. ${r}`),
    '',
    '**✅ 客户现有优势**',
    '',
    '| 优势 | 对应支撑 |',
    '| --- | --- |',
    ...d.strengths.map((s) => `| ${cell(s.item)} | ${cell(s.support)} |`),
    '',
    '**🔧 核心解决方案**',
    '',
    '| 关键动作 | 交付物 | 负责人 | 90 天目标 |',
    '| --- | --- | --- | --- |',
    ...d.solutions.map(
      (s) => `| ${cell(s.action)} | ${cell(s.deliverable)} | ${cell(s.owner)} | ${cell(s.goal90)} |`
    ),
  ];
  if (d.risks.length) {
    out.push('', '**⚠️ 风险与对冲**', '', '| 风险 | 对冲 |', '| --- | --- |');
    out.push(...d.risks.map((r) => `| ${cell(r.risk)} | ${cell(r.hedge)} |`));
  }
  // 输出物清单那几节接在三件套后面：三件套是「为什么选它」，这一段才是「选了它这一步
  // 交出来的东西长什么样」。排在后面是因为卡片要能横着比 —— 一上来八百字的正文，
  // 四张卡片在屏幕上就没法对比了，而「选一个」正是这一步的全部意义。
  // 模型没给（或者只给了一句话）的方向压根走不到这里，见 missingPieces。
  if (d.body.trim()) out.push('', d.body.trim());
  if (d.writingTip) out.push('', '## 写作建议', '', d.writingTip);
  return out.join('\n');
}

/** 这个方向缺了三件套里的哪几件（空数组 = 齐了）。 */
function missingPieces(d: StageDirection): string[] {
  const miss: string[] = [];
  if (!d.tagline) miss.push('定位语');
  if (d.reasons.length < MIN_REASONS) miss.push('选择理由');
  if (!d.strengths.length) miss.push('现有优势');
  if (d.solutions.length < MIN_SOLUTIONS) miss.push('核心解决方案');
  // 动作齐了但三个附加栏全空 = 一串口号。有一条写全了就放行（部分缺失在表格里看得见）
  else if (!d.solutions.some((s) => s.deliverable || s.owner || s.goal90)) {
    miss.push('解决方案的交付物 / 负责人 / 90 天目标');
  }
  if (!d.risks.length) miss.push('代价与对冲');
  // 输出物正文（见 StageDirection.body）：缺了它这张卡片照样是完整的一张卡片，
  // 用户定稿之后这一步就只读了 —— 那份没有清单小节的正文再也补不回来。
  if (d.body.trim().length < MIN_DIRECTION_BODY_CHARS) miss.push('输出物清单正文');
  return miss;
}

/**
 * 出候选方向。同样**不落库** —— 落库的是用户选定并改过的那一条（定稿）。
 *
 * 少于 2 个方向直接抛错：一个方向在界面上和「AI 就是这么建议的」无法区分，
 * 用户会直接采纳，而这一步本来的意义就是让他做取舍。
 */
export async function draftDirections(
  userId: string,
  project: ConsultProject,
  stageKey: string
): Promise<{
  directions: StageDirection[];
  verdict: string;
  methodBrief: string;
  truncated: boolean;
  discussion: Discussion;
}> {
  const { stage, entries } = requireOpenStage(project.id, stageKey, { lanes: ['slow'] });

  const discussion = discussionBlock(project.id, stageKey);
  const { parsed, raw, finish, reasoningTokens } = await jsonGateway<any>(
    () => ({
      messages: directionMessages(project, stage, entries, discussion),
      ...SAMPLING.analytic,
      max_tokens: MAX_TOKENS_DIRECTIONS,
      response_format: { type: 'json_object' },
    }),
    {
      userId,
      source: 'consult',
      operation: `directions:${stage.key}`,
      tier: 'strong',
      requestSummary: `${project.brand_name} · ${stage.label}`,
      timeoutMs: AI_TIMEOUT_MS,
      maxRetries: 0,
      noThinking: true, // 同上
    }
  );

  if (!parsed) {
    throw new StageError(
      gateFailMessage('方向', { raw, finish, reasoningTokens, budget: MAX_TOKENS_DIRECTIONS }),
      502
    );
  }

  const str = (v: unknown) => String(v ?? '').trim();
  const arr = (v: unknown) => (Array.isArray(v) ? v : []);

  const raws: StageDirection[] = arr(parsed.directions)
    .map((d: any) => ({
      title: str(d?.title),
      tagline: str(d?.tagline),
      identity: str(d?.identity),
      reasons: arr(d?.reasons).map(str).filter(Boolean).slice(0, 8),
      strengths: arr(d?.strengths)
        .map((s: any) => ({ item: str(s?.item), support: str(s?.support) }))
        .filter((s: DirectionStrength) => s.item)
        .slice(0, 10),
      solutions: arr(d?.solutions)
        .map((s: any) => ({
          action: str(s?.action),
          deliverable: str(s?.deliverable),
          owner: str(s?.owner),
          goal90: str(s?.goal90),
        }))
        .filter((s: DirectionSolution) => s.action)
        .slice(0, 8),
      risks: arr(d?.risks)
        .map((r: any) => ({ risk: str(r?.risk), hedge: str(r?.hedge) }))
        .filter((r: DirectionRisk) => r.risk)
        .slice(0, 8),
      // body 不 trim 掉内部换行、也不做长度截断：它是 markdown（小节标题和表格分隔行
      // 全靠换行），截一刀最可能砍掉的是最后那张表的后半截，而缺半张表的正文读起来
      // 是完整的。超长由 prompt 里的字数区间管，真超了就让它显示出来。
      body: str(d?.body),
      writingTip: str(d?.writingTip),
      aiOpportunities: parseAiOpportunities(d?.aiOpportunities),
      markdown: '',
    }))
    .filter((d: StageDirection) => d.title)
    .slice(0, MAX_DIRECTIONS);

  // 三件套缺件的方向整张丢掉，而不是显示成一张缺几栏的卡：
  // 缺栏的卡在界面上就是一张正常的选项卡，用户照样点「就用这个」，
  // 然后在没有优势清单、没有落地动作的情况下定下了后面十一步的地基。
  const methodBrief = str(parsed.methodBrief);
  const rejected: string[] = [];
  const list = raws.filter((d) => {
    const miss = missingPieces(d);
    if (miss.length) {
      rejected.push(`${d.title || '未命名方向'}（缺${miss.join('、')}）`);
      return false;
    }
    d.markdown = directionToMarkdown(d, methodBrief);
    return true;
  });

  if (list.length < MIN_DIRECTIONS) {
    const tail = finish === 'length' ? '（模型返回被截断了）' : '';
    // 被丢掉的那些必须点名：不说的话「只出了 1 个方向」看起来像模型想不出来，
    // 而实际原因是它写了三个骨架 —— 用户会一直重试同一件事。
    const why = rejected.length ? `\n丢掉了：${rejected.join('；')}` : '';
    throw new StageError(
      `这次只出了 ${list.length} 个完整方向${tail}，不够拿来做选择。再试一次，或者先把客户资料补厚一点${why}`,
      502
    );
  }

  return {
    directions: list,
    verdict: str(parsed.verdict),
    methodBrief,
    truncated: finish === 'length',
    // 这一批方向带没带上他刚聊的那几句 —— 带上和没带上出来的卡片读起来一模一样
    discussion,
  };
}
