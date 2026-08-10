// 时间解析。LLM 拿到「当前时间」后被要求输出带时区偏移的 ISO 8601
// （如 2026-08-05T15:00:00+08:00），这里只做解析和格式转换，不做自然语言理解——
// 「明天下午三点」这类相对表述由 LLM 在拿到当前时间的前提下算成绝对时间。
//
// 单独成文件是因为「毫秒还是秒」这个坑不止一处：飞书任务的 due.timestamp 是
// **毫秒**字符串，而日程的 start_time.timestamp 是**秒**（日程动作已删，
// 但多维表格的日期字段又是毫秒），写反了不报错，只会把日期排到 1970 年。
// 所以每个格式都有一个具名函数，而不是在调用处 `String(ms)` / `ms/1000`。

export const DEFAULT_TIMEZONE = 'Asia/Shanghai';

/** ISO 8601 → 毫秒时间戳。解析不出来抛出可读原因（会回帖给用户）。 */
export function parseIso(raw: string, label: string): number {
  const t = new Date(raw).getTime();
  if (Number.isNaN(t)) throw new Error(`${label}「${raw}」不是合法时间，请说得更具体些。`);
  return t;
}

/** 飞书任务 due.timestamp：毫秒字符串。 */
export function toTaskTimestamp(ms: number): string {
  return String(ms);
}

/** 给用户看的时间。固定用飞书租户所在时区，不用服务器本地时区。 */
export function fmtForHuman(ms: number, timeZone = DEFAULT_TIMEZONE): string {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(ms));
}

/**
 * 某个时刻在指定时区的 UTC 偏移（分钟）。
 *
 * 用 `timeZoneName: 'longOffset'` 让 ICU 自己算 —— 手写偏移表迟早会错，
 * 而且这里必须是"那个时刻的"偏移而不是固定值（有 DST 的时区一年里会变）。
 */
function offsetMinutes(ms: number, timeZone: string): number {
  const name = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
    .formatToParts(new Date(ms))
    .find((p) => p.type === 'timeZoneName')?.value;
  // UTC 时 longOffset 就是 'GMT'（没有 ±hh:mm 部分）。
  const m = name?.match(/GMT([+-])(\d{2}):(\d{2})/);
  if (!m) return 0;
  return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
}

/** 某个时刻在指定时区的墙上日期。用于按「本地的一天」切窗口。 */
export function localDate(
  ms: number,
  timeZone = DEFAULT_TIMEZONE
): { year: number; month: number; day: number; weekday: number } {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  }).formatToParts(new Date(ms));
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    weekday: Math.max(0, WD.indexOf(get('weekday'))),
  };
}

/**
 * 墙上时间 → 时间戳。`localDate` 的反向操作，用来构造「那天的 09:00」。
 *
 * 偏移取两次：第一次用 UTC 猜的时刻问偏移，减完之后再问一次。
 * 单次可能落在 DST 切换的错误一侧（差一小时）。Asia/Shanghai 没有 DST，
 * 但这个函数不该只对一个时区正确。
 */
export function wallToMs(
  d: { year: number; month: number; day: number },
  hour: number,
  minute = 0,
  timeZone = DEFAULT_TIMEZONE
): number {
  const utcGuess = Date.UTC(d.year, d.month - 1, d.day, hour, minute);
  let ms = utcGuess - offsetMinutes(utcGuess, timeZone) * 60_000;
  ms = utcGuess - offsetMinutes(ms, timeZone) * 60_000;
  return ms;
}

/** 只要「2026-08-06」。多维表格里只到天的日期字段、日志分组用这个。 */
export function fmtDate(ms: number, timeZone = DEFAULT_TIMEZONE): string {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(ms));
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** 拼进 prompt 的「当前时间」。带时区和星期，否则 LLM 算不对「下周三」。 */
export function nowForPrompt(nowMs: number, timeZone = DEFAULT_TIMEZONE): string {
  const f = new Intl.DateTimeFormat('zh-CN', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'long',
    hour12: false,
  }).format(new Date(nowMs));
  return `${f}（时区 ${timeZone}）`;
}
