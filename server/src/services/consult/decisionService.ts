import { jsonGateway, jsonFailMessage } from '../../core/llm/parseJson.js';
import { SAMPLING } from '../../core/llm/gateway.js';
import type { StageDef } from './stages.js';
import { listSources, sourcesBlock } from './sourceStore.js';
import { listMessages, type ConsultProject, type ConsultEntry } from './projectStore.js';
import {
  StageError,
  requireOpenStage,
  knowledgeBlock,
  bodyKeys,
  deliverablesBlock,
  methodBlock,
  discussionBlock,
  type Discussion,
} from './draftService.js';

// 慢车道「先定方向」（岔路口）。这一步跑在出正文**之前**：这一步的操法里有几个位置
// 资料和上游定稿支撑不到唯一答案（竞品挑哪几家、画像分几类、定位取哪个角色），
// 模型自己替顾问选了也能写出一份读起来完全完整的方案 —— 而那份方案的地基是它替他选的，
// 事后从正文里看不出是哪一处选错的（每一节都在、表格也满）。
//
// 它和慢车道原来那条「出 2-4 份完整方向再挑一份」的差别不是省 token：那条路上四份正文
// 各自都通顺，用户实际是在读四份写好的东西里挑文笔，而取舍点埋在正文里没被单独问过。

/** 一个选项。`cost` 是硬要求 —— 见 {@link MIN_OPTIONS} 上面那段。 */
export interface DecisionOption {
  /** 短标题（12 字内），卡片上那个按钮的字 */
  label: string;
  /** 这条路具体是什么（1-2 句，要带这家企业自己的业务/客户/对手） */
  detail: string;
  /** 选它就放弃什么 / 代价是什么 */
  cost: string;
}

export interface DecisionPoint {
  /** d1..dN，代码生成（模型给的 id 会重复，界面上两张卡片同一个键，选了一张另一张跟着变） */
  id: string;
  /** 这个岔路口要定的是什么（一句疑问句） */
  question: string;
  /** 对应操法第几条。原样显示 —— 顾问对着操法数得出来这个岔路口是不是编的 */
  methodRef: string;
  /** 依据：为什么这几个都说得通（出自哪一步定稿 / 客户资料里哪句话） */
  basis: string;
  options: DecisionOption[];
  /** 顾问视角的建议（可空）。它不替他定，只是省掉他从零判断 */
  recommend: string;
}

export interface DecisionSheet {
  points: DecisionPoint[];
  /**
   * 模型认为这一步没有需要顾问拍板的取舍时的说明（此时 `points` 为空）。
   * **它和「模型没回东西」必须分得开**：空卡片在界面上就是「这一步不用你定」，
   * 而那正是这条路要防的事 —— 所以两个都空时直接抛错，见下面的校验。
   */
  noFork: string;
  /** 不是岔路口、而是缺事实的那些（要去问客户，走补料问卷），不做成选项 */
  missing: string[];
  /**
   * 被丢掉的岔路口 + 原因。**必须回显**：少一个岔路口的卡片在界面上和
   * 「这一步只有两处要定」一模一样，而丢掉的那个位置最后是模型自己替他定的。
   */
  dropped: string[];
  truncated: boolean;
  discussion: Discussion;
}

/**
 * 一次最多几个岔路口。这不是排版：每多一个都是顾问要停下来做的一次判断，
 * 凑数的那几个会让他草草点过全部 —— 而草草点过和认真选过在后面那份正文里没有区别。
 */
const MAX_POINTS = 4;
/**
 * 一个岔路口至少 2 个选项、最多 3 个。少于 2 个的**丢掉整条**（不像问卷那样降级）：
 * 一个选项的「岔路口」是通知，不是选择，摆在卡片上会被点掉，
 * 于是那处取舍看起来是他定的。丢掉必须计入 `dropped` 并显示出来。
 */
const MIN_OPTIONS = 2;
const MAX_OPTIONS = 3;
/**
 * 输出很短（几个岔路口 × 三个选项 × 一两句话），这个数是留给思维链的空间（硬规则 2），
 * 不是正文长度 —— 调小只会把偶发的长思维链变成确定性的「解析失败」。
 */
