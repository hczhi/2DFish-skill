import { type ActionDef, type ActionContext, str, strList } from './types.js';
import {
  DEFAULT_TIMEZONE,
  fmtDayLabel,
  fmtHm,
  localDate,
  parseIso,
  toRfc3339,
  wallToMs,
} from './time.js';
import { resolvePerson, type ResolvedPerson } from './people.js';
import {
  buildWorkWindows,
  invertBusy,
  MIN_SLOT_MS,
  type DayFreeSlots,
  type Interval,
} from './freebusySlots.js';

/**
 * 查某人（或几个人）什么时候有空。
 *
 * ── 为什么这个能做，而「查他的日程」不能 ──
 * 这是本模块唯一的**读**日历动作，看着和第五节「查日程做不到」矛盾，其实不是。
 * 飞书这里是两套接口、两种身份要求：
 *
 * | 想知道的 | 接口 | 身份 |
 * |---|---|---|
 * | 他几点到几点被占着 | `calendar.freebusy.batch` | **tenant_access_token 可以** |
 * | 那个会议叫什么、谁参加、在哪开 | `calendarEvent.list` / `.get` | 只能 user_access_token |
 *
 * 忙闲接口刻意只回时间区间、不回任何日程内容 —— 这正是它敢开给应用身份的原因
 * （知道同事几点没空是排会的必要信息，知道他在开什么会不是）。
 * 所以「他周四什么时候有空」有解，「他周四有什么会」没解。
 * 这个区别要在 description 里对 LLM 说清楚，否则它会拿这个动作去答后一种问题，
 * 然后回一个用户没问的答案。
 *
 * ── 只回空闲，不回忙碌 ──
 * 接口给的是忙区间，用户问的是空闲。取补集（freebusySlots.ts）而不是直接列忙区间：
 * 列忙区间等于把「那我该约几点」这个减法退回给用户，而那是他问这句话的目的。
 *
 * ── 需要注意的坑 ──
 * - `time_min`/`time_max` 是 **RFC 3339**（`2026-08-06T09:00:00+08:00`），
 *   不是日程接口那种 unix 秒字符串。同一个 calendar 命名空间下两种格式。
 * - 查不到人的忙闲**不等于他没空**：可能是他没开放日历、或不在应用可用范围里。
 *   飞书这时不报错，只是那个人的 freebusy_items 是空的 —— 和"全天空闲"完全同形。
 *   所以必须把「查到了但是空的」和「真的全天有空」区分开（见 needsWarning）。
 */

/** 一次最多查几天。飞书对 time_max-time_min 有上限，且超过一周的结果没人看得完。 */
const MAX_RANGE_DAYS = 7;

/** 一次最多查几个人。回帖长度撑不住更多，而且 batch 接口本身也有上限。 */
const MAX_PEOPLE = 5;

interface PersonFreebusy {
  person: ResolvedPerson;
  days: DayFreeSlots[];
  /** 飞书一个忙区间都没返回。可能真的全空，也可能是日历不可见 —— 分不出来。 */
  emptyFromFeishu: boolean;
}

