import { jsonGateway } from '../../core/llm/parseJson.js';
import { SAMPLING } from '../../core/llm/gateway.js';
import { STAGES, stageByKey, unlockState, LANE_LABEL, type StageDef } from './stages.js';
import { listEntries, type ConsultProject, type ConsultEntry } from './projectStore.js';
import { listSources, sourcesBlock } from './sourceStore.js';

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
 */
const MAX_TOKENS_DRAFT = 24000;
/** 4 个方向 × 六栏是这个模块最长的正文（实测 1500+），再叠思维链的方差。 */
const MAX_TOKENS_DIRECTIONS = 16000;

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
 * 模型没给出能用的 JSON 时的报错文案。
 *
 * 思维链 token 数**必须**带上：额度全花在 reasoning 上时 content 是空的，
 * 表面症状是「AI 什么都没回」，用户会去怀疑自己的资料写得不好，
 * 或者一路调高 max_tokens —— 而真正的解法是换一个不带思维链的模型。
 */
function gateFailMessage(
  what: string,
  info: { raw: string; finish?: string; reasoningTokens?: number; budget: number }
): string {
  const { raw, finish, reasoningTokens, budget } = info;
  const burnedByThinking = reasoningTokens && reasoningTokens >= budget * 0.9;
  const cot = reasoningTokens ? `，其中思维链占 ${reasoningTokens} token` : '';
  const why = !raw.trim()
    ? `模型没有返回内容（finish_reason=${finish || '未知'}${cot}）`
    : finish === 'length'
      ? `模型返回被截断（finish_reason=length${cot}）`
      : '模型没有按 JSON 格式返回';
  const how = burnedByThinking
    ? `这次 ${budget} token 的额度基本全花在思维链上了，正文没写出来。再点一次通常就好；老是这样就去「专属 AI / 系统配置」把 strong 档换成不带思维链的模型`
    : '再试一次或换个模型';
  return `${why}，${what}没生成。${how}（这次的 AI 额度已经扣了）`;
}

/**
 * 知识库块：按阶段顺序拼已定稿结论，作为这一步的依据。
 *
 * **只有直接依赖（`stage.requires`）带正文，其余只带一句话总结。** 十二个阶段的正文
 * 全带上的话，做到「品牌屋」那一步 prompt 已经被几万字的表格占满，客户资料被挤到
 * 最后面 —— 表现不是报错，是模型开始照自己的常识写，回来的东西格式完整、内容和这家
 * 企业无关。带哪几节由调用方按 requires 传，不在这里猜。
 */
