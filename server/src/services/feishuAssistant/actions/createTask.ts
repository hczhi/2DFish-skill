import { type ActionDef, type ActionContext, requireStr, str } from './types.js';
import { fmtForHuman, parseIso, toTaskTimestamp } from './time.js';
import { resolvePerson } from './people.js';

/**
 * 创建飞书任务。
 *
 * 身份模型（这是本模块最值得记住的一条）：任务系统视角下 tenant_access_token
 * 「没有任何特权，就是另一个普通用户」。所以机器人以自己身份建任务，再把真人
 * 用 open_id 加成 members[role=assignee] —— 任务随即出现在此人任务中心的
 * 「我负责的」列表里。副作用是创建者显示为机器人而非用户，这是免 OAuth 的代价。
 * 同理，「查我的任务」这类读操作做不到（应用只能看到自己创建的任务），
 * 需要 user_access_token，因此本模块不提供读任务的动作。
 *
 * members 可以在 create 时内联传，不需要再调一次 add_members。
 *
 * 负责人参数是 `assignee`（**姓名**，不是 open_id）：open_id 由 people.ts 从
 * mentions 或本地名册里查，不经过 LLM。有名册之后「私聊里给同事派任务」才成立 ——
 * 私聊里没法 @ 任何人。
 */
export const createTaskAction: ActionDef = {
  name: 'create_task',
  description:
    '创建一个飞书任务。默认负责人是下达指令的人；指令里明确说了派给某个同事时，' +
    '把那个人的**姓名**填进 assignee。',
  params: {
    summary: '必填。任务标题，一句话说清要做什么。',
    description: '可选。任务的补充说明。',
    due: '可选。截止时间，ISO 8601 带时区偏移，如 2026-08-05T18:00:00+08:00。指令里没提就不要填。',
    assignee:
      '可选。任务负责人的姓名，原样填用户说的那个名字（如「张三」）。不要填 open_id。' +
      '指令没有指派给别人时留空（留空即负责人为下达指令的人）。',
  },
  examples: [
    '创建任务：周五前把季度报告写完',
    '帮我建个任务，明天下午三点前联系供应商确认报价',
    '给 @张三 派个任务：整理客户名单',
    '给李四建个任务，下周三前把合同发出来',
  ],
  scopes: ['task:task:write'],
  async run(params: Record<string, unknown>, ctx: ActionContext) {
    const summary = requireStr(params, 'summary', '任务标题');
    const description = str(params, 'description');
    const dueRaw = str(params, 'due');

    // 负责人：指定了就解析那个名字，没指定就是发言人自己。
    //
    // 解析不出来时**抛错**，不回落到发言人。用户说「给李四建个任务」而任务
    // 落在他自己头上，是一个看起来成功了的错误结果 —— 他要过几天才会发现李四
    // 根本不知道这件事。抛错的话任务还没建，回一句「没找到李四，@ 一下」即可。
    // （兼容 LLM 仍输出老参数名 assignee_open_id 的情况。）
    const wanted = str(params, 'assignee') ?? str(params, 'assignee_open_id');
    const person = wanted ? resolvePerson(wanted, ctx) : undefined;
    const assigneeId = person?.openId ?? ctx.senderOpenId;
    const assigneeName = person?.name ?? ctx.senderName ?? '你';

    const dueMs = dueRaw ? parseIso(dueRaw, '截止时间') : undefined;

    const res = await ctx.client.task.v2.task.create({
      params: { user_id_type: 'open_id' },
      data: {
        summary,
        ...(description ? { description } : {}),
        ...(dueMs !== undefined
          ? { due: { timestamp: toTaskTimestamp(dueMs), is_all_day: false } }
          : {}),
        members: [{ id: assigneeId, type: 'user', role: 'assignee' }],
        // 幂等键。飞书事件是 at-least-once，DB 去重是第一道防线，
        // 这里是第二道：即使去重被绕过（比如库刚好被清），也不会建出两个任务。
        //
        // 带上 stepIndex：一句话里说了两个任务时，两步共用同一个 client_token
        // 会让第二个被飞书静默判成重复 —— 接口返回成功，我们回帖「已创建」，
        // 实际只有一个任务。
        client_token: `mmpla:${ctx.messageId}:${ctx.stepIndex ?? 0}`.slice(0, 50),
      },
    });

    const task = res.data?.task;
    // 飞书返回的 url 已经是可点的 applink（带 guid + suite_entity_num），
    // 直接透传，不要自己拼——applink 的域名在飞书/Lark 下不一样。
    const url = task?.url || '';
    // 名册匹配出来的负责人要标一下：同名查错时用户能当场看出来，
    // 而不是过几天发现任务派给了另一个李四。
    const via = person?.from === 'directory' ? '（按通讯录姓名匹配）' : '';
    const parts = [`✅ 任务已创建：**${summary}**`, `负责人：${assigneeName}${via}`];
    if (dueMs !== undefined) parts.push(`截止：${fmtForHuman(dueMs)}`);
    if (url) parts.push(`[在飞书中打开](${url})`);

    return {
      summary: parts.join('\n'),
      data: {
        guid: task?.guid,
        task_id: task?.task_id,
        // 标题存一份：后续动作（标记完成、改截止时间）要靠它反查
        //「用户说的是哪个任务」。从回帖文案里剥标题只是给老日志行的兜底，
        // 见 actions/recent.ts 的 titleOf。
        title: summary,
        url,
        assignee: assigneeId,
        resolved_from: person?.from,
      },
    };
  },
};
