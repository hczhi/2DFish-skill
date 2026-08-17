import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import request from 'supertest';

// 带思维链的模型把 reasoning_tokens 算进 max_tokens 却不放进 content，
// 于是 content 为空/半截。这条路径原来回 200 + 字段全空，前端只能把用户刚问的
// 那句话翻上看板 —— 屏幕上是「今天下雨」，看起来像答案就是问题，没有任何报错。
const reply = { text: '', finish: 'stop' };
vi.mock('../core/llm/gateway.js', () => ({
  aiGateway: vi.fn(async () => ({
    response: {
      choices: [{ message: { content: reply.text }, finish_reason: reply.finish }],
      usage: { prompt_tokens: 100, completion_tokens: 900, total_tokens: 1000, completion_tokens_details: { reasoning_tokens: 880 } },
    },
    usage: { input_tokens: 100, output_tokens: 900, total_tokens: 1000 },
  })),
  QuotaExceededError: class extends Error {},
}));

const { app } = await import('../app.js');
const { getDatabase } = await import('../db/index.js');
const { createUser } = await import('./helpers.js');

// 带上登录身份并把额度调高：匿名访客一天只有 3 次，让配额掺进来的话这个文件
// 测的就变成「第三条请求会不会 429」了。
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

const ask = () => request(app).post('/api/ai/board/chat').set(auth).send({ message: '今天下雨' });

describe('POST /api/ai/board/chat 拿不到答案时不能回 200', () => {
  it('模型返回空内容 → 报错，而不是一个字段全空的成功', async () => {
    reply.text = '';
    reply.finish = 'length';

    const res = await ask();

    expect(res.status).toBe(502);
    // 真凶要说出来：光看「没答案」用户会以为是自己的问题问得不好。
    expect(res.body.error).toContain('思维链');
  });

  it('模型只吐了一半 JSON → 报错，不能把半个对象当答案', async () => {
    reply.text = '{"keyword":"雨","key_sentence":"雨落';
    reply.finish = 'length';

    const res = await ask();

    expect(res.status).toBe(502);
  });

  it('正常返回时照旧给出 keyword / key_sentence / 用量', async () => {
    reply.text = '```json\n{"keyword":"雨","key_sentence":"雨落无声","interpretation":"解读","domain":"知识域"}\n```';
    reply.finish = 'stop';

    const res = await ask();

    expect(res.status).toBe(200);
    expect(res.body.keyword).toBe('雨');
    expect(res.body.key_sentence).toBe('雨落无声');
    expect(res.body.usage?.total_tokens).toBe(1000);
  });
});
