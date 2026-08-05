import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { app } from '../app.js';
import { getDatabase } from '../db/index.js';
import { createUser, type TestUser } from './helpers.js';
import { resetRateLimits } from '../auth/rateLimit.js';
import { recordBotAdded, recordRejected } from '../services/feishuAssistant/chatStore.js';

// 路由层测的是归属校验。这个模块的越权后果很具体：
// 拿到别人的应用就能让别人的账号替自己付 AI 账单，读别人的指令日志
// 就能看到别人在飞书群里说过的原话。
//
// 建连被 mock 掉：真的去连飞书需要有效凭证和外网。
vi.mock('../services/feishuAssistant/connection.js', () => ({
  connectApp: vi.fn().mockResolvedValue(undefined),
  disconnectApp: vi.fn().mockResolvedValue(undefined),
  startAllConnections: vi.fn().mockResolvedValue(undefined),
  stopAllConnections: vi.fn().mockResolvedValue(undefined),
  connectionStatus: vi.fn().mockReturnValue('connected'),
  // clientFor 也要在这里 —— 绑定成功后会自动触发一次名册同步，
  // 而 vi.mock 是整模块替换：漏一个导出，取它的时候直接抛
  // 「No export named clientFor」，还是在游离 promise 里抛。
  clientFor: vi.fn(() => ({})),
  // 看门狗：app.ts 在启动块里调它。虽然 IS_TEST 下那段不执行，
  // import 本身仍然要能解析到这个导出。
  startConnectionWatchdog: vi.fn(),
  stopConnectionWatchdog: vi.fn(),
}));

// 同步引擎单独 mock：它真跑起来会打几十次飞书接口。DIRECTORY_SCOPES 用真值
// （capabilities 断言里要用），只把 syncDirectory 换成空实现。
vi.mock('../services/feishuAssistant/directory/sync.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/feishuAssistant/directory/sync.js')>()),
  syncDirectory: vi.fn().mockResolvedValue({ source: 'contact', userCount: 0, departmentCount: 0 }),
}));

let admin: TestUser;
let userA: TestUser;
let userB: TestUser;

beforeAll(() => {
  admin = createUser('admin');
  userA = createUser('user');
  userB = createUser('user');
});

beforeEach(() => {
  // 本模块限流 60 次/分钟，而整个文件里的用例共用同一批测试用户 = 同一个桶。
  // 不清的话，用例攒到 60 个请求之后新加的用例会收到 429，现象是"最后添加的
  // 那个断言莫名红了"，很容易被当成新代码的 bug。
  resetRateLimits();
  const db = getDatabase();
  db.prepare('DELETE FROM feishu_commands').run();
  db.prepare('DELETE FROM feishu_events').run();
  db.prepare('DELETE FROM feishu_directory_users').run();
  db.prepare('DELETE FROM feishu_chats').run();
  db.prepare('DELETE FROM feishu_apps').run();
});

/** 用 userA 的身份建一个应用，返回接口回来的那一行。 */
async function createAppAs(user: TestUser, appId: string, name = '助理') {
  const res = await request(app)
    .post('/api/feishu-assistant/apps')
    .set(user.auth)
    .send({ name, app_id: appId, app_secret: 'super-secret-value', enabled: true });
  expect(res.status).toBe(200);
  return res.body.app;
}

function seedCommand(appIdStr: string, userId: string, text: string) {
  getDatabase()
    .prepare(
      `INSERT INTO feishu_commands
         (id, app_id, user_id, message_id, chat_id, chat_type, sender_open_id, sender_name,
          text, status, created_at)
       VALUES (?, ?, ?, ?, 'oc_x', 'group', 'ou_s', '张三', ?, 'done', ?)`
    )
    .run(`cmd-${text}`, appIdStr, userId, `om-${text}`, text, new Date().toISOString());
}

describe('鉴权：整个模块都需要登录', () => {
  const paths: [string, string][] = [
    ['get', '/api/feishu-assistant/apps'],
    ['get', '/api/feishu-assistant/commands'],
    ['get', '/api/feishu-assistant/capabilities'],
    ['post', '/api/feishu-assistant/apps'],
  ];

  for (const [method, path] of paths) {
    it(`${method.toUpperCase()} ${path} 无 token 时 401`, async () => {
      const res = await (request(app) as any)[method](path);
      expect(res.status).toBe(401);
    });
  }
});

