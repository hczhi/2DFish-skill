import { type ActionDef, type ActionContext, bool, posInt, str, strList } from './types.js';
import { DEFAULT_TIMEZONE, fmtForHuman, parseIso, toEventTimestamp } from './time.js';
import { describeFeishuError } from '../feishuError.js';
import { resolveAudience } from './people.js';
import { findRecentTarget } from './recent.js';

/**
 * 改一个已经建好的日程：改时间 / 改标题 / 改地点 / 改提醒 / 加参与人。
 *
 * 「哪个日程」和 update_task 是同一套解法：event_id + calendar_id 只从执行日志里
 * 反查，绝不经过 LLM，查到多条不挑（见 actions/recent.ts）。
 *
 * ── 只能改助理自己建的 ──
 * 和任务同理，而日历这边还多一层：`calendarEvent.patch` 要求当前身份对目标日历有
 * writer/owner 权限，机器人只对**自己那本主日历**有。用户自己建的日程既查不到
 * 也改不动。所以话术仍然是「我只能改我自己帮你建的那些」。
 *
 * ── 为什么改时间不用重建 ──
 * 「把明天的评审推到下午四点」如果实现成"删了重建"，所有参与人会收到一次取消
 * 通知 + 一次新邀请，而且新日程的 event_id 变了、之前的接受状态全部作废。
 * patch 只发一次变更通知，参与人不用重新接受。
 */