const MAX_TOKENS_DECISIONS = 8000;
/**
 * 一次给足、不重试（同 intakeService）。默认 120 秒 + 重试一次 = 顾问等满 240 秒
 * 拿一句失败，而两次断在同一个地方（同样的资料、同样的思维链），额度扣两遍。
 */
const AI_TIMEOUT_MS = 180_000;

function buildMessages(
  project: ConsultProject,
  stage: StageDef,
  entries: ConsultEntry[],
  disc: Discussion
) {
  const system = `你是品牌占位系统的资深咨询顾问。现在**不要**做分析、**不要**写方案正文 ——
「${stage.group} · ${stage.label}」这一步在正式动笔之前，先要把「必须由顾问（或他的客户）拍板的取舍」问清楚。

为什么先问：这一步的操法里有几个位置，现有资料和上游定稿**支撑不到唯一答案**。
你替他定了也能写出一份读起来完全完整的方案，而那份方案的地基是你替他选的 ——
他事后翻正文看不出是哪一处选错的（每一节都在、表格也满）。

硬规则：
1. 岔路口**只能来自【这一步的分析操法】**，每一条写出对应操法第几条（\`methodRef\`，例：\`操法 2\`）。
   操法里没有的取舍不要造 —— 造出来的岔路口和真的一模一样，而他为它做的选择会被写进正文。
2. **只问「按现有资料，有两三个都说得通」的地方。** 上游定稿已经定死的、客户资料里写明的，
   一律不许再问：那不是岔路口，是你没读资料，而他一旦选了个跟已定稿冲突的答案，两份都读得通。
   \`basis\` 必须写出依据出自哪里（哪一步的定稿 / 客户资料里的哪句话），以及为什么这几个都说得通。
   \`basis\` 和 \`question\` 里**不要出现「操法」这个词**（顾问界面上没有这个词，那份清单在他那边叫
   「该怎么想」）—— 写成「「该怎么想」第 2 条要求…」或者直接把那一条的要求说出来。
   用一个他在屏幕上找不到的词做依据，等于这条依据没法核，而它读起来很有出处。
3. **缺事实的不做成岔路口**，放进 \`missing\`（那要去问客户，另有补料问卷）。
   做成选项等于让他猜一个数字/名单，而猜出来的会以「他定的」身份进正文。
4. 每个岔路口 ${MIN_OPTIONS}-${MAX_OPTIONS} 个选项，**每个选项都要写 \`cost\`（选它就放弃什么）**。
   三个没有代价的选项 = 三个都挺好，他随便点一个 —— 那就等于你替他定了。
5. 选项必须**具体到这家企业**（写出它自己的业务、客户、对手的名字）。
   放到任何品牌上都成立的选项（「走高端 / 走性价比」）是这里最容易犯的错，
   而它读起来最像专业选项。
6. 最多 ${MAX_POINTS} 个，按「选错代价最大」排在最前，不要凑数。
7. **这一步真的没有要他拍板的取舍时，\`points\` 给空数组**，在 \`noFork\` 里说清为什么
   （资料和上游把答案定死了）。硬凑一个假岔路口比不问更糟。
8. \`recommend\` 给你的建议加一句理由（可以留空），但不要替他定。

只输出 JSON，不要任何解释文字：
{
  "points": [
    {
      "methodRef": "操法 2",
      "question": "这一步要定的是什么（一句疑问句）",
      "basis": "依据出自哪一步定稿/资料里哪句话，为什么这几个都说得通",
      "options": [
        { "label": "12 字内的选项名", "detail": "这条路具体是什么（1-2 句，带这家企业的具体业务）", "cost": "选它就放弃什么" }
      ],
      "recommend": "建议哪个 + 一句理由"
    }
  ],
  "noFork": "",
  "missing": ["还缺的事实，要去问客户的"]
}`;

  const user = `【品牌 / 客户】${project.brand_name}

【当前这一步】${stage.group} · ${stage.label}
要回答的问题：${stage.question}

【这一步的分析操法（岔路口只能从这里来，并写出第几条。顾问界面上这份清单叫「该怎么想」）】
${methodBlock(stage)}

【这一步最后要产出的东西（只用来判断哪些取舍会影响它，现在**不要**写这些）】
${deliverablesBlock(stage)}

【已定稿结论（企业知识库 —— 这里已经定了的不许再问）】
${knowledgeBlock(entries, bodyKeys(stage))}

【联网资料（L1）】
${sourcesBlock(listSources(project.id))}

【客户资料（L2）】
${project.brief || '（客户还没贴任何资料）'}${
    disc.used
      ? `\n\n【本步已经聊过的（顾问在这一步交代过的，最近 ${disc.used} 条${
          disc.dropped ? `，更早的 ${disc.dropped} 条没带上，别假设你知道全部经过` : ''
        }）】\n${disc.text}\n他在这里已经明确排除掉的选择**不要再摆成选项** —— 摆上去他会以为你没听见，而他重选一次的代价是整份正文。`
      : ''
  }`;

  return [
    { role: 'system' as const, content: system },
    { role: 'user' as const, content: user },
  ];
}

