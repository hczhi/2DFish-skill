import { type ActionDef, type ActionContext, requireStr, str } from './types.js';
import { fmtForHuman, parseIso, toTaskTimestamp } from './time.js';
import { resolvePerson } from './people.js';
import * as store from '../diary/store.js';
import * as bitable from '../diary/bitable.js';
import * as taskBase from '../diary/taskBase.js';
import {
  normalizeStatus,
  statusLabel,
  normalizePriority,
  priorityLabel,
  TASK_STATUS_PARAM_DOC,
  TASK_PRIORITY_PARAM_DOC,
} from '../diary/taskStatus.js';

/**
 * 创建飞书任务，并把它记进本群项目的「任务」表（甘特图那张）。
 *
 * 身份模型（这是本模块最值得记住的一条）：任务系统视角下 tenant_access_token
 * 「没有任何特权，就是另一个普通用户」。所以机器人以自己身份建任务，再把真人
 * 用 open_id 加成 members[role=assignee] —— 任务随即出现在此人任务中心的
 * 「我负责的」列表里。副作用是创建者显示为机器人而非用户，这是免 OAuth 的代价。
 * 同理，「查我的任务」这类读操作做不到（应用只能看到自己创建的任务），
 * 需要 user_access_token —— 而这正是**为什么任务要在我们库里留一份**（068）：
 * 「这个项目派了哪些活、谁在做、什么时候截止」只能问我们自己的表，问飞书是空的。
 *
 * members 可以在 create 时内联传，不需要再调一次 add_members。
 *
 * 负责人参数是 `assignee`（**姓名**，不是 open_id）：open_id 由 people.ts 从
 * mentions 或本地名册里查，不经过 LLM。
 *
 * ── 顺序：先飞书任务，后落库 ──
 * 反过来（先落库再建任务）会在建任务失败时留下一条「库里有、飞书里没有」的任务：
 * 甘特图上有横条，负责人的任务中心里什么都没有，而回帖是失败的 ——
 * 用户重说一遍就变成两条。现在的顺序下建任务失败就整条失败，什么都没留下。
 * 而落库/同步失败只降级成 warning：任务已经派到人头上了，说「失败」会让他重派。
 */
