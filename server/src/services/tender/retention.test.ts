import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { visibleSql, expiredSql, isVisible, TENDER_VISIBLE_DAYS } from './retention.js';

describe('TENDER_VISIBLE_DAYS', () => {
  it('是 21 天', () => {
    expect(TENDER_VISIBLE_DAYS).toBe(21);
  });
});

// 这些 SQL 片段直接拼进 WHERE，用真的 sqlite 跑一遍才算验证过
// （手算 date('now','-21 day') 的边界很容易错一天）。
describe('visibleSql / expiredSql 在真实 sqlite 上的行为', () => {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE t (id TEXT, publish_date TEXT)`);
  const ins = db.prepare('INSERT INTO t VALUES (?, ?)');
  ins.run('today', new Date().toISOString().slice(0, 10));
  ins.run('day20', new Date(Date.now() - 20 * 86400_000).toISOString().slice(0, 10));
  ins.run('day22', new Date(Date.now() - 22 * 86400_000).toISOString().slice(0, 10));
  ins.run('old', '2024-12-05 16:00:00');
  ins.run('empty', '');

  const ids = (sql: string) =>
    (db.prepare(`SELECT id FROM t WHERE ${sql}`).all() as any[]).map(r => r.id).sort();

  it('21 天内可见，22 天前不可见', () => {
    expect(ids(visibleSql())).toEqual(['day20', 'empty', 'today']);
  });

  it('过期条件严格互补：两者相加等于全表，没有行两边都不落', () => {
    expect(ids(expiredSql())).toEqual(['day22', 'old']);
    expect([...ids(visibleSql()), ...ids(expiredSql())].sort())
      .toEqual(['day20', 'day22', 'empty', 'old', 'today']);
  });

  it('带表别名的列名也能用（feishuBitable 里是 t.publish_date）', () => {
    const rows = db.prepare(`SELECT x.id FROM t x WHERE ${visibleSql('x.publish_date')}`).all() as any[];
    expect(rows.map(r => r.id).sort()).toEqual(['day20', 'empty', 'today']);
  });

  // 爬虫写的是 `publishDate: item.releaseTime || ''`，平台漏给时间就是空串。
  // SQLite 里 '' >= date(...) 为 false，所以必须显式兜，否则新抓的标讯
  // 会被当成过期，静默地不进列表、不评分、不推送。
  it('空 publish_date 算可见，和 isVisible 同一个答案（不能被判成过期）', () => {
    expect(ids(visibleSql())).toContain('empty');
    expect(ids(expiredSql())).not.toContain('empty');
    expect(isVisible('')).toBe(true);
  });

  it('不含任何占位符（天数是代码常量，拼进 SQL 不需要绑参）', () => {
    expect(visibleSql()).not.toContain('?');
    expect(expiredSql()).not.toContain('?');
  });
});

describe('isVisible（飞书推送那条先查后过滤的链路用）', () => {
  it('今天发布的可见', () => {
    expect(isVisible(new Date().toISOString())).toBe(true);
  });

  it('20 天前可见，22 天前不可见', () => {
    expect(isVisible(new Date(Date.now() - 20 * 86400_000).toISOString())).toBe(true);
    expect(isVisible(new Date(Date.now() - 22 * 86400_000).toISOString())).toBe(false);
  });

  it('爬虫存的「2026-08-06 00:00:00」空格分隔格式能解析（不是 ISO 的 T）', () => {
    const d = new Date(Date.now() - 22 * 86400_000).toISOString().slice(0, 10);
    expect(isVisible(`${d} 00:00:00`)).toBe(false);
  });

  it('空值/垃圾值视为可见 —— 宁可多推，不可因为平台没给发布时间就静默丢弃', () => {
    expect(isVisible('')).toBe(true);
    expect(isVisible(null)).toBe(true);
    expect(isVisible(undefined)).toBe(true);
    expect(isVisible('待定')).toBe(true);
  });
});