function knowledgeBlock(entries: ConsultEntry[], fullBodyFor: string[] = []): string {
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

/** 输出物清单进 prompt 的那一段。序号必须写出来 —— 用户界面上照同一个序号数缺了哪一项。 */
function deliverablesBlock(stage: StageDef): string {
  return stage.deliverables.map((d, i) => `${i + 1}. ${d}`).join('\n');
}

/**
 * 分析操法进 prompt 的那一段（`stage.method`，方法论各模块的推导顺序与判断标准）。
 *
 * 两条 prompt 都要带：只给输出物清单的话模型会**把表格填满但推导是自己编的** ——
 * 价值主张三层都在却没做过三问检验、没判过卡在哪一层；竞品每家写的维度还不一样。
 * 这种正文和照方法论推出来的在界面上没有区别，顾问会直接拿去用。
 */
function methodBlock(stage: StageDef): string {
  return stage.method.map((m, i) => `${i + 1}) ${m}`).join('\n');
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
   - 开头 \`## 0. 方法论速览\`：2-3 句说清这一步用的是什么框架，以及**这一次实际是照操法哪几条推的**。
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

const DRAFT_JSON_FORMAT = `{"conclusion":"一句话总结","body":"markdown 正文：## 0. 方法论速览 + 按输出物清单逐项成节 + ## 写作建议","rationale":"为什么这么判断（取舍理由，含关键判断出自操法第几条）","evidence":"依据来自资料里的哪几句/哪些数字","confidence":"high|mid|low","aiOpportunities":["本步的 AI 赋能机会 1","（可选）机会 2"],"gaps":["资料里缺的东西，客户补上能提高置信度"]}`;

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

function buildMessages(project: ConsultProject, stage: StageDef, entries: ConsultEntry[]) {
  const system = stage.lane === 'plan' ? planSystem(stage) : fastSystem();

  const user = `【品牌 / 客户】${project.brand_name}

【当前这一步】${stage.group} · ${stage.label}
要回答的问题：${stage.question}

【这一步的分析操法（方法论规定的思考顺序与判断标准，照它推，不许跳步）】
${methodBlock(stage)}

【本步必须产出的东西（body 就照这个清单一项一节写，顺序不要变）】
${deliverablesBlock(stage)}

【已定稿结论（企业知识库）】
${knowledgeBlock(entries, stage.requires)}

【联网资料（L1）】
${sourcesBlock(listSources(project.id))}

【客户资料（L2）】
${project.brief || '（客户还没贴任何资料）'}`;

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
): Promise<{ draft: StageDraft; truncated: boolean }> {
  // fast 和 plan 共用这条接口（都是「出一份草稿 → 用户改 → 定稿」），system prompt 按车道分。
  const { stage, entries } = requireStage(project.id, stageKey, { lanes: ['fast', 'plan'] });
  // plan 不拦空资料：它的依据是上游那十二条定稿，而那些已经解锁校验过了。
  // fast 必须拦 —— 四看的结论全部来自这段资料，空着的话模型只能编，而编出来的读着一样。
  if (stage.lane === 'fast' && !project.brief.trim()) {
    throw new StageError('先在下面贴一段客户资料 —— 快车道的结论全部来自这段资料，空着的话 AI 只能靠编', 400);
  }

  const { parsed, raw, finish, reasoningTokens } = await jsonGateway<any>(
    () => ({
      messages: buildMessages(project, stage, entries),
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

function directionMessages(project: ConsultProject, stage: StageDef, entries: ConsultEntry[]) {
  const system = `你是品牌占位系统的资深咨询顾问，正在做「${stage.group}」阶段。
这一步是**做判断**，不是找事实 —— 判断取决于人的取舍，所以你的任务不是给一个答案，
而是给客户 ${MIN_DIRECTIONS}-${MAX_DIRECTIONS} 个**互斥的**候选方向，让他来选。

硬规则：
0. **先照【这一步的分析操法】把方法论的推导走完，再拟方向。** 方向必须是从操法里推出来的取舍
   （例如价值主张的几个方向要落在金字塔的不同层上、用户关系的方向要对应生命周期卡住的那一段），
   不是几个听起来不一样的说法。跳过操法拟出来的方向在卡片上和推出来的一模一样，
   而客户会照着它定下后面每一步的地基。每个方向的 reasons 第一条要说清它对应操法里的哪一条判断。
1. 方向之间必须互斥：选了 A 就等于放弃 B。几个方向能同时成立的话，客户选哪个都一样，这一步就白做了。
2. **三件套缺一不可**：🎯 选择理由（reasons）/ ✅ 客户现有优势（strengths）/ 🔧 核心解决方案（solutions）。
   只有定位语和一句理由的方向，客户照样会点「就用这个」，然后在没有优势、没有落地动作的情况下
   定下后面每一步的地基 —— 所以宁可少给一个方向，也不要给一个只有骨架的方向。
3. reasons 给 ${MIN_REASONS}-6 条，每条要能拿去说服老板：为什么是这个方向、对他现在的业务/品牌/市场意味着什么。
4. strengths 只能写客户**现在手上就有**的东西（资源/能力/资产/团队/数据/用户规模/合作方），
   每条配一句"对应支撑"说明它具体是什么，并标出出处：【联网资料】里对上的标「（联网·域名·年份）」，
   【客户资料】里对上的标「（客户资料）」。**不许写"有一定基础""较为完善"这类形容词，也不许把靠常识
   推出来的东西写成他手上有的** —— 一条不存在的优势会让整个方向的落地动作全部落空，而卡片上看不出来。
   写不出具体内容就不要列这一条。需要先补能力才成立的，写进 solutions。
5. solutions 给 ${MIN_SOLUTIONS}-6 条可执行动作，每条**必须**配 deliverable（交付物）/ owner（负责人角色）/
   goal90（90 天目标，带可验证的数字或状态）。没有这三样的动作就是口号，客户看不出这条到底谁在什么时候做完什么。
6. risks 每条配 hedge（对冲做法）：只说好处的方向没法比较，而客户会以为这个方向没有代价。
7. tagline 是对外说的那一句（不超过 20 字，不要"赋能/抓手/闭环/赛道/心智"这类词）；
   identity 是一句话身份（「我们是 XX 里唯一 YY 的那家」的句式）。两句不许互相复述。
8. 不要推荐"最优"方向，也不要给第 ${MAX_DIRECTIONS + 1} 个折中方向 —— 折中方向会把互斥性抹掉。
   把"怎么选、哪些可组合、哪个最契合当前阶段"写进 verdict（🧭 方向研判），取舍权留给客户。
9. **methodBrief（方法论速览）必须给**：2-3 句说清这一步用的是什么框架，以及**这一轮的几个方向
   实际是照操法哪几条推出来的**。顾问对着这一节才能判断这几个方向是推出来的还是拍出来的 ——
   缺了它，两者在卡片上没有区别，而选中的那个会变成后面每一步的地基。
10. 每个方向还要给两样东西：
   - writingTip（写作建议）：选了它之后这一节进正式方案怎么组织（用哪张图/表、哪句是主论点、
     还缺什么证据、哪里留给顾问自己拍）。这是给内部顾问的，不是客户话术。
   - aiOpportunities：选了它之后**本步视角下的** AI 赋能机会 1-2 条，**只标不展开**
     （一条一句，说清用 AI 做什么、替代掉现在的哪个动作）。它们最后要汇成方案里独立的一章
     「AI 转型机会清单」—— 这一步不标的话那一章就少一个模块，而那一章读起来照样是完整的清单。
     写不出真有关系的就给一条，不要凑数写「用 AI 提升效率」这种。
11. 只输出 JSON，不要任何解释文字。

输出格式：
{"methodBrief":"方法论速览：这一步用什么框架 + 这几个方向照操法哪几条推的（2-3 句）","directions":[{"title":"方向名（6-14 字）","tagline":"定位语，对外说的那一句","identity":"一句话身份","reasons":["选择理由 1","选择理由 2"],"strengths":[{"item":"客户现在就有的东西","support":"它具体是什么 / 为什么能支撑这个方向"}],"solutions":[{"action":"关键动作","deliverable":"交付物","owner":"负责人角色","goal90":"90 天目标（带数字或可验证状态）"}],"risks":[{"risk":"代价 / 什么情况下站不住","hedge":"对冲做法"}],"writingTip":"选了它之后这一节进方案怎么组织","aiOpportunities":["AI 赋能机会 1","（可选）机会 2"]}],"verdict":"🧭 方向研判：这几个方向怎么选、哪些可以组合、哪个最契合他当前阶段（100-300 字，不替他下死结论）"}`;

  const user = `【品牌 / 客户】${project.brand_name}

【当前这一步】${stage.group} · ${stage.label}
要回答的问题：${stage.question}

【这一步的分析操法（方法论规定的思考顺序与判断标准，方向要从这里推出来）】
${methodBlock(stage)}

【这一步定稿后应该产出的东西（选定方向之后要能撑起这些，出方向时就要往这个方向想）】
${deliverablesBlock(stage)}

【已定稿结论（企业知识库，这是你做判断的依据）】
${knowledgeBlock(entries, stage.requires)}

【联网资料（L1）】
${sourcesBlock(listSources(project.id))}

【客户资料（L2）】
${project.brief || '（客户还没贴任何资料）'}`;

  return [
    { role: 'system' as const, content: system },
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
): Promise<{ directions: StageDirection[]; verdict: string; methodBrief: string; truncated: boolean }> {
  const { stage, entries } = requireStage(project.id, stageKey, { lanes: ['slow'] });

  const { parsed, raw, finish, reasoningTokens } = await jsonGateway<any>(
    () => ({
      messages: directionMessages(project, stage, entries),
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
  };
}
