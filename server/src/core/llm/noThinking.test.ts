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
/** 接下来几次请求回 400；内容由 reject400Message 决定（两种 400 的解法相反） */
let reject400 = 0;
let reject400Message = 'Unrecognized request argument supplied: enable_thinking';
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
/** 这几次返回换成这个（用于「上游报了 reasoning_tokens」那条） */
let nextCompletion: any = null;

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      bodies.push(JSON.parse(raw || '{}'));
      if (reject400 > 0) {
        reject400--;
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: reject400Message } }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(nextCompletion || completion));
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
  reject400 = 0;
  nextCompletion = null;
  reject400Message = 'Unrecognized request argument supplied: enable_thinking';
  getDatabase().prepare('DELETE FROM ai_quota').run();
  getDatabase().prepare('DELETE FROM ai_logs').run();
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
    reject400 = 1;
    const { response } = await call(true);
    expect(response.choices[0].message.content).toBe('ok');
    expect(bodies).toHaveLength(2);
    expect(bodies[1].enable_thinking).toBeUndefined();
    expect(bodies[1].messages).toEqual([{ role: 'user', content: 'hi' }]);
  });

  it('上游说这个模型「始终思考、关不掉」时退到 low，而不是把那几个键摘干净', async () => {
    // 反过来的那一种（实测 glm-5.3-flash）。摘干净重发在这里是错的：换来的是一次
    // 思维链全开的调用，而写 noThinking 的那几条路关它治的是截断 —— 退回全开之后
    // 现象只是「抄到一半就断了」，指不到「模型选错了」。上游自己说的是「用 low/high/max」，
    // 所以退到 low（压得最短），并且**只发这一个键**：另外三个是不是也被拒无从判断。
    reject400 = 1;
    reject400Message = '该模型始终思考，不支持关闭思考；请使用 low、high 或 max。';
    const { response, noThinkingRefused } = await call(true);
    expect(response.choices[0].message.content).toBe('ok');
    expect(bodies).toHaveLength(2);
    expect(bodies[1].reasoning_effort).toBe('low');
    expect(bodies[1].enable_thinking).toBeUndefined();
    expect(bodies[1].chat_template_kwargs).toBeUndefined();
    // 调用方要靠这个标记分岔话术：截断时该说「这个模型关不掉」，
    // 不能说「去后台勾上关思维链」—— 那个勾选框在这条接入点上是死路。
    expect(noThinkingRefused).toBe(true);
  });

  it('连 low 都被拒时才报错，报错里说得出出路', async () => {
    // 到这里真的没有能压住思维链的发法了。这时候**不能**摘干净再来一次：
    // 那一次思维链全开，结果断在半句上，而那种失败读起来只像「模型没答完」。
    reject400 = 2;
    reject400Message = '该模型始终思考，不支持关闭思考；请使用 low、high 或 max。';
    const err: any = await call(true).catch((e) => e);
    expect(bodies).toHaveLength(2);
    expect(err.name).toBe('NoThinkingUnsupportedError');
    expect(String(err.message)).toMatch(/关不掉思维链/);
    expect(String(err.message)).toMatch(/AI 模型 Provider/);   // 换哪里得说清楚
    expect(String(err.message)).toContain('该模型始终思考');   // 上游原话也带上
  });
});

describe('ai_logs 里的思维链用量（107）', () => {
  const lastLog = () =>
    getDatabase()
      .prepare('SELECT reasoning_tokens AS r, finish_reason AS f FROM ai_logs ORDER BY created_at DESC, rowid DESC LIMIT 1')
      .get() as { r: number | null; f: string | null };

  it('上游没报这个明细时存 NULL，不存 0', async () => {
    // 折成 0 的话后台那一列写着「思 0」= 「已经关掉了」，而真相是这条网关压根不报。
    // 这是会伪装成成功的那种：日志一行都不缺、数字看起来还特别理想，
    // 于是唯一有用的方向（换模型 / 点接入点的「测试」）被这个 0 彻底排除掉。
    await call(true);
    expect(lastLog().r).toBeNull();
  });

  it('上游报了就照数存下来，并且带上 finish_reason', async () => {
    // 勾了「不使用深度思考」而它照旧想了 900 token —— 这一条就是「后台配了但没生效」的证据，
    // 以前只在服务器 console.warn 里（线上看不到），后台那一屏和关掉了长得一模一样。
    nextCompletion = {
      ...completion,
      choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'length' }],
      usage: { prompt_tokens: 1, completion_tokens: 6000, total_tokens: 6001, completion_tokens_details: { reasoning_tokens: 900 } },
    };
    await call(true);
    expect(lastLog()).toEqual({ r: 900, f: 'length' });
  });
});
