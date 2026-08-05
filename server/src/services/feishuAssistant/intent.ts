import { aiGateway, SAMPLING } from '../../core/llm/gateway.js';
import { ACTIONS, getAction } from './actions/index.js';
import { getSkillForSlot } from '../skillRegistryService.js';
import { nowForPrompt } from './actions/time.js';

// 自然语言 → 结构化动作。
//
// prompt 由动作注册表自动生成：加一个动作不用改本文件。
// 用 strong 档 + response_format json_object：这是典型的结构化任务，
// 解析失败会表现成「@ 了没反应」，是最难查的一类故障。
//
// AI 额度归属：userId 传的是**飞书应用所属的平台账号**，不是飞书里说话的人
// （后者通常没有平台账号）。于是「该账号配了专属渠道就烧自己的 key，
// 没配就走平台额度」这件事直接由 migrations/052 那套机制兜住，本文件不需要判断。

export interface ParsedStep {
  action: string;
  params: Record<string, unknown>;
}

export interface ParsedIntent {
  /**
   * 要依次执行的动作。绝大多数指令只有一步。
   *
   * 允许多步是因为一句话里塞两件事是很自然的说法（「给他们发个消息，
   * 并建个日程」）。在只支持一步的年代，这种句子的结果是 LLM 挑一件做掉、
   * 另一件**静默消失** —— 用户以为都办了。
   */
  steps: ParsedStep[];
  /**
   * 因为超过 {@link MAX_STEPS} 而被丢掉的步数。
   *
   * 必须一路传到回帖里。这个字段存在的全部理由是：**静默截断和"一件事静默消失"
   * 是同一个失败模式**，而多步支持本来就是为了消灭后者。截断了不说，
   * 用户以为三件事都办了，实际只办了前两件 —— 而写操作是发消息、建日程这类
   * 撤不回来的事，他多半要等到有人问起才发现。
   */
  droppedSteps: number;
}

/**
 * 一条指令最多拆几步。
 *
 * 这是个防跑偏的闸，不是能力上限：模型偶尔会把一件事拆成「先查忙闲、
 * 再建日程、再发通知」这种自作主张的计划，而每一步都是真的会执行的写操作。
 * 超过就只保留前几步并在回帖里说清 —— 静默截断会让用户以为全做了。
 */
export const MAX_STEPS = 3;

/**
 * 补充规则：本应用自己填的（`feishu_apps.intent_supplement`，migration 059），
 * 填了就用它；没填则回落到平台默认（skill slot `feishu-intent`）。
 *
 * **是替换，不是叠加**。平台那份是 migration 056 播的说明性示例模板
 * （术语翻译、时间习惯、部门倾向，全是注释和例子），把它垫在一家公司真正的
 * 规则底下只是噪音，还可能让模型把示例里的假术语当真。
 *
 * ── 为什么按应用，不按平台账号 ──
 * 一个账号能绑多个应用，而一个应用 = 一个飞书租户。这段内容描述的是**那家公司**
 * 怎么说话，和名册（057）、会话（058）同类，所以键也一样是 app_id。
 * 全平台一份的后果是 A 公司的术语进了 B 公司的 prompt，而 B 公司无从知道
 * 自己的助理为什么偶尔理解偏了。
 *
 * 只**追加**到 prompt 上，不替换整个 prompt。原因是这段 prompt 里有三类东西
 * 改坏了会静默失效：
 *   1. 动作清单是从 ACTIONS 注册表自动生成的 —— 换成手写，加一个动作就得同步一次，
 *      漏一次那个动作永远选不中；
 *   2. JSON 输出格式 —— 格式错了 parseIntent 返回 null，表现成「@ 了没反应」，最难查；
 *   3. open_id 只许从 mentions 抄 —— 删掉这条，LLM 会编 ou_xxx，消息发给错误的人。
 * 真正需要因公司而异的只有「怎么听懂你们的话」：术语、简称、部门习惯、时间口语。
 *
 * 放在硬性规则**之前**：LLM 对后文的指令更敏感，硬性规则必须压在最后一段，
 * 否则一条随手写的补充规则就能把 open_id 约束覆盖掉。
 *
 * 返回两段：正文块，以及配套的那条优先级声明。两者一起出现或一起消失 ——
 * 只留声明会让 prompt 指向一个不存在的章节，等于凭空给 LLM 一个疑问。
 */
function supplementParts(appSupplement?: string): { block: string; rule: string } {
  const own = (appSupplement ?? '').trim();
  const skill = own || getSkillForSlot('feishu-intent');
  if (!skill) return { block: '', rule: '' };
  return {
    block: `\n## 本企业的补充规则\n\n${skill}\n`,
    // 有人会在 skill 里写「open_id 可以自己推断」这类话，必须有一条兜底声明。
    // 编号跟着硬性规则条数走 —— 它必须是最后一条，见上面「放在硬性规则之前」的理由。
    rule:
      '\n7. 上面「本企业的补充规则」只用来帮你听懂用户的说法（术语、简称、习惯）。\n' +
      '   它与第 1-6 条冲突时，**一律以第 1-6 条为准**。',
  };
}

