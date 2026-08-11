import { describe, it, expect, beforeEach, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { initDatabase, getDatabase } from '../../db/index.js';

initDatabase();

// 清空重灌的失败方式全是「看起来成功」的：
//   · 清一半就开始灌 → 表里重复行，回报「✅ 已重建」；
//   · 「跟进状态」没读回来 → 用户点了半天的标记清零，回报「✅ 已重建」；
//   · 清空成功、灌入失败 → 表是空的，只报一句「同步失败」的话用户点开卡片
//     按钮看到空表会以为数据丢了；
//   · 状态位没重置 → 下一次增量同步把已经在表里的行再追加一遍。
// 手测这几条都要去数飞书表里的行数，所以这里断言**发出去的请求**和返回的数字。

const calls: { path: string; method: string; body?: any }[] = [];
// 每个 records GET 依次返回一页；用完之后返回空页。
let recordPages: any[] = [];
let failCreate = false;

vi.mock('./feishuOpen.js', () => ({
  getTenantToken: vi.fn(async () => 'tok'),
  callOpenApi: vi.fn(async (_t: string, path: string, method: string, body?: any) => {
    calls.push({ path, method, body });
    if (method === 'GET' && path.includes('/records?')) {
      return recordPages.shift() ?? { items: [], has_more: false };
    }
    if (method === 'GET' && path.includes('/fields')) return { items: [] };
    if (path.includes('batch_create')) {
      if (failCreate) throw new Error('1254045 字段不存在');
      return { records: (body?.records || []).map(() => ({ record_id: 'rec_new' })) };
    }
    return {};
  }),
}));

const { rebuildBitableTables } = await import('./feishuBitable.js');

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86400_000).toISOString().slice(0, 10);
}

function seedTender(title: string, publishDate = daysAgo(1)): string {
  const id = uuidv4();
  getDatabase()
    .prepare(
      `INSERT INTO tenders (id, platform, notice_id, content_hash, title, publish_date, deadline,
                            budget, budget_amount, purchaser_name, content_text, url, keyword, status, created_at)
       VALUES (?, 'gdgpo', ?, ?, ?, ?, '', '', 0, '', '', '', '', 'extracted', ?)`
    )
    .run(id, id, `hash-${id}`, title, publishDate, new Date().toISOString());
  return id;
}

function seedRec(userId: string, tenderId: string, score = 90) {
  getDatabase()
    .prepare(
      `INSERT INTO tender_recommendations (id, user_id, tender_id, total_score, tier, created_at)
       VALUES (?, ?, ?, ?, 'consider', ?)`
    )
    .run(uuidv4(), userId, tenderId, score, new Date().toISOString());
}

let userId: string;

