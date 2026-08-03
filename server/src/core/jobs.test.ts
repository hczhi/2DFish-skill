import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { initDatabase, getDatabase } from '../db/index.js';
import {
  startJob, getJob, getJobLogs, getLatestJob, findRunningJob, reapZombieJobs, JobHandle,
} from './jobs.js';

// jobs 表的存在理由就是「进程重启后状态还在」，所以重点测两件原来会出错的事：
//   1. 遗留的 running 行必须被收尸，否则互斥判断被永久锁死；
//   2. 终态先到先得，手动终止的原因不能被随后的内部异常覆盖。

// 建表走真实迁移链（DB_PATH 已由 test/setup.ts 指到临时目录），
// 手写一份 CREATE TABLE 的话迁移改了这里不会跟着改，测试就测的不是生产的表。
beforeAll(() => { initDatabase(); });

beforeEach(() => {
  const db = getDatabase();
  db.prepare('DELETE FROM job_logs').run();
  db.prepare('DELETE FROM jobs').run();
});

describe('startJob / 进度写库', () => {
  it('新任务是 running，字段落到库里', () => {
    const job = startJob('tender-crawl', { total: 3, step: 'starting', message: '启动中', createdBy: 'u1' });
    const row = getJob(job.id)!;
    expect(row.status).toBe('running');
    expect(row.kind).toBe('tender-crawl');
    expect(row.total).toBe(3);
    expect(row.step).toBe('starting');
    expect(row.created_by).toBe('u1');
  });

  it('progress 只更新传入的字段，未传的保持原值', () => {
    const job = startJob('tender-crawl', { total: 5, step: 'starting', message: '启动中' });
    job.progress({ current: 2 });
    const row = getJob(job.id)!;
    expect(row.current).toBe(2);
    expect(row.total).toBe(5);       // 没传 → 不动
    expect(row.step).toBe('starting');
  });

  it('done 写入 result JSON 并置 completed_at', () => {
    const job = startJob('tender-crawl');
    job.done({ newAdded: 12 }, '完成：新增 12 条');
    const row = getJob(job.id)!;
    expect(row.status).toBe('completed');
    expect(JSON.parse(row.result!)).toEqual({ newAdded: 12 });
    expect(row.message).toBe('完成：新增 12 条');
    expect(row.completed_at).toBeTruthy();
  });

  it('fail 记录错误原因', () => {
    const job = startJob('tender-extract');
    job.fail(new Error('LLM 超时'));
    const row = getJob(job.id)!;
    expect(row.status).toBe('failed');
    expect(row.error).toBe('LLM 超时');
    expect(row.message).toContain('LLM 超时');
  });
});

describe('终态先到先得', () => {
  // 手动终止 → fail('手动终止')；被终止的任务体随后抛「任务已终止」再进 catch
  // 又调一次 fail()。没有 `AND status = 'running'` 守卫的话，管理员看到的原因
  // 会被覆盖成内部异常文本。
  it('已 failed 的任务不会被第二次 fail 覆盖原因', () => {
    const job = startJob('tender-crawl');
    job.fail('手动终止');
    job.fail(new Error('任务已终止'));
    expect(getJob(job.id)!.error).toBe('手动终止');
  });

  it('已 failed 的任务不会被 done 翻成 completed', () => {
    const job = startJob('tender-crawl');
    job.fail('手动终止');
    job.done({ newAdded: 3 });
    const row = getJob(job.id)!;
    expect(row.status).toBe('failed');
    expect(row.result).toBeNull();
  });
});

describe('日志', () => {
  it('按写入顺序返回，detail 可选', () => {
    const job = startJob('tender-recommend');
    job.log('第一条');
    job.log('第二条', 'prompt 内容');
    const logs = getJobLogs(job.id);
    expect(logs.map(l => l.message)).toEqual(['第一条', '第二条']);
    expect(logs[0].detail).toBeUndefined();
    expect(logs[1].detail).toBe('prompt 内容');
  });

  it('超过 300 条时丢最旧的，保留最新的', () => {
    const job = startJob('tender-recommend');
    for (let i = 1; i <= 305; i++) job.log(`msg-${i}`);
    const logs = getJobLogs(job.id);
    expect(logs).toHaveLength(300);
    expect(logs[0].message).toBe('msg-6');
    expect(logs[299].message).toBe('msg-305');
  });

  it('裁剪只影响本任务的日志', () => {
    const a = startJob('tender-crawl');
    const b = startJob('tender-extract');
    b.log('b 的日志');
    for (let i = 0; i < 305; i++) a.log(`a-${i}`);
    expect(getJobLogs(b.id)).toHaveLength(1);
  });
});

describe('查询', () => {
  it('findRunningJob 只认 running，且按 kind 过滤', () => {
    const done = startJob('tender-crawl');
    done.done();
    expect(findRunningJob(['tender-crawl'])).toBeUndefined();

    const running = startJob('tender-extract');
    expect(findRunningJob(['tender-crawl', 'tender-extract'])?.id).toBe(running.id);
    expect(findRunningJob(['ui-review'])).toBeUndefined();
  });

  it('getLatestJob 不论状态都返回最新一条', () => {
    const first = startJob('tender-crawl');
    first.done();
    const second = startJob('tender-extract');
    second.fail('炸了');
    // 同毫秒内 started_at 相同，靠 rowid 兜底定序
    expect(getLatestJob(['tender-crawl', 'tender-extract'])?.id).toBe(second.id);
  });

  it('kinds 为空时返回 undefined（而不是拼出非法 SQL）', () => {
    expect(getLatestJob([])).toBeUndefined();
    expect(findRunningJob([])).toBeUndefined();
  });
});

describe('reapZombieJobs（重启收尸）', () => {
  it('遗留的 running 行被标成 failed，互斥判断重新放行', () => {
    startJob('tender-crawl');   // 模拟上次进程崩在半路
    expect(findRunningJob(['tender-crawl'])).toBeDefined();

    expect(reapZombieJobs()).toBe(1);

    // 这一条就是原来的 bug：不收尸的话下面这个断言会是 defined，
    // /admin/crawl 从此永远返回 409「已有任务在运行中」。
    expect(findRunningJob(['tender-crawl'])).toBeUndefined();
    const row = getLatestJob(['tender-crawl'])!;
    expect(row.status).toBe('failed');
    expect(row.error).toBe('服务重启，任务中断');
    expect(row.completed_at).toBeTruthy();
  });

  it('不动已经是终态的任务', () => {
    const ok = startJob('tender-crawl');
    ok.done({ newAdded: 1 }, '完成');
    const bad = startJob('tender-extract');
    bad.fail('原本的失败原因');

    expect(reapZombieJobs()).toBe(0);
    expect(getJob(ok.id)!.status).toBe('completed');
    expect(getJob(bad.id)!.error).toBe('原本的失败原因');
  });
});

describe('JobHandle 可从已存在的行重建', () => {
  // crawl-abort 拿到的是一行 jobs 记录（可能是别的请求起的任务），
  // 要能直接构造出句柄去写终态。
  it('用 id 重建的句柄能写终态和日志', () => {
    const created = startJob('tender-crawl');
    const rebuilt = new JobHandle(created.id, 'tender-crawl');
    rebuilt.fail('手动终止');
    rebuilt.log('任务已被手动终止');

    expect(getJob(created.id)!.status).toBe('failed');
    expect(getJobLogs(created.id).map(l => l.message)).toContain('任务已被手动终止');
  });
});
