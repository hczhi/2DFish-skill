import { aiGateway, SAMPLING } from '../../core/llm/gateway.js';
import { ACTIONS, getAction } from './actions/index.js';
import { getSkillForSlot } from '../skillRegistryService.js';
import { nowForPrompt } from './actions/time.js';
import { renderDiaryContext, type DiaryContext } from './diary/context.js';

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
   * 允许多步是因为一句话里塞两件事是很自然的说法（「记一下客户要改 logo，
   * 顺便派给张三」）。在只支持一步的年代，这种句子的结果是 LLM 挑一件做掉、
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
 * 这是个防跑偏的闸，不是能力上限：模型偶尔会把一件事拆成「先记一条日志、
 * 再建任务、再复盘一次」这种自作主张的计划，而每一步都是真的会执行的写操作。
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
 * 没同步过名册时，用户说「派给李四一个任务」而李四没被 @ 到，正确反应是
 * reply 提示他 @ 一下 —— 选 create_task 只会让动作层抛错，多绕一圈。
 * 同步过之后反过来：该大胆选 create_task，让动作层去查名册。
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
 * 「项目」和「任务」是两件事，这一段是防它们串味的地方。
 *
 * 这是本模块观察到的**头号误选**：用户说「添加新项目，XX 纪录片」，模型选了
 * create_task，回帖「✅ 任务已创建」—— 看起来成功了，而用户要的那张日志表
 * 根本不存在。他接着说「创建项目 XX」，模型这次选了 update_task
 * （"创建"没对上、"项目"也没对上，于是掉进了最近的那个改任务动作），
 * 回一句「没找到对得上的任务」。三轮下来一件事都没办成。
 *
 * 根因有两层：注册表里 create_task 排在 create_diary_project **前面六位**
 * （模型顺着读，先撞上的就选了），而「项目」这个词在 create_task 的描述里
 * 完全没被提及、也没被排除。位置在 index.ts 里调过了，这段负责语义上的排除 ——
 * 两个都要，缺一个都还会串。
 *
 * 放在代码里而不是 skill 里：这是动作语义的一部分，不是某家公司的说话习惯。
 */
const PROJECT_VS_TASK_RULE =
  '\n\n**「项目」和「任务」是两件不同的东西，最容易搞混，务必分清：**\n' +
  '- 用户话里出现「项目」「立项」「新项目」「建个项目」「添加项目」「开个项目」时，' +
  '一律是项目日记的 create_diary_project，**绝对不是 create_task、也不是 update_task**。' +
  '项目 = 一个群一张日志表，是长期的；任务 = 一条待办，是一次性的。\n' +
  '- 只有出现「任务」「待办」「派给」「提醒我」「几点前做完」这类词时才是 create_task。\n' +
  '- 用户说「创建/新建/添加 + 项目名」而你不确定他要项目还是任务时，选 create_diary_project' +
  '（他说了「项目」两个字，就按项目办）。';

/**
 * 这个群有没有绑项目日记，是**运行时事实**，会改变动作选择。
 *
 * 没绑项目时，「记一下明天要交片」这句话该走 reply 提示先建项目 ——
 * 选 add_diary_record 只会让动作层回一句「这个群还没有项目」，绕了一圈。
 * 绑了项目就反过来：该大胆选 add_diary_record，而且要明确「记录 ≠ 建任务」，
 * 这是这三个动作最容易被误选的一处（「记一下明天要交片」听起来很像待办）。
 *
 * 和 directoryHint 一样放在代码里而不是 skill 里：它是库里有没有数据，不是可配置的规则。
 *
 * 没有私聊分支：助理只在群聊里工作，私聊在 dispatcher 就被挡掉了，
 * 走到这里的一定是群消息。
 */