describe('密钥不回显', () => {
  it('创建后返回的是脱敏值，不是明文', async () => {
    const created = await createAppAs(userA, 'cli_secret_test');
    expect(created.app_secret).not.toContain('super-secret-value');
    expect(created.app_secret.length).toBeGreaterThan(0);

    const list = await request(app).get('/api/feishu-assistant/apps').set(userA.auth);
    expect(JSON.stringify(list.body)).not.toContain('super-secret-value');
  });

  it('库里存的是密文（enc:v1: 前缀），不是明文', async () => {
    await createAppAs(userA, 'cli_enc_test');
    const row = getDatabase()
      .prepare('SELECT app_secret FROM feishu_apps WHERE app_id = ?')
      .get('cli_enc_test') as { app_secret: string };
    expect(row.app_secret).toMatch(/^enc:v1:/);
    expect(row.app_secret).not.toContain('super-secret-value');
  });

  it('编辑时不传 app_secret 则保留原密钥', async () => {
    const created = await createAppAs(userA, 'cli_keep_test');
    const before = getDatabase()
      .prepare('SELECT app_secret FROM feishu_apps WHERE id = ?')
      .get(created.id) as { app_secret: string };

    await request(app)
      .post('/api/feishu-assistant/apps')
      .set(userA.auth)
      .send({ id: created.id, name: '改了名字', app_id: 'cli_keep_test', enabled: true });

    const after = getDatabase()
      .prepare('SELECT app_secret, name FROM feishu_apps WHERE id = ?')
      .get(created.id) as { app_secret: string; name: string };
    expect(after.app_secret).toBe(before.app_secret);
    expect(after.name).toBe('改了名字');
  });
});

describe('归属校验：不能操作他人的应用', () => {
  it('userB 看不到 userA 的应用', async () => {
    await createAppAs(userA, 'cli_owned_by_a');
    const res = await request(app).get('/api/feishu-assistant/apps').set(userB.auth);
    expect(res.status).toBe(200);
    expect(res.body.apps).toEqual([]);
  });

  it('userB 改不了 userA 的应用', async () => {
    const created = await createAppAs(userA, 'cli_owned_by_a');
    const res = await request(app)
      .post('/api/feishu-assistant/apps')
      .set(userB.auth)
      .send({ id: created.id, name: '被劫持', app_id: 'cli_owned_by_a', enabled: false });
    expect(res.status).toBe(403);
  });

  it('userB 删不了 userA 的应用', async () => {
    const created = await createAppAs(userA, 'cli_owned_by_a');
    const res = await request(app)
      .delete(`/api/feishu-assistant/apps/${created.id}`)
      .set(userB.auth);
    expect(res.status).toBe(403);
    // 确认真的还在
    expect(getDatabase().prepare('SELECT id FROM feishu_apps WHERE id = ?').get(created.id)).toBeTruthy();
  });

  it('userB 重连不了 userA 的应用', async () => {
    const created = await createAppAs(userA, 'cli_owned_by_a');
    const res = await request(app)
      .post(`/api/feishu-assistant/apps/${created.id}/reconnect`)
      .set(userB.auth);
    expect(res.status).toBe(403);
  });

  // 名册就是一份公司通讯录（姓名、部门、职位）。漏掉归属校验
  // 等于把别人公司的人员名单开放出去，这比越权改配置更糟。
  it('userB 读不了 userA 的名册', async () => {
    const created = await createAppAs(userA, 'cli_owned_by_a');
    const res = await request(app)
      .get(`/api/feishu-assistant/apps/${created.id}/directory`)
      .set(userB.auth);
    expect(res.status).toBe(403);
  });

  // 会话清单里有群名 —— 等于告诉别人这家公司内部有哪些群。
  it('userB 读不了 userA 的会话清单', async () => {
    const created = await createAppAs(userA, 'cli_owned_by_a');
    const res = await request(app)
      .get(`/api/feishu-assistant/apps/${created.id}/chats`)
      .set(userB.auth);
    expect(res.status).toBe(403);
  });

  it('userB 触发不了 userA 的名册同步', async () => {
    const created = await createAppAs(userA, 'cli_owned_by_a');
    const res = await request(app)
      .post(`/api/feishu-assistant/apps/${created.id}/directory/sync`)
      .set(userB.auth);
    expect(res.status).toBe(403);
  });

  it('管理员可以操作任何人的应用', async () => {
    const created = await createAppAs(userA, 'cli_owned_by_a');
    const res = await request(app)
      .post('/api/feishu-assistant/apps')
      .set(admin.auth)
      .send({ id: created.id, name: '管理员改的', app_id: 'cli_owned_by_a', enabled: false });
    expect(res.status).toBe(200);
  });
});

