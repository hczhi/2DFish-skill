import { describe, it, expect, beforeEach, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';

// 被 max_tokens 截断是这条链路唯一会「装成成功」的失败：整批解析不出来 → 提取到
// 0 条 → 页面顶上一句「✅ 已完成」，草稿一条不少地留在原地。所以这里断言的是
// **最终有几条进了库**，不是调了几次模型。
//
// mock 必须在 import aiExtractService 之前（ESM 提升）；UPDATE 走真 sqlite。
const replies: Array<{ text: string; finish: string }> = [];
vi.mock('../core/llm/gateway.js', () => ({
  aiGateway: vi.fn(async () => {
    const r = replies.shift();
    if (!r) throw new Error('测试没有为这次 LLM 调用准备返回值');
    return { response: { choices: [{ message: { content: r.text }, finish_reason: r.finish }] } };
  }),
  QuotaExceededError: class extends Error {},
}));

const { getDatabase, initDatabase } = await import('../db/index.js');
const { runAIExtractForTenders } = await import('../services/tender/aiExtractService.js');

initDatabase();

function seedTender(title: string): string {
  const db = getDatabase();
  const id = uuidv4();
  db.prepare(
    `INSERT INTO tenders (id, platform, notice_id, content_hash, title, publish_date, deadline,
                          budget, budget_amount, purchaser_name, content_text, url, keyword, created_at)
     VALUES (?, 'ygcg', ?, ?, ?, ?, '', '', 0, '', ?, '', '', ?)`
  ).run(id, id, `hash-${id}`, title, new Date().toISOString().slice(0, 10), '正文', new Date().toISOString());
  return id;
}

const item = (id: string) => ({
  id,
  projectName: '某项目',
  purchaserName: '某采购人',
  budgetAmount: 100,
  budgetText: '¥100',
  projectLocation: '广州',
  projectType: '整合营销',
  deadline: '',
  procurementMethod: '公开招标',
  qualificationRequirements: ['资质A'],
  projectSummary: '概要',
  keyDeliverables: ['交付物'],
  relevant: true,
});

const extractedCount = (ids: string[]) =>
  (getDatabase()
    .prepare(`SELECT COUNT(*) AS n FROM tenders WHERE ai_extracted IS NOT NULL AND ai_extracted != '' AND id IN (${ids.map(() => '?').join(',')})`)
    .get(...ids) as any).n;

describe('模型返回被截断时不能静默变成「0 条 + 已完成」', () => {
  beforeEach(() => {
    replies.length = 0;
  });

  it('救回断点前写完的，剩下的逐条重试补齐', async () => {
    const ids = [seedTender('甲项目'), seedTender('乙项目'), seedTender('丙项目')];

    // 一批 3 条：前两条写完了，第三条断在半个对象上，数组没有闭合的 ]。
    const cut = `[\n${JSON.stringify(item(ids[0]))},\n${JSON.stringify(item(ids[1]))},\n{"id":"${ids[2]}","projectName":"丙项`;
    replies.push({ text: cut, finish: 'length' });
    // 拆成单条之后装得下 —— 这一条是「17 条提取失败」和「3 条全部入库」的分界。
    replies.push({ text: JSON.stringify([item(ids[2])]), finish: 'stop' });

    const logs: string[] = [];
    const r = await runAIExtractForTenders(ids, 'test-user', (m) => logs.push(m));

    expect(r.processed).toBe(3);
    expect(r.failed).toBe(0);
    expect(extractedCount(ids)).toBe(3);
    // 截断这件事仍然要说出来（数据可能少了字段），但不能说成「提取失败」。
    expect(r.problems.join()).toContain('截断');
  });

  it('单条也装不下时，提示指向换模型而不是「没找到内容」', async () => {
    const id = seedTender('丁项目');
    replies.push({ text: '[{"id":"x","projectName":"丁项', finish: 'length' });

    const r = await runAIExtractForTenders([id], 'test-user');

    expect(r.processed).toBe(0);
    expect(r.failed).toBe(1);
    // 真凶是思维链吃掉了 max_tokens，光调大那个数字永远调不完。
    expect(r.problems.join()).toContain('换一个不输出思维链的模型');
  });
});
