import { describe, it, expect, vi, beforeEach } from 'vitest';

// 只打桩开放平台那一层，被测函数本体是真的。
const calls: Array<{ path: string; method: string }> = [];
let responses: Record<string, any> = {};

vi.mock('./feishuOpen.js', () => ({
  getTenantToken: vi.fn(async () => 'tok'),
  callOpenApi: vi.fn(async (_tok: string, path: string, method: string) => {
    calls.push({ path, method });
    for (const [pattern, val] of Object.entries(responses)) {
      if (path.includes(pattern)) {
        if (val instanceof Error) throw val;
        return val;
      }
    }
    return {};
  }),
}));

const { cleanupDefaultTables } = await import('./feishuBitable.js');

const CFG = { appId: 'cli', appSecret: 'sec' };
const APP = 'bascnAAA';

/** 造一份「列表 + 每张表的记录/字段」的桩响应。 */
function scenario(tables: Array<{ id: string; records: number; fields: number }>) {
  const r: Record<string, any> = {
    '/tables?page_size=50': { items: tables.map((t) => ({ table_id: t.id, name: t.id })) },
  };
  for (const t of tables) {
    r[`/tables/${t.id}/records`] = { items: Array.from({ length: t.records }, (_, i) => ({ record_id: `r${i}` })) };
    r[`/tables/${t.id}/fields`] = { items: Array.from({ length: t.fields }, (_, i) => ({ field_id: `f${i}` })) };
  }
  return r;
}

const deleted = () =>
  calls.filter((c) => c.method === 'DELETE').map((c) => c.path.split('/tables/')[1]);

beforeEach(() => {
  calls.length = 0;
  responses = {};
});

// 这个函数是管理员点一次按钮就跑的，删掉的表没有回收站。
// 所以判定必须同时满足三条：不在 keepIds、0 条记录、只有 1 个字段。
// 只看「0 条记录」不够 —— 用户自己新建的表在填数据之前也是 0 条。

describe('清理自带空表：删对的那张', () => {
  it('删掉自带的空表，保留我们记录在库的两张', async () => {
    responses = scenario([
      { id: 'tblDEFAULT', records: 0, fields: 1 },   // 自带空表
      { id: 'tblREC', records: 3, fields: 10 },      // 标讯推荐
      { id: 'tblALL', records: 50, fields: 12 },     // 全部标讯
    ]);
    const removed = await cleanupDefaultTables(CFG, APP, ['tblREC', 'tblALL'], 1);
    expect(removed).toEqual(['tblDEFAULT']);
    expect(deleted()).toEqual(['tblDEFAULT']);
  });

  it('没有多余表时什么都不删', async () => {
    responses = scenario([
      { id: 'tblREC', records: 3, fields: 10 },
      { id: 'tblALL', records: 50, fields: 12 },
    ]);
    const removed = await cleanupDefaultTables(CFG, APP, ['tblREC', 'tblALL'], 1);
    expect(removed).toEqual([]);
    expect(deleted()).toEqual([]);
  });

  it('我们的表即使是空的也不删（刚建好还没同步过）', async () => {
    // 新建完还没点过同步时，两张表都是 0 条 1 字段以外的空表 ——
    // keepIds 判断必须在特征判断之前，否则第一次同步前点一下按钮就把表删了。
    responses = scenario([
      { id: 'tblREC', records: 0, fields: 10 },
      { id: 'tblALL', records: 0, fields: 12 },
    ]);
    const removed = await cleanupDefaultTables(CFG, APP, ['tblREC', 'tblALL'], 1);
    expect(removed).toEqual([]);
  });
});

describe('清理自带空表：拿不准就不删', () => {
  it('有记录的表不删，哪怕不在 keepIds 里', async () => {
    // 用户可能自己在这个 base 里建了表放自己的东西。
    responses = scenario([
      { id: 'tblMINE', records: 5, fields: 1 },
      { id: 'tblREC', records: 3, fields: 10 },
    ]);
    const removed = await cleanupDefaultTables(CFG, APP, ['tblREC'], 1);
    expect(removed).toEqual([]);
  });

  it('字段多于 1 个的空表不删 —— 用户新建的表在填数据前也是 0 条', async () => {
    // 这条是「只看记录数」和「记录数+字段数」的分界。少了它会误删用户刚建好的表。
    responses = scenario([
      { id: 'tblUSERNEW', records: 0, fields: 4 },
      { id: 'tblREC', records: 3, fields: 10 },
    ]);
    const removed = await cleanupDefaultTables(CFG, APP, ['tblREC'], 1);
    expect(removed).toEqual([]);
  });

  it('查记录数失败就跳过这张表，不删', async () => {
    responses = {
      '/tables?page_size=50': { items: [{ table_id: 'tblX' }] },
      '/tables/tblX/records': new Error('飞书接口失败'),
    };
    const removed = await cleanupDefaultTables(CFG, APP, [], 1);
    expect(removed).toEqual([]);
    expect(deleted()).toEqual([]);
  });

  it('查字段失败就跳过这张表，不删', async () => {
    responses = {
      '/tables?page_size=50': { items: [{ table_id: 'tblX' }] },
      '/tables/tblX/records': { items: [] },
      '/tables/tblX/fields': new Error('飞书接口失败'),
    };
    const removed = await cleanupDefaultTables(CFG, APP, [], 1);
    expect(removed).toEqual([]);
    expect(deleted()).toEqual([]);
  });

  it('一张表删失败不影响其他表', async () => {
    responses = {
      '/tables?page_size=50': { items: [{ table_id: 'tblA' }, { table_id: 'tblB' }] },
      '/tables/tblA/records': { items: [] },
      '/tables/tblA/fields': { items: [{ field_id: 'f0' }] },
      '/tables/tblB/records': { items: [] },
      '/tables/tblB/fields': { items: [{ field_id: 'f0' }] },
    };
    // tblA 的 DELETE 失败：给它单独挂一条会抛的响应，注意要比 records/fields 更精确
    responses['/tables/tblA'] = new Error('删除失败');
    const removed = await cleanupDefaultTables(CFG, APP, [], 1);
    expect(removed).toEqual(['tblB']);
  });

  it('keepIds 里的空值不会把 undefined 当成要保留的 id', async () => {
    // bitable_all_table_id 可能是 null（老用户没补建过「全部标讯」表）。
    responses = scenario([{ id: 'tblDEFAULT', records: 0, fields: 1 }]);
    const removed = await cleanupDefaultTables(CFG, APP, ['', null as any, undefined as any], 1);
    expect(removed).toEqual(['tblDEFAULT']);
  });
});
