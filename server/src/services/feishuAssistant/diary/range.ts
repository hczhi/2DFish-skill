import { localDate, wallToMs, DEFAULT_TIMEZONE } from '../actions/time.js';

// 复盘的时间范围。
//
// **窗口在代码里算，LLM 只答一个枚举值**（外加「最近 N 天」的 N）。
// 这和 RRULE、open_id 是同一条规则：模型不输出它能悄悄搞错的格式。
// 让它直接给起止时间戳的后果不是报错 —— 是生成一份「本周复盘」，
// 实际取的是上周的记录，而回帖里写着「本周」。没人会去核对。
//
// 「一天」按**飞书租户所在时区**的墙上时间切，不用服务器本地时区：
// 服务器跑在 UTC 时，「今天」会从北京时间早上 8 点开始 ——
// 早会记的那几条不在「今天」里。

/** LLM 能选的时间范围。和 note-review skill 的词汇表一致。 */
export type RangeKey = 'today' | 'yesterday' | 'this_week' | 'last_week' | 'this_month' | 'recent_days' | 'all';

export const RANGE_KEYS: RangeKey[] = [
  'today',
  'yesterday',
  'this_week',
  'last_week',
  'this_month',
  'recent_days',
  'all',
];

export interface ResolvedRange {
  /**
   * 归一化之后的枚举值（认不出来的已经被换成 `today`）。
   *
   * 露出来是给「同一段时间总结过几次」用的：群聊摘要要按段落去重计数
   * （migration 069 的 digest_range），而 label 带具体日期又带中文说法，
   * 不适合当键 —— 「今天（08-10）」和「最近 1 天（08-10 至 08-10）」是同一段时间。
   */
  key: RangeKey;
  /** 含。undefined = 不设下界（全部）。 */
  startMs?: number;
  /** **不含**。listRecords 用 `< endMs`，所以这里给的是次日 0 点那一刻。 */
  endMs?: number;
  /** 给人看的说法，直接进回帖和复盘表。带上具体日期 —— 「本周」不写日期就无法核对。 */
  label: string;
}

/**
 * 把枚举值算成时间窗口。
 *
 * 认不出来的值当 `today`（skill 里的默认值），并且**在 label 里如实说是「今天」** ——
 * 静默按「全部」处理会让一句「复盘一下」返回三个月的记录，
 * 摘要被稀释成没用的东西，而用户以为那就是今天的情况。
 */
export function resolveRange(
  key: string | undefined,
  nowMs: number,
  days?: number,
  timeZone = DEFAULT_TIMEZONE
): ResolvedRange {
  const k = (RANGE_KEYS as string[]).includes(key ?? '') ? (key as RangeKey) : 'today';
  const today = localDate(nowMs, timeZone);
  const dayStart = (offsetDays: number) => wallToMs(shiftDays(today, offsetDays), 0, 0, timeZone);

  switch (k) {
    case 'today':
      return { key: k, startMs: dayStart(0), endMs: dayStart(1), label: `今天（${fmt(today)}）` };

    case 'yesterday': {
      const y = shiftDays(today, -1);
      return { key: k, startMs: dayStart(-1), endMs: dayStart(0), label: `昨天（${fmt(y)}）` };
    }

    case 'this_week': {
      // 周一为一周的第一天（国内习惯）。weekday 里 0 = 周日，
      // 所以周日要回退 6 天而不是 0 天 —— 少了这个分支，周日复盘「本周」
      // 会只拿到周日一天，而那天通常一条记录都没有。
      const back = (today.weekday + 6) % 7;
      return {
        key: k,
        startMs: dayStart(-back),
        endMs: dayStart(1),
        label: `本周（${fmt(shiftDays(today, -back))} 至 ${fmt(today)}）`,
      };
    }

    case 'last_week': {
      const back = (today.weekday + 6) % 7;
      return {
        key: k,
        startMs: dayStart(-back - 7),
        endMs: dayStart(-back),
        label: `上周（${fmt(shiftDays(today, -back - 7))} 至 ${fmt(shiftDays(today, -back - 1))}）`,
      };
    }

    case 'this_month': {
      const first = { year: today.year, month: today.month, day: 1 };
      return {
        key: k,
        startMs: wallToMs(first, 0, 0, timeZone),
        endMs: dayStart(1),
        label: `本月（${fmt(first)} 至 ${fmt(today)}）`,
      };
    }

    case 'recent_days': {
      // 含今天，所以 N 天是往前推 N-1 天。上限 365：再往前的范围用「全部」表达，
      // 而一个离谱的 N（模型偶尔给 9999）会把整表塞进 prompt。
      const n = Math.min(Math.max(Math.floor(days ?? 7), 1), 365);
      return {
        key: k,
        startMs: dayStart(-(n - 1)),
        endMs: dayStart(1),
        label: `最近 ${n} 天（${fmt(shiftDays(today, -(n - 1)))} 至 ${fmt(today)}）`,
      };
    }

    case 'all':
      return { key: k, label: '全部记录' };
  }
}

/** 墙上日期 ± 天数。用 UTC 中午做基准，避免跨月/闰年时踩到时区边界。 */
function shiftDays(
  d: { year: number; month: number; day: number },
  delta: number
): { year: number; month: number; day: number } {
  const t = Date.UTC(d.year, d.month - 1, d.day, 12) + delta * 86400_000;
  const x = new Date(t);
  return { year: x.getUTCFullYear(), month: x.getUTCMonth() + 1, day: x.getUTCDate() };
}

function fmt(d: { year: number; month: number; day: number }): string {
  return `${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;
}