describe('归属不可由请求体指定（否则能让别人替自己付 AI 账单）', () => {
  it('新增时传 user_id 被忽略，归属仍是调用者', async () => {
    const res = await request(app)
      .post('/api/feishu-assistant/apps')
      .set(userB.auth)
      .send({
        name: '偷渡',
        app_id: 'cli_smuggle',
        app_secret: 'x',
        enabled: true,
        // 试图把应用挂到 userA 名下 —— 那样 AI 消耗就记在 userA 头上了。
        user_id: userA.id,
        userId: userA.id,
      });
    expect(res.status).toBe(200);

    const row = getDatabase()
      .prepare('SELECT user_id FROM feishu_apps WHERE app_id = ?')
      .get('cli_smuggle') as { user_id: string };
    expect(row.user_id).toBe(userB.id);
  });

  it('管理员编辑他人应用时不会把归属改到自己名下', async () => {
    const created = await createAppAs(userA, 'cli_owner_stable');
    await request(app)
      .post('/api/feishu-assistant/apps')
      .set(admin.auth)
      .send({ id: created.id, name: '管理员改名', app_id: 'cli_owner_stable', enabled: true });

    const row = getDatabase()
      .prepare('SELECT user_id FROM feishu_apps WHERE id = ?')
      .get(created.id) as { user_id: string };
    expect(row.user_id).toBe(userA.id);
  });
});

describe('同一个 app_id 不能绑定两次', () => {
  it('第二次绑定返回 409 而不是 500', async () => {
    await createAppAs(userA, 'cli_dup');
    const res = await request(app)
      .post('/api/feishu-assistant/apps')
      .set(userA.auth)
      .send({ name: '再来一个', app_id: 'cli_dup', app_secret: 'y', enabled: true });
    expect(res.status).toBe(409);
    expect(res.body.error).toContain('已被绑定');
  });

  it('换个账号来绑同一个 app_id 也拦住（否则会建两条长连接，消息被处理两遍）', async () => {
    await createAppAs(userA, 'cli_dup2');
    const res = await request(app)
      .post('/api/feishu-assistant/apps')
      .set(userB.auth)
      .send({ name: '抢注', app_id: 'cli_dup2', app_secret: 'y', enabled: true });
    expect(res.status).toBe(409);
  });
});

describe('名册同步', () => {
  it('返回 202 而不是等同步跑完（全量通讯录要几十秒）', async () => {
    const created = await createAppAs(userA, 'cli_dir_sync');
    const res = await request(app)
      .post(`/api/feishu-assistant/apps/${created.id}/directory/sync`)
      .set(userA.auth);
    expect(res.status).toBe(202);
    expect(res.body.state).toBe('syncing');
  });

  it('已经在同步中时返回 409，不排第二个', async () => {
    const created = await createAppAs(userA, 'cli_dir_busy');
    // 两次同步并发跑会互相 DELETE 对方刚插进去的行，
    // 最后名册里剩下哪一半取决于时序。
    getDatabase()
      .prepare("UPDATE feishu_apps SET dir_sync_state = 'syncing' WHERE id = ?")
      .run(created.id);

    const res = await request(app)
      .post(`/api/feishu-assistant/apps/${created.id}/directory/sync`)
      .set(userA.auth);
    expect(res.status).toBe(409);
  });

  it('名册接口只返回本应用的人（一个应用 = 一个飞书租户）', async () => {
    const a = await createAppAs(userA, 'cli_dir_a');
    await createAppAs(userB, 'cli_dir_b');
    const now = new Date().toISOString();
    const ins = getDatabase().prepare(
      `INSERT INTO feishu_directory_users (app_id, open_id, name, match_key, updated_at)
       VALUES (?, ?, ?, ?, ?)`
    );
    ins.run('cli_dir_a', 'ou_a', 'A公司的张三', 'a公司的张三', now);
    ins.run('cli_dir_b', 'ou_b', 'B公司的李四', 'b公司的李四', now);

    const res = await request(app)
      .get(`/api/feishu-assistant/apps/${a.id}/directory`)
      .set(userA.auth);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(JSON.stringify(res.body)).not.toContain('B公司的李四');
  });
});

