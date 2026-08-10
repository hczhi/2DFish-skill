import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app } from '../app.js';
import { getDatabase } from '../db/index.js';
import { createUser, type TestUser } from './helpers.js';

// 飞书 Skill 后台路由。两件事必须由路由层保证：
//   1. 全部 admin 专属 —— 技能包里会注入企业密钥，普通用户不该能读能导出。
//   2. 导入的目录路径是外部输入，不能借它读到目录外面去。
vi.mock('../services/feishuAssistant/connection.js', () => ({
  connectApp: vi.fn().mockResolvedValue(undefined),
  disconnectApp: vi.fn().mockResolvedValue(undefined),
  startAllConnections: vi.fn().mockResolvedValue(undefined),
  stopAllConnections: vi.fn().mockResolvedValue(undefined),
  connectionStatus: vi.fn().mockReturnValue('connected'),
  clientFor: vi.fn(() => ({})),
  startConnectionWatchdog: vi.fn(),
  stopConnectionWatchdog: vi.fn(),
}));

let admin: TestUser;
let user: TestUser;
const BASE = '/api/admin/agent-skills';

beforeAll(() => {
  admin = createUser('admin');
  user = createUser('user');
});

beforeEach(() => {
  const db = getDatabase();
  // 库里已经没有内置技能了（064 播的那个 group-assistant 随 aily 版群助理一起删了，
  // 见 migration 067），所以这里可以无条件清空。
  db.prepare('DELETE FROM agent_skills').run();
  db.prepare('DELETE FROM agent_bots').run();
});

describe('权限', () => {
  it('普通用户读不到技能列表', async () => {
    const res = await request(app).get(`${BASE}/skills`).set(user.auth);
    expect(res.status).toBe(403);
  });

  it('未登录一律 401', async () => {
    expect((await request(app).get(`${BASE}/skills`)).status).toBe(401);
  });

  it('普通用户不能导出技能包', async () => {
    // 导出包里带注入后的密钥明文，这条比列表更要紧。
    // 用一个不存在的 id：403 必须由 requireAdmin 在路由入口给出，
    // 而不是「查不到技能」的 404 —— 后者意味着越权的人已经进到处理函数里了，
    // 换个真实存在的 id 就能拿到包。
    const res = await request(app).post(`${BASE}/skills/whatever/export`).set(user.auth).send({});
    expect(res.status).toBe(403);
  });
});

describe('技能增删改', () => {
  it('新建时自带一个能通过校验的 SKILL.md 骨架', async () => {
    // 管理员面对空白编辑器通常不知道 frontmatter 该写什么，
    // 而空技能一冻结就报「缺 SKILL.md」。
    const res = await request(app).post(`${BASE}/skills`).set(admin.auth).send({ name: 'my-skill' });
    expect(res.status).toBe(201);

    const detail = await request(app).get(`${BASE}/skills/${res.body.skill.id}`).set(admin.auth);
    const paths = detail.body.files.map((f: any) => f.path);
    expect(paths).toContain('SKILL.md');
    // 骨架正文里调了 scripts/example.py，那这个文件就得在包里，
    // 否则新建完立刻带一条我们自己造出来的校验 error。
    expect(paths).toContain('scripts/example.py');
    const md = detail.body.files.find((f: any) => f.path === 'SKILL.md').body;
    expect(md).toContain('name: my-skill');
    expect(md).toContain('cd ~/.aily/workspace/skills/my-skill');
    expect(detail.body.issues.filter((i: any) => i.level === 'error')).toEqual([]);
  });

  it('技能名不合法时 400，重名 409', async () => {
    expect(
      (await request(app).post(`${BASE}/skills`).set(admin.auth).send({ name: 'Bad Name!' })).status
    ).toBe(400);
    await request(app).post(`${BASE}/skills`).set(admin.auth).send({ name: 'dup' });
    expect(
      (await request(app).post(`${BASE}/skills`).set(admin.auth).send({ name: 'dup' })).status
    ).toBe(409);
  });
});

