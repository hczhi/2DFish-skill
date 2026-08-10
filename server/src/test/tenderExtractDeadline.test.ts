import { describe, it, expect, vi, beforeEach } from 'vitest';
import { v4 as uuidv4 } from 'uuid';

// aiGateway 必须在 import aiExtractService 之前 mock 掉（ESM 提升规则）。
// 这里只替换 LLM 那一次调用，UPDATE 语句走真实 sqlite —— 这个测试要验的
// 恰好就是那条 SQL 的 CASE WHEN，用假 db 测等于什么都没测。
const llmReply = { text: '' };
vi.mock('../core/llm/gateway.js', () => ({
  aiGateway: vi.fn(async () => ({
    response: { choices: [{ message: { content: llmReply.text } }] },
  })),
  QuotaExceededError: class extends Error {},
}));

const { getDatabase } = await import('../db/index.js');
const { initDatabase } = await import('../db/index.js');
const { runAIExtractForTenders } = await import('../services/tender/aiExtractService.js');

initDatabase();

/** 插一条待提取的标讯，返回 id。deadline 由调用方指定，模拟爬虫已解析/未解析两种情况。 */
function seedTender(deadline: string, opts: { budget?: number; purchaser?: string } = {}): string {
  const db = getDatabase();
  const id = uuidv4();
  db.prepare(
    `INSERT INTO tenders (id, platform, notice_id, content_hash, title, publish_date, deadline,
                          budget, budget_amount, purchaser_name, content_text, url, keyword, created_at)
     VALUES (?, 'ygcg', ?, ?, ?, ?, ?, '', ?, ?, ?, '', '', ?)`
  ).run(
    id, id, `hash-${id}`, '某项目采购公告',
    new Date().toISOString().slice(0, 10),
    deadline,
    opts.budget ?? 0,
    opts.purchaser ?? '',
    '正文：响应文件递交截止时间 2026 年 8 月 11 日 17:00',
    new Date().toISOString(),
  );
  return id;
}

const readBack = (id: string) =>
  getDatabase().prepare('SELECT deadline, budget_amount, purchaser_name, project_type FROM tenders WHERE id = ?').get(id) as any;

/** 让 mock 的 LLM 返回指定 deadline（其余字段给合法默认值）。 */
function replyWith(id: string, fields: Record<string, unknown>) {
  llmReply.text = JSON.stringify([{
    id,
    projectName: '某项目',
    purchaserName: '某采购人',
    budgetAmount: 123456,
    budgetText: '¥123,456元',
    projectLocation: '广州',
    projectType: '整合营销',
    procurementMethod: '公开招标',
    qualificationRequirements: ['资质A'],
    projectSummary: '概要',
    keyDeliverables: ['交付物'],
    ...fields,
  }]);
}

describe('AI 提取不覆盖爬虫已解析的 deadline', () => {
  beforeEach(() => { llmReply.text = ''; });

  it('LLM 返回空 deadline 时，不擦掉爬虫解析出的精确值', async () => {
    const id = seedTender('2026-08-11 17:00:00');
    replyWith(id, { deadline: '' });

    await runAIExtractForTenders([id], 'test-user');

    // 这是修复前的真实故障：正文写「公告发布之日起5个工作日」这类，LLM 给空串，
    // 于是爬虫解析好的截止时间被无条件覆盖成空。
    expect(readBack(id).deadline).toBe('2026-08-11 17:00:00');
  });

  it('LLM 返回只有日期的值时，不把「17:00」降级成整天', async () => {
    const id = seedTender('2026-08-11 17:00:00');
    replyWith(id, { deadline: '2026-08-11' });

    await runAIExtractForTenders([id], 'test-user');

    // prompt 只要 YYYY-MM-DD,但爬虫拿到的是精确到分钟的。丢掉时分意味着
    // 「今天 17:00 截止（还能报）」和「今天已过」看起来一样。
    expect(readBack(id).deadline).toBe('2026-08-11 17:00:00');
  });

  it('原本为空时照旧由 AI 补上（gdgpo 不解析 deadline，靠的就是这条）', async () => {
    const id = seedTender('');
    replyWith(id, { deadline: '2026-09-01' });

    await runAIExtractForTenders([id], 'test-user');

    expect(readBack(id).deadline).toBe('2026-09-01');
  });

  it('其余字段照常写入（保护 deadline 没有顺手关掉别的提取）', async () => {
    const id = seedTender('2026-08-11 17:00:00');
    replyWith(id, { deadline: '' });

    await runAIExtractForTenders([id], 'test-user');

    const row = readBack(id);
    expect(row.project_type).toBe('整合营销');
    expect(row.budget_amount).toBe(123456);   // 原本 0 → 补上
    expect(row.purchaser_name).toBe('某采购人'); // 原本 '' → 补上
  });

  it('已有的 budget / purchaser 同样不被覆盖（原有保护仍然生效）', async () => {
    const id = seedTender('', { budget: 999, purchaser: '爬虫拿到的采购人' });
    replyWith(id, { deadline: '2026-09-01' });

    await runAIExtractForTenders([id], 'test-user');

    const row = readBack(id);
    expect(row.budget_amount).toBe(999);
    expect(row.purchaser_name).toBe('爬虫拿到的采购人');
  });
});