/**
 * 出这一步的岔路口清单。**不落库**（路由把它作为一条 `kind='decisions'` 的对话记录存下来，
 * 刷新靠那条恢复）。
 *
 * 空清单不许静默返回：`points` 空而 `noFork` 也空的时候，界面上那张空卡片读起来就是
 * 「这一步没有要你定的东西，直接出正文吧」—— 而这条路存在的全部理由就是别让模型
 * 悄悄替他定。所以这种情况抛错，并把成因（空返回 / 截断 / 没按 JSON）说出来。
 */
export async function buildDecisions(
  userId: string,
  project: ConsultProject,
  stageKey: string
): Promise<DecisionSheet> {
  // 只有慢车道走这条：快车道是「梳理资料里已有的事实」，没有取舍可拍板，
  // 硬摆几个岔路口出来只会让顾问替资料做决定；plan 那两层的依据是十二条定稿，同理。
  const { stage, entries } = requireOpenStage(project.id, stageKey, { lanes: ['slow'] });

  const discussion = discussionBlock(project.id, stageKey);
  const { parsed, raw, finish, reasoningTokens, noThinkingRequested } = await jsonGateway<any>(
    () => ({
      messages: buildMessages(project, stage, entries, discussion),
      ...SAMPLING.analytic,
      max_tokens: MAX_TOKENS_DECISIONS,
      response_format: { type: 'json_object' },
    }),
    {
      userId,
      source: 'consult',
      operation: `decisions:${stage.key}`,
      tier: 'strong',
      requestSummary: `${project.brand_name} · ${stage.label} · 先定方向`,
      timeoutMs: AI_TIMEOUT_MS,
      maxRetries: 0,
      // 有人在屏幕前等着这一屏才能往下走，而耗时几乎全花在没人看得见的那段思考上
      // （见 GatewayOptions.noThinking：36.6 秒 → 3.5 秒）。
      noThinking: true,
    }
  );

  if (!parsed) {
    throw new StageError(
      jsonFailMessage('待定方向', { raw, finish, reasoningTokens, noThinkingRequested, budget: MAX_TOKENS_DECISIONS }),
      502
    );
  }

  const rawPoints = Array.isArray(parsed.points) ? parsed.points : [];
  const points: DecisionPoint[] = [];
  const dropped: string[] = [];

  for (const p of rawPoints) {
    const question = String(p?.question || '').trim();
    if (!question) continue;
    if (points.length >= MAX_POINTS) {
      dropped.push(`「${question}」——超过 ${MAX_POINTS} 个的没要`);
      continue;
    }
    const basis = String(p?.basis || '').trim();
    // 没有依据的岔路口就是编的：卡片上它和真的一模一样，而他为它做的选择会进正文。
    if (!basis) {
      dropped.push(`「${question}」——模型没说依据出自哪里，丢掉了（没有依据的取舍多半是编的）`);
      continue;
    }
    const seen = new Set<string>();
    const options: DecisionOption[] = [];
    for (const o of Array.isArray(p?.options) ? p.options : []) {
      const label = String(o?.label || '').trim();
      const cost = String(o?.cost || '').trim();
      // 没有代价的选项摆上去 = 三个都挺好，他随便点一个，那处取舍等于模型定的
      if (!label || !cost || seen.has(label)) continue;
      seen.add(label);
      options.push({ label, detail: String(o?.detail || '').trim(), cost });
      if (options.length >= MAX_OPTIONS) break;
    }
    if (options.length < MIN_OPTIONS) {
      dropped.push(`「${question}」——凑不出 ${MIN_OPTIONS} 个带代价的选项，丢掉了`);
      continue;
    }
    points.push({
      id: `d${points.length + 1}`,
      question,
      methodRef: String(p?.methodRef || '').trim(),
      basis,
      options,
      recommend: String(p?.recommend || '').trim(),
    });
  }

  const noFork = String(parsed.noFork || '').trim();
  if (!points.length) {
    // 模型给了几个但全被上面的校验丢掉了 —— 这不是「没有岔路口」，得说清楚
    if (rawPoints.length) {
      throw new StageError(
        `模型给的 ${rawPoints.length} 个待定方向全都不能用（${dropped.join('；') || '缺依据或选项'}），` +
          `这一屏没生成 —— 这**不代表**这一步没有要你拍板的取舍。再点一次（这次的 AI 额度已经扣了）。`,
        502
      );
    }
    if (!noFork) {
      throw new StageError(
        `模型既没给待定方向、也没说这一步为什么不用定` +
          `（finish_reason=${finish || '未知'}${reasoningTokens ? `，思维链占 ${reasoningTokens} token` : ''}）—— ` +
          `一屏空白读起来就是「这一步不用你定」，所以这里不返回。再点一次（这次的 AI 额度已经扣了）。`,
        502
      );
    }
  }

  return {
    points,
    noFork,
    missing: Array.isArray(parsed.missing)
      ? parsed.missing.map((m: unknown) => String(m).trim()).filter(Boolean).slice(0, 8)
      : [],
    dropped,
    truncated: finish === 'length',
    discussion,
  };
}