describe('会话清单', () => {
  // chat_id 在飞书客户端里看不到，这个接口是把白名单从「手打 oc_xxx」
  // 变成「勾选群名」的前提。
  it('列出机器人见过的群，并标出被拦过几次', async () => {
    const created = await createAppAs(userA, 'cli_chats');
    recordBotAdded({ appId: 'cli_chats', chatId: 'oc_known', name: '产品群' });
    recordRejected({ appId: 'cli_chats', chatId: 'oc_blocked' });

    const res = await request(app)
      .get(`/api/feishu-assistant/apps/${created.id}/chats`)
      .set(userA.auth);
    expect(res.status).toBe(200);
    // 被拦过的排最前面：用户来这个页面就是因为「在群里 @ 了没反应」。
    expect(res.body.chats[0].chat_id).toBe('oc_blocked');
    expect(res.body.chats[0].reject_count).toBe(1);
    expect(res.body.chats.map((c: any) => c.name)).toContain('产品群');
  });

  it('in_allowlist 由服务端算 —— 白名单为空时全部放行', async () => {
    // 让两个前端页面各自实现这条规则，迟早有一个算错，
    // 而算错的方向是"显示已放行"，用户以为设好防护了。
    const created = await createAppAs(userA, 'cli_chats_empty');
    recordRejected({ appId: 'cli_chats_empty', chatId: 'oc_x' });

    const res = await request(app)
      .get(`/api/feishu-assistant/apps/${created.id}/chats`)
      .set(userA.auth);
    expect(res.body.allowlist_empty).toBe(true);
    expect(res.body.chats[0].in_allowlist).toBe(true);
  });

  it('白名单非空时只有勾过的群算放行', async () => {
    const created = await createAppAs(userA, 'cli_chats_set');
    await request(app)
      .post('/api/feishu-assistant/apps')
      .set(userA.auth)
      .send({ id: created.id, app_id: 'cli_chats_set', enabled: true, allowed_chats: ['oc_in'] });
    recordBotAdded({ appId: 'cli_chats_set', chatId: 'oc_in', name: '放行的群' });
    recordBotAdded({ appId: 'cli_chats_set', chatId: 'oc_out', name: '没放行的群' });

    const res = await request(app)
      .get(`/api/feishu-assistant/apps/${created.id}/chats`)
      .set(userA.auth);
    expect(res.body.allowlist_empty).toBe(false);
    const byId = Object.fromEntries(res.body.chats.map((c: any) => [c.chat_id, c.in_allowlist]));
    expect(byId.oc_in).toBe(true);
    expect(byId.oc_out).toBe(false);
  });

  it('只返回本应用的会话（群名等于公司内部信息）', async () => {
    const a = await createAppAs(userA, 'cli_chats_a');
    await createAppAs(userB, 'cli_chats_b');
    recordBotAdded({ appId: 'cli_chats_a', chatId: 'oc_a', name: 'A公司的群' });
    recordBotAdded({ appId: 'cli_chats_b', chatId: 'oc_b', name: 'B公司的群' });

    const res = await request(app)
      .get(`/api/feishu-assistant/apps/${a.id}/chats`)
      .set(userA.auth);
    expect(JSON.stringify(res.body)).not.toContain('B公司的群');
  });

  it('解绑后不留残行 —— 重新绑定不该看到上一次的群', async () => {
    const created = await createAppAs(userA, 'cli_chats_del');
    recordBotAdded({ appId: 'cli_chats_del', chatId: 'oc_1', name: '旧群' });
    await request(app).delete(`/api/feishu-assistant/apps/${created.id}`).set(userA.auth);

    const again = await createAppAs(userA, 'cli_chats_del');
    const res = await request(app)
      .get(`/api/feishu-assistant/apps/${again.id}/chats`)
      .set(userA.auth);
    expect(res.body.chats).toEqual([]);
  });
});

