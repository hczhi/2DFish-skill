import { type ActionDef, type ActionContext, bool, posInt, str, strList } from './types.js';
import { fmtForHuman, parseIso, toTaskTimestamp } from './time.js';
import { resolvePerson } from './people.js';
import { findRecentTarget, TargetNotResolvedError } from './recent.js';
import { describeFeishuError } from '../feishuError.js';
import * as store from '../diary/store.js';
import * as bitable from '../diary/bitable.js';
import { normalizeStatus, statusLabel, TASK_STATUS_PARAM_DOC, type TaskStatus } from '../diary/taskStatus.js';

/**
 * 任务的后续动作：标记完成 / 改起止时间 / 改状态 / 加协作人 / 设提醒 / 加一条评论。
 * 改完同时把项目任务表（甘特图那张）里那一行更新掉。
 *
 * ── 「哪个任务」是这个动作真正的难点 ──
 * 飞书的 `task.patch` 要 guid，而**模型不知道 guid** —— 这和 open_id 是同一类
 * 问题，用同一套解法：guid 只从代码控制的来源里反查，绝不让模型输出。
 * 来源现在有两个，顺序是有讲究的（见 resolveTarget）：
 *   1. `feishu_project_tasks`（068 之后建的任务都在这儿，**不限 7 天**）
 *   2. 执行日志（`actions/recent.ts`，068 之前建的任务只有这一份，7 天窗口）
 * 查到多条**绝不挑一个**。
 *
 * ── 一条必须一直说清的限制 ──
 * **只能改助理自己帮他建的那些。** 用户在飞书里手动建的任务我们看不见：
 * 任务系统视角下 tenant token 就是另一个普通用户，`task.list` 只返回调用身份
 * 自己创建的东西，所以是安静地返回空、不是报错。查不到时的话术因此必须是
 * 「我只能改我自己帮你建的那些」，否则用户以为助理坏了，反复换措辞重试。
 *
 * ── 为什么是一个动作而不是六个 ──
 * 「把 X 标记完成，截止改到周五」是一句话里的一件事，拆成两个动作就要占两步
 * （MAX_STEPS = 3），而且两步之间不传数据（见 dispatcher），第二步得把同一个
 * 任务再反查一遍。合成一个动作则一次反查、一次回帖。
 *
 * ── 为什么四个飞书接口不能合成一个请求 ──
 * 飞书把它们分在四个接口上：`task.patch`（标题/描述/起止/完成状态）、
 * `addMembers`（协作人）、`addReminders`（提醒）、`comment.create`（评论）。
 * 于是这里必然是多次调用，也就必然可能**部分成功**。处理方式是：做完所有能做的，
 * 然后把成功的和失败的一起说清楚 —— 中途 throw 会留下「改了一半、不知道改到哪」
 * 的状态，而用户重下指令会把成功那半再做一遍。
 */
/** 模型在 completed 上给的中文说法。bool() 之外的兜底，认不出来返回 undefined。 */
function completedWord(raw: string | undefined): boolean | undefined {
  if (!raw) return undefined;
  const t = raw.trim();
  if (['完成', '已完成', '做完了', '做完', '完成了'].includes(t)) return true;
  if (['未完成', '没做完', '重新打开', '取消完成', '还没完成'].includes(t)) return false;
  return undefined;
}

/** 反查到的目标。`row` 只有走库那条路时才有（老任务只在日志里）。 */
interface TaskTarget {
  guid: string;
  title: string;
  /** 建它/上次改它时留下的结构化产物。日志那条路的 url、due 从这里取。 */
  data: Record<string, unknown>;
  row?: store.FeishuProjectTaskRow;
}

/** 列给用户挑的时候最多列几个。和 recent.ts 的 MAX_OPTIONS 同一个理由。 */
const MAX_OPTIONS = 5;

/**
 * 「用户说的是哪个任务」。
 *
 * **先查库，查不到再退回执行日志。** 顺序反了会有一个具体的坏结果：日志只留 7 天，
 * 而库里是全量的 —— 先查日志的话，「上个月派的那个 logo 任务改一下」会先撞上
 * 「我这边没有可以改的任务」（recent.ts 在候选为空时直接抛），根本走不到库那一步。
 *
 * 库里没有 guid 的行排除掉：那种行改不动飞书任务（没有 guid 就没法 patch），
 * 拿它当目标只会在第一个接口上撞一个莫名的参数错误。
 */
