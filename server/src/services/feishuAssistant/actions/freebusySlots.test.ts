import { describe, it, expect } from 'vitest';
import {
  buildWorkWindows,
  invertBusy,
  mergeIntervals,
  MIN_SLOT_MS,
  WORK_END_HOUR,
  WORK_START_HOUR,
} from './freebusySlots.js';
import { fmtHm, wallToMs } from './time.js';

// 这里是「他周四什么时候有空」唯一有真实逻辑的地方：飞书只给忙区间，
// 用户问的是空闲。取补集算错的后果是给出一个假的空闲时段，
// 用户按它去约会，到点发现对方在开会 —— 一个看起来成功了的错误答案。

/** 2026-08-06 是周四。用墙上时间造时刻，避免测试依赖服务器本地时区。 */
const THU = { year: 2026, month: 8, day: 6 };
const at = (h: number, m = 0) => wallToMs(THU, h, m);

describe('mergeIntervals', () => {
  it('合并重叠的忙区间 —— 同一时段可以有两个会', () => {
    // 不合并就取补集时，第二段的 start 会小于游标，算出负长度的"空闲"。
    expect(mergeIntervals([{ start: at(9), end: at(11) }, { start: at(10), end: at(12) }])).toEqual([
      { start: at(9), end: at(12) },
    ]);
  });

  it('合并首尾相接的区间 —— 中间没有空隙', () => {
    // 09-10 和 10-11 之间不该挤出一个长度 0 的"空闲"段。
    expect(mergeIntervals([{ start: at(9), end: at(10) }, { start: at(10), end: at(11) }])).toEqual([
      { start: at(9), end: at(11) },
    ]);
  });

  it('乱序输入也对（飞书不保证返回有序）', () => {
    const out = mergeIntervals([
      { start: at(15), end: at(16) },
      { start: at(9), end: at(10) },
    ]);
    expect(out).toEqual([{ start: at(9), end: at(10) }, { start: at(15), end: at(16) }]);
  });

  it('丢掉零长度和反向的区间，不让它们污染补集', () => {
    expect(mergeIntervals([{ start: at(9), end: at(9) }, { start: at(11), end: at(10) }])).toEqual([]);
  });

  it('包含关系：大区间吃掉小区间', () => {
    expect(mergeIntervals([{ start: at(9), end: at(18) }, { start: at(10), end: at(11) }])).toEqual([
      { start: at(9), end: at(18) },
    ]);
  });
});

describe('invertBusy', () => {
  const W = { start: at(9), end: at(18) };
  const hm = (list: Array<{ start: number; end: number }>) =>
    list.map((f) => `${fmtHm(f.start)}-${fmtHm(f.end)}`);

  it('中间一个会 → 前后两段空闲', () => {
    expect(hm(invertBusy(W.start, W.end, [{ start: at(10), end: at(11) }], MIN_SLOT_MS))).toEqual([
      '09:00-10:00',
      '11:00-18:00',
    ]);
  });

  it('完全没有会 → 整个窗口都空', () => {
    expect(hm(invertBusy(W.start, W.end, [], MIN_SLOT_MS))).toEqual(['09:00-18:00']);
  });

  it('整天被占满 → 一个空闲都没有（不是"全天有空"）', () => {
    // 这条最重要：如果补集算反了，全天开会的人会被报成全天有空。
    expect(invertBusy(W.start, W.end, [{ start: at(9), end: at(18) }], MIN_SLOT_MS)).toEqual([]);
  });

  it('窗口外的忙区间不影响结果', () => {
    // 早上 7 点的会和 20 点的会都在工作窗口外，不该切掉窗口内的任何时间。
    const busy = [{ start: at(7), end: at(8) }, { start: at(20), end: at(21) }];
    expect(hm(invertBusy(W.start, W.end, busy, MIN_SLOT_MS))).toEqual(['09:00-18:00']);
  });

  it('跨越窗口边界的会被裁到窗口内', () => {
    // 08:30-09:30 的会应该只吃掉 09:00-09:30。
    expect(hm(invertBusy(W.start, W.end, [{ start: at(8, 30), end: at(9, 30) }], MIN_SLOT_MS))).toEqual([
      '09:30-18:00',
    ]);
  });

  it('短于阈值的碎片不算"有空"', () => {
    // 10:00-10:20 这种缝隙列出来只会淹没真正能用的时段。
    const busy = [{ start: at(9), end: at(10) }, { start: at(10, 20), end: at(18) }];
    expect(invertBusy(W.start, W.end, busy, MIN_SLOT_MS)).toEqual([]);
  });

  it('刚好等于阈值的段保留（阈值是"至少"）', () => {
    const busy = [{ start: at(9), end: at(10) }, { start: at(10, 30), end: at(18) }];
    expect(hm(invertBusy(W.start, W.end, busy, MIN_SLOT_MS))).toEqual(['10:00-10:30']);
  });

  it('重叠的会不会算出负长度或倒序的空闲', () => {
    const busy = [
      { start: at(9), end: at(12) },
      { start: at(10), end: at(11) },
      { start: at(11), end: at(13) },
    ];
    const free = invertBusy(W.start, W.end, busy, MIN_SLOT_MS);
    expect(hm(free)).toEqual(['13:00-18:00']);
    for (const f of free) expect(f.end).toBeGreaterThan(f.start);
  });
});

