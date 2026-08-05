import { DEFAULT_TIMEZONE, localDate, parseIso } from './time.js';

// 重复日程的 RRULE（RFC 5545）。
//
// ── 为什么 RRULE 是在代码里拼的，不让 LLM 输出 ──
// 飞书的 `recurrence` 字段收的就是一条 RRULE 字符串，让模型直接写它很省事，
// 但这是本模块一贯拒绝的那类做法（同 open_id、同 guid）：它写错的方式不是报错，
// 而是**建出一个重复规律不对的日程** —— 「每周一早会」变成每天一次，
// 三十个人的日历上多出二十九个会议，而回帖说的是「已创建」。
// 所以模型只回答一个它不可能写错的枚举（daily / weekly / biweekly / monthly），
// 拼串这件事留在这里。
//
// ── BYDAY 为什么要显式给 ──
// 周重复不带 BYDAY 时，重复在哪一天取决于服务端怎么解释 DTSTART。
// 我们自己按开始时间算出星期几写进去，行为就不依赖那个解释。

export type RepeatKind = 'daily' | 'weekly' | 'biweekly' | 'monthly';

const KINDS: RepeatKind[] = ['daily', 'weekly', 'biweekly', 'monthly'];

/** RFC 5545 的星期缩写，下标对齐 localDate().weekday（0 = 周日）。 */
const BYDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

const LABELS: Record<RepeatKind, string> = {
  daily: '每天',
  weekly: '每周',
  biweekly: '每两周',
  monthly: '每月',
};

/** 模型给的那个词是不是我们支持的重复方式。认不出来就当没说，见 parseRepeat。 */
export function asRepeatKind(raw: string | undefined): RepeatKind | undefined {
  if (!raw) return undefined;
  const t = raw.trim().toLowerCase();
  if ((KINDS as string[]).includes(t)) return t as RepeatKind;
  // 模型偶尔直接给中文。认下来比让它静默失效好 ——「每周一早会」少了重复
  // 就变成一次性日程，而回帖会说"已创建"，用户下周才发现没有了。
  const zh: Record<string, RepeatKind> = {
    每天: 'daily',
    每日: 'daily',
    每周: 'weekly',
    每星期: 'weekly',
    每两周: 'biweekly',
    隔周: 'biweekly',
    每月: 'monthly',
  };
  return zh[raw.trim()];
}

/** UNTIL 必须是 UTC 的 basic 格式（20260901T010000Z），不能带偏移。 */
function untilUtc(ms: number): string {
  return new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

export interface BuiltRecurrence {
  /** 传给飞书 `recurrence` 的 RRULE */
  rule: string;
  /** 回帖里那句人话：「每周四重复」/「每天重复，到 2026-09-01 为止」 */
  human: string;
  /** 有没有结束日期。没有 = 无限重复，回帖必须说清怎么删 */
  bounded: boolean;
}

/**
 * 拼一条 RRULE。
 *
 * @param startMs 日程开始时刻，用来定 BYDAY（周重复重复在哪一天）
 * @param untilRaw 可选的结束日期（ISO 8601）。用户说了「到月底」时才有。
 */
export function buildRecurrence(
  kind: RepeatKind,
  startMs: number,
  untilRaw?: string
): BuiltRecurrence {
  const bits: string[] = [];
  const humanBits: string[] = [];

  if (kind === 'daily') {
    bits.push('FREQ=DAILY', 'INTERVAL=1');
    humanBits.push('每天');
  } else if (kind === 'monthly') {
    // 按日期重复（每月 5 号）。BYMONTHDAY 同样显式给，不依赖服务端解释 DTSTART。
    const d = localDate(startMs, DEFAULT_TIMEZONE);
    bits.push('FREQ=MONTHLY', 'INTERVAL=1', `BYMONTHDAY=${d.day}`);
    humanBits.push(`每月 ${d.day} 号`);
  } else {
    const d = localDate(startMs, DEFAULT_TIMEZONE);
    const day = BYDAY[d.weekday] ?? 'MO';
    bits.push('FREQ=WEEKLY', `INTERVAL=${kind === 'biweekly' ? 2 : 1}`, `BYDAY=${day}`);
    humanBits.push(`${LABELS[kind]}${'日一二三四五六'[d.weekday] ?? ''}`);
  }

  let bounded = false;
  if (untilRaw) {
    // 解析不出来时**抛错**而不是忽略：用户明确说了"到月底"，
    // 悄悄建成无限重复是这里最坏的结果（他要挨个去删）。
    const untilMs = parseIso(untilRaw, '重复结束日期');
    if (untilMs > startMs) {
      bits.push(`UNTIL=${untilUtc(untilMs)}`);
      bounded = true;
      humanBits.push(
        `到 ${new Intl.DateTimeFormat('zh-CN', {
          timeZone: DEFAULT_TIMEZONE,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }).format(new Date(untilMs))} 为止`
      );
    }
  }

  return { rule: bits.join(';'), human: humanBits.join('，'), bounded };
}