function resolveTarget(keyword: string | undefined, ctx: ActionContext): TaskTarget {
  const rows = store
    .findTasksByKeyword({ appId: ctx.appId, senderOpenId: ctx.senderOpenId, keyword })
    .filter((r) => r.guid);

  if (rows.length === 1) {
    const r = rows[0];
    return { guid: r.guid, title: r.title, data: { url: r.url, due: r.end_ms ?? '' }, row: r };
  }
  if (rows.length > 1) {
    // 绝不挑一个。挑错的后果是动了另一件事，而回帖说的是「已完成」。
    const opts = rows.slice(0, MAX_OPTIONS).map((r) => `· ${r.title}`).join('\n');
    throw new TargetNotResolvedError(
      keyword
        ? `有 ${rows.length} 个任务都能对上「${keyword}」：\n${opts}\n请说全一点，我不敢替你挑。`
        : // 没给关键词时**不能**默认取最近那个：「那个任务完成了」里的"那个"
          // 指的是他心里想的那件事，不一定是时间上最近的一件。
          `不确定你说的是哪个任务。你最近这些任务我都能改：\n${opts}\n` +
            `请带上名字再说一遍，比如「把 XXX 那个任务…」。`
    );
  }

  // 库里没有 → 退回执行日志（068 之前建的任务只在那儿）。
  const ref = findRecentTarget(keyword, ctx, {
    // 把自己也列进来：改过标题之后，用户会用**新**名字来称呼它。
    actions: ['create_task', 'update_task'],
    label: '任务',
    requireKeys: ['guid'],
  });
  return { guid: String(ref.data.guid), title: ref.title, data: ref.data };
}

/**
 * 完成状态 ↔ 状态枚举的互推。
 *
 * 两个参数说的是同一件事的两种说法，用户只会说一种，但两边都要跟上：
 * 只改飞书的完成状态而不动库里的 status，甘特图上那条横条会一直是「进行中」；
 * 只改 status 而不动飞书，负责人的任务中心里它还是未完成的。
 *
 * 「重新打开」映射到 `doing` 而不是 `todo`：它之前被标记过完成，说明活已经动过了，
 * 「未开始」是明确错的，而「进行中」最多是不够精确。
 */
function syncStatus(
  completed: boolean | undefined,
  status: TaskStatus | undefined
): { completed: boolean | undefined; status: TaskStatus | undefined } {
  if (completed !== undefined && status === undefined) {
    return { completed, status: completed ? 'done' : 'doing' };
  }
  if (status !== undefined && completed === undefined) {
    // 「取消」不等于「完成」，所以只有 done 才去动飞书那边的完成状态。
    return { completed: status === 'done' ? true : undefined, status };
  }
  return { completed, status };
}

