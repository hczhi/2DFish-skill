import {
  type ActionDef,
  type ActionContext,
  bool,
  posInt,
  requireStr,
  str,
  strList,
} from './types.js';
import { DEFAULT_TIMEZONE, fmtForHuman, parseIso, toEventTimestamp } from './time.js';
import { describeFeishuError } from '../feishuError.js';
import { resolveAudience } from './people.js';
import { asRepeatKind, buildRecurrence } from './recurrence.js';

/**
 * 创建飞书日程，并把相关的人加成参与人。
 *
 * ── 为什么是「机器人建日程 + 邀请你」而不是「在你日历上建日程」 ──
 * 日历接口的当前身份由 token 类型决定，且必须对目标日历有 writer/owner 权限。
 * 用 tenant_access_token 拿到的 primary 日历是**机器人自己那本**，
 * 想把日程真正建在用户自己的主日历上、并让用户当组织者，只有 user_access_token 一条路
 * （SDK 明确不托管 user token，得自己实现 OAuth + refresh，且每个用户都要授权一次）。
 * 本实现走免 OAuth 的路线：机器人在自己主日历上建日程，把用户加成参与人，
 * 用户在飞书里收到日程邀请。代价是组织者显示为机器人。
 *
 * 注意 primary 是 **POST** 不是 GET（很容易写错），机器人对自己的 primary
 * 天然是 owner，所以不需要先自建一本日历。
 *
 * 参与人必须与组织者同租户——自建应用本来就只在本租户内可用，这个限制天然满足。
 */
