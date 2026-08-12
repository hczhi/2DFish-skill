import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { purgeTenders, tenderCountsByPlatform } from './purge.js';

// 清库删错了不会报错：接口照样回 `success: true` 和一个看着合理的条数。
// 下面两条都是这种 —— 只能靠真 sqlite 数行数发现。
function makeDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE tenders (id TEXT PRIMARY KEY, platform TEXT, title TEXT, status TEXT);
    CREATE TABLE tender_recommendations (id TEXT PRIMARY KEY, user_id TEXT, tender_id TEXT);
    CREATE TABLE tender_user_feedback (id TEXT PRIMARY KEY, user_id TEXT, tender_id TEXT);
    CREATE TABLE tender_bitable_sync (user_id TEXT, tender_id TEXT, synced_at TEXT);
  `);
  const t = db.prepare('INSERT INTO tenders VALUES (?, ?, ?, ?)');
  // gdgpo 两条（一条 draft —— 草稿也要清掉），ygcg 一条当对照组。
  t.run('g1', 'gdgpo', '甲', 'scored');
  t.run('g2', 'gdgpo', '乙', 'draft');
  t.run('y1', 'ygcg', '丙', 'scored');
  for (const id of ['g1', 'g2', 'y1']) {
    db.prepare('INSERT INTO tender_recommendations VALUES (?, ?, ?)').run(`r-${id}`, 'u1', id);
    db.prepare('INSERT INTO tender_user_feedback VALUES (?, ?, ?)').run(`f-${id}`, 'u1', id);
    db.prepare('INSERT INTO tender_bitable_sync VALUES (?, ?, ?)').run('u1', id, '2026-08-01');
  }
  return db;
}

const rows = (db: any, table: string) =>
  (db.prepare(`SELECT * FROM ${table}`).all() as any[]).map((r) => r.tender_id || r.id).sort();

describe('purgeTenders', () => {
  let db: any;
  beforeEach(() => { db = makeDb(); });

  it('按平台清时不碰别的平台的派生数据', () => {
    // 子表的 DELETE 漏掉 platform 过滤就是全表删：ygcg 的打分/反馈被一起抹掉，
    // 而返回值只报 gdgpo 的条数 —— 后台显示「已清空 gdgpo 2 条标讯」，
    // 另一个平台的用户从此打开推荐列表是空的，没有任何报错。
    const r = purgeTenders(db, 'gdgpo');
    expect(r).toMatchObject({ platform: 'gdgpo', tenders: 2, recommendations: 2, feedback: 2, bitableSync: 2 });
    expect(rows(db, 'tenders')).toEqual(['y1']);
    expect(rows(db, 'tender_recommendations')).toEqual(['y1']);
    expect(rows(db, 'tender_user_feedback')).toEqual(['y1']);
    expect(rows(db, 'tender_bitable_sync')).toEqual(['y1']);
  });

  it('清完不留孤儿（子表要在本体之前删）', () => {
    // 顺序反了的话子表的 `IN (SELECT id FROM tenders)` 匹配不到任何行，
    // 三张子表原样留下。用户侧 /recommendations 的 total 不带 JOIN、
    // items 带 INNER JOIN，于是「共 3 条」但一行都渲染不出来。
    purgeTenders(db, '');
    for (const t of ['tenders', 'tender_recommendations', 'tender_user_feedback', 'tender_bitable_sync']) {
      expect(rows(db, t)).toEqual([]);
    }
  });
});

describe('tenderCountsByPlatform', () => {
  it('数的是全部行，不受状态影响（确认框照这个数字点的）', () => {
    expect(tenderCountsByPlatform(makeDb())).toEqual([
      { platform: 'gdgpo', tenders: 2, recommendations: 2 },
      { platform: 'ygcg', tenders: 1, recommendations: 1 },
    ]);
  });
});
