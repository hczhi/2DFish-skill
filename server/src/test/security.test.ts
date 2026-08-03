import { describe, it, expect, beforeAll, vi } from 'vitest';
import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';

// /start 是 fire-and-forget 的：合法 URL 会真的拉起 Playwright 去爬外网。
// 测试只关心「鉴权 / SSRF / 配额」这三层，把流水线打桩掉，否则每跑一次测试
// 都在启浏览器打真实网络——慢且不可复现。
vi.mock('../services/uiReview/orchestrator.js', () => ({
  executeReview: vi.fn(async () => {}),
  getLatestProgress: vi.fn(() => null),
  failInterruptedReviews: vi.fn(() => 0),
}));

// safeUrl 会对域名做真实 DNS 解析。测试里把它换成固定结果：
// example.com → 一个公网 IP（走通合法分支），其余域名解析失败。
// 不打桩的话 CI 断网就红、且每个用例多花几百毫秒。
// 注意：所有 SSRF 拒绝用例用的都是 IP 字面量/localhost/非法协议/非法端口，
// 在 DNS 之前就被拒，因此不受这个桩影响。
vi.mock('dns/promises', () => ({
  default: {
    lookup: vi.fn(async (hostname: string) => {
      if (hostname === 'example.com') return [{ address: '93.184.216.34', family: 4 }];
      throw new Error(`ENOTFOUND ${hostname}`);
    }),
  },
}));

import { app } from '../app.js';
import { getDatabase } from '../db/index.js';
import { createUser, signScopedToken, type TestUser } from './helpers.js';
import { anonymousId } from '../auth/requester.js';

// ============================================================================
// 回归测试：这一批断言对应的都是真实修过的漏洞。
// 任何一条挂掉，都意味着某个越权/SSRF/配额隔离的修复被改回去了。
// ============================================================================

let admin: TestUser;
let userA: TestUser;
let userB: TestUser;

beforeAll(() => {
  admin = createUser('admin');
  userA = createUser('user');
  userB = createUser('user');
});

/** 插一条 ui_reviews 记录并返回 id。 */
function seedReview(userId: string, url = 'https://example.com/'): string {
  const id = uuidv4();
  getDatabase().prepare(`
    INSERT INTO ui_reviews (id, user_id, url, reference_image_url, mode, status, created_at)
    VALUES (?, ?, ?, '', 'standard', 'completed', ?)
  `).run(id, userId, url, new Date().toISOString());
  return id;
}

describe('admin 闸门：普通用户不得访问任何 /admin 路由', () => {
  // 覆盖全部 7 个改成中间件闸门的 router，确保闸门真的挂上了而不只是删了 if。
  const cases: [string, string][] = [
    ['GET', '/api/ui-review/admin/rules'],
    ['GET', '/api/ui-review/admin/skills'],
    ['GET', '/api/ui-review/admin/reviews'],
    ['GET', '/api/discover/topics/admin/list'],
    ['GET', '/api/ad-slots/admin/list'],
    ['GET', '/api/analytics/stats/overview'],
    ['GET', '/api/home/admin/modules'],
    ['GET', '/api/discover/admin/articles'],
    ['GET', '/api/seo/admin/pages'],
    ['GET', '/api/tender/admin/tenders'],
    ['GET', '/api/tender/admin/sdk-keys'],
  ];

  for (const [method, path] of cases) {
    it(`${method} ${path} — 普通用户 403`, async () => {
      const res = await request(app)[method.toLowerCase() as 'get'](path).set(userA.auth);
      expect(res.status).toBe(403);
    });

    it(`${method} ${path} — 无 token 不得返回 2xx`, async () => {
      const res = await request(app)[method.toLowerCase() as 'get'](path);
      expect([401, 403]).toContain(res.status);
    });
  }

  it('管理员访问同样的路由不会被闸门拦掉（闸门没有误伤）', async () => {
    for (const [, path] of cases) {
      const res = await request(app).get(path).set(admin.auth);
      expect(res.status, `${path} 对 admin 不应 401/403`).not.toBe(403);
      expect(res.status, `${path} 对 admin 不应 401/403`).not.toBe(401);
    }
  });

  it('写操作也被闸门覆盖（不只是 GET）', async () => {
    const post = await request(app).post('/api/ui-review/admin/rules')
      .set(userA.auth).send({ name: 'x', dimension: 'color' });
    expect(post.status).toBe(403);

    const del = await request(app).delete('/api/ui-review/admin/rules/whatever').set(userA.auth);
    expect(del.status).toBe(403);
  });
});

describe('scope 受限的 SDK token 不能提权', () => {
  it('即使 payload 里写 role=admin，也不得访问 admin 路由', async () => {
    const token = signScopedToken(admin.id, 'tender:read');
    const res = await request(app).get('/api/tender/admin/sdk-keys')
      .set({ Authorization: `Bearer ${token}` });
    expect(res.status).toBe(403);
  });
});