describe('buildWorkWindows', () => {
  const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

  it('一天 → 一个 09:00-18:00 的窗口', () => {
    const w = buildWorkWindows(wallToMs(THU, 0), wallToMs(THU, 23, 59));
    expect(w).toHaveLength(1);
    expect(fmtHm(w[0].start)).toBe('09:00');
    expect(fmtHm(w[0].end)).toBe('18:00');
  });

  it('跳过周末 —— 周五问「未来四天」只给周五和下周一', () => {
    // 把周末算进去会给出一堆没人会约的时段，把有用的那几段挤到看不见。
    const fri = { year: 2026, month: 8, day: 7 }; // 2026-08-07 周五
    const w = buildWorkWindows(wallToMs(fri, 0), wallToMs(fri, 0) + 4 * 24 * 3600_000);
    expect(w.map((x) => day(x.start))).toEqual(['2026-08-07', '2026-08-10']);
  });

  it('今天下午问「今天什么时候有空」时，不把已经过去的上午算成空闲', () => {
    // 现在是 14:00，窗口应该从 14:00 开始而不是 09:00。
    const w = buildWorkWindows(at(14), wallToMs(THU, 23, 59));
    expect(w).toHaveLength(1);
    expect(fmtHm(w[0].start)).toBe('14:00');
  });

  it('整段落在周末时返回空 —— 调用方据此回一句说明而不是"全天有空"', () => {
    const sat = { year: 2026, month: 8, day: 8 }; // 周六
    expect(buildWorkWindows(wallToMs(sat, 0), wallToMs(sat, 23, 59))).toEqual([]);
  });

  it('下班后问「今天」时返回空，而不是给一个已经过去的窗口', () => {
    expect(buildWorkWindows(at(20), wallToMs(THU, 23, 59))).toEqual([]);
  });

  it('多天时每天都是完整的工作窗口，且逐天递增不重叠', () => {
    const mon = { year: 2026, month: 8, day: 3 };
    const w = buildWorkWindows(wallToMs(mon, 0), wallToMs(mon, 0) + 5 * 24 * 3600_000);
    expect(w).toHaveLength(5); // 周一到周五
    for (const x of w) {
      expect(fmtHm(x.start)).toBe(`0${WORK_START_HOUR}:00`);
      expect(fmtHm(x.end)).toBe(`${WORK_END_HOUR}:00`);
    }
    for (let i = 1; i < w.length; i++) expect(w[i].start).toBeGreaterThan(w[i - 1].end);
  });
});
