import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { visibleSql, expiredSql, isVisible, TENDER_VISIBLE_DAYS } from './retention.js';

describe('TENDER_VISIBLE_DAYS', () => {
  it('是 14 天', () => {
    expect(TENDER_VISIBLE_DAYS).toBe(14);
  });
});

const day = (n: number) => new Date(Date.now() - n * 86400_000).toISOString();
const dayOnly = (n: number) => day(n).slice(0, 10);

// 这些 SQL 片段直接拼进 WHERE，用真的 sqlite 跑一遍才算验证过
// （手算 date('now','-14 day') 的边界很容易错一天）。
describe('visibleSql / expiredSql 在真实 sqlite 上的行为', () => {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE t (id TEXT, publish_date TEXT, created_at TEXT)`);
  const ins = db.prepare('INSERT INTO t VALUES (?, ?, ?)');
  ins.run('today', dayOnly(0), day(0));
  ins.run('day13', dayOnly(13), day(13));
  ins.run('day15', dayOnly(15), day(15));
  // 「今天入库的历史公告」：gdgpo 真实存在 publish_date=2024-12-05 的行。
  // 只按入库时间筛的话它会以「新标讯」的身份在列表里挂满 14 天。
  ins.run('oldNotice', '2024-12-05 16:00:00', day(0));
  // 「入库很久但发布日期是今天」：只按发布日期筛的话它永远不过期。
  ins.run('staleRow', dayOnly(0), day(60));
  // 平台没给发布时间 → 爬虫存空串。空值算可见，不能被判成过期。
  ins.run('empty', '', day(1));

  const ids = (sql: string) =>
    (db.prepare(`SELECT id FROM t WHERE ${sql}`).all() as any[]).map((r) => r.id).sort();

  it('两个日期都要在窗口内才可见', () => {
    expect(ids(visibleSql())).toEqual(['day13', 'empty', 'today']);
  });

  it('入库超 14 天的不可见，哪怕发布日期是今天', () => {
    // 用户要的就是这一条。只按 publish_date 筛的话 staleRow 永远留在列表里。
    expect(ids(visibleSql())).not.toContain('staleRow');
  });

  it('入库是今天但公告是 2024 年的也不可见', () => {
    // 反方向：只按 created_at 筛的话，一批历史公告会以「新标讯」身份挂 14 天还要花 token 评分。
    expect(ids(visibleSql())).not.toContain('oldNotice');
  });

  it('过期条件严格互补：两者相加等于全表，没有行两边都不落', () => {
    // 分别取反（而不是整体取反）会让 staleRow / oldNotice 两边都不落，
    // 后台的「已超期 N 条」于是比实际少，读起来像口径问题而不是漏了一批。
    const all = ['day13', 'day15', 'empty', 'oldNotice', 'staleRow', 'today'];
    expect([...ids(visibleSql()), ...ids(expiredSql())].sort()).toEqual(all);
  });

  it('带表别名能用（各处查询都是 FROM tenders t）', () => {
    const rows = db.prepare(`SELECT x.id FROM t x WHERE ${visibleSql('x')}`).all() as any[];
    expect(rows.map((r) => r.id).sort()).toEqual(['day13', 'empty', 'today']);
  });

  // 爬虫写的是 `publishDate: item.releaseTime || ''`，平台漏给时间就是空串。
  // SQLite 里 '' >= date(...) 为 false，所以必须显式兜，否则新抓的标讯
  // 会被当成过期，静默地不进列表、不评分、不推送。
  it('空 publish_date 算可见，和 isVisible 同一个答案（不能被判成过期）', () => {
    expect(ids(visibleSql())).toContain('empty');
    expect(ids(expiredSql())).not.toContain('empty');
    expect(isVisible('', day(1))).toBe(true);
  });

  it('不含任何占位符（天数是代码常量，拼进 SQL 不需要绑参）', () => {
    expect(visibleSql()).not.toContain('?');
    expect(expiredSql()).not.toContain('?');
  });
});

describe('isVisible（先查后过滤的链路用）', () => {
  it('两个日期都在窗口内才可见', () => {
    expect(isVisible(day(0), day(0))).toBe(true);
    expect(isVisible(day(13), day(13))).toBe(true);
    expect(isVisible(day(15), day(15))).toBe(false);
  });

  it('入库超期即不可见，即使发布日期是今天', () => {
    expect(isVisible(day(0), day(60))).toBe(false);
  });

  it('爬虫存的「2026-08-06 00:00:00」空格分隔格式能解析（不是 ISO 的 T）', () => {
    expect(isVisible(`${dayOnly(15)} 00:00:00`, day(0))).toBe(false);
  });

  it('空值/垃圾值视为可见 —— 宁可多推，不可因为平台没给发布时间就静默丢弃', () => {
    expect(isVisible('', day(0))).toBe(true);
    expect(isVisible(null, day(0))).toBe(true);
    expect(isVisible('待定', day(0))).toBe(true);
    // createdAt 不传 = 调用方没取这一列，不该由这里替它判死
    expect(isVisible(day(0))).toBe(true);
  });
});
