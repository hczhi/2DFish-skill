import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';

// 展示稿对外接入的准入面（100）。四件事出错时第三方那边看到的都是「一切正常」：
//   ① 管理员点了停用，而已经签出去的那把短 token 还能再用一刻钟；
//   ② scope 放宽了一格 → 那把公开 pk 能停用账号级的版式、甚至再发一把 key，每次调用都是 200；
//   ③ 花钱的端点漏登记 → 那条路对第三方不限量（开了专属渠道就是烧他自己的 key），而后台用量
//      看起来完全正常；
//   ④ frame-ancestors 取了两个模块的并集 → 只接了咨询的伙伴顺带能嵌展示稿工作台。
const { app } = await import('../app.js');
const { createUser } = await import('./helpers.js');
const { isPptAiSpendRoute } = await import('../services/ppt/sdkLimits.js');

const PPT_ORIGIN = 'https://ppt-partner.example.com';
const CONSULT_ORIGIN = 'https://consult-partner.example.com';

let admin: ReturnType<typeof createUser>;
let pk: string;
let token: string;

async function exchange(): Promise<string> {
  const res = await request(app)
    .post('/api/ppt/sdk/token')
    .set('Origin', PPT_ORIGIN)
    .send({ pk, externalUid: 'end-user-1' });
  expect(res.status).toBe(200);
  return res.body.token;
}

beforeAll(async () => {
  admin = createUser('admin');
  const owner = createUser('user');
  const created = await request(app)
    .post('/api/ppt/admin/sdk-keys')
    .set(admin.auth)
    .send({ userId: owner.id, name: '某代理商', allowedOrigins: PPT_ORIGIN });
  expect(created.status).toBe(200);
  pk = created.body.pk;
  // 另一个模块的 key，域名故意不同 —— 用来盯住「两份名单不合并」。
  await request(app)
    .post('/api/consult/admin/sdk-keys')
    .set(admin.auth)
    .send({ userId: owner.id, name: '只接了咨询的', allowedOrigins: CONSULT_ORIGIN });
  token = await exchange();
});

describe('ppt 对外接入', () => {
  it('停用 key 之后，那把还没过期的短 token 立刻就用不了', async () => {
    expect((await request(app).get('/api/ppt/decks').set({ Authorization: `Bearer ${token}` })).status).toBe(200);

    await request(app).patch(`/api/ppt/admin/sdk-keys/${pk}`).set(admin.auth).send({ enabled: false });

    const after = await request(app).get('/api/ppt/decks').set({ Authorization: `Bearer ${token}` });
    expect(after.status).toBe(403);
    expect(after.body.code).toBe('sdk_key_disabled');
    // 换新 token 也换不到（不然接入方重试一次就绕过了停用）。
    expect(
      (await request(app).post('/api/ppt/sdk/token').set('Origin', PPT_ORIGIN).send({ pk, externalUid: 'u' })).status
    ).toBe(401);

    await request(app).patch(`/api/ppt/admin/sdk-keys/${pk}`).set(admin.auth).send({ enabled: true });
    token = await exchange();
  });

  it('这把 token 碰不到平台级的那几条（停用版式 / 共享资料 / 发 key），素材库是通的', async () => {
    const auth = { Authorization: `Bearer ${token}` };
    // 账号级开关：一个接入方关掉一个版式，绑定账号自己和别的接入方从此都排不出它。
    expect((await request(app).put('/api/ppt/layouts/L1/enabled').set(auth).send({ enabled: false })).status).toBe(403);
    // deck 外壳的共享 CSS/配色资料，前端一处都没在调 —— 不对外开。
    expect((await request(app).get('/api/ppt/library/assets').set(auth)).status).toBe(403);
    // 发 key 的后台接口。
    expect((await request(app).post('/api/ppt/admin/sdk-keys').set(auth).send({ userId: 'x' })).status).toBe(403);
    // 工作台真要用的那两棵子树是通的（挡住的话嵌进去是一片 403，读起来像整个模块坏了；
    // 素材库挡住则是「每次要同一张图都得重新生一次」，那是真钱）。
    expect((await request(app).get('/api/ppt/decks').set(auth)).status).toBe(200);
    expect((await request(app).get('/api/ppt/assets').set(auth)).status).toBe(200);
  });

  it('会花钱的端点逐条登记在案（漏一条那条路对第三方就是免费不限量）', () => {
    for (const path of [
      '/decks/d1/clean-outline', '/decks/d1/plan', '/decks/d1/pages', '/decks/d1/replan-images',
      '/decks/d1/prepare-images', '/decks/d1/ai-edit', '/decks/d1/ai-remake', '/decks/d1/images',
    ]) {
      expect(isPptAiSpendRoute('POST', path), path).toBe(true);
    }
    // 纯代码的那几条不能算钱：算进去的话接入方点几下排版就把当天的额度耗光，而他一次模型都没调。
    for (const path of ['/decks/d1/edit-text', '/decks/d1/canvas', '/decks/d1/deck', '/decks/d1/export']) {
      expect(isPptAiSpendRoute('POST', path), path).toBe(false);
    }
  });

  it('稿子数到上限就建不了（否则白名单域名内一个循环能建几万份）', async () => {
    await request(app).patch(`/api/ppt/admin/sdk-keys/${pk}`).set(admin.auth).send({ maxDecks: 0 });
    const res = await request(app)
      .post('/api/ppt/decks')
      .set({ Authorization: `Bearer ${token}` })
      .send({ title: '压上限', outline: '一、开头' });
    expect(res.status).toBe(429);
    expect(res.body.code).toBe('sdk_deck_cap');
    await request(app).patch(`/api/ppt/admin/sdk-keys/${pk}`).set(admin.auth).send({ maxDecks: 50 });
  });

  // 全局 cors() 会短路 OPTIONS 预检（第三方域名不在它的白名单里），所以换 token 那条路必须
  // 在它**之前**单独放行。漏了的话浏览器在预检那一步就拦掉请求：接入方页面上是一块空白、
  // 我们这边一条日志都没有（预检压根没进到路由），换 token 的 POST 从来没发出去过。
  it('第三方域名的预检（OPTIONS 换 token）放得过去', async () => {
    const res = await request(app)
      .options('/api/ppt/sdk/token')
      .set('Origin', PPT_ORIGIN)
      .set('Access-Control-Request-Method', 'POST');
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe(PPT_ORIGIN);
  });

  it('/ppt 只放行 ppt 那把 key 的域名，两个模块的名单不合并', async () => {
    const ppt = await request(app).get('/ppt/decks');
    expect(ppt.headers['x-frame-options']).toBeUndefined();
    expect(ppt.headers['content-security-policy']).toContain(`frame-ancestors ${PPT_ORIGIN}`);
    // 只接了咨询的伙伴不该顺带能把展示稿工作台套进自己页面。
    expect(ppt.headers['content-security-policy']).not.toContain(CONSULT_ORIGIN);
    expect((await request(app).get('/consult/projects')).headers['content-security-policy']).not.toContain(PPT_ORIGIN);
  });
});