beforeEach(() => {
  calls.length = 0;
  recordPages = [];
  failCreate = false;
  userId = uuidv4();
  const db = getDatabase();
  db.prepare('DELETE FROM tender_recommendations').run();
  db.prepare('DELETE FROM tender_bitable_sync').run();
  db.prepare('DELETE FROM tenders').run();
  db.prepare('DELETE FROM tender_user_preferences').run();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO user (id, username, password_hash, role, created_at, updated_at)
     VALUES (?, ?, 'x', 'user', ?, ?)`
  ).run(userId, `u-${userId.slice(0, 8)}`, now, now);
  db.prepare(
    `INSERT INTO tender_user_preferences
       (id, user_id, feishu_app_id, feishu_app_secret, feishu_min_score,
        bitable_app_token, bitable_table_id, bitable_enabled, created_at, updated_at)
     VALUES (?, ?, 'cli_x', 'sec_x', 70, 'bascnX', 'tblREC', 1, ?, ?)`
  ).run(uuidv4(), userId, now, now);
});

describe('清空重灌：顺序和内容', () => {
  it('先 batch_delete 再 batch_create —— 反过来就是表里重复行', async () => {
    seedRec(userId, seedTender('达标一'));
    recordPages = [{ items: [{ record_id: 'rec_old', fields: {} }], has_more: false }];

    const r = await rebuildBitableTables(userId, 0);
    expect(r.recommend.cleared).toBe(1);
    expect(r.recommend.written).toBe(1);

    const del = calls.findIndex((c) => c.path.includes('batch_delete'));
    const create = calls.findIndex((c) => c.path.includes('batch_create'));
    expect(del).toBeGreaterThanOrEqual(0);
    expect(create).toBeGreaterThan(del);
  });

  it('用户手填的「跟进状态」按标讯ID写回去', async () => {
    // 这一列我们只建不写，是用户在飞书里自己点的。不保的话每次推送他的标记清零，
    // 而后台报「✅ 已重建」—— 整条链路当初做成只追加不更新就是为了它。
    const t = seedTender('达标一');
    seedRec(userId, t);
    recordPages = [
      { items: [{ record_id: 'rec_old', fields: { 标讯ID: t, 跟进状态: '已报名' } }], has_more: false },
    ];

    const r = await rebuildBitableTables(userId, 0);
    expect(r.followKept).toBe(1);

    const created = calls.find((c) => c.path.includes('batch_create'));
    expect(created!.body.records[0].fields['跟进状态']).toBe('已报名');
  });

  it('分页读完再删 —— 只读第一页会留下删不掉的旧行', async () => {
    seedRec(userId, seedTender('达标一'));
    recordPages = [
      { items: [{ record_id: 'r1', fields: {} }], has_more: true, page_token: 'p2' },
      { items: [{ record_id: 'r2', fields: {} }], has_more: false },
    ];

    const r = await rebuildBitableTables(userId, 0);
    expect(r.recommend.cleared).toBe(2);
    const del = calls.find((c) => c.path.includes('batch_delete'));
    expect(del!.body.records).toEqual(['r1', 'r2']);
  });
});

describe('清空重灌：失败要说「表现在是空的」', () => {
  it('清空成功但灌入失败时返回 error，不假装成功', async () => {
    seedRec(userId, seedTender('达标一'));
    recordPages = [{ items: [{ record_id: 'rec_old', fields: {} }], has_more: false }];
    failCreate = true;

    const r = await rebuildBitableTables(userId, 0);
    expect(r.error).toBeTruthy();
    expect(r.error).toContain('已清空');
    expect(r.recommend.cleared).toBe(1);
    expect(r.recommend.written).toBe(0);
  });

  it('灌入失败时状态位保持未同步 —— 置了位下轮增量同步会跳过这些行，表就永远缺它们', async () => {
    const t = seedTender('达标一');
    seedRec(userId, t);
    recordPages = [{ items: [], has_more: false }];
    failCreate = true;

    await rebuildBitableTables(userId, 0);
    const row = getDatabase()
      .prepare('SELECT bitable_synced_at FROM tender_recommendations WHERE tender_id = ?')
      .get(t) as any;
    expect(row.bitable_synced_at).toBeNull();
  });
});

describe('清空重灌：状态位对齐表里的内容', () => {
  it('重灌成功后只有真的在表里的行才算已同步', async () => {
    // 不重置的话：不达标那条若之前被同步过，状态位还留着「已同步」，
    // 而重灌后它已经不在表里了 —— 增量同步再也不会补它，表和库永久对不上。
    const inTable = seedTender('达标');
    const notInTable = seedTender('不达标');
    seedRec(userId, inTable, 90);
    seedRec(userId, notInTable, 50);
    getDatabase()
      .prepare('UPDATE tender_recommendations SET bitable_synced_at = ? WHERE tender_id = ?')
      .run(new Date().toISOString(), notInTable);
    recordPages = [{ items: [], has_more: false }];

    await rebuildBitableTables(userId, 0);

    const get = (id: string) =>
      (getDatabase()
        .prepare('SELECT bitable_synced_at FROM tender_recommendations WHERE tender_id = ?')
        .get(id) as any).bitable_synced_at;
    expect(get(inTable)).not.toBeNull();
    expect(get(notInTable)).toBeNull();
  });
});
