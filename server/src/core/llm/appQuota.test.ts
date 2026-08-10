import { describe, it, expect, beforeEach } from 'vitest';
import { initDatabase, getDatabase } from '../../db/index.js';
import { checkAndDeductAppQuota, getAppQuotaStatus, getQuotaStatus, aiGateway, QuotaExceededError } from './gateway.js';
import { upsertProvider } from '../../services/aiProviderService.js';

initDatabase();

const USER = '33333333-3333-3333-3333-333333333333';
const today = () => new Date().toISOString().split('T')[0];

function setLimit(app: string, limit: number, used = 0, date = today()) {
  getDatabase()
    .prepare(
      `INSERT OR REPLACE INTO ai_app_quota (user_id, app, daily_limit, used_today, last_reset_date)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(USER, app, limit, used, date);
}

const readRow = (app: string) =>
  getDatabase().prepare('SELECT * FROM ai_app_quota WHERE user_id = ? AND app = ?').get(USER, app) as any;

beforeEach(() => {
  getDatabase().prepare('DELETE FROM ai_app_quota').run();
});

describe('应用级额度：没配就不限', () => {
  it('没有配置行时直接放过，也不会建行', () => {
    // 纯 opt-in 是这个功能能安全上线的前提：老用户一行都没有，行为必须完全不变。
    expect(() => checkAndDeductAppQuota(USER, 'xhs')).not.toThrow();
    expect(readRow('xhs')).toBeUndefined();
  });

  it('app 为空串时什么都不做', () => {
    // 兜住万一有调用点没给 source 的情况：不该凭空建一行 app='' 的限额。
    setLimit('', 0);
    expect(() => checkAndDeductAppQuota(USER, '')).not.toThrow();
  });

  it('只限制配了的那个应用，其他应用不受影响', () => {
    setLimit('xhs', 1);
    checkAndDeductAppQuota(USER, 'xhs');
    expect(() => checkAndDeductAppQuota(USER, 'xhs')).toThrow(QuotaExceededError);
    // tender 没配 → 不限
    expect(() => checkAndDeductAppQuota(USER, 'tender')).not.toThrow();
  });
});

describe('应用级额度：计数与拦截', () => {
  it('每次调用 +1，到上限抛 QuotaExceededError', () => {
    setLimit('xhs', 3);
    checkAndDeductAppQuota(USER, 'xhs');
    checkAndDeductAppQuota(USER, 'xhs');
    checkAndDeductAppQuota(USER, 'xhs');
    expect(readRow('xhs').used_today).toBe(3);
    expect(() => checkAndDeductAppQuota(USER, 'xhs')).toThrow(QuotaExceededError);
  });

  it('撞墙时不再加计数', () => {
    // 否则 used_today 会一路涨到天上，后台看到「20/5」这种数，也没法判断真实用量。
    setLimit('xhs', 1, 1);
    expect(() => checkAndDeductAppQuota(USER, 'xhs')).toThrow();
    expect(readRow('xhs').used_today).toBe(1);
  });

  it('limit=0 意味着一次都不许调，而不是「不限」', () => {
    // 0 是管理员临时掐停某个应用的手段。和「没配置」必须是两种不同的语义。
    setLimit('xhs', 0);
    expect(() => checkAndDeductAppQuota(USER, 'xhs')).toThrow(QuotaExceededError);
    expect(readRow('xhs').used_today).toBe(0);
  });

  it('报错文案说清撞的是应用额度而不是账号总额', () => {
    // 两条限制的解法不同（提总额 vs 提应用额度）。只说「额度用完」，
    // 用户会去改错的那个数，改完发现还是不行。
    setLimit('xhs', 1, 1);
    try {
      checkAndDeductAppQuota(USER, 'xhs');
      expect.unreachable();
    } catch (e: any) {
      expect(e).toBeInstanceOf(QuotaExceededError);
      expect(e.app).toBe('xhs');
      expect(e.dailyLimit).toBe(1);
      expect(e.message).toContain('小红书写作台');   // 用中文名，不是裸 id
      expect(e.message).toContain('单独额度');
    }
  });

  it('账号总额的报错里不带 app，文案也不同', () => {
    const e = new QuotaExceededError(10);
    expect(e.app).toBeUndefined();
    expect(e.message).not.toContain('单独额度');
  });
});

describe('应用级额度：跨天重置', () => {
  it('日期变了就归零后重新计数', () => {
    setLimit('xhs', 2, 2, '2020-01-01');
    // 昨天已用满，今天必须能用
    expect(() => checkAndDeductAppQuota(USER, 'xhs')).not.toThrow();
    const row = readRow('xhs');
    expect(row.used_today).toBe(1);
    expect(row.last_reset_date).toBe(today());
  });

  it('重置只在读到时发生，服务器半夜没跑也不会漏', () => {
    setLimit('xhs', 1, 1, '2020-01-01');
    checkAndDeductAppQuota(USER, 'xhs');
    // 同一天内第二次就该被拦
    expect(() => checkAndDeductAppQuota(USER, 'xhs')).toThrow(QuotaExceededError);
  });
});

describe('getAppQuotaStatus', () => {
  it('列出各应用的用量，跨天的按 0 算', () => {
    setLimit('xhs', 20, 5);
    setLimit('tender', 10, 9, '2020-01-01');
    const st = getAppQuotaStatus(USER);
    const byApp = Object.fromEntries(st.map((s) => [s.app, s]));
    expect(byApp.xhs).toMatchObject({ used: 5, limit: 20, remaining: 15 });
    // 昨天的 9 次不该显示成今天的用量
    expect(byApp.tender).toMatchObject({ used: 0, limit: 10, remaining: 10 });
  });

  it('remaining 不会是负数', () => {
    // 管理员把上限从 20 调到 3 时，used 可能已经超过上限。
    setLimit('xhs', 3, 8);
    expect(getAppQuotaStatus(USER)[0].remaining).toBe(0);
  });

  it('没配任何应用时返回空数组', () => {
    expect(getAppQuotaStatus(USER)).toEqual([]);
  });
});

/** 造一个开了专属渠道的用户 + 他自己的一条 provider。 */
function mkDedicatedUser(id: string) {
  const db = getDatabase();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT OR REPLACE INTO user (id, username, password_hash, role, use_dedicated_ai, created_at, updated_at)
     VALUES (?, ?, 'x', 'user', 1, ?, ?)`
  ).run(id, `ded-${id.slice(0, 6)}`, now, now);
  upsertProvider({
    kind: 'llm', tier: 'default', label: '专属', model: 'm',
    base_url: 'https://example.invalid/v1', api_key: 'sk-own', enabled: 1, owner_user_id: id,
  });
}