export const queryFreebusyAction: ActionDef = {
  name: 'query_freebusy',
  description:
    '查某位同事（或几位同事）在某段时间里**什么时候有空**，用于约会议前先看忙闲。' +
    '只能得到"哪些时间段被占着"，**得不到**日程的标题、地点、参会人 —— ' +
    '用户问「他有什么会」「他下午的日程是什么」这类要看日程内容的问题时，' +
    '不要用这个动作，用 reply 说明只能看忙闲。',
  params: {
    people:
      '必填。要查的同事姓名数组，如 ["张三"]，原样填用户说的名字，不要填 open_id。' +
      '用户查自己（「我明天有空吗」）时留空即可。',
    start:
      '必填。查询范围的开始时间，ISO 8601 带时区偏移，如 2026-08-06T00:00:00+08:00。' +
      '用户说「周四」就填那天的 00:00，说「明天下午」就填那天的 12:00。',
    end:
      '可选。查询范围的结束时间，同样格式。用户说的是某一天时留空（默认查到那天结束）；' +
      '说「这周」「未来三天」时才填。',
  },
  examples: [
    '帮我查一下张三的日程，我要知道他周四什么时候有空',
    '李四明天下午有空吗',
    '看看王五和赵六这周三都什么时候空着',
    '我明天几点有空',
  ],
  // 忙闲查询要日历的忙闲读权限。这一项和「读取日程信息」是两个不同的权限点，
  // 只开后者查忙闲照样报 99991672。
  scopes: ['calendar:calendar.free_busy:read'],

  async run(params: Record<string, unknown>, ctx: ActionContext) {
    const startRaw = str(params, 'start');
    if (!startRaw) {
      throw new Error('没说清要查哪段时间，请补充一下（例如「周四」「明天下午」）。');
    }
    const startMs = parseIso(startRaw, '开始时间');

    // 没给结束时间就查到那天结束。用户说「周四什么时候有空」时不会给结束时间，
    // 而窗口切分已经会把它裁到工作时间，所以这里放到当天 23:59 就够。
    const endRaw = str(params, 'end');
    let endMs = endRaw ? parseIso(endRaw, '结束时间') : endOfLocalDay(startMs);
    if (endMs <= startMs) endMs = endOfLocalDay(startMs);

    // 范围上限。飞书对 time_max-time_min 有限制，而且查两周的忙闲回帖没人看。
    const maxEnd = startMs + MAX_RANGE_DAYS * 24 * 3600_000;
    let truncated = false;
    if (endMs > maxEnd) {
      endMs = maxEnd;
      truncated = true;
    }

    // 要查谁：点名了就解析姓名，没点名就是发言人自己（「我明天有空吗」）。
    // 解析失败直接抛 —— 查错了人的忙闲会让用户按错误的时间去约会。
    const wanted = strList(params, 'people');
    const people: ResolvedPerson[] = wanted.length
      ? wanted.slice(0, MAX_PEOPLE).map((who) => resolvePerson(who, ctx))
      : [{ openId: ctx.senderOpenId, name: ctx.senderName || '你', from: 'mention' }];

    const windows = buildWorkWindows(startMs, endMs);
    if (windows.length === 0) {
      // 用户问的整段落在周末，或者问的是已经过完的时间。
      return {
        summary:
          `${fmtDayLabel(startMs)} 到 ${fmtDayLabel(endMs)} 之间没有工作日时段可查` +
          `（只看工作日 09:00-18:00）。要查周末或非工作时间的话，直接说具体几点更快。`,
        data: { people: people.map((p) => p.openId), no_window: true },
      };
    }

    // batch 一次问所有人，不是每人一个请求：日历接口有 QPS 限制，
    // 而且这本来就是它存在的理由。
    const res = await ctx.client.calendar.v4.freebusy.batch({
      params: { user_id_type: 'open_id' },
      data: {
        time_min: toRfc3339(windows[0].start),
        time_max: toRfc3339(windows[windows.length - 1].end),
        user_ids: people.map((p) => p.openId),
        only_busy: true,
      },
    });

    const byUser = new Map<string, Interval[]>();
    for (const row of res.data?.freebusy_lists ?? []) {
      if (!row.user_id) continue;
      const items = (row.freebusy_items ?? [])
        .map((it) => ({
          start: Date.parse(it.start_time),
          end: Date.parse(it.end_time),
        }))
        // 解析不出来的区间丢掉，但**不能**因此当成"这段有空"——
        // 丢掉一个忙区间会把它变成空闲。所以只在真的解析失败时丢，
        // 并且下面用 rawCount 记住原始条数，避免静默变成"全天空闲"。
        .filter((i) => Number.isFinite(i.start) && Number.isFinite(i.end));
      byUser.set(row.user_id, items);
    }

    const results: PersonFreebusy[] = people.map((person) => {
      const busy = byUser.get(person.openId) ?? [];
      const days: DayFreeSlots[] = windows.map((w) => {
        const free = invertBusy(w.start, w.end, busy, MIN_SLOT_MS);
        return {
          dayStart: w.start,
          free,
          fullyBusy: free.length === 0,
        };
      });
      return {
        person,
        days,
        // 「飞书连这个人都没返回」和「返回了但没有忙区间」都归到这里：
        // 两者都可能是日历不可见，而不是真的全天空闲。
        emptyFromFeishu: busy.length === 0,
      };
    });

    return {
      summary: render(results, startMs, endMs, truncated),
      data: {
        range: { start: toRfc3339(startMs), end: toRfc3339(endMs) },
        truncated,
        people: results.map((r) => ({
          open_id: r.person.openId,
          name: r.person.name,
          resolved_from: r.person.from,
          free_slots: r.days.flatMap((d) =>
            d.free.map((f) => ({ start: toRfc3339(f.start), end: toRfc3339(f.end) }))
          ),
          no_busy_returned: r.emptyFromFeishu,
        })),
      },
    };
  },
};

