import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import {
  visibleSql,
  expiredSql,
  isVisible,
  expireOverdueTenders,
  TENDER_VISIBLE_DAYS,
} from './retention.js';

describe('TENDER_VISIBLE_DAYS', () => {
  it('是 7 天', () => {
    expect(TENDER_VISIBLE_DAYS).toBe(7);
  });
});

const day = (n: number) => new Date(Date.now() - n * 86400_000).toISOString();
const dayOnly = (n: number) => day(n).slice(0, 10);

// 这些 SQL 片段直接拼进 WHERE，用真的 sqlite 跑一遍才算验证过
// （手算 date('now','-7 day') 的边界很容易错一天）。
describe('visibleSql / expiredSql 在真实 sqlite 上的行为', () => {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE t (id TEXT, publish_date TEXT, created_at TEXT)`);
  const ins = db.prepare('INSERT INTO t VALUES (?, ?, ?)');
  ins.run('today', dayOnly(0), day(0));
  ins.run('day6', dayOnly(6), day(6));
  ins.run('day8', dayOnly(8), day(8));
  // 「今天入库的历史公告」：gdgpo 真实存在 publish_date=2024-12-05 的行。
  // 只按入库时间筛的话它会以「新标讯」的身份在列表里挂满 7 天。
  ins.run('oldNotice', '2024-12-05 16:00:00', day(0));
  // 「入库很久但发布日期是今天」：只按发布日期筛的话它永远不过期。
  ins.run('staleRow', dayOnly(0), day(60));
  // 平台没给发布时间 → 爬虫存空串。空值算可见，不能被判成过期。
  ins.run('empty', '', day(1));

  const ids = (sql: string) =>
    (db.prepare(`SELECT id FROM t WHERE ${sql}`).all() as any[]).map((r) => r.id).sort();

  it('两个日期都要在窗口内才可见', () => {
    expect(ids(visibleSql())).toEqual(['day6', 'empty', 'today']);
  });

  it('入库超 7 天的不可见，哪怕发布日期是今天', () => {
    // 用户要的就是这一条。只按 publish_date 筛的话 staleRow 永远留在列表里。
    expect(ids(visibleSql())).not.toContain('staleRow');
  });

  it('入库是今天但公告是 2024 年的也不可见', () => {
    // 反方向：只按 created_at 筛的话，一批历史公告会以「新标讯」身份挂 7 天还要花 token 评分。
    expect(ids(visibleSql())).not.toContain('oldNotice');
  });

  it('过期条件严格互补：两者相加等于全表，没有行两边都不落', () => {
    // 分别取反（而不是整体取反）会让 staleRow / oldNotice 两边都不落，
    // 后台的「已超期 N 条」于是比实际少，读起来像口径问题而不是漏了一批。
    const all = ['day6', 'day8', 'empty', 'oldNotice', 'staleRow', 'today'];
    expect([...ids(visibleSql()), ...ids(expiredSql())].sort()).toEqual(all);
  });

  it('带表别名能用（各处查询都是 FROM tenders t）', () => {
    const rows = db.prepare(`SELECT x.id FROM t x WHERE ${visibleSql('x')}`).all() as any[];
    expect(rows.map((r) => r.id).sort()).toEqual(['day6', 'empty', 'today']);
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
    expect(isVisible(day(6), day(6))).toBe(true);
    expect(isVisible(day(8), day(8))).toBe(false);
  });

  it('入库超期即不可见，即使发布日期是今天', () => {
    expect(isVisible(day(0), day(60))).toBe(false);
  });

  it('爬虫存的「2026-08-06 00:00:00」空格分隔格式能解析（不是 ISO 的 T）', () => {
    expect(isVisible(`${dayOnly(8)} 00:00:00`, day(0))).toBe(false);
  });

  it('空值/垃圾值视为可见 —— 宁可多推，不可因为平台没给发布时间就静默丢弃', () => {
    expect(isVisible('', day(0))).toBe(true);
    expect(isVisible(null, day(0))).toBe(true);
    expect(isVisible('待定', day(0))).toBe(true);
    // createdAt 不传 = 调用方没取这一列，不该由这里替它判死
    expect(isVisible(day(0))).toBe(true);
  });
});

// 这一趟的失败形态全是「看起来成功」：多作废一批（第二天草稿库少了一截，
// 没有任何地方报错）、或者把相关性误杀那批的理由冲掉（「已作废 N」从此说明不了任何事）。
describe('expireOverdueTenders', () => {
  const seed = () => {
    const db = new Database(':memory:');
    db.exec(`CREATE TABLE tenders (id TEXT, status TEXT, created_at TEXT, reject_reason TEXT)`);
    const ins = db.prepare('INSERT INTO tenders VALUES (?, ?, ?, ?)');
    ins.run('fresh-draft', 'draft', day(1), null);
    ins.run('edge-draft', 'draft', day(6), null);
    ins.run('old-draft', 'draft', day(30), null);
    ins.run('old-scored', 'scored', day(30), null);
    ins.run('old-rejected', 'rejected', day(30), '和关键词库完全无关');
    return db;
  };
  const statusOf = (db: Database.Database, id: string) =>
    (db.prepare('SELECT status, reject_reason FROM tenders WHERE id = ?').get(id) as any);

  it('只作废入库超窗口的，窗口内的一条都不许动', () => {
    const db = seed();
    expect(expireOverdueTenders(db)).toBe(2); // old-draft + old-scored
    expect(statusOf(db, 'fresh-draft').status).toBe('draft');
    expect(statusOf(db, 'edge-draft').status).toBe('draft');
    expect(statusOf(db, 'old-draft').status).toBe('expired');
    expect(statusOf(db, 'old-scored').status).toBe('expired');
  });

  it('不碰 rejected —— 相关性误杀的理由和「已作废 N」那个计数是发现闸门太狠的唯一线索', () => {
    const db = seed();
    expireOverdueTenders(db);
    expect(statusOf(db, 'old-rejected')).toEqual({
      status: 'rejected',
      reject_reason: '和关键词库完全无关',
    });
  });

  it('幂等：跑第二趟改 0 条（返回值就是这次真改掉的条数，日志照它报）', () => {
    const db = seed();
    expireOverdueTenders(db);
    expect(expireOverdueTenders(db)).toBe(0);
  });
});