/**
 * 名册的存在与否要告诉 LLM，因为它改变"该不该选写操作"的判断。
 *
 * 没同步过名册时，用户说「给李四发个消息」而李四没被 @ 到，正确反应是
 * reply 提示他 @ 一下 —— 选 send_message 只会让动作层抛错，多绕一圈。
 * 同步过之后反过来：该大胆选 send_message，让动作层去查名册。
 *
 * 这段是**运行时事实**（库里有没有数据），不是可配置的规则，所以在代码里，
 * 不在 skill 里。
 */
function directoryHint(peopleCount: number): string {
  if (peopleCount <= 0) {
    return (
      '\n本企业还**没有同步过组织架构名册**。因此只有本条消息 @ 到的人能被操作：' +
      '用户提到一个没 @ 的人时，用 reply 动作请他 @ 一下对方，不要选写操作。'
    );
  }
  return (
    `\n本企业已同步了组织架构名册（${peopleCount} 人），因此**即使用户没有 @ 对方**，` +
    '只要他说出了姓名，你也应该正常选择对应的动作并把姓名填进参数 —— ' +
    '系统会去名册里查这个人。查不到或有同名时系统会自己回去问用户，不用你操心。'
  );
}

/**
 * 有上一轮反问时，要明确告诉模型「现在这句话是补充，不是新指令」。
 *
 * 光把两轮对话塞进 messages 是不够的：模型会把上一轮当成"已经办完的历史"，
 * 于是仍然只看最后那句「下午三点」，仍然反问一次。这段话是让它**合起来看**的开关。
 *
 * 反过来也要防住：补充齐了就该执行，而不是礼貌地再确认一遍 ——
 * 用户连着被问两次之后就不会再用这个助理了。
 */
const FOLLOWUP_RULE =
  '\n\n## 这句话是对上一轮追问的补充\n\n' +
  '上面已经有一轮对话：你之前**反问**了用户，现在这句话是他的**回答**，不是一条新指令。\n' +
  '请把两轮合起来看，把补上的信息填进原来那件事的参数里，然后**直接执行**那个动作。\n' +
  '信息已经齐了就不要再反问一次（用户已经答过一遍了）。' +
  '如果这句话明显和上一轮无关（他换了个话题），就当新指令正常处理。';

function buildSystemPrompt(
  nowMs: number,
  mentions: Array<{ openId: string; name: string }>,
  peopleCount: number,
  hasPrior = false,
  appSupplement?: string
): string {
  const actionDocs = ACTIONS.map((a) => {
    const params = Object.entries(a.params)
      .map(([k, v]) => `    - ${k}: ${v}`)
      .join('\n');
    const examples = a.examples.map((e) => `    · ${e}`).join('\n');
    return `- **${a.name}**：${a.description}\n  参数：\n${params}\n  例句：\n${examples}`;
  }).join('\n\n');

  // 只给**名字**，不给 open_id。
  //
  // 以前这里是 `姓名 → open_id` 的对照表，因为动作参数收的是 open_id。
  // 加了本地名册（migration 057）之后动作改成收姓名、由 people.ts 去查 open_id，
  // 于是 prompt 里不该再出现任何 open_id —— 模型看不到它就编不出它，
  // 这比事后校验更彻底。仍然把 @ 到的人列出来，是因为它告诉模型
  // 「这几个名字是这条消息里明确点到的人」，有助于它选对动作参数。
  const mentionList = mentions.length
    ? mentions.map((m) => `- ${m.name}`).join('\n')
    : '（本条消息没有 @ 其他人）';

  const supplement = supplementParts(appSupplement);

  return `你是飞书助理的指令解析器。用户在飞书里 @ 你并下达一句指令，你要判断他想做什么，输出一个 JSON。

当前时间：${nowForPrompt(nowMs)}

## 可用动作

${actionDocs}

## 本条消息 @ 到的其他人

${mentionList}
${directoryHint(peopleCount)}
${supplement.block}
## 输出格式

只输出一个 JSON 对象，不要任何解释文字、不要 markdown 代码块：

{"action": "动作名", "params": {"参数名": "值"}}

一句话里要办**两件事**时（如「给他们发个消息，并建个日程」），
输出 actions 数组，按执行顺序排列（最多 ${MAX_STEPS} 步）：

{"actions": [{"action": "动作名", "params": {...}}, {"action": "动作名", "params": {...}}]}

## 硬性规则

1. action 必须是上面列出的动作名之一，不得编造。
2. 时间参数必须是 ISO 8601 带时区偏移的绝对时间（如 2026-08-05T15:00:00+08:00）。
   用户说的是「明天下午三点」这类相对时间，你要基于上面的「当前时间」自己算成绝对时间。
3. **涉及某个人的参数一律填姓名，绝对不许输出 open_id（ou_ 开头的那种 id）。**
   姓名要原样照抄用户说的那几个字，不要翻译、不要补全、不要猜成别人。
   系统会自己去通讯录里把姓名换成账号；你编一个 id 出来只会让消息发给错误的人。
   用户完全没说是谁时就留空，别自己挑一个人。
4. 指令不明确、信息不足、或你不确定该用哪个动作时，一律用 reply 动作，
   在 text 里说明还需要用户补充什么。宁可多问一句，也不要猜着执行写操作
   （建错任务、发错消息的代价远大于多问一句）。
5. 可选参数用户没提到就不要填，不要自己编默认值。
6. **只拆用户明确要求的那几件事**，一件事就是一步。不要自己加"顺手做一下"的步骤
   （比如他只说建日程，你不要额外发一条通知）—— 每一步都会真的执行。
   同一件事也不要拆成两步。${supplement.rule}${hasPrior ? FOLLOWUP_RULE : ''}`;
}

