import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import { app as expressApp } from '../app.js';
import { getDatabase } from '../db/index.js';
import { createUser, type TestUser } from './helpers.js';

// 后台侧「按应用配专属 token / 按应用配额度」的 HTTP 层回归（migrations/062）。
// service 层的解析优先级另有单测（aiProviderService.perApp.test.ts / appQuota.test.ts）；
// 这里守的是接线：scope_app 有没有被校验和存下去、面板要的字段有没有真返回、
// 改额度会不会顺手把今天的用量抹掉。

let admin: TestUser;
let target: TestUser;

beforeAll(() => {
  admin = createUser('admin');
  target = createUser('user');
});

beforeEach(() => {
  const db = getDatabase();
  db.prepare('DELETE FROM ai_providers').run();
  db.prepare('DELETE FROM ai_app_quota').run();
});

function postProvider(body: Record<string, unknown>) {
  return request(expressApp).post('/api/admin/providers').set(admin.auth).send({
    kind: 'llm',
    tier: 'default',
    label: '测试模型',
    base_url: 'https://example.test/v1',
    api_key: 'sk-abcdefghijklmnop',
    model: 'test-model',
    ...body,
  });
}

describe('POST /api/admin/providers 的 scope_app', () => {
  it('白名单内的 app 存得下来，并能被列表读回', async () => {
    const res = await postProvider({ scope_app: 'xhs', owner_user_id: target.id });
    expect(res.status).toBe(200);
    expect(res.body.provider.scope_app).toBe('xhs');
    // key 依旧脱敏，别因为加了字段把这条给漏了
    expect(res.body.provider.api_key).not.toContain('abcdefghijklmnop');

    const list = await request(expressApp)
      .get('/api/admin/providers')
      .query({ owner_user_id: target.id })
      .set(admin.auth);
    expect(list.body.providers.map((p: any) => p.scope_app)).toEqual(['xhs']);
  });

  it('拼错的 app 名被 400 挡住，且不落库', async () => {
    // 这是整个功能最容易出的错：scope_app 靠字符串等于 source 来匹配，
    // 存进去一个 'XHS' 的表现是「保存成功、界面正常、永远不生效」。
    const res = await postProvider({ scope_app: 'XHS' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('XHS');
    expect(res.body.error).toContain('xhs');   // 顺手把可选值列出来，否则管理员只能猜
    expect(getDatabase().prepare('SELECT COUNT(*) c FROM ai_providers').get()).toMatchObject({ c: 0 });
  });

  it('不传 scope_app 就是通用配置（存空串，不是 NULL）', async () => {
    const res = await postProvider({});
    expect(res.status).toBe(200);
    expect(res.body.provider.scope_app).toBe('');
    const row = getDatabase()
      .prepare('SELECT scope_app FROM ai_providers WHERE id = ?')
      .get(res.body.provider.id) as any;
    expect(row.scope_app).toBe('');
  });

  it('编辑一条应用专用配置时不带 scope_app，不会把它变成通用', async () => {
    // 前端表单少提交一个字段，就把「xhs 专用」悄悄升级成「全站生效」——
    // 那是把一个应用的 key 摊给所有应用用。
    const created = await postProvider({ scope_app: 'tender' });
    const edited = await request(expressApp).post('/api/admin/providers').set(admin.auth).send({
      id: created.body.provider.id,
      label: '改个名',
      api_key: '',   // 空串 = 不改动
    });
    expect(edited.status).toBe(200);
    expect(edited.body.provider.scope_app).toBe('tender');
    expect(edited.body.provider.label).toBe('改个名');
  });

  it('编辑时不带 owner_user_id，不会把用户专属配置变成平台配置', async () => {
    // 同一个洞的另一半，后果更重：这条配置一旦掉成平台级，
    // 该用户以为自己在烧自己的 key，实际是平台在替他付钱（052 想禁掉的正是这件事）。
    const created = await postProvider({ owner_user_id: target.id });
    const edited = await request(expressApp).post('/api/admin/providers').set(admin.auth).send({
      id: created.body.provider.id,
      model: 'another-model',
      api_key: '',
    });
    expect(edited.status).toBe(200);
    expect(edited.body.provider.owner_user_id).toBe(target.id);
    // 平台列表（不传 owner_user_id）里不该出现它
    const platform = await request(expressApp).get('/api/admin/providers').set(admin.auth);
    expect(platform.body.providers).toEqual([]);
  });

  it('显式传空的 scope_app 能把应用专用改回通用', async () => {
    // 上一条的保留逻辑不能顺手把「主动改回通用」也堵死 ——
    // 那样管理员就只剩「删掉重建」一条路，而重建要重新贴一次 key。
    const created = await postProvider({ owner_user_id: target.id, scope_app: 'xhs' });
    const edited = await request(expressApp).post('/api/admin/providers').set(admin.auth).send({
      id: created.body.provider.id,
      scope_app: '',
      api_key: '',
    });
    expect(edited.body.provider.scope_app).toBe('');
    expect(edited.body.provider.owner_user_id).toBe(target.id);
  });

  it('owner_user_id 传 null 改不动归属（刻意如此，要转归属得删掉重建）', async () => {
    // 反方向不对称：scope_app 改归属只是换一把谁的 key 给哪个应用用，付钱的人不变；
    // owner 改成 null 是把这条配置变成平台配置 —— 全站开始烧他那把 key。
    // upsertProvider 的 `??` 挡住了这一步，这里把它钉住，别哪天「顺手改成对称」。
    const created = await postProvider({ owner_user_id: target.id });
    const edited = await request(expressApp).post('/api/admin/providers').set(admin.auth).send({
      id: created.body.provider.id,
      owner_user_id: null,
      api_key: '',
    });
    expect(edited.body.provider.owner_user_id).toBe(target.id);
  });
});

describe('GET /api/admin/users/:id/dedicated-ai 的按应用信息', () => {
  it('返回应用清单、逐应用解析结果和应用额度', async () => {
    const res = await request(expressApp)
      .get(`/api/admin/users/${target.id}/dedicated-ai`)
      .set(admin.auth);
    expect(res.status).toBe(200);
    // 下拉框的选项由后端给，前端不再自己抄一份 —— 抄的那份迟早和 AI_APPS 对不上
    expect(res.body.apps.map((a: any) => a.id)).toContain('xhs');
    expect(res.body.apps.every((a: any) => a.name)).toBe(true);
    expect(Object.keys(res.body.app_resolutions)).toEqual(res.body.apps.map((a: any) => a.id));
    // 三档逐一报告，一条都没配时是 null 而不是缺 key
    expect(res.body.app_resolutions.xhs.map((r: any) => r.tier)).toEqual(['default', 'strong', 'fast']);
    expect(res.body.app_resolutions.xhs.every((r: any) => r.providerId === null)).toBe(true);
    expect(res.body.app_quotas).toEqual([]);
  });

  it('只给 xhs 配了 fast 时，strong 档标出 fallbackToShared', async () => {
    // 面板必须把这件事说出来：管理员以为 xhs 全走自己那把便宜 key，
    // 实际 strong 档在烧通用配置的模型。
    for (const tier of ['default', 'strong', 'fast']) {
      await postProvider({ tier, label: `通用-${tier}`, owner_user_id: target.id });
    }
    await postProvider({ tier: 'fast', label: 'xhs-fast', owner_user_id: target.id, scope_app: 'xhs' });

    const res = await request(expressApp)
      .get(`/api/admin/users/${target.id}/dedicated-ai`)
      .set(admin.auth);
    const byTier = Object.fromEntries(res.body.app_resolutions.xhs.map((r: any) => [r.tier, r]));
    expect(byTier.fast).toMatchObject({ label: 'xhs-fast', fallbackToShared: false });
    expect(byTier.strong).toMatchObject({ label: '通用-strong', fallbackToShared: true });
  });

  it('完备性只算通用配置：只配 xhs 三档不解锁专属开关', async () => {
    for (const tier of ['default', 'strong', 'fast']) {
      await postProvider({ tier, label: `xhs-${tier}`, owner_user_id: target.id, scope_app: 'xhs' });
    }
    const res = await request(expressApp)
      .get(`/api/admin/users/${target.id}/dedicated-ai`)
      .set(admin.auth);
    expect(res.body.status.ready).toBe(false);

    // 开关也真的打不开（否则其他应用一点就 503）
    const patch = await request(expressApp)
      .patch(`/api/admin/users/${target.id}/dedicated-ai`)
      .set(admin.auth)
      .send({ enabled: true });
    expect(patch.status).toBe(400);
    expect(patch.body.missing_tiers).toEqual(['default', 'strong', 'fast']);
  });

  it('用户不存在时 404', async () => {
    const res = await request(expressApp).get('/api/admin/users/no-such-user/dedicated-ai').set(admin.auth);
    expect(res.status).toBe(404);
  });
});

describe('PUT /api/admin/users/:id/app-quota', () => {
  const readQuota = (app: string) =>
    getDatabase().prepare('SELECT * FROM ai_app_quota WHERE user_id = ? AND app = ?').get(target.id, app) as any;

  const put = (body: Record<string, unknown>) =>
    request(expressApp).put(`/api/admin/users/${target.id}/app-quota`).set(admin.auth).send(body);

  it('设置上限后能在 dedicated-ai 里读回', async () => {
    expect((await put({ app: 'xhs', daily_limit: 20 })).status).toBe(200);
    const res = await request(expressApp)
      .get(`/api/admin/users/${target.id}/dedicated-ai`)
      .set(admin.auth);
    expect(res.body.app_quotas).toEqual([{ app: 'xhs', used: 0, limit: 20, remaining: 20 }]);
  });

  it('daily_limit = 0 是合法值，表示掐停该应用', async () => {
    // 和「取消限制」必须是两件事。当成非法值挡掉，管理员就没有临时停用的手段。
    expect((await put({ app: 'xhs', daily_limit: 0 })).status).toBe(200);
    expect(readQuota('xhs').daily_limit).toBe(0);
  });

  it('daily_limit = null 删掉这一行（取消限制），而不是设成 0', async () => {
    await put({ app: 'xhs', daily_limit: 5 });
    const res = await put({ app: 'xhs', daily_limit: null });
    expect(res.status).toBe(200);
    expect(res.body.daily_limit).toBeNull();
    expect(readQuota('xhs')).toBeUndefined();
  });

  it('改上限不清零今天的用量', async () => {
    // 否则「调一次额度」就等于「白送一天」，可以反复刷。
    await put({ app: 'xhs', daily_limit: 5 });
    getDatabase().prepare('UPDATE ai_app_quota SET used_today = 4 WHERE user_id = ? AND app = ?').run(target.id, 'xhs');
    await put({ app: 'xhs', daily_limit: 50 });
    const row = readQuota('xhs');
    expect(row.daily_limit).toBe(50);
    expect(row.used_today).toBe(4);
  });

  it('非整数 / 负数 / 缺 app / 未知 app 一律 400', async () => {
    expect((await put({ app: 'xhs', daily_limit: 1.5 })).status).toBe(400);
    expect((await put({ app: 'xhs', daily_limit: -1 })).status).toBe(400);
    expect((await put({ app: 'xhs', daily_limit: '10' })).status).toBe(400);
    expect((await put({ daily_limit: 10 })).status).toBe(400);
    const bad = await put({ app: 'XHS', daily_limit: 10 });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toContain('xhs');
    expect(getDatabase().prepare('SELECT COUNT(*) c FROM ai_app_quota').get()).toMatchObject({ c: 0 });
  });

  it('用户不存在时 404，而且不会凭空建配额行', async () => {
    const res = await request(expressApp)
      .put('/api/admin/users/no-such-user/app-quota')
      .set(admin.auth)
      .send({ app: 'xhs', daily_limit: 10 });
    expect(res.status).toBe(404);
    expect(getDatabase().prepare('SELECT COUNT(*) c FROM ai_app_quota').get()).toMatchObject({ c: 0 });
  });
});

describe('权限', () => {
  it('普通用户碰不到这些接口', async () => {
    const user = createUser('user');
    expect((await request(expressApp).get(`/api/admin/users/${target.id}/dedicated-ai`).set(user.auth)).status).toBe(403);
    expect(
      (await request(expressApp).put(`/api/admin/users/${target.id}/app-quota`).set(user.auth).send({ app: 'xhs', daily_limit: 1 })).status
    ).toBe(403);
    expect((await request(expressApp).post('/api/admin/providers').set(user.auth).send({})).status).toBe(403);
  });
});
