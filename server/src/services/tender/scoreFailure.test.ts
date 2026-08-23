import { describe, it, expect, beforeEach, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';

// 评分失败必须**不落行**。原来拿不到 JSON 时会 return 一份 50 分的假结果并写进
// tender_recommendations，而 loadUnscoredForUser 用 `NOT EXISTS(推荐行)` 判「评过了」
// —— 于是那条标讯永远不会再被评，卡片上却是个正常的「68 分 · 可考虑」（业务分 =
// 关键词分×0.4 + 50×0.6），只有推荐理由那栏写着「解析失败」，还会跟着增量同步进
// 多维表格和飞书卡片。手测测不出来：屏幕上那张卡片和真评出来的长得一样。
const gateway = vi.hoisted(() => ({ reply: '' as string | Error, finish: 'stop' as string }));

vi.mock('../../core/llm/gateway.js', async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    aiGateway: vi.fn(async () => {
      if (gateway.reply instanceof Error) throw gateway.reply;
      return {
        response: {
          choices: [{ message: { content: gateway.reply }, finish_reason: gateway.finish }],
          usage: {
            prompt_tokens: 100,
            completion_tokens: 4000,
            total_tokens: 4100,
            completion_tokens_details: { reasoning_tokens: 3900 },
          },
        },
      };
    }),
  };
});

const { initDatabase, getDatabase } = await import('../../db/index.js');
const { QuotaExceededError } = await import('../../core/llm/gateway.js');
const { runRecommendationsForAllUsers } = await import('./recommendService.js');

initDatabase();

const USER = 'user-score-fail';
{
  const now = new Date().toISOString();
  getDatabase()
    .prepare(
      `INSERT INTO user (id, username, password_hash, role, created_at, updated_at)
       VALUES (?, 'scorer', 'x', 'admin', ?, ?)`
    )
    .run(USER, now, now);
  getDatabase()
    .prepare(
      `INSERT INTO tender_user_preferences (user_id, case_tags, platforms, created_at, updated_at)
       VALUES (?, '["整合营销"]', '[]', ?, ?)`
    )
    .run(USER, now, now);
}

function seedTender(): string {
  const db = getDatabase();
  const id = uuidv4();
  db.prepare(
    `INSERT INTO tenders (id, platform, notice_id, content_hash, title, publish_date, deadline,
                          budget, budget_amount, purchaser_name, content_text, url, keyword, status, created_at)
     VALUES (?, 'gdgpo', ?, ?, '某公司整合营销活动公告', ?, '', '', 500000, '某公司',
             '整合营销活动执行', '', '整合营销', 'extracted', ?)`
  ).run(id, id, `hash-${id}`, new Date().toISOString().slice(0, 10), new Date().toISOString());
  return id;
}

const recCount = () =>
  (getDatabase().prepare('SELECT COUNT(*) c FROM tender_recommendations').get() as any).c as number;

beforeEach(() => {
  const db = getDatabase();
  db.exec('DELETE FROM tender_recommendations');
  db.exec('DELETE FROM tenders');
  gateway.reply = '';
  gateway.finish = 'stop';
});

describe('评分拿不到 JSON', () => {
  it('不写推荐行（写了就永远不会再评，而卡片看着完全正常）', async () => {
    gateway.reply = '';
    gateway.finish = 'length';
    const id = seedTender();
    const logs: string[] = [];

    await runRecommendationsForAllUsers([id], (m) => logs.push(m), USER);

    expect(recCount()).toBe(0);
    // 三种成因要分开说，且必须带上思维链 token 数 —— 合成一句「解析失败」的话，
    // 看到的人只会去改评分 prompt 或反复重评，而真凶是额度花在了看不见的地方。
    const fail = logs.find((l) => l.includes('[失败]'));
    expect(fail).toContain('思维链');
    expect(logs.join('\n')).toContain('仍算未评分');
  });
});

describe('额度打满', () => {
  it('中止并说出来，不给剩下的标讯逐条写 50 分', async () => {
    // 原来 scoreBusinessWithLLM 自己 catch 了 QuotaExceededError 并 return
    // reason='每日AI额度已用完' 的 50 分行，于是外层那句「评分中止」是死代码，
    // 额度打满的那一刻起，剩下几百条会被逐条写成编出来的分数且永不重评。
    gateway.reply = new QuotaExceededError(10); // 参数是每日上限，文案由它自己拼
    const id = seedTender();
    const logs: string[] = [];

    await runRecommendationsForAllUsers([id], (m) => logs.push(m), USER);

    expect(recCount()).toBe(0);
    expect(logs.join('\n')).toContain('额度已用完');
  });
});