describe('专属渠道用户同样受应用额度限制', () => {
  it('专属渠道绕过账号总额，但绕不过应用额度', async () => {
    // 这是整个功能的存在理由：需求原话是「为不同用户的不同应用指定额度」，
    // 而会去配专属 token 的正是这批用户。放他们过去 = 功能对目标场景完全失效。
    const DED = '44444444-4444-4444-4444-444444444444';
    const db = getDatabase();
    db.prepare('DELETE FROM ai_providers').run();
    mkDedicatedUser(DED);
    db.prepare(
      `INSERT OR REPLACE INTO ai_app_quota (user_id, app, daily_limit, used_today, last_reset_date)
       VALUES (?, 'xhs', 0, 0, ?)`
    ).run(DED, today());

    await expect(
      aiGateway({ messages: [{ role: 'user', content: 'hi' }] }, { userId: DED, source: 'xhs', operation: 'test', timeoutMs: 200 })
    ).rejects.toThrow(QuotaExceededError);

    // 账号总额那一层确实没碰他（专属渠道的原有语义没被这个功能改坏）
    expect(db.prepare('SELECT * FROM ai_quota WHERE user_id = ?').get(DED)).toBeUndefined();
  });
});

describe('两层额度的先后顺序', () => {
  it('应用额度撞墙时不扣账号总额', async () => {
    // 顺序反了的话：用户点一个已经掐停的功能，功能没用上，
    // 账号总额却被扣掉一次 —— 反复点几下总额就白没了。
    const db = getDatabase();
    db.prepare('DELETE FROM ai_providers').run();
    db.prepare('DELETE FROM ai_quota').run();
    // 得有一条可用 provider，否则 resolveLLMConfig 先抛「AI 未配置」，测不到额度顺序
    upsertProvider({
      kind: 'llm', tier: 'default', label: 'p', model: 'm',
      base_url: 'https://example.invalid/v1', api_key: 'sk-x', enabled: 1,
    });
    db.prepare(
      `INSERT INTO ai_quota (user_id, daily_limit, used_today, last_reset_date) VALUES (?, 10, 0, ?)`
    ).run(USER, today());
    setLimit('xhs', 0);   // 该应用已掐停

    await expect(
      aiGateway({ messages: [{ role: 'user', content: 'hi' }] }, { userId: USER, source: 'xhs', operation: 'test', timeoutMs: 200 })
    ).rejects.toThrow(QuotaExceededError);

    expect(getQuotaStatus(USER).used).toBe(0);
  });
});

describe('匿名主体', () => {
  it('anon: 主体同样按 user_id 记，不需要特殊分支', () => {
    const anon = 'anon:deadbeefdeadbeefdeadbeef';
    getDatabase()
      .prepare(
        `INSERT INTO ai_app_quota (user_id, app, daily_limit, used_today, last_reset_date)
         VALUES (?, 'xhs', 1, 0, ?)`
      )
      .run(anon, today());
    expect(() => checkAndDeductAppQuota(anon, 'xhs')).not.toThrow();
    expect(() => checkAndDeductAppQuota(anon, 'xhs')).toThrow(QuotaExceededError);
  });
});
