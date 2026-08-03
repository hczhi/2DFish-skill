import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { initDatabase, getDatabase } from '../../db/index.js';
import { startJob } from '../../core/jobs.js';
import { getLatestProgress, failInterruptedReviews } from './orchestrator.js';

// 只测状态/进度这两个纯读写函数，executeReview 本身要开浏览器+调 LLM，不在单测范围。

beforeAll(() => { initDatabase(); });

beforeEach(() => {
  const db = getDatabase();
  db.prepare('DELETE FROM job_logs').run();
  db.prepare('DELETE FROM jobs').run();
  db.prepare('DELETE FROM ui_reviews').run();
});

function insertReview(status: string): string {
  const id = uuidv4();
  getDatabase().prepare(
    `INSERT INTO ui_reviews (id, user_id, url, status, created_at) VALUES (?, ?, ?, ?, ?)`
  ).run(id, 'u1', 'https://example.com/', status, new Date().toISOString());
  return id;
}

describe('getLatestProgress', () => {
  it('没有 job 时返回 null', () => {
    expect(getLatestProgress('no-such-review')).toBeNull();
  });

  it('返回该 review 对应 job 上的最新 step/message', () => {
    const reviewId = uuidv4();
    const job = startJob('ui-review', { refId: reviewId });
    job.progress({ step: 'crawling', message: 'Crawling page...' });
    job.progress({ step: 'analyzing', message: 'AI scoring page design...' });

    expect(getLatestProgress(reviewId)).toEqual({ step: 'analyzing', message: 'AI scoring page design...' });
  });

  it('按 ref_id 隔离，不会串到别的 review', () => {
    const a = uuidv4(), b = uuidv4();
    startJob('ui-review', { refId: a }).progress({ step: 'crawling', message: 'A 在爬' });
    startJob('ui-review', { refId: b }).progress({ step: 'generating', message: 'B 在生成' });

    expect(getLatestProgress(a)?.message).toBe('A 在爬');
    expect(getLatestProgress(b)?.message).toBe('B 在生成');
  });

  it('step 还没写过（刚入队）时视为无进度', () => {
    const reviewId = uuidv4();
    startJob('ui-review', { refId: reviewId, message: 'Queued...' });
    expect(getLatestProgress(reviewId)).toBeNull();
  });
});

describe('failInterruptedReviews（重启收尸）', () => {
  it('中途状态的 review 全部标 failed', () => {
    const ids = ['pending', 'crawling', 'analyzing', 'generating'].map(insertReview);

    expect(failInterruptedReviews()).toBe(4);

    const db = getDatabase();
    for (const id of ids) {
      const row = db.prepare('SELECT status, error_message FROM ui_reviews WHERE id = ?').get(id) as any;
      expect(row.status).toBe('failed');
      expect(row.error_message).toBe('服务重启，任务中断');
    }
  });

  // 不清的话前端 SSE 会一直轮询一个永远不推进的状态：既不 completed 也不 failed，
  // 那个 done 事件永远不会来，页面就卡在"正在分析"上。
  it('不动已经结束的 review', () => {
    const done = insertReview('completed');
    const failed = insertReview('failed');
    getDatabase().prepare('UPDATE ui_reviews SET error_message = ? WHERE id = ?').run('原本的原因', failed);

    expect(failInterruptedReviews()).toBe(0);

    const db = getDatabase();
    expect((db.prepare('SELECT status FROM ui_reviews WHERE id = ?').get(done) as any).status).toBe('completed');
    expect((db.prepare('SELECT error_message FROM ui_reviews WHERE id = ?').get(failed) as any).error_message).toBe('原本的原因');
  });
});