export const createCalendarEventAction: ActionDef = {
  name: 'create_calendar_event',
  description:
    '创建一个日程/会议，并邀请相关的人。下达指令的人一定会被加为参与人；' +
    '指令里提到要叫上的同事，把他们的**姓名**填进 attendees。',
  params: {
    summary: '必填。日程标题。',
    start: '必填。开始时间，ISO 8601 带时区偏移，如 2026-08-05T15:00:00+08:00。',
    end: '可选。结束时间，同样格式。没说结束时间就留空（默认为开始后 1 小时）。',
    description: '可选。日程说明。',
    attendees:
      '可选。要邀请的同事姓名数组，如 ["张三","李四"]，原样填用户说的名字，不要填 open_id。' +
      '下达指令的人不用写（他一定会被加进去）。没提到别人就留空。',
    attendee_departments:
      '可选。要整个部门参加时填部门名数组，如 ["销赞云事业部"]。' +
      '会自动包含子部门里的在职同事，你不用自己展开。没提到部门就留空。',
    video_meeting:
      '可选，布尔。用户说了「线上开」「视频会议」「远程」「腾讯会议/飞书会议」' +
      '这类话时填 true，会自动带上一个飞书视频会议链接。没提到就留空（不要默认开）。',
    location:
      '可选。开会地点，如 "三楼会议室" / "客户现场"。' +
      '只有用户明确说了地点才填；说的是「线上」就不是地点，改填 video_meeting。',
    remind_minutes:
      '可选，整数。提前几分钟提醒，如用户说「提前十分钟提醒我」就填 10。' +
      '他没提到提醒就留空（不要自己设一个默认值）。',
    repeat:
      '可选。**只有用户明确说了这是周期性的**（「每周」「每天」「每月」「例会」' +
      '「双周会」）才填，四个值之一：daily / weekly / biweekly / monthly。' +
      '说「下周一开会」是**一次**会议，不是每周重复 —— 这种情况必须留空。',
    repeat_until:
      '可选。重复到哪天为止，ISO 8601，如 2026-12-31T18:00:00+08:00。' +
      '用户说了「到年底」「到项目结束」这类话时填。没说就留空（那就是长期重复）。',
  },
  examples: [
    '明天下午三点开个需求评审会',
    '周四上午十点到十一点半，和 @张三 @李四 过一下方案',
    '下周一早上九点提醒我做周计划',
    '约个会，明天上午十点，叫上王五和赵六',
    '给销赞云事业部创建一个日程：周五早上九点半开会，半小时',
    '明天上午十点线上开个会，提前十分钟提醒我',
    '每周一早上九点半开例会，在三楼会议室',
    '下周三下午两点在客户现场评审，叫上 @张三',
  ],
  scopes: [
    'calendar:calendar:readonly',
    'calendar:calendar.event:create',
    'calendar:calendar.event:update',
  ],
  async run(params: Record<string, unknown>, ctx: ActionContext) {
    const summary = requireStr(params, 'summary', '日程标题');
    const startRaw = requireStr(params, 'start', '开始时间');
    const description = str(params, 'description');

    const startMs = parseIso(startRaw, '开始时间');
    const endRaw = str(params, 'end');

    const location = str(params, 'location');
    const wantsVideo = bool(params, 'video_meeting') === true;
    const remindMinutes = posInt(params, 'remind_minutes');
    // 重复规则在**代码里**拼，模型只回答一个枚举 —— 它写错 RRULE 的方式不是报错，
    // 而是建出一个规律不对的重复日程，而回帖说的是「已创建」。见 recurrence.ts。
    // 认不出来的值当作没说：多出一个无限重复的日程比少一个更难收拾。
    const repeat = asRepeatKind(str(params, 'repeat'));
    // repeat_until 的解析失败会抛错（在 buildRecurrence 里），但只在真的要重复时
    // 才走到那儿 —— 没说重复却给了 until 是模型的噪音，忽略掉。
    const recurrence = repeat
      ? buildRecurrence(repeat, startMs, str(params, 'repeat_until'))
      : undefined;

    // 参与人 = 发言人 + @ 到的人 + attendees 里点名的人 + 点名部门里的在职同事（去重）。
    // 发言人必须在，否则他自己看不到这个日程 —— 所以**不**排除发起人，
    // 这一点和群发消息正好相反。
    //
    // 姓名/部门解析**放在建日程之前**：解析失败会抛错，
    // 而建完日程再抛错就留下一个没人参加的孤儿日程，用户还得手动去删。
    const people = new Map<string, string>([[ctx.senderOpenId, ctx.senderName || '你']]);
    for (const m of ctx.mentions) people.set(m.openId, m.name);

    const names = strList(params, 'attendees');
    const departments = strList(params, 'attendee_departments');
    if (names.length || departments.length) {
      const audience = resolveAudience({ names, departments }, ctx);
      for (const p of audience.members) people.set(p.openId, p.name);
    }
    // 没给结束时间就默认一小时。日程接口 end_time 是必填的，
    // 而用户说「明天三点开会」时几乎不会提结束时间。
    let endMs = endRaw ? parseIso(endRaw, '结束时间') : startMs + 60 * 60 * 1000;
    if (endMs <= startMs) endMs = startMs + 60 * 60 * 1000;

    // 机器人自己的主日历。POST 不是 GET；tenant token 下不能传 user_id_type=user_id。
    const primary = await ctx.client.calendar.v4.calendar.primary({
      params: { user_id_type: 'open_id' },
    });
    const calendarId = primary.data?.calendars?.[0]?.calendar?.calendar_id;
    if (!calendarId) {
      throw new Error(
        '取不到机器人的主日历。请确认该飞书应用已开启「机器人」能力，并已开通日历相关权限。'
      );
    }

    const created = await ctx.client.calendar.v4.calendarEvent.create({
      path: { calendar_id: calendarId },
      data: {
        summary,
        ...(description ? { description } : {}),
        start_time: { timestamp: toEventTimestamp(startMs), timezone: DEFAULT_TIMEZONE },
        end_time: { timestamp: toEventTimestamp(endMs), timezone: DEFAULT_TIMEZONE },
        // 让参与人能看到彼此，符合「拉个会」的预期
        attendee_ability: 'can_see_others',
        // 视频会议链接。`vc` = 飞书自己的视频会议，链接由飞书在建日程时生成，
        // 我们不需要（也不能）自己造一个会议号。
        ...(wantsVideo ? { vchat: { vc_type: 'vc' as const } } : {}),
        ...(location ? { location: { name: location } } : {}),
        // 提醒是**相对开始时间**的分钟数。飞书这个字段叫 minutes 而不是
        // relative_fire_minute（任务那边才是后者），两边不通用。
        ...(remindMinutes !== undefined ? { reminders: [{ minutes: remindMinutes }] } : {}),
        ...(recurrence ? { recurrence: recurrence.rule } : {}),
      },
    });

    const event = created.data?.event;
    const eventId = event?.event_id;
    if (!eventId) throw new Error('日程创建成功但飞书未返回 event_id，无法添加参与人。');

    const openIds = [...people.keys()].filter(Boolean);

    // 加参与人是独立接口——create 只建日程，不会顺带把人加进去。
    // 这一步失败不该让整个动作算失败：日程已经建好了，回帖必须把实情说清楚，
    // 否则用户以为没成功、再说一遍，就会建出第二个日程。
    let attendeeError = '';
    try {
      await ctx.client.calendar.v4.calendarEventAttendee.create({
        path: { calendar_id: calendarId, event_id: eventId },
        params: { user_id_type: 'open_id' },
        data: {
          attendees: openIds.map((id) => ({ type: 'user', user_id: id })),
          need_notification: true,
        },
      });
    } catch (e) {
      // 这条分支自己 catch 了，走不到 dispatcher 的错误收口，所以要自己提取原文。
      // 这里最常见的失败就是缺 calendar 权限，所以带上 appId 以便给出申请链接。
      attendeeError = describeFeishuError(e, ctx.appId);
    }

    const attendeeNames = [...people.values()].filter(Boolean);
    const parts = [
      `📅 日程已创建：**${summary}**`,
      `时间：${fmtForHuman(startMs)} — ${fmtForHuman(endMs)}`,
    ];
    // 重复日程必须**明说**，而且要说清怎么收场。
    //
    // 「每周一早会」建出来的是一串日程，删起来比建起来麻烦得多（尤其在
    // 十几个人的日历上）。而如果模型误判了（用户只想开一次），静默建成重复
    // 就是这个动作里最贵的错误：用户下周才发现，那时已经有一屋子人收到了邀请。
    // 说出来的话他当场就能纠正。
    if (recurrence) {
      parts.push(
        `🔁 这是**重复日程**：${recurrence.human}。` +
          (recurrence.bounded ? '' : '没有结束日期，不需要的话请在飞书里删掉整个重复日程。')
      );
    }
    if (location) parts.push(`地点：${location}`);
    if (remindMinutes !== undefined) parts.push(`提醒：开始前 ${remindMinutes} 分钟`);
    // 会议链接由飞书生成。拿不到时要说一句：用户会照着回帖去找那个链接，
    // 而「说了线上开、回帖没提」比「回帖说没生成」更让人以为是自己没看见。
    if (wantsVideo) {
      const url = event?.vchat?.meeting_url;
      parts.push(
        url
          ? `视频会议：${url}`
          : '⚠️ 视频会议链接没生成（可能是应用没开视频会议权限），日程里请自行改成线上。'
      );
    }
    if (attendeeError) {
      parts.push(`⚠️ 但添加参与人失败了，你可能收不到这个日程邀请：${attendeeError}`);
    } else if (attendeeNames.length > 10) {
      // 整个部门参会时名字列表会长到把回帖淹掉。给出人数 + 前几个名字，
      // 完整名单在日志的 attendees 里 —— 但人数必须给，用户要据此判断范围对不对。
      parts.push(
        `参与人：${attendeeNames.length} 人（${attendeeNames.slice(0, 10).join('、')} 等）`
      );
    } else {
      parts.push(`参与人：${attendeeNames.join('、')}`);
    }
    if (event?.app_link) parts.push(`[在飞书中打开](${event.app_link})`);

    return {
      summary: parts.join('\n'),
      data: {
        event_id: eventId,
        calendar_id: calendarId,
        // 标题存一份：改/删日程时要靠它反查「用户说的是哪个日程」，
        // 而从回帖文案里剥标题只是给老日志行的兜底，见 actions/recent.ts。
        title: summary,
        app_link: event?.app_link,
        attendees: openIds,
        attendee_error: attendeeError || undefined,
        ...(location ? { location } : {}),
        ...(wantsVideo ? { meeting_url: event?.vchat?.meeting_url ?? null } : {}),
        ...(remindMinutes !== undefined ? { remind_minutes: remindMinutes } : {}),
        ...(recurrence ? { recurrence: recurrence.rule } : {}),
      },
    };
  },
};