// ── 拍板：把选择存下来，它就是出正文时的地基 ─────────────────

/**
 * 一处岔路口上他定的答案。**问题、选项、代价全部原样存下来**，不只存一个 id：
 * 那份 `decisions` 清单是模型每次重出都会变的（`d1..dN` 按顺序生成），只存
 * `{id, label}` 的话，重出一版之后同一个 `d2` 指的是另一个问题 —— 而「问题 A 配
 * 答案 B」的记录在对话里、在正文的方法论速览里读起来都完全正常。
 */
export interface DecisionPick {
  id: string;
  question: string;
  methodRef: string;
  label: string;
  detail: string;
  /** 选它放弃的东西。要跟着进正文 —— 不带的话正文只会讲选中那条路的好处，
   *  而「放弃了什么」正是这一步唯一不可逆的信息（定稿之后这一步只读）。 */
  cost: string;
  /** 顾问自己补的一句（可空）：「选 B，但别提加盟商」这类 */
  note: string;
}

export interface DecidedSheet {
  picks: DecisionPick[];
  /** 「这一步没有取舍」那种（此时 picks 为空，原样带过来给正文的方法论速览用） */
  noFork: string;
  /** 这批选择对的是哪一条 `kind='decisions'` 消息。见 `decidedBlock` 的 restaked 判断 */
  sheetMessageId: string;
}

/** 一条补充说明最长多少字。超了**拒绝而不是截断**：被截掉的正是他刚写的那句要求。 */
const MAX_NOTE_CHARS = 300;

export interface PickInput {
  id?: unknown;
  label?: unknown;
  note?: unknown;
}

/**
 * 把顾问在那几处岔路口上的选择校验成一份 `DecidedSheet`。**不落库**（路由把它作为一条
 * `kind='decided'` 的对话记录存下来，出正文时从那条读）。
 *
 * 三道闸各挡一种「读起来完全正常」的失败：
 * - **必须对着最后那一版岔路口清单拍板**（`sheetMessageId`）。清单里的 id 是按顺序生成的，
 *   他重出一版之后 `d2` 已经是另一个问题 —— 拿旧的选择配新的清单，存下来的是
 *   「问题 A + 答案 B」，而它在对话里、在正文里都读得通。
 * - **每一处都要有答案。** 留空的那几处会由模型在写正文时自己定，而正文里看不出
 *   哪一节的地基是它自己填的 —— 这条路存在的全部理由就是别让它替他定。
 * - **答案只能是那几个选项之一。** 自由发挥的答案配不上任何 `cost`，进正文之后
 *   「放弃了什么」那一段就是模型编的；要补充就写进 `note`。
 */