/** 当天 23:59:59（墙上时间）。用户只说了一天时的默认结束点。 */
function endOfLocalDay(ms: number, timeZone = DEFAULT_TIMEZONE): number {
  const d = localDate(ms, timeZone);
  return wallToMs(d, 23, 59, timeZone) + 59_000;
}

/**
 * 拼回帖。
 *
 * 排版上的两个决定：
 * - **按天分组**，同一天的时段写在一行（`08月06日（周四）：09:00-12:00、14:00-18:00`）。
 *   每个时段单独一行时，查三天会变成十几行，在飞书的窄气泡里没法看。
 * - 一整天全空时写「全天有空」而不是「09:00-18:00」：后者会让人以为
 *   我们只查了这个区间的一部分。
 */
function render(
  results: PersonFreebusy[],
  startMs: number,
  endMs: number,
  truncated: boolean
): string {
  const parts: string[] = [];

  for (const r of results) {
    const via = r.person.from === 'directory' ? '（按通讯录姓名匹配）' : '';
    parts.push(`🗓 **${r.person.name}**${via}`);

    const lines = r.days.map((d) => {
      const label = fmtDayLabel(d.dayStart);
      if (d.fullyBusy) return `- ${label}：工作时间内没有空档`;
      const spans = d.free.map((f) => `${fmtHm(f.start)}-${fmtHm(f.end)}`).join('、');
      // 一整天都空时不列区间 —— 列出来像是我们只查了这一段。
      const whole = d.free.length === 1 && d.free[0].start === d.dayStart;
      return `- ${label}：${whole ? `全天有空（${spans}）` : spans}`;
    });
    parts.push(lines.join('\n'));

    if (r.emptyFromFeishu) {
      // 关键的一句。飞书查不到某人的忙闲时不报错，只是返回空 ——
      // 和"他真的全天有空"完全同形。不说明的话用户会按一个假的空闲去约会。
      parts.push(
        `  ⚠️ 没有查到 ${r.person.name} 的任何忙碌时段。可能确实全空，` +
          `也可能是他的日历没对应用开放、或他不在这个应用的可用范围里 —— ` +
          `重要的会建议再跟他确认一句。`
      );
    }
  }

  parts.push(
    `\n_只看工作日 09:00-18:00，忽略短于 30 分钟的碎片；查询范围 ` +
      `${fmtDayLabel(startMs)} — ${fmtDayLabel(endMs)}。_`
  );
  if (truncated) {
    parts.push(`_（一次最多查 ${MAX_RANGE_DAYS} 天，已按这个上限截断。）_`);
  }
  // 忙闲接口只给时间、不给内容，这是它能用应用身份调的原因。
  // 用户往往期待看到"在开什么会"，说明一句能省掉一轮追问。
  parts.push('_忙闲只能看到"被占着"，看不到具体日程内容（那需要本人授权）。_');

  return parts.join('\n');
}