export const createTaskAction: ActionDef = {
  name: 'create_task',
  description:
    '创建一个飞书**任务**（派活 / 一条待办），同时记进本群项目的任务表和甘特图。' +
    '默认负责人是下达指令的人；指令里明确说了派给某个同事时，' +
    '把那个人的**姓名**填进 assignee。\n' +
    // 这一句是防头号误选的：「添加新项目，XX」以前会落到这里，回帖「✅ 任务已创建」，
    // 而用户要的那张项目日志表根本没建出来（见 intent.ts 的 PROJECT_VS_TASK_RULE）。
    // 排除必须写在**被误选的那个动作**上，光在 create_diary_project 上说
    // 「这不是建任务」是不够的 —— 模型顺着读，看到这条时未必还记得那句。
    '**「项目」不是任务。** 用户说「新建/添加/创建项目」时用 create_diary_project，' +
    '不要用这个动作。只有出现「任务」「待办」「派给」「指派」「提醒我」「几点前做完」' +
    '这类意思时才是任务。',
  params: {
    summary: '必填。任务标题，一句话说清要做什么。',
    description: '可选。任务的具体内容/补充说明。',
    // 开始时间是甘特图的前提：只有截止时间的任务在图上是一个点，不是一条横条。
    // 所以这里明确要求「说了就填」，并且允许模型把「今天开始」算成当天。
    start:
      '可选。开始时间，ISO 8601 带时区偏移，如 2026-08-10T09:00:00+08:00。' +
      '用户说「今天开始」「明天开工」「下周一启动」时填。指令里没提就不要填。',
    due:
      '可选。截止/结束时间，ISO 8601 带时区偏移，如 2026-08-13T18:00:00+08:00。' +
      '用户说「3 天后完成」「周五前」时填（按开始时间往后算）。指令里没提就不要填。',
    status: TASK_STATUS_PARAM_DOC,
    priority: TASK_PRIORITY_PARAM_DOC,
    assignee:
      '可选。任务负责人的姓名，原样填用户说的那个名字（如「张三」）。不要填 open_id。' +
      '指令没有指派给别人时留空（留空即负责人为下达指令的人）。',
  },
  examples: [
    '创建任务：周五前把季度报告写完',
    '指派给 @张三 一个任务，今天开始，3 天后完成，内容是设计项目 logo',
    '帮我建个任务，明天下午三点前联系供应商确认报价',
    '给 @张三 派个任务：整理客户名单',
    '给李四建个任务，下周三前把合同发出来',
  ],
  hint:
    '派一个任务给同事，并记进项目的任务表 / 甘特图' +
    '（「指派给 @张三 一个任务，今天开始，3 天后完成，设计项目 logo」）',
  // bitable:app 是为了把任务同步进项目的「任务」表。没开的表现是任务建出来了、
  // 甘特图上没有 —— 所以要列在这里，而不是等用户自己发现。
  scopes: ['task:task:write', 'bitable:app'],
  async run(params: Record<string, unknown>, ctx: ActionContext) {
    const summary = requireStr(params, 'summary', '任务标题');
    const description = str(params, 'description');
    const startRaw = str(params, 'start');
    const dueRaw = str(params, 'due');
    const status = normalizeStatus(str(params, 'status'));

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

    const priority = normalizePriority(str(params, 'priority'));
    const startMs = startRaw ? parseIso(startRaw, '开始时间') : undefined;
    const dueMs = dueRaw ? parseIso(dueRaw, '截止时间') : undefined;

    // 说反了就换过来，不报错：「3 天后完成，今天开始」这种语序里模型偶尔会把两个
    // 时间填颠倒。报错的代价（用户重说一整句）比静默纠正大，而纠正的结果在回帖里
    // 是写明了的（下面 parts 里两个时间都列出来），用户一眼能看出对不对。
    const [beginMs, endMs] =
      startMs !== undefined && dueMs !== undefined && startMs > dueMs
        ? [dueMs, startMs]
        : [startMs, dueMs];

    const res = await ctx.client.task.v2.task.create({
      params: { user_id_type: 'open_id' },
      data: {
        summary,
        ...(description ? { description } : {}),
        // 飞书任务本身也有 start（和 due 一样是**毫秒**字符串）。写上去的收益是
        // 负责人在任务中心能看到「什么时候开工」，而不只是「什么时候截止」。
        ...(beginMs !== undefined
          ? { start: { timestamp: toTaskTimestamp(beginMs), is_all_day: false } }
          : {}),
        ...(endMs !== undefined
          ? { due: { timestamp: toTaskTimestamp(endMs), is_all_day: false } }
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

    // ── 落库 + 同步到「任务」表 ──
    // 这一整段的失败都只是 warning：任务已经建好并派到人头上了。
    const project =
      ctx.chatType === 'group' ? store.getProjectByChat(ctx.appId, ctx.chatId) : undefined;
    const warnings: string[] = [];
    let ganttUrl = '';
    let duplicate = false;
    try {
      const { created } = store.insertTask({
        appId: ctx.appId,
        // 没绑项目的群里也照样记（project_id 为 NULL）：不记的话这条任务就只存在于
        // 飞书任务中心，而那里我们读不回来。等这个群以后建了项目，它至少还能被查到。
        projectId: project?.id ?? null,
        title: summary,
        content: description ?? '',
        ownerOpenId: assigneeId,
        ownerName: assigneeName,
        startMs: beginMs ?? null,
        endMs: endMs ?? null,
        status,
        guid: task?.guid ?? '',
        url,
        createdBy: ctx.senderOpenId,
        createdByName: ctx.senderName,
        messageId: ctx.messageId,
        stepIndex: ctx.stepIndex ?? 0,
      });
      duplicate = !created;

      if (project) {
        // 068 之前建的项目还没有「任务」表，第一次派活时补建。
        const ensured = await bitable.ensureTaskTable(ctx.client, project);
        if (ensured.warning) warnings.push(ensured.warning);
        if (ensured.tableId) {
          const fresh = store.getProjectById(project.id)!;
          const push = await bitable.pushTasks(ctx.client, fresh);
          if (push.warning) warnings.push(push.warning);
          else ganttUrl = bitable.taskTableUrl(fresh);
        }
      }
    } catch (e) {
      // 库写失败也不让整条失败：飞书任务已经建出来了，回「失败」会让用户重派。
      warnings.push(
        `⚠️ 任务已在飞书建好，但没能记进项目的任务表（${(e as Error).message}），甘特图上暂时看不到它。`
      );
      console.error('[diary] 任务落库失败:', (e as Error).message);
    }

    // ── 写进任务 base（070，这是**将来唯一**的那份数据）──
    //
    // 现在它和上面那条老路并存：`update_task` 还靠库里的 guid 反查「改哪一个」，
    // 这一片砍掉要和读回/改写一起动（否则派得出去、改不动）。
    //
    // 所以这一步**现在**失败只报 warning：库里还有一份，说「失败」会让用户重派，
    // 而重派会在飞书任务中心里留下两条。等老路砍掉之后这里要改成抛错 ——
    // 那时候表就是唯一的数据源，回一句「已创建」而表里没有那行是最坏的失败。
    let taskUrl = '';
    if (project) {
      try {
        // 070 之前建的项目还没有任务 base，第一次派活时补建。
        const ensured = await taskBase.ensureTaskBase(ctx.client, project);
        if (ensured.warning) warnings.push(ensured.warning);
        const fresh = ensured.project;
        if (fresh.task_base_table_id) {
          // 列名每次都重新解析：表是开放编辑的，列名随时会被改。
          const { names, missing } = await taskBase.resolveFieldNames(ctx.client, fresh);
          const miss = taskBase.describeMissing(missing);
          if (miss) warnings.push(miss);
          const written = await taskBase.appendTaskRow(
            ctx.client,
            fresh,
            {
              title: summary,
              digest: description ?? '',
              ownerOpenId: assigneeId,
              status,
              startMs: beginMs,
              dueMs: endMs,
              priority,
              messageId: ctx.messageId,
              stepIndex: ctx.stepIndex ?? 0,
            },
            names
          );
          if (written.duplicate) duplicate = true;
          taskUrl = taskBase.taskBaseUrl(fresh);
        }
      } catch (e) {
        warnings.push(
          `⚠️ 任务已建好，但没能写进**任务管理表**（${(e as Error).message}），` +
            `表里暂时看不到它，需要的话在表里手动补一行。`
        );
        console.error('[task] 写任务管理表失败:', (e as Error).message);
      }
    }

    const parts = [`✅ 任务已创建：**${summary}**`];
    // 名册匹配出来的负责人要标一下：同名查错时用户能当场看出来，
    // 而不是过几天发现任务派给了另一个李四。
    const via = person?.from === 'directory' ? '（按通讯录姓名匹配）' : '';
    parts.push(`负责人：${assigneeName}${via}`);
    if (beginMs !== undefined) parts.push(`开始：${fmtForHuman(beginMs)}`);
    if (endMs !== undefined) parts.push(`截止：${fmtForHuman(endMs)}`);
    // 状态只在不是默认值时说：每条回帖都挂一句「状态：未开始」是噪音。
    if (status !== 'todo') parts.push(`状态：${statusLabel(status)}`);
    // 优先级只在用户真说了的时候回播：它默认是空的（见 TASK_PRIORITY_PARAM_DOC），
    // 而回播一个空值会让人以为助理漏填了。
    if (priority) parts.push(`重要紧急程度：${priorityLabel(priority)}`);
    // 没有开始时间的任务在甘特图上只是一个点。这句提示要在**建的时候**说 ——
    // 等用户打开甘特图发现少一条横条，他不会知道是缺开始时间导致的。
    if (beginMs === undefined && endMs !== undefined && project) {
      parts.push('（没说开始时间，甘特图上它只是个点；补一句「XXX 那个任务从今天开始」即可。）');
    }
    if (url) parts.push(`[在飞书中打开](${url})`);
    // 任务管理表放在甘特图**前面**：它是可编辑的那张，进展/负责人/日期都在这儿改。
    if (taskUrl) parts.push(`[任务管理表](${taskUrl})（进展直接在表里改）`);
    if (ganttUrl) parts.push(`[项目甘特图](${ganttUrl})`);
    if (warnings.length) parts.push(warnings.join('\n'));

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
        ...(project ? { project: project.name } : {}),
        ...(duplicate ? { duplicate: true } : {}),
      },
    };
  },
};
