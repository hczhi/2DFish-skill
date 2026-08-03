import { describe, it, expect, beforeAll } from 'vitest';
import type { Request } from 'express';
import Database from 'better-sqlite3';
import { parsePagination, patchRow, initSSE } from './http.js';

function q(query: Record<string, any>): Request {
  return { query } as unknown as Request;
}

describe('parsePagination', () => {
  it('默认值', () => {
    expect(parsePagination(q({}))).toEqual({ page: 1, pageSize: 20, offset: 0 });
  });

  it('正常分页', () => {
    expect(parsePagination(q({ page: '3', page_size: '10' })))
      .toEqual({ page: 3, pageSize: 10, offset: 20 });
  });

  it('负数/0/NaN 一律回落到安全值，绝不产出负 LIMIT 或负 OFFSET', () => {
    // 旧写法 Math.min(50, parseInt('-5') || 20) === -5 → LIMIT -5
    for (const bad of ['-5', '0', 'abc', '', 'NaN']) {
      const r = parsePagination(q({ page: bad, page_size: bad }));
      expect(r.page).toBeGreaterThanOrEqual(1);
      expect(r.pageSize).toBeGreaterThanOrEqual(1);
      expect(r.offset).toBeGreaterThanOrEqual(0);
    }
  });

  it('page_size 被 maxSize 钳住（防止一次拉全表）', () => {
    expect(parsePagination(q({ page_size: '100000' })).pageSize).toBe(100);
    expect(parsePagination(q({ page_size: '100000' }), { maxSize: 50 }).pageSize).toBe(50);
  });

  it('自定义默认值生效', () => {
    expect(parsePagination(q({}), { defaultSize: 30 }).pageSize).toBe(30);
  });
});

describe('patchRow', () => {
  let db: Database.Database;

  beforeAll(() => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE t (
        id TEXT PRIMARY KEY,
        title TEXT,
        secret TEXT,
        visible INTEGER,
        tags TEXT,
        updated_at TEXT
      );
    `);
  });

  const spec = { columns: ['title', 'visible', 'tags'], booleans: ['visible'], json: ['tags'] };

  function seed(id: string) {
    db.prepare('INSERT OR REPLACE INTO t (id, title, secret, visible, tags, updated_at) VALUES (?,?,?,?,?,?)')
      .run(id, 'old', 'classified', 0, '[]', '2020-01-01');
  }

  it('只更新白名单内的列', () => {
    seed('a');
    const n = patchRow(db, 't', spec, { title: 'new' }, { id: 'a' });
    expect(n).toBe(1);
    const row = db.prepare('SELECT * FROM t WHERE id = ?').get('a') as any;
    expect(row.title).toBe('new');
  });

  it('白名单外的字段被忽略（这是防越权改列的关键）', () => {
    seed('b');
    patchRow(db, 't', spec, { title: 'x', secret: 'leaked' }, { id: 'b' });
    const row = db.prepare('SELECT * FROM t WHERE id = ?').get('b') as any;
    expect(row.secret).toBe('classified');
  });

  it('body 全是白名单外字段时返回 0，不执行任何写入', () => {
    seed('c');
    const n = patchRow(db, 't', spec, { secret: 'leaked', bogus: 1 }, { id: 'c' });
    expect(n).toBe(0);
    const row = db.prepare('SELECT * FROM t WHERE id = ?').get('c') as any;
    expect(row.secret).toBe('classified');
    expect(row.updated_at).toBe('2020-01-01'); // 连 updated_at 都不该动
  });

  it('boolean 列存成 0/1', () => {
    seed('d');
    patchRow(db, 't', spec, { visible: true }, { id: 'd' });
    expect((db.prepare('SELECT visible FROM t WHERE id=?').get('d') as any).visible).toBe(1);
    patchRow(db, 't', spec, { visible: false }, { id: 'd' });
    expect((db.prepare('SELECT visible FROM t WHERE id=?').get('d') as any).visible).toBe(0);
  });

  it('json 列自动 stringify', () => {
    seed('e');
    patchRow(db, 't', spec, { tags: ['x', 'y'] }, { id: 'e' });
    expect((db.prepare('SELECT tags FROM t WHERE id=?').get('e') as any).tags).toBe('["x","y"]');
  });

  it('默认写 updated_at，可关掉', () => {
    seed('f');
    patchRow(db, 't', spec, { title: 'z' }, { id: 'f' });
    expect((db.prepare('SELECT updated_at FROM t WHERE id=?').get('f') as any).updated_at)
      .not.toBe('2020-01-01');

    seed('g');
    patchRow(db, 't', { ...spec, touchUpdatedAt: false }, { title: 'z' }, { id: 'g' });
    expect((db.prepare('SELECT updated_at FROM t WHERE id=?').get('g') as any).updated_at)
      .toBe('2020-01-01');
  });

  it('多字段一次原子更新（不是逐字段 N 条 SQL）', () => {
    seed('h');
    const n = patchRow(db, 't', spec, { title: 'multi', visible: true, tags: [1] }, { id: 'h' });
    expect(n).toBe(3);
    const row = db.prepare('SELECT * FROM t WHERE id=?').get('h') as any;
    expect([row.title, row.visible, row.tags]).toEqual(['multi', 1, '[1]']);
  });

  it('where 支持多条件（用于 user_id 归属校验）', () => {
    seed('i');
    // 归属不匹配时不应更新到任何行
    patchRow(db, 't', spec, { title: 'hacked' }, { id: 'i', secret: 'wrong-owner' });
    expect((db.prepare('SELECT title FROM t WHERE id=?').get('i') as any).title).toBe('old');

    patchRow(db, 't', spec, { title: 'ok' }, { id: 'i', secret: 'classified' });
    expect((db.prepare('SELECT title FROM t WHERE id=?').get('i') as any).title).toBe('ok');
  });

  it('非法表名/列名直接抛错，不拼进 SQL', () => {
    expect(() => patchRow(db, 't; DROP TABLE t', spec, { title: 'x' }, { id: 'a' })).toThrow();
    expect(() => patchRow(db, 't', { columns: ['title = 1; --'] }, { 'title = 1; --': 'x' }, { id: 'a' })).toThrow();
    expect(() => patchRow(db, 't', spec, { title: 'x' }, { 'id; DROP TABLE t': 'a' })).toThrow();
  });

  it('缺 where 抛错（防止全表更新）', () => {
    expect(() => patchRow(db, 't', spec, { title: 'x' }, {})).toThrow();
  });
});

describe('initSSE', () => {
  it('设好 SSE 头（含防 nginx 缓冲）并返回可用的 sendEvent', () => {
    const headers: Record<string, string> = {};
    const written: string[] = [];
    let flushed = false;
    const res = {
      setHeader: (k: string, v: string) => { headers[k] = v; },
      flushHeaders: () => { flushed = true; },
      write: (s: string) => { written.push(s); return true; },
    } as any;

    const send = initSSE(res);
    expect(headers['Content-Type']).toContain('text/event-stream');
    expect(headers['Cache-Control']).toContain('no-cache');
    expect(headers['Connection']).toBe('keep-alive');
    expect(headers['X-Accel-Buffering']).toBe('no');
    expect(flushed).toBe(true);

    send('progress', { pct: 50 });
    expect(written[0]).toBe('event: progress\ndata: {"pct":50}\n\n');
  });
});
