// 忙闲区间 → 「他哪些时候有空」。
//
// 飞书的忙闲接口只回**忙**的区间，而用户问的是**闲**的时段
// （「他周四什么时候有空」）。把忙区间取补集这件事有几个必须做对的地方，
// 所以单独成一个纯函数模块：它是这个功能里唯一有真实逻辑的部分，
// 而且是唯一能在不调飞书接口的前提下测透的部分。
//
// ── 为什么不能直接把忙区间列给用户 ──
// 「张三 09:00-10:00 忙、10:00-11:30 忙」需要用户自己做减法才能知道该约几点，
// 而这是他问这句话的全部目的。列忙区间等于把问题原样退回去。

import { DEFAULT_TIMEZONE, localDate, wallToMs } from './time.js';

/** 一个时间区间，闭开 [start, end)。 */
export interface Interval {
  start: number;
  end: number;
}

/**
 * 工作时间窗口。默认 09:00-18:00。
 *
 * 为什么要有窗口，而不是把整天的空闲都算出来：整天取补集的结果是
 * 「00:00-09:00 有空、12:00-14:00 有空、18:00-次日09:00 有空」——
 * 技术上没错，但没人会去约凌晨三点，用户得自己从里面筛出上班时间。
 * 窗口把这一步做掉了。
 *
 * 不做成可配置项（至少现在不）：飞书那边没有"作息"这个概念可读，
 * 猜错了不如让用户直说「晚上八点行不行」——那时他给的是具体时间，不用查忙闲。
 */
export const WORK_START_HOUR = 9;
export const WORK_END_HOUR = 18;

/** 一段空闲短于这个就不算"有空"。碎片列出来只会淹没真正能用的时间。 */
export const MIN_SLOT_MS = 30 * 60 * 1000;

/**
 * 把 [from, to) 切成「每个工作日的 09:00-18:00」。
 *
 * 跳过周六周日：查「他这周什么时候有空」时把周末算进去，会给出一堆
 * 谁都不会去约的时段，把真正有用的那几段挤到看不见。
 * 真要约周末的人会直接说具体时间。
 *
 * 按**墙上时间**逐天推进（localDate + wallToMs），不是 `+86400000`：
 * 有 DST 的时区里一天不一定是 24 小时，加固定毫秒会让窗口慢慢漂。
 */
export function buildWorkWindows(
  from: number,
  to: number,
  timeZone = DEFAULT_TIMEZONE
): Interval[] {
  const out: Interval[] = [];
  let d = localDate(from, timeZone);

  // 上限 31 天：调用方已经限了范围，这里只是防「to 是个疯狂的值」时死循环。
  for (let guard = 0; guard < 31; guard++) {
    const dayStart = wallToMs(d, WORK_START_HOUR, 0, timeZone);
    const dayEnd = wallToMs(d, WORK_END_HOUR, 0, timeZone);
    if (dayStart >= to) break;

    // 与请求区间求交：今天问「今天什么时候有空」时，已经过去的那几个小时
    // 不该算成空闲 —— 说「你 09:00-12:00 有空」而现在是下午两点是明显的错。
    const s = Math.max(dayStart, from);
    const e = Math.min(dayEnd, to);
    if (e > s && d.weekday !== 0 && d.weekday !== 6) out.push({ start: s, end: e });

    const next = localDate(wallToMs(d, 12, 0, timeZone) + 24 * 3600_000, timeZone);
    d = next;
  }
  return out;
}

/** 按天分组的空闲结果。 */
export interface DayFreeSlots {
  /** 这一天工作时间窗口的起点，用来给这一天打标签 */
  dayStart: number;
  free: Interval[];
  /** 这一天在窗口内是否整天都被占满 */
  fullyBusy: boolean;
}

/**
 * 合并重叠/相邻的区间。
 *
 * 必须先做：飞书返回的忙区间**可以重叠**（同一时段有两个会），
 * 不合并就取补集会算出负长度的"空闲"段。相邻的也要并
 * （09:00-10:00 和 10:00-11:00 之间没有空隙，却会产出一个长度 0 的段）。
 */
export function mergeIntervals(list: Interval[]): Interval[] {
  const sorted = [...list]
    .filter((i) => i.end > i.start)
    .sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  for (const cur of sorted) {
    const last = out[out.length - 1];
    if (last && cur.start <= last.end) {
      // <= 而不是 <：相邻区间也要合并，否则中间会挤出一个零长度空隙。
      if (cur.end > last.end) last.end = cur.end;
    } else {
      out.push({ ...cur });
    }
  }
  return out;
}

/**
 * 在 [windowStart, windowEnd) 里，把 busy 的补集算出来。
 *
 * 只返回长度 >= minMs 的段：15 分钟的缝隙不是"有空"，
 * 列出来只会让用户在一堆碎片里找不到能用的时间。
 */
export function invertBusy(
  windowStart: number,
  windowEnd: number,
  busy: Interval[],
  minMs: number
): Interval[] {
  const merged = mergeIntervals(busy);
  const free: Interval[] = [];
  let cursor = windowStart;

  for (const b of merged) {
    if (b.end <= windowStart || b.start >= windowEnd) continue; // 完全在窗口外
    if (b.start > cursor) free.push({ start: cursor, end: Math.min(b.start, windowEnd) });
    cursor = Math.max(cursor, b.end);
    if (cursor >= windowEnd) break;
  }
  if (cursor < windowEnd) free.push({ start: cursor, end: windowEnd });

  return free.filter((f) => f.end - f.start >= minMs);
}
