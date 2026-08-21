import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import { app as expressApp } from '../app.js';
import { getDatabase } from '../db/index.js';
import { createUser, type TestUser } from './helpers.js';
import { upsertProvider } from '../services/aiProviderService.js';
import { createRelayKey } from '../services/relayKeyService.js';

// 对外中转接口的闸门（migration 082）。这里守的三条全是「下游那边看着一切正常」：
// 关掉的接口照样出结果、stream 被无声忽略于是客户端等一个永不到来的 SSE、
// 「key 抄错了」和「接口已关闭」合成同一句话于是下游永远在核对那把没错的 key。
// 成功转发那条不测（要 mock 上游，且真出错时下游立刻看得见）。

let owner: TestUser;

function addProvider(enabled = true) {
  return upsertProvider({
    kind: 'llm',
    tier: 'default',
    label: '专属default',
    model: 'qwen-plus',
    base_url: 'https://example.test/v1',
    api_key: 'sk-upstream',
    enabled: enabled ? 1 : 0,
    owner_user_id: owner.id,
  });
}

function post(key: string, body: Record<string, unknown> = {}) {
  return request(expressApp)
    .post('/api/v1/chat/completions')
    .set({ Authorization: `Bearer ${key}` })
    .send({ model: '随便填的模型名', messages: [{ role: 'user', content: '你好' }], ...body });
}

beforeAll(() => {
  owner = createUser('user');
});

beforeEach(() => {
  const db = getDatabase();
  db.prepare('DELETE FROM llm_relay_keys').run();
  db.prepare('DELETE FROM ai_providers').run();
  db.prepare('DELETE FROM ai_app_quota').run();
  db.prepare('UPDATE user SET use_dedicated_ai = 1 WHERE id = ?').run(owner.id);
});

describe('POST /api/v1/chat/completions 的闸门', () => {
  it('接入点停用 / 删除 / 专属开关关掉，一律 403「接口已关闭」，不会照样转发', async () => {
    const p = addProvider();
    const { key } = createRelayKey(owner.id, p.id);
    const db = getDatabase();

    // 停用
    db.prepare('UPDATE ai_providers SET enabled = 0 WHERE id = ?').run(p.id);
    let res = await post(key);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('endpoint_closed');

    // 专属渠道开关关掉（接入点本身是好的）—— 管理员关它的意思就是「这条通道不再用」
    db.prepare('UPDATE ai_providers SET enabled = 1 WHERE id = ?').run(p.id);
    db.prepare('UPDATE user SET use_dedicated_ai = 0 WHERE id = ?').run(owner.id);
    res = await post(key);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('endpoint_closed');
  });

  it('key 不存在回的是 401 invalid_api_key，和「已关闭」不是同一句话', async () => {
    const res = await post('sk-mmpla-nosuchkey');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('invalid_api_key');
  });

  it('额度填 0 就真的调不通，回的是 OpenAI 形状的 429', async () => {
    // 这条同时守着「限流真的作用在对外接口上」：scope 接错的话上限填了也不生效，
    // 下游照样能调，而后台那个数字看着已经生效了。
    const p = addProvider();
    const { key } = createRelayKey(owner.id, p.id);
    getDatabase()
      .prepare('INSERT OR REPLACE INTO ai_app_quota (user_id, app, daily_limit, used_today, last_reset_date) VALUES (?, ?, 0, 0, ?)')
      .run(owner.id, 'relay', new Date().toISOString().split('T')[0]);

    const res = await post(key);
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('quota_exceeded');
  });

  it('stream: true 必须明确拒，不能当没看见', async () => {
    // 无声忽略的话客户端会一直等 SSE 帧，界面上是「AI 没回答」，没有一处报错。
    const p = addProvider();
    const { key } = createRelayKey(owner.id, p.id);
    const res = await post(key, { stream: true });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('stream_not_supported');
  });
});

describe('GET /api/v1/models', () => {
  it('只列绑定的那一个模型', async () => {
    // 多列一个就等于让人选一个选了也不生效的模型：选完照样出结果，
    // 只是出自另一个模型，界面上完全看不出来。
    const p = addProvider();
    upsertProvider({ kind: 'llm', tier: 'strong', label: '另一条', model: 'gpt-4o', base_url: 'https://example.test/v1', api_key: 'sk-x', owner_user_id: owner.id });
    const { key } = createRelayKey(owner.id, p.id);

    const res = await request(expressApp).get('/api/v1/models').set({ Authorization: `Bearer ${key}` });
    expect(res.status).toBe(200);
    expect(res.body.data.map((m: any) => m.id)).toEqual(['qwen-plus']);
  });
});
