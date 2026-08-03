import { describe, it, expect, beforeAll } from 'vitest';
import type { Request } from 'express';
import { initDatabase, getDatabase } from '../db/index.js';
import {
  anonymousId, resolveRequesterId, isAnonymousId,
  ensureAnonymousQuota, cleanupAnonymousQuota, ANON_DAILY_LIMIT, ANON_PREFIX,
} from './requester.js';

function fakeReq(ip: string, ua = 'Mozilla/5.0', user?: { id: string }): Request {
  return { ip, headers: { 'user-agent': ua }, socket: {}, user } as unknown as Request;
}

beforeAll(() => {
  initDatabase();
});

describe('anonymousId', () => {
  it('同 IP + 同 UA 稳定派生同一个 id（否则访客读不回自己的记录）', () => {
    expect(anonymousId(fakeReq('1.2.3.4'))).toBe(anonymousId(fakeReq('1.2.3.4')));
  });

  it('不同 IP 或不同 UA 得到不同 id（这是跨匿名越权的修复点）', () => {
    const a = anonymousId(fakeReq('1.2.3.4', 'UA-A'));
    const b = anonymousId(fakeReq('5.6.7.8', 'UA-A'));
    const c = anonymousId(fakeReq('1.2.3.4', 'UA-B'));
    expect(new Set([a, b, c]).size).toBe(3);
  });

  it('id 带 anon: 前缀且不含明文 IP', () => {
    const id = anonymousId(fakeReq('203.0.113.9'));
    expect(id.startsWith(ANON_PREFIX)).toBe(true);
    expect(isAnonymousId(id)).toBe(true);
    expect(id).not.toContain('203.0.113.9');
  });
});

describe('resolveRequesterId', () => {
  it('已登录时用真实 user id，不再回落到 admin', () => {
    expect(resolveRequesterId(fakeReq('1.2.3.4', 'UA', { id: 'user-123' }))).toBe('user-123');
  });

  it('未登录时用匿名派生 id', () => {
    const req = fakeReq('1.2.3.4');
    expect(resolveRequesterId(req)).toBe(anonymousId(req));
  });
});

describe('ensureAnonymousQuota', () => {
  it('给匿名主体建一行低额度记录', () => {
    const id = anonymousId(fakeReq('9.9.9.9', 'quota-test'));
    ensureAnonymousQuota(id);
    const row = getDatabase().prepare('SELECT * FROM ai_quota WHERE user_id = ?').get(id) as any;
    expect(row).toBeTruthy();
    expect(row.daily_limit).toBe(ANON_DAILY_LIMIT);
    expect(ANON_DAILY_LIMIT).toBeLessThan(10); // 必须低于登录用户额度
  });

  it('不覆盖已有用量（重复调用不能变成重置配额的后门）', () => {
    const id = anonymousId(fakeReq('9.9.9.10', 'quota-test'));
    ensureAnonymousQuota(id);
    const db = getDatabase();
    db.prepare('UPDATE ai_quota SET used_today = 3 WHERE user_id = ?').run(id);
    ensureAnonymousQuota(id);
    const row = db.prepare('SELECT used_today FROM ai_quota WHERE user_id = ?').get(id) as any;
    expect(row.used_today).toBe(3);
  });

  it('对登录用户是 no-op（不能把登录用户降到匿名额度）', () => {
    ensureAnonymousQuota('real-user-id');
    const row = getDatabase().prepare('SELECT * FROM ai_quota WHERE user_id = ?').get('real-user-id');
    expect(row).toBeUndefined();
  });
});

describe('cleanupAnonymousQuota', () => {
  it('只删过期的匿名行，保留今天的行和所有登录用户行', () => {
    const db = getDatabase();
    const today = new Date().toISOString().split('T')[0];

    db.prepare('INSERT OR REPLACE INTO ai_quota (user_id, daily_limit, used_today, last_reset_date) VALUES (?,?,?,?)')
      .run(`${ANON_PREFIX}stale`, ANON_DAILY_LIMIT, 3, '2020-01-01');
    db.prepare('INSERT OR REPLACE INTO ai_quota (user_id, daily_limit, used_today, last_reset_date) VALUES (?,?,?,?)')
      .run(`${ANON_PREFIX}fresh`, ANON_DAILY_LIMIT, 3, today);
    db.prepare('INSERT OR REPLACE INTO ai_quota (user_id, daily_limit, used_today, last_reset_date) VALUES (?,?,?,?)')
      .run('login-stale', 10, 5, '2020-01-01');

    cleanupAnonymousQuota();

    expect(db.prepare('SELECT 1 FROM ai_quota WHERE user_id = ?').get(`${ANON_PREFIX}stale`)).toBeUndefined();
    // 今天的匿名行必须留着：删了等于用完额度后刷新一下就能重置
    expect(db.prepare('SELECT 1 FROM ai_quota WHERE user_id = ?').get(`${ANON_PREFIX}fresh`)).toBeTruthy();
    expect(db.prepare('SELECT 1 FROM ai_quota WHERE user_id = ?').get('login-stale')).toBeTruthy();
  });
});