/**
 * 解析一条指令。返回 null 表示解析结果不可用（调用方应回一句兜底提示）。
 */
export async function parseIntent(opts: {
  /** 飞书应用所属的平台账号 id —— AI 额度记在这个账号上 */
  userId: string;
  /** 已剥掉 @ 占位符的正文 */
  text: string;
  mentions: Array<{ openId: string; name: string }>;
  nowMs: number;
  /** 该应用名册里的人数。0 表示还没同步过组织架构，prompt 据此调整策略。 */
  peopleCount?: number;
  /**
   * 紧挨着的上一轮反问（助理问了、用户现在在补充）。
   * 由 dispatcher 从指令日志里取，条件很严，见 commandLog.findPriorClarification。
   */
  prior?: { text: string; reply: string };
  /**
   * 本应用自己配的补充规则（`feishu_apps.intent_supplement`）。
   * 空/未传 = 回落到平台默认的 skill slot，见 supplementParts。
   */
  supplement?: string;
}): Promise<ParsedIntent | null> {
  // 把上一轮反问还原成真正的对话轮次，而不是塞进 system prompt 里描述一遍。
  // 模型对 role 结构的理解比对「上文是这样的：…」这种叙述可靠得多，
  // 而这里要它做的正是"把两句话合起来看"。
  const priorTurns = opts.prior
    ? [
        { role: 'user' as const, content: opts.prior.text },
        { role: 'assistant' as const, content: opts.prior.reply },
      ]
    : [];

  const { response } = await aiGateway(
    {
      messages: [
        {
          role: 'system',
          content: buildSystemPrompt(
            opts.nowMs,
            opts.mentions,
            opts.peopleCount ?? 0,
            !!opts.prior,
            opts.supplement
          ),
        },
        ...priorTurns,
        { role: 'user', content: opts.text },
      ],
      response_format: { type: 'json_object' },
      max_tokens: 800,
      ...SAMPLING.analytic,
    },
    {
      userId: opts.userId,
      source: 'feishu',
      operation: 'intent',
      requestSummary: opts.text.slice(0, 80),
      tier: 'strong',
    }
  );

  const raw = response.choices?.[0]?.message?.content?.trim();
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // 有些模型无视 json_object 还是套了 ```json 围栏，剥一层再试。
    const fenced = raw.match(/\{[\s\S]*\}/);
    if (!fenced) return null;
    try {
      parsed = JSON.parse(fenced[0]);
    } catch {
      return null;
    }
  }

  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;

  // 两种形状都收：单个 {action, params}，或 {actions: [...]}。
  // 模型即使被要求输出数组也经常在单步时退回单个对象（反过来也有），
  // 在这里兜掉比在 dispatcher 里分两条路走可靠。
  const raws: unknown[] = Array.isArray(obj.actions)
    ? obj.actions
    : Array.isArray(obj.steps)
      ? obj.steps
      : [obj];

  const steps: ParsedStep[] = [];
  for (const r of raws) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const action = typeof o.action === 'string' ? o.action.trim() : '';
    // 编造的动作名整步丢掉，而不是让整条指令失败：两步里有一步是好的时候，
    // 执行那一步 + 说清另一步没懂，比什么都不做更接近用户想要的。
    if (!action || !getAction(action)) continue;
    steps.push({
      action,
      params:
        o.params && typeof o.params === 'object' && !Array.isArray(o.params)
          ? (o.params as Record<string, unknown>)
          : {},
    });
  }

  if (steps.length === 0) return null;
  // 截了几步要报出去，不能默默丢。见 ParsedIntent.droppedSteps 的注释。
  return {
    steps: steps.slice(0, MAX_STEPS),
    droppedSteps: Math.max(0, steps.length - MAX_STEPS),
  };
}