describe('文件路径不能逃出技能目录', () => {
  it('带 .. 的路径被 400 挡掉', async () => {
    // 导出时这些 path 会被拼到一个目录下写盘。
    const { body } = await request(app).post(`${BASE}/skills`).set(admin.auth).send({ name: 'trav' });
    const res = await request(app)
      .put(`${BASE}/skills/${body.skill.id}/files`)
      .set(admin.auth)
      .send({ path: '../../etc/passwd', body: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/\.\./);
  });
});

describe('冻结与导出', () => {
  async function mkReady(name: string) {
    // 新建就自带能过校验的骨架（SKILL.md + scripts/example.py），不用再补文件
    const { body } = await request(app).post(`${BASE}/skills`).set(admin.auth).send({ name });
    return body.skill.id as string;
  }

  it('校验有 error 时冻结被 400 拒绝，并把问题列出来', async () => {
    const { body } = await request(app).post(`${BASE}/skills`).set(admin.auth).send({ name: 'broken' });
    // 删掉骨架脚本 → 正文里的 python3 scripts/example.py 指向不存在的文件
    const files = (await request(app).get(`${BASE}/skills/${body.skill.id}/files`).set(admin.auth)).body.files;
    const script = files.find((f: any) => f.path === 'scripts/example.py');
    await request(app).delete(`${BASE}/skills/${body.skill.id}/files/${script.id}`).set(admin.auth);

    const res = await request(app).post(`${BASE}/skills/${body.skill.id}/versions`).set(admin.auth).send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/校验未通过/);
    // 只说「校验未通过」用户不知道改哪，issues 必须跟着回来
    expect(res.body.issues.some((i: any) => i.level === 'error')).toBe(true);
  });

  it('导出时返回人工步骤和未解析的占位符', async () => {
    // 「发布」最后一步只能人工，界面必须说出来，否则用户点完就以为生效了。
    const id = await mkReady('exportable');
    await request(app)
      .put(`${BASE}/skills/${id}/files`)
      .set(admin.auth)
      .send({ path: 'scripts/example.py', body: 'T="{{MY_TOKEN}}"\n' });

    const bot = await request(app).post(`${BASE}/bots`).set(admin.auth).send({ name: 'A 企业' });
    const res = await request(app)
      .post(`${BASE}/skills/${id}/export`)
      .set(admin.auth)
      .send({ bot_id: bot.body.bot.id });

    expect(res.status).toBe(200);
    expect(res.body.version).toBe(1);
    expect(res.body.unresolved).toEqual(['MY_TOKEN']);
    expect(res.body.manual_steps.join(' ')).toMatch(/上传技能包/);
    expect(res.body.files.map((f: any) => f.path)).toContain('SKILL.md');
  });

  it('导出后部署记录停在 exported，确认后才是 live', async () => {
    const id = await mkReady('deployable');
    const bot = await request(app).post(`${BASE}/bots`).set(admin.auth).send({ name: 'B 企业' });
    await request(app).post(`${BASE}/skills/${id}/export`).set(admin.auth).send({ bot_id: bot.body.bot.id });

    let deps = (await request(app).get(`${BASE}/deployments`).query({ skill_id: id }).set(admin.auth)).body
      .deployments;
    expect(deps[0].status).toBe('exported');

    await request(app).post(`${BASE}/deployments/${deps[0].id}/confirm`).set(admin.auth).send({});
    deps = (await request(app).get(`${BASE}/deployments`).query({ skill_id: id }).set(admin.auth)).body
      .deployments;
    expect(deps[0].status).toBe('live');
  });
});