export const updateCalendarEventAction: ActionDef = {
  name: 'update_calendar_event',
  description:
    '修改助理之前帮用户建过的某个日程/会议：改时间、改标题、改地点、改提醒、' +
    '再加几个参与人。**只能改助理自己建过的日程**，用户自己在飞书日历里建的改不了。' +
    '必须用 event 参数说清是哪个日程。' +
    '注意：要取消/删掉日程用 delete_calendar_event，不要用这个动作。',
  params: {
    event:
      '必填。要改的是哪个日程，填用户话里提到的**日程标题**（或其中一段，' +
      '如「需求评审」）。原样照抄他说的字。他只说了「那个会」而没给名字时留空 ——' +
      '系统会把最近建过的列给他挑。',
    start:
      '可选。新的开始时间，ISO 8601 带时区偏移，如 2026-08-07T16:00:00+08:00。' +
      '用户说「推到下午四点」「改到周五上午」时填。没提到就留空。',
    end: '可选。新的结束时间，同样格式。只改了开始时间时可以留空（会保持原时长）。',
    summary: '可选。新的日程标题。用户没说要改名就留空。',
    location:
      '可选。新的开会地点，如 "五楼会议室"。用户说「换到五楼会议室」时填。' +
      '没提到就留空（留空不会清掉原来的地点）。',
    remind_minutes: '可选，整数。改成提前几分钟提醒，如「改成提前半小时提醒」就填 30。',
    video_meeting: '可选，布尔。用户说「改成线上开」时填 true，会补一个飞书视频会议链接。',
    attendees:
      '可选。要**追加**的参与人姓名数组，如 ["王五"]，原样填名字不要填 open_id。' +
      '用户说「把王五也叫上」时填。这只会加人，不会踢人。',
    attendee_departments: '可选。要追加整个部门时填部门名数组，如 ["销赞云事业部"]。',
  },
  examples: [
    '需求评审那个会推到明天下午四点',
    '刚才那个日程改到五楼会议室',
    '周四的方案讨论把 @王五 也叫上',
    '例会改成提前半小时提醒我',
    '需求评审改个名字，叫「V2 需求评审」',
  ],
  scopes: [
    'calendar:calendar:readonly',
    // 读一次原时长（只给了新开始时间时要用），缺了不会失败但会退回默认一小时 ——
    // 所以它必须出现在接入清单里，否则「推到四点」会静默把 90 分钟的会缩成 60 分钟。
    'calendar:calendar.event:read',
    'calendar:calendar.event:update',
    // 追加参与人走的是 attendee 接口，和建日程时同一个权限。
    'calendar:calendar.event:create',
  ],
  async run(params: Record<string, unknown>, ctx: ActionContext) {
    const target = findRecentTarget(str(params, 'event'), ctx, {
      // 把自己也列进来：改过标题之后用户会用**新**名字称呼它。
      actions: ['create_calendar_event', 'update_calendar_event'],
      label: '日程',
      requireKeys: ['event_id', 'calendar_id'],
      deletedBy: ['delete_calendar_event'],
    });
    const eventId = String(target.data.event_id);
    const calendarId = String(target.data.calendar_id);

    const startRaw = str(params, 'start');
    const endRaw = str(params, 'end');
    const startMs = startRaw ? parseIso(startRaw, '开始时间') : undefined;
    let endMs = endRaw ? parseIso(endRaw, '结束时间') : undefined;
    const newSummary = str(params, 'summary');
    const location = str(params, 'location');
    const remindMinutes = posInt(params, 'remind_minutes');
    const wantsVideo = bool(params, 'video_meeting') === true;

    const names = strList(params, 'attendees');
    const departments = strList(params, 'attendee_departments');
    // 姓名解析放在**所有写操作之前**，和建日程一样：解析失败就整个抛错，
    // 日程还是原样，用户 @ 一下再说一遍即可。
    const extra =
      names.length || departments.length
        ? resolveAudience({ names, departments }, ctx).members
        : [];

    if (
      startMs === undefined &&
      endMs === undefined &&
      !newSummary &&
      !location &&
      remindMinutes === undefined &&
      !wantsVideo &&
      extra.length === 0
    ) {
      throw new Error(
        `没说清要把「${target.title}」这个日程改成什么。` +
          '可以说：改时间、改标题、改地点、改提醒、或者再叫上谁。'
      );
    }

    // 只给了新开始时间时，得把结束时间跟着挪 —— 否则「10:00-11:00 的会推到 16:00」
    // 会变成 16:00-11:00（结束早于开始），飞书要么报错要么建出一个诡异的日程。
    // 原时长只能从飞书那边读，日志里没存。读不到就退回一小时。
    if (startMs !== undefined && endMs === undefined) {
      let durationMs = 60 * 60 * 1000;
      try {
        const got = await ctx.client.calendar.v4.calendarEvent.get({
          path: { calendar_id: calendarId, event_id: eventId },
        });
        const s = Number(got.data?.event?.start_time?.timestamp);
        const e = Number(got.data?.event?.end_time?.timestamp);
        if (Number.isFinite(s) && Number.isFinite(e) && e > s) durationMs = (e - s) * 1000;
      } catch {
        // 读不到就用一小时。这里**不能**因为读失败就放弃改时间：用户要的是"推到
        // 四点"，给他一个时长可能不对的四点的会，比什么都不改要接近他的意图，
        // 而回帖会把最终时间写全，时长不对他当场看得见。
      }
      endMs = startMs + durationMs;
    }
    if (startMs !== undefined && endMs !== undefined && endMs <= startMs) {
      endMs = startMs + 60 * 60 * 1000;
    }

    const patch: Record<string, unknown> = {};
    if (newSummary) patch.summary = newSummary;
    if (startMs !== undefined) {
      patch.start_time = { timestamp: toEventTimestamp(startMs), timezone: DEFAULT_TIMEZONE };
    }
    if (endMs !== undefined) {
      patch.end_time = { timestamp: toEventTimestamp(endMs), timezone: DEFAULT_TIMEZONE };
    }
    if (location) patch.location = { name: location };
    if (remindMinutes !== undefined) patch.reminders = [{ minutes: remindMinutes }];
    if (wantsVideo) patch.vchat = { vc_type: 'vc' as const };

    const done: string[] = [];
    const failed: string[] = [];
    let meetingUrl: string | undefined;

    // 只传要改的字段。飞书这个接口是「传了才改」，没传的保持原样 ——
    // 所以上面那些 if 一个都不能改成无条件赋值，否则会把没提到的字段清空。
    if (Object.keys(patch).length) {
      try {
        const res = await ctx.client.calendar.v4.calendarEvent.patch({
          path: { calendar_id: calendarId, event_id: eventId },
          data: patch,
        });
        meetingUrl = res.data?.event?.vchat?.meeting_url ?? undefined;
        if (newSummary) done.push(`标题改成「${newSummary}」`);
        if (startMs !== undefined && endMs !== undefined) {
          done.push(`时间改成 ${fmtForHuman(startMs)} — ${fmtForHuman(endMs)}`);
        } else if (endMs !== undefined) {
          done.push(`结束时间改成 ${fmtForHuman(endMs)}`);
        }
        if (location) done.push(`地点改成 ${location}`);
        if (remindMinutes !== undefined) done.push(`提醒改成开始前 ${remindMinutes} 分钟`);
        if (wantsVideo) {
          done.push(meetingUrl ? `已改成线上，会议链接：${meetingUrl}` : '已改成线上视频会议');
        }
      } catch (e) {
        failed.push(`改日程失败：${describeFeishuError(e, ctx.appId)}`);
      }
    }

    // 追加参与人是独立接口（和建日程时一样），所以这里也可能部分成功。
    if (extra.length) {
      try {
        await ctx.client.calendar.v4.calendarEventAttendee.create({
          path: { calendar_id: calendarId, event_id: eventId },
          params: { user_id_type: 'open_id' },
          data: {
            attendees: extra.map((p) => ({ type: 'user', user_id: p.openId })),
            need_notification: true,
          },
        });
        done.push(`加了参与人：${extra.map((p) => p.name).join('、')}`);
      } catch (e) {
        failed.push(`加参与人失败：${describeFeishuError(e, ctx.appId)}`);
      }
    }

    if (done.length === 0) {
      throw new Error(`「${target.title}」一处都没改成。\n${failed.join('\n')}`);
    }

    const parts = [`📅 已修改日程：**${target.title}**`, ...done.map((d) => `· ${d}`)];
    if (failed.length) {
      parts.push('⚠️ 但下面这些没做成（上面那几条**已经生效**了）：', ...failed);
    }
    // 改的是重复日程时要说一句：patch 改的是**整个重复序列**，不是某一次。
    // 用户想改的往往只是"这周那次"，而这件事飞书接口做不到（要改单次得先
    // 拆分实例）—— 不说的话他以为只动了一次，下周才发现每次都变了。
    if (typeof target.data.recurrence === 'string' && target.data.recurrence) {
      parts.push('🔁 这是**重复日程**，以上改动作用于整个系列（不是只改这一次）。');
    }
    if (typeof target.data.app_link === 'string' && target.data.app_link) {
      parts.push(`[在飞书中打开](${target.data.app_link})`);
    }

    return {
      summary: parts.join('\n'),
      data: {
        event_id: eventId,
        calendar_id: calendarId,
        // 标题要跟着改，否则下一句「再把 V2 需求评审推一下」按新名字反查不到 ——
        // 日志里存的还是旧标题。写的是最新的那个。
        title: newSummary || target.title,
        app_link: target.data.app_link,
        ...(meetingUrl ? { meeting_url: meetingUrl } : {}),
        ...(typeof target.data.recurrence === 'string'
          ? { recurrence: target.data.recurrence }
          : {}),
        changed: done,
        failed,
      },
    };
  },
};

