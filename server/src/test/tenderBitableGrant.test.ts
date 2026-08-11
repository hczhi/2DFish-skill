import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import request from 'supertest';

// grantPermission 会真的打飞书开放平台；这里测的是「传下去的 perm 是什么」，
// 所以把它打桩并记录调用参数。同模块里其他导出照原样保留 —— 路由文件顶层
// 就 import 了一整串（createBitable / syncUserRecommendations / getBitableUrl…），
// 少一个就整个 tender 路由挂不起来。
const grantCalls: any[] = [];
const shareCalls: any[] = [];
let setTenantReadableResult = true;
vi.mock('../services/tender/feishuBitable.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/tender/feishuBitable.js')>();
  return {
    ...actual,
    grantPermission: vi.fn(async (_cfg: any, appToken: string, memberType: string, memberId: string, perm: string) => {
      grantCalls.push({ appToken, memberType, memberId, perm });
    }),
    setTenantReadable: vi.fn(async (_cfg: any, appToken: string) => {
      shareCalls.push({ appToken });
      return setTenantReadableResult;
    }),
  };
});

import { app } from '../app.js';
import { getDatabase } from '../db/index.js';
import { createUser, type TestUser } from './helpers.js';

// 多维表格里是一个账号的全部投标信息（预算、评分、AI 分析与策略）。
// 授权给群 = 该群全体成员都能开这张表，所以群权限必须是只读：
// 给整群 edit 的话任何成员都能改、能删记录，而 appendRecords 只追加不更新，
// 别人删掉的行不会被补回来。

let admin: TestUser;
let owner: TestUser;

beforeAll(() => {
  admin = createUser('admin');
  owner = createUser('user');
  // created_at / updated_at 都是 TEXT NOT NULL 且没有默认值，漏了插不进去。
  const now = new Date().toISOString();
  getDatabase()
    .prepare(
      `INSERT INTO tender_user_preferences
         (user_id, feishu_app_id, feishu_app_secret, bitable_app_token, created_at, updated_at)
       VALUES (?, 'cli_test', 'sec_test', 'bascnTEST', ?, ?)`
    )
    .run(owner.id, now, now);
});

beforeEach(() => {
  grantCalls.length = 0;
  shareCalls.length = 0;
  setTenantReadableResult = true;
  // /secure 会改写 bitable_url，每个用例回到「老数据」的起点：裸 base 地址。
  getDatabase()
    .prepare(`UPDATE tender_user_preferences SET bitable_url = ?, bitable_table_id = 'tblREC' WHERE user_id = ?`)
    .run('https://x.feishu.cn/base/bascnTEST', owner.id);
});

const grant = (body: any) =>
  request(app).post(`/api/tender/admin/bitable/${owner.id}/grant`).set(admin.auth).send(body);

describe('多维表格授权：群一律只读', () => {
  it('群授权即使显式请求 edit，也降级成 view', async () => {
    // 这是这条规则的核心：前端改坏、或有人直接打接口，都不能给整群编辑权。
    const res = await grant({ member_type: 'openchat', member_id: 'oc_abc', perm: 'edit' });
    expect(res.status).toBe(200);
    expect(grantCalls[0].perm).toBe('view');
  });

  it('群授权请求 full_access 同样降级成 view', async () => {
    const res = await grant({ member_type: 'openchat', member_id: 'oc_abc', perm: 'full_access' });
    expect(res.status).toBe(200);
    expect(grantCalls[0].perm).toBe('view');
  });

  it('降级要在响应里说出来，不能静默', async () => {
    // 请求 edit 却静默变 view，调用方会以为群成员能编辑，
    // 直到有人反馈「改不了」才发现。
    const res = await grant({ member_type: 'openchat', member_id: 'oc_abc', perm: 'edit' });
    expect(res.body.perm).toBe('view');
    expect(res.body.downgraded).toBe(true);
  });

  it('群授权本来就请求 view 时不算降级', async () => {
    const res = await grant({ member_type: 'openchat', member_id: 'oc_abc', perm: 'view' });
    expect(res.body.perm).toBe('view');
    expect(res.body.downgraded).toBe(false);
  });
});

describe('多维表格授权：个人保持可编辑', () => {
  it('按邮箱授权给个人仍然是 edit —— 表的主人要能维护「跟进状态」这类列', () => {
    return grant({ member_type: 'email', member_id: 'a@b.com', perm: 'edit' }).then((res) => {
      expect(res.status).toBe(200);
      expect(grantCalls[0].perm).toBe('edit');
      expect(res.body.downgraded).toBe(false);
    });
  });

  it('按 open_id 授权给个人也是 edit', async () => {
    await grant({ member_type: 'openid', member_id: 'ou_xxx', perm: 'edit' });
    expect(grantCalls[0].perm).toBe('edit');
  });

  it('个人授权不传 perm 时默认 edit', async () => {
    await grant({ member_type: 'openid', member_id: 'ou_xxx' });
    expect(grantCalls[0].perm).toBe('edit');
  });

  it('个人授权可以显式要只读', async () => {
    await grant({ member_type: 'email', member_id: 'a@b.com', perm: 'view' });
    expect(grantCalls[0].perm).toBe('view');
  });
});