describe('跨用户越权读（IDOR）', () => {
  it('用户 B 读不到用户 A 的评测记录', async () => {
    const reviewId = seedReview(userA.id, 'https://a-private-site.example/');
    const own = await request(app).get(`/api/ui-review/${reviewId}`).set(userA.auth);
    expect(own.status).toBe(200);

    const other = await request(app).get(`/api/ui-review/${reviewId}`).set(userB.auth);
    expect(other.status).toBe(404);
    expect(JSON.stringify(other.body)).not.toContain('a-private-site');
  });

  it('匿名访客读不到另一个匿名访客的记录（旧实现里所有匿名共用 admin id，这里必挂）', async () => {
    // 造一条属于「IP=1.1.1.1 + UA=anon-A」这个匿名主体的记录
    const anonA = anonymousId({ ip: '1.1.1.1', headers: { 'user-agent': 'anon-A' }, socket: {} } as any);
    const reviewId = seedReview(anonA, 'https://anon-a-secret.example/');

    // 另一个匿名主体（不同 IP + 不同 UA）来读
    const res = await request(app).get(`/api/ui-review/${reviewId}`)
      .set('X-Forwarded-For', '2.2.2.2')
      .set('User-Agent', 'anon-B');
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain('anon-a-secret');
  });

  it('同一匿名访客能读回自己的记录（隔离不能过头到自己都读不到）', async () => {
    const anonA = anonymousId({ ip: '3.3.3.3', headers: { 'user-agent': 'anon-self' }, socket: {} } as any);
    const reviewId = seedReview(anonA);

    const res = await request(app).get(`/api/ui-review/${reviewId}`)
      .set('X-Forwarded-For', '3.3.3.3')
      .set('User-Agent', 'anon-self');
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(reviewId);
  });

  it('匿名访客读不到登录用户的记录', async () => {
    const reviewId = seedReview(userA.id);
    const res = await request(app).get(`/api/ui-review/${reviewId}`)
      .set('X-Forwarded-For', '4.4.4.4')
      .set('User-Agent', 'anon-C');
    expect(res.status).toBe(404);
  });
});

describe('SSRF：POST /api/ui-review/start 必须在落库前拒绝内网地址', () => {
  const evil = [
    'http://169.254.169.254/latest/meta-data/iam/security-credentials/',
    'http://127.0.0.1:3001/api/admin/users',
    'http://localhost/',
    'http://10.0.0.1/',
    'http://192.168.1.1/',
    'file:///etc/passwd',
    'http://example.com:22/',
    'http://user:pass@example.com/',
  ];

  for (const url of evil) {
    it(`拒绝 ${url}`, async () => {
      const before = (getDatabase().prepare('SELECT COUNT(*) c FROM ui_reviews').get() as any).c;
      const res = await request(app).post('/api/ui-review/start').send({ url });

      expect(res.status).toBe(400);
      // 关键：不能变成一条 failed 记录后再拒绝 —— 那样等于给了攻击者重试面
      const after = (getDatabase().prepare('SELECT COUNT(*) c FROM ui_reviews').get() as any).c;
      expect(after).toBe(before);
    });
  }

  it('缺 url 返回 400', async () => {
    const res = await request(app).post('/api/ui-review/start').send({});
    expect(res.status).toBe(400);
  });

  it('pro 模式仍要求登录', async () => {
    const res = await request(app).post('/api/ui-review/start')
      .send({ url: 'https://example.com/', mode: 'pro' });
    expect(res.status).toBe(401);
  });
});

describe('匿名配额隔离', () => {
  it('不同匿名访客各自一行、互不共享；且额度低于登录用户', async () => {
    const db = getDatabase();
    const a = anonymousId({ ip: '7.7.7.1', headers: { 'user-agent': 'q-A' }, socket: {} } as any);
    const b = anonymousId({ ip: '7.7.7.2', headers: { 'user-agent': 'q-B' }, socket: {} } as any);
    expect(a).not.toBe(b);

    // 走真实端点触发 ensureAnonymousQuota（URL 合法但不会真去爬，因为我们只看配额行）
    await request(app).post('/api/ui-review/start')
      .set('X-Forwarded-For', '7.7.7.1').set('User-Agent', 'q-A')
      .send({ url: 'https://example.com/' });

    const rowA = db.prepare('SELECT * FROM ai_quota WHERE user_id = ?').get(a) as any;
    expect(rowA).toBeTruthy();
    expect(rowA.daily_limit).toBeLessThan(10);
    // B 没调用过，不应因为 A 的调用而存在或被扣额
    expect(db.prepare('SELECT * FROM ai_quota WHERE user_id = ?').get(b)).toBeUndefined();
  });

  it('匿名调用不再扣管理员的额度（旧实现的免费 DoS）', async () => {
    const db = getDatabase();
    const before = db.prepare('SELECT used_today FROM ai_quota WHERE user_id = ?').get(admin.id) as any;

    await request(app).post('/api/ui-review/start')
      .set('X-Forwarded-For', '7.7.7.9').set('User-Agent', 'q-dos')
      .send({ url: 'https://example.com/' });

    const after = db.prepare('SELECT used_today FROM ai_quota WHERE user_id = ?').get(admin.id) as any;
    expect(after?.used_today ?? 0).toBe(before?.used_today ?? 0);
  });
});

describe('公开路由仍然可匿名访问（鉴权收口没有把公开面关掉）', () => {
  const publicPaths = [
    '/api/health',
    '/api/home/modules',
    '/api/discover/articles',
    '/api/ad-slots?page=/',
  ];

  for (const p of publicPaths) {
    it(`GET ${p} 匿名可访问`, async () => {
      const res = await request(app).get(p);
      expect(res.status).toBe(200);
    });
  }

  it('POST /api/analytics/pageview 匿名可访问，但 /api/analytics/stats/* 不行', async () => {
    const pv = await request(app).post('/api/analytics/pageview').send({ path: '/test' });
    expect(pv.status).toBe(200);

    const stats = await request(app).get('/api/analytics/stats/overview');
    expect([401, 403]).toContain(stats.status);
  });
});