/**
 * 删掉一个日程。
 *
 * ── 为什么和「改」分成两个动作 ──
 * 删是不可逆的，而且会给所有参与人发一次取消通知。放在 update 里当一个
 * `delete: true` 参数，意味着模型填错一个布尔就把会删了 —— 而 update 的其他
 * 参数填错最多是改歪一个字段。分成两个动作，模型要选中「删」才可能删。
 *
 * ── 回帖必须报出删的是哪一个 ──
 * 删完之后用户已经没法自己去核对了（日程不在了，通知里也只有标题）。
 * 所以回帖要把标题和原定时间都写出来 —— 万一删错了，他当场就能发现，
 * 还来得及重建。只回「已删除」等于让他没有任何机会发现搞错了。
 */
export const deleteCalendarEventAction: ActionDef = {
  name: 'delete_calendar_event',
  description:
    '取消/删除助理之前帮用户建过的某个日程。会给所有参与人发取消通知，且**不可撤销**。' +
    '只能删助理自己建过的日程。用户说「取消」「删掉」「不开了」某个会时用这个动作。',
  params: {
    event:
      '必填。要删的是哪个日程，填用户话里提到的**日程标题**（或其中一段）。' +
      '原样照抄他说的字。只说了「那个会」而没给名字时留空 —— 系统会列出来让他确认，' +
      '**不会**替他猜一个删掉。',
  },
  examples: ['需求评审那个会取消了', '把周四的方案讨论删掉', '明天那个例会不开了'],
  // 读一次是为了在回帖里说清删掉的是哪一场（见下面的注释），所以 read 也要开。
  scopes: [
    'calendar:calendar:readonly',
    'calendar:calendar.event:read',
    'calendar:calendar.event:delete',
  ],
  async run(params: Record<string, unknown>, ctx: ActionContext) {
    const target = findRecentTarget(str(params, 'event'), ctx, {
      actions: ['create_calendar_event', 'update_calendar_event'],
      label: '日程',
      requireKeys: ['event_id', 'calendar_id'],
      // 已经删过的不再出现在候选里，否则「取消那个会」会重复删一次，
      // 回帖说「已删除」而其实什么都没发生（更糟：参与人收到第二次取消通知）。
      deletedBy: ['delete_calendar_event'],
    });
    const eventId = String(target.data.event_id);
    const calendarId = String(target.data.calendar_id);

    // 删之前先读一次原定时间，只为了回帖能说清删掉的是哪一场。
    // 读失败不阻止删除（用户要的是删掉），但回帖里就少了时间这一项。
    let when = '';
    let wasRecurring = false;
    try {
      const got = await ctx.client.calendar.v4.calendarEvent.get({
        path: { calendar_id: calendarId, event_id: eventId },
      });
      const s = Number(got.data?.event?.start_time?.timestamp);
      if (Number.isFinite(s)) when = fmtForHuman(s * 1000);
      wasRecurring = Boolean(got.data?.event?.recurrence);
    } catch {
      /* 时间取不到就不写这一行 */
    }

    await ctx.client.calendar.v4.calendarEvent.delete({
      path: { calendar_id: calendarId, event_id: eventId },
      // 必须通知参与人。别人日历上已经有这个会了，静默删除会让他们照着一个
      // 不存在的会去开 —— 这个参数是字符串 "true" 不是布尔。
      params: { need_notification: 'true' },
    });

    const parts = [`🗑 已删除日程：**${target.title}**`];
    if (when) parts.push(`原定时间：${when}`);
    if (wasRecurring || typeof target.data.recurrence === 'string') {
      // 删重复日程删的是整个系列。这个后果比删单次大得多，必须点明。
      parts.push('🔁 这是重复日程，**整个系列**都删掉了。');
    }
    parts.push('参与人会收到取消通知。删错了的话需要重新建一个（删除不可撤销）。');

    return {
      summary: parts.join('\n'),
      data: { event_id: eventId, calendar_id: calendarId, title: target.title, deleted: true },
    };
  },
};
