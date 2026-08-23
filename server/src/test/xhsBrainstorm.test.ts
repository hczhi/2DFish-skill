import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import request from 'supertest';

// /xhs/writer 的「帮我发散观点」。两种失败在界面上都不像失败：
//
// 1. 模型回了合法 JSON 但没有 ideas 那一栏 → 以前回 200 + `ideas: []`，面板显示的是
//    「还没有结果，点上面「帮我发散观点」」，读起来像没点过 —— 而额度已经扣了；
// 2. 思维链吃光 max_tokens（content 为空 / 断在半个 JSON 上）→ 以前和「模型没按 JSON
//    格式回」合成同一句「AI 返回格式异常，请重试」，用户会一路怀疑自己的选题写得不好、
//    一路重试（每次扣一次额度），而真凶是这个端点的额度给小了。
const reply = { text: '', finish: 'stop' as string };
vi.mock('../core/llm/gateway.js', () => ({
  aiGateway: vi.fn(async () => ({
    response: {
      choices: [{ message: { content: reply.text }, finish_reason: reply.finish }],
      usage: {
        prompt_tokens: 500,
        completion_tokens: 11900,
        total_tokens: 12400,
        completion_tokens_details: { reasoning_tokens: 11800 },
      },
    },
    usage: { input_tokens: 500, output_tokens: 11900, total_tokens: 12400 },
  })),
  aiGatewayStream: vi.fn(),
  SAMPLING: { analytic: { temperature: 0.2 }, brainstorm: {}, creative: {}, rewrite: {} },
  QuotaExceededError: class extends Error {},
}));

const { app } = await import('../app.js');
const { getDatabase } = await import('../db/index.js');
const { createUser } = await import('./helpers.js');

let auth: { Authorization: string };
beforeAll(() => {
  const u = createUser('user');
  auth = u.auth;
  getDatabase()
    .prepare('INSERT INTO ai_quota (user_id, daily_limit, used_today, last_reset_date) VALUES (?, 999, 0, ?)')
    .run(u.id, new Date().toISOString().slice(0, 10));
});
beforeEach(() => {
  getDatabase().prepare('UPDATE ai_quota SET used_today = 0').run();
});

const ask = () =>
  request(app).post('/api/xhs/brainstorm').set(auth).send({ topic: '远程办公一年后的真实感受' });

describe('POST /api/xhs/brainstorm 拿不到观点时不能回 200', () => {
  it('合法 JSON 但一条观点都没有 → 报错，而不是一个空面板', async () => {
    reply.text = '{"points":["模型用了别的键名"]}';
    reply.finish = 'stop';

    const res = await ask();

    expect(res.status).toBe(502);
  });

  it('思维链吃光额度（空返回）→ 报错里要点名思维链，不能只说「格式异常」', async () => {
    reply.text = '';
    reply.finish = 'length';

    const res = await ask();

    expect(res.status).toBe(502);
    // 这句话是用户唯一能看出「该换模型 / 该调额度」而不是「该改选题」的地方
    expect(res.body.error).toContain('思维链');
  });
});
