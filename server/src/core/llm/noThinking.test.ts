import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import { initDatabase, getDatabase } from '../../db/index.js';
import { aiGateway } from './gateway.js';
import { upsertProvider } from '../../services/aiProviderService.js';

initDatabase();

// 关思维链这件事的失败形态是**「一切正常，只是还是很慢」**：参数被谁吞掉了
// （SDK 不透传未知字段 / 重构时那个 spread 掉了 / 上游 400 之后没重发），
// 请求照样成功、正文照样正常，只有耗时会翻十倍 —— 手测看到的是「今天网络有点慢」。
// 所以这里对着**真的发出去的那个 body** 断言，不是断言调了几次。

const USER = '55555555-5555-5555-5555-555555555555';
const bodies: any[] = [];
/** 下一次请求要不要回一句「不认识 enable_thinking」的 400 */
let reject400 = false;
let server: Server;
let port = 0;

const completion = {
  id: 'x',
  object: 'chat.completion',
  created: 1,
  model: 'm',
  choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
};

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      bodies.push(JSON.parse(raw || '{}'));
      if (reject400) {
        reject400 = false;
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({ error: { message: 'Unrecognized request argument supplied: enable_thinking' } })
        );
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(completion));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  port = (server.address() as any).port;

  const db = getDatabase();
  db.prepare('DELETE FROM ai_providers').run();
  upsertProvider({
    kind: 'llm', tier: 'default', label: 'local', model: 'm',
    base_url: `http://127.0.0.1:${port}/v1`, api_key: 'sk-x', enabled: 1,
  });
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

beforeEach(() => {
  bodies.length = 0;
  reject400 = false;
  getDatabase().prepare('DELETE FROM ai_quota').run();
});

const call = (noThinking?: boolean) =>
  aiGateway(
    { messages: [{ role: 'user', content: 'hi' }] },
    { userId: USER, source: 'consult', operation: 'draft:self', noThinking, maxRetries: 0 }
  );

describe('关思维链的参数', () => {
  it('开了才发，没开一个都不发', async () => {
    await call(true);
    expect(bodies[0].enable_thinking).toBe(false);
    expect(bodies[0].chat_template_kwargs).toEqual({ enable_thinking: false });
    expect(bodies[0].reasoning_effort).toBe('minimal');

    await call();
    // 缺省不许带：评分/抽取那些调用要模型真想一想，悄悄给它关掉是另一个方向的静默事故
    expect(bodies[1].enable_thinking).toBeUndefined();
    expect(bodies[1].reasoning_effort).toBeUndefined();
  });

  it('接入点上勾了「不使用深度思考」，调用方没传也一律不发思维链', async () => {
    // 后台那个勾选框（migration 087）的失败形态最难发现：勾了、保存成功、
    // 列表上写着「已关闭」，而如果 gateway 没把这一列读出来，每次调用照旧慢十倍，
    // 日志里一个字都不会提。所以断言的是**真的发出去的那个 body**。
    const db = getDatabase();
    db.prepare('UPDATE ai_providers SET no_thinking = 1').run();
    try {
      await call();
      expect(bodies[0].enable_thinking).toBe(false);
      expect(bodies[0].reasoning_effort).toBe('minimal');
    } finally {
      db.prepare('UPDATE ai_providers SET no_thinking = 0').run();
    }
  });

  it('上游因为这几个键回 400 时，摘掉重发一次而不是把整次调用报废', async () => {
    // 严格的网关（OpenAI 官方）会拒未知字段。不重发的话换一条接入点之后
    // consult 每次分析都是一句 400 —— 这个开关是为了「快」加的，不该变成「用不了」。
    reject400 = true;
    const { response } = await call(true);
    expect(response.choices[0].message.content).toBe('ok');
    expect(bodies).toHaveLength(2);
    expect(bodies[1].enable_thinking).toBeUndefined();
    expect(bodies[1].messages).toEqual([{ role: 'user', content: 'hi' }]);
  });
});
