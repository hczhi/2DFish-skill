import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../app.js';
import { getDatabase } from '../db/index.js';
import { createUser, type TestUser } from './helpers.js';

// PATCH 路由从"手拼 SET 片段"改成 patchRow 后的端到端行为回归。
// 单测已经盖了 patchRow 本身，这里确认接线没接错：白名单、boolean 转换、
// updated_at、404、no-fields 400 在真实 HTTP 层都还是原来的语义。

let admin: TestUser;
let slotId: string;

beforeAll(async () => {
  admin = createUser('admin');
  const res = await request(app).post('/api/ad-slots/admin').set(admin.auth).send({
    page_pattern: '/patch-test',
    position: 'sidebar',
    label: '原始标签',
    enabled: 1,
    height: 90,
  });
  expect(res.status).toBe(201);
  slotId = res.body.id;
});

describe('PATCH /api/ad-slots/admin/:id', () => {
  it('更新白名单内字段并回写 updated_at', async () => {
    const before = getDatabase().prepare('SELECT updated_at FROM ad_slots WHERE id = ?').get(slotId) as any;

    const res = await request(app).patch(`/api/ad-slots/admin/${slotId}`)
      .set(admin.auth).send({ label: '新标签', sort_order: 7 });

    expect(res.status).toBe(200);
    expect(res.body.label).toBe('新标签');
    expect(res.body.sort_order).toBe(7);
    expect(res.body.updated_at).not.toBe(before.updated_at);
  });

  it('boolean 字段存成 0/1（不是 true/false 字符串）', async () => {
    await request(app).patch(`/api/ad-slots/admin/${slotId}`).set(admin.auth).send({ enabled: false });
    let row = getDatabase().prepare('SELECT enabled FROM ad_slots WHERE id = ?').get(slotId) as any;
    expect(row.enabled).toBe(0);

    await request(app).patch(`/api/ad-slots/admin/${slotId}`).set(admin.auth).send({ enabled: true });
    row = getDatabase().prepare('SELECT enabled FROM ad_slots WHERE id = ?').get(slotId) as any;
    expect(row.enabled).toBe(1);
  });

  it('白名单外的字段被忽略，不会写进库', async () => {
    const res = await request(app).patch(`/api/ad-slots/admin/${slotId}`)
      .set(admin.auth).send({ label: '合法', id: 'hacked-id', created_at: '1999-01-01' });

    expect(res.status).toBe(200);
    const row = getDatabase().prepare('SELECT * FROM ad_slots WHERE id = ?').get(slotId) as any;
    expect(row.id).toBe(slotId);              // 主键没被改
    expect(row.created_at).not.toBe('1999-01-01');
  });

  it('body 里没有任何可更新字段 → 400，且不改动记录', async () => {
    const before = getDatabase().prepare('SELECT * FROM ad_slots WHERE id = ?').get(slotId) as any;

    const res = await request(app).patch(`/api/ad-slots/admin/${slotId}`)
      .set(admin.auth).send({ nonexistent_field: 'x' });

    expect(res.status).toBe(400);
    const after = getDatabase().prepare('SELECT * FROM ad_slots WHERE id = ?').get(slotId) as any;
    expect(after).toEqual(before);
  });

  it('不存在的 id → 404', async () => {
    const res = await request(app).patch('/api/ad-slots/admin/no-such-id')
      .set(admin.auth).send({ label: 'x' });
    expect(res.status).toBe(404);
  });

  it('普通用户不能 PATCH（闸门仍生效）', async () => {
    const user = createUser('user');
    const res = await request(app).patch(`/api/ad-slots/admin/${slotId}`)
      .set(user.auth).send({ label: 'hacked' });
    expect(res.status).toBe(403);

    const row = getDatabase().prepare('SELECT label FROM ad_slots WHERE id = ?').get(slotId) as any;
    expect(row.label).not.toBe('hacked');
  });
});

describe('分页收口后的行为', () => {
  it('page_size 为负数时不再产出负 LIMIT（旧写法会 500 或返回全表）', async () => {
    const res = await request(app).get('/api/ad-slots/admin/list?page=-1&page_size=-5').set(admin.auth);
    expect(res.status).toBe(200);
    expect(res.body.page).toBeGreaterThanOrEqual(1);
    expect(res.body.page_size).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(res.body.items)).toBe(true);
  });

  it('page_size 超大时被钳到上限', async () => {
    const res = await request(app).get('/api/ad-slots/admin/list?page_size=999999').set(admin.auth);
    expect(res.status).toBe(200);
    expect(res.body.page_size).toBeLessThanOrEqual(100);
  });
});
