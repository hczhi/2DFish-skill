import { type ActionDef, type ActionContext, bool, posInt, str, strList } from './types.js';
import { fmtForHuman, parseIso, toTaskTimestamp } from './time.js';
import { resolvePerson } from './people.js';
import { findRecentTarget } from './recent.js';
import { describeFeishuError } from '../feishuError.js';

/**
 * 任务的后续动作：标记完成 / 改截止时间 / 加协作人 / 设提醒 / 加一条评论。
 *
 * ── 「哪个任务」是这个动作真正的难点 ──
 * 飞书的 `task.patch` 要 guid，而**模型不知道 guid** —— 这和 open_id 是同一类
 * 问题，用同一套解法：guid 只从我们自己的执行日志里反查（建任务时存了它），
 * 限本应用、本发言人、最近 7 天。查到多条**绝不挑一个**。见 actions/recent.ts。
 *
 * ── 一条必须一直说清的限制 ──
 * **只能改助理自己帮他建的那些。** 用户在飞书里手动建的任务我们看不见：
 * 任务系统视角下 tenant token 就是另一个普通用户，`task.list` 只返回调用身份
 * 自己创建的东西，所以是安静地返回空、不是报错。查不到时的话术因此必须是
 * 「我只能改我自己帮你建的那些」，否则用户以为助理坏了，反复换措辞重试。
 *
 * ── 为什么是一个动作而不是五个 ──
 * 「把 X 标记完成，截止改到周五」是一句话里的一件事，拆成两个动作就要占两步
 * （MAX_STEPS = 3），而且两步之间不传数据（见 dispatcher），第二步得把同一个
 * 任务再反查一遍。合成一个动作则一次反查、一次回帖。
 *
 * ── 为什么四个飞书接口不能合成一个请求 ──
 * 飞书把它们分在四个接口上：`task.patch`（标题/描述/截止/完成状态）、
 * `addMembers`（协作人）、`addReminders`（提醒）、`comment.create`（评论）。
 * 于是这里必然是多次调用，也就必然可能**部分成功**。处理方式和按部门群发一样：
 * 做完所有能做的，然后把成功的和失败的一起说清楚 —— 中途 throw 会留下
 * 「改了一半、不知道改到哪」的状态，而用户重下指令会把成功那半再做一遍。
 */
/** 模型在 completed 上给的中文说法。bool() 之外的兜底，认不出来返回 undefined。 */
function completedWord(raw: string | undefined): boolean | undefined {
  if (!raw) return undefined;
  const t = raw.trim();
  if (['完成', '已完成', '做完了', '做完', '完成了'].includes(t)) return true;
  if (['未完成', '没做完', '重新打开', '取消完成', '还没完成'].includes(t)) return false;
  return undefined;
}

export const updateTaskAction: ActionDef = {
  name: 'update_task',
  description:
    '修改助理之前帮用户建过的某个任务：标记完成（或重新打开）、改截止时间、' +
    '加协作人/关注人、设提醒、写一条评论。' +
    '**只能改助理自己建过的任务**，用户在飞书里手动建的改不了。' +
    '必须用 task 参数说清是哪个任务（照用户说的标题填）。',
  params: {
    task:
      '必填。要改的是哪个任务，填用户话里提到的**任务标题**（或其中一段，' +
      '如「季度报告」）。原样照抄他说的字，不要自己翻译或补全。' +
      '他只说了「那个任务」而没给名字时，这里留空 —— 系统会把最近建过的列给他挑。',
    completed:
      '可选，布尔。用户说「做完了」「标记完成」「已完成」时填 true；' +
      '说「重新打开」「还没做完」「取消完成」时填 false。没提到完成状态就留空。',
    due:
      '可选。新的截止时间，ISO 8601 带时区偏移，如 2026-08-07T18:00:00+08:00。' +
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
    '刚才那个任务把 @张三 也加进来一起跟',
    '联系供应商那个任务提前一小时提醒我',
    '在季度报告任务下面记一句：数据还差三季度的',
    '季度报告那个任务重新打开，还没做完',
  ],
  scopes: ['task:task:write'],
  async run(params: Record<string, unknown>, ctx: ActionContext) {
    // 先确定改哪个。反查失败会抛错，此时一次接口都还没调 —— 用户重说是安全的。
    const target = findRecentTarget(str(params, 'task'), ctx, {
      // 把自己也列进来：改过标题之后，用户会用**新**名字来称呼它。
      actions: ['create_task', 'update_task'],
      label: '任务',
      requireKeys: ['guid'],
    });
    const guid = String(target.data.guid);

    // bool() 认的是 true/是/要 那一类；模型在这个参数上还会直接给「完成」
    //「已完成」，所以再兜一层。认不出来仍然是 undefined —— 不能猜成 true，
    // 把一个还没做的任务标记成完成，用户是不会再回来看的。
    const completed = bool(params, 'completed') ?? completedWord(str(params, 'completed'));

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
      dueMs === undefined &&
      !newSummary &&
      remindMinutes === undefined &&
      !comment &&
      followers.length === 0
    ) {
      throw new Error(
        `没说清要把「${target.title}」这个任务改成什么。` +
          '可以说：标记完成、改截止时间、加协作人、设提醒、或者写一条评论。'
      );
    }

    const done: string[] = [];
    const failed: string[] = [];

    // ── 1. patch：标题 / 截止 / 完成状态 ──
    // `update_fields` 是飞书这个接口的核心约定：**只有列在里面的字段会被改**，
    // 而列了名字却没给值 = 把那个字段清空。所以两者必须严格配对，
    // 绝不能"顺手多列一个" —— 那会静默清掉用户的截止时间。
    const updateFields: string[] = [];
    const taskPatch: Record<string, unknown> = {};
    if (newSummary) {
      updateFields.push('summary');
      taskPatch.summary = newSummary;
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
        const hint =
          dueMs === undefined && !target.data.due
            ? '（任务要先有截止时间才能设提醒，可以说「截止改到周五、提前一小时提醒」）'
            : '';
        failed.push(`设提醒失败${hint}：${describeFeishuError(e, ctx.appId)}`);
      }
    }

    // ── 4. 评论 ──
    if (comment) {
      try {
        await ctx.client.task.v2.comment.create({
          params: { user_id_type: 'open_id' },
          // 评论是机器人发的，所以要署名是谁说的 —— 和 send_message 同一个理由：
          // 任务下面一条没有主人的评论，别人不知道该找谁确认。
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

    // 一件都没做成 = 整体失败。回「已更新」是在假装成功。
    if (done.length === 0) {
      throw new Error(`「${target.title}」一处都没改成。\n${failed.join('\n')}`);
    }

    const parts = [`✅ 已更新任务：**${target.title}**`, ...done.map((d) => `· ${d}`)];
    if (failed.length) {
      // 做成了一半时必须说清哪些已生效，否则用户整条重下会把成功那部分再做一遍
      //（评论会写两条、协作人无所谓、但截止时间可能被改回去）。
      parts.push(
        `⚠️ 但下面这些没做成（上面那几条**已经生效**了，重下指令请只补这部分）：`,
        ...failed
      );
    }
    if (typeof target.data.url === 'string' && target.data.url) {
      parts.push(`[在飞书中打开](${target.data.url})`);
    }

    return {
      summary: parts.join('\n'),
      data: {
        guid,
        title: target.title,
        url: target.data.url,
        changed: done,
        failed,
      },
    };
  },
};