// /secure：给历史表格补做 createBitable 现在会自动做的两件事。
// 这两件事必须分开报成败 —— 合成一个 success 的话，链接分享没设成功却因为
// url 改成功而显示「已处理」，管理员会以为企业内已经能打开了。
describe('多维表格补救：修正链接 + 设为企业内可阅读', () => {
  const secure = () =>
    request(app).post(`/api/tender/admin/bitable/${owner.id}/secure`).set(admin.auth).send({});

  it('裸 base 地址被补上 ?table=，并落库', async () => {
    const res = await secure();
    expect(res.status).toBe(200);
    expect(res.body.url).toBe('https://x.feishu.cn/base/bascnTEST?table=tblREC');
    expect(res.body.urlChanged).toBe(true);

    const saved = getDatabase()
      .prepare('SELECT bitable_url FROM tender_user_preferences WHERE user_id = ?')
      .get(owner.id) as any;
    expect(saved.bitable_url).toBe('https://x.feishu.cn/base/bascnTEST?table=tblREC');
  });

  it('链接本来就对时 urlChanged = false，但仍然会去设链接分享', async () => {
    // 两件事互相独立：链接早就修过的表，可见范围可能还是老的「关闭分享」。
    getDatabase()
      .prepare('UPDATE tender_user_preferences SET bitable_url = ? WHERE user_id = ?')
      .run('https://x.feishu.cn/base/bascnTEST?table=tblREC', owner.id);

    const res = await secure();
    expect(res.body.urlChanged).toBe(false);
    expect(shareCalls).toHaveLength(1);
  });

  it('设置链接分享失败要如实报出来，不能算成功', async () => {
    // 这一步失败意味着表还停在租户默认可见范围 —— 可能比企业内更宽（互联网可见），
    // 也可能是老表的「关闭分享」（企业内的人打开是无权限）。报成功的话
    // 管理员会以为全员已经能看了，直到有人说「打不开」才发现。
    setTenantReadableResult = false;
    const res = await secure();
    expect(res.status).toBe(200);
    expect(res.body.urlChanged).toBe(true);      // 链接这件事成了
    expect(res.body.tenantReadable).toBe(false); // 可见范围这件事没成，分开报
  });

  it('没建过表格的用户直接拒绝，不去打飞书', async () => {
    const other = createUser('user');
    const res = await request(app)
      .post(`/api/tender/admin/bitable/${other.id}/secure`)
      .set(admin.auth)
      .send({});
    expect(res.status).toBe(400);
    expect(shareCalls).toHaveLength(0);
  });

  it('缺 bitable_table_id 时拒绝 —— 否则会存出一个 ?table= 空值的链接', async () => {
    getDatabase()
      .prepare(`UPDATE tender_user_preferences SET bitable_table_id = '' WHERE user_id = ?`)
      .run(owner.id);
    const res = await secure();
    expect(res.status).toBe(400);
    expect(shareCalls).toHaveLength(0);
  });

  it('非管理员打不到这个接口', async () => {
    const outsider = createUser('user');
    const res = await request(app)
      .post(`/api/tender/admin/bitable/${owner.id}/secure`)
      .set(outsider.auth)
      .send({});
    expect(res.status).toBe(403);
    expect(shareCalls).toHaveLength(0);
  });
});

describe('多维表格授权：入参校验', () => {
  it('member_type 不在白名单里直接拒绝', async () => {
    const res = await grant({ member_type: 'everyone', member_id: 'x', perm: 'view' });
    expect(res.status).toBe(400);
    expect(grantCalls).toHaveLength(0);
  });

  it('缺 member_id 直接拒绝', async () => {
    const res = await grant({ member_type: 'openchat' });
    expect(res.status).toBe(400);
    expect(grantCalls).toHaveLength(0);
  });

  it('非管理员打不到这个接口', async () => {
    const outsider = createUser('user');
    const res = await request(app)
      .post(`/api/tender/admin/bitable/${owner.id}/grant`)
      .set(outsider.auth)
      .send({ member_type: 'openchat', member_id: 'oc_abc' });
    expect(res.status).toBe(403);
    expect(grantCalls).toHaveLength(0);
  });
});