function diaryHint(projectName: string | null): string {
  // 「找表格链接」在哪种情况下都要能答上：那些多维表格不在任何人的云文档空间里，
  // 链接分享也是关掉的，所以**问助理是唯一的找回途径**。
  // 这一句对两个分支都成立（连一个项目都没有时，动作自己会回「先去建项目」），
  // 所以放在最前面而不是塞进某一个分支。
  const listHint =
    '\n用户问「有哪些项目 / 项目列表 / 表格链接发一下 / 项目总表在哪」时选 list_diary_projects' +
    '（它只回项目清单和链接，不看日志内容 —— 问「这周干了什么」是 review_diary）。';

  if (!projectName) {
    return (
      '\n本群**还没有绑定项目日记**。用户说「新建项目 / 建个项目 / 添加项目 / 立项」时' +
      '选 create_diary_project（这正是本群该做的第一件事）；' +
      '说「记一下……」这类话时用 reply 告诉他先说一句「新建项目：XXX」，' +
      '不要选 add_diary_record。' +
      listHint +
      PROJECT_VS_TASK_RULE
    );
  }
  return (
    `\n本群已绑定项目日记：**${projectName}**。用户说「记一下 / 记录一下 / 写进日志」时` +
    '选 add_diary_record（project 参数留空即可，系统知道是本群这个项目）；' +
    '说「复盘 / 总结一下 / 这周干了什么」时选 review_diary。\n' +
    // 这两个动作是这一块里最容易串味的一对，而串了之后拿到的东西是**反的**：
    // 用户要助理去读群聊，收到的是一份基于日志的复盘（很可能是空的，因为
    // 群里的事本来就没人手动记过）。所以在这里点明分界线是「读的是什么」。
    '**「总结群聊」是另一个动作**：用户明确说要处理**群里的聊天记录**' +
    '（「总结一下今天群里聊了什么」「把群聊整理进日志」）时选 digest_chat —— ' +
    '它去读群消息原话，产出是往日志里新增几条记录。' +
    '只说「复盘 / 总结一下」而没提群聊时，一律是 review_diary（读的是已经记好的日志）。\n' +
    '**注意区分**：「记一下」是写日志（add_diary_record），' +
    '「提醒我 / 派给谁 / 几点前做完」才是待办（create_task）。' +
    '同一句话里既是记录又是待办时，才拆成两步。\n' +
    // 「进度怎么样」这句话两个动作都说得通，而拿错的后果是反的：他想看还剩哪些活，
    // 收到一份按时间段归纳的复盘（还白花一次额度）。分界线是"看的是哪张表"。
    '**「有哪些活在办」是 list_tasks**：用户问「还有什么没做完 / 任务列表 / ' +
    '张三手上有几个活 / 我的任务 / 现在进度怎么样」时选它 —— 它读的是**任务管理表**' +
    '（谁负责、什么时候截止、做到哪了），而 review_diary 读的是日志。' +
    '问「这周干了什么」是 review_diary，问「还剩哪些活」是 list_tasks。' +
    listHint +
    PROJECT_VS_TASK_RULE
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

/**
 * 本群项目的现状快照。**只有 projectName 是必需的**，其余字段缺省时这一节
 * 就不出现 —— 调用方（包括测试）只关心「有没有项目」时不必凑齐一整份数据。
 */
export type DiaryOption = { projectName: string | null } & Partial<DiaryContext>;

function buildSystemPrompt(
  nowMs: number,
  mentions: Array<{ openId: string; name: string }>,
  peopleCount: number,
  hasPrior = false,
  appSupplement?: string,
  diary?: DiaryOption
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

  // 项目现状快照（记录 + 在办任务）。放在 diaryHint 之后、补充规则之前：
  // 它是**数据**，而 diaryHint 是读这份数据的说明书，顺序反了模型会先看到一堆
  // 任务行却不知道该拿它们干什么（观察到的表现是自作主张去改快到期的那条）。
  // 硬性规则仍然压在最后 —— 这一节自带的免责声明也点名引用了它们。
  const diaryFacts = diary
    ? renderDiaryContext({
        projectName: diary.projectName,
        records: diary.records ?? [],
        tasks: diary.tasks ?? [],
        recordTotal: diary.recordTotal ?? 0,
        openTaskTotal: diary.openTaskTotal ?? 0,
        closedTaskCount: diary.closedTaskCount ?? 0,
      })
    : '';

  return `你是飞书助理的指令解析器。用户在飞书里 @ 你并下达一句指令，你要判断他想做什么，输出一个 JSON。

当前时间：${nowForPrompt(nowMs)}

## 可用动作

${actionDocs}

## 本条消息 @ 到的其他人

${mentionList}
${directoryHint(peopleCount)}
${diary ? diaryHint(diary.projectName) : ''}
${diaryFacts}
${supplement.block}
## 输出格式

只输出一个 JSON 对象，不要任何解释文字、不要 markdown 代码块：

{"action": "动作名", "params": {"参数名": "值"}}

一句话里要办**两件事**时（如「记一下客户要改 logo，顺便派给张三」），
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
   （建错任务、记到错的项目里，代价远大于多问一句）。
5. 可选参数用户没提到就不要填，不要自己编默认值。
6. **只拆用户明确要求的那几件事**，一件事就是一步。不要自己加"顺手做一下"的步骤
   （比如他只说记一条日志，你不要额外建个任务）—— 每一步都会真的执行。
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
  /**
   * 本群的项目日记状态 + 现状快照（在办任务、最近记录）。
   * 由 dispatcher 从库里查（见 diary/context.ts:buildDiaryContext）。
   *
   * 不传时 prompt 里完全不出现这段 —— 测试里不关心日记的用例照旧。
   * 只传 projectName 也是合法的：快照那几个字段都是可选的，缺了就只出提示、
   * 不出数据（`Partial<DiaryContext>`）。
   */
  diary?: DiaryOption;
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
            opts.supplement,
            opts.diary
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