describe('指令日志的可见范围', () => {
  it('普通用户只看到自己的记录', async () => {
    await createAppAs(userA, 'cli_log_a');
    await createAppAs(userB, 'cli_log_b');
    seedCommand('cli_log_a', userA.id, 'a的秘密指令');
    seedCommand('cli_log_b', userB.id, 'b的指令');

    const res = await request(app).get('/api/feishu-assistant/commands').set(userA.auth);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(JSON.stringify(res.body)).not.toContain('b的指令');
  });

  it('传别人的 app_id 筛选时 403，而不是返回别人的记录', async () => {
    await createAppAs(userB, 'cli_log_b');
    seedCommand('cli_log_b', userB.id, 'b的秘密指令');

    const res = await request(app)
      .get('/api/feishu-assistant/commands?app_id=cli_log_b')
      .set(userA.auth);
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).not.toContain('b的秘密指令');
  });

  it('管理员看到全平台记录，并带上归属账号名', async () => {
    await createAppAs(userA, 'cli_log_a');
    await createAppAs(userB, 'cli_log_b');
    seedCommand('cli_log_a', userA.id, 'a的指令');
    seedCommand('cli_log_b', userB.id, 'b的指令');

    const logs = await request(app).get('/api/feishu-assistant/commands').set(admin.auth);
    expect(logs.body.total).toBe(2);

    const apps = await request(app).get('/api/feishu-assistant/apps').set(admin.auth);
    const owners = apps.body.apps.map((a: any) => a.owner_username);
    expect(owners).toContain(userA.username);
    expect(owners).toContain(userB.username);
  });

  it('普通用户拿到的应用列表不含 owner_username（那是后台视角的字段）', async () => {
    await createAppAs(userA, 'cli_log_a');
    const res = await request(app).get('/api/feishu-assistant/apps').set(userA.auth);
    expect(res.body.apps[0].owner_username).toBeUndefined();
  });
});

describe('指令日志的 error_detail', () => {
  it('接口返回的是对象而不是 JSON 字符串（前端不该再 parse 一遍）', async () => {
    await createAppAs(userA, 'cli_detail');
    const detail = {
      kind: 'scope_denied',
      message: '飞书应用缺少权限。',
      scopes: ['task:task:write'],
      apply_url: 'https://open.feishu.cn/app/cli_detail/auth?q=task%3Atask%3Awrite',
    };
    getDatabase()
      .prepare(
        `INSERT INTO feishu_commands
           (id, app_id, user_id, message_id, chat_id, chat_type, sender_open_id, sender_name,
            text, status, error, error_detail, created_at)
         VALUES ('c1', 'cli_detail', ?, 'om_1', 'oc_x', 'group', 'ou_s', '张三',
                 '建个任务', 'failed', '飞书应用缺少权限。', ?, ?)`
      )
      .run(userA.id, JSON.stringify(detail), new Date().toISOString());

    const res = await request(app).get('/api/feishu-assistant/commands').set(userA.auth);
    expect(res.status).toBe(200);
    expect(res.body.commands[0].error_detail).toEqual(detail);
  });

  it('error_detail 是坏 JSON 时返回 null，不能让整个日志页打不开', async () => {
    await createAppAs(userA, 'cli_bad');
    getDatabase()
      .prepare(
        `INSERT INTO feishu_commands
           (id, app_id, user_id, message_id, chat_id, chat_type, sender_open_id, sender_name,
            text, status, error, error_detail, created_at)
         VALUES ('c2', 'cli_bad', ?, 'om_2', 'oc_x', 'group', 'ou_s', '张三',
                 'x', 'failed', 'boom', '{not json', ?)`
      )
      .run(userA.id, new Date().toISOString());

    const res = await request(app).get('/api/feishu-assistant/commands').set(userA.auth);
    expect(res.status).toBe(200);
    expect(res.body.commands[0].error_detail).toBeNull();
    // 原始文本还在，用户至少能看到错误。
    expect(res.body.commands[0].error).toBe('boom');
  });

  it('成功的记录 error_detail 为 null', async () => {
    await createAppAs(userA, 'cli_ok');
    seedCommand('cli_ok', userA.id, '成功指令');
    const res = await request(app).get('/api/feishu-assistant/commands').set(userA.auth);
    expect(res.body.commands[0].error_detail).toBeNull();
  });
});

describe('能力清单', () => {
  it('列出动作和要开通的权限点，供接入指引一次配齐', async () => {
    const res = await request(app).get('/api/feishu-assistant/capabilities').set(userA.auth);
    expect(res.status).toBe(200);
    expect(res.body.actions.length).toBeGreaterThan(0);
    expect(res.body.scopes).toContain('im:message.group_at_msg:readonly');
    expect(res.body.events).toContain('im.message.receive_v1');
  });

  // 前端「填入示例模板」按钮读的是这个字段。客户端自己抄一份的话，
  // 平台改了默认模板之后按钮填出来的还是旧的，而用户以为那就是当前默认。
  it('带上应用没填规则时实际生效的那份默认规则', async () => {
    const res = await request(app).get('/api/feishu-assistant/capabilities').set(userA.auth);
    expect(typeof res.body.default_supplement).toBe('string');
    // 056 播的模板绑在 slot 上，所以这里应当非空。
    expect(res.body.default_supplement).toContain('术语');
  });
});

