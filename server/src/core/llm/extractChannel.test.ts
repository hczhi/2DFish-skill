import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import { initDatabase, getDatabase } from '../../db/index.js';
import { aiGateway } from './gateway.js';
import { EXTRACT_CHANNEL } from './apps.js';
import { upsertProvider } from '../../services/aiProviderService.js';

initDatabase();

// 「内容提取」解析通道（GatewayOptions.channel）。两种失败都是无声的：
//   ① 通道没被认（漏传 / 只在一个入口认）：提取照旧走 consult 那条接入点 ——
//      模型不是管理员配的那个，而结果照样正常返回，后台那条 extract 配置看着好好的；
//   ② 反过来把扣额度/写日志也改成按 channel：提取变成不计任何应用额度的免费调用，
//      而后台「品牌咨询 N 次/天」看起来还配着。
// 所以这里对**真的发出去的 model** 和**落库的 source/额度行**断言。

const USER = '66666666-6666-6666-6666-666666666666';
const models: string[] = [];
let server: Server;

const completion = (model: string) => ({
  id: 'x',
  object: 'chat.completion',
  created: 1,
  model,
  choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
});

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const model = JSON.parse(raw || '{}').model;
      models.push(model);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(completion(model)));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as any).port;

  const db = getDatabase();
  db.prepare('DELETE FROM ai_providers').run();
  const base = { kind: 'llm' as const, base_url: `http://127.0.0.1:${port}/v1`, api_key: 'sk-x', enabled: 1 };
  // 品牌咨询自己那条（现实里是强模型），和只给提取用的那条（现实里是 glm-5.3-flash）。
  upsertProvider({ ...base, tier: 'default', label: 'consult 专用', model: 'consult-model', scope_app: 'consult' });
  upsertProvider({ ...base, tier: 'default', label: '提取专用', model: 'extract-model', scope_app: EXTRACT_CHANNEL });
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

beforeEach(() => {
  models.length = 0;
  const db = getDatabase();
  db.prepare('DELETE FROM ai_logs').run();
  db.prepare('DELETE FROM ai_app_quota').run();
  db.prepare('DELETE FROM ai_quota').run();
});

const call = (opts: Record<string, unknown>) =>
  aiGateway({ messages: [{ role: 'user', content: 'hi' }], max_tokens: 16 }, {
    userId: USER, source: 'consult', operation: 'consult:test', ...opts,
  } as any);

describe('内容提取通道', () => {
  it('提取走通道那条接入点，consult 其余调用照旧走 consult 那条', async () => {
    await call({ channel: EXTRACT_CHANNEL });                    // 图片提取（不带档位）
    await call({ channel: EXTRACT_CHANNEL, tier: 'fast' });      // 文件整理（fast 档）
    await call({});                                             // 对话/出草稿
    // 第二条钉住的是「档位在通道**内部**回落」：通道只配了 default 档时，fast 档不该
    // 掉回 consult 那条 —— 掉回去的话「提取用便宜模型」这件事只对图片生效，
    // 而文件整理照旧烧强模型，两边都返回正常结果。
    expect(models).toEqual(['extract-model', 'extract-model', 'consult-model']);
  });

  it('额度和日志仍记在 consult 上（通道只管接入点）', async () => {
    const db = getDatabase();
    db.prepare('INSERT INTO ai_app_quota (user_id, app, daily_limit, used_today, last_reset_date) VALUES (?, ?, ?, 0, ?)')
      .run(USER, 'consult', 10, new Date().toISOString().split('T')[0]);

    await call({ channel: EXTRACT_CHANNEL });

    expect(db.prepare('SELECT used_today FROM ai_app_quota WHERE user_id = ? AND app = ?').get(USER, 'consult'))
      .toMatchObject({ used_today: 1 });
    expect(db.prepare('SELECT COUNT(*) c FROM ai_app_quota WHERE app = ?').get(EXTRACT_CHANNEL))
      .toMatchObject({ c: 0 });
    // 日志里 source 是应用、model 是通道那条 —— 两者必须同时成立，
    // 否则后台用量页上「品牌咨询」这一格会漏掉提取的开销。
    expect(db.prepare('SELECT source, model FROM ai_logs WHERE user_id = ?').get(USER))
      .toMatchObject({ source: 'consult', model: 'extract-model' });
  });
});