export const updateTaskAction: ActionDef = {
  name: 'update_task',
  description:
    '修改助理之前帮用户建过的某个任务：标记完成（或重新打开）、改开始/截止时间、' +
    '改状态、加协作人/关注人、设提醒、写一条评论。改完项目甘特图上那条也会跟着更新。' +
    '**只能改助理自己建过的任务**，用户在飞书里手动建的改不了。' +
    '必须用 task 参数说清是哪个任务（照用户说的标题填）。\n' +
    // 「创建项目 XX」曾经落到这里：「创建」对不上、「项目」也对不上，模型于是挑了
    // 语义最近的改任务动作，回一句「没找到对得上的任务」。这个动作只处理**已存在**的
    // 东西，凡是「新建/创建/添加」都不该到这里来。
    '这个动作只**改已经存在**的任务。用户说「新建/创建/添加」什么东西时都不是它 ——' +
    '新任务是 create_task，新项目是 create_diary_project。',
  params: {
    task:
      '必填。要改的是哪个任务，填用户话里提到的**任务标题**（或其中一段，' +
      '如「季度报告」）。原样照抄他说的字，不要自己翻译或补全。' +
      '他只说了「那个任务」而没给名字时，这里留空 —— 系统会把他的任务列给他挑。',
    completed:
      '可选，布尔。用户说「做完了」「标记完成」「已完成」时填 true；' +
      '说「重新打开」「还没做完」「取消完成」时填 false。没提到完成状态就留空。',
    status: TASK_STATUS_PARAM_DOC,
    start:
      '可选。新的开始时间，ISO 8601 带时区偏移，如 2026-08-11T09:00:00+08:00。' +
      '用户说「改成明天开始」「推迟到下周一开工」时填。没提到就留空。',
    due:
      '可选。新的截止/结束时间，ISO 8601 带时区偏移，如 2026-08-07T18:00:00+08:00。' +
      '用户说「截止改到周五」「延到下周三」时填。没提到就留空。',
    summary: '可选。改任务标题时填新标题。用户没说要改名就留空。',
    followers:
      '可选。要加进来的**协作人/关注人姓名**数组，如 ["张三","李四"]，' +
      '原样填用户说的名字，不要填 open_id。用户说「把张三也拉进来」「让李四一起跟」时填。',
    remind_minutes:
      '可选，整数。提前几分钟提醒，如「提前一小时提醒」就填 60。' +
      '注意：任务必须有截止时间才能设提醒（可以在同一句里一起说）。没提到就留空。',
    comment:
      '可选。要写在任务下面的一条评论/进展说明，如「已经跟供应商确认过了」。' +
      '用户说「在那个任务下面记一句」「补充一下进展」时填。',
  },
  examples: [
    '把季度报告那个任务标记完成',
    '整理客户名单那个任务，截止改到周五下午六点',
    '设计 logo 那个任务改成从明天开始',
    '设计 logo 那个任务状态改成进行中',
    '刚才那个任务把 @张三 也加进来一起跟',
    '在季度报告任务下面记一句：数据还差三季度的',
    '季度报告那个任务重新打开，还没做完',
  ],
  hint:
    '改我帮你建过的任务：标记完成、改起止时间、改状态、加协作人、写评论' +
    '（「季度报告那个任务标记完成」）',
  scopes: ['task:task:write', 'bitable:app'],
  async run(params: Record<string, unknown>, ctx: ActionContext) {
    // 先确定改哪个。反查失败会抛错，此时一次接口都还没调 —— 用户重说是安全的。
    const target = resolveTarget(str(params, 'task'), ctx);
    const guid = target.guid;

    // bool() 认的是 true/是/要 那一类；模型在这个参数上还会直接给「完成」
    //「已完成」，所以再兜一层。认不出来仍然是 undefined —— 不能猜成 true，
    // 把一个还没做的任务标记成完成，用户是不会再回来看的。
    const rawCompleted = bool(params, 'completed') ?? completedWord(str(params, 'completed'));
    // 状态没填时要保持 undefined（= 没说），所以不能直接 normalizeStatus ——
    // 它认不出来一律给 'todo'，那会把一个正在做的任务悄悄退回未开始。
    const rawStatus = str(params, 'status') ? normalizeStatus(str(params, 'status')) : undefined;
    const { completed, status } = syncStatus(rawCompleted, rawStatus);

    const startRaw = str(params, 'start');
    const startMs = startRaw ? parseIso(startRaw, '开始时间') : undefined;
    const dueRaw = str(params, 'due');
    const dueMs = dueRaw ? parseIso(dueRaw, '截止时间') : undefined;
    const newSummary = str(params, 'summary');
    const remindMinutes = posInt(params, 'remind_minutes');
    const comment = str(params, 'comment');

    // 协作人的姓名解析放在**所有写操作之前**：解析失败就整个抛错，
    // 一个字段都没改。反过来的话用户会得到「截止时间改好了，但张三没加上」，
    // 而他重下指令又会把截止时间再改一遍。
    const followerNames = strList(params, 'followers');
    const followers = followerNames.map((n) => resolvePerson(n, ctx));

    if (
      completed === undefined &&
      status === undefined &&
      startMs === undefined &&
      dueMs === undefined &&
      !newSummary &&
      remindMinutes === undefined &&
      !comment &&
      followers.length === 0
    ) {
      throw new Error(
        `没说清要把「${target.title}」这个任务改成什么。` +
          '可以说：标记完成、改状态、改开始/截止时间、加协作人、设提醒、或者写一条评论。'
      );
    }

    const done: string[] = [];
    const failed: string[] = [];

    // ── 1. patch：标题 / 起止 / 完成状态 ──
    // `update_fields` 是飞书这个接口的核心约定：**只有列在里面的字段会被改**，
    // 而列了名字却没给值 = 把那个字段清空。所以两者必须严格配对，
    // 绝不能"顺手多列一个" —— 那会静默清掉用户的截止时间。
    const updateFields: string[] = [];
    const taskPatch: Record<string, unknown> = {};
    if (newSummary) {
      updateFields.push('summary');
      taskPatch.summary = newSummary;
    }
    if (startMs !== undefined) {
      updateFields.push('start');
      taskPatch.start = { timestamp: toTaskTimestamp(startMs), is_all_day: false };
    }
    if (dueMs !== undefined) {
      updateFields.push('due');
      taskPatch.due = { timestamp: toTaskTimestamp(dueMs), is_all_day: false };
    }
    if (completed !== undefined) {
      updateFields.push('completed_at');
      // 完成 = 写一个时刻（毫秒），取消完成 = 写 "0"。飞书就是这么表达的，
      // 没有单独的 completed 布尔字段。
      taskPatch.completed_at = completed ? String(Date.now()) : '0';
    }

    if (updateFields.length) {
      try {
        await ctx.client.task.v2.task.patch({
          path: { task_guid: guid },
          params: { user_id_type: 'open_id' },
          data: { task: taskPatch, update_fields: updateFields },
        });
        if (newSummary) done.push(`标题改成「${newSummary}」`);
        if (startMs !== undefined) done.push(`开始时间改成 ${fmtForHuman(startMs)}`);
        if (dueMs !== undefined) done.push(`截止时间改成 ${fmtForHuman(dueMs)}`);
        if (completed === true) done.push('已标记完成');
        if (completed === false) done.push('已重新打开');
      } catch (e) {
        // 这里自己 catch 了，走不到 dispatcher 的收口，所以要自己翻译原文。
        failed.push(`改任务本身失败：${describeFeishuError(e, ctx.appId)}`);
      }
    }

    // ── 2. 协作人 ──
    if (followers.length) {
      try {
        await ctx.client.task.v2.task.addMembers({
          path: { task_guid: guid },
          params: { user_id_type: 'open_id' },
          data: {
            // role 用 follower（关注人）而不是 assignee：用户说「把张三也加进来」
            // 时想要的是"让他知道/一起跟"，而多设一个负责人会改变这个任务归谁。
            // 真要换负责人是另一件事，让他明确说。
            members: followers.map((p) => ({ id: p.openId, type: 'user', role: 'follower' })),
            // 幂等键。stepIndex 放在**前面**是因为末尾要截断（50 字上限，
            // message_id 就占 35 字）：万一哪天的 id 变长，被截掉的是 id 尾巴，
            // 而不是那个区分步骤的数字 —— 后者被截掉的话，一条指令里的两步会
            // 共用同一个 token，飞书静默判重，我们却回帖说「加了协作人」。
            client_token: `mmpla:${ctx.stepIndex ?? 0}:m:${ctx.messageId}`.slice(0, 50),
          },
        });
        const via = followers.some((p) => p.from === 'directory') ? '（按通讯录姓名匹配）' : '';
        done.push(`加了协作人：${followers.map((p) => p.name).join('、')}${via}`);
      } catch (e) {
        failed.push(`加协作人失败：${describeFeishuError(e, ctx.appId)}`);
      }
    }

    // ── 3. 提醒 ──
    if (remindMinutes !== undefined) {
      try {
        await ctx.client.task.v2.task.addReminders({
          path: { task_guid: guid },
          params: { user_id_type: 'open_id' },
          // 任务这边的字段是 relative_fire_minute，日程那边叫 minutes —— 不通用。
          data: { reminders: [{ relative_fire_minute: remindMinutes }] },
        });
        done.push(`设了提醒：截止前 ${remindMinutes} 分钟`);
      } catch (e) {
        // 提醒有个前置条件：任务必须先有截止时间，否则"提前 N 分钟"无从计算。
        // 飞书的报错不会说这件事，而这是最常见的失败原因 —— 用户看到原文
        // 完全无从下手，所以补一句。
        const hasDue = dueMs !== undefined || target.row?.end_ms != null || !!target.data.due;
        const hint = hasDue
          ? ''
          : '（任务要先有截止时间才能设提醒，可以说「截止改到周五、提前一小时提醒」）';
        failed.push(`设提醒失败${hint}：${describeFeishuError(e, ctx.appId)}`);
      }
    }

    // ── 4. 评论 ──
    if (comment) {
      try {
        await ctx.client.task.v2.comment.create({
          params: { user_id_type: 'open_id' },
          // 评论是机器人发的，所以要署名是谁说的：任务下面一条没有主人的评论，
          // 别人不知道该找谁确认。
          data: {
            content: ctx.senderName?.trim()
              ? `${ctx.senderName.trim()}：${comment}`
              : comment,
            resource_type: 'task',
            resource_id: guid,
          },
        });
        done.push(`写了一条评论：${comment.length > 30 ? comment.slice(0, 30) + '…' : comment}`);
      } catch (e) {
        failed.push(`写评论失败：${describeFeishuError(e, ctx.appId)}`);
      }
    }

    // 只写那些**飞书这边确实改成了**的字段：patch 整体失败时 done 里没有它们，
    // 这里也就不写 —— 库和甘特图不该显示一个飞书上没生效的值。
    const patchLanded = updateFields.length > 0 && !failed.some((f) => f.startsWith('改任务本身失败'));
    // 状态是**我们自己的字段**（飞书那边只有"完成/未完成"这一个布尔），所以
    // 「那个任务取消了」这类只改状态的指令一次飞书接口都不用调 —— 它照样是一次
    // 真实的改动，不能算进下面「一处都没改成」里。（漏了这一条的表现是
    // 「取消」「改成进行中」全都报错，而用户看不出为什么「标记完成」就行。）
    const statusLanded =
      status !== undefined && !!target.row && (completed === undefined || patchLanded);

    // 一件都没做成 = 整体失败。回「已更新」是在假装成功。
    // 注意这个判断在写库之前：飞书那边一处都没改成的话，库里也不该改 ——
    // 否则甘特图会显示一个飞书上并不存在的状态。
    if (done.length === 0 && !statusLanded) {
      // 只说了状态、而这条任务只在执行日志里（068 之前建的，库里没有行）——
      // 状态是库里的字段，没有行就无处可写。这不是失败，是**存不下**，
      // 所以话要说成「怎么办」而不是「出错了」。
      if (!failed.length && status !== undefined && !target.row) {
        throw new Error(
          `「${target.title}」是旧版本建的任务，我这边没有它的状态可以改。\n` +
            '可以说「标记完成」（这个直接改飞书任务），或者重新派一个任务。'
        );
      }
      throw new Error(`「${target.title}」一处都没改成。\n${failed.join('\n')}`);
    }

    // ── 5. 写回库 + 重推甘特图 ──
    let ganttUrl = '';
    let statusWritten = false;
    if (target.row) {
      try {
        store.updateTask(target.row.id, {
          ...(patchLanded && newSummary ? { title: newSummary } : {}),
          ...(patchLanded && startMs !== undefined ? { startMs } : {}),
          ...(patchLanded && dueMs !== undefined ? { endMs: dueMs } : {}),
          ...(statusLanded ? { status } : {}),
        });
        statusWritten = statusLanded;
        const project = target.row.project_id ? store.getProjectById(target.row.project_id) : undefined;
        if (project) {
          const push = await bitable.pushTasks(ctx.client, project);
          if (push.warning) failed.push(push.warning);
          else ganttUrl = bitable.taskTableUrl(project);
        }
      } catch (e) {
        // 库写失败**通常**不该把「已改」变成失败：飞书那边已经生效了。
        // 但只改状态那条路上飞书压根没被调过 —— 库写失败就意味着一件事都没成，
        // 此时回「✅ 已更新」是纯粹的假成功，得抛出去让用户重说。
        if (done.length === 0) {
          throw new Error(`「${target.title}」的状态没改成：${(e as Error).message}`);
        }
        failed.push(`⚠️ 飞书那边已改好，但项目任务表没跟上（${(e as Error).message}），甘特图上还是旧的。`);
      }
    }

    const parts = [`✅ 已更新任务：**${newSummary || target.title}**`, ...done.map((d) => `· ${d}`)];
    // 只在**确实写进去了**的时候说。rawStatus 那个条件是为了不把 completed
    // 反推出来的状态重复播报一遍（上面 done 里已经有「已标记完成」了）。
    if (statusWritten && rawStatus !== undefined) {
      parts.push(`· 状态改成${statusLabel(status!)}`);
    }
    if (failed.length) {
      // 做成了一半时必须说清哪些已生效，否则用户整条重下会把成功那部分再做一遍
      //（评论会写两条、协作人无所谓、但截止时间可能被改回去）。
      parts.push(
        `⚠️ 但下面这些没做成（上面那几条**已经生效**了，重下指令请只补这部分）：`,
        ...failed
      );
    }
    const url = target.row?.url || (typeof target.data.url === 'string' ? target.data.url : '');
    if (url) parts.push(`[在飞书中打开](${url})`);
    if (ganttUrl) parts.push(`[项目甘特图](${ganttUrl})`);

    return {
      summary: parts.join('\n'),
      data: {
        guid,
        // 改过名之后要存**新**标题：下次用户会用新名字来称呼它，
        // 而日志那条反查路径读的就是这个字段（见 recent.ts 的 titleOf）。
        title: newSummary || target.title,
        url,
        changed: done,
        failed,
      },
    };
  },
};