describe('导入', () => {
  it('导入服务器目录，跳过的项目原样返回', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'imp-'));
    fs.writeFileSync(
      path.join(dir, 'SKILL.md'),
      `---\nname: imported-one\nlabel: 导入的\ndescription: d\n---\n# x\n`
    );
    fs.writeFileSync(path.join(dir, 'blob.bin'), Buffer.from([1, 2, 3]));

    const res = await request(app).post(`${BASE}/import/directory`).set(admin.auth).send({ dir });
    expect(res.status).toBe(201);
    expect(res.body.skill.name).toBe('imported-one');
    expect(res.body.skipped.map((s: any) => s.path)).toContain('blob.bin');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('一个目录里有多个 SKILL.md 时按套件导，每个一条记录', async () => {
    // 当成一个技能导的话，子技能的 SKILL.md 变成普通文件躺在包里 ——
    // aily 不会加载它们，也不报错，界面上还显示「导入成功，N 个文件」。
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'suite-'));
    const md = (n: string) =>
      `---\nname: ${n}\nlabel: L\ndescription: d\n---\n\`\`\`bash\ncd ~/.aily/workspace/skills/${n}\n\`\`\`\n`;
    fs.writeFileSync(path.join(dir, 'SKILL.md'), md('rt-root'));
    fs.mkdirSync(path.join(dir, 'rt-child'));
    fs.writeFileSync(path.join(dir, 'rt-child', 'SKILL.md'), md('rt-child'));

    const insp = await request(app).post(`${BASE}/import/inspect`).set(admin.auth).send({ dir });
    expect(insp.body.skills.map((s: any) => s.name).sort()).toEqual(['rt-child', 'rt-root']);

    const res = await request(app).post(`${BASE}/import/directory`).set(admin.auth).send({ dir });
    expect(res.status).toBe(201);
    expect(res.body.mode).toBe('suite');
    expect(res.body.skills.map((s: any) => s.skill.name).sort()).toEqual(['rt-child', 'rt-root']);
    expect(res.body.failed).toEqual([]);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('目录不存在时 400，报的是路径问题而不是 500', async () => {
    const res = await request(app)
      .post(`${BASE}/import/directory`)
      .set(admin.auth)
      .send({ dir: '/definitely/not/here' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/目录不存在/);
  });
});

describe('状态码来自抛错的地方，不靠猜中文措辞', () => {
  // 之前是按消息里的关键词反猜状态码：「目录不存在」（其实是参数错）被判成 404，
  // 而「变量名只能是大写字母…」一个关键词都没匹配上 → 500。
  // 新加一句中文错误消息就可能落在错的状态码上，而且没人看得出来。
  it('参数错是 400，找不到东西才是 404，重名是 409', async () => {
    const cases: [Promise<any>, number][] = [
      // 参数不合法 → 400
      [request(app).post(`${BASE}/skills`).set(admin.auth).send({ name: 'Bad Name!' }), 400],
      [request(app).post(`${BASE}/import/directory`).set(admin.auth).send({ dir: '/definitely/not/here' }), 400],
      // 资源不存在 → 404
      [request(app).get(`${BASE}/skills/no-such-id`).set(admin.auth), 404],
      [request(app).post(`${BASE}/deployments/no-such-id/confirm`).set(admin.auth).send({}), 404],
    ];
    for (const [req, want] of cases) {
      const res = await req;
      expect(res.status, JSON.stringify(res.body)).toBe(want);
    }
    await request(app).post(`${BASE}/skills`).set(admin.auth).send({ name: 'code-dup' });
    const dup = await request(app).post(`${BASE}/skills`).set(admin.auth).send({ name: 'code-dup' });
    expect(dup.status).toBe(409);
    // 重名的报错不该把 SQLITE_CONSTRAINT 原文透到界面上
    expect(dup.body.error).not.toMatch(/UNIQUE|SQLITE/);
  });
});

describe('变量', () => {
  it('GET 一律脱敏，没有明文读取接口', async () => {
    // 后台页面没有任何需要看到完整密钥的场景，能读就意味着会被读。
    const bot = await request(app).post(`${BASE}/bots`).set(admin.auth).send({ name: 'S 企业' });
    const botId = bot.body.bot.id;
    await request(app)
      .post(`${BASE}/bots/${botId}/variables`)
      .set(admin.auth)
      .send({ key: 'MY_TOKEN', value: 'mmPla_verysecretvalue0001', is_secret: true });

    const res = await request(app).get(`${BASE}/bots/${botId}/variables`).set(admin.auth);
    expect(res.body.variables[0].value).not.toBe('mmPla_verysecretvalue0001');
    expect(res.body.variables[0].value).toContain('...');
  });

  it('变量名不合规范时 400', async () => {
    const bot = await request(app).post(`${BASE}/bots`).set(admin.auth).send({ name: 'V' });
    const res = await request(app)
      .post(`${BASE}/bots/${bot.body.bot.id}/variables`)
      .set(admin.auth)
      .send({ key: 'lower case', value: 'x' });
    expect(res.status).toBe(400);
  });
});