// 本企业的补充规则（migration 059）。这一段是按应用存的，因为一个应用 = 一家企业。
describe('本企业的补充规则', () => {
  const put = (user: TestUser, id: string, text: string) =>
    request(app).put(`/api/feishu-assistant/apps/${id}/intent-supplement`).set(user.auth).send({ text });

  it('存下来并在 GET /apps 里回显', async () => {
    const created = await createAppAs(userA, 'cli_supp_1');
    expect(created.intent_supplement).toBe('');

    const res = await put(userA, created.id, '「过一下方案」= 开评审会');
    expect(res.status).toBe(200);
    expect(res.body.app.intent_supplement).toBe('「过一下方案」= 开评审会');

    const list = await request(app).get('/api/feishu-assistant/apps').set(userA.auth);
    expect(list.body.apps[0].intent_supplement).toBe('「过一下方案」= 开评审会');
  });

  it('清空是合法操作（= 回落到平台默认那份）', async () => {
    const created = await createAppAs(userA, 'cli_supp_clear');
    await put(userA, created.id, '先写点东西');
    const res = await put(userA, created.id, '');
    expect(res.status).toBe(200);
    expect(res.body.app.intent_supplement).toBe('');
  });

  it('userB 改不了 userA 的规则', async () => {
    const created = await createAppAs(userA, 'cli_supp_own');
    const res = await put(userB, created.id, '我来改一下别人的助理');
    expect(res.status).toBe(403);
    const row = getDatabase()
      .prepare('SELECT intent_supplement FROM feishu_apps WHERE id = ?')
      .get(created.id) as { intent_supplement: string };
    expect(row.intent_supplement).toBe('');
  });

  it('不存在的应用返回 404', async () => {
    const res = await put(userA, 'nope', 'x');
    expect(res.status).toBe(404);
  });

  it('太长的规则被拒 —— 它每条指令都随 prompt 发一次', async () => {
    const created = await createAppAs(userA, 'cli_supp_long');
    const res = await put(userA, created.id, '啊'.repeat(4001));
    expect(res.status).toBe(400);
  });

  // 最要紧的一条：POST /apps 是整行替换语义，而前端有好几处只带部分字段就调它
  // （停用/启用、一键放行某个群）。规则要是挂在它上面，任何一次这种调用都会把
  // 用户写了半天的那段话清成空串，而且几天后才会被察觉。
  it('只带部分字段的 POST /apps 不会清掉已存的规则', async () => {
    const created = await createAppAs(userA, 'cli_supp_survive');
    await put(userA, created.id, '我们公司的说法');

    // 模拟前端「停用」按钮：只带 id/name/app_id/enabled。
    await request(app)
      .post('/api/feishu-assistant/apps')
      .set(userA.auth)
      .send({ id: created.id, name: '助理', app_id: 'cli_supp_survive', enabled: false });

    const row = getDatabase()
      .prepare('SELECT intent_supplement FROM feishu_apps WHERE id = ?')
      .get(created.id) as { intent_supplement: string };
    expect(row.intent_supplement).toBe('我们公司的说法');
  });
});

describe('参数校验', () => {
  it('新增时缺 app_id 或 app_secret 返回 400', async () => {
    const noId = await request(app)
      .post('/api/feishu-assistant/apps')
      .set(userA.auth)
      .send({ name: 'x', app_secret: 'y' });
    expect(noId.status).toBe(400);

    const noSecret = await request(app)
      .post('/api/feishu-assistant/apps')
      .set(userA.auth)
      .send({ name: 'x', app_id: 'cli_z' });
    expect(noSecret.status).toBe(400);
  });

  it('操作不存在的应用返回 404', async () => {
    const res = await request(app)
      .delete('/api/feishu-assistant/apps/does-not-exist')
      .set(userA.auth);
    expect(res.status).toBe(404);
  });

  it('停用的应用不能重连（先让用户去启用，而不是静默失败）', async () => {
    const created = await createAppAs(userA, 'cli_disabled');
    await request(app)
      .post('/api/feishu-assistant/apps')
      .set(userA.auth)
      .send({ id: created.id, name: '助理', app_id: 'cli_disabled', enabled: false });

    const res = await request(app)
      .post(`/api/feishu-assistant/apps/${created.id}/reconnect`)
      .set(userA.auth);
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('已停用');
  });
});
