import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import request from 'supertest';

// 爬虫会真的开浏览器打外网；这里只测状态机和鉴权，把爬取实现打桩。
vi.mock('../services/tender/crawlerRegistry.js', () => ({
  getCrawler: vi.fn((id: string) =>
    id === 'gdgpo' ? { name: '广东政府采购网', crawl: vi.fn(async () => ({ logId: 'l1', items: [] })) } : null),
  getAllPlatforms: vi.fn(() => []),
}));

import { app } from '../app.js';
import { getDatabase } from '../db/index.js';
import { startJob } from '../core/jobs.js';
import { createUser, type TestUser } from './helpers.js';

// crawl-status 从内存变量换到 jobs 表之后的端到端行为。
// 重点是那条原来的 bug：进程崩在半路留下的 running 行会把入口永久锁在 409。

let admin: TestUser;
let user: TestUser;

beforeAll(() => {
  admin = createUser('admin');
  user = createUser('user');
});

beforeEach(() => {
  const db = getDatabase();
  db.prepare('DELETE FROM job_logs').run();
  db.prepare('DELETE FROM jobs').run();
});

describe('GET /api/tender/admin/crawl-status', () => {
  it('没有任何任务时返回 idle', async () => {
    const res = await request(app).get('/api/tender/admin/crawl-status').set(admin.auth);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('idle');
    expect(res.body.logs).toEqual([]);
  });

  it('running 任务按 kind 映射回前端认得的旧状态名', async () => {
    const job = startJob('tender-extract', { total: 4, message: 'AI 提取中' });
    job.log('第一条日志');

    const res = await request(app).get('/api/tender/admin/crawl-status').set(admin.auth);
    expect(res.body.status).toBe('extracting');   // 不是 'running'
    expect(res.body.total).toBe(4);
    expect(res.body.message).toBe('AI 提取中');
    expect(res.body.logs.map((l: any) => l.message)).toEqual(['第一条日志']);
  });

  it('result 里的字段被摊平到顶层（前端读的是 newAdded）', async () => {
    startJob('tender-crawl').done({ newAdded: 7 }, '完成：新增 7 条');
    const res = await request(app).get('/api/tender/admin/crawl-status').set(admin.auth);
    expect(res.body.status).toBe('completed');
    expect(res.body.newAdded).toBe(7);
  });

  it('终态任务超过保留窗口后退回 idle，不再顶在横幅上', async () => {
    const job = startJob('tender-crawl');
    job.done({ newAdded: 1 }, '完成');
    // 把结束时间改到两小时前（TTL 是 30 分钟）
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    getDatabase().prepare('UPDATE jobs SET completed_at = ?, updated_at = ? WHERE id = ?')
      .run(old, old, job.id);

    const res = await request(app).get('/api/tender/admin/crawl-status').set(admin.auth);
    expect(res.body.status).toBe('idle');
  });

  it('刚结束的终态任务仍然显示', async () => {
    startJob('tender-recommend').fail('LLM 超时');
    const res = await request(app).get('/api/tender/admin/crawl-status').set(admin.auth);
    expect(res.body.status).toBe('failed');
    expect(res.body.error).toBe('LLM 超时');
  });

  it('非管理员拿不到（/admin 闸门仍生效）', async () => {
    const res = await request(app).get('/api/tender/admin/crawl-status').set(user.auth);
    expect(res.status).toBe(403);
  });
});

describe('互斥：已有任务在运行中', () => {
  it('running 时 POST /admin/crawl 返回 409', async () => {
    startJob('tender-extract');
    const res = await request(app).post('/api/tender/admin/crawl')
      .set(admin.auth).send({ keywords: ['测试'], platform: 'gdgpo' });
    expect(res.status).toBe(409);
  });

  it('running 时 POST /admin/extract 也被拦（三个入口共用一把锁）', async () => {
    startJob('tender-crawl');
    const res = await request(app).post('/api/tender/admin/extract')
      .set(admin.auth).send({ tenderIds: ['t1'] });
    expect(res.status).toBe(409);
  });

  it('上一次任务已结束时不再拦', async () => {
    startJob('tender-crawl').done({ newAdded: 0 });
    const res = await request(app).post('/api/tender/admin/crawl')
      .set(admin.auth).send({ keywords: ['测试'], platform: 'gdgpo' });
    expect(res.status).toBe(200);
    expect(res.body.jobId).toBeTruthy();
  });

  it('重启遗留的 running 行被收尸后，入口重新放行（原来会永久 409）', async () => {
    startJob('tender-crawl');   // 模拟崩在半路的僵尸行
    let res = await request(app).post('/api/tender/admin/crawl')
      .set(admin.auth).send({ keywords: ['测试'], platform: 'gdgpo' });
    expect(res.status).toBe(409);

    // app.ts 在非测试模式下启动时会调这个
    const { reapZombieJobs } = await import('../core/jobs.js');
    reapZombieJobs();

    res = await request(app).post('/api/tender/admin/crawl')
      .set(admin.auth).send({ keywords: ['测试'], platform: 'gdgpo' });
    expect(res.status).toBe(200);
  });
});

describe('POST /api/tender/admin/crawl-abort', () => {
  it('没有运行中的任务时 400', async () => {
    startJob('tender-crawl').done();
    const res = await request(app).post('/api/tender/admin/crawl-abort').set(admin.auth).send({});
    expect(res.status).toBe(400);
  });

  it('终止运行中的任务：状态落 failed、原因是手动终止', async () => {
    const job = startJob('tender-crawl');
    const res = await request(app).post('/api/tender/admin/crawl-abort').set(admin.auth).send({});
    expect(res.status).toBe(200);

    const row = getDatabase().prepare('SELECT status, error FROM jobs WHERE id = ?').get(job.id) as any;
    expect(row.status).toBe('failed');
    expect(row.error).toBe('手动终止');
  });

  it('非管理员不能终止', async () => {
    const job = startJob('tender-crawl');
    const res = await request(app).post('/api/tender/admin/crawl-abort').set(user.auth).send({});
    expect(res.status).toBe(403);
    expect((getDatabase().prepare('SELECT status FROM jobs WHERE id = ?').get(job.id) as any).status).toBe('running');
  });
});
