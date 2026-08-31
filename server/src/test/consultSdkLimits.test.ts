import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';

// 每把 consult pk 的天花板（086）。三条都是「不做的话读起来完全正常」：
// 花钱的端点漏进上限清单 = 那条路对第三方不限量（专属渠道下是无上限烧真钱）；
// 项目数不封顶 = 一个循环建出几万个项目，每次都 200；
// key 停用后短 token 还活 15 分钟 = 管理员以为已经关掉了。

const { app } = await import('../app.js');
const { createUser } = await import('./helpers.js');

const ORIGIN = 'https://partner.example.com';
let admin: ReturnType<typeof createUser>;
let owner: ReturnType<typeof createUser>;

const newKey = async (body: Record<string, unknown>) => {
  const res = await request(app)
    .post('/api/consult/admin/sdk-keys')
    .set(admin.auth)
    .send({ userId: owner.id, allowedOrigins: ORIGIN, ...body });
  expect(res.status).toBe(200);
  return res.body.pk as string;
};

const tokenFor = async (pk: string, euid = 'u1') => {
  const res = await request(app).post('/api/consult/sdk/token').set('Origin', ORIGIN).send({ pk, externalUid: euid });
  expect(res.status).toBe(200);
  return { Authorization: `Bearer ${res.body.token}` };
};

beforeAll(() => {
  admin = createUser('admin');
  owner = createUser('user');
});

describe('consult SDK 每把 key 的上限', () => {
  it('项目数到上限就拒，并说出真实数字', async () => {
    const pk = await newKey({ name: '某代理商', maxProjects: 1 });
    const auth = await tokenFor(pk);
    expect((await request(app).post('/api/consult/projects').set(auth).send({ brandName: 'A' })).status).toBe(200);

    const second = await request(app).post('/api/consult/projects').set(auth).send({ brandName: 'B' });
    expect(second.status).toBe(429);
    expect(second.body.code).toBe('sdk_project_cap');
    expect(second.body.error).toContain('1/1');
  });

  it('AI 额度用完时，每一个花钱的端点都必须 429（不能有漏进清单的）', async () => {
    // 漏一条的后果不是报错，是那条路免费：返回的是一份正常的草稿。
    const pk = await newKey({ name: '冻住的接入方', dailyAiLimit: 0 });
    const auth = await tokenFor(pk);
    const pid = (await request(app).post('/api/consult/projects').set(auth).send({ brandName: 'A' })).body.project.id;

    const paid = [
      `/api/consult/projects/${pid}/stages/audience/draft`,
      `/api/consult/projects/${pid}/stages/audience/directions`,
      `/api/consult/projects/${pid}/stages/audience/chat`,
      `/api/consult/projects/${pid}/stages/audience/search`,
      `/api/consult/projects/${pid}/intake`,
    ];
    for (const path of paid) {
      const res = await request(app).post(path).set(auth).send({ text: 'x', query: 'x' });
      expect(res.status, path).toBe(429);
      expect(res.body.code, path).toBe('sdk_ai_quota');
    }

    // 不花钱的路照常走：把它们一起挡掉的话第三方那边整个工作台变成只读，
    // 而错误文案说的是「AI 额度用完了」——他会去找管理员调额度，调完照旧。
    expect((await request(app).get('/api/consult/projects').set(auth)).status).toBe(200);
    expect(
      (await request(app).put(`/api/consult/projects/${pid}/brief`).set(auth).send({ brief: '补一段' })).status
    ).toBe(200);
  });

  it('停用 key 之后已经签出去的短 token 立刻失效', async () => {
    const pk = await newKey({ name: '待停用' });
    const auth = await tokenFor(pk);
    expect((await request(app).get('/api/consult/projects').set(auth)).status).toBe(200);

    await request(app).patch(`/api/consult/admin/sdk-keys/${pk}`).set(admin.auth).send({ enabled: false });

    const after = await request(app).get('/api/consult/projects').set(auth);
    expect(after.status).toBe(403);
    expect(after.body.code).toBe('sdk_key_disabled');
  });
});
