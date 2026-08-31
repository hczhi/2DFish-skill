import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

// 品牌咨询对外接入（084）。这个文件只测「出错时会伪装成成功」的四条：
// scope 短 token 越界照样 200、它能调发 key 的后台接口、Origin 白名单形同虚设、
// externalUid 缺失时静默共用一个租户。四条在界面上/接入方那边全部读起来完全正常。

const { app } = await import('../app.js');
const { createUser, signScopedToken } = await import('./helpers.js');
const { getJwtSecret } = await import('../auth/middleware.js');

let admin: ReturnType<typeof createUser>;
let owner: ReturnType<typeof createUser>;
let pk: string;

const ORIGIN = 'https://partner.example.com';

beforeAll(async () => {
  admin = createUser('admin');
  owner = createUser('user');
  const res = await request(app)
    .post('/api/consult/admin/sdk-keys')
    .set(admin.auth)
    .send({ userId: owner.id, name: '某代理商', allowedOrigins: `${ORIGIN}/` });
  expect(res.status).toBe(200);
  pk = res.body.pk;
});

const exchange = (body: Record<string, unknown>, origin = ORIGIN) =>
  request(app).post('/api/consult/sdk/token').set('Origin', origin).send(body);

describe('consult SDK 短 token 的边界', () => {
  it('别的模块签出来的 scope 短 token 不能在这里建项目', async () => {
    // 闸门原来只挂在 tenderRouter 里面，于是一把写在第三方页面 JS 里的
    // `tender:read` 短 token 能以绑定账号的身份建 consult 项目、烧它的 AI 额度 ——
    // 返回的是一个正常的项目对象，后台看不出这次请求来自一把公开的 pk。
    const token = signScopedToken(owner.id, 'tender:read');
    const res = await request(app)
      .post('/api/consult/projects')
      .set({ Authorization: `Bearer ${token}` })
      .send({ brandName: '捷停车' });
    expect(res.status).toBe(403);
    expect(res.body.scope).toBe('tender:read');
  });

  it('consult:embed 短 token 碰不到发 key 的后台接口', async () => {
    // 放行整棵 /api/consult 子树的话，第三方页面里那把公开 pk 换来的 token
    // 能列出（甚至新建）所有接入方的 key —— 返回的是一份正常的 JSON 列表。
    const token = signScopedToken(owner.id, 'consult:embed');
    const res = await request(app).get('/api/consult/admin/sdk-keys').set({ Authorization: `Bearer ${token}` });
    expect(res.status).toBe(403);
  });

  it('Origin 不在白名单里不签发，并把收到的那一行回出去', async () => {
    // 签出来的话白名单等于没配：抄走 pk 的人在自己域名下照样能用。
    // 错误里必须带**收到的** Origin —— 接入方最常见的错是配了 https 用了 http，
    // 只回一句 not allowed 的话他核对的是自己配的那一行。
    const res = await exchange({ pk, externalUid: 'u1' }, 'http://evil.example.com');
    expect(res.status).toBe(403);
    expect(res.body.error).toContain('http://evil.example.com');
  });

  it('externalUid 必填，给了就签进 token（不落成请求参数）', async () => {
    // 缺省成空串的话这个接入方所有终端用户共用一个归属键：A 客户的品牌资料
    // 出现在 B 客户的项目列表里，而那个列表就是一列正常的项目。
    const missing = await exchange({ pk });
    expect(missing.status).toBe(400);
    expect(missing.body.error).toContain('externalUid');

    const ok = await exchange({ pk, externalUid: 'tenant-42' });
    expect(ok.status).toBe(200);
    expect(ok.body.external_uid).toBe('tenant-42');
    const claims = jwt.verify(ok.body.token, getJwtSecret()) as Record<string, string>;
    expect(claims.euid).toBe('tenant-42');
    expect(claims.pk).toBe(pk);
    expect(claims.id).toBe(owner.id); // 归属账号由 pk 定，前端传不了
  });

  it('同一把 key 下两个 externalUid 互相看不见对方的项目', async () => {
    // 085 之前归属键只有 user_id，一把 pk 下所有终端用户共用它：A 客户的品牌名 +
    // 整份客户原始资料会列在 B 客户的项目列表里，而那个列表就是一列正常的项目
    // （进度数、字数全对，一句错都没有）。
    const tokenA = (await exchange({ pk, externalUid: 'tenant-a' })).body.token as string;
    const tokenB = (await exchange({ pk, externalUid: 'tenant-b' })).body.token as string;
    const asA = { Authorization: `Bearer ${tokenA}` };
    const asB = { Authorization: `Bearer ${tokenB}` };

    const created = await request(app).post('/api/consult/projects').set(asA).send({ brandName: 'A家的品牌' });
    expect(created.status).toBe(200);
    const pid = created.body.project.id as string;

    const listB = await request(app).get('/api/consult/projects').set(asB);
    expect(listB.status).toBe(200);
    expect(listB.body).toEqual([]);
    // 带上项目 id 直接读也必须是 404：列表筛掉了而详情没筛的话，
    // 换个 id 就能读到整份诊断，返回的是一个正常的项目对象。
    expect((await request(app).get(`/api/consult/projects/${pid}`).set(asB)).status).toBe(404);

    // 绑定账号自己在网页上的工作台也看不见第三方客户的项目（sdk_pk 一个是 NULL）。
    const listOwner = await request(app).get('/api/consult/projects').set(owner.auth);
    expect(listOwner.body).toEqual([]);

    expect((await request(app).get('/api/consult/projects').set(asA)).body).toHaveLength(1);
  });
});