export function applyDecisions(
  projectId: string,
  stageKey: string,
  sheetMessageId: string,
  raw: PickInput[]
): DecidedSheet {
  // 同 buildDecisions：慢车道、且这一步还没定稿（定稿之后是只读的）
  requireOpenStage(projectId, stageKey, { lanes: ['slow'] });

  const msgs = listMessages(projectId, stageKey);
  const last = [...msgs].reverse().find((m) => m.kind === 'decisions');
  if (!last) {
    throw new StageError(
      // 话术里的按钮名必须和界面上那个字对得上：叫一个界面上不存在的按钮，
      // 用户会以为功能没做出来（而他要点的就是那个「开始分析」）。
      '这一步还没有出过待定方向，没什么可拍板的 —— 先点「开始分析」。',
      400
    );
  }
  if (!sheetMessageId || sheetMessageId !== last.id) {
    throw new StageError(
      `这几个选择对的不是最新那一版待定方向 —— 你后来又出过一版（问题和顺序都变了），` +
        `照旧存下来的话会把答案配到别的问题上，而那条记录读起来完全正常。请照右栏现在这一版重新选一遍。`,
      409
    );
  }

  let sheet: DecisionSheet;
  try {
    sheet = JSON.parse(last.payload || '{}') as DecisionSheet;
  } catch {
    throw new StageError('那一版待定方向的记录读不出来了 —— 点一次「重新分析这一步」。', 500);
  }
  const points = Array.isArray(sheet.points) ? sheet.points : [];

  // 「这一步没有取舍」那种：照样要留一条 decided 记录（出正文那条路要求它存在），
  // 但没有选择可提。他不同意的话在对话里说清再重出一版，不在这里凑一个假选择。
  if (!points.length) {
    const noFork = String(sheet.noFork || '').trim();
    if (!noFork) {
      throw new StageError('那一版待定方向是空的，没法拍板 —— 点一次「重新分析这一步」。', 400);
    }
    return { picks: [], noFork, sheetMessageId: last.id };
  }

  const byId = new Map((Array.isArray(raw) ? raw : []).map((p) => [String(p?.id ?? ''), p]));
  const picks: DecisionPick[] = [];
  const unanswered: string[] = [];

  for (const p of points) {
    const got = byId.get(p.id);
    const label = String(got?.label ?? '').trim();
    if (!label) {
      unanswered.push(p.question);
      continue;
    }
    const opt = (p.options || []).find((o) => o.label === label);
    if (!opt) {
      throw new StageError(
        `「${p.question}」这一处收到的答案「${label}」不在那几个选项里。` +
          `只能选摆出来的那几个 —— 每个选项后面那句「放弃什么」要跟着进正文，自己写的答案配不上任何代价。` +
          `都不合适的话，在对话里说清该怎么分岔，再重出一版待定方向；要补充就写在「补充说明」里。`,
        400
      );
    }
    const note = String(got?.note ?? '').trim();
    if (note.length > MAX_NOTE_CHARS) {
      throw new StageError(
        `「${p.question}」的补充说明有 ${note.length} 字，超过 ${MAX_NOTE_CHARS}（不会自动截断 —— 截掉的正是你刚写的那句要求）。`,
        400
      );
    }
    picks.push({
      id: p.id,
      question: p.question,
      methodRef: p.methodRef || '',
      label: opt.label,
      detail: opt.detail || '',
      cost: opt.cost,
      note,
    });
  }

  if (unanswered.length) {
    // 留空 = 模型写正文时自己定，而正文里看不出哪一节的地基是它填的
    throw new StageError(
      `还有 ${unanswered.length} 处没定：${unanswered.map((q) => `「${q}」`).join('、')}。` +
        `每一处都得你拍板 —— 留空的那几处 AI 会在写正文时自己定，而定完的正文读起来一样完整。`,
      400
    );
  }

  return { picks, noFork: '', sheetMessageId: last.id };
}
